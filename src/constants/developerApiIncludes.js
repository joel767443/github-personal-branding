const { commitApiOmit, endorsementApiOmit } = require("./apiResponseOmit");

const developerIdentitySelect = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  mobileNumber: true,
  headline: true,
  summary: true,
  linkedinSummary: true,
};

const developerDetailInclude = {
  repos: {
    include: {
      commits: { omit: commitApiOmit },
      languages: true,
      repoTechStacks: { orderBy: { score: "desc" } },
    },
  },
  developerTechStack: true,
  developerArchitectures: {
    include: {
      architecture: true,
    },
  },
  certifications: { orderBy: { sortOrder: "asc" } },
  developerExperiences: { orderBy: { sortOrder: "asc" } },
  educations: { orderBy: { sortOrder: "asc" } },
  projects: {
    orderBy: { sortOrder: "asc" },
    include: {
      projectLanguages: { include: { language: true } },
    },
  },
  developerLinkedinSkills: { orderBy: { sortOrder: "asc" } },
  developerLinkedinReceivedEndorsements: {
    orderBy: { sortOrder: "asc" },
    omit: endorsementApiOmit,
  },
  developerRecommendations: { orderBy: { sortOrder: "asc" } },
  developerPublications: { orderBy: { sortOrder: "asc" } },
};

const developerIntelligenceInclude = {
  developerTechStack: true,
  developerArchitectures: {
    include: {
      architecture: true,
    },
  },
};

module.exports = {
  developerIdentitySelect,
  developerDetailInclude,
  developerIntelligenceInclude,
};
