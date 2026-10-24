import { exportClaudeConversationInPage } from './export-page-script.js';
import { normalizeConversation, attachmentUrl } from './export-data.js';

const KEY = 'hotswapExportJobV2';
const TERMINAL = new Set(['complete','incomplete','cancelled','error']);
const readerActions = new Set(['snapshot','textChunk','textAck','fileStart','fileChunk','verify','release','cancel','ping']);
export function createExportJobs({getOrgId}) {
  const ports = new Set();
  let queue = Promise.resolve();
  let stateQueue = Promise.resolve();
  let cancelling = null;
  const load = async () => (await chrome.storage.local.get(KEY))[KEY] || null;
  const save = async job => { await chrome.storage.local.set({[KEY]:job}); publish(job); };
  const isRunning = job => job && !TERMINAL.has(job.status);
  const update = (id,patch,allowCancelling=false) => {
    const operation = stateQueue.then(async()=>{
      const current=await load();
      if (!current || current.id !== id || !isRunning(current) || current.status === 'cancelling' && !allowCancelling) throw new Error('CANCELLED');
      const next={...current,...patch};await save(next);return next;
    });
    stateQueue=operation.catch(()=>{});
    return operation;
  };
  async function recoverOrphan() {
    const job=await load();
    if (!isRunning(job) || Date.now()-job.createdAt<30000) return;
    try {
      const runner=job.runnerTabId && await chrome.tabs.get(job.runnerTabId);
      if (runner?.url !== chrome.runtime.getURL(`export-runner.html#${job.id}`)) throw new Error('missing');
    } catch { await cancel(job.id); }
  }
  const publish = job => {
    const message = !job ? {type:'IDLE'} : TERMINAL.has(job.status)
      ? job.status === 'complete' || job.status === 'incomplete' ? {type:'DONE',info:job.info} : {type:job.status === 'cancelled' ? 'CANCELLED' : 'ERROR',error:job.error}
      : {type:'PROGRESS',text:job.progress || 'Starting export…',jobId:job.id,runnerTabId:job.runnerTabId};
    for (const port of ports) { try { port.postMessage(message); } catch { ports.delete(port); } }
  };
  async function withSession(work) {
    const previous = queue;
    let release;
    queue = new Promise(resolve => { release=resolve; });
    await previous;
    try {
      await recoverOrphan();
      const job = await load();
      if (isRunning(job)) throw new Error('Session refresh deferred while a chat export is running.');
      return await work();
    } finally { release(); }
  }
  async function callPage(job, args) {
    if (!readerActions.has(args.action)) throw new Error('Invalid export action');
    const tab = await chrome.tabs.get(job.sourceTabId);
    const cleanup=['release','cancel'].includes(args.action);
    if (cleanup && !tab.url?.startsWith('https://claude.ai/')) return {released:true};
    if (!cleanup && tab.url?.split(/[?#]/)[0] !== `https://claude.ai/chat/${job.chatId}`) throw new Error('SOURCE_NAVIGATED');
    if (!cleanup) {
      const liveOrg = await getOrgId();
      if (job.orgId && liveOrg && job.orgId !== liveOrg) throw new Error('SOURCE_ACCOUNT_CHANGED');
    }
    const result = await chrome.scripting.executeScript({target:{tabId:job.sourceTabId},world:'MAIN',func:exportClaudeConversationInPage,args:[{...args,jobId:job.id,chatId:job.chatId,orgId:job.orgId}]});
    if (!result?.[0]?.result) throw new Error('Export reader did not respond');
    return result[0].result;
  }
  async function cancel(expectedId) {
    const job = await load();
    if (!isRunning(job) || expectedId && expectedId !== job.id) return;
    if (cancelling?.id === job.id) return cancelling.promise;
    const operation=(async()=>{
    const current=await update(job.id,{status:'cancelling'},true);
    // End authenticated page reads before an explicit account switch proceeds.
    try { await callPage(current,{action:'cancel'}); } catch { /* navigated/closed */ }
    if (current.downloadId != null) { try { await chrome.downloads.cancel(current.downloadId); } catch { /* already settled */ } }
    await update(job.id,{status:'cancelled',error:'Export cancelled.'},true);
    try { await chrome.runtime.sendMessage({type:'HOTSWAP_EXPORT_CANCELLED',jobId:job.id}); } catch { /* runner closed */ }
    })();
    cancelling={id:job.id,promise:operation};
    try {await operation;} finally {if(cancelling?.promise===operation)cancelling=null;}
  }
  async function start(options={}) {
    return withSession(async()=>{
      const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
      const chatId = tab?.url?.match(/^https:\/\/claude\.ai\/chat\/([a-zA-Z0-9_-]+)(?:[?#]|$)/)?.[1];
      if (!chatId) throw new Error('Open a Claude conversation before exporting.');
      const existing = await load();
      if (isRunning(existing)) throw new Error('A chat export is already running.');
      const job = {id:crypto.randomUUID(),sourceTabId:tab.id,chatId,orgId:await getOrgId(),includeAttachments:options.includeAttachments !== false,status:'starting',progress:'Reading conversation…',createdAt:Date.now()};
      await save(job);
      let runner;
      try {
        runner = await chrome.tabs.create({url:chrome.runtime.getURL(`export-runner.html#${job.id}`),active:false});
        await update(job.id,{runnerTabId:runner.id});
      } catch {
        if (runner) {try {await chrome.tabs.remove(runner.id);} catch { /* already closed */ }}
        const current=await load();
        if (current?.id===job.id && ['cancelled','cancelling'].includes(current.status)) return {jobId:job.id,running:false};
        await update(job.id,{status:'error',error:'Could not open the export task.'});
        throw new Error('Could not open the export task.');
      }
      return {jobId:job.id,runnerTabId:runner.id,running:true};
    });
  }
  const fromPopup = sender => sender?.id === chrome.runtime.id && !sender.tab && sender.url === chrome.runtime.getURL('popup.html');
  const fromRunner = (sender,job) => sender?.id === chrome.runtime.id && sender.tab?.id === job?.runnerTabId && sender.url?.split('#')[0] === chrome.runtime.getURL('export-runner.html');
  chrome.runtime.onMessage.addListener((message,sender,reply)=>{
    if (!message?.type?.startsWith('HOTSWAP_EXPORT_') || message.type === 'HOTSWAP_EXPORT_CANCELLED') return false;
    (async()=>{
      try {
        const job=await load();
        if (message.type === 'HOTSWAP_EXPORT_STATUS' && fromPopup(sender)) return reply({ok:true,job});
        if (message.type === 'HOTSWAP_EXPORT_CANCEL' && (fromPopup(sender) || fromRunner(sender,job))) { await cancel(); return reply({ok:true}); }
        if (!job || message.jobId !== job.id || !fromRunner(sender,job)) throw new Error('Export request rejected.');
        if (message.type === 'HOTSWAP_EXPORT_GET') return reply({ok:true,job});
        if (message.type === 'HOTSWAP_EXPORT_PAGE' && message.action === 'release') {
          return reply({ok:true,result:await callPage(job,{action:'release'})});
        }
        if (!isRunning(job) || job.status === 'cancelling') throw new Error('CANCELLED');
        if (message.type === 'HOTSWAP_EXPORT_PAGE') {
          if (!readerActions.has(message.action)) throw new Error('Invalid export action');
          const result=await callPage(job,{action:message.action,offset:message.offset,url:message.url});
          if (message.action === 'snapshot' && !job.orgId && result.orgId) await update(job.id,{orgId:result.orgId});
          return reply({ok:true,result});
        }
        if (message.type === 'HOTSWAP_EXPORT_PROGRESS') {
          await update(job.id,{status:'running',progress:String(message.text || '').slice(0,300)});return reply({ok:true});
        }
        if (message.type === 'HOTSWAP_EXPORT_DOWNLOAD') {
          if (!Number.isSafeInteger(message.downloadId)) throw new Error('Invalid download');
          const [download]=await chrome.downloads.search({id:message.downloadId});
          if (!download || !download.url?.startsWith(`blob:${chrome.runtime.getURL('')}`) || (download.byExtensionId && download.byExtensionId !== chrome.runtime.id)) throw new Error('Invalid download owner');
          await update(job.id,{downloadId:message.downloadId});return reply({ok:true});
        }
        if (message.type === 'HOTSWAP_EXPORT_FINISH') {
          if (!TERMINAL.has(message.status)) throw new Error('Invalid outcome');
          await update(job.id,{status:message.status,info:message.info,error:String(message.error || '').slice(0,300)});return reply({ok:true});
        }
        throw new Error('Unknown export request');
      } catch (error) { reply({ok:false,error:error.message === 'CANCELLED' ? 'CANCELLED' : /^[A-Z_0-9]+$/.test(error.message) ? error.message : 'Export operation failed.'}); }
    })();
    return true;
  });
  chrome.runtime.onConnect.addListener(port=>{
    if (port.name !== 'export-chat') return;
    if (!fromPopup(port.sender)) { port.disconnect(); return; }
    ports.add(port);
    port.onDisconnect.addListener(()=>ports.delete(port));
    port.onMessage.addListener(async message=>{
      try {
        if (message.type === 'PING') { port.postMessage({type:'PONG'}); return; }
        if (message.type === 'STATUS') { await recoverOrphan(); const job=await load(); publish(job); return; }
        if (message.type === 'CANCEL') { await cancel(); return; }
        if (message.type === 'START_EXPORT') { await start(message.options); return; }
      } catch (error) { try { port.postMessage({type:'ERROR',error:error.message}); } catch { /* closed popup */ } }
    });
  });
  chrome.tabs.onRemoved.addListener(async tabId=>{
    const job=await load();
    if (!isRunning(job)) return;
    if (tabId === job.runnerTabId) await cancel(job.id);
    if (tabId === job.sourceTabId) {
      // Runner keeps already recovered data and saves a marked partial archive.
      try {await update(job.id,{progress:'Source tab closed; saving recoverable content…'});} catch { /* job ended */ }
    }
  });
  async function readForSummary(tab, {includeFileContent = false} = {}) {
    return withSession(async()=>{
      const job={id:crypto.randomUUID(),sourceTabId:tab.id,chatId:new URL(tab.url).pathname.split('/')[2],orgId:await getOrgId()};
      try {
        const metadata=await callPage(job,{action:'snapshot'});
        if (!Number.isSafeInteger(metadata.length) || metadata.length <= 0 || metadata.length > 128*1024*1024) throw new Error('Invalid transcript size');
        const parts=[];
        let offset=0;
        while (offset<metadata.length) {
          const chunk=await callPage(job,{action:'textChunk',offset});
          if (chunk.offset !== offset || typeof chunk.text !== 'string' || !chunk.text.length || chunk.text.length>65536) throw new Error('Invalid transcript chunk');
          parts.push(chunk.text);offset+=chunk.text.length;
        }
        if (offset !== metadata.length) throw new Error('Incomplete transcript');
        await callPage(job,{action:'textAck',offset});
        const raw=JSON.parse(parts.join(''));
        const snapshot=metadata.source === 'api' ? normalizeConversation(raw,{orgId:metadata.orgId,chatId:job.chatId,isStreaming:metadata.isStreaming}) : raw;
        if (!snapshot.completeness.complete) throw new Error('Conversation capture is incomplete. Export it first to inspect the report.');
        if (includeFileContent) {
          let remaining = 30000;
          for (const file of snapshot.attachments) {
            if (remaining <= 0) break;
            if (file.extractedText || file.inlineText) { remaining -= Math.min(remaining,(file.extractedText || file.inlineText).length); continue; }
            if (!/^text\/|javascript|json|xml/i.test(file.mimeType || '') && !/\.(?:txt|md|html?|css|[cm]?js|ts|jsx|tsx|json|csv|ya?ml|xml|svg|py|sh|bat|sql)$/i.test(file.filename)) continue;
            try {
              await callPage(job,{action:'fileStart',url:attachmentUrl(file,snapshot)});
              const decoder = new TextDecoder();
              let position = 0;
              let excerpt = '';
              while (excerpt.length < remaining) {
                const chunk = await callPage(job,{action:'fileChunk',offset:position});
                if (chunk.offset !== position) throw new Error('Invalid file offset');
                if (chunk.done) { excerpt += decoder.decode(); break; }
                if (typeof chunk.base64 !== 'string' || chunk.base64.length > 349528) throw new Error('Invalid file chunk');
                const bytes = Uint8Array.from(atob(chunk.base64), char=>char.charCodeAt(0));
                if (!bytes.length || bytes.length > 256*1024) throw new Error('Invalid file chunk');
                position += bytes.length;
                excerpt += decoder.decode(bytes,{stream:true});
              }
              file.summaryText = excerpt.slice(0,remaining);
              remaining -= file.summaryText.length;
            } catch { file.summaryError = 'File excerpt unavailable'; }
          }
        }
        if (!(await callPage(job,{action:'verify'})).unchanged) throw new Error('Conversation changed during capture. Try again after the response finishes.');
        return snapshot;
      } finally { try { await callPage(job,{action:'release'}); } catch { /* page closed */ } }
    });
  }
  return {start,cancel,withSession,readForSummary};
}
