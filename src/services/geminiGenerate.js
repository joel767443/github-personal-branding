/**
 * Google Gemini `generateContent` REST helper (shared by CLI and jobs).
 *
 * Env:
 *   GEMINI_API_KEY — required (or GOOGLE_API_KEY)
 *   GEMINI_MODEL — optional, default gemini-2.5-flash
 */

function getApiKey() {
  return String(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "").trim();
}

/** Gemini REST path segment only, e.g. `gemini-2.5-flash` (no `models/` prefix). */
function normalizeGeminiModelId(raw) {
  let s = String(raw ?? "").trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  if (s.toLowerCase().startsWith("models/")) {
    s = s.slice("models/".length).trim();
  }
  return s;
}

/**
 * @param {string} userMessage
 */
async function generateContent(userMessage) {
  const key = getApiKey();
  if (!key) {
    throw new Error("Set GEMINI_API_KEY (or GOOGLE_API_KEY) in your environment or .env");
  }

  const model =
    normalizeGeminiModelId(process.env.GEMINI_MODEL) || "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model,
  )}:generateContent?key=${encodeURIComponent(key)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: userMessage }] }],
    }),
  });

  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`Gemini API ${res.status}: ${raw.slice(0, 800)}`);
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("Gemini returned non-JSON response");
  }

  const parts = data.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) {
    return "";
  }
  const text = parts.map((p) => (p && p.text != null ? String(p.text) : "")).join("");
  return text;
}

module.exports = {
  getApiKey,
  normalizeGeminiModelId,
  generateContent,
};
