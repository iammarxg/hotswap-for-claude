import { ENCRYPTED_BACKUP_KIND, decryptBackup } from "./backup-crypto.js";
import { MAX_BACKUP_FILE_BYTES, invalidBackup, validateBackupPayload } from "./backup-schema.js";

// A preview authorizes exactly one immutable, validated payload. Only labels and
// a random capability leave the worker; no decrypted cookies go back to the UI.
export function createBackupRestore({ getProfiles, saveProfiles }) {
  let pending = null;
  let expiry;
  let generation = 0;
  let committing = false;
  function cancel() {
    generation++;
    pending = null;
    clearTimeout(expiry);
  }
  return {
    cancel,
    async preview(envelope, password) {
      cancel();
      const current = generation;
      if (committing || new TextEncoder().encode(JSON.stringify(envelope)).length > MAX_BACKUP_FILE_BYTES) invalidBackup();
      const legacy = envelope?.kind !== ENCRYPTED_BACKUP_KIND || envelope.version === 1;
      const payload = envelope?.kind === ENCRYPTED_BACKUP_KIND ? await decryptBackup(envelope, password) : validateBackupPayload(envelope);
      if (current !== generation) invalidBackup();
      const token = crypto.randomUUID();
      pending = { payload: structuredClone(payload), token, expiresAt: Date.now() + 120000 };
      expiry = setTimeout(cancel, 120000);
      // Node test runs need not stay alive for a discarded preview.
      expiry.unref?.();
      return { token, legacy, labels: payload.profiles.map(p => (p.label || "Restored account").slice(0, 40)), count: payload.profiles.length };
    },
    async confirm(token) {
      if (committing || !pending || pending.token !== token || pending.expiresAt < Date.now()) invalidBackup();
      const { payload } = pending;
      cancel(); // Consume before any asynchronous write; replay cannot apply twice.
      committing = true;
      try {
        validateBackupPayload(payload);
        const profiles = { ...await getProfiles() };
        let imported = 0;
        let skipped = 0;
        for (const profile of payload.profiles) {
          if (!profile.cookies.length) { skipped++; continue; }
          const id = crypto.randomUUID();
          profiles[id] = { id, label: (profile.label || "Restored account").slice(0, 40), cookies: profile.cookies,
            createdAt: profile.createdAt ?? Date.now(), updatedAt: Date.now() };
          imported++;
        }
        // One storage item commit; never touch active cookies, settings or account
        // selection. Validation/preview/cancellation perform no storage writes.
        await saveProfiles(profiles);
        return { imported, skipped };
      } finally { committing = false; }
    },
  };
}
