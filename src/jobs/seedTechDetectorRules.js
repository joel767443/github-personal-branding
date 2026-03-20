require("dotenv").config();

const fs = require("fs");
const path = require("path");

const prisma = require("../db/prisma");

function parseRulesJson(raw) {
  const data = JSON.parse(raw);

  // Supported shapes:
  // 1) Array of rule objects: [{ "name": "...", "file": "...", "keyword": "..." }, ...]
  // 2) Object keyed by rule name: { "React": { "file": "package.json", "keyword": "react" }, ... }
  if (Array.isArray(data)) return data;

  if (data && typeof data === "object") {
    return Object.entries(data).map(([name, value]) => ({
      name,
      ...(value && typeof value === "object" ? value : {}),
    }));
  }

  return [];
}

async function seedTechDetectorRules() {
  const rulesPath = path.join(__dirname, "..", "config", "techDetectorRules.json");

  let raw;
  try {
    raw = fs.readFileSync(rulesPath, "utf8");
  } catch (err) {
    console.warn("Tech detector rules JSON not found; skipping seeding.", {
      rulesPath,
      message: err?.message ?? String(err),
    });
    return { seeded: 0, skipped: true };
  }

  const rules = parseRulesJson(raw);
  if (!rules.length) {
    console.log("No rules found in techDetectorRules.json; skipping seeding.");
    return { seeded: 0, skipped: true };
  }

  // Upsert each rule by unique `name`.
  let seeded = 0;
  for (const rule of rules) {
    const name = rule?.name;
    const file = rule?.file;
    const keyword = rule?.keyword ?? null;

    if (!name || !file) continue;

    await prisma.techDetectorRule.upsert({
      where: { name },
      update: { file, keyword },
      create: { name, file, keyword },
    });
    seeded += 1;
  }

  console.log(`Seeded ${seeded} tech detector rules.`);
  return { seeded, skipped: false };
}

module.exports = seedTechDetectorRules;

