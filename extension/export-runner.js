import { normalizeConversation, attachmentUrl, downloadFilename, safeFilename, buildExportMarkdown, attachmentReport } from './export-data.js';
import { SimpleZip } from './zip-builder.js';
import { openExportStaging } from './export-staging.js';
import { rememberExportLocation } from './export-location.js';

const jobId=location.hash.slice(1);
const progress=document.getElementById('progress');
const result=document.getElementById('result');
const cancelButton=document.getElementById('cancel');
let cancelled=false,finished=false,downloadId=null,downloadSettled=false;
const send=async(type,args={})=>{
  const response=await chrome.runtime.sendMessage({type:`HOTSWAP_EXPORT_${type}`,jobId,...args});
  if (!response?.ok) throw new Error(response?.error || 'EXPORT_CONNECTION_LOST');
  return response;
};
const page=async(action,args={})=>{
  if (cancelled) throw new Error('CANCELLED');
  return (await send('PAGE',{action,...args})).result;
};
const report=async text=>{
  progress.textContent=text;
  await send('PROGRESS',{text});
};
cancelButton.addEventListener('click',async()=>{
  cancelled=true;
  if (downloadId !== null) { try { await chrome.downloads.cancel(downloadId); } catch { /* settled */ } }
  try { await send('CANCEL'); } catch { /* worker unavailable */ }
  progress.textContent='Export cancelled.';
  cancelButton.disabled=true;
});
chrome.runtime.onMessage.addListener(message=>{
  if (message.type === 'HOTSWAP_EXPORT_CANCELLED' && message.jobId === jobId) {
    cancelled=true;
    progress.textContent='Export cancelled.';
    cancelButton.disabled=true;
  }
});
const heartbeat=setInterval(()=>{
  if (!finished) {
    send('GET').then(response=>{if(response.job.status === 'cancelled')cancelled=true;}).catch(()=>{});
    if(!cancelled)send('PAGE',{action:'ping'}).catch(()=>{});
  }
},10000);

async function waitForDownload(id) {
  return new Promise((resolve,reject)=>{
    const finish=(ok,error)=>{chrome.downloads.onChanged.removeListener(changed);ok?resolve():reject(new Error(error || 'ZIP_DOWNLOAD_INTERRUPTED'));};
    const changed=delta=>{
      if (delta.id !== id) return;
      if (delta.state?.current === 'complete') finish(true);
      if (delta.state?.current === 'interrupted' || delta.error) finish(false,'ZIP_DOWNLOAD_INTERRUPTED');
    };
    chrome.downloads.onChanged.addListener(changed);
    chrome.downloads.search({id}).then(items=>{
      if (items[0]?.state === 'complete') finish(true);
      if (!items[0] || items[0].state === 'interrupted') finish(false);
    },()=>finish(false));
  });
}

async function run() {
  let staging,objectUrl,job,snapshot;
  try {
    // tabs.create can load this document before background saves the returned tab ID.
    for (let attempt=0;attempt<20;attempt++) {
      try { job=(await send('GET')).job;break; } catch { await new Promise(resolve=>setTimeout(resolve,100)); }
    }
    if (!job || job.id !== jobId || ['cancelled','error','complete','incomplete'].includes(job.status)) throw new Error('EXPORT_JOB_UNAVAILABLE');
    staging=await openExportStaging();
    await staging.prune(jobId);
    await staging.clear(jobId);
    await report('Reading the displayed conversation branch…');
    const metadata=await page('snapshot');
    if (!Number.isSafeInteger(metadata.length) || metadata.length <= 0 || metadata.length > 128*1024*1024) throw new Error('INVALID_TRANSCRIPT_SIZE');
    const parts=[];
    let offset=0;
    while (offset<metadata.length) {
      const chunk=await page('textChunk',{offset});
      if (chunk.offset !== offset || typeof chunk.text !== 'string' || chunk.text.length>65536 || !chunk.text.length) throw new Error('INVALID_TRANSCRIPT_CHUNK');
      parts.push(chunk.text);offset+=chunk.text.length;
    }
    if (offset !== metadata.length) throw new Error('INCOMPLETE_TRANSCRIPT_TRANSFER');
    await page('textAck',{offset});
    const raw=JSON.parse(parts.join(''));
    parts.length=0;
    snapshot=metadata.source === 'api' ? normalizeConversation(raw,{chatId:job.chatId,orgId:metadata.orgId,isStreaming:metadata.isStreaming}) : raw;
    if (!snapshot.messages.length) throw new Error('NO_MESSAGES_RECOVERED');
    // Keep room for the transcript, links and failure report even when files hit classic ZIP limits.
    const reservedBytes=new Blob([buildExportMarkdown(snapshot),JSON.stringify(snapshot.attachments.map(attachmentReport))]).size+1024*1024+snapshot.attachments.length*2048;
    const zip=new SimpleZip({reservedEntries:2,reservedBytes});
    const ensureZipRoom=(path,size)=>{try {zip.validateEntry(path,size);} catch {throw new Error('ZIP_CAPACITY_EXCEEDED');}};
    const warnings=snapshot.warnings;
    for (let index=0;index<snapshot.attachments.length;index++) {
      const file=snapshot.attachments[index];
      if (cancelled) throw new Error('CANCELLED');
      if (!job.includeAttachments) {file.status='skipped';continue;}
      await report(`Saving file ${index+1} of ${snapshot.attachments.length}: ${file.filename}`);
      if (file.source === 'inline' && typeof file.inlineText === 'string') {
        try {
          file.localPath=`attachments/${String(index+1).padStart(3,'0')}-${safeFilename(file.filename)}`;
          const blob=new Blob([file.inlineText],{type:file.mimeType || 'text/plain'});
          await zip.addBlob(file.localPath,blob);
          file.status='saved';file.sizeBytes=blob.size;
        } catch {file.status='failed';file.localPath=null;file.error='ZIP_CAPACITY_EXCEEDED';}
        continue;
      }
      let recovered=false;
      for (let attempt=0;attempt<3 && !recovered;attempt++) {
        try {
          await staging.clear(jobId,index);
          const start=await page('fileStart',{url:attachmentUrl(file,snapshot)});
          file.filename=downloadFilename(start.disposition,file.filename);
          const localPath=`attachments/${String(index+1).padStart(3,'0')}-${safeFilename(file.filename)}`;
          for (const expected of [start.expectedBytes,file.expectedBytes]) if (Number.isSafeInteger(expected)) ensureZipRoom(localPath,expected);
          let position=0,part=0;
          while (true) {
            const chunk=await page('fileChunk',{offset:position});
            if (chunk.offset !== position) throw new Error('FILE_OFFSET_MISMATCH');
            if (chunk.done) {
              if (chunk.length !== position) throw new Error('FILE_LENGTH_MISMATCH');
              break;
            }
            if (typeof chunk.base64 !== 'string' || chunk.base64.length>349528) throw new Error('INVALID_FILE_CHUNK');
            const binary=atob(chunk.base64);
            if (!binary.length || binary.length>256*1024) throw new Error('INVALID_FILE_CHUNK');
            const bytes=Uint8Array.from(binary,char=>char.charCodeAt(0));
            ensureZipRoom(localPath,position+bytes.length);
            // Do not acknowledge/pull the next bytes until this transaction commits.
            await staging.put(jobId,index,part++,bytes);
            position+=bytes.length;
          }
          for (const expected of [start.expectedBytes,file.expectedBytes]) if (Number.isSafeInteger(expected) && expected !== position) throw new Error('FILE_LENGTH_MISMATCH');
          file.mimeType=start.mimeType || file.mimeType;
          file.localPath=localPath;
          const blob=await staging.blob(jobId,index,file.mimeType);
          if (blob.size !== position) throw new Error('STAGED_FILE_LENGTH_MISMATCH');
          await zip.addBlob(file.localPath,blob);
          file.sizeBytes=position;file.status='saved';recovered=true;
          delete file.error;
        } catch (error) {
          if (cancelled || error.message === 'CANCELLED') throw new Error('CANCELLED');
          file.status='failed';file.localPath=null;
          file.error=/^[A-Z_0-9:]+$/.test(error.message) ? error.message : 'FILE_UNAVAILABLE';
          if (attempt<2 && /^(HTTP_(206|429|5\d\d|TIMEOUT)|FILE_LENGTH_MISMATCH|FILE_READ_INTERRUPTED|EXPORT_CONNECTION_LOST)$/.test(file.error)) await new Promise(resolve=>setTimeout(resolve,1000*(attempt+1)));
          else break;
        } finally { try { await staging.clear(jobId,index); } catch { warnings.push('EXPORT_STORAGE_CLEANUP_FAILED'); } }
      }
    }
    try {
      if (!(await page('verify')).unchanged) {snapshot.completeness.complete=false;warnings.push('SOURCE_CHANGED_DURING_EXPORT');}
    } catch {snapshot.completeness.complete=false;warnings.push('SOURCE_VERIFICATION_FAILED');}
    if (cancelled) throw new Error('CANCELLED');
    const attachmentsSaved=snapshot.attachments.filter(file=>file.status === 'saved').length;
    const attachmentsFailed=snapshot.attachments.filter(file=>file.status === 'failed').length;
    const incomplete=!snapshot.completeness.complete || attachmentsFailed>0;
    const outcome={version:1,complete:!incomplete,source:snapshot.source,chatId:snapshot.chatId,leafId:snapshot.leafId,exportedAt:snapshot.exportedAt,completeness:snapshot.completeness,messageCount:snapshot.messages.length,textLines:snapshot.messages.reduce((sum,message)=>sum+message.text.split('\n').length,0),warnings:[...new Set(warnings)],files:snapshot.attachments.map(attachmentReport)};
    zip.releaseReservedSpace();
    zip.addFile('transcript.md',buildExportMarkdown(snapshot));
    zip.addFile('export-report.json',JSON.stringify(outcome,null,2));
    await report(incomplete?'Saving incomplete export — details are included in the report…':'Saving ZIP archive…');
    const stamp=new Date().toISOString().replace(/[:.]/g,'-');
    const filename=`HotSwap-Claude-Exports/${safeFilename(snapshot.title).slice(0,70)}_${stamp}_${job.chatId.slice(0,8)}${incomplete?'_INCOMPLETE':''}.zip`;
    objectUrl=URL.createObjectURL(zip.toBlob());
    if (cancelled) throw new Error('CANCELLED');
    downloadId=await chrome.downloads.download({url:objectUrl,filename,saveAs:false});
    await send('DOWNLOAD',{downloadId});
    await waitForDownload(downloadId);
    downloadSettled=true;
    let savedLocation=null;
    try {savedLocation=await rememberExportLocation(downloadId);} catch { /* file is already saved */ }
    const info={messageCount:snapshot.messages.length,title:snapshot.title,filename,absolutePath:savedLocation?.path || null,directory:savedLocation?.directory || null,attachmentsSaved,attachmentsFailed,incomplete,runnerTabId:job.runnerTabId};
    await send('FINISH',{status:incomplete?'incomplete':'complete',info});
    progress.textContent=incomplete?'Incomplete export saved. Check export-report.json for missing content or files.':'Export saved successfully.';
    result.textContent=JSON.stringify(info,null,2);
  } catch (error) {
    const status=cancelled || error.message === 'CANCELLED' ? 'cancelled' : 'error';
    const text=status === 'cancelled' ? 'Export cancelled.' : `Export failed: ${/^[A-Z_0-9:]+$/.test(error.message)?error.message:'EXPORT_UNAVAILABLE'}`;
    progress.textContent=text;
    try {await send('FINISH',{status,error:text});} catch { /* cancelled jobs are terminal */ }
  } finally {
    finished=true;clearInterval(heartbeat);cancelButton.disabled=true;
    try {await send('PAGE',{action:'release'});} catch { /* navigation or terminal job */ }
    if (downloadId !== null && !downloadSettled) {
      try {await chrome.downloads.cancel(downloadId);} catch { /* already settled */ }
      try {await waitForDownload(downloadId);} catch { /* interruption confirmed */ }
    }
    // A final Blob URL is retained until the browser confirms download settlement.
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    if (staging) {try {await staging.clear(jobId);} catch {result.textContent+='\nTemporary export storage cleanup failed.';} finally {staging.close();}}
  }
}
run();
