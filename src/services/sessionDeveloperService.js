const prisma = require("../db/prisma");

function resolveSessionEmail(req) {
  const login = req.session?.user?.login;
  const emailFromSession = req.session?.user?.email;
  const emailFallback = login ? `${login}@users.noreply.github.com` : null;
  return {
    login,
    email: emailFromSession ?? emailFallback,
  };
}

async function resolveDeveloperFromSession(req) {
  const { login, email } = resolveSessionEmail(req);
  if (!email) return { login, email: null, developer: null };
  const developer = await prisma.developer.findUnique({
    where: { email },
    select: { id: true, email: true },
  });
  return { login, email, developer };
}

module.exports = {
  resolveSessionEmail,
  resolveDeveloperFromSession,
};
