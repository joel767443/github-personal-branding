/**
 * Neutral DTOs for import sources (LinkedIn export, future CV, etc.).
 * Persistence maps these to Prisma; sources map raw data to these shapes.
 */

/**
 * Which CSV sections were present in the source (drives progress messages even when empty).
 * @typedef {Object} ResumeImportFilePresence
 * @property {boolean} [profile]
 * @property {boolean} [positions]
 * @property {boolean} [education]
 * @property {boolean} [certifications]
 * @property {boolean} [skills]
 * @property {boolean} [projects]
 * @property {boolean} [recommendations]
 * @property {boolean} [publications]
 */

/**
 * @typedef {Object} ResumeProfilePatch
 * @property {string} [linkedinSummary]
 * @property {boolean} [csvRowPresent] First row existed in profile CSV (for import stats)
 */

/**
 * @typedef {Object} ResumeExperienceInput
 * @property {string|null} [title]
 * @property {string|null} [company]
 * @property {string|null} [dates]
 * @property {string|null} [location]
 * @property {string|null} [description]
 * @property {number} sortOrder
 */

/**
 * @typedef {Object} ResumeEducationInput
 * @property {string|null} [degree]
 * @property {string|null} [institution]
 * @property {string|null} [dates]
 * @property {string|null} [location]
 * @property {number} sortOrder
 */

/**
 * @typedef {Object} ResumeCertificationInput
 * @property {string|null} [name]
 * @property {string|null} [issuer]
 * @property {string|null} [issued]
 * @property {number} sortOrder
 */

/**
 * @typedef {Object} ResumeSkillInput
 * @property {string} name
 * @property {number} sortOrder
 */

/**
 * @typedef {Object} ResumeEndorsementInput
 * @property {string|null} [skillName]
 * @property {string|null} [endorserFirstName]
 * @property {string|null} [endorserLastName]
 * @property {string|null} [endorserCompany]
 * @property {string|null} [endorserJobTitle]
 * @property {string|null} [endorsedOn]
 * @property {number} sortOrder
 */

/**
 * @typedef {Object} ResumeEndorsementsSection
 * @property {boolean} fileMissing When true, CSV was not found (warn differs from empty file).
 * @property {string} [fileBasename] For empty-file warning.
 * @property {ResumeEndorsementInput[]} rows
 */

/**
 * @typedef {Object} ResumeProjectInput
 * @property {string|null} [title]
 * @property {string|null} [description]
 * @property {string|null} [url]
 * @property {string|null} [dates]
 * @property {string} [source]
 * @property {number} sortOrder
 */

/**
 * @typedef {Object} ResumeRecommendationInput
 * @property {string|null} [recommenderFirstName]
 * @property {string|null} [recommenderLastName]
 * @property {string|null} [company]
 * @property {string|null} [jobTitle]
 * @property {string|null} [text]
 * @property {string|null} [date]
 * @property {number} sortOrder
 */

/**
 * @typedef {Object} ResumePublicationInput
 * @property {string|null} [title]
 * @property {string|null} [publisher]
 * @property {string|null} [date]
 * @property {string|null} [url]
 * @property {string|null} [description]
 * @property {number} sortOrder
 */

/**
 * Full replace payload for resume-derived tables (one transaction).
 * @typedef {Object} ResumeImportSnapshot
 * @property {ResumeImportFilePresence} [filePresence]
 * @property {ResumeProfilePatch} [profile]
 * @property {ResumeExperienceInput[]} [experiences]
 * @property {ResumeEducationInput[]} [education]
 * @property {ResumeCertificationInput[]} [certifications]
 * @property {ResumeSkillInput[]} [skills]
 * @property {ResumeEndorsementsSection} [endorsements]
 * @property {ResumeProjectInput[]} [projects]
 * @property {ResumeRecommendationInput[]} [recommendations]
 * @property {ResumePublicationInput[]} [publications]
 */

/**
 * Git hosting sync (GitHub today; GitLab/Bitbucket later).
 */

/**
 * @typedef {Object} GithubDeveloperUpsertInput
 * @property {string} email
 * @property {string|null} [firstName]
 * @property {string|null} [lastName]
 * @property {string|null} [profilePic]
 * @property {string|null} [mobileNumber]
 * @property {string|null} [headline]
 * @property {string|null} [jobTitle]
 * @property {string|null} [summaryFromHost] Bio/summary from the host profile (used when no LinkedIn summary).
 * @property {boolean|null} [hireable]
 */

/**
 * @typedef {Object} GithubRepoUpsertInput
 * @property {string} id
 * @property {string} name
 * @property {string} fullName
 * @property {string} description
 * @property {boolean} private
 * @property {string} url
 * @property {Date} createdAt
 * @property {Date} updatedAt
 * @property {number} developerId
 */

/**
 * @typedef {Object} GithubRepoLanguageRowInput
 * @property {string} id
 * @property {string} name
 * @property {number} percentage
 * @property {bigint} [bytes]
 */

/**
 * @typedef {Object} GithubCommitInput
 * @property {string} id
 * @property {string} message
 * @property {string} author
 * @property {Date} date
 */

/**
 * Optional aggregate for a full Git host sync (e.g. batched jobs); current code syncs sequentially.
 * @typedef {Object} GithubSyncPayload
 * @property {GithubDeveloperUpsertInput} developer
 * @property {{ repo: GithubRepoUpsertInput, languages: GithubRepoLanguageRowInput[], commits: GithubCommitInput[] }[]} repos
 */

module.exports = {};
