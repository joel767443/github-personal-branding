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

module.exports = {
  resolveFacebookOAuthRedirectUri,
  facebookGraphApiVersion,
};
