import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConversation, buildExportMarkdown, attachmentUrl, safeFilename, downloadFilename, summaryFileSection, attachmentReport } from '../extension/export-data.js';

const org = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const chat = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const root = '00000000-0000-4000-8000-000000000000';
const message = (uuid, parent, text, extra={}) => ({uuid,parent_message_uuid:parent,sender:'assistant',content:[{type:'text',text}],...extra});
const snapshot = (messages,leaf=messages.at(-1).uuid) => normalizeConversation({uuid:chat,name:'Synthetic test',current_leaf_message_uuid:leaf,chat_messages:messages},{orgId:org,chatId:chat});

test('selects the current branch by ancestry, not array order or global indices',()=>{
  const out=snapshot([message('other','a','wrong'),message('b','a','right'),message('a',root,'first')],'b');
  assert.deepEqual(out.messages.map(m=>m.text),['first','right']);
  assert.equal(out.completeness.complete,true);
});
test('10,000 lines across 1,000 turns retain exact text, repeated prefixes and order',()=>{
  const input=Array.from({length:1000},(_,i)=>message(String(i),i?String(i-1):root,`${'same '.repeat(30)}\n${Array.from({length:10},(_,j)=>`${i}:${j}`).join('\n')}`));
  const out=snapshot(input);
  assert.equal(out.messages.length,1000);
  assert.deepEqual(out.messages.map(m=>m.text),input.map(m=>m.content[0].text));
});
test('missing parents, cycles, truncated and unfinished messages are incomplete',()=>{
  for(const data of [[message('a','missing','text')],[message('a','b','text'),message('b','a','text')],[message('a',root,'text',{truncated:true})],[message('a',root,'text',{content:[{type:'text',text:'text',start_timestamp:'2026-10-24T00:00:00Z',stop_timestamp:null}]})]]) {
    assert.equal(snapshot(data).completeness.complete,false);
  }
});
test('Claude-hidden truncated thinking does not make visible completed text incomplete',()=>{
  const out=snapshot([message('a',root,'',{content:[{type:'thinking',thinking:'hidden',thinking_hidden:true,truncated:true,stop_timestamp:null},{type:'text',text:'Visible completed answer'}]})]);
  assert.equal(out.completeness.complete,true);
  assert.equal(out.messages[0].thought,null);
  assert.equal(out.messages[0].text,'Visible completed answer');
});
test('file identities keep same-named files distinct and reuse exact references',()=>{
  const files=[{type:'local_resource',file_path:'/mnt/user-data/outputs/a/SPEC.md',mime_type:'text/markdown'},{type:'local_resource',file_path:'/mnt/user-data/outputs/b/SPEC.md',mime_type:'text/markdown'}];
  const a=message('a',root,'files',{content:[{type:'tool_result',content:files},{type:'text',text:'files'}]});
  const b=message('b','a','again',{content:[{type:'tool_result',content:[files[0]]}]});
  const out=snapshot([a,b]);
  assert.equal(out.attachments.length,2);
  assert.notEqual(out.attachments[0].id,out.attachments[1].id);
  assert.deepEqual(out.attachments[0].messageIds,['a','b']);
  assert.match(attachmentUrl(out.attachments[0],out),/wiggle\/download-file\?path=%2Fmnt/);
});
test('original uploads without a conversation blob path use contents, never previews',()=>{
  const out=snapshot([message('a',root,'uploads',{files:['image','document','blob'].map((kind,i)=>({file_uuid:`file-${i}`,file_kind:kind,file_name:`sample-${i}`,size_bytes:42,preview_url:'/thumbnail'}))})]);
  assert.equal(out.attachments.length,3);
  out.attachments.forEach(a=>assert.equal(attachmentUrl(a,out),`https://claude.ai/api/organizations/${org}/files/${a.fileUuid}/contents`));
});

test('uploaded blob originals use their observed conversation upload path',()=>{
  const path='/mnt/user-data/uploads/a spreadsheet (1).csv';
  const out=snapshot([message('a',root,'uploads',{files:[{file_uuid:'blob-file',file_kind:'blob',path,file_name:'a spreadsheet.csv',size_bytes:42}]})]);
  assert.equal(out.attachments[0].id,'upload:blob-file');
  assert.equal(out.attachments[0].expectedBytes,42);
  assert.equal(attachmentUrl(out.attachments[0],out),`https://claude.ai/api/organizations/${org}/conversations/${chat}/wiggle/download-file?path=${encodeURIComponent(path)}`);
  const invalid=snapshot([message('a',root,'uploads',{files:[{file_uuid:'blob-file',file_kind:'blob',path:'/mnt/user-data/uploads/../other/file',file_name:'file'}]})]);
  assert.equal(invalid.attachments[0].filePath,null);
});
test('legacy attachments use id and file_size for original-byte retrieval',()=>{
  const out=snapshot([message('a',root,'legacy',{attachments:[{id:'legacy-id',file_name:'backup.json',file_size:42,file_type:'application/json',extracted_content:'excerpt'}]})]);
  assert.equal(out.attachments[0].source,'upload');
  assert.equal(out.attachments[0].expectedBytes,42);
  assert.equal(attachmentUrl(out.attachments[0],out),`https://claude.ai/api/organizations/${org}/files/legacy-id/contents`);
});
test('Markdown tables, fences and empty code lines survive and failed files never receive local links',()=>{
  const text='| A | B |\n|---|---|\n| 1 | 2 |\n\n````md\n```\n\n\n  untouched\n````';
  const out=snapshot([message('a',root,text,{files:[{file_uuid:'file',file_name:'missing.pdf'}]})]);
  out.attachments[0].status='failed';
  out.attachments[0].error='HTTP_404';
  const md=buildExportMarkdown(out);
  assert.ok(md.includes(text));
  assert.ok(md.includes('HTTP_404'));
  assert.ok(!md.includes('](attachments/'));
});
test('safe filenames preserve Unicode and extensions, removing traversal and Windows devices',()=>{
  assert.equal(safeFilename('../ملف.sh'),'ملف.sh');
  assert.equal(safeFilename('CON.bat'),'_CON.bat');
  assert.equal(downloadFilename("attachment; filename*=UTF-8''%D9%85%D9%84%D9%81.pdf",'fallback'),'ملف.pdf');
});
test('source identity mismatch is rejected',()=>assert.throws(()=>normalizeConversation({uuid:'different',chat_messages:[]},{orgId:org,chatId:chat}),/identity/i));

test('summary text is included only from collected excerpts and remains bounded',()=>{
  const out=snapshot([message('a',root,'text',{attachments:[{file_name:'pasted.txt',file_type:'text/plain',extracted_content:'a'.repeat(40000)}]})]);
  assert.equal(out.attachments[0].extractedText.length,40000);
  const section=summaryFileSection(out);
  assert.ok(section.includes('pasted.txt'));
  assert.ok(section.includes('excerpt'));
  assert.equal((section.match(/a/g)||[]).length>=30000,true);
  assert.ok(section.length<30500);
  assert.equal(summaryFileSection({attachments:[]}), '');
});
test('reports never include attachment or summary text, including excluded attachments',()=>{
  const file={id:'file',filename:'private.txt',source:'inline',inlineText:'secret file',extractedText:'extracted secret',summaryText:'summary secret',status:'skipped',messageIds:['message']};
  const report=attachmentReport(file);
  assert.deepEqual(report,{id:'file',filename:'private.txt',source:'inline',status:'skipped',messageIds:['message']});
});
test('legacy text artifacts retain exact source as separate versioned files',()=>{
  const out=snapshot([message('a',root,'artifact',{content:[{type:'tool_use',name:'artifacts',input:{id:'demo',command:'create',type:'text/html',title:'Demo',content:'<h1>exact\n\nsource</h1>'}}]})]);
  assert.equal(out.attachments.length,1);
  assert.equal(out.attachments[0].source,'inline');
  assert.equal(out.attachments[0].filename,'Demo.html');
  assert.equal(out.attachments[0].inlineText,'<h1>exact\n\nsource</h1>');
});
