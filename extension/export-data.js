// Pure conversion of untrusted Claude responses. No browser or account access.
export function safeFilename(value) {
  let name = String(value || 'file').split(/[\\/]/).pop().replace(/[\x00-\x1f\x7f<>:"|?*]/g, '-').replace(/^[. ]+|[. ]+$/g, '');
  if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(name)) name = `_${name}`;
  if (name.length > 180) {
    const ext = name.match(/\.[^.]{1,16}$/)?.[0] || '';
    name = name.slice(0, 180 - ext.length) + ext;
  }
  return name || 'file';
}

export function downloadFilename(header, fallback) {
  const encoded = /filename\*\s*=\s*([^;]+)/i.exec(header || '');
  if (encoded) {
    try { return safeFilename(decodeURIComponent(encoded[1].trim().replace(/^"|"$/g, '').replace(/^[^']*'[^']*'/, ''))); } catch { /* fall through */ }
  }
  const ordinary = /filename\s*=\s*(?:"((?:\\.|[^"\\])*)"|([^;]+))/i.exec(header || '');
  return safeFilename(ordinary ? (ordinary[1] ?? ordinary[2]).replace(/\\(.)/g, '$1').trim() : fallback);
}

export function attachmentUrl(file, snapshot) {
  const org = encodeURIComponent(snapshot.orgId || '');
  const chat = encodeURIComponent(snapshot.chatId || '');
  if (!snapshot.orgId || !snapshot.chatId) throw new Error('Missing source identity');
  // Blob uploads are stored in the conversation filesystem; their UUID contents route returns 404.
  if ((file.source === 'generated' || file.source === 'upload' && file.fileKind === 'blob') && file.filePath) return `https://claude.ai/api/organizations/${org}/conversations/${chat}/wiggle/download-file?path=${encodeURIComponent(file.filePath.replace(/^computer:\/\//, ''))}`;
  if (file.source === 'upload' && file.fileUuid) return `https://claude.ai/api/organizations/${org}/files/${encodeURIComponent(file.fileUuid)}/contents`;
  if (file.source === 'direct') {
    const url = new URL(file.url, 'https://claude.ai');
    if (url.origin === 'https://claude.ai' && url.pathname.startsWith('/api/')) return url.href;
  }
  throw new Error('Original file URL unavailable');
}

export function normalizeConversation(payload, context = {}) {
  if (!payload || !Array.isArray(payload.chat_messages) || payload.uuid !== context.chatId) throw new Error('Conversation identity or schema mismatch');
  const warnings = [];
  const warn = code => { if (!warnings.includes(code)) warnings.push(code); };
  if(context.isStreaming) warn('ONGOING_GENERATION');
  const byId = new Map();
  for (const message of payload.chat_messages) {
    if (!message || typeof message.uuid !== 'string' || byId.has(message.uuid)) { warn('INVALID_MESSAGE_ID'); continue; }
    byId.set(message.uuid, message);
  }
  const chain = [], seen = new Set();
  let id = payload.current_leaf_message_uuid;
  if (!byId.has(id)) warn('MISSING_CURRENT_LEAF');
  while (byId.has(id)) {
    if (seen.has(id)) { warn('CYCLIC_MESSAGE_PARENTS'); break; }
    seen.add(id);
    const message = byId.get(id);
    chain.unshift(message);
    id = message.parent_message_uuid;
  }
  if (chain.length && id && !/^00000000-0000-[04]000-[08]000-000000000000$/.test(id)) warn('MISSING_PARENT_MESSAGE');
  const files = new Map();
  const addFile = (descriptor, messageId) => {
    const file = { ...descriptor, filename: safeFilename(descriptor.filename), status: 'pending', messageIds: [messageId] };
    file.id = file.source === 'upload' ? `upload:${file.fileUuid}` : file.source === 'generated' ? `generated:${file.filePath}` : `direct:${file.url || messageId + ':' + file.filename}`;
    if (files.has(file.id)) {
      const existing = files.get(file.id);
      if (!existing.messageIds.includes(messageId)) existing.messageIds.push(messageId);
      return existing.id;
    }
    files.set(file.id, file);
    return file.id;
  };
  const messages = chain.map((message, order) => {
    if (message.truncated) warn('TRUNCATED_MESSAGE');
    const blocks = Array.isArray(message.content) ? message.content : [];
    const text = blocks.filter(block => block.type === 'text' && typeof block.text === 'string').map(block => block.text).join('\n\n') || (typeof message.text === 'string' ? message.text : '');
    const thoughts = blocks.filter(block => block.type === 'thinking' && !block.hidden && !block.thinking_hidden && typeof block.thinking === 'string').map(block => block.thinking).join('\n\n');
    if (blocks.some(block => !block.hidden && !block.thinking_hidden && (block.truncated || (block.type === 'text' && typeof block.start_timestamp === 'string' && block.stop_timestamp === null)))) warn('UNFINISHED_OR_TRUNCATED_CONTENT');
    const attachmentIds = [];
    for (const upload of [...(message.files || []), ...(message.attachments || [])]) {
      const candidateId = upload.file_uuid || upload.uuid || upload.id;
      const fileUuid = typeof candidateId === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(candidateId) ? candidateId : null;
      const size = upload.size_bytes ?? upload.file_size;
      const extractedText = typeof upload.extracted_content === 'string' ? upload.extracted_content : '';
      const uploadPath = typeof upload.path === 'string' ? upload.path.replace(/^computer:\/\//, '') : '';
      const filePath = upload.file_kind === 'blob' && uploadPath.startsWith('/mnt/user-data/uploads/') && !uploadPath.split('/').some(part=>part === '.' || part === '..') ? uploadPath : null;
      if (fileUuid) attachmentIds.push(addFile({source:'upload', fileUuid, fileKind:upload.file_kind || null, filePath, filename:upload.file_name || upload.filename || 'file', mimeType:upload.mime_type || upload.file_type || '', expectedBytes:Number.isSafeInteger(size) && size >= 0 ? size : null, extractedText}, message.uuid));
      else attachmentIds.push(addFile({source:'unresolved', filename:upload.file_name || upload.filename || 'attachment', extractedText}, message.uuid));
    }
    for (const block of blocks) {
      if (block.type === 'tool_use' && ['artifacts','artifact'].includes(block.name) && typeof block.input?.content === 'string') {
        const input=block.input;
        const extension=({'text/html':'.html','image/svg+xml':'.svg','application/vnd.ant.react':'.jsx','text/markdown':'.md'})[input.type] || (typeof input.language === 'string' && /^[a-z0-9]+$/i.test(input.language) ? '.'+input.language : '.txt');
        let name=String(input.title || input.id || 'artifact');
        if (!/\.[a-z0-9]{1,12}$/i.test(name)) name+=extension;
        attachmentIds.push(addFile({source:'inline',filename:name,mimeType:input.type || 'text/plain',inlineText:input.content},message.uuid));
      }
      if (block.type === 'tool_result' && Array.isArray(block.content)) {
        for (const resource of block.content) {
          if (resource.type !== 'local_resource') continue;
          const path = typeof resource.file_path === 'string' ? resource.file_path.replace(/^computer:\/\//, '') : '';
          attachmentIds.push(addFile({source:path ? 'generated' : 'unresolved', filePath:path, filename:path.split('/').pop() || resource.name || 'file', mimeType:resource.mime_type || '', expectedBytes:null}, message.uuid));
        }
      }
      if (!['text','thinking','tool_use','tool_result'].includes(block.type)) warn('UNSUPPORTED_CONTENT_BLOCK');
    }
    return {id:message.uuid, parentId:message.parent_message_uuid, order, role:message.sender === 'human' ? 'user' : 'assistant', text, thought:thoughts ? {text:thoughts,duration:'Thinking'} : null, attachmentIds:[...new Set(attachmentIds)]};
  });
  const attachments = [...files.values()];
  for (const file of attachments) {
    if (file.source === 'generated' && file.messageIds.length > 1) file.note = 'Repeated path: the server provides its currently available contents; historical revisions are not independently identified.';
  }
  return {title:String(payload.name || 'Claude conversation'),url:`https://claude.ai/chat/${context.chatId}`,chatId:context.chatId,orgId:context.orgId,leafId:payload.current_leaf_message_uuid,updatedAt:payload.updated_at || null,exportedAt:new Date().toISOString(),source:'api',messages,attachments,warnings,completeness:{complete:warnings.length === 0,expectedMessages:chain.length,capturedMessages:messages.length}};
}

export function summaryFileSection(snapshot, limit = 30000) {
  let remaining = limit;
  const parts = [];
  for (const file of snapshot.attachments) {
    const text = file.summaryText || file.extractedText || file.inlineText;
    if (typeof text !== 'string' || !text || remaining <= 0) continue;
    const excerpt = text.slice(0, remaining);
    parts.push(`--- File excerpt: ${file.filename} ---\n${excerpt}`);
    remaining -= excerpt.length;
  }
  return parts.length ? `\n\n--- ATTACHED FILE EXCERPTS ---\n${parts.join('\n\n')}` : '';
}

// Reports contain metadata only, even when the user excludes attachment contents.
export function attachmentReport(file) {
  const keys=['id','source','fileUuid','fileKind','filePath','filename','mimeType','expectedBytes','sizeBytes','status','messageIds','localPath','error','note'];
  return Object.fromEntries(keys.filter(key=>Object.hasOwn(file,key)).map(key=>[key,file[key]]));
}

export function buildExportMarkdown(snapshot) {
  const lines = [`# ${snapshot.title}`, '', `Source: ${snapshot.url}`, `Exported: ${snapshot.exportedAt}`, ''];
  if (!snapshot.completeness?.complete || snapshot.attachments.some(file => file.status === 'failed')) lines.push('> INCOMPLETE EXPORT — see export-report.json for missing content or files.', '');
  const files = new Map(snapshot.attachments.map(file => [file.id, file]));
  for (const message of snapshot.messages) {
    lines.push(`## ${message.role === 'user' ? 'You' : 'Claude'}`, '');
    if (message.thought?.text) lines.push('<details><summary>Thinking</summary>', '', message.thought.text, '', '</details>', '');
    if (message.text) lines.push(message.text, '');
    for (const id of message.attachmentIds || []) {
      const file = files.get(id);
      if (!file) continue;
      const label = file.filename.replace(/[\\[\]]/g, '\\$&');
      if (file.status === 'saved' && file.localPath) lines.push(`- [${label}](${encodeURI(file.localPath).replace(/[()#?]/g, char => '%' + char.charCodeAt(0).toString(16))})`);
      else lines.push(`- ${label} — ${file.status === 'skipped' ? 'attachments excluded' : `unavailable (${file.error || 'not recovered'})`}`);
    }
    lines.push('---', '');
  }
  return lines.join('\n');
}
