const prisma = require('../db/prisma');

/**
 * Owns Prisma write patterns for developer profile/resume imports and Git host activity.
 * Sources map external data to DTOs (see ./dtos.js) and call these methods.
 */
class DeveloperPortfolioPersistence {
  /**
   * Replace all resume-import-derived rows for a developer in one transaction.
   * @param {number} developerId
   * @param {import('./dtos').ResumeImportSnapshot} snapshot
   * @param {{ onProgress?: (label: string, extra?: object) => void }} [opts]
   * @returns {Promise<{ stats: Record<string, number | boolean> }>}
   */
  async replaceResumeImportSnapshot(developerId, snapshot, opts = {}) {
    const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : () => {};

    const stats = {
      profile: false,
      experiences: 0,
      education: 0,
      certifications: 0,
      skills: 0,
      endorsements: 0,
      projects: 0,
      recommendations: 0,
      publications: 0,
    };

    const fp = snapshot.filePresence ?? {};
    const experiences = snapshot.experiences ?? [];
    const education = snapshot.education ?? [];
    const certifications = snapshot.certifications ?? [];
    const skills = snapshot.skills ?? [];
    const endorsementsSection = snapshot.endorsements ?? { fileMissing: true, rows: [] };
    const projects = snapshot.projects ?? [];
    const recommendations = snapshot.recommendations ?? [];
    const publications = snapshot.publications ?? [];

    await prisma.$transaction(async (tx) => {
      onProgress('LinkedIn: clearing previous LinkedIn import data', { phase: 'clear' });
      await tx.certification.deleteMany({ where: { developerId } });
      await tx.developerExperience.deleteMany({ where: { developerId } });
      await tx.education.deleteMany({ where: { developerId } });
      await tx.developerLinkedinSkill.deleteMany({ where: { developerId } });
      await tx.developerLinkedinReceivedEndorsement.deleteMany({ where: { developerId } });
      await tx.developerRecommendation.deleteMany({ where: { developerId } });
      await tx.developerPublication.deleteMany({ where: { developerId } });
      await tx.project.deleteMany({ where: { developerId, source: 'linkedin' } });

      const profile = snapshot.profile;
      if (fp.profile) {
        onProgress('LinkedIn: importing profile', { phase: 'profile' });
        if (profile?.csvRowPresent) stats.profile = true;
        const summary = profile?.linkedinSummary;
        if (summary) {
          await tx.developer.update({
            where: { id: developerId },
            data: { linkedinSummary: summary },
          });
        }
      }

      if (fp.positions) {
        onProgress('LinkedIn: importing experience (positions)', { phase: 'positions' });
        for (const row of experiences) {
          await tx.developerExperience.create({
            data: {
              developerId,
              title: row.title ?? null,
              company: row.company ?? null,
              dates: row.dates ?? null,
              location: row.location ?? null,
              description: row.description ?? null,
              sortOrder: row.sortOrder,
            },
          });
          stats.experiences += 1;
        }
      }

      if (fp.education) {
        onProgress('LinkedIn: importing education', { phase: 'education' });
        for (const row of education) {
          await tx.education.create({
            data: {
              developerId,
              degree: row.degree ?? null,
              institution: row.institution ?? null,
              dates: row.dates ?? null,
              location: row.location ?? null,
              sortOrder: row.sortOrder,
            },
          });
          stats.education += 1;
        }
      }

      if (fp.certifications) {
        onProgress('LinkedIn: importing certifications', { phase: 'certifications' });
        for (const row of certifications) {
          await tx.certification.create({
            data: {
              developerId,
              name: row.name ?? null,
              issuer: row.issuer ?? null,
              issued: row.issued ?? null,
              sortOrder: row.sortOrder,
            },
          });
          stats.certifications += 1;
        }
      }

      if (fp.skills) {
        onProgress('LinkedIn: importing skills', { phase: 'skills' });
        for (const row of skills) {
          await tx.developerLinkedinSkill.create({
            data: { developerId, name: row.name, sortOrder: row.sortOrder },
          });
          stats.skills += 1;
        }
      }

      if (endorsementsSection.fileMissing) {
        onProgress('LinkedIn: Endorsement_Received_Info.csv not found', {
          phase: 'endorsements',
          level: 'warn',
        });
      } else {
        onProgress('LinkedIn: importing received endorsements', { phase: 'endorsements' });
        const endorsementRows = endorsementsSection.rows ?? [];
        if (endorsementRows.length === 0) {
          onProgress('LinkedIn: endorsements file found but empty', {
            phase: 'endorsements',
            level: 'warn',
            file: endorsementsSection.fileBasename,
          });
        }
        for (const row of endorsementRows) {
          await tx.developerLinkedinReceivedEndorsement.create({
            data: {
              developerId,
              skillName: row.skillName ?? null,
              endorserFirstName: row.endorserFirstName ?? null,
              endorserLastName: row.endorserLastName ?? null,
              endorserCompany: row.endorserCompany ?? null,
              endorserJobTitle: row.endorserJobTitle ?? null,
              endorsedOn: row.endorsedOn ?? null,
              sortOrder: row.sortOrder,
            },
          });
          stats.endorsements += 1;
        }
      }

      if (fp.projects) {
        onProgress('LinkedIn: importing projects', { phase: 'projects' });
        for (const row of projects) {
          await tx.project.create({
            data: {
              developerId,
              title: row.title ?? null,
              description: row.description ?? null,
              url: row.url ?? null,
              dates: row.dates ?? null,
              source: row.source ?? 'linkedin',
              sortOrder: row.sortOrder,
            },
          });
          stats.projects += 1;
        }
      }

      if (fp.recommendations) {
        onProgress('LinkedIn: importing recommendations', { phase: 'recommendations' });
        for (const row of recommendations) {
          await tx.developerRecommendation.create({
            data: {
              developerId,
              recommenderFirstName: row.recommenderFirstName ?? null,
              recommenderLastName: row.recommenderLastName ?? null,
              company: row.company ?? null,
              jobTitle: row.jobTitle ?? null,
              text: row.text ?? null,
              date: row.date ?? null,
              sortOrder: row.sortOrder,
            },
          });
          stats.recommendations += 1;
        }
      }

      if (fp.publications) {
        onProgress('LinkedIn: importing publications', { phase: 'publications' });
        for (const row of publications) {
          await tx.developerPublication.create({
            data: {
              developerId,
              title: row.title ?? null,
              publisher: row.publisher ?? null,
              date: row.date ?? null,
              url: row.url ?? null,
              description: row.description ?? null,
              sortOrder: row.sortOrder,
            },
          });
          stats.publications += 1;
        }
      }
    });

    onProgress('LinkedIn: database import saved', { phase: 'saved' });
    return { stats };
  }

  /**
   * Upsert developer by email; preserves summary when LinkedIn summary already set (GitHub sync behavior).
   * @param {import('./dtos').GithubDeveloperUpsertInput} input
   * @returns {Promise<{ id: number, email: string }>}
   */
  async upsertDeveloperForGithubActivity(input) {
    const {
      email,
      firstName,
      lastName,
      profilePic,
      mobileNumber,
      headline,
      jobTitle,
      summaryFromHost,
      hireable,
    } = input;

    const existingDeveloper = await prisma.developer.findUnique({
      where: { email },
      select: { linkedinSummary: true },
    });
    const hasLinkedinSummary = Boolean(
      existingDeveloper?.linkedinSummary && String(existingDeveloper.linkedinSummary).trim(),
    );

    const developer = await prisma.developer.upsert({
      where: { email },
      update: {
        firstName,
        lastName,
        profilePic: profilePic ?? null,
        mobileNumber: mobileNumber ?? null,
        headline: headline ?? null,
        jobTitle: jobTitle ?? null,
        ...(!hasLinkedinSummary ? { summary: summaryFromHost ?? null } : {}),
        hireable: typeof hireable === 'boolean' ? hireable : null,
      },
      create: {
        email,
        firstName,
        lastName,
        profilePic: profilePic ?? null,
        mobileNumber: mobileNumber ?? null,
        headline: headline ?? null,
        jobTitle: jobTitle ?? null,
        summary: summaryFromHost ?? null,
        hireable: typeof hireable === 'boolean' ? hireable : null,
      },
    });

    return { id: developer.id, email: developer.email };
  }

  /**
   * @param {import('./dtos').GithubRepoUpsertInput} input
   */
  async upsertGithubRepo(input) {
    return prisma.repo.upsert({
      where: { id: input.id },
      update: { developerId: input.developerId },
      create: {
        id: input.id,
        name: input.name,
        fullName: input.fullName,
        description: input.description,
        private: input.private,
        url: input.url,
        createdAt: input.createdAt,
        updatedAt: input.updatedAt,
        developerId: input.developerId,
      },
    });
  }

  /**
   * @param {string} repoId
   * @param {import('./dtos').GithubRepoLanguageRowInput[]} rows
   */
  async replaceRepoLanguages(repoId, rows) {
    await prisma.languages.deleteMany({ where: { repoId } });
    if (rows.length > 0) {
      await prisma.languages.createMany({
        data: rows.map((r) => ({
          id: r.id,
          name: r.name,
          percentage: r.percentage,
          bytes: r.bytes ?? BigInt(0),
          repoId,
        })),
      });
    }
  }

  /**
   * @param {string} repoId
   * @param {import('./dtos').GithubCommitInput[]} commits
   */
  async upsertCommitsForRepo(repoId, commits) {
    for (const c of commits) {
      await prisma.commit.upsert({
        where: { id: c.id },
        update: {},
        create: {
          id: c.id,
          message: c.message,
          author: c.author,
          date: c.date,
          repoId,
        },
      });
    }
  }
}

module.exports = {
  DeveloperPortfolioPersistence,
  /** @type {DeveloperPortfolioPersistence} */
  developerPortfolioPersistence: new DeveloperPortfolioPersistence(),
};
