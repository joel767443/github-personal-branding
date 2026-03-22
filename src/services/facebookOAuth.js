/**
 * Meta / Facebook Login OAuth helpers (Page access tokens).
 * @param {import('express').Request} req
 */
function resolveFacebookOAuthRedirectUri(req) {
  const explicit = String(process.env.FACEBOOK_OAUTH_CALLBACK_URL ?? '').trim();
  if (explicit) return explicit;
  return `${req.protocol}://${req.get('host')}/auth/facebook/callback`;
}

function facebookGraphApiVersion() {
  const v = String(process.env.FACEBOOK_GRAPH_API_VERSION ?? 'v21.0').trim();
  return v.startsWith('v') ? v : `v${v}`;
}

/**
 * Comma-separated scopes for Facebook Login. Default `pages_show_list` works without Advanced permissions;
 * add `pages_manage_posts` (and others) via env after Meta app review.
 */
function resolveFacebookOAuthScopes() {
  const raw = String(process.env.FACEBOOK_OAUTH_SCOPES ?? '').trim();
  if (raw) {
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .join(',');
  }
  return 'pages_show_list';
}

module.exports = {
  resolveFacebookOAuthRedirectUri,
  facebookGraphApiVersion,
  resolveFacebookOAuthScopes,
};
