/**
 * X API v2 user context (Bearer user access token).
 */

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
    const msg = json.errors?.[0]?.detail || json.errors?.[0]?.message || resp.statusText || "users/me failed";
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
    const msg = json.errors?.[0]?.detail || json.errors?.[0]?.message || json.detail || resp.statusText || "post failed";
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
