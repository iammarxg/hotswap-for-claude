// Serialized into MAIN by scripting.executeScript. Keep every dependency inside.
// Pulling one chunk acknowledges the preceding chunk; no global download hooks.
export async function exportClaudeConversationInPage(options = {}) {
  const chunkSize = 256 * 1024;
  const key = '__hotSwapExportReadersV2';
  const registry = window[key] || (window[key] = new Map());
  const closed = window.__hotSwapExportClosedV2 || (window.__hotSwapExportClosedV2 = new Map());
  for (const [id,time] of closed) if (Date.now()-time>30*60000) closed.delete(id);
  const action = options.action || 'snapshot';
  const jobId = options.jobId;
  if (typeof jobId !== 'string' || jobId.length > 100) throw new Error('INVALID_JOB');
  let state = registry.get(jobId);
  if (action === 'release' || action === 'cancel') {
    closed.set(jobId,Date.now());
    if (state) {
      state.controller?.abort();
      try { await state.reader?.cancel(); } catch { /* already closed */ }
      clearTimeout(state.lease);
      registry.delete(jobId);
    }
    return {released:true};
  }
  if (closed.has(jobId)) throw new Error('CANCELLED');
  const chatId = location.pathname.match(/^\/chat\/([a-zA-Z0-9_-]+)$/)?.[1];
  if (!chatId || chatId !== options.chatId) throw new Error('SOURCE_NAVIGATED');
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const check = () => {
    if (state?.controller.signal.aborted) throw new Error('CANCELLED');
    if (location.pathname !== `/chat/${chatId}`) throw new Error('SOURCE_NAVIGATED');
  };
  const touch = () => {
    clearTimeout(state.lease);
    state.lease = setTimeout(() => { state.controller.abort(); state.reader?.cancel().catch(() => {}); registry.delete(jobId); }, 120000);
  };
  const request = async url => {
    check();
    // A new request also ends a partially consumed file (capacity rejection or summary excerpt).
    try { await state.reader?.cancel(); } catch { /* already closed */ }
    state.reader = null;
    state.requestController?.abort();
    state.detachRequest?.();
    const controller = new AbortController();
    const abort = () => controller.abort();
    state.controller.signal.addEventListener('abort', abort, {once:true});
    state.detachRequest = () => state.controller.signal.removeEventListener('abort', abort);
    state.requestController = controller;
    const timer = setTimeout(() => controller.abort(), 60000);
    try {
      const response = await fetch(url, {credentials:'include', cache:'no-store', signal:controller.signal});
      if (!response.ok || response.status === 206) {
        response.body?.cancel().catch(()=>{});
        if (response.status === 429) await sleep(Math.min(60,Math.max(1,Number(response.headers.get('Retry-After')) || 1))*1000);
        throw new Error(`HTTP_${response.status}`);
      }
      if (new URL(response.url || url, location.origin).origin !== location.origin) throw new Error('UNEXPECTED_FILE_ORIGIN');
      return response;
    } catch (error) {
      if (state.controller.signal.aborted) throw new Error('CANCELLED');
      if (controller.signal.aborted) throw new Error('HTTP_TIMEOUT');
      throw error;
    } finally { clearTimeout(timer); }
  };
  const readText = async response => {
    const reader=response.body.getReader();
    const decoder=new TextDecoder();
    const parts=[];
    let bytes=0;
    state.reader=reader;
    try {
      while (true) {
        check(); touch();
        const timer=setTimeout(()=>state.requestController.abort(),60000);
        let next;
        try {next=await reader.read();} finally {clearTimeout(timer);}
        if(next.done)break;
        bytes+=next.value.byteLength;
        if(bytes>128*1024*1024) {await reader.cancel();throw new Error('CONVERSATION_TOO_LARGE');}
        parts.push(decoder.decode(next.value,{stream:true}));
      }
      parts.push(decoder.decode());
      return parts.join('');
    } finally {state.reader=null;}
  };
  const settle = () => new Promise(resolve => {
    let quiet;
    const observer = new MutationObserver(() => { clearTimeout(quiet); quiet = setTimeout(done, 200); });
    const cap = setTimeout(done, 1800);
    function done() { clearTimeout(quiet); clearTimeout(cap); observer.disconnect(); resolve(); }
    observer.observe(document.querySelector('[data-testid="transcript-list"]') || document.body, {childList:true,subtree:true,characterData:true});
    quiet = setTimeout(done, 200);
  });
  async function domSnapshot(reason) {
    const scroll = document.querySelector('[data-autoscroll-container="true"]') || document.scrollingElement;
    const original = scroll.scrollTop;
    const messages = new Map();
    let expected = 0, unknownIdentity = false, ordinal = 0;
    const warnings = [`API_UNAVAILABLE:${reason}`];
    const serialize = node => {
      if (node.nodeType === 3) return node.textContent;
      if (node.nodeType !== 1 || node.matches('button,.sr-only,[data-message-action-bar]')) return '';
      const tag = node.tagName.toLowerCase();
      if (tag === 'pre') {
        const code = node.querySelector('code') || node;
        const text = code.textContent;
        const fence = '`'.repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map(match => match[0].length + 1)));
        const lang = [...code.classList].find(c => c.startsWith('language-'))?.slice(9) || '';
        return `\n${fence}${lang}\n${text}${text.endsWith('\n') ? '' : '\n'}${fence}\n`;
      }
      if (tag === 'table') {
        const rows = [...node.querySelectorAll('tr')].map(row => [...row.querySelectorAll('th,td')].map(cell => cell.textContent.trim().replace(/\|/g,'\\|').replace(/\n/g,'<br>')));
        if (!rows.length) return '';
        return '\n' + [rows[0], rows[0].map(()=>'---'), ...rows.slice(1)].map(row=>'| '+row.join(' | ')+' |').join('\n') + '\n';
      }
      if (tag === 'br') return '\n';
      if (tag === 'img') return '';
      const inner = [...node.childNodes].map(serialize).join('');
      if (/^h[1-6]$/.test(tag)) return `\n${'#'.repeat(Number(tag[1]))} ${inner}\n\n`;
      if (tag === 'li') return `- ${inner.trim()}\n`;
      if (['p','div','blockquote'].includes(tag)) return inner ? `${inner}\n\n` : '';
      if (tag === 'strong' || tag === 'b') return `**${inner}**`;
      if (tag === 'em' || tag === 'i') return `_${inner}_`;
      if (tag === 'code') return '`' + inner + '`';
      return inner;
    };
    const capture = () => {
      for (const row of document.querySelectorAll('[data-testid="transcript-row"]')) {
        const article = row.querySelector('[role="article"]') || row;
        const ordinalAttribute=article.getAttribute('aria-posinset');
        const indexAttribute=row.getAttribute('data-index');
        const position = ordinalAttribute != null ? Number(ordinalAttribute) : indexAttribute != null ? Number(indexAttribute)+1 : NaN;
        const total = Number(article.getAttribute('aria-setsize'));
        if (total > 0) expected = Math.max(expected, total);
        const indexed = Number.isSafeInteger(position) && position > 0;
        if (!indexed) unknownIdentity = true;
        const id = indexed ? `dom:${position}` : `unidentified:${ordinal++}`;
        const role = row.getAttribute('data-perf-row') === 'human' ? 'user' : 'assistant';
        const body = row.querySelector('[data-testid="user-message"],.font-claude-response-body,[data-testid="assistant-message"]') || article;
        const attachments = [...row.querySelectorAll('[data-testid="file-card-block"],[data-testid="file-thumbnail"]')].map((card,i)=>({id:`${id}:file:${i}`,source:'unresolved',filename:(card.querySelector('[data-testid="file-card-open"]')?.textContent || card.querySelector('button')?.textContent || 'attachment').trim(),status:'pending',messageIds:[id]}));
        // Retain snapshots, never recycled DOM references. An index can render more text later.
        messages.set(id,{id,order:indexed?position:messages.size,role,text:serialize(body).trim(),attachmentIds:attachments.map(a=>a.id),attachments});
        if (row.getAttribute('data-perf-row-streaming') === 'true') warnings.push('ONGOING_GENERATION');
      }
    };
    let reachedEnd = false;
    try {
      scroll.scrollTop = 0;
      await settle();
      let previous = -1, stable = 0;
      const started = Date.now();
      while (Date.now() - started < 30 * 60000) {
        check(); touch(); capture();
        const end = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
        if (scroll.scrollTop >= end - 2) {
          await settle(); capture();
          if (Math.abs(scroll.scrollTop - previous) <= 2) stable++; else stable = 0;
          if (stable >= 2) { reachedEnd = true; break; }
        }
        previous = scroll.scrollTop;
        scroll.scrollTop = Math.min(end, scroll.scrollTop + Math.max(100, scroll.clientHeight * 0.7));
        await settle();
      }
    } finally { scroll.scrollTop = original; }
    const ordered = [...messages.values()].sort((a,b)=>a.order-b.order);
    const contiguous = expected > 0 && ordered.length === expected && ordered.every((message,i)=>message.order === i+1);
    const complete = reachedEnd && contiguous && !unknownIdentity && !warnings.includes('ONGOING_GENERATION');
    if (!complete) warnings.push('DOM_COVERAGE_UNVERIFIED');
    return {source:'dom',title:document.title.replace(/\s*-\s*Claude.*$/,''),url:location.href,chatId,orgId:options.orgId || '',exportedAt:new Date().toISOString(),messages:ordered.map(({attachments,...message})=>message),attachments:ordered.flatMap(message=>message.attachments),warnings:[...new Set(warnings)],completeness:{complete,expectedMessages:expected || null,capturedMessages:ordered.length}};
  }
  if (action === 'snapshot') {
    if (state) throw new Error('JOB_ALREADY_STARTED');
    state = {controller:new AbortController(),textOffset:0,orgId:options.orgId,reader:null};
    registry.set(jobId,state); touch();
    try {
      const observed = performance.getEntriesByType('resource').map(item=>item.name).find(url=>url.includes(`/chat_conversations/${chatId}?`));
      const observedOrg = observed && new URL(observed).pathname.match(/^\/api\/organizations\/([^/]+)\/chat_conversations\//)?.[1];
      if (observedOrg && options.orgId && observedOrg !== options.orgId) throw new Error('SOURCE_ACCOUNT_CHANGED');
      state.orgId = observedOrg || options.orgId;
      if (!/^[a-zA-Z0-9_-]+$/.test(state.orgId || '')) throw new Error('ORGANIZATION_UNAVAILABLE');
      state.conversationUrl = `${location.origin}/api/organizations/${encodeURIComponent(state.orgId)}/chat_conversations/${chatId}?tree=True&rendering_mode=messages&render_all_tools=true&include_inline_comparison=true&renders_source_card=true&consistency=strong`;
      const response = await request(state.conversationUrl);
      const declared = Number(response.headers.get('Content-Length'));
      if (declared > 128 * 1024 * 1024) throw new Error('CONVERSATION_TOO_LARGE');
      state.text = await readText(response);
      if (state.text.length > 128 * 1024 * 1024) throw new Error('CONVERSATION_TOO_LARGE');
      const payload = JSON.parse(state.text);
      if (payload.uuid !== chatId || !Array.isArray(payload.chat_messages)) throw new Error('INVALID_CONVERSATION');
      state.source = 'api'; state.leafId = payload.current_leaf_message_uuid; state.updatedAt = payload.updated_at;
    } catch (error) {
      if (state.controller.signal.aborted || error.message === 'SOURCE_ACCOUNT_CHANGED') throw error;
      state.source = 'dom';
      state.text = JSON.stringify(await domSnapshot(/^HTTP_\d+$/.test(error.message) ? error.message : 'RESPONSE_UNAVAILABLE'));
    }
    touch();
    return {length:state.text.length,orgId:state.orgId || options.orgId || '',source:state.source,isStreaming:!!document.querySelector('[data-perf-row-streaming="true"],button[aria-label="Stop response"]')};
  }
  if (!state) throw new Error('JOB_EXPIRED');
  check(); touch();
  if (action === 'ping') return {alive:true};
  if (action === 'textChunk') {
    if (state.lastTextChunk?.offset === options.offset) return state.lastTextChunk;
    if (options.offset !== state.textOffset) throw new Error('CHUNK_OFFSET_MISMATCH');
    const text = state.text.slice(state.textOffset,state.textOffset+65536);
    const offset = state.textOffset;
    state.textOffset += text.length;
    const done = state.textOffset === state.text.length;
    state.lastTextChunk = {offset,text,done};
    return state.lastTextChunk;
  }
  if (action === 'textAck') {
    if (options.offset !== state.textOffset || !state.lastTextChunk?.done) throw new Error('CHUNK_OFFSET_MISMATCH');
    state.text = '';
    state.lastTextChunk = null;
    return {acknowledged:options.offset};
  }
  if (action === 'verify') {
    if (state.source !== 'api') return {unchanged:location.pathname === `/chat/${chatId}`};
    const response = await request(state.conversationUrl);
    const payload = JSON.parse(await readText(response));
    return {unchanged:payload.uuid === chatId && payload.current_leaf_message_uuid === state.leafId && payload.updated_at === state.updatedAt};
  }
  if (action === 'fileStart') {
    const url = new URL(options.url);
    const allowedUpload = `/api/organizations/${encodeURIComponent(state.orgId)}/files/`;
    const allowedGenerated = `/api/organizations/${encodeURIComponent(state.orgId)}/conversations/${chatId}/wiggle/download-file`;
    if (url.origin !== location.origin || !(url.pathname.startsWith(allowedUpload) && url.pathname.endsWith('/contents') || url.pathname === allowedGenerated)) throw new Error('INVALID_FILE_SOURCE');
    const response = await request(url.href);
    const disposition = response.headers.get('Content-Disposition') || '';
    if (!/^attachment\b/i.test(disposition)) throw new Error('NOT_AN_ATTACHMENT');
    const sizeHeader = response.headers.get('X-Served-File-Size') || (!response.headers.get('Content-Encoding') && response.headers.get('Content-Length'));
    state.reader = response.body.getReader(); state.pending = new Uint8Array(0); state.fileOffset = 0; state.lastFileChunk = null;
    return {disposition,mimeType:response.headers.get('Content-Type'),expectedBytes:sizeHeader && /^\d+$/.test(sizeHeader) ? Number(sizeHeader) : null};
  }
  if (action === 'fileChunk') {
    if (state.lastFileChunk?.offset === options.offset) return state.lastFileChunk;
    if (options.offset !== state.fileOffset || !state.reader) throw new Error('CHUNK_OFFSET_MISMATCH');
    const timer = setTimeout(()=>state.requestController.abort(),60000);
    try {
      while (!state.pending.length) {
        const next = await state.reader.read();
        if (next.done) { state.reader = null; state.lastFileChunk = {offset:state.fileOffset,done:true,length:state.fileOffset}; return state.lastFileChunk; }
        state.pending = next.value;
      }
      const bytes = state.pending.subarray(0,chunkSize);
      state.pending = state.pending.subarray(bytes.length);
      let binary = '';
      for (let i=0;i<bytes.length;i+=8192) binary += String.fromCharCode(...bytes.subarray(i,i+8192));
      const offset = state.fileOffset;
      state.fileOffset += bytes.length;
      state.lastFileChunk = {offset,done:false,base64:btoa(binary)};
      return state.lastFileChunk;
    } catch {
      throw new Error(state.controller.signal.aborted ? 'CANCELLED' : 'FILE_READ_INTERRUPTED');
    } finally { clearTimeout(timer); }
  }
  throw new Error('UNKNOWN_EXPORT_ACTION');
}
