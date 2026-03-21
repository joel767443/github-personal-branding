const axios = require("axios");
const prisma = require("../db/prisma");
const { createGithubClient, getEnvGithubClient, getRepoContents } = require("../services/githubService");
const { getGithubCredentialsForDeveloper } = require("../services/developerCredentials");

function parseGitHubRepoUrl(repoUrl) {
  // Expected format: https://github.com/{owner}/{repo}[...]
  const after = repoUrl.split("github.com/")[1];
  if (!after) return null;
  const parts = after.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  return { owner: parts[0], repo: parts[1] };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

async function detectTechStacks({ onProgress } = {}) {
  const progress = typeof onProgress === "function" ? onProgress : () => {};
  const rules = await prisma.techDetectorRule.findMany();
  const developers = await prisma.developer.findMany();
  progress("Detecting tech stacks", { totalDevelopers: developers.length, totalRules: rules.length });

  for (const developer of developers) {
    const creds = await getGithubCredentialsForDeveloper(developer.id);
    const github = creds?.token ? createGithubClient(creds.token) : getEnvGithubClient();
    const repos = await prisma.repo.findMany({
      where: { developerId: developer.id },
      include: { languages: true },
    });

    // 1) Start with normalized language percentages for this developer
    const languageTotals = {};
    for (const repo of repos) {
      for (const langRow of repo.languages) {
        languageTotals[langRow.name] = (languageTotals[langRow.name] ?? 0) + langRow.percentage;
      }
    }

    const totalSum = Object.values(languageTotals).reduce((sum, v) => sum + v, 0);
    const developerStack = {};
    if (totalSum > 0) {
      for (const [lang, total] of Object.entries(languageTotals)) {
        if (total > 0) developerStack[lang] = round2((total / totalSum) * 100);
      }
    }

    // 2) Detect frameworks/tools from repo file contents (per repo + rolled into developer)
    const repoIds = repos.map((r) => r.id);
    if (repoIds.length > 0) {
      await prisma.repoTechStack.deleteMany({ where: { repoId: { in: repoIds } } });
    }

    for (const repo of repos) {
      const repoRuleStack = {};
      const parsed = parseGitHubRepoUrl(repo.url);
      if (!parsed) continue;

      let contents = [];
      try {
        contents = await getRepoContents(github, parsed.owner, parsed.repo);
      } catch (e) {
        continue; // ignore repo content failures (rate limits, missing perms, etc.)
      }

      if (!Array.isArray(contents)) continue;

      // Mimic python behavior: use entry names (including dirs) when checking file presence
      const entryNames = contents.map((f) => f.name).filter(Boolean);
      const fileContentCache = new Map(); // ruleFile -> lowercase content

      for (const rule of rules) {
        const fileName = rule.file;
        if (!fileName) continue;

        if (rule.keyword == null) {
          // Rule matches by presence of a file/entry name substring
          if (entryNames.some((n) => n.includes(fileName))) {
            repoRuleStack[rule.name] = (repoRuleStack[rule.name] ?? 0) + 1;
            developerStack[rule.name] = (developerStack[rule.name] ?? 0) + 1;
          }
          continue;
        }

        // Rule matches by keyword inside a specific file
        const keyword = String(rule.keyword).toLowerCase();
        const fileInfo = contents.find((f) => f.type === "file" && f.name === fileName);
        if (!fileInfo?.download_url) continue;

        let fileTextLower = fileContentCache.get(fileName);
        if (!fileTextLower) {
          try {
            const resp = await axios.get(fileInfo.download_url, { responseType: "text" });
            fileTextLower = String(resp.data).toLowerCase();
            fileContentCache.set(fileName, fileTextLower);
          } catch (e) {
            continue;
          }
        }

        if (fileTextLower.includes(keyword)) {
          repoRuleStack[rule.name] = (repoRuleStack[rule.name] ?? 0) + 1;
          developerStack[rule.name] = (developerStack[rule.name] ?? 0) + 1;
        }
      }

      const repoRows = Object.entries(repoRuleStack).map(([name, score]) => ({
        repoId: repo.id,
        name,
        score: Number(score),
      }));
      if (repoRows.length > 0) {
        await prisma.repoTechStack.createMany({ data: repoRows });
      }
    }

    // 3) Persist developer-level rollup (idempotent per developer)
    await prisma.developerTechStack.deleteMany({ where: { developerId: developer.id } });

    const rows = Object.entries(developerStack).map(([name, percentage]) => ({
      developerId: developer.id,
      name,
      percentage: Number(percentage),
    }));

    if (rows.length > 0) {
      await prisma.developerTechStack.createMany({ data: rows });
    }
  }
  progress("Tech stack detection complete", { totalDevelopers: developers.length });
}

module.exports = detectTechStacks;

