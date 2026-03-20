/**
 * Prisma `omit` shapes for HTTP responses (privacy — fields may still exist in DB).
 */

const commitApiOmit = {
  id: true,
  author: true,
  repoId: true,
};

const endorsementApiOmit = {
  endorserCompany: true,
  endorserJobTitle: true,
};

module.exports = {
  commitApiOmit,
  endorsementApiOmit,
};
