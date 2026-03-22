/**
 * X API v2 user context (Bearer user access token).
 */

/**
 * @param {Record<string, unknown>} json
 * @param {string} fallback
 */
function twitterApiErrorMessage(json, fallback) {
  const err0 = json?.errors?.[0];
  const detail = err0?.detail != null ? String(err0.detail) : "";
  const title = err0?.title != null ? String(err0.title) : "";
  const message = err0?.message != null ? String(err0.message) : "";
  let msg =
    detail ||
    message ||
    title ||
    (typeof json?.detail === "string" ? json.detail : "") ||
    fallback;
  if (typeof msg !== "string" || !msg) msg = fallback;
  if (/credits?/i.test(msg)) {
    msg += " Add usage credits or upgrade API access in the X Developer Portal (developer.x.com).";
  }
  return msg;
}

/**
 * @param {string} accessToken
 * @returns {Promise<{ id: string, username?: string, name?: string }>}
 */
async function fetchTwitterUser(accessToken) {
  const resp = await fetch("https://api.twitter.com/2/users/me?user.fields=username", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok || json.errors?.length) {
    const msg = twitterApiErrorMessage(json, resp.statusText || "users/me failed");
    throw new Error(`Twitter API: ${msg}`);
  }
  const u = json.data;
  if (!u?.id) {
    throw new Error("Twitter API: users/me returned no user id");
  }
  return {
    id: String(u.id),
    username: u.username != null ? String(u.username) : undefined,
    name: u.name != null ? String(u.name) : undefined,
  };
}

/**
 * @param {string} accessToken
 * @param {{ text: string }} body
 * @returns {Promise<{ id: string }>}
 */
async function createTweet(accessToken, { text }) {
  const resp = await fetch("https://api.twitter.com/2/tweets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text: String(text ?? "") }),
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok || json.errors?.length) {
    const msg = twitterApiErrorMessage(json, resp.statusText || "post failed");
    throw new Error(`Twitter API: ${msg}`);
  }
  const id = json.data?.id;
  if (!id) {
    throw new Error("Twitter API: create tweet returned no id");
  }
  return { id: String(id) };
}

module.exports = {
  fetchTwitterUser,
  createTweet,
};
