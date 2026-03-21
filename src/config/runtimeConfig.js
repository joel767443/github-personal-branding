const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ENV_PATH = path.join(__dirname, "..", "..", ".env");
const EXAMPLE_ENV_PATH = path.join(__dirname, "..", "..", ".example.env");

function parseEnvFile(raw) {
  const lines = String(raw).split(/\r?\n/);
  const entries = [];
  for (const line of lines) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) {
      entries.push({ type: "raw", line });
      continue;
    }
    const key = m[1];
    let value = m[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    entries.push({ type: "kv", key, value });
  }
  return entries;
}

function envMapFromEntries(entries) {
  const map = {};
  for (const entry of entries) {
    if (entry.type === "kv") {
      map[entry.key] = entry.value;
    }
  }
  return map;
}

function quoteIfNeeded(v) {
  const value = String(v ?? "");
  return /[\s"'#]/.test(value) ? `"${value.replaceAll('"', '\\"')}"` : value;
}

function writeEnvWithUpdates(updates) {
  const raw = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf8") : "";
  const entries = parseEnvFile(raw);
  const seen = new Set();
  const outLines = entries.map((entry) => {
    if (entry.type !== "kv") return entry.line;
    if (Object.prototype.hasOwnProperty.call(updates, entry.key)) {
      seen.add(entry.key);
      return `${entry.key}=${quoteIfNeeded(updates[entry.key])}`;
    }
    return `${entry.key}=${quoteIfNeeded(entry.value)}`;
  });
  for (const [key, value] of Object.entries(updates)) {
    if (!seen.has(key)) outLines.push(`${key}=${quoteIfNeeded(value)}`);
  }
  fs.writeFileSync(ENV_PATH, `${outLines.join("\n").trim()}\n`, "utf8");
}

function buildDatabaseUrl({ dbHost, dbPort, dbUser, dbPassword, dbName }) {
  const host = String(dbHost ?? "").trim();
  const port = String(dbPort ?? "").trim();
  const user = String(dbUser ?? "").trim();
  const password = String(dbPassword ?? "");
  const name = String(dbName ?? "").trim();
  if (!host || !port || !user || !name) {
    throw new Error("Database host, port, user, and name are required.");
  }
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${encodeURIComponent(name)}`;
}

function missingConfigKeys(runtimeEnv = process.env) {
  const required = ["PORT", "SESSION_SECRET", "DATABASE_URL"];
  return required.filter((k) => !String(runtimeEnv[k] ?? "").trim());
}

function readCurrentEnv() {
  const raw = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf8") : "";
  return envMapFromEntries(parseEnvFile(raw));
}

function ensureEnvFromExample() {
  if (fs.existsSync(ENV_PATH)) return false;
  if (!fs.existsSync(EXAMPLE_ENV_PATH)) return false;
  fs.copyFileSync(EXAMPLE_ENV_PATH, ENV_PATH);
  return true;
}

/** If SESSION_SECRET is unset, generate one and persist to `.env` so cookies and `/setup/status` stay consistent. */
function ensureSessionSecret() {
  if (String(process.env.SESSION_SECRET ?? "").trim()) return;
  const secret = crypto.randomBytes(32).toString("hex");
  writeEnvWithUpdates({ SESSION_SECRET: secret });
  process.env.SESSION_SECRET = secret;
}

module.exports = {
  ENV_PATH,
  EXAMPLE_ENV_PATH,
  writeEnvWithUpdates,
  buildDatabaseUrl,
  missingConfigKeys,
  readCurrentEnv,
  ensureEnvFromExample,
  ensureSessionSecret,
};

