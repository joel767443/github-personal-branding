const prisma = require("../db/prisma");

function resolveSessionEmail(req) {
  return {
    login: req.session?.user?.login,
    email: req.session?.user?.email,
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
