import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { encryptBackup, decryptBackup, validateBackupEnvelope, validateBackupPassword } from '../extension/backup-crypto.js';
import { BACKUP_ERROR, MAX_BACKUP_FILE_BYTES, parseBackupJSON, readBackupFile, validateBackupPayload } from '../extension/backup-schema.js';
import { encryptBackup as legacyEncrypt, decryptBackup as legacyDecrypt } from './legacy-original.mjs';
import { createBackupRestore } from '../extension/backup-restore.js';
import { payload, password } from './helpers.mjs';

const rejects = operation => assert.rejects(operation, { message: BACKUP_ERROR });
const flip = (value, index = 0) => { const bytes = Buffer.from(value, 'base64'); bytes[index < 0 ? bytes.length + index : index] ^= 1; return bytes.toString('base64'); };

test('original v1 committed fixtures decrypt, including short, NFD and spaced passwords', async () => {
  for (const name of await readdir(new URL('fixtures/', import.meta.url))) {
    const fixture = JSON.parse(await readFile(new URL(`fixtures/${name}`, import.meta.url), 'utf8'));
    assert.deepEqual(await decryptBackup(fixture.envelope, fixture.password), fixture.payload);
  }
});

test('v1 and v2 round trips: empty-ish, 1 KB, 1 MB; non-extractable AES-256 keys', async () => {
  for (const size of [0, 1024, 1024 * 1024]) {
    const data = payload(size);
    for (const encrypt of [legacyEncrypt, encryptBackup]) {
      const encrypted = await encrypt(data, password);
      assert.deepEqual(await decryptBackup(encrypted, password), data);
    }
  }
});

test('v2 normalizes NFKC while v1 retains exact UTF-8, spaces and Unicode encoding', async () => {
  const nfd = 'cafe\u0301 fullwidth \uff21';
  const nfc = nfd.normalize('NFC');
  const v2 = await encryptBackup(payload(), nfd);
  assert.deepEqual(await decryptBackup(v2, nfc), payload());
  assert.deepEqual(await decryptBackup(v2, nfd.normalize('NFKC')), payload());
  const v1 = await legacyEncrypt(payload(), nfd);
  await rejects(() => decryptBackup(v1, nfc));
  const spaced = await encryptBackup(payload(), ` ${password} `);
  await rejects(() => decryptBackup(spaced, password));
});

test('export 11/12/1024/1025 character boundaries; import allows short legacy passwords', async () => {
  assert.throws(() => validateBackupPassword('x'.repeat(11)));
  validateBackupPassword('x'.repeat(12));
  validateBackupPassword('x'.repeat(1024));
  assert.throws(() => validateBackupPassword('x'.repeat(1025)));
  const envelope = await encryptBackup(payload(), 'x'.repeat(12));
  for (const bad of ['', 'x'.repeat(1025), 'wrong password']) await rejects(() => decryptBackup(envelope, bad));
  const long = await encryptBackup(payload(), 'x'.repeat(1024));
  assert.deepEqual(await decryptBackup(long, 'x'.repeat(1024)), payload());
});

test('v1/v2 ciphertext, tag, salt, IV, KDF and cipher tampering/truncation/extension/downgrade fail generically', async () => {
  for (const encrypt of [legacyEncrypt, encryptBackup]) {
    const envelope = await encrypt(payload(1024), password);
    const mutations = [
      e => { e.ciphertext = flip(e.ciphertext); }, e => { e.ciphertext = flip(e.ciphertext, -1); },
      e => { e.ciphertext = Buffer.from(e.ciphertext, 'base64').subarray(0, -1).toString('base64'); },
      e => { e.ciphertext = Buffer.concat([Buffer.from(e.ciphertext, 'base64'), Buffer.from([0])]).toString('base64'); },
      e => { e.kdf.salt = flip(e.kdf.salt); }, e => { e.cipher.iv = flip(e.cipher.iv); },
      e => { e.kind += 'x'; }, e => { e.kdf.name = 'scrypt'; }, e => { e.kdf.hash = 'SHA-512'; },
      e => { e.kdf.iterations++; }, e => { e.cipher.name = 'AES-CBC'; }, e => { e.cipher.tagLength = 96; },
      e => { e.version = e.version === 1 ? 2 : 1; },
      e => { if (e.version === 2) e.cipher.keyLength = 128; else e.cipher.extra = 1; },
    ];
    for (const mutate of mutations) {
      const copy = structuredClone(envelope); mutate(copy);
      await rejects(() => decryptBackup(copy, password));
    }
  }
});

test('v2 AAD exact layout: independently encrypt with mismatched authenticated version but same key/IV', async () => {
  const e = await encryptBackup(payload(), password);
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  const salt = Buffer.from(e.kdf.salt, 'base64'), iv = Buffer.from(e.cipher.iv, 'base64');
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: e.kdf.iterations }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const aad = [e.kind, 2, 'PBKDF2', 'SHA-256', e.kdf.iterations, e.kdf.salt, 'AES-GCM', 256, e.cipher.iv, 128].join('|');
  const bytes = new TextEncoder().encode(JSON.stringify(payload()));
  const seal = additionalData => crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(additionalData), tagLength: 128 }, key, bytes);
  e.ciphertext = Buffer.from(await seal(aad)).toString('base64');
  assert.deepEqual(await decryptBackup(e, password), payload());
  e.ciphertext = Buffer.from(await seal(aad.replace('|2|', '|1|'))).toString('base64');
  await rejects(() => decryptBackup(e, password));
  assert.equal(key.extractable, false);
  assert.equal(key.algorithm.length, 256);
});

test('header validation rejects malformed fields without any WebCrypto calls; iteration bomb <100ms', async () => {
  const good = await encryptBackup(payload(), password);
  const subtle = crypto.subtle;
  const original = subtle.importKey;
  let calls = 0;
  subtle.importKey = () => { calls++; throw new Error('KDF reached'); };
  try {
    for (const version of [1, 2]) {
      const base = structuredClone(good); base.version = version;
      if (version === 1) delete base.cipher.keyLength;
      const mutations = [
        ...[2000000000, -1, 0, 1.5, '600000', 99999, 5000001, null].map(v => e => { e.kdf.iterations = v; }),
        ...[32, 64, 96, '128'].map(v => e => { e.cipher.tagLength = v; }),
        ...['!', 'AAAA', ' '.repeat(24), good.kdf.salt + '\n', good.kdf.salt.replace(/==$/, 'AB')].map(v => e => { e.kdf.salt = v; }),
        e => { e.kdf.memory = 2000000000; }, e => { e.cipher.iv = 'AAAA'; },
        ...[15, 17].map(n => e => { e.kdf.salt = Buffer.alloc(n).toString('base64'); }),
        ...[11, 13].map(n => e => { e.cipher.iv = Buffer.alloc(n).toString('base64'); }),
        e => { const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; const i = alphabet.indexOf(e.kdf.salt[21]); e.kdf.salt = e.kdf.salt.slice(0, 21) + alphabet[i ^ 1] + '=='; },
        ...[0, 1, 15, 16].map(n => e => { e.ciphertext = Buffer.alloc(n).toString('base64'); }),
        e => { e.extra = true; }, e => { delete e.kind; }, e => { e.version = '1'; },
        e => { e.kdf = []; }, e => { e.cipher = null; }, e => { e.ciphertext += '\n'; },
      ];
      for (const mutate of mutations) {
        const e = structuredClone(base); mutate(e);
        const start = performance.now();
        await rejects(() => decryptBackup(e, password));
        if (e.kdf?.iterations === 2000000000) assert.ok(performance.now() - start < 100);
      }
    }
    assert.equal(calls, 0);
  } finally { subtle.importKey = original; }
  for (const version of [0, 3, 99]) {
    await assert.rejects(() => decryptBackup({ ...good, version }, password), /Unsupported or newer/);
  }
});

test('file guard, canonical structure and duplicate-sensitive parsing', async () => {
  let reads = 0;
  await rejects(() => readBackupFile({ size: MAX_BACKUP_FILE_BYTES + 1, text() { reads++; } }));
  assert.equal(reads, 0);
  await rejects(() => readBackupFile({ size: 1, text: async () => { throw new Error('raw file exception'); } }));
  await rejects(() => readBackupFile({ size: 1, text: async () => ' '.repeat(MAX_BACKUP_FILE_BYTES + 1) }));
  for (const raw of ['', 'not json', 'null', '[]', '1', '{}x', '{"kind":1,"kind":2}', '{"kdf":{"hash":1,"ha\\u0073h":2}}', '{"a":[{"x":1,"x":2}]}', '{"a":' + '['.repeat(30) + '0' + ']'.repeat(30) + '}']) {
    assert.throws(() => parseBackupJSON(raw), { message: BACKUP_ERROR });
  }
  assert.deepEqual(parseBackupJSON('{"a":"a,b:{\\\"key\\\":1}","b":[{"a":1},{"a":2}]}'), { a: 'a,b:{"key":1}', b: [{ a: 1 }, { a: 2 }] });
});

test('schema rejects unknown keys, wrong types, cookie scope/name and oversized fields', () => {
  const mutations = [
    p => { p.extra = 1; }, p => { p.profiles[0].extra = 1; }, p => { p.profiles[0].cookies[0].extra = 1; },
    ...['evil.com', 'claude.ai.evil.com', 'evilclaude.ai', '.ai', 'https://claude.ai', 'claude.ai/'].map(v => p => { p.profiles[0].cookies[0].domain = v; }),
    p => { p.profiles[0].cookies[0].name = 'bad; name'; }, p => { p.profiles[0].cookies[0].value = 'x'.repeat(65537); },
    p => { p.profiles[0].cookies[0].secure = 'true'; }, p => { p.profiles[0].label = 'x'.repeat(4097); },
    p => { p.profiles[0].cookies[0].path = 'https://evil.com'; }, p => { p.profiles[0].createdAt = -1; },
    p => { p.profiles[0].usage = { limits: { alien: null } }; },
    p => { p.profiles = 'wrong'; }, p => { p.profiles = Array(1001).fill(p.profiles[0]); },
    p => { p.profiles[0].cookies = Array(1001).fill(p.profiles[0].cookies[0]); },
    p => { p.profiles[0].cookies[0].path = '/'.repeat(4097); },
    p => { p.profiles[0].cookies[0].value = '\u0000'; },
    p => { p.profiles[0].cookies[0].sameSite = 'bogus'; },
    p => { p.profiles[0].cookies[0].expirationDate = Infinity; },
    p => { p.profiles[0].cookies[0].partitionKey = { topLevelSite: 'https://claude.ai', extra: true }; },
    p => { p.profiles[0].email = 1; }, p => { p.profiles[0].pinned = 1; },
  ];
  for (const mutate of mutations) { const p = payload(10); mutate(p); assert.throws(() => validateBackupPayload(p), { message: BACKUP_ERROR }); }
  for (const domain of ['claude.ai', '.claude.ai', 'sub.claude.ai']) { const p = payload(10); p.profiles[0].cookies[0].domain = domain; validateBackupPayload(p); }
});

test('preview pins its clone, expires and rejects superseded asynchronous previews without writes', async () => {
  let writes = 0;
  const restore = createBackupRestore({ getProfiles: async () => ({}), saveProfiles: async () => { writes++; } });
  const raw = payload(10);
  const staged = await restore.preview(raw);
  raw.profiles[0].cookies[0].domain = 'evil.com';
  assert.deepEqual(await restore.confirm(staged.token), { imported: 1, skipped: 0 });
  assert.equal(writes, 1);
  const expires = await restore.preview(payload());
  const now = Date.now;
  Date.now = () => now() + 120001;
  try { await rejects(() => restore.confirm(expires.token)); } finally { Date.now = now; restore.cancel(); }
  const encrypted = await encryptBackup(payload(), password);
  const interrupted = restore.preview(encrypted, password);
  restore.cancel();
  await rejects(() => interrupted);
  assert.equal(writes, 1);
});

test('import preview writes nothing; confirmation atomic, one-use, cancel and failures leave storage alone', async () => {
  let saved = { existing: { id: 'existing' } }, writes = 0, fail = false;
  const restore = createBackupRestore({ getProfiles: async () => saved, saveProfiles: async next => { if (fail) throw new Error('Quota exceeded'); saved = next; writes++; } });
  const e = await encryptBackup(payload(10), password);
  await rejects(() => restore.preview(e, 'wrong'));
  const bad = payload(10); bad.profiles[0].cookies[0].domain = 'evil.com';
  await rejects(async () => restore.preview(await legacyEncrypt(bad, 'fake'), 'fake'));
  const preview = await restore.preview(e, password);
  assert.equal(writes, 0);
  assert.deepEqual(Object.keys(preview).sort(), ['count', 'labels', 'legacy', 'token']);
  assert.deepEqual(preview.labels, ['Fake account']);
  await rejects(() => restore.confirm('wrong token'));
  fail = true;
  await assert.rejects(() => restore.confirm(preview.token));
  assert.deepEqual(saved, { existing: { id: 'existing' } });
  assert.equal(writes, 0);
  fail = false;
  const cancelled = await restore.preview(e, password); restore.cancel();
  await rejects(() => restore.confirm(cancelled.token));
  const confirmed = await restore.preview(e, password);
  assert.deepEqual(await restore.confirm(confirmed.token), { imported: 1, skipped: 0 });
  await rejects(() => restore.confirm(confirmed.token));
  assert.equal(writes, 1); assert.equal(Object.keys(saved).length, 2);
  assert.equal(saved.existing.id, 'existing');
  const legacy = await restore.preview(payload(), undefined);
  assert.equal(legacy.legacy, true); restore.cancel();
});

test('old extension rejects v2 before mutation (existing error copy cannot be changed retroactively)', async () => {
  const envelope = await encryptBackup(payload(), password);
  await assert.rejects(() => legacyDecrypt(envelope, password), /Unsupported or invalid encrypted backup format/);
});

test('no secret logging/storage during encrypt, decrypt, preview or failures; derived key never extractable', async () => {
  const calls = [], keys = [], passwords = [];
  const methods = ['log', 'warn', 'error', 'info', 'debug'];
  const originals = methods.map(m => console[m]);
  const derive = crypto.subtle.deriveKey.bind(crypto.subtle);
  const importKey = crypto.subtle.importKey.bind(crypto.subtle);
  methods.forEach(m => { console[m] = (...args) => calls.push(args); });
  crypto.subtle.deriveKey = async (...args) => { assert.equal(args[3], false); const key = await derive(...args); keys.push(key); return key; };
  crypto.subtle.importKey = async (...args) => { if (args[2] === 'PBKDF2') passwords.push(args[1]); return importKey(...args); };
  try {
    const envelope = await encryptBackup(payload(), password);
    await decryptBackup(envelope, password);
    await rejects(() => decryptBackup(envelope, 'wrong'));
    const restore = createBackupRestore({ getProfiles: async () => { throw new Error('storage read before confirm'); }, saveProfiles: async (...args) => calls.push(args) });
    await restore.preview(envelope, password); restore.cancel();
    assert.deepEqual(calls, []);
    assert.ok(keys.every(k => !k.extractable && k.algorithm.length === 256));
    assert.ok(passwords.every(bytes => bytes.every(v => v === 0)));
  } finally {
    methods.forEach((m, i) => { console[m] = originals[i]; });
    crypto.subtle.deriveKey = derive; crypto.subtle.importKey = importKey;
  }
});

test('1000 actual v2 exports have unique salts and IVs (real PBKDF2)', { timeout: 600000 }, async () => {
  const salts = new Set(), ivs = new Set();
  for (let i = 0; i < 1000; i++) {
    const e = await encryptBackup(payload(), password);
    validateBackupEnvelope(e);
    salts.add(e.kdf.salt); ivs.add(e.cipher.iv);
  }
  assert.equal(salts.size, 1000); assert.equal(ivs.size, 1000);
});
