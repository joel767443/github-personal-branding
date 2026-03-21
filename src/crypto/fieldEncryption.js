const crypto = require('crypto');

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const KEY_LEN = 32;
const VERSION = 1;

function getMasterKey() {
  const raw = process.env.ENCRYPTION_MASTER_KEY;
  if (!raw || !String(raw).trim()) {
    return null;
  }
  const buf = Buffer.from(String(raw).trim(), 'base64');
  if (buf.length !== KEY_LEN) {
    throw new Error(`ENCRYPTION_MASTER_KEY must decode to ${KEY_LEN} bytes (got ${buf.length})`);
  }
  return buf;
}

/**
 * @param {string} plain
 * @returns {string} Single-line payload: v1:base64(iv):base64(ciphertext+authTag)
 */
function encryptField(plain) {
  if (plain == null) return null;
  const text = String(plain);
  if (!text) return null;
  const key = getMasterKey();
  if (!key) {
    return `devplain:${Buffer.from(text, 'utf8').toString('base64')}`;
  }
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv, { authTagLength: 16 });
  const enc = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const combined = Buffer.concat([enc, tag]);
  return `${VERSION}:${iv.toString('base64')}:${combined.toString('base64')}`;
}

/**
 * @param {string|null|undefined} payload
 * @returns {string|null}
 */
function decryptField(payload) {
  if (payload == null || payload === '') return null;
  const s = String(payload);
  if (s.startsWith('devplain:')) {
    return Buffer.from(s.slice('devplain:'.length), 'base64').toString('utf8');
  }
  const parts = s.split(':');
  if (parts.length !== 3 || parts[0] !== String(VERSION)) {
    throw new Error('Invalid encrypted field format');
  }
  const iv = Buffer.from(parts[1], 'base64');
  const combined = Buffer.from(parts[2], 'base64');
  const tag = combined.subarray(combined.length - 16);
  const enc = combined.subarray(0, combined.length - 16);
  const key = getMasterKey();
  if (!key) {
    throw new Error('ENCRYPTION_MASTER_KEY is required to decrypt this field');
  }
  const decipher = crypto.createDecipheriv(ALGO, key, iv, { authTagLength: 16 });
  decipher.setAuthTag(tag);
  const out = Buffer.concat([decipher.update(enc), decipher.final()]);
  return out.toString('utf8');
}

module.exports = {
  encryptField,
  decryptField,
};
