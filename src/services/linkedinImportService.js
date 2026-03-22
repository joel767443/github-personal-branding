const fs = require('fs');
const path = require('path');
const os = require('os');
const AdmZip = require('adm-zip');
const { parse } = require('csv-parse/sync');
const { developerPortfolioPersistence } = require('../persistence/developerPortfolioPersistence');

const TMP_PREFIX = 'linkedin-export-';
const MAX_ZIP_ENTRIES = 3000;
const MAX_UNCOMPRESSED_HINT_BYTES = 400 * 1024 * 1024;

function stemKey(filePath) {
  return path.basename(filePath, path.extname(filePath)).toLowerCase().replace(/[\s_-]+/g, '');
}

function walkCsvFiles(root, out = []) {
  if (!fs.existsSync(root)) return out;
  for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, ent.name);
    if (ent.isDirectory()) walkCsvFiles(full, out);
    else if (ent.isFile() && ent.name.toLowerCase().endsWith('.csv')) out.push(full);
  }
  return out;
}

function extractZipSafely(zipBuffer) {
  const zip = new AdmZip(zipBuffer);
  const entries = zip.getEntries().filter((e) => !e.isDirectory);
  if (entries.length > MAX_ZIP_ENTRIES) {
    throw new Error(`ZIP contains too many entries (max ${MAX_ZIP_ENTRIES})`);
  }
  let uncompressed = 0;
  for (const e of entries) {
    const name = String(e.entryName).replace(/\\/g, '/');
    if (name.includes('..') || path.isAbsolute(name)) {
      throw new Error('Invalid path inside ZIP');
    }
    const sz = e.header?.size;
    if (typeof sz === 'number' && Number.isFinite(sz)) uncompressed += sz;
    if (uncompressed > MAX_UNCOMPRESSED_HINT_BYTES) {
      throw new Error('ZIP uncompressed size too large');
    }
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), TMP_PREFIX));
  zip.extractAllTo(dir, true);
  return dir;
}

function normalizeKey(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    out[String(k).trim().toLowerCase()] = v;
  }
  return out;
}

function cell(nRow, candidates) {
  for (const c of candidates) {
    const key = c.toLowerCase();
    const v = nRow[key];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return null;
}

/**
 * Parse LinkedIn export files into a neutral snapshot for persistence.
 * @param {object} ctx
 * @param {(p: string|null) => string|null} ctx.pick
 * @param {(p: string|null) => Record<string, string>[]} ctx.recordsFor
 */
function buildResumeSnapshotFromLinkedIn({ pick, recordsFor }) {
  /** @type {import('../persistence/dtos').ResumeImportFilePresence} */
  const filePresence = {};

  const profilePath = pick('profile');
  filePresence.profile = Boolean(profilePath);
  /** @type {import('../persistence/dtos').ResumeProfilePatch|undefined} */
  let profile;
  if (profilePath) {
    const rows = recordsFor(profilePath);
    const row = rows[0];
    profile = {
      linkedinSummary: row ? cell(normalizeKey(row), ['summary']) ?? undefined : undefined,
      csvRowPresent: Boolean(row),
    };
  }

  const positionsPath = pick('positions', 'experience');
  filePresence.positions = Boolean(positionsPath);
  /** @type {import('../persistence/dtos').ResumeExperienceInput[]} */
  const experiences = [];
  if (positionsPath) {
    let so = 0;
    for (const row of recordsFor(positionsPath)) {
      const n = normalizeKey(row);
      const start = cell(n, ['started on', 'start date']);
      const end = cell(n, ['finished on', 'end date']);
      const dates =
        start || end ? [start, end].filter(Boolean).join(' – ') : cell(n, ['time period']);
      experiences.push({
        title: cell(n, ['title', 'position title']),
        company: cell(n, ['company name', 'company']),
        dates,
        location: cell(n, ['location']),
        description: cell(n, ['description']),
        sortOrder: so++,
      });
    }
  }

  const educationPath = pick('education');
  filePresence.education = Boolean(educationPath);
  /** @type {import('../persistence/dtos').ResumeEducationInput[]} */
  const education = [];
  if (educationPath) {
    let so = 0;
    for (const row of recordsFor(educationPath)) {
      const n = normalizeKey(row);
      const degreePart = cell(n, ['degree name', 'degree']);
      const fieldPart = cell(n, ['fields of study', 'field of study']);
      const degree = [degreePart, fieldPart].filter(Boolean).join(' — ') || null;
      const start = cell(n, ['start date', 'started on']);
      const end = cell(n, ['end date', 'finished on']);
      const dates =
        start || end ? [start, end].filter(Boolean).join(' – ') : cell(n, ['time period']);
      education.push({
        degree,
        institution: cell(n, ['school name', 'school']),
        dates,
        location: cell(n, ['location']),
        sortOrder: so++,
      });
    }
  }

  const certPath = pick('certifications', 'certification', 'certificationsandlicenses');
  filePresence.certifications = Boolean(certPath);
  /** @type {import('../persistence/dtos').ResumeCertificationInput[]} */
  const certifications = [];
  if (certPath) {
    let so = 0;
    for (const row of recordsFor(certPath)) {
      const n = normalizeKey(row);
      certifications.push({
        name: cell(n, ['name', 'certification name', 'title']),
        issuer: cell(n, ['authority', 'issuer', 'company']),
        issued: cell(n, ['time period', 'issued date', 'started on']),
        sortOrder: so++,
      });
    }
  }

  const skillsPath = pick('skills', 'skill');
  filePresence.skills = Boolean(skillsPath);
  /** @type {import('../persistence/dtos').ResumeSkillInput[]} */
  const skills = [];
  if (skillsPath) {
    const seenSkill = new Set();
    let so = 0;
    for (const row of recordsFor(skillsPath)) {
      const n = normalizeKey(row);
      const name = cell(n, ['name', 'skill', 'title']);
      if (!name) continue;
      const key = name.toLowerCase();
      if (seenSkill.has(key)) continue;
      seenSkill.add(key);
      skills.push({ name, sortOrder: so++ });
    }
  }

  const endorsementsPath = pick(
    'endorsementreceivedinfo',
    'endorsementsreceivedinfo',
    'endorsementsinfo',
    'endorsementsreceived',
    'receivedendorsements',
    'endorsements',
    'endorsement',
  );

  /** @type {import('../persistence/dtos').ResumeEndorsementsSection} */
  let endorsements;
  if (endorsementsPath) {
    /** @type {import('../persistence/dtos').ResumeEndorsementInput[]} */
    const rows = [];
    let so = 0;
    for (const row of recordsFor(endorsementsPath)) {
      const n = normalizeKey(row);
      const skillName = cell(n, [
        'skill',
        'skill name',
        'endorsement skill',
        'endorsed skill',
        'endorsedskills',
        'name',
      ]);
      const endorserFirstName = cell(n, [
        'first name',
        'endorser first name',
        'associate first name',
        'first_name',
      ]);
      const endorserLastName = cell(n, [
        'last name',
        'endorser last name',
        'associate last name',
        'last_name',
      ]);
      const fullName = cell(n, [
        'associate name',
        'member name',
        'endorser',
        'endorser name',
        'endorser fullname',
        'endorser full name',
      ]);
      let first = endorserFirstName;
      let last = endorserLastName;
      if (!first && !last && fullName) {
        const parts = fullName.split(/\s+/).filter(Boolean);
        first = parts[0] ?? null;
        last = parts.length > 1 ? parts.slice(1).join(' ') : null;
      }
      if (!skillName && !first && !last && !fullName) continue;
      rows.push({
        skillName,
        endorserFirstName: first,
        endorserLastName: last,
        endorserCompany: cell(n, ['company', 'endorser company', 'organization']),
        endorserJobTitle: cell(n, ['job title', 'title', 'position', 'headline', 'occupation']),
        endorsedOn: cell(n, [
          'endorsement date',
          'endorsed on',
          'date',
          'connection date',
          'created',
          'created at',
          'timestamp',
        ]),
        sortOrder: so++,
      });
    }
    endorsements = {
      fileMissing: false,
      fileBasename: path.basename(endorsementsPath),
      rows,
    };
  } else {
    endorsements = { fileMissing: true, rows: [] };
  }

  const projectsPath = pick('projects', 'project');
  filePresence.projects = Boolean(projectsPath);
  /** @type {import('../persistence/dtos').ResumeProjectInput[]} */
  const projects = [];
  if (projectsPath) {
    let so = 0;
    for (const row of recordsFor(projectsPath)) {
      const n = normalizeKey(row);
      const start = cell(n, ['started on', 'start date']);
      const end = cell(n, ['finished on', 'end date']);
      const dates =
        start || end ? [start, end].filter(Boolean).join(' – ') : cell(n, ['time period']);
      projects.push({
        title: cell(n, ['title', 'name']),
        description: cell(n, ['description']),
        url: cell(n, ['url']),
        dates,
        source: 'linkedin',
        sortOrder: so++,
      });
    }
  }

  const recPath = pick('recommendationsreceived', 'recommendations', 'givenrecommendations');
  filePresence.recommendations = Boolean(recPath);
  /** @type {import('../persistence/dtos').ResumeRecommendationInput[]} */
  const recommendations = [];
  if (recPath) {
    let so = 0;
    for (const row of recordsFor(recPath)) {
      const n = normalizeKey(row);
      recommendations.push({
        recommenderFirstName: cell(n, ['first name']),
        recommenderLastName: cell(n, ['last name']),
        company: cell(n, ['company']),
        jobTitle: cell(n, ['job title', 'title']),
        text: cell(n, ['recommendation', 'recommendation text', 'text', 'content']),
        date: cell(n, ['creation date', 'date', 'created']),
        sortOrder: so++,
      });
    }
  }

  const pubPath = pick('publications', 'publication');
  filePresence.publications = Boolean(pubPath);
  /** @type {import('../persistence/dtos').ResumePublicationInput[]} */
  const publications = [];
  if (pubPath) {
    let so = 0;
    for (const row of recordsFor(pubPath)) {
      const n = normalizeKey(row);
      publications.push({
        title: cell(n, ['name', 'title']),
        publisher: cell(n, ['publisher']),
        date: cell(n, ['publication date', 'date']),
        url: cell(n, ['publication url', 'url']),
        description: cell(n, ['description', 'summary']),
        sortOrder: so++,
      });
    }
  }

  return {
    snapshot: {
      filePresence,
      profile,
      experiences,
      education,
      certifications,
      skills,
      endorsements,
      projects,
      recommendations,
      publications,
    },
  };
}

/**
 * @param {{ zipPath?: string, buffer?: Buffer, developerId: number, onProgress?: (label: string, extra?: object) => void }} opts
 */
async function importLinkedInExport(opts) {
  const { developerId } = opts;
  if (developerId == null) throw new Error('developerId is required');

  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : () => {};

  let buf;
  if (opts.buffer) buf = opts.buffer;
  else if (opts.zipPath) buf = fs.readFileSync(opts.zipPath);
  else throw new Error('zipPath or buffer is required');

  onProgress('LinkedIn: extracting archive', { phase: 'extract' });
  const tmp = extractZipSafely(buf);

  try {
    const csvFiles = walkCsvFiles(tmp);
    onProgress(`LinkedIn: found ${csvFiles.length} CSV file(s)`, {
      phase: 'scan',
      csvCount: csvFiles.length,
    });
    const byStem = new Map();
    for (const f of csvFiles) {
      byStem.set(stemKey(f), f);
    }

    const pick = (...stems) => {
      for (const s of stems) {
        const file = byStem.get(s);
        if (file) return file;
      }
      return null;
    };

    const recordsFor = (p) => {
      if (!p) return [];
      const txt = fs.readFileSync(p, 'utf8');
      return parse(txt, {
        columns: true,
        skip_empty_lines: true,
        relax_quotes: true,
        relax_column_count: true,
        bom: true,
        trim: true,
      });
    };

    const { snapshot } = buildResumeSnapshotFromLinkedIn({ pick, recordsFor });

    const { stats } = await developerPortfolioPersistence.replaceResumeImportSnapshot(developerId, snapshot, {
      onProgress,
    });

    return { ok: true, stats };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

module.exports = { importLinkedInExport };
