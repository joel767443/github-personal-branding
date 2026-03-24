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

async function mapWithConcurrency(items, limit, mapper) {
  const out = new Array(items.length);
  let idx = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (true) {
      const current = idx;
      idx += 1;
      if (current >= items.length) break;
      out[current] = await mapper(items[current], current);
    }
  });
  await Promise.all(workers);
  return out;
}

/** Merge scores by trimmed name so (repo_id, name) is unique for createMany. */
function buildRepoTechStackRows(repoId, repoRuleStack) {
  const byName = new Map();
  for (const [name, score] of Object.entries(repoRuleStack)) {
    const key = String(name).trim();
    if (!key) continue;
    const n = Number(score);
    byName.set(key, (byName.get(key) ?? 0) + (Number.isFinite(n) ? n : 0));
  }
  return [...byName.entries()].map(([name, score]) => ({
    repoId,
    name,
    score,
  }));
}

async function detectTechStacks({ onProgress, developerId } = {}) {
  const progress = typeof onProgress === "function" ? onProgress : () => {};
  const rules = await prisma.techDetectorRule.findMany();
  const rulesByFile = new Map();
  for (const rule of rules) {
    const fileName = String(rule?.file ?? "");
    if (!fileName) continue;
    if (!rulesByFile.has(fileName)) rulesByFile.set(fileName, []);
    rulesByFile.get(fileName).push(rule);
  }
  const developers =
    developerId != null
      ? (await prisma.developer.findMany({ where: { id: developerId } }))
      : await prisma.developer.findMany();
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

    // 2) Detect frameworks/tools from repo file contents (per repo)
    const reposToProcess = repos.filter((repo) => {
      if (repo.techStacksProcessedRepoUpdatedAt == null) return true;
      const sourceTs = new Date(repo.updatedAt).getTime();
      const processedTs = new Date(repo.techStacksProcessedRepoUpdatedAt).getTime();
      if (!Number.isFinite(sourceTs) || !Number.isFinite(processedTs)) return true;
      return sourceTs > processedTs;
    });

    const repoDetections = await mapWithConcurrency(reposToProcess, 4, async (repo) => {
      const repoRuleStack = {};
      const parsed = parseGitHubRepoUrl(repo.url);
      if (!parsed) return null;

      let contents = [];
      try {
        contents = await getRepoContents(github, parsed.owner, parsed.repo);
      } catch (e) {
        return null; // ignore repo content failures (rate limits, missing perms, etc.)
      }

      if (!Array.isArray(contents)) return null;

      // Mimic python behavior: use entry names (including dirs) when checking file presence
      const entryNames = contents.map((f) => f.name).filter(Boolean);
      const filesByName = new Map();
      for (const f of contents) {
        if (f?.type !== "file") continue;
        if (!f?.name || !f?.download_url) continue;
        filesByName.set(f.name, f);
      }
      const fileContentCache = new Map(); // ruleFile -> lowercase content

      for (const [fileName, fileRules] of rulesByFile.entries()) {
        if (!fileRules?.length) continue;

        const hasEntryMatch = entryNames.some((n) => n.includes(fileName));
        for (const rule of fileRules) {
          if (rule.keyword == null) {
            // Rule matches by presence of a file/entry name substring
            if (!hasEntryMatch) continue;
            repoRuleStack[rule.name] = (repoRuleStack[rule.name] ?? 0) + 1;
            continue;
          }

          // Rule matches by keyword inside a specific file
          const keyword = String(rule.keyword).toLowerCase();
          const fileInfo = filesByName.get(fileName);
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

          if (!fileTextLower.includes(keyword)) continue;
          repoRuleStack[rule.name] = (repoRuleStack[rule.name] ?? 0) + 1;
        }
      }
      return { repoId: repo.id, repoRuleStack, repoUpdatedAt: repo.updatedAt };
    });

    const successfulDetections = repoDetections.filter(Boolean);
    const processedRepoIds = successfulDetections.map((d) => d.repoId);
    const repoRows = [];
    for (const d of successfulDetections) {
      repoRows.push(...buildRepoTechStackRows(d.repoId, d.repoRuleStack));
    }

    if (processedRepoIds.length > 0) {
      await prisma.repoTechStack.deleteMany({ where: { repoId: { in: processedRepoIds } } });
      if (repoRows.length > 0) {
        await prisma.repoTechStack.createMany({
          data: repoRows,
          skipDuplicates: true,
        });
      }
      await Promise.all(
        successfulDetections.map((d) =>
          prisma.repo.update({
            where: { id: d.repoId },
            data: { techStacksProcessedRepoUpdatedAt: d.repoUpdatedAt },
          }),
        ),
      );
    }

    // 3) Roll repo-level framework/tool detections into developer-level stack.
    // Keep this in DB space so unchanged repos still contribute without re-detection.
    const repoTechRows = await prisma.repoTechStack.findMany({
      where: { repo: { developerId: developer.id } },
      select: { name: true, score: true },
    });
    for (const row of repoTechRows) {
      developerStack[row.name] = (developerStack[row.name] ?? 0) + Number(row.score ?? 0);
    }

    // 4) Persist developer-level rollup (idempotent per developer)
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

