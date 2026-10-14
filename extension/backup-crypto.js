// Versioned local backup encryption using the browser's built-in Web Crypto.
// Never persist the password, derived key, or decrypted payload.
export const ENCRYPTED_BACKUP_KIND = "hotswap-for-claude-encrypted-backup";
export const MIN_BACKUP_PASSWORD_LENGTH = 4;
export const MAX_BACKUP_FILE_BYTES = 16 * 1024 * 1024;
const MAX_PAYLOAD_BYTES = 10 * 1024 * 1024;
const ITERATIONS = 600000;
const AAD = new TextEncoder().encode("hotswap-for-claude-encrypted-backup:v1");

export function validateBackupPassword(password) {
  if (typeof password !== "string" || [...password].length < MIN_BACKUP_PASSWORD_LENGTH) {
    throw new Error(`Use a backup password with at least ${MIN_BACKUP_PASSWORD_LENGTH} characters.`);
  }
  if (password.length > 1024) throw new Error("Backup password is too long (maximum 1024 characters).");
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
      (expectedLength && value.length !== Math.ceil(expectedLength / 3) * 4)) {
    throw new Error("Invalid encrypted backup data.");
  }
  let bytes;
  try {
    bytes = Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
  } catch {
    throw new Error("Invalid encrypted backup data.");
  }
  if ((expectedLength && bytes.length !== expectedLength) || encodeBase64(bytes) !== value) {
    throw new Error("Invalid encrypted backup data.");
  }
  return bytes;
}

async function deriveKey(password, salt, usage) {
  const material = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: ITERATIONS },
    material, { name: "AES-GCM", length: 256 }, false, [usage]
  );
}

export async function encryptBackup(payload, password) {
  validateBackupPassword(password);
  if (payload?.kind !== "hotswap-for-claude-backup" || !Array.isArray(payload.profiles)) {
    throw new Error("This doesn't look like a valid HotSwap for Claude backup file.");
  }
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  if (plaintext.byteLength > MAX_PAYLOAD_BYTES) throw new Error("Backup is too large to encrypt (maximum 10 MB).");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  try {
    const key = await deriveKey(password, salt, "encrypt");
    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, tagLength: 128, additionalData: AAD }, key, plaintext
    );
    return {
      kind: ENCRYPTED_BACKUP_KIND,
      version: 1,
      kdf: { name: "PBKDF2", hash: "SHA-256", iterations: ITERATIONS, salt: encodeBase64(salt) },
      cipher: { name: "AES-GCM", iv: encodeBase64(iv), tagLength: 128 },
      ciphertext: encodeBase64(new Uint8Array(encrypted)),
    };
  } finally {
    plaintext.fill(0);
  }
}

export async function decryptBackup(envelope, password) {
  // Pin supported parameters before key derivation: untrusted files cannot
  // request excessive PBKDF2 work or silently weaken the cipher settings.
  if (envelope?.kind !== ENCRYPTED_BACKUP_KIND || envelope.version !== 1 ||
      envelope.kdf?.name !== "PBKDF2" || envelope.kdf.hash !== "SHA-256" ||
      envelope.kdf.iterations !== ITERATIONS || envelope.cipher?.name !== "AES-GCM" ||
      envelope.cipher.tagLength !== 128) {
    throw new Error("Unsupported or invalid encrypted backup format.");
  }
  if (typeof password !== "string" || !password.length) throw new Error("Enter the password for this backup.");
  if (password.length > 1024) throw new Error("Backup password is too long (maximum 1024 characters).");
  const salt = decodeBase64(envelope.kdf.salt, 16);
  const iv = decodeBase64(envelope.cipher.iv, 12);
  const ciphertext = decodeBase64(envelope.ciphertext);
  if (ciphertext.byteLength < 16 || ciphertext.byteLength > MAX_PAYLOAD_BYTES + 16) {
    throw new Error("Invalid encrypted backup size.");
  }
  let plaintext;
  try {
    const key = await deriveKey(password, salt, "decrypt");
    plaintext = new Uint8Array(await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, tagLength: 128, additionalData: AAD }, key, ciphertext
    ));
    const payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext));
    if (payload?.kind !== "hotswap-for-claude-backup" || !Array.isArray(payload.profiles)) throw new Error();
    return payload;
  } catch {
    throw new Error("Could not unlock backup. Check the password and file.");
  } finally {
    plaintext?.fill(0);
  }
}
