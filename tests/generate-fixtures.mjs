// legacy-original.mjs is byte-for-byte `git show 157c59a:extension/backup-crypto.js`.
// Synthetic data and public throwaway passwords ONLY. Never regenerate from a user backup.
import { writeFile } from 'node:fs/promises';
import { encryptBackup } from './legacy-original.mjs';
import { payload } from './helpers.mjs';
for (const [name, password, size] of [['ascii', 'fake', 1024], ['unicode-nfd', 'cafe\u0301-fake', 0], ['spaces', '  fake secret  ', 4096]]) {
  await writeFile(new URL(`fixtures/v1-${name}.json`, import.meta.url), JSON.stringify({ password, payload: payload(size), envelope: await encryptBackup(payload(size), password) }, null, 2) + '\n');
}
console.log('Generated 3 synthetic v1 fixtures using the unmodified original encryptor.');
