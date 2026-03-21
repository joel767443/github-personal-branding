const { developerPortfolioPersistence } = require('../persistence/developerPortfolioPersistence');
const { getRepos, getCommits, getRepoLanguages, getUserProfile } = require('../services/githubService');

async function syncGithub({ onProgress, githubUsername } = {}) {
  const username = githubUsername ?? process.env.GITHUB_USERNAME;
  const progress = typeof onProgress === 'function' ? onProgress : () => {};

  progress('Getting user details');
  console.log('Fetching repos...');

  progress('Fetching repositories');
  const repos = await getRepos(username);

  const profile = await getUserProfile(username);
  const email = profile.email ?? `${username}@users.noreply.github.com`;

  const nameParts = typeof profile.name === 'string' ? profile.name.split(' ').filter(Boolean) : [];
  const firstName = nameParts[0] ?? profile.login ?? null;
  const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : null;

  const { id: developerId } = await developerPortfolioPersistence.upsertDeveloperForGithubActivity({
    email,
    firstName,
    lastName,
    profilePic: profile.avatar_url ?? null,
    mobileNumber: profile.twitter_username ?? null,
    headline: profile.company ?? null,
    jobTitle: profile.bio ?? null,
    summaryFromHost: profile.bio ?? null,
    hireable: typeof profile.hireable === 'boolean' ? profile.hireable : null,
  });

  progress('Saving repositories', { totalRepos: repos.length });
  for (const repo of repos) {
    const ownerLogin = repo.owner?.login ?? username;
    if (!ownerLogin) {
      console.warn(`Skipping repo without owner: ${repo.name}`);
      continue;
    }

    progress(`Saving repositories - ${repo.name}`, { repoName: repo.name });
    const savedRepo = await developerPortfolioPersistence.upsertGithubRepo({
      id: repo.id.toString(),
      name: repo.name,
      fullName: repo.full_name,
      description: repo.description ?? '',
      private: repo.private,
      url: repo.html_url,
      createdAt: new Date(repo.created_at),
      updatedAt: new Date(repo.updated_at),
      developerId,
    });

    console.log(`Synced repo: ${repo.name}`);

    try {
      const langData = await getRepoLanguages(ownerLogin, repo.name);
      const totalBytes = Object.values(langData).reduce((sum, v) => sum + v, 0);

      const languagePercentages = {};
      for (const [lang, bytesCount] of Object.entries(langData)) {
        if (totalBytes > 0) {
          const pct = Math.round((bytesCount / totalBytes) * 100 * 100) / 100;
          if (pct > 0) {
            languagePercentages[lang] = pct;
          }
        }
      }

      const rows = Object.entries(languagePercentages).map(([name, percentage]) => {
        const rawBytes = langData[name];
        const bytes =
          typeof rawBytes === 'number' && Number.isFinite(rawBytes)
            ? BigInt(Math.round(rawBytes))
            : BigInt(0);
        return {
          id: `${savedRepo.id}:${name}`,
          name,
          percentage,
          bytes,
        };
      });

      await developerPortfolioPersistence.replaceRepoLanguages(savedRepo.id, rows);
    } catch (err) {
      const status = err?.response?.status;
      if (status === 403 || status === 404) {
        console.warn(`Skipping languages for ${repo.name} (GitHub ${status})`);
      } else {
        throw err;
      }
    }

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

    const commitDtos = commits.slice(0, 10).map((commit) => ({
      id: commit.sha,
      message: commit.commit.message,
      author: commit.commit.author.name,
      date: new Date(commit.commit.author.date),
    }));

    await developerPortfolioPersistence.upsertCommitsForRepo(savedRepo.id, commitDtos);
  }

  progress('Repository sync finished', { totalRepos: repos.length });
  console.log('GitHub sync complete');

  return { developerId };
}

module.exports = syncGithub;
