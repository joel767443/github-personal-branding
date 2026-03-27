const axios = require("axios");
const prisma = require("../db/prisma");
const { createGithubClient, getEnvGithubClient, getRepoContents } = require("../services/githubService");
const { getGithubCredentialsForDeveloper } = require("../services/developerCredentials");
const AhoCorasick = require("../utils/stringMatcher");

function parseGitHubRepoUrl(repoUrl) {
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
  
  // Group rules by file and build matchers
  const rulesByFile = new Map();
  for (const rule of rules) {
    const fileName = String(rule?.file ?? "");
    if (!fileName) continue;
    if (!rulesByFile.has(fileName)) {
      rulesByFile.set(fileName, { rules: [], matcher: null, keywords: [] });
    }
    const bucket = rulesByFile.get(fileName);
    bucket.rules.push(rule);
    if (rule.keyword) {
      bucket.keywords.push(rule.keyword.toLowerCase());
    }
  }

  // Pre-build AhoCorasick matchers for files with keywords
  for (const bucket of rulesByFile.values()) {
    if (bucket.keywords.length > 0) {
      bucket.matcher = new AhoCorasick(bucket.keywords);
    }
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

    const reposToProcess = repos.filter((repo) => {
      if (repo.techStacksProcessedRepoUpdatedAt == null) return true;
      const sourceTs = new Date(repo.updatedAt).getTime();
      const processedTs = new Date(repo.techStacksProcessedRepoUpdatedAt).getTime();
      return sourceTs > processedTs;
    });

    const repoDetections = await mapWithConcurrency(reposToProcess, 4, async (repo) => {
      const repoRuleStack = {};
      const parsed = parseGitHubRepoUrl(repo.url);
      if (!parsed) return null;

      let contents = [];
      try {
        contents = await getRepoContents(github, parsed.owner, parsed.repo);
      } catch (e) { return null; }

      if (!Array.isArray(contents)) return null;

      const entryNames = contents.map((f) => f.name).filter(Boolean);
      const filesByName = new Map();
      for (const f of contents) {
        if (f?.type === "file" && f?.name && f?.download_url) {
          filesByName.set(f.name, f);
        }
      }

      for (const [fileName, bucket] of rulesByFile.entries()) {
        const hasEntryMatch = entryNames.some((n) => n.includes(fileName));
        
        // Handle presence-only rules
        for (const rule of bucket.rules.filter(r => !r.keyword)) {
          if (hasEntryMatch) {
            repoRuleStack[rule.name] = (repoRuleStack[rule.name] ?? 0) + 1;
          }
        }

        // Handle keyword rules
        if (bucket.matcher) {
          const fileInfo = filesByName.get(fileName);
          if (fileInfo) {
            try {
              const resp = await axios.get(fileInfo.download_url, { responseType: "text" });
              const matches = bucket.matcher.search(String(resp.data));
              for (const rule of bucket.rules.filter(r => r.keyword)) {
                const count = matches.get(rule.keyword.toLowerCase()) ?? 0;
                if (count > 0) {
                  repoRuleStack[rule.name] = (repoRuleStack[rule.name] ?? 0) + count;
                }
              }
            } catch (e) { /* ignore file fetch errors */ }
          }
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
      await prisma.$transaction([
        prisma.repoTechStack.deleteMany({ where: { repoId: { in: processedRepoIds } } }),
        ...(repoRows.length > 0 ? [prisma.repoTechStack.createMany({ data: repoRows, skipDuplicates: true })] : []),
        ...successfulDetections.map(d => prisma.repo.update({
          where: { id: d.repoId },
          data: { techStacksProcessedRepoUpdatedAt: d.repoUpdatedAt }
        }))
      ]);
    }

    const repoTechRows = await prisma.repoTechStack.findMany({
      where: { repo: { developerId: developer.id } },
      select: { name: true, score: true },
    });
    for (const row of repoTechRows) {
      developerStack[row.name] = (developerStack[row.name] ?? 0) + Number(row.score ?? 0);
    }

    await prisma.developerTechStack.deleteMany({ where: { developerId: developer.id } });
    const devRows = Object.entries(developerStack).map(([name, percentage]) => ({
      developerId: developer.id,
      name,
      percentage: Number(percentage),
    }));
    if (devRows.length > 0) {
      await prisma.developerTechStack.createMany({ data: devRows });
    }
  }
  progress("Tech stack detection complete", { totalDevelopers: developers.length });
}

module.exports = detectTechStacks;

