const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const axios = require("axios");

const prisma = require("../db/prisma");
const { ENV_PATH } = require("../config/runtimeConfig");

// -----------------------
// Helpers
// -----------------------

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeTableCell(value) {
  // Table rows use Markdown `|` separators.
  return String(value ?? "").replaceAll("|", "\\|");
}

function normalizeParagraphs(text) {
  const raw = String(text ?? "").replaceAll("\r\n", "\n").trim();
  if (!raw) return [];
  return raw.split(/\n{2,}/g).map((p) => p.trim()).filter(Boolean);
}

function parseBullets(text) {
  const raw = String(text ?? "").replaceAll("\r\n", "\n").trim();
  if (!raw) return [];

  const stripBulletPrefix = (line) => {
    let s = String(line ?? "").trim();
    // Remove repeated leading bullet markers like:
    // "- - Foo", "* Foo", "• Foo", "– Foo", "— Foo"
    while (/^([-*•]|[–—])\s+/.test(s)) {
      s = s.replace(/^([-*•]|[–—])\s+/, "").trim();
    }
    return s;
  };

  const lines = raw
    .split("\n")
    .map((l) => stripBulletPrefix(l))
    .map((l) => l.trim())
    .filter(Boolean);

  // If it's already line-bullet-ish, keep it.
  if (lines.length >= 2) return lines;

  // Otherwise, best-effort sentence splitting.
  const sentences = raw
    .split(/\. +/g)
    .map((s) => stripBulletPrefix(s))
    .map((s) => s.trim())
    .filter(Boolean);

  return sentences;
}

function formatPct(n) {
  const num = Number(n ?? 0);
  if (!Number.isFinite(num)) return "0.0%";
  const rounded2 = Math.round(num * 100) / 100;
  const isInt = Math.abs(rounded2 - Math.round(rounded2)) < 1e-9;
  if (isInt) return `${Math.round(rounded2).toFixed(1)}%`;
  return `${rounded2.toFixed(2)}%`;
}

function formatSharePct(count, total) {
  const c = Number(count ?? 0);
  const t = Number(total ?? 0);
  if (!Number.isFinite(c) || !Number.isFinite(t) || t <= 0) return "0.0%";
  return `${((c / t) * 100).toFixed(1)}%`;
}

function getDisplayName(developer) {
  const fullName = [developer?.firstName, developer?.lastName].filter(Boolean).join(" ").trim();
  return fullName || developer?.email || "Developer";
}

function toTechStackMap(rows) {
  return Object.fromEntries((rows ?? []).map((r) => [r.name, Number(r.percentage ?? 0)]));
}

function toArchCountsMap(rows) {
  return Object.fromEntries((rows ?? []).map((r) => [r.name, Number(r.count ?? 0)]));
}

// Default categories come from `github-developer-intelligence/scripts/generate_portfolio.py`.
const DEFAULT_SKILL_CATEGORIES = {
  languages: {
    label: "Languages",
    items: [
      "PHP",
      "Python",
      "Swift",
      "Java",
      "JavaScript",
      "TypeScript",
      "HTML",
      "CSS",
      "MQL5",
      "Hack",
      "C++",
      "Shell",
      "PowerShell",
      "SCSS",
      "Less",
      "Roff",
      "Blade",
    ],
  },
  tools: {
    label: "Tools",
    items: ["Dockerfile", "CMake", "Batchfile", "Makefile", "Docker", "Vite", "Terraform", "Ansible", "Git", "Github"],
  },
  frontend: {
    label: "Frontend libraries and frameworks",
    items: ["Vue", "React", "Tailwind CSS", "Svelte", "SvelteKit", "Astro", "Solid.js", "Qwik", "Remix", "Next.js", "Nuxt.js", "Angular"],
  },
  other: { label: "Other", items: [] },
};

function unionSets(sets) {
  const out = new Set();
  for (const s of sets) for (const v of s) out.add(v);
  return out;
}

function buildCategoryChips(stackMap, categoryItems, { maxItems = 30 } = {}) {
  const uniqueItems = [...new Set(categoryItems)];
  const present = uniqueItems
    .filter((n) => Object.prototype.hasOwnProperty.call(stackMap, n))
    .map((name) => ({ name, pct: Number(stackMap[name] ?? 0) }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, maxItems);

  if (present.length === 0) return "*—*";

  return present
    .map((it) => (it.pct >= 10 ? `**${it.name}**` : `*${it.name}*`))
    .join(" · ");
}

function buildOtherChips(stackMap, excludedNames, { maxItems = 20 } = {}) {
  const present = Object.entries(stackMap)
    .filter(([name]) => !excludedNames.has(name))
    .map(([name, pct]) => ({ name, pct: Number(pct ?? 0) }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, maxItems);

  if (present.length === 0) return "*—*";
  return present.map((it) => (it.pct >= 10 ? `**${it.name}**` : `*${it.name}*`)).join(" · ");
}

function buildReadmeMarkdown({ developer, experiences, education, certifications, techStackRows, archRows, repos, archTotalRepos }) {
  const heroName = getDisplayName(developer);
  // Prefer LinkedIn-derived `jobTitle` over GitHub-derived `headline` (which can store location).
  const heroTitle = (developer?.jobTitle || developer?.headline || "").trim() || "Senior Software Engineer";

  const summaryText = (developer?.linkedinSummary || developer?.summary || "").trim();
  const summaryParas = normalizeParagraphs(summaryText);
  const summaryMarkdown =
    summaryParas.length > 0
      ? summaryParas.map((p) => p).join("\n\n")
      : "_No profile summary available yet._";

  // Used only for architecture `Share` calculation.
  // In the example template this is the number of repos processed for sync.
  const safeArchTotalRepos = Number(archTotalRepos ?? 0);

  const archRowsSorted = [...archRows].sort((a, b) => Number(b.count ?? 0) - Number(a.count ?? 0));
  const archTableRows = archRowsSorted
    .map((r) => {
      const share = formatSharePct(r.count, safeArchTotalRepos);
      return `| ${escapeTableCell(r.name)} | ${r.count} | ${share} |`;
    })
    .join("\n");

  const stackMap = toTechStackMap(techStackRows);
  const languagesSet = new Set(DEFAULT_SKILL_CATEGORIES.languages.items);
  const toolsSet = new Set(DEFAULT_SKILL_CATEGORIES.tools.items);
  const frontendSet = new Set(DEFAULT_SKILL_CATEGORIES.frontend.items);
  const excluded = unionSets([languagesSet, toolsSet, frontendSet]);

  const languagesChips = buildCategoryChips(stackMap, DEFAULT_SKILL_CATEGORIES.languages.items);
  const toolsChips = buildCategoryChips(stackMap, DEFAULT_SKILL_CATEGORIES.tools.items);
  const frontendChips = buildCategoryChips(stackMap, DEFAULT_SKILL_CATEGORIES.frontend.items);
  const otherChips = buildOtherChips(stackMap, excluded);

  const archTotalLine = safeArchTotalRepos ? `*Detected across ${safeArchTotalRepos} repositories.*` : "*Detected across repositories.*";

  // Experience markdown blocks
  const experienceMdBlocks = (experiences ?? []).map((e) => {
    const dates = (e.dates ?? "").trim();
    const title = (e.title ?? "").trim() || "—";
    const company = (e.company ?? "").trim() || "—";
    const location = (e.location ?? "").trim();
    const where = location ? `${company} · ${location}` : company;

    const bullets = parseBullets(e.description ?? "");
    const bulletsMd = bullets.length ? bullets.map((b) => `- ${b}`).join("\n") : "";

    return `**${title}** | *${dates}*  \n${where}\n\n${bulletsMd}`.trim();
  });

  const educationMd = (education ?? []).map((ed) => {
    const degree = (ed.degree ?? "").trim() || "—";
    const institution = (ed.institution ?? "").trim() || "—";
    const location = (ed.location ?? "").trim();
    const dates = (ed.dates ?? "").trim();
    const locationPart = location ? ` · ${location}` : "";
    const datesPart = dates ? `  \n*${dates}*` : "";
    return `**${degree}**  \n${institution}${locationPart}${datesPart}`.trim();
  });

  const certificationsMd = (certifications ?? []).map((c) => {
    const name = (c.name ?? "").trim() || "—";
    const issuer = (c.issuer ?? "").trim();
    const issued = (c.issued ?? "").trim();
    const issuerText = issuer || "—";
    const issuedText = issued ? ` · *Issued ${issued}*` : "";
    return `**${name}**  \n${issuerText}${issuedText}`.trim();
  });

  // Projects: public repo summaries
  const projectsMd = (repos ?? [])
    .slice(0, 12)
    .map((r) => {
      const name = r?.name ?? r?.fullName ?? "Unnamed repo";
      const url = r?.url ?? "#";
      const summary = String(r?.description ?? "").trim() || "No README summary available.";

      const languages = Array.isArray(r.languages) ? [...r.languages] : [];
      const topLanguages = languages
        .sort((a, b) => Number(b.percentage ?? 0) - Number(a.percentage ?? 0))
        .slice(0, 4)
        .map((l) => `${l.name} (${formatPct(l.percentage).replace("%", "")}%)`)
        .join(", ");

      const techText = topLanguages || "No language data";
      return `- **[${name}](${url})** — ${summary}  \n  *Tech:* ${techText}`.trim();
    })
    .join("\n");

  const archTable = archRowsSorted.length
    ? `| Architecture | Repos | Share |\n|-------------|-------|-------|\n${archTableRows}`
    : "*No architecture patterns detected yet.*";

  const experienceSection = experienceMdBlocks.length ? experienceMdBlocks.join("\n\n") : "*No experience data.*";
  const educationSection = educationMd.length ? educationMd.join("\n\n") : "*No education data.*";
  const certificationsSection = certificationsMd.length ? certificationsMd.join("\n\n") : "*None listed.*";
  const projectsSection = projectsMd || "*No public projects yet.*";

  // Note: The original template uses `skills_chart.png` as an image.
  // We generate that file into the same `portfolio/` folder.
  const templatePath = path.join(__dirname, "..", "templates", "portfolio", "readme.md");
  const template = fs.existsSync(templatePath) ? fs.readFileSync(templatePath, "utf8") : "";

  const render = (tpl) =>
    tpl.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key) => {
      const v = {
        heroName,
        heroTitle,
        summaryMarkdown,
        archTotalLine,
        archTable,
        languagesChips,
        toolsChips,
        frontendChips,
        otherChips,
        experienceSection,
        educationSection,
        certificationsSection,
        projectsSection,
      }[key];
      return v == null ? "" : String(v);
    });

  if (template) {
    return render(template);
  }

  // Fallback: keep the previous inline template if the external template isn't present.
  return `# ${heroName}

*${heroTitle}*

${summaryMarkdown}

[View styled portfolio (HTML)](index.html)

---
## Architecture footprint

*Inferred patterns detected across repositories*

${archTotalLine}

${archRowsSorted.length ? `| Architecture | Repos | Share |\n|-------------|-------|-------|\n${archTableRows}` : "*No architecture patterns detected yet.*"}

---
## Technical skills

*Weighted by code volume across GitHub*

**Languages**  
${languagesChips}

**Tools**  
${toolsChips}

**Frontend libraries and frameworks**  
${frontendChips}

**Other**  
${otherChips}

---
## Skill distribution

*Languages and architectures*

![Skills and architectures](skills_chart.png)

---
## Professional experience

${experienceSection}

---
## Education

${educationSection}

---
## Certifications

${certificationsSection}

---
## Featured projects

*Public repositories, summarized from GitHub*

${projectsSection}

---
*Generated automatically by [github-developer-intelligence](https://github.com/joel767443/github-developer-intelligence).*
`;
}

function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Safe filename for `portfolio/img/…` derived from the stored image URL or file path. */
function safeAvatarFilenameFromUrl(urlOrPath) {
  const trimmed = String(urlOrPath ?? "").trim();
  if (!trimmed) return "avatar.jpg";
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const u = new URL(trimmed);
      let segment = path.basename(u.pathname.replace(/\/$/, "")) || "avatar";
      if (!/\.(jpe?g|png|gif|webp|avif)$/i.test(segment)) {
        segment = `${segment}.jpg`;
      }
      const safe = segment.replace(/[^a-zA-Z0-9._-]/g, "_");
      return safe || "avatar.jpg";
    } catch {
      return "avatar.jpg";
    }
  }
  const b = path.basename(trimmed.replace(/\\/g, "/"));
  const safe = b.replace(/[^a-zA-Z0-9._-]/g, "_");
  return safe || "avatar.jpg";
}

/**
 * Saves developer avatar to `portfolio/img/<name-from-url>`.
 * @returns {Promise<{ ok: boolean, relativeSrc: string | null }>} relativeSrc like `img/foo.jpg` when ok
 */
async function downloadDeveloperAvatarToPortfolio(profilePic, portfolioDir) {
  const trimmed = String(profilePic ?? "").trim();
  if (!trimmed) return { ok: false, relativeSrc: null };

  const imgDir = path.join(portfolioDir, "img");
  const fileName = safeAvatarFilenameFromUrl(trimmed);
  const dest = path.join(imgDir, fileName);
  const projectRoot = path.dirname(ENV_PATH);

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const resp = await axios.get(trimmed, {
        responseType: "arraybuffer",
        timeout: 25_000,
        maxRedirects: 5,
        validateStatus: (s) => s >= 200 && s < 400,
        headers: { "User-Agent": "github-intel-service-portfolio/1.0" },
      });
      const buf = Buffer.from(resp.data);
      if (!buf.length) return { ok: false, relativeSrc: null };
      fs.mkdirSync(imgDir, { recursive: true });
      fs.writeFileSync(dest, buf);
      return { ok: true, relativeSrc: `img/${fileName}` };
    } catch {
      return { ok: false, relativeSrc: null };
    }
  }

  const candidate = path.isAbsolute(trimmed) ? trimmed : path.join(projectRoot, trimmed.replace(/^\//, ""));
  try {
    if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) return { ok: false, relativeSrc: null };
    fs.mkdirSync(imgDir, { recursive: true });
    fs.copyFileSync(candidate, dest);
    return { ok: true, relativeSrc: `img/${fileName}` };
  } catch {
    return { ok: false, relativeSrc: null };
  }
}

function buildHtmlFromSiteTemplate({
  baseIndexHtml,
  stylesCss,
  heroName,
  heroHeadline,
  heroDescription,
  avatarUrl,
  avatarLocalSrc,
  techStackRows,
  experiences,
  education,
  certifications,
  repos,
}) {
  const escape = (v) => escapeHtml(v);

  const stackSorted = [...(techStackRows ?? [])].sort((a, b) => Number(b.percentage ?? 0) - Number(a.percentage ?? 0));
  const stackTop = stackSorted.slice(0, 25);
  const stackMap = Object.fromEntries(stackTop.map((r) => [r.name, Number(r.percentage ?? 0)]));

  const languagesSet = new Set(DEFAULT_SKILL_CATEGORIES.languages.items);
  const toolsSet = new Set(DEFAULT_SKILL_CATEGORIES.tools.items);
  const frontendSet = new Set(DEFAULT_SKILL_CATEGORIES.frontend.items);

  const otherItems = stackSorted.filter((r) => !languagesSet.has(r.name) && !toolsSet.has(r.name) && !frontendSet.has(r.name));

  const pickTop = (rows, limit = 8) => rows.slice(0, limit).map((r) => r.name);
  const buildBadges = (names) => {
    if (!names.length) return '<span class="badge">—</span>';
    return names.map((n) => `<span class="badge">${escape(n)}</span>`).join("");
  };

  const programmingLangBadges = pickTop(stackSorted.filter((r) => languagesSet.has(r.name)), 10);
  const toolsBadges = pickTop(stackSorted.filter((r) => toolsSet.has(r.name)), 10);
  const frontendBadges = pickTop(stackSorted.filter((r) => frontendSet.has(r.name)), 10);
  const webFrameworkBadges = pickTop(otherItems, 6);
  const backendServiceBadges = pickTop(otherItems.filter((r) => /firebase|appwrite|supabase|postgresql|aws|redis/i.test(r.name)), 6);
  const testingBadges = pickTop(stackSorted.filter((r) => /jest|cypress/i.test(r.name)), 6);

  const maxPct = Math.max(1e-9, ...stackSorted.map((r) => Number(r.percentage ?? 0)));
  const skillDistributionRows = stackSorted
    .slice(0, 14)
    .map((r) => {
      const pct = Number(r.percentage ?? 0);
      const width = Math.max(0, Math.round((pct / maxPct) * 100));
      const pctText = `${pct.toFixed(1)}%`;
      return `
    <div class="skill-distribution-row">
      <span class="skill-distribution-label">${escape(r.name)}</span>
      <div class="skill-distribution-bar-wrap">
        <div class="skill-distribution-bar" style="width: ${width}%"></div>
      </div>
      <span class="skill-distribution-pct">${pctText}</span>
    </div>`.trim();
    })
    .join("\n");

  const buildExperienceCards = (items) => {
    if (!items?.length) return `<p class="muted">No experience data.</p>`;
    return items
      .map((e) => {
        const title = escape(e.title ?? "—");
        const dates = escape(e.dates ?? "");
        const company = escape(e.company ?? "—");
        const location = escape(e.location ?? "");
        const where = location ? `${company} · ${location}` : company;

        const bullets = parseBullets(e.description ?? "");
        const bulletsHtml = bullets.length ? `<ul class="exp-bullets">${bullets.map((b) => `<li>${escape(b)}</li>`).join("")}</ul>` : "";

        return `
    <article class="card">
      <div class="experience-header">
        <h3>${title}</h3>
        <div class="experience-meta">
          <span>${dates || "—"}</span>
        </div>
      </div>
      <p class="muted">${where}</p>
      ${bulletsHtml}
    </article>`.trim();
      })
      .join("\n");
  };

  const buildSimpleCardList = (items, getTitle, getLines) => {
    if (!items?.length) return `<p class="muted">No education data.</p>`;
    return items
      .map((it) => {
        const title = escape(getTitle(it));
        const lines = getLines(it).filter(Boolean).map(escape);
        const linesHtml = lines.length ? `<p class="muted">${lines.join("<br/>")}</p>` : "";
        return `
    <article class="card">
      <h3 class="card-title">${title}</h3>
      ${linesHtml}
    </article>`.trim();
      })
      .join("\n");
  };

  const experienceHtml = buildExperienceCards(experiences ?? []);
  const educationHtml = (education ?? []).length
    ? (education ?? [])
        .map((ed) => {
          const degree = ed.degree ?? "—";
          const institution = ed.institution ?? "—";
          const location = ed.location ? ` · ${ed.location}` : "";
          const dates = ed.dates ? `<br/>${escape(ed.dates)}` : "";
          const title = escape(degree);
          return `
    <article class="card">
      <h3 class="card-title">${title}</h3>
      <p class="muted">${escape(institution)}${location}${dates}</p>
    </article>`.trim();
        })
        .join("\n")
    : `<p class="muted">No education data.</p>`;

  const certificationsHtml = (certifications ?? []).length
    ? (certifications ?? [])
        .map((c) => {
          const name = c.name ?? "—";
          const issuer = c.issuer ? ` · ${c.issuer}` : "";
          const issued = c.issued ? `<br/>Issued: ${escape(c.issued)}` : "";
          const title = escape(name);
          return `
    <article class="card">
      <h3 class="card-title">${title}</h3>
      <p class="muted">${escape(c.issuer ?? "—")}${issuer}${issued}</p>
    </article>`.trim();
        })
        .join("\n")
    : `<p class="muted">None listed.</p>`;

  const projectsHtml = (repos ?? [])
    .slice(0, 12)
    .map((r, idx) => {
      const name = r.name ?? r.fullName ?? "Unnamed repo";
      const url = r.url ?? "#";
      const summary = String(r.description ?? "").trim() || "No README summary available.";
      const languages = Array.isArray(r.languages) ? [...r.languages] : [];
      const topLangNames = languages
        .sort((a, b) => Number(b.percentage ?? 0) - Number(a.percentage ?? 0))
        .slice(0, 3)
        .map((l) => l.name);

      const badgesHtml = buildBadges(topLangNames);

      const imgUrl = "https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?w=600&h=400&fit=crop";
      const alt = escape(name);

      return `
    <article class="card project-card">
      <div class="project-image">
        <img src="${imgUrl}" alt="${alt}" />
      </div>
      <div class="project-body">
        <h3><a href="${escape(url)}" target="_blank" rel="noopener noreferrer">${escape(name)}</a></h3>
        <p class="muted">${escape(summary)}</p>
        <div class="badges">${badgesHtml}</div>
      </div>
    </article>`.trim();
    })
    .join("\n");

  // Use the provided `site/index.html` as the structural base.
  if (!baseIndexHtml) {
    // Keep the service functional even if the template can't be found.
    return `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>${escape(heroName)}</title><style>${stylesCss}</style></head><body><main><h1>${escape(heroName)}</h1><p>${escape(heroHeadline)}</p><p>${escape(heroDescription)}</p></main></body></html>`;
  }

  let html = String(baseIndexHtml);

  // Inline CSS so the output folder contains only `index.html`.
  html = html.replace(
    '<link rel="stylesheet" href="css/styles.css" />',
    `<style>\n${stylesCss}\n</style>`,
  );

  // Hero / brand.
  html = html.replace(`<div class="nav-brand">Yoweli Kachala</div>`, `<div class="nav-brand">${escape(heroName)}</div>`);
  html = html.replace(`<span class="hero-name">Yoweli Kachala</span>`, `<span class="hero-name">${escape(heroName)}</span>`);
  html = html.replace(`<p class="hero-headline">Senior Software Engineer</p>`, `<p class="hero-headline">${escape(heroHeadline)}</p>`);
  const descOld = "Specializing in full-stack development, DevOps practices, and scalable solutions that drive business growth.";
  if (html.includes(`<p class="hero-description">${descOld}</p>`)) {
    html = html.replace(
      `<p class="hero-description">${descOld}</p>`,
      `<p class="hero-description">${escape(heroDescription)}</p>`,
    );
  } else {
    // Best-effort fallback: replace first hero-description occurrence.
    html = html.replace(/<p class="hero-description">[\s\S]*?<\/p>/m, `<p class="hero-description">${escape(heroDescription)}</p>`);
  }

  // Skills badges for cards.
  const replaceCardBadges = (cardTitleHtml, badgesHtml) => {
    const re = new RegExp(
      `(<h3 class="card-title">${escapeRegex(cardTitleHtml)}<\\/h3>\\s*<div class="badges">)[\\s\\S]*?(<\\/div>)`,
      "m",
    );
    if (!re.test(html)) return;
    html = html.replace(re, `$1${badgesHtml}$2`);
  };

  replaceCardBadges("Programming Languages", buildBadges(programmingLangBadges));
  replaceCardBadges("DevOps &amp; Tools", buildBadges(toolsBadges));
  replaceCardBadges("JavaScript Libraries &amp; Frameworks", buildBadges(frontendBadges));
  replaceCardBadges("Web Frameworks", buildBadges(webFrameworkBadges));
  replaceCardBadges("Backend as a Service", buildBadges(backendServiceBadges));
  replaceCardBadges("Testing", buildBadges(testingBadges));

  // Hero avatar: local file `img/<from-url>` when downloaded, else remote `profilePic` URL.
  const altText = `${heroName} - ${heroHeadline}`;
  const heroImgRe = /<img\s+[^>]*src=["']img\/me\.jpeg["'][^>]*\/?>/i;
  const local = String(avatarLocalSrc ?? "").trim();
  if (local) {
    html = html.replace(heroImgRe, `<img src="${escape(local)}" alt="${escape(altText)}" />`);
  } else if (avatarUrl) {
    const avatar = String(avatarUrl).trim();
    if (avatar) {
      html = html.replace(heroImgRe, `<img src="${escape(avatar)}" alt="${escape(altText)}" />`);
    }
  }

  // Skill distribution block.
  const startSkill = '<div class="skill-distribution">';
  const endSkill = '    </div>\n\n  </div>\n</section>';
  const skillsChartFigure = `    <figure class="skill-distribution-chart" aria-label="Skills and architectures">
      <img src="skills_chart.png" alt="Skills and architectures across languages and repositories" loading="lazy" decoding="async" />
    </figure>`;
  const startSkillIdx = html.indexOf(startSkill);
  if (startSkillIdx !== -1) {
    const endSkillIdx = html.indexOf(endSkill, startSkillIdx);
    if (endSkillIdx !== -1) {
      const newClosing = `    </div>\n\n${skillsChartFigure}\n\n  </div>\n</section>`;
      html =
        html.slice(0, startSkillIdx) +
        startSkill +
        "\n" +
        skillDistributionRows +
        "\n" +
        newClosing +
        html.slice(endSkillIdx + endSkill.length);
    }
  }

  // Experience / Education / Certifications: replace the "empty state" blocks.
  html = html.replace(
    /<div class="stacked-cards">\s*<p class="muted">No experience data\.<\/p>\s*<\/div>/m,
    `<div class="stacked-cards">\n${experienceHtml}\n    </div>`,
  );
  html = html.replace(
    /<div class="stacked-cards">\s*<p class="muted">No education data\.<\/p>\s*<\/div>/m,
    `<div class="stacked-cards">\n${educationHtml}\n    </div>`,
  );
  html = html.replace(
    /<div class="stacked-cards">\s*<p class="muted">None listed\.<\/p>\s*<\/div>/m,
    `<div class="stacked-cards">\n${certificationsHtml}\n    </div>`,
  );

  // Projects list.
  const startProjects = '<div class="grid projects-grid">';
  const endProjects = '    </div>\n  </div>\n</section>\n\n  <section id="contact" class="section">';
  const startProjectsIdx = html.indexOf(startProjects);
  if (startProjectsIdx !== -1) {
    const endProjectsIdx = html.indexOf(endProjects, startProjectsIdx);
    if (endProjectsIdx !== -1) {
      // Replace only the contents inside the grid.
      html = html.slice(0, startProjectsIdx + startProjects.length) + "\n" + projectsHtml + "\n" + html.slice(endProjectsIdx);
    }
  }

  // Footer name.
  html = html.replace(`<h3>Yoweli Kachala</h3>`, `<h3>${escape(heroName)}</h3>`);

  return html;
}

function generateSkillsChartPng({ outputPath, techStackRows, archRows }) {
  const scriptPath = path.join(__dirname, "portfolio", "generateSkillsChart.py");
  const payload = {
    techStack: toTechStackMap(techStackRows),
    archCounts: toArchCountsMap(archRows),
  };

  const res = spawnSync("python3", [scriptPath, outputPath], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    maxBuffer: 10_000_000,
  });

  if (res.status !== 0) {
    const errOut = (res.stderr || "").toString();
    throw new Error(`skills chart generation failed: ${errOut || res.error || "unknown error"}`);
  }
}

// -----------------------
// Main entry
// -----------------------

async function generatePortfolioOutput({ developerId, onProgress } = {}) {
  const progress = typeof onProgress === "function" ? onProgress : () => {};
  if (developerId == null) throw new Error("developerId is required");

  const projectRoot = path.dirname(ENV_PATH);
  const portfolioDir = path.join(projectRoot, "portfolio");
  fs.mkdirSync(portfolioDir, { recursive: true });

  progress("Portfolio: loading developer data", { developerId });

  const [
    developer,
    experiences,
    education,
    certifications,
    techStackRows,
    archRows,
    reposPublic,
  ] = await Promise.all([
    prisma.developer.findUnique({ where: { id: developerId } }),
    prisma.developerExperience.findMany({ where: { developerId }, orderBy: { sortOrder: "asc" } }),
    prisma.education.findMany({ where: { developerId }, orderBy: { sortOrder: "asc" } }),
    prisma.certification.findMany({ where: { developerId }, orderBy: { sortOrder: "asc" } }),
    prisma.developerTechStack.findMany({ where: { developerId }, orderBy: { percentage: "desc" } }),
    prisma.developerArchitecture.findMany({ where: { developerId }, orderBy: { count: "desc" } }),
    prisma.repo.findMany({
      where: { developerId, private: false },
      include: {
        languages: { select: { name: true, percentage: true } },
      },
      orderBy: { updatedAt: "desc" },
    }),
  ]);

  if (!developer) throw new Error(`No Developer found for developerId=${developerId}`);

  const avatarUrl = developer?.profilePic ? String(developer.profilePic).trim() : "";
  const avatarDl = avatarUrl ? await downloadDeveloperAvatarToPortfolio(avatarUrl, portfolioDir) : { ok: false, relativeSrc: null };
  const avatarLocalSrc = avatarDl.ok && avatarDl.relativeSrc ? avatarDl.relativeSrc : "";

  progress("Portfolio: generating README markdown");
  // Use architecture totals based on public repos count in this folder (mirrors the example table).
  // (If you want total repos regardless of privacy, change to `prisma.repo.count`.)
  const totalRepos = await prisma.repo.count({ where: { developerId } });
  const archRowsForMd = archRows.map((r) => ({ name: r.name, count: Number(r.count ?? 0) }));
  const reposForMd = reposPublic.map((r) => ({
    ...r,
    languages: Array.isArray(r.languages) ? r.languages : [],
  }));

  const readme = buildReadmeMarkdown({
    developer,
    experiences,
    education,
    certifications,
    techStackRows,
    archRows: archRowsForMd.map((r) => ({ ...r, count: r.count })),
    repos: reposForMd,
    archTotalRepos: totalRepos,
  });

  const readmePath = path.join(portfolioDir, "README.md");
  fs.writeFileSync(readmePath, readme, "utf8");

  progress("Portfolio: generating skills_chart.png");
  const pngPath = path.join(portfolioDir, "skills_chart.png");
  generateSkillsChartPng({ outputPath: pngPath, techStackRows, archRows: archRowsForMd });

  progress("Portfolio: generating HTML index.html");
  const summaryParagraphs = normalizeParagraphs(developer.linkedinSummary || developer.summary || "");
  const heroDescription = summaryParagraphs[0] || developer.summary || "Portfolio generated from GitHub activity and LinkedIn data.";
  const heroHeadline = (developer.jobTitle || developer.headline || "Senior Software Engineer").trim();

  // Vendor the provided template into the repo (once), so generation doesn't depend
  // on Desktop absolute paths after the first successful run.
  const externalSiteDir = path.join(projectRoot, "..", "..", "github-developer-intelligence", "site");
  const externalIndexPath = path.join(externalSiteDir, "index.html");
  const externalStylesPath = path.join(externalSiteDir, "css", "styles.css");

  const internalSiteDir = path.join(projectRoot, "src", "templates", "portfolio", "site");
  const internalIndexPath = path.join(internalSiteDir, "index.html");
  const internalStylesPath = path.join(internalSiteDir, "css", "styles.css");

  const needsCopy = !fs.existsSync(internalIndexPath) || !fs.existsSync(internalStylesPath);
  if (needsCopy) {
    if (!fs.existsSync(externalIndexPath) || !fs.existsSync(externalStylesPath)) {
      // We'll still generate the portfolio, but HTML styling may fall back to minimal markup.
      // (Logged implicitly via thrown errors only if used.)
      progress("Portfolio: site template missing (skipping vendor copy)", {});
    } else {
      fs.mkdirSync(path.dirname(internalStylesPath), { recursive: true });
      fs.writeFileSync(internalIndexPath, fs.readFileSync(externalIndexPath, "utf8"), "utf8");
      fs.writeFileSync(internalStylesPath, fs.readFileSync(externalStylesPath, "utf8"), "utf8");
    }
  }

  const stylesCss = fs.existsSync(internalStylesPath) ? fs.readFileSync(internalStylesPath, "utf8") : "";
  const baseIndexHtml = fs.existsSync(internalIndexPath) ? fs.readFileSync(internalIndexPath, "utf8") : "";

  // The HTML builder uses the site template when available.
  let html = buildHtmlFromSiteTemplate({
    baseIndexHtml,
    stylesCss,
    heroName: getDisplayName(developer),
    heroHeadline,
    heroDescription,
    avatarUrl: avatarLocalSrc ? "" : avatarUrl,
    avatarLocalSrc,
    techStackRows,
    experiences,
    education,
    certifications,
    repos: reposForMd,
  });

  // If buildHtmlFromSiteTemplate couldn't find the template, it will return a minimal HTML doc.
  // We still write it to the correct location.
  const indexPath = path.join(portfolioDir, "index.html");
  fs.writeFileSync(indexPath, html, "utf8");

  progress("Portfolio: generation complete");
  return { portfolioDir };
}

module.exports = generatePortfolioOutput;

