// Background-only credential storage. The non-exportable key and ciphertext are
// committed atomically; a clear tombstone prevents legacy keys resurfacing after a crash.
const DATABASE = "hotswap-credentials";
const STORE = "secrets";
const RECORD = "gemini";
const LEGACY_KEY = "geminiApiKey";
const AAD = new TextEncoder().encode("hotswap:gemini:v1");
let pending = Promise.resolve();

function serialize(operation) {
  const result = pending.then(operation);
  pending = result.catch(() => {});
  return result;
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("Could not open secure API key storage."));
  });
}

async function recordTransaction(writeValue) {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const writing = writeValue !== undefined;
      let transaction;
      try {
        transaction = database.transaction(STORE, writing ? "readwrite" : "readonly", { durability: "strict" });
      } catch (error) {
        // Older browser engines do not support the durability options argument.
        if (!(error instanceof TypeError)) { reject(error); return; }
        transaction = database.transaction(STORE, writing ? "readwrite" : "readonly");
      }
      const store = transaction.objectStore(STORE);
      const request = writing ? store.put(writeValue, RECORD) : store.get(RECORD);
      transaction.oncomplete = () => resolve(writing ? undefined : request.result);
      transaction.onabort = () => reject(new Error("Could not save API key securely. Please try again."));
      transaction.onerror = () => {}; // onabort reports the transaction failure.
    });
  } finally {
    database.close();
  }
}

async function seal(value) {
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const bytes = new TextEncoder().encode(value);
  try {
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: AAD }, key, bytes);
    return { version: 1, key, iv, ciphertext };
  } finally {
    bytes.fill(0);
  }
}

async function unseal(record) {
  if (record.version !== 1) throw new Error("Unsupported secure API key format.");
  if (record.cleared === true) return "";
  let bytes;
  try {
    bytes = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: record.iv, additionalData: AAD }, record.key, record.ciphertext));
    return new TextDecoder().decode(bytes);
  } catch {
    throw new Error("Could not unlock the saved API key. Save it again in Settings.");
  } finally {
    bytes?.fill(0);
  }
}

async function readOrMigrate() {
  let record = await recordTransaction();
  if (record) {
    const value = await unseal(record);
    await chrome.storage.local.remove(LEGACY_KEY);
    return value;
  }
  const legacy = await chrome.storage.local.get(LEGACY_KEY);
  const value = typeof legacy[LEGACY_KEY] === "string" ? legacy[LEGACY_KEY].trim() : "";
  if (!value) return "";
  record = await seal(value);
  await recordTransaction(record);
  // Read back the durable record before retiring the old setting. An interrupted
  // cleanup retries automatically on the next worker start or credential operation.
  if (await unseal(await recordTransaction()) !== value) throw new Error("Could not verify secure API key storage.");
  await chrome.storage.local.remove(LEGACY_KEY);
  return value;
}

export function getGeminiApiKey() {
  return serialize(readOrMigrate);
}

export function getGeminiKeyStatus() {
  return serialize(async () => ({ configured: Boolean(await readOrMigrate()) }));
}

export function saveGeminiApiKey(value) {
  return serialize(async () => {
    if (typeof value !== "string" || !value.trim() || value.length > 4096) throw new Error("Paste a valid Gemini API key.");
    const record = await seal(value.trim());
    await recordTransaction(record);
    await chrome.storage.local.remove(LEGACY_KEY);
    return { configured: true };
  });
}

export function clearGeminiApiKey() {
  return serialize(async () => {
    await recordTransaction({ version: 1, cleared: true });
    await chrome.storage.local.remove(LEGACY_KEY);
    return { configured: false };
  });
}
