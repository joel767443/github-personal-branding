const fs = require('fs');
const path = require('path');

/** Root folder for user uploads (e.g. LinkedIn export ZIPs). */
const UPLOADS_DIR = path.join(__dirname, '..', '..', 'uploads');

/** @deprecated Use linkedinExportZipPath(developerId) for per-developer uploads. */
const LINKEDIN_EXPORT_ZIP_NAME = "linkedin_export.zip";

function ensureUploadsDir() {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

function linkedinExportZipPath(developerId) {
  return path.join(UPLOADS_DIR, `linkedin_export_${developerId}.zip`);
}

module.exports = {
  UPLOADS_DIR,
  ensureUploadsDir,
  LINKEDIN_EXPORT_ZIP_NAME,
  linkedinExportZipPath,
};
