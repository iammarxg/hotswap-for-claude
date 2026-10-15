import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackupRestore } from '../extension/backup-restore.js';
import { BACKUP_ERROR, UNSUPPORTED_VERSION_ERROR } from '../extension/backup-schema.js';
import { payload } from './helpers.mjs';

const background = await readFile(new URL('../extension/background.js', import.meta.url), 'utf8');
const popup = await readFile(new URL('../extension/popup.js', import.meta.url), 'utf8');

test('cookie restore rejection never logs credential values or raw exceptions', async () => {
  const source = background.slice(background.indexOf('async function setCookies('), background.indexOf('// ---------- Storage helpers'));
  for (const reject of [false, true]) {
    const logs = [];
    const context = vm.createContext({
      chrome: { cookies: { set: async () => { if (reject) throw new Error('FAKE_COOKIE_SECRET'); return null; } } },
      console: { warn: (...args) => logs.push(args) },
    });
    vm.runInContext(source, context);
    await context.setCookies([{ name: 'sessionKey', value: 'FAKE_COOKIE_SECRET', domain: '.claude.ai', path: '/', secure: true }]);
    assert.ok(!JSON.stringify(logs, (_, v) => v instanceof Error ? v.message : v).includes('FAKE_COOKIE_SECRET'));
    assert.ok(logs.every(args => args.length === 1), 'no raw browser exceptions or objects');
  }
});

test('invalid export attempt clears password and confirmation fields', async () => {
  const source = popup.slice(popup.indexOf('async function submitEncryptedBackup('), popup.indexOf('function handleRestoreClick('));
  const context = vm.createContext({
    backupBusy: false, backupPassword: { value: 'short' }, backupConfirm: { value: 'short' },
    validateBackupPassword: () => { throw new Error('Too short'); }, showBackupStatus: () => {},
  });
  vm.runInContext(source, context);
  await context.submitEncryptedBackup({ preventDefault() {} });
  assert.equal(context.backupPassword.value, '');
  assert.equal(context.backupConfirm.value, '');
});

test('runtime boundary rejects content-script and non-popup backup commands; only a preview token authorizes import', async () => {
  let handler, writes = 0;
  const backupRestore = createBackupRestore({ getProfiles: async () => ({}), saveProfiles: async () => { writes++; } });
  const runtime = { id: 'fake-extension', getURL: path => `chrome-extension://fake-extension/${path}`, onMessage: { addListener: value => { handler = value; } } };
  const context = vm.createContext({ chrome: { runtime }, backupRestore, BACKUP_ERROR, UNSUPPORTED_VERSION_ERROR });
  const start = background.indexOf('chrome.runtime.onMessage.addListener(');
  vm.runInContext(background.slice(start, background.indexOf('// Long-lived port connection', start)), context);
  const sender = { id: runtime.id, url: runtime.getURL('popup.html') };
  const request = (message, from = sender) => new Promise(resolve => handler(message, from, resolve));
  for (const from of [{ ...sender, tab: { id: 1 } }, { ...sender, id: 'other' }, { ...sender, url: runtime.getURL('other.html') }]) {
    assert.equal((await request({ type: 'PREVIEW_BACKUP', backupData: payload(10) }, from)).ok, false);
  }
  assert.equal(writes, 0);
  const preview = await request({ type: 'PREVIEW_BACKUP', backupData: payload(10) });
  assert.equal(preview.ok, true);
  assert.equal(writes, 0);
  assert.equal((await request({ type: 'IMPORT_BACKUP', backupData: payload(10), password: 'unused' })).ok, false);
  assert.equal(writes, 0);
  assert.equal((await request({ type: 'IMPORT_BACKUP', token: preview.token })).ok, true);
  assert.equal(writes, 1);
});

test('backup download uses document Blob URLs until settlement, revokes on failure, and supports service-worker fallback', async () => {
  const source=background.slice(background.indexOf('async function exportProfilesBackup('),background.indexOf('// Adds profiles from a backup file'));
  for (const documentContext of [true,false]) for (const outcome of ['complete','interrupted','rejected']) {
    let revoked=false, usedURL;
    const context=vm.createContext({
      Blob, URL: documentContext ? { createObjectURL: ()=>'blob:synthetic', revokeObjectURL: value=>{assert.equal(value,'blob:synthetic');revoked=true;} } : {},
      getProfiles: async()=>({fake:{id:'fake',cookies:[]}}), encryptBackup: async()=>({kind:'fake-encrypted',ciphertext:'synthetic'}),
      chrome:{runtime:{getManifest:()=>({version:'1.3.1'})},downloads:{download:async options=>{usedURL=options.url;assert.equal(revoked,false);if(outcome==='rejected')throw new Error('browser rejected');return 1;}}},
      waitForDownloadSettled:async()=>{assert.equal(revoked,false);return {ok:outcome==='complete'};},
    });
    vm.runInContext(source,context);
    if(outcome==='complete') assert.equal((await context.exportProfilesBackup('fake')).count,1);
    else await assert.rejects(()=>context.exportProfilesBackup('fake'));
    assert.equal(documentContext ? usedURL==='blob:synthetic' : usedURL.startsWith('data:application/json'),true);
    assert.equal(revoked,documentContext);
  }
});
