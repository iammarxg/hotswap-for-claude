// Strict, bounded backup data validation. No browser writes or logging here.
export const MAX_BACKUP_FILE_BYTES = 16 * 1024 * 1024;
export const MAX_PAYLOAD_BYTES = 10 * 1024 * 1024;
export const BACKUP_ERROR = "Couldn't decrypt: wrong password, or the file is damaged or modified.";
export const UNSUPPORTED_VERSION_ERROR = "Unsupported or newer backup version. Update the extension.";

export function invalidBackup() { throw new Error(BACKUP_ERROR); }

export function objectKeys(value, allowed, required = []) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype ||
      Object.keys(value).some(key => !allowed.includes(key)) ||
      required.some(key => !Object.hasOwn(value, key))) invalidBackup();
}

// JSON.parse establishes JSON grammar. A separate lexical pass rejects duplicate
// keys (including escaped aliases) before any consumers see the parsed object.
export function parseBackupJSON(text, limit = MAX_BACKUP_FILE_BYTES) {
  if (typeof text !== "string" || text.length > limit || new TextEncoder().encode(text).length > limit) invalidBackup();
  let value;
  try { value = JSON.parse(text); } catch { invalidBackup(); }
  const stack = [];
  const tokens = /"(?:[^"\\]|\\.)*"|[{}\[\]:,]|[^\s{}\[\]:,"]+/g;
  for (const [token] of text.matchAll(tokens)) {
    if (token === "{" || token === "[") {
      if (stack.length >= 24) invalidBackup();
      stack.push({ keys: token === "{" ? new Set() : null, key: true });
    } else if (token === "}" || token === "]") stack.pop();
    else if (token === ",") { if (stack.at(-1)) stack.at(-1).key = true; }
    else if (token.startsWith('"') && stack.at(-1)?.keys && stack.at(-1).key) {
      const frame = stack.at(-1);
      const key = JSON.parse(token);
      if (frame.keys.has(key)) invalidBackup();
      frame.keys.add(key);
      frame.key = false;
    }
  }
  objectKeys(value, Object.keys(value || {}));
  return value;
}

export async function readBackupFile(file) {
  // Never call text() for an oversized File.
  if (!file || !Number.isSafeInteger(file.size) || file.size < 0 || file.size > MAX_BACKUP_FILE_BYTES) invalidBackup();
  try { return parseBackupJSON(await file.text()); } catch { invalidBackup(); }
}

function string(value, max, min = 0) {
  if (typeof value !== "string" || value.length < min || value.length > max) invalidBackup();
}
function number(value, max = 8640000000000000, min = 0) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) invalidBackup();
}
function optional(value, key, check) { if (Object.hasOwn(value, key)) check(value[key]); }
function nullable(check) { return value => { if (value !== null) check(value); }; }
function boolean(value) { if (typeof value !== "boolean") invalidBackup(); }

function cookie(value) {
  objectKeys(value, ["name", "value", "domain", "path", "secure", "httpOnly", "sameSite", "session", "hostOnly", "expirationDate", "storeId", "firstPartyDomain", "partitionKey"], ["name", "value", "domain", "path"]);
  string(value.name, 256);
  // All names are captured by getAllClaudeCookies; do not invent a fixed auth-name list.
  if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]*$/.test(value.name)) invalidBackup();
  string(value.value, 65536);
  if (/[\x00-\x1f\x7f]/.test(value.value)) invalidBackup();
  string(value.domain, 253, 1);
  if (!/^\.?([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*claude\.ai$/.test(value.domain)) invalidBackup();
  string(value.path, 4096, 1);
  if (!value.path.startsWith("/") || /[\x00-\x1f\x7f]/.test(value.path)) invalidBackup();
  for (const key of ["secure", "httpOnly", "session", "hostOnly"]) optional(value, key, boolean);
  optional(value, "expirationDate", v => number(v, 8640000000000, -8640000000000));
  optional(value, "storeId", v => string(v, 256));
  optional(value, "firstPartyDomain", v => string(v, 253));
  optional(value, "sameSite", v => { if (!["no_restriction", "lax", "strict", "unspecified"].includes(v)) invalidBackup(); });
  optional(value, "partitionKey", v => {
    objectKeys(v, ["topLevelSite", "hasCrossSiteAncestor"], ["topLevelSite"]);
    string(v.topLevelSite, 2048, 1);
    optional(v, "hasCrossSiteAncestor", boolean);
  });
}

function usage(value) {
  objectKeys(value, ["limits", "subscriptionTier", "capturedAt"], ["limits"]);
  optional(value, "subscriptionTier", v => string(v, 128));
  optional(value, "capturedAt", number);
  objectKeys(value.limits, ["session", "weekly", "sonnetWeekly", "opusWeekly", "fableWeekly"]);
  for (const limit of Object.values(value.limits)) {
    if (limit === null) continue;
    objectKeys(limit, ["percentage", "resetsAt"], ["percentage", "resetsAt"]);
    number(limit.percentage, 1000000);
    nullable(number)(limit.resetsAt);
  }
}

export function validateBackupPayload(payload) {
  objectKeys(payload, ["kind", "exportedAt", "extensionVersion", "profiles"], ["kind", "profiles"]);
  if (payload.kind !== "hotswap-for-claude-backup" || !Array.isArray(payload.profiles) || payload.profiles.length > 1000) invalidBackup();
  optional(payload, "exportedAt", v => string(v, 64));
  optional(payload, "extensionVersion", v => string(v, 64));
  for (const profile of payload.profiles) {
    objectKeys(profile, ["id", "label", "email", "usage", "cookies", "createdAt", "updatedAt", "pinned"], ["cookies"]);
    optional(profile, "id", v => string(v, 256));
    optional(profile, "label", v => string(v, 4096));
    optional(profile, "email", nullable(v => string(v, 1024)));
    optional(profile, "usage", nullable(usage));
    optional(profile, "createdAt", number);
    optional(profile, "updatedAt", number);
    optional(profile, "pinned", boolean);
    if (!Array.isArray(profile.cookies) || profile.cookies.length > 1000) invalidBackup();
    profile.cookies.forEach(cookie);
  }
  if (new TextEncoder().encode(JSON.stringify(payload)).length > MAX_PAYLOAD_BYTES) invalidBackup();
  return payload;
}
