const prisma = require('../db/prisma');
const { getRepos, getCommits, getRepoLanguages, getUserProfile } = require('../services/githubService');

async function syncGithub({ onProgress, githubUsername } = {}) {
  const username = githubUsername ?? process.env.GITHUB_USERNAME;
  const progress = typeof onProgress === "function" ? onProgress : () => {};

  progress("Getting user details");
  console.log("Fetching repos...");

  progress("Fetching repositories");
  const repos = await getRepos(username);

  // Upsert the developer (repo owner) once per sync run.
  // Prisma `Developer` uses `email` as the unique identifier.
  const profile = await getUserProfile(username);
  const email = profile.email ?? `${username}@users.noreply.github.com`;

  const nameParts = typeof profile.name === "string" ? profile.name.split(" ").filter(Boolean) : [];
  const firstName = nameParts[0] ?? profile.login ?? null;
  const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : null;

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
      profilePic: profile.avatar_url ?? null,
      mobileNumber: profile.twitter_username ?? null,
      headline: profile.company ?? null,
      jobTitle: profile.bio ?? null,
      ...(!hasLinkedinSummary ? { summary: profile.bio ?? null } : {}),
      hireable: typeof profile.hireable === "boolean" ? profile.hireable : null,
    },
    create: {
      email,
      firstName,
      lastName,
      profilePic: profile.avatar_url ?? null,
      mobileNumber: profile.twitter_username ?? null,
      headline: profile.company ?? null,
      jobTitle: profile.bio ?? null,
      summary: profile.bio ?? null,
      hireable: typeof profile.hireable === "boolean" ? profile.hireable : null,
    },
  });

  progress("Saving repositories", { totalRepos: repos.length });
  for (const repo of repos) {
    const ownerLogin = repo.owner?.login ?? username;
    if (!ownerLogin) {
      console.warn(`Skipping repo without owner: ${repo.name}`);
      continue;
    }

    progress(`Saving repositories - ${repo.name}`, { repoName: repo.name });
    const savedRepo = await prisma.repo.upsert({
      where: { id: repo.id.toString() },
      update: { developerId: developer.id },
      create: {
        id: repo.id.toString(),
        name: repo.name,
        fullName: repo.full_name,
        description: repo.description ?? "",
        private: repo.private,
        url: repo.html_url,
        createdAt: new Date(repo.created_at),
        updatedAt: new Date(repo.updated_at),
        developerId: developer.id,
      }
    });

    console.log(`Synced repo: ${repo.name}`);

    // Fetch and persist repo languages
    try {
      const langData = await getRepoLanguages(ownerLogin, repo.name);
      const totalBytes = Object.values(langData).reduce((sum, v) => sum + v, 0);

      const languagePercentages = {};
      for (const [lang, bytesCount] of Object.entries(langData)) {
        if (totalBytes > 0) {
          const pct = Math.round(((bytesCount / totalBytes) * 100) * 100) / 100; // 2 decimals
          if (pct > 0) {
            languagePercentages[lang] = pct;
          }
        }
      }

      await prisma.languages.deleteMany({ where: { repoId: savedRepo.id } });

      const rows = Object.entries(languagePercentages).map(([name, percentage]) => {
        const rawBytes = langData[name];
        const bytes =
          typeof rawBytes === "number" && Number.isFinite(rawBytes)
            ? BigInt(Math.round(rawBytes))
            : BigInt(0);
        return {
          id: `${savedRepo.id}:${name}`,
          name,
          percentage,
          bytes,
          repoId: savedRepo.id,
        };
      });

      if (rows.length > 0) {
        await prisma.languages.createMany({ data: rows });
      }
    } catch (err) {
      const status = err?.response?.status;
      if (status === 403 || status === 404) {
        console.warn(`Skipping languages for ${repo.name} (GitHub ${status})`);
      } else {
        throw err;
      }
    }

    // Fetch commits
    let commits = [];
    try {
      commits = await getCommits(ownerLogin, repo.name);
    } catch (err) {
      const status = err?.response?.status;
      if (status === 403 || status === 404) {
        console.warn(`Skipping commits for ${repo.name} (GitHub ${status})`);
        continue;
      }
      throw err;
    }

    for (const commit of commits.slice(0, 10)) {
      await prisma.commit.upsert({
        where: { id: commit.sha },
        update: {},
        create: {
          id: commit.sha,
          message: commit.commit.message,
          author: commit.commit.author.name,
          date: new Date(commit.commit.author.date),
          repoId: savedRepo.id
        }
      });
    }
  }

  progress("Repository sync finished", { totalRepos: repos.length });
  console.log("GitHub sync complete");

  return { developerId: developer.id };
}

module.exports = syncGithub;