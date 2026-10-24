// Installed Firefox export pipeline; only synthetic HTTPS responses and a fresh profile.
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(operation,label){const end=Date.now()+45000;while(Date.now()<end){const value=await operation();if(value)return value;await pause(100);}throw new Error(`Timed out: ${label}`);}
function zipEntries(bytes){
  const entries=new Map();let offset=0;
  while(bytes.readUInt32LE(offset)===0x04034b50){
    assert.equal(bytes.readUInt16LE(offset+8),0);
    const size=bytes.readUInt32LE(offset+18),nameLength=bytes.readUInt16LE(offset+26),extra=bytes.readUInt16LE(offset+28);
    const name=bytes.subarray(offset+30,offset+30+nameLength).toString('utf8'),start=offset+30+nameLength+extra;
    entries.set(name,bytes.subarray(start,start+size));offset=start+size;
  }
  assert.equal(bytes.readUInt32LE(offset),0x02014b50);return entries;
}
const profile=await mkdtemp(path.join(root,'temp/export-firefox-'));
const downloads=path.join(profile,'downloads');await mkdir(downloads);
const uuid='b6ca1cad-5678-4678-bcde-123456789abc';
await writeFile(path.join(profile,'user.js'),Object.entries({
  'extensions.webextensions.uuids':JSON.stringify({'hotswap-for-claude@extension':uuid}),
  'browser.download.dir':downloads,'browser.download.folderList':2,'browser.download.useDownloadDir':true,
}).map(([key,value])=>`user_pref(${JSON.stringify(key)},${JSON.stringify(value)});`).join('\n'));
const reserve=net.createServer();await new Promise(resolve=>reserve.listen(0,'127.0.0.1',resolve));
const port=reserve.address().port;await new Promise(resolve=>reserve.close(resolve));
const child=spawn(process.env.FIREFOX_BINARY || 'C:/Program Files/Mozilla Firefox/firefox.exe',['-headless','-no-remote','-profile',profile,'--remote-debugging-port',String(port)],{windowsHide:true,stdio:'ignore',env:{...process.env,MOZ_REMOTE_ALLOW_SYSTEM_ACCESS:'1'}});
const results={context:'installed Firefox export runner with synthetic HTTPS conversation and original files',checks:[]};
let socket;
try{
  socket=await until(async()=>{try{return await new Promise((resolve,reject)=>{const s=new WebSocket(`ws://127.0.0.1:${port}/session`);s.onopen=()=>resolve(s);s.onerror=reject;});}catch{return null;}},'Firefox startup');
  let sequence=0;const pending=new Map();let onRequest=()=>{};
  socket.onmessage=event=>{
    const message=JSON.parse(event.data),waiter=pending.get(message.id);
    if(waiter){pending.delete(message.id);clearTimeout(waiter.timer);message.type==='error'?waiter.reject(new Error(`${message.error}: ${message.message}`)):waiter.resolve(message.result);}
    else if(message.method==='network.beforeRequestSent' && message.params.isBlocked)onRequest(message.params).catch(error=>{results.networkError=error.message;});
  };
  const command=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(new Error(`WebDriver timeout: ${method}`));},20000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});
  const session=await command('session.new',{capabilities:{}});results.browser=`Firefox ${session.capabilities.browserVersion}`;
  await command('webExtension.install',{extensionData:{type:'path',path:path.join(root,'dist/firefox')}});
  const {context}=await command('browsingContext.create',{type:'tab'});
  await command('browsingContext.navigate',{context,url:`moz-extension://${uuid}/popup.html`,wait:'complete'});
  const evaluate=async(source,popup=false)=>{
    const response=await command('script.evaluate',{target:{context},expression:`(async()=>{${popup?'const w=browser.extension.getViews({type:"popup"})[0];if(!w)throw new Error("Popup unavailable");const document=w.document;':''}return JSON.stringify(await(async()=>{${source}})());})()`,awaitPromise:true,userActivation:true});
    if(response.type!=='success')throw new Error(response.exceptionDetails?.text || 'Evaluation failed');
    return response.result.value===undefined?undefined:JSON.parse(response.result.value);
  };
  const org='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',chat='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const large=Buffer.from(Array.from({length:700000},(_,i)=>i%251));
  const messages=Array.from({length:1000},(_,i)=>({uuid:`m${i}`,parent_message_uuid:i?`m${i-1}`:'00000000-0000-4000-8000-000000000000',sender:i%2?'assistant':'human',content:[{type:'text',text:Array.from({length:11},(_,j)=>`line-${i}-${j}`).join('\n')}],files:i===0?[{file_uuid:'original',file_name:'original.bin',size_bytes:large.length}]:[]}));
  messages[0].files[0].file_kind='blob';messages[0].files[0].path='/mnt/user-data/uploads/original.bin';
  messages.at(-1).content.push({type:'tool_result',content:[{type:'local_resource',file_path:'/mnt/user-data/outputs/missing.pdf'}]});
  const payload={uuid:chat,name:'Firefox synthetic long chat',current_leaf_message_uuid:'m999',chat_messages:[...messages,{uuid:'alternative',parent_message_uuid:'m998',sender:'assistant',content:[{type:'text',text:'HIDDEN ALTERNATIVE'}]}]};
  let hold=false,requested=false;
  onRequest=async event=>{
    const url=new URL(event.request.url);let body=Buffer.from('missing'),statusCode=404,headers={'Content-Type':'text/plain'};
    if(url.pathname===`/chat/${chat}`){statusCode=200;headers={'Content-Type':'text/html'};body=Buffer.from(`<!doctype html><title>Firefox synthetic chat</title><main><div data-testid="transcript-row" data-index="999" data-perf-row="assistant">line-999-10</div></main><script>fetch('/api/organizations/${org}/chat_conversations/${chat}?tree=True')</script>`);}
    else if(url.pathname.includes('/chat_conversations/')){statusCode=200;headers={'Content-Type':'application/json'};body=Buffer.from(JSON.stringify(payload));}
    else if(url.pathname.endsWith('/wiggle/download-file') && url.searchParams.get('path')==='/mnt/user-data/uploads/original.bin'){requested=true;while(hold)await pause(50);statusCode=200;headers={'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="original.bin"','X-Served-File-Size':String(large.length)};body=large;}
    else if(url.pathname==='/manual.bin'){statusCode=200;headers={'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="manual.bin"'};body=Buffer.from('unrelated native download');}
    await command('network.provideResponse',{request:event.request.request,statusCode,headers:Object.entries(headers).map(([name,value])=>({name,value:{type:'string',value}})),body:{type:'base64',value:body.toString('base64')}});
  };
  await command('session.subscribe',{events:['network.beforeRequestSent']});
  await command('network.addIntercept',{phases:['beforeRequestSent'],urlPatterns:[{type:'pattern',protocol:'https',hostname:'claude.ai'}]});
  await evaluate(`await browser.cookies.set({url:'https://claude.ai/',name:'lastActiveOrg',value:${JSON.stringify(org)},path:'/'});`);
  const source=await evaluate(`return (await browser.tabs.create({url:'https://claude.ai/chat/${chat}',active:true})).id`);
  await until(()=>evaluate(`return (await browser.tabs.get(${source})).status==='complete'`),'source navigation');
  await until(()=>evaluate(`return (await browser.scripting.executeScript({target:{tabId:${source}},func:()=>performance.getEntriesByType('resource').some(e=>e.name.includes('/chat_conversations/'))}))[0].result`),'source response observed');
  const job=()=>evaluate('return (await browser.storage.local.get("hotswapExportJobV2")).hotswapExportJobV2');
  const open=async()=>{
    await evaluate(`await browser.tabs.update(${source},{active:true});await browser.action.openPopup();`);
    await until(()=>evaluate('return browser.extension.getViews({type:"popup"}).some(w=>w.document.readyState==="complete" && !!w.document.getElementById("export-raw-btn"))'),'toolbar popup');
    await evaluate('document.getElementById("tab-btn-tools").click()',true);
  };
  const check=(condition,label)=>{assert.ok(condition,label);results.checks.push(label);console.log('PASS',label);};
  hold=true;await open();await evaluate('document.getElementById("export-raw-btn").click()',true);
  await until(async()=>{const current=await job();if(current?.status==='error')throw new Error(current.error);return requested;},'original read begins');
  await evaluate('browser.extension.getViews({type:"popup"})[0].close()');
  const manualId=await evaluate('return await browser.downloads.download({url:"https://claude.ai/manual.bin",filename:"manual.bin",saveAs:false})');
  await until(()=>evaluate(`return (await browser.downloads.search({id:${manualId}}))[0]?.state==='complete'`),'unrelated download');
  check(true,'unrelated native download survives while Firefox export is active');
  hold=false;
  const completed=await until(async()=>{const current=await job();return ['complete','incomplete','error'].includes(current?.status)?current:null;},'export completion');
  assert.notEqual(completed.status,'error',completed.error);
  check(completed.status==='incomplete','Firefox saves a clearly marked incomplete archive for missing files');
  const downloaded=await evaluate(`return (await browser.downloads.search({id:${completed.downloadId}}))[0]`);
  const entries=zipEntries(await readFile(downloaded.filename)),report=JSON.parse(entries.get('export-report.json')),transcript=entries.get('transcript.md').toString('utf8');
  check(report.messageCount===1000 && transcript.includes('line-0-0') && transcript.includes('line-500-5') && transcript.includes('line-999-10') && !transcript.includes('HIDDEN ALTERNATIVE'),'Firefox recovers 11,000 lines and only the displayed branch');
  assert.deepEqual(entries.get(report.files.find(f=>f.status==='saved').localPath),large);
  check(report.files.filter(f=>f.status==='failed').length===1,'Firefox transfers multi-chunk original bytes exactly and reports the missing file');
  await open();check(await evaluate('return document.getElementById("status").textContent.includes("Incomplete")',true),'Firefox popup reconnects after closing during export');
  check(await evaluate(`return (await browser.scripting.executeScript({target:{tabId:${source}},world:'MAIN',func:()=>window.__hotSwapExportReadersV2.size}))[0].result===0`),'Firefox releases MAIN reader after completion');
  hold=true;requested=false;await evaluate('document.getElementById("export-raw-btn").click()',true);await until(()=>requested,'second export');
  await evaluate('document.getElementById("export-cancel-btn").click()',true);await until(async()=>(await job()).status==='cancelled','cancelled');hold=false;
  check((await evaluate('return (await browser.downloads.search({})).filter(d=>d.filename.endsWith(".zip")).length'))===1,'Firefox cancellation saves no second archive');
  results.ok=true;
}catch(error){results.ok=false;results.error=error.message;console.error(error);process.exitCode=1;}
finally{await writeFile(path.join(root,'temp/export-firefox-results.json'),JSON.stringify(results,null,2)+'\n');socket?.close();child.kill();}
