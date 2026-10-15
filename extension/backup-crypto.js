// Versioned local encryption using WebCrypto only; no cached key or remote code.
import { MAX_BACKUP_FILE_BYTES, MAX_PAYLOAD_BYTES, BACKUP_ERROR, UNSUPPORTED_VERSION_ERROR,
  invalidBackup, objectKeys, parseBackupJSON, validateBackupPayload } from "./backup-schema.js";
export { MAX_BACKUP_FILE_BYTES } from "./backup-schema.js";
export const ENCRYPTED_BACKUP_KIND = "hotswap-for-claude-encrypted-backup";
export const MIN_BACKUP_PASSWORD_LENGTH = 12;
export const BACKUP_ITERATIONS = 600000;
const V1_ITERATIONS = new Set([600000]); // All shipped backup values in available git history.
const LEGACY_AAD = new TextEncoder().encode("hotswap-for-claude-encrypted-backup:v1");

function validateImportPassword(password) {
  if (typeof password !== "string" || !password.length || password.length > 1024) invalidBackup();
}

export function validateBackupPassword(password) {
  if (typeof password !== "string" || [...password].length < MIN_BACKUP_PASSWORD_LENGTH) {
    throw new Error(`Use a backup password with at least ${MIN_BACKUP_PASSWORD_LENGTH} characters.`);
  }
  if (password.length > 1024) throw new Error("Backup password is too long (maximum 1024 characters).");
}

export function backupPasswordWarning(password) {
  const normalized = password.normalize("NFKC").toLowerCase();
  if (/(password|qwerty|letmein|123456|hotswap|claude)/.test(normalized) ||
      new Set(normalized).size < 6 || [...normalized].length < 16) {
    return "This password may be easy to guess. Prefer a long, unique passphrase; common words and patterns weaken protection.";
  }
  return "Use a unique passphrase. This simple warning cannot measure password strength.";
}

function encodeBase64(bytes) {
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += 32768) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 32768)));
  }
  return btoa(chunks.join(""));
}

function decodeBase64(value, expectedLength) {
  if (typeof value !== "string" || value.length > MAX_BACKUP_FILE_BYTES ||
      (expectedLength && value.length !== Math.ceil(expectedLength / 3) * 4)) invalidBackup();
  let bytes;
  try { bytes = Uint8Array.from(atob(value), char => char.charCodeAt(0)); } catch { invalidBackup(); }
  if ((expectedLength && bytes.length !== expectedLength) || encodeBase64(bytes) !== value) invalidBackup();
  return bytes;
}

export function validateBackupEnvelope(envelope) {
  objectKeys(envelope, ["kind", "version", "kdf", "cipher", "ciphertext"], ["kind", "version", "kdf", "cipher", "ciphertext"]);
  if (envelope.kind !== ENCRYPTED_BACKUP_KIND || !Number.isInteger(envelope.version)) invalidBackup();
  if (![1, 2].includes(envelope.version)) throw new Error(UNSUPPORTED_VERSION_ERROR);
  objectKeys(envelope.kdf, ["name", "hash", "iterations", "salt"], ["name", "hash", "iterations", "salt"]);
  const cipherKeys = envelope.version === 1 ? ["name", "iv", "tagLength"] : ["name", "keyLength", "iv", "tagLength"];
  objectKeys(envelope.cipher, cipherKeys, cipherKeys);
  const { kdf, cipher, version } = envelope;
  if (kdf.name !== "PBKDF2" || kdf.hash !== "SHA-256" || !Number.isInteger(kdf.iterations) ||
      kdf.iterations < 100000 || kdf.iterations > 5000000 ||
      (version === 1 && !V1_ITERATIONS.has(kdf.iterations)) ||
      (version === 2 && kdf.iterations < BACKUP_ITERATIONS) ||
      cipher.name !== "AES-GCM" || cipher.tagLength !== 128 ||
      (version === 2 && cipher.keyLength !== 256)) invalidBackup();
  const salt = decodeBase64(kdf.salt, 16);
  const iv = decodeBase64(cipher.iv, 12);
  const ciphertext = decodeBase64(envelope.ciphertext);
  if (ciphertext.length < 17 || ciphertext.length > MAX_PAYLOAD_BYTES + 16) invalidBackup();
  return { version, iterations: kdf.iterations, salt, iv, ciphertext };
}

// UTF-8, ASCII '|', decimal integers, canonical base64, no trailing separator.
// Only validated/decoded header values (or export constants) reach this function.
function headerAAD({ version, iterations, salt, iv }) {
  return new TextEncoder().encode([
    ENCRYPTED_BACKUP_KIND, version, "PBKDF2", "SHA-256", iterations,
    encodeBase64(salt), "AES-GCM", 256, encodeBase64(iv), 128,
  ].join("|"));
}

async function deriveKey(password, header, usage) {
  const bytes = new TextEncoder().encode(header.version === 1 ? password : password.normalize("NFKC"));
  try {
    const material = await crypto.subtle.importKey("raw", bytes, "PBKDF2", false, ["deriveKey"]);
    return await crypto.subtle.deriveKey(
      { name: "PBKDF2", hash: "SHA-256", salt: header.salt, iterations: header.iterations },
      material, { name: "AES-GCM", length: 256 }, false, [usage]
    );
  } finally { bytes.fill(0); }
}

export async function encryptBackup(payload, password) {
  validateBackupPassword(password);
  validateBackupPayload(payload);
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  try {
    const header = { version: 2, iterations: BACKUP_ITERATIONS,
      salt: crypto.getRandomValues(new Uint8Array(16)), iv: crypto.getRandomValues(new Uint8Array(12)) };
    const key = await deriveKey(password, header, "encrypt");
    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: header.iv, tagLength: 128, additionalData: headerAAD(header) }, key, plaintext
    );
    return {
      kind: ENCRYPTED_BACKUP_KIND, version: 2,
      kdf: { name: "PBKDF2", hash: "SHA-256", iterations: header.iterations, salt: encodeBase64(header.salt) },
      cipher: { name: "AES-GCM", keyLength: 256, iv: encodeBase64(header.iv), tagLength: 128 },
      ciphertext: encodeBase64(new Uint8Array(encrypted)),
    };
  } finally { plaintext.fill(0); }
}

export async function decryptBackup(envelope, password) {
  // All structure/cost bounds precede WebCrypto calls, including importKey.
  const header = validateBackupEnvelope(envelope);
  validateImportPassword(password);
  let plaintext;
  try {
    const key = await deriveKey(password, header, "decrypt");
    plaintext = new Uint8Array(await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: header.iv, tagLength: 128,
        additionalData: header.version === 1 ? LEGACY_AAD : headerAAD(header) }, key, header.ciphertext
    ));
    return validateBackupPayload(parseBackupJSON(new TextDecoder("utf-8", { fatal: true }).decode(plaintext), MAX_PAYLOAD_BYTES));
  } catch { throw new Error(BACKUP_ERROR); }
  finally { plaintext?.fill(0); }
}
