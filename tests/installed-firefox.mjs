// Real Firefox temporary add-on smoke tests via its built-in WebDriver BiDi.
// No project dependencies and no real user browser profile/data are used.
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { decryptBackup } from '../extension/backup-crypto.js';
const root = fileURLToPath(new URL('../', import.meta.url));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(operation, label) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) { const value = await operation(); if (value) return value; await pause(50); }
  throw new Error(`Timed out: ${label}`);
}
const profile = await mkdtemp(path.join(root, 'temp/installed-firefox-'));
const downloads = path.join(profile, 'downloads'); await mkdir(downloads);
const uuid = 'b6ca1cad-5678-4678-bcde-123456789abc';
const preferences = {
  'extensions.webextensions.uuids': JSON.stringify({ 'hotswap-for-claude@extension': uuid }),
  'browser.download.dir': downloads, 'browser.download.folderList': 2, 'browser.download.useDownloadDir': true,
};
await writeFile(path.join(profile, 'user.js'), Object.entries(preferences).map(([key,value]) => `user_pref(${JSON.stringify(key)},${JSON.stringify(value)});`).join('\n'));
const reserve = net.createServer(); await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve));
const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve));
const child = spawn(process.env.FIREFOX_BINARY || 'C:/Program Files/Mozilla Firefox/firefox.exe', ['-headless', '-no-remote', '-profile', profile, '--remote-debugging-port', String(port)], { windowsHide: true, stdio: 'ignore', env: { ...process.env, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: '1' } });
const results = { context: 'installed production Firefox MV3 add-on, actual toolbar popup/runtime/storage/downloads', checks: [] };
let socket;
try {
  socket = await until(async () => { try { return await new Promise((resolve,reject) => { const s = new WebSocket(`ws://127.0.0.1:${port}/session`); s.onopen=()=>resolve(s); s.onerror=reject; }); } catch { return null; } }, 'Firefox WebDriver startup');
  let sequence = 0; const pending = new Map();
  socket.onmessage = event => {
    const message = JSON.parse(event.data), request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id); clearTimeout(request.timer);
    message.type === 'error' ? request.reject(new Error(message.error + ': ' + message.message)) : request.resolve(message.result);
  };
  const command = (method, params={}) => new Promise((resolve,reject) => {
    const id=++sequence;
    const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`WebDriver timeout: ${method}`));},20000);
    pending.set(id,{resolve,reject,timer}); socket.send(JSON.stringify({id,method,params}));
  });
  const session = await command('session.new', { capabilities: {} });
  results.browser = `Firefox ${session.capabilities.browserVersion}`;
  await command('webExtension.install', { extensionData: { type: 'path', path: path.join(root,'dist/firefox') } });
  const { context } = await command('browsingContext.create', { type: 'tab' });
  await command('browsingContext.navigate', { context, url: `moz-extension://${uuid}/popup.html`, wait: 'complete' });
  const evaluate = async (source, popup=true) => {
    const expression = `(async()=>{${popup ? 'const w=browser.extension.getViews({type:"popup"})[0]; if(!w) throw new Error("Popup not open"); const document=w.document; const chrome=w.chrome;' : ''} return JSON.stringify(await (async()=>{${source}})());})()`;
    const result = await command('script.evaluate', { target: { context }, expression, awaitPromise: true, userActivation: true });
    if (result.type !== 'success') throw new Error(result.exceptionDetails?.text || 'Firefox evaluation failed');
    return result.result.value === undefined ? undefined : JSON.parse(result.result.value);
  };
  const check = (value,label) => { assert.ok(value,label); results.checks.push(label); console.log('PASS',label); };
  const open = async () => {
    await evaluate('await browser.action.openPopup();',false);
    await until(() => evaluate('return browser.extension.getViews({type:"popup"}).some(w=>w.document.readyState === "complete" && !!w.document.getElementById("backup-btn"))',false), 'toolbar popup');
    await evaluate('document.getElementById("tab-btn-settings").click();');
  };
  const profiles = () => evaluate('return Object.values((await browser.storage.local.get("profiles")).profiles || {})',false);
  const status = () => evaluate('return document.getElementById("backup-status").textContent');
  const fixture = JSON.parse(await readFile(path.join(root,'tests/fixtures/v1-ascii.json'),'utf8'));
  const fake = fixture.payload.profiles[0];
  await evaluate(`await browser.storage.local.set({profiles:{existing:{...${JSON.stringify(fake)},id:'existing'}}});`,false);
  await open();
  const password = 'Throwaway Firefox release passphrase';
  const exportUI = async secret => {
    await evaluate(`document.getElementById('backup-btn').click(); document.getElementById('backup-password').value=${JSON.stringify(secret)}; document.getElementById('backup-password-confirm').value=${JSON.stringify(secret)}; document.getElementById('backup-create-form').requestSubmit();`);
    return until(async () => { const s=await status(); return /Saved |at least|Could not/.test(s) ? s : null; },'export outcome');
  };
  const exportStatus=await exportUI(password);
  if (!exportStatus.startsWith('Saved 1')) {
    results.exportStatus=exportStatus;
    results.downloadStates=await evaluate('return (await browser.downloads.search({})).map(x=>({state:x.state,error:x.error}))',false);
  }
  check(exportStatus.startsWith('Saved 1'),'actual Firefox popup exports encrypted v2 after download completion');
  const items=await evaluate('return await browser.downloads.search({limit:1,orderBy:["-startTime"]})',false);
  check(items[0].state === 'complete' && path.resolve(items[0].filename).startsWith(downloads),'download completed inside isolated Firefox test directory');
  const envelope=JSON.parse(await readFile(items[0].filename,'utf8'));
  check(envelope.version === 2 && (await decryptBackup(envelope,password)).profiles.length === 1,'actual Firefox download decrypts as v2');
  const select = async data => {
    await evaluate(`document.getElementById('backup-cancel-btn').click(); const transfer=new w.DataTransfer(); transfer.items.add(new w.File([${JSON.stringify(JSON.stringify(data))}],'synthetic-backup.json',{type:'application/json'})); const input=document.getElementById('restore-file-input'); input.files=transfer.files; input.dispatchEvent(new w.Event('change'));`);
    await until(()=>evaluate('return !document.getElementById("backup-unlock-form").classList.contains("hidden")'),'unlock form');
  };
  const unlock=async secret=>{
    await evaluate(`document.getElementById('backup-unlock-password').value=${JSON.stringify(secret)};document.getElementById('backup-unlock-form').requestSubmit();`);
    await until(()=>evaluate('return !document.getElementById("backup-unlock-btn").disabled'),'unlock completion');
  };
  await select(envelope); await unlock('wrong');
  check((await status()).startsWith("Couldn't decrypt:") && (await profiles()).length === 1,'Firefox wrong password leaves storage unchanged');
  await unlock(password);
  check(await evaluate('return !document.getElementById("backup-preview").classList.contains("hidden")') && (await profiles()).length === 1,'Firefox shows preview without applying sessions');
  await evaluate('document.getElementById("backup-preview-cancel-btn").click();');
  check((await profiles()).length === 1,'Firefox cancellation leaves storage unchanged');
  await select(envelope); await unlock(password);
  await evaluate('document.getElementById("backup-apply-btn").click();');
  await until(async()=>(await status()).startsWith('Restored 1'),'Firefox confirmed import');
  check((await profiles()).length === 2,'Firefox confirmation applies through actual popup runtime messages');
  await select(fixture.envelope); await unlock(fixture.password);
  check((await status()).includes('older format') && (await profiles()).length === 2,'Firefox v1 restore previews with manual re-export notice');
  await evaluate('document.getElementById("backup-apply-btn").click();');
  await until(async()=>(await status()).startsWith('Restored 1'),'Firefox v1 confirm');
  check((await profiles()).length === 3,'Firefox installed add-on restores original-writer v1 fixture');
  const preview=await evaluate(`return await chrome.runtime.sendMessage({type:'PREVIEW_BACKUP',backupData:${JSON.stringify(envelope)},password:${JSON.stringify(password)}})`);
  assert.equal(preview.ok,true);
  await evaluate('w.close();');
  await until(()=>evaluate('return browser.extension.getViews({type:"popup"}).length === 0',false),'popup closure');
  await open();
  const stale=await evaluate(`return await chrome.runtime.sendMessage({type:'IMPORT_BACKUP',token:${JSON.stringify(preview.token)}})`);
  check(!stale.ok && (await profiles()).length === 3,'closing Firefox popup invalidates staged import without storage changes');
  const staged=await evaluate(`return await chrome.runtime.sendMessage({type:'PREVIEW_BACKUP',backupData:${JSON.stringify(envelope)},password:${JSON.stringify(password)}})`);
  assert.equal(staged.ok,true);
  await evaluate('const background=await browser.runtime.getBackgroundPage(); background.__restartProbe=1; background.location.reload();',false);
  await until(async()=>{try{return await evaluate('const background=await browser.runtime.getBackgroundPage(); return background.__restartProbe !== 1 && background.document.readyState === "complete";',false);}catch{return false;}},'background context reload');
  const restarted=await until(async()=>{try{return await evaluate(`return await chrome.runtime.sendMessage({type:'IMPORT_BACKUP',token:${JSON.stringify(staged.token)}})`);}catch{return null;}},'background restart');
  check(!restarted.ok && (await profiles()).length === 3,'Firefox background restart discards pending import safely');
  await evaluate('globalThis.cancelTestDownload=item=>browser.downloads.cancel(item.id).catch(()=>{});browser.downloads.onCreated.addListener(globalThis.cancelTestDownload);',false);
  check(!(await exportUI(password)).startsWith('Saved'),'Firefox interrupted export never reports success');
  const cancelled=await evaluate('return await browser.downloads.search({limit:1,orderBy:["-startTime"]})',false);
  check(cancelled[0].state === 'interrupted','Firefox browser confirms interrupted download state');
  results.ok=true;
} catch(error) { results.ok=false;results.error=error.message;console.error(error.message);process.exitCode=1; }
finally {
  await writeFile(path.join(root,'docs/security/installed-firefox-results.json'),JSON.stringify(results,null,2)+'\n');
  socket?.close(); child.kill();
}
