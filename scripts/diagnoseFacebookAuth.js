#!/usr/bin/env node
/**
 * Print DB + env state for Facebook Page connect / sampleFacebookPost debugging.
 *
 *   node scripts/diagnoseFacebookAuth.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const prisma = require('../src/db/prisma');

function mask(s) {
  const t = String(s ?? '').trim();
  if (!t) return '(unset)';
  if (t.length <= 8) return '***';
  return `${t.slice(0, 4)}…${t.slice(-4)}`;
}

async function main() {
  const port = String(process.env.PORT ?? '').trim() || '80';
  const explicitCallback = String(process.env.FACEBOOK_OAUTH_CALLBACK_URL ?? '').trim();
  const appId = String(process.env.FACEBOOK_APP_ID ?? '').trim();
  const hasSecret = Boolean(String(process.env.FACEBOOK_APP_SECRET ?? '').trim());

  console.log('--- Env (Facebook) ---');
  console.log('FACEBOOK_APP_ID:', mask(appId), appId ? '' : '← required for OAuth');
  console.log('FACEBOOK_APP_SECRET:', hasSecret ? '(set)' : '(unset) ← required');
  console.log(
    'FACEBOOK_OAUTH_CALLBACK_URL:',
    explicitCallback || `(derived) http://localhost:${port}/auth/facebook/callback when testing locally`,
  );
  console.log('PORT:', port);
  console.log(
    'SESSION_COOKIE_SECURE:',
    String(process.env.SESSION_COOKIE_SECURE ?? '(unset)'),
    '— if http://localhost and OAuth loses session (facebook_error=state), set SESSION_COOKIE_SECURE=false',
  );

  const [devs, fbRows] = await Promise.all([
    prisma.developer.findMany({
      select: { id: true, email: true, userId: true },
      orderBy: { id: 'asc' },
    }),
    prisma.developerFacebookAuthData.findMany({
      select: { developerId: true, facebookPageId: true },
    }),
  ]);

  console.log('\n--- Database ---');
  console.log('developers:', devs.length);
  for (const d of devs) {
    console.log(`  id=${d.id} email=${d.email} userId=${d.userId ?? '(null)'}`);
  }
  console.log('developer_facebook_auth_data rows:', fbRows.length);
  for (const r of fbRows) {
    console.log(`  developerId=${r.developerId} pageId=${r.facebookPageId}`);
  }

  console.log('\n--- How connect works in this app ---');
  console.log(
    '1) session.user.developerId is set ONLY after a successful GitHub OAuth callback (/auth/github/callback).',
  );
  console.log('   Sign in with GitHub in the browser first — not just opening the home page.');
  console.log(`2) Then open: http://localhost:${port}/auth/facebook (with the server running).`);
  console.log('3) Success redirect: /dashboard?facebook=connected');
  console.log('   Failure: /dashboard?facebook_error=… (no_pages, session, config, state, etc.)\n');

  if (fbRows.length === 0) {
    const base = `http://localhost:${port}`;
    console.log('--- Next steps (no Page token in DB yet) ---');
    console.log(
      'If you use http:// (not https), add SESSION_COOKIE_SECURE=false to .env and restart the server (fixes facebook_error=state).',
    );
    console.log(`1) ${base}/auth/github  — sign in with GitHub (required so session has developerId).`);
    console.log(`2) ${base}/auth/facebook  — connect a Facebook Page you admin.`);
    console.log(`3) Expect redirect to ${base}/dashboard?facebook=connected`);
    console.log('4) Then post: DEVELOPER_ID=1 SAMPLE_POST_DIRECT=1 node scripts/sampleFacebookPost.js\n');
  }
}

main()
  .then(async () => {
    await prisma.$disconnect().catch(() => {});
    process.exit(0);
  })
  .catch(async (e) => {
    console.error(e?.message ?? e);
    await prisma.$disconnect().catch(() => {});
    process.exit(1);
  });
