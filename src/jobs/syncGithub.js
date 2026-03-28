const prisma = require('../db/prisma');
const { getRepos, getCommits, getRepoLanguages, getUserProfile, createGithubClient } = require('../services/githubService');
const { getGithubCredentialsForDeveloper } = require('../services/developerCredentials');
const { developerPortfolioPersistence } = require('../persistence/developerPortfolioPersistence');

/**
 * @param {{ onProgress?: function, githubUsername?: string, developerId?: number }} opts
 */
async function syncGithub({ onProgress, githubUsername, developerId } = {}) {
  const progress = typeof onProgress === 'function' ? onProgress : () => {};

  const creds = await getGithubCredentialsForDeveloper(developerId);
  if (!creds?.token) {
    throw new Error(
      'GitHub API token is not configured. Save a GitHub personal access token in Account settings (encrypted), or set GITHUB_TOKEN in the server environment for a shared fallback token.',
    );
  }

  const github = createGithubClient(creds.token);
  let username = githubUsername ?? creds.username ?? null;
  
  if (!username) {
    progress('Resolving GitHub username from token');
    const userResp = await github.get('/user');
    username = userResp.data.login;
  }
  
  if (!username) {
    throw new Error('GitHub username is missing for this developer; reconnect GitHub OAuth or provide a token.');
  }

  progress('Fetching repositories');
  const repos = await getRepos(github, username);

  progress('Getting user details');
  const profile = await getUserProfile(github, username);
  const email = profile.email;

  if (!email) {
    throw new Error(`GitHub user ${username} does not have a public email address. Please make your email public in GitHub profile settings or reconnect via OAuth to sync.`);
  }

  const nameParts = typeof profile.name === 'string' ? profile.name.split(' ').filter(Boolean) : [];
  const firstName = nameParts[0] ?? profile.login ?? null;
  const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : null;

  const { id: developerIdResolved } = await developerPortfolioPersistence.upsertDeveloperForGithubActivity({
    email,
    firstName,
    lastName,
    profilePic: profile.avatar_url ?? null,
    mobileNumber: profile.twitter_username ?? null,
    headline: profile.company ?? null,
    jobTitle: profile.bio ?? null,
    summaryFromHost: profile.bio ?? null,
    hireable: typeof profile.hireable === 'boolean' ? profile.hireable : null,
    githubLogin: profile.login ?? username,
  });

  if (developerId != null && developerIdResolved !== developerId) {
    console.warn(
      `syncGithub: resolved developer id ${developerIdResolved} differs from job developerId ${developerId}`,
    );
  }

  await prisma.developer.update({
    where: { id: developerIdResolved },
    data: {
      githubLogin: profile.login ?? username,
      githubUsername: username,
    },
  });

  progress('Saving repositories', { totalRepos: repos.length });
  for (const repo of repos) {
    const ownerLogin = repo.owner?.login ?? username;
    if (!ownerLogin) {
      console.warn(`Skipping repo without owner: ${repo.name}`);
      continue;
    }

    // Optimization: Skip re-syncing repos that haven't changed since last sync
    const existingRepo = await prisma.repo.findUnique({
      where: { id: repo.id.toString() },
      select: { updatedAt: true }
    });
    const repoUpdatedAt = new Date(repo.updated_at);
    const hasChanged = !existingRepo || repoUpdatedAt.getTime() > existingRepo.updatedAt.getTime();

    progress(`Saving repositories - ${repo.name}`, { repoName: repo.name });
    const savedRepo = await developerPortfolioPersistence.upsertGithubRepo({
      id: repo.id.toString(),
      name: repo.name,
      fullName: repo.full_name,
      description: repo.description ?? '',
      private: repo.private,
      url: repo.html_url,
      createdAt: new Date(repo.created_at),
      updatedAt: repoUpdatedAt,
      developerId: developerIdResolved,
    });

    if (!hasChanged) {
      console.log(`Repo ${repo.name} unchanged, skipping sub-resource sync`);
      continue;
    }

    console.log(`Synced repo: ${repo.name}`);

    try {
      const langData = await getRepoLanguages(github, ownerLogin, repo.name);
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
      commits = await getCommits(github, ownerLogin, repo.name);
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

  return { developerId: developerIdResolved };
}

module.exports = syncGithub;
