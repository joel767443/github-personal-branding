const crypto = require("crypto");
const prisma = require("../db/prisma");
const {
  resolveGithubOAuthAppCredentials,
  resolveGithubOAuthClientSecretFromEnv,
} = require("../services/githubOauthAppCredentials");
const { encryptField } = require("../crypto/fieldEncryption");
const { mergedEnv } = require("../config/runtimeConfig");
const { respondError } = require("../utils/httpErrors");
const { clientSafeMessage, githubOAuthTokenErrorForClient } = require("../utils/safeClientError");
const {
  resolveFacebookOAuthRedirectUri,
  facebookGraphApiVersion,
  resolveFacebookOAuthScopes,
} = require("../services/facebookOAuth");

class AuthController {
  async githubLogin(req, res) {
    try {
      req.session.oauthDeveloperId = req.session?.user?.developerId ?? null;
      const creds = await resolveGithubOAuthAppCredentials(req);
      if (!creds.clientId) {
        return res.redirect(302, "https://github.com/login/oauth/authorize");
      }

      const state = crypto.randomBytes(16).toString("hex");
      req.session.oauthState = state;
      req.session.oauthGithubRedirectUri = creds.callbackUrl;
      const url = new URL("https://github.com/login/oauth/authorize");
      url.searchParams.set("client_id", creds.clientId);
      url.searchParams.set("redirect_uri", creds.callbackUrl);
      url.searchParams.set("scope", "read:user user:email");
      url.searchParams.set("state", state);

      await new Promise((resolve, reject) => {
        req.session.save((err) => (err ? reject(err) : resolve()));
      });
      res.redirect(url.toString());
    } catch (err) {
      respondError(res, 500, "OAuth start failed", clientSafeMessage(err, "OAuth start failed"));
    }
  }

  async githubCallback(req, res) {
    try {
      const { code, state } = req.query;
      if (!code || !state || state !== req.session.oauthState) {
        const details = process.env.NODE_ENV === "production"
          ? "State mismatch or missing code"
          : "State mismatch or missing code. Check SESSION_COOKIE_SECURE and same browser tab.";
        return respondError(res, 400, "Invalid OAuth state", details);
      }

      const creds = await resolveGithubOAuthAppCredentials(req);
      const redirectUri = req.session.oauthGithubRedirectUri ?? creds.callbackUrl;

      const tokenResp = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: creds.clientId,
          client_secret: creds.clientSecret,
          code: String(code),
          redirect_uri: redirectUri,
          state: String(state),
        }),
      });

      const tokenJson = await tokenResp.json();
      const accessToken = tokenJson.access_token;
      if (!accessToken) {
        return respondError(res, 400, "OAuth token exchange failed", githubOAuthTokenErrorForClient(tokenJson));
      }

      const userResp = await fetch("https://api.github.com/user", {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/vnd.github+json" },
      });
      const userJson = await userResp.json();

      const emailsResp = await fetch("https://api.github.com/user/emails", {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/vnd.github+json" },
      });
      const emailsJson = await emailsResp.json().catch(() => []);
      const email = emailsJson?.find(e => e?.primary && e?.verified)?.email;

      if (!email) return respondError(res, 400, "No email", "GitHub did not return a verified primary email. Please check your GitHub email settings.");

      let developer = await prisma.developer.findUnique({ where: { githubLogin: userJson.login } });
      if (!developer) {
        developer = await prisma.developer.findUnique({ where: { email } });
      }

      const nameParts = (userJson.name || "").split(" ").filter(Boolean);
      const firstName = nameParts[0] ?? userJson.login;
      const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : null;

      if (!developer) {
        developer = await prisma.developer.create({
          data: {
            email, firstName, lastName,
            profilePic: userJson.avatar_url,
            githubLogin: userJson.login,
            githubUsername: userJson.login,
            subscriptionStatus: "trialing",
          },
        });
        await prisma.developerSocialIntegration.createMany({
          data: ["FACEBOOK", "TWITTER", "LINKEDIN"].map(platform => ({ developerId: developer.id, platform, enabled: false })),
          skipDuplicates: true,
        });
      } else {
        await prisma.developer.update({
          where: { id: developer.id },
          data: {
            githubLogin: userJson.login,
            githubUsername: userJson.login,
            profilePic: userJson.avatar_url,
            firstName: firstName || undefined,
            lastName: lastName || undefined,
          },
        });
      }

      // Sync server-level credentials if matched
      const m = mergedEnv();
      if (m.GITHUB_CLIENT_ID === creds.clientId) {
        const envSecret = resolveGithubOAuthClientSecretFromEnv(m);
        const existing = await prisma.developer.findUnique({ where: { id: developer.id }, select: { githubOauthClientId: true } });
        if (!existing?.githubOauthClientId && envSecret) {
          await prisma.developer.update({
            where: { id: developer.id },
            data: { githubOauthClientId: m.GITHUB_CLIENT_ID, githubOauthClientSecretEnc: encryptField(envSecret) },
          });
        }
      }

      req.session.user = { id: userJson.id, login: userJson.login, name: userJson.name, avatarUrl: userJson.avatar_url, email, developerId: developer.id };
      delete req.session.oauthState;
      delete req.session.oauthGithubRedirectUri;
      res.redirect("/dashboard");
    } catch (err) {
      respondError(res, 500, "OAuth callback failed", clientSafeMessage(err, "OAuth callback failed"));
    }
  }

  async facebookLogin(req, res) {
    try {
      const developerId = Number(req.session?.user?.developerId);
      if (!developerId) return res.redirect(302, "/?facebook=login_required");

      const appId = String(process.env.FACEBOOK_APP_ID ?? "").trim();
      const appSecret = String(process.env.FACEBOOK_APP_SECRET ?? "").trim();
      if (!appId || !appSecret) return res.redirect(302, "/dashboard?facebook_error=config");

      const state = crypto.randomBytes(16).toString("hex");
      const redirectUri = resolveFacebookOAuthRedirectUri(req);
      req.session.oauthFacebookState = state;
      req.session.oauthFacebookRedirectUri = redirectUri;

      await new Promise((resolve, reject) => {
        req.session.save((err) => (err ? reject(err) : resolve()));
      });

      const url = new URL(`https://www.facebook.com/${facebookGraphApiVersion()}/dialog/oauth`);
      url.searchParams.set("client_id", appId);
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("state", state);
      url.searchParams.set("scope", resolveFacebookOAuthScopes());
      res.redirect(302, url.toString());
    } catch (err) {
      respondError(res, 500, "Facebook OAuth start failed", err?.message);
    }
  }

  async facebookCallback(req, res) {
    const fail = (code) => res.redirect(302, `/dashboard?facebook_error=${encodeURIComponent(code)}`);
    try {
      const { code, state, error, error_description: errorDescription } = req.query;
      if (error) return fail(errorDescription ? `${error}: ${errorDescription}` : String(error));
      if (!code || !state || state !== req.session.oauthFacebookState) return fail("state_mismatch");

      const developerId = Number(req.session?.user?.developerId);
      if (!developerId) return fail("session_required");

      const appId = String(process.env.FACEBOOK_APP_ID ?? "").trim();
      const appSecret = String(process.env.FACEBOOK_APP_SECRET ?? "").trim();
      const redirectUri = req.session.oauthFacebookRedirectUri ?? resolveFacebookOAuthRedirectUri(req);
      const graphV = facebookGraphApiVersion();

      const tokenUrl = new URL(`https://graph.facebook.com/${graphV}/oauth/access_token`);
      tokenUrl.searchParams.set("client_id", appId);
      tokenUrl.searchParams.set("client_secret", appSecret);
      tokenUrl.searchParams.set("redirect_uri", redirectUri);
      tokenUrl.searchParams.set("code", String(code));

      const tokenResp = await fetch(tokenUrl.toString());
      const tokenJson = await tokenResp.json();
      let userAccessToken = tokenJson.access_token;
      if (!userAccessToken) return fail(tokenJson.error?.message || "token_exchange_failed");

      // Exchange for long-lived token
      const llUrl = new URL(`https://graph.facebook.com/${graphV}/oauth/access_token`);
      llUrl.searchParams.set("grant_type", "fb_exchange_token");
      llUrl.searchParams.set("client_id", appId);
      llUrl.searchParams.set("client_secret", appSecret);
      llUrl.searchParams.set("fb_exchange_token", userAccessToken);
      const llResp = await fetch(llUrl.toString());
      const llJson = await llResp.json();
      if (llJson.access_token) userAccessToken = llJson.access_token;

      // Get Page token
      const accountsUrl = `https://graph.facebook.com/${graphV}/me/accounts?fields=id,name,access_token,tasks&access_token=${userAccessToken}`;
      const accResp = await fetch(accountsUrl);
      const accJson = await accResp.json();
      const pages = accJson.data || [];
      const hasManage = (tasks) => tasks?.some(t => ["MANAGE", "CREATE_CONTENT", "MODERATE"].includes(t));
      const pickPage = pages.find(p => p.access_token && hasManage(p.tasks)) || pages.find(p => p.access_token);

      if (!pickPage) return fail("no_manageable_pages");

      await prisma.developerFacebookAuthData.upsert({
        where: { developerId },
        create: { developerId, facebookPageId: pickPage.id, pageAccessTokenEnc: encryptField(pickPage.access_token) },
        update: { facebookPageId: pickPage.id, pageAccessTokenEnc: encryptField(pickPage.access_token) },
      });

      await prisma.developerSocialIntegration.upsert({
        where: { developerId_platform: { developerId, platform: "FACEBOOK" } },
        create: { developerId, platform: "FACEBOOK", enabled: true },
        update: { enabled: true },
      });

      res.redirect(302, "/dashboard?facebook=connected");
    } catch (err) {
      fail(err.message);
    }
  }

  logout(req, res) {
    req.session.destroy(() => res.redirect("/"));
  }
}

module.exports = new AuthController();
