const express = require("express");
const crypto = require("crypto");
const prisma = require("../db/prisma");
const { resolveDeveloperFromSession } = require("../services/sessionDeveloperService");
const {
  resolveTwitterOAuthRedirectUri,
  resolveTwitterOAuthScopes,
  TWITTER_AUTHORIZE_URL,
  getTwitterClientCredentials,
  isTwitterOAuthConfigured,
} = require("../social/twitter/oauth/config");
const {
  generateCodeVerifier,
  generateCodeChallenge,
} = require("../social/twitter/oauth/pkce");
const { exchangeAuthorizationCode } = require("../social/twitter/oauth/tokenClient");
const { fetchTwitterUser } = require("../social/twitter/twitterApiClient");
const { upsertTwitterAuth, deleteTwitterAuth } = require("../social/twitter/twitterAuthRepository");

const router = express.Router();

router.get("/auth/twitter", async (req, res) => {
  try {
    const rawDevId = req.session?.user?.developerId;
    const developerId = rawDevId != null ? Number(rawDevId) : NaN;
    if (!Number.isFinite(developerId) || developerId <= 0) {
      return res.redirect(302, "/?twitter=login_required");
    }
    if (!isTwitterOAuthConfigured()) {
      return res.redirect(302, "/dashboard?twitter_error=config");
    }
    const { clientId } = getTwitterClientCredentials();
    const redirectUri = resolveTwitterOAuthRedirectUri(req);
    const state = crypto.randomBytes(16).toString("hex");
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    req.session.oauthTwitterState = state;
    req.session.oauthTwitterCodeVerifier = codeVerifier;
    req.session.oauthTwitterRedirectUri = redirectUri;

    const url = new URL(TWITTER_AUTHORIZE_URL);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("scope", resolveTwitterOAuthScopes());
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");

    return res.redirect(302, url.toString());
  } catch (err) {
    console.error("[twitter-oauth] start failed", err);
    return res.redirect(
      302,
      `/dashboard?twitter_error=${encodeURIComponent(String(err?.message ?? err).slice(0, 200))}`,
    );
  }
});

router.get("/auth/twitter/callback", async (req, res) => {
  const fail = (code) =>
    res.redirect(302, `/dashboard?twitter_error=${encodeURIComponent(String(code).slice(0, 200))}`);

  try {
    const { code, state, error, error_description: errorDescription } = req.query;
    if (error) {
      const msg = errorDescription ? `${String(error)}: ${String(errorDescription)}` : String(error);
      return res.redirect(302, `/dashboard?twitter_error=${encodeURIComponent(msg.slice(0, 200))}`);
    }
    if (!code || !state || state !== req.session.oauthTwitterState) {
      return fail("state");
    }
    const rawDevId = req.session?.user?.developerId;
    const developerId = rawDevId != null ? Number(rawDevId) : NaN;
    if (!Number.isFinite(developerId) || developerId <= 0) {
      return fail("session");
    }
    const codeVerifier = req.session.oauthTwitterCodeVerifier;
    const redirectUri = req.session.oauthTwitterRedirectUri ?? resolveTwitterOAuthRedirectUri(req);
    delete req.session.oauthTwitterState;
    delete req.session.oauthTwitterCodeVerifier;
    delete req.session.oauthTwitterRedirectUri;

    if (!codeVerifier) {
      return fail("pkce");
    }

    const tokenJson = await exchangeAuthorizationCode({
      code: String(code),
      redirectUri,
      codeVerifier: String(codeVerifier),
    });

    const expiresIn = Number(tokenJson.expires_in);
    const accessTokenExpiresAt =
      Number.isFinite(expiresIn) && expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000) : null;

    const user = await fetchTwitterUser(tokenJson.access_token);

    await upsertTwitterAuth(developerId, {
      twitterUserId: user.id,
      twitterUsername: user.username ?? null,
      accessTokenPlain: tokenJson.access_token,
      refreshTokenPlain: tokenJson.refresh_token ?? null,
      accessTokenExpiresAt,
    });

    await prisma.developerSocialIntegration.upsert({
      where: {
        developerId_platform: { developerId, platform: "TWITTER" },
      },
      create: {
        developerId,
        platform: "TWITTER",
        enabled: true,
      },
      update: { enabled: true },
    });

    return res.redirect(302, "/dashboard?twitter=connected");
  } catch (err) {
    console.error("[twitter-oauth] callback", err);
    return fail(String(err?.message ?? err).slice(0, 120) || "exception");
  }
});

router.post("/auth/twitter/disconnect", async (req, res) => {
  try {
    if (!req.session?.user) {
      return res.status(401).json({ ok: false, error: "Login required" });
    }
    const { developer } = await resolveDeveloperFromSession(req);
    if (!developer?.id) {
      return res.status(404).json({ ok: false, error: "No developer" });
    }
    await deleteTwitterAuth(developer.id);
    await prisma.developerSocialIntegration.upsert({
      where: {
        developerId_platform: { developerId: developer.id, platform: "TWITTER" },
      },
      create: {
        developerId: developer.id,
        platform: "TWITTER",
        enabled: false,
      },
      update: { enabled: false },
    });
    return res.json({ ok: true });
  } catch (err) {
    console.error("[twitter-oauth] disconnect", err);
    return res.status(500).json({ ok: false, error: err?.message ?? String(err) });
  }
});

module.exports = router;
