import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { exportClaudeConversationInPage } from '../extension/export-reader.js';
import { SimpleZip } from '../extension/zip-builder.js';

test('ZIP reservations preserve report entries and bytes when attachment capacity is exhausted',()=>{
  const count=new SimpleZip({reservedEntries:65534});
  count.addFile('one','1');
  assert.throws(()=>count.addFile('two','2'),/capacity/i);
  count.releaseReservedSpace();count.addFile('transcript.md','text');count.addFile('export-report.json','{}');
  const bytes=new SimpleZip({reservedBytes:1024});
  bytes.files.push({path:'synthetic-large',size:0xffffffff-1000});
  assert.throws(()=>bytes.validateEntry('attachment',0),/capacity/i);
  assert.throws(()=>new SimpleZip({reservedBytes:-1}),/reservation/i);
});

test('document-start usage observer leaves all native download operations untouched',async()=>{
  const source=await readFile(new URL('../extension/blob-capture-init.js',import.meta.url),'utf8');
  const click=()=>{},append=()=>{},create=()=>{},objectURL=()=>{};
  const context=vm.createContext({window:{fetch:async()=>new Response('ok')},HTMLAnchorElement:{prototype:{click}},Node:{prototype:{appendChild:append}},document:{createElement:create},URL:{createObjectURL:objectURL}});
  vm.runInContext(source,context);
  assert.equal(context.HTMLAnchorElement.prototype.click,click);
  assert.equal(context.Node.prototype.appendChild,append);
  assert.equal(context.document.createElement,create);
  assert.equal(context.URL.createObjectURL,objectURL);
});
test('MAIN reader transfers exact ordered binary chunks and never patches downloads',async()=>{
  const org='org',chat='chat',jobId='synthetic';
  const expected=Uint8Array.from({length:700000},(_,i)=>i%251);
  const payload={uuid:chat,name:'Synthetic',current_leaf_message_uuid:'message',chat_messages:[],updated_at:'fixed'};
  let fileRequests=0,abandonedCancelled=0;
  const fileResponse=()=>{
    const finish=++fileRequests===1;
    const stream=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(0));controller.enqueue(expected);if(finish)controller.close();},cancel(){abandonedCancelled++;}});
    return new Response(stream,{headers:{'Content-Disposition':'attachment; filename="file.zip"','X-Served-File-Size':String(expected.length)}});
  };
  const context=vm.createContext({window:{},document:{querySelector:()=>null},location:{pathname:'/chat/chat',origin:'https://claude.ai'},performance:{getEntriesByType:()=>[]},AbortController,URL,Uint8Array,TextEncoder,TextDecoder,Response,btoa,clearTimeout,setTimeout:(fn,ms)=>{const timer=setTimeout(fn,ms);timer.unref();return timer;},fetch:async url=>url.includes('download-file')?fileResponse():new Response(JSON.stringify(payload))});
  const reader=vm.runInContext(`(${exportClaudeConversationInPage.toString()})`,context);
  const call=args=>reader({jobId,orgId:org,chatId:chat,...args});
  const metadata=await call({action:'snapshot'});
  assert.equal(metadata.source,'api');
  const text=await call({action:'textChunk',offset:0});
  assert.deepEqual(JSON.parse(text.text),payload);
  assert.equal((await call({action:'textChunk',offset:0})).text,text.text,'lost replies are replayable before acknowledgement');
  await assert.rejects(()=>call({action:'textAck',offset:1}),/OFFSET/);
  await call({action:'textAck',offset:text.text.length});
  const file=await call({action:'fileStart',url:'https://claude.ai/api/organizations/org/conversations/chat/wiggle/download-file?path=%2Fsample.zip'});
  assert.equal(file.expectedBytes,700000);
  let offset=0;
  const chunks=[];
  while(true){const next=await call({action:'fileChunk',offset});assert.deepEqual(await call({action:'fileChunk',offset}),next,'file replies can be replayed without consuming more bytes');if(next.done){assert.equal(next.length,offset);break;}const bytes=Buffer.from(next.base64,'base64');assert.ok(bytes.length<=256*1024);chunks.push(bytes);offset+=bytes.length;}
  assert.deepEqual(Buffer.concat(chunks),Buffer.from(expected));
  assert.equal((await call({action:'verify'})).unchanged,true);
  await call({action:'fileStart',url:'https://claude.ai/api/organizations/org/conversations/chat/wiggle/download-file?path=%2Fsample.zip'});
  await call({action:'fileChunk',offset:0});
  assert.equal((await call({action:'verify'})).unchanged,true);
  assert.equal(abandonedCancelled,1,'verification cancels a partially read file stream');
  await call({action:'release'});
  assert.equal(context.window.__hotSwapExportReadersV2.size,0);
  await assert.rejects(()=>call({action:'snapshot'}),/CANCELLED/,'closed jobs cannot restart from a late injection');
});
test('ZIP Blob preserves bytes and guards duplicate, unsafe and capacity-overflow entries',async()=>{
  const zip=new SimpleZip();
  await zip.addBlob('attachments/ملف.bin',new Blob([Uint8Array.of(0,1,255)]));
  zip.addFile('transcript.md','exact\n\ntext');
  const bytes=new Uint8Array(await zip.toBlob().arrayBuffer());
  assert.equal(new DataView(bytes.buffer).getUint32(0,true),0x04034b50);
  assert.equal(new DataView(bytes.buffer).getUint16(bytes.length-12,true),2);
  assert.throws(()=>zip.addFile('../escape','bad'),/Invalid/);
  assert.throws(()=>zip.addFile('transcript.md','duplicate'),/Duplicate/);
  assert.throws(()=>zip.validateEntry('huge',0x100000000),/capacity/);
  zip.files=Array.from({length:65535},()=>({size:0,path:'x'}));
  assert.throws(()=>zip.addFile('overflow',''),/capacity/);
});
