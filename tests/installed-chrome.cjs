// Remaining release smoke checks: real installed MV3 popup, worker and storage.
// Uses the already available Playwright runtime; no project dependency added.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(operation, label) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) { const value = await operation(); if (value) return value; await pause(50); }
  throw new Error(`Timed out: ${label}`);
}

(async () => {
 const profile = await fs.mkdtemp(path.join(root, 'temp/installed-chrome-'));
 const downloads = path.join(profile, 'downloads'); await fs.mkdir(downloads);
 const extension = path.join(root, 'dist/chrome');
 const context = await chromium.launchPersistentContext(profile, {
   executablePath: process.env.CHROMIUM_BINARY || chromium.executablePath(),
   headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
 });
 const results = { browser: context.browser()?.version(), context: 'installed production MV3 extension, actual toolbar popup/runtime/storage/downloads', checks: [] };
 try {
   let worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
   const base = worker.url().replace(/background\.js$/, '');
   const cdp = await context.newCDPSession(context.pages()[0]);
   await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
   let sequence = 0;
   const awaiting = new Map();
   cdp.on('Target.receivedMessageFromTarget', event => {
     const message = JSON.parse(event.message), pending = awaiting.get(message.id);
     if (!pending) return;
     awaiting.delete(message.id); clearTimeout(pending.timer);
     message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result);
   });
   const command = (sessionId, method, params = {}) => new Promise((resolve, reject) => {
     const id = ++sequence;
     const timer = setTimeout(() => { awaiting.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 20000);
     awaiting.set(id, { resolve, reject, timer });
     cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method, params }) }).catch(reject);
   });
   let sessionId, targetId;
   const evaluate = async expression => {
     const response = await command(sessionId, 'Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
     if (response.exceptionDetails) throw new Error(response.exceptionDetails.text + ' ' + response.exceptionDetails.exception?.description);
     return response.result.value;
   };
   const open = async () => {
     await until(async () => { try { await worker.evaluate(() => chrome.action.openPopup()); return true; } catch { return false; } }, 'open toolbar popup');
     const target = await until(async () => (await cdp.send('Target.getTargets')).targetInfos.find(t => t.url === base + 'popup.html'), 'toolbar popup');
     targetId = target.targetId;
     ({ sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: false }));
     await until(() => evaluate('!!document.getElementById("backup-btn") && document.readyState === "complete"'), 'popup ready');
     await evaluate('document.getElementById("tab-btn-settings").click()');
   };
   const profiles = () => evaluate('(async()=>Object.values((await chrome.storage.local.get("profiles")).profiles || {}))()');
   const status = () => evaluate('document.getElementById("backup-status").textContent');
   const check = (value, label) => { assert.ok(value, label); results.checks.push(label); console.log('PASS', label); };
   const fixture = JSON.parse(await fs.readFile(path.join(root, 'tests/fixtures/v1-ascii.json'), 'utf8'));
   const fake = fixture.payload.profiles[0];
   await worker.evaluate(async p => { await chrome.storage.local.set({ profiles: { existing: { ...p, id: 'existing' } } }); }, fake);
   await open();
   const password = 'Throwaway release test passphrase';
   const exportUI = async secret => {
     await evaluate(`document.getElementById('backup-btn').click(); document.getElementById('backup-password').value=${JSON.stringify(secret)}; document.getElementById('backup-password-confirm').value=${JSON.stringify(secret)}; document.getElementById('backup-create-form').requestSubmit()`);
     return until(async () => { const s = await status(); return /Saved |at least|Could not/.test(s) ? s : null; }, 'export outcome');
   };
   const rejected = await exportUI('short');
   check(/at least 12/.test(rejected) && await evaluate('document.getElementById("backup-password").value === "" && document.getElementById("backup-password-confirm").value === ""'), 'invalid export clears both password fields');
   check((await exportUI(password)).startsWith('Saved 1'), 'actual popup v2 export reports success only after download completion');
   const items = await worker.evaluate(() => chrome.downloads.search({ limit: 1, orderBy: ['-startTime'] }));
   check(items[0].state === 'complete' && items[0].filename.startsWith(downloads), 'download completed inside isolated test directory');
   const envelope = JSON.parse(await fs.readFile(items[0].filename, 'utf8'));
   const cryptoModule = await import(pathToFileURL(path.join(root, 'extension/backup-crypto.js')));
   check(envelope.version === 2 && (await cryptoModule.decryptBackup(envelope, password)).profiles.length === 1, 'downloaded v2 file decrypts with its confirmed password');
   const selectFile = async data => {
     await evaluate(`{ document.getElementById('backup-cancel-btn').click(); const transfer=new DataTransfer(); transfer.items.add(new File([${JSON.stringify(JSON.stringify(data))}], 'synthetic-backup.json', {type:'application/json'})); const input=document.getElementById('restore-file-input'); input.files=transfer.files; input.dispatchEvent(new Event('change')); }`);
     await until(() => evaluate('!document.getElementById("backup-unlock-form").classList.contains("hidden")'), 'unlock form');
   };
   const unlock = async secret => {
     await evaluate(`document.getElementById('backup-unlock-password').value=${JSON.stringify(secret)}; document.getElementById('backup-unlock-form').requestSubmit()`);
     await until(() => evaluate('!document.getElementById("backup-unlock-btn").disabled'), 'unlock finished');
   };
   await selectFile(envelope); await unlock('wrong');
   check((await status()).startsWith("Couldn't decrypt:") && (await profiles()).length === 1, 'wrong password leaves actual browser storage untouched');
   await unlock(password);
   check(await evaluate('!document.getElementById("backup-preview").classList.contains("hidden")') && (await profiles()).length === 1, 'valid restore previews account labels without applying sessions');
   await evaluate('document.getElementById("backup-preview-cancel-btn").click()');
   check((await profiles()).length === 1, 'cancel preview leaves storage untouched');
   await selectFile(envelope); await unlock(password);
   await evaluate('document.getElementById("backup-apply-btn").click()');
   await until(async () => (await status()).startsWith('Restored 1'), 'confirmed import');
   check((await profiles()).length === 2, 'explicit confirmation adds account atomically through real runtime messages');
   await selectFile(fixture.envelope); await unlock(fixture.password);
   check((await status()).includes('older format') && (await profiles()).length === 2, 'v1 restore uses legacy password and shows manual re-export notice');
   await evaluate('document.getElementById("backup-apply-btn").click()');
   await until(async () => (await status()).startsWith('Restored 1'), 'v1 confirm');
   check((await profiles()).length === 3, 'original-code v1 fixture imports through installed extension');
   const preview = await evaluate(`chrome.runtime.sendMessage({type:'PREVIEW_BACKUP',backupData:${JSON.stringify(envelope)},password:${JSON.stringify(password)}})`);
   assert.equal(preview.ok, true);
   await cdp.send('Target.closeTarget', { targetId });
   await open();
   const stale = await evaluate(`chrome.runtime.sendMessage({type:'IMPORT_BACKUP',token:${JSON.stringify(preview.token)}})`);
   check(!stale.ok && (await profiles()).length === 3, 'closing actual popup discards pending confirmation');
   const staged = await evaluate(`chrome.runtime.sendMessage({type:'PREVIEW_BACKUP',backupData:${JSON.stringify(envelope)},password:${JSON.stringify(password)}})`);
   assert.equal(staged.ok, true);
   await cdp.send('ServiceWorker.enable');
   await cdp.send('ServiceWorker.stopAllWorkers');
   const restarted = await evaluate(`chrome.runtime.sendMessage({type:'IMPORT_BACKUP',token:${JSON.stringify(staged.token)}})`);
   check(!restarted.ok && (await profiles()).length === 3, 'worker termination loses staged import safely without storage mutation');
   worker = await until(async () => context.serviceWorkers().find(w => w.url() === base + 'background.js'), 'worker restart');
   const beforeQuota = JSON.stringify(await profiles());
   await evaluate(`(async()=>{const used=await chrome.storage.local.getBytesInUse();await chrome.storage.local.set({quotaTestFiller:'x'.repeat(chrome.storage.local.QUOTA_BYTES-used-1024)});})()`);
   try {
     const larger = structuredClone(fixture.payload); larger.profiles[0].cookies[0].value = 'x'.repeat(65536);
     const quotaPreview = await evaluate(`chrome.runtime.sendMessage({type:'PREVIEW_BACKUP',backupData:${JSON.stringify(larger)}})`);
     assert.equal(quotaPreview.ok, true);
     const quotaResult = await evaluate(`chrome.runtime.sendMessage({type:'IMPORT_BACKUP',token:${JSON.stringify(quotaPreview.token)}})`);
     check(!quotaResult.ok && JSON.stringify(await profiles()) === beforeQuota, 'actual storage quota failure leaves every existing account unchanged');
   } finally { await evaluate('chrome.storage.local.remove("quotaTestFiller")'); }
   await worker.evaluate(() => {
     globalThis.cancelTestDownload = item => { chrome.downloads.cancel(item.id).catch(() => {}); };
     chrome.downloads.onCreated.addListener(globalThis.cancelTestDownload);
   });
   check(!(await exportUI(password)).startsWith('Saved'), 'cancelled actual download is not presented as successful export');
   const cancelled = await worker.evaluate(() => chrome.downloads.search({ limit: 1, orderBy: ['-startTime'] }));
   check(cancelled[0].state === 'interrupted', 'browser confirms interrupted download state');
   results.ok = true;
 } catch (error) { results.ok = false; results.error = error.message; throw error; }
 finally {
   await fs.writeFile(path.join(root, 'docs/security/installed-chrome-results.json'), JSON.stringify(results, null, 2) + '\n');
   await context.close();
 }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
