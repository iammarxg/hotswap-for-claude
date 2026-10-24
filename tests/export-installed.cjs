// Real MV3 export pipeline in an isolated profile; all conversation/file traffic is synthetic.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || process.argv[2] || 'playwright');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const org='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',chat='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const until=async(operation,label,timeout=45000)=>{const end=Date.now()+timeout;while(Date.now()<end){const out=await operation();if(out)return out;await delay(100);}throw new Error(`Timed out: ${label}`);};
function zipEntries(buffer){
  const out=new Map();let position=0;
  while(buffer.readUInt32LE(position)===0x04034b50){
    assert.equal(buffer.readUInt16LE(position+8),0);
    const length=buffer.readUInt32LE(position+18),nameLength=buffer.readUInt16LE(position+26),extra=buffer.readUInt16LE(position+28);
    const name=buffer.subarray(position+30,position+30+nameLength).toString('utf8');
    const start=position+30+nameLength+extra;
    out.set(name,buffer.subarray(start,start+length));position=start+length;
  }
  assert.equal(buffer.readUInt32LE(position),0x02014b50);
  assert.equal(buffer.readUInt16LE(buffer.length-12),out.size);
  return out;
}
(async()=>{
  const profile=await fs.mkdtemp(path.join(root,'temp/export-installed-'));
  const downloads=path.join(profile,'downloads');await fs.mkdir(downloads);
  const extension=path.join(root,'dist/chrome');
  const context=await chromium.launchPersistentContext(profile,{headless:true,executablePath:process.env.CHROMIUM_BINARY || process.argv[3] || chromium.executablePath(),args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`],acceptDownloads:true});
  const checks=[];
  const check=(condition,label)=>{assert.ok(condition,label);checks.push(label);console.log('PASS',label);};
  try{
    const worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    context.on('page',page=>{page.on('pageerror',error=>console.log('Fixture page error:',error.message));page.on('console',message=>{if(message.type()==='error')console.log('Fixture console:',message.text());});});
    const base=worker.url().replace(/background\.js$/,'');
    const cdp=await context.newCDPSession(context.pages()[0]);
    await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads});
    const fixtures=new Map();
    for(const extension of ['html','js','css','md','zip','xpi','pdf','pptx','bat','sh','png','jpg','webp','csv','json','txt']) fixtures.set(`/mnt/user-data/outputs/${extension}/same.${extension}`,Buffer.from(`synthetic ${extension}\r\n\u0000\u00ff`));
    fixtures.set('/mnt/user-data/outputs/large.zip',Buffer.from(Array.from({length:700000},(_,i)=>i%251)));
    fixtures.set('/mnt/user-data/outputs/empty.txt',Buffer.alloc(0));
    fixtures.set('/mnt/user-data/outputs/retry.bin',Buffer.from('complete after a deliberately short response'));
    const generated=[...fixtures.keys(),'/mnt/user-data/outputs/missing.pdf','/mnt/user-data/outputs/oversized.zip'];
    const messages=Array.from({length:1000},(_,i)=>({uuid:`message-${i}`,parent_message_uuid:i?`message-${i-1}`:'00000000-0000-4000-8000-000000000000',sender:i%2?'assistant':'human',content:[{type:'text',text:`${'repeated prefix '.repeat(12)}\n${Array.from({length:10},(_,j)=>`sentinel-${i}-${j}`).join('\n')}`}],files:i===0?[{file_uuid:'upload',file_name:'original.png',file_kind:'image',size_bytes:13}]:[]}));
    messages.at(-1).content.push({type:'tool_result',content:generated.map(file_path=>({type:'local_resource',file_path,mime_type:'application/octet-stream'}))});
    messages[0].files.push({file_uuid:'uploaded-blob',file_kind:'blob',path:'/mnt/user-data/uploads/input.pptx',file_name:'input.pptx',size_bytes:16});
    const payload={uuid:chat,name:'Synthetic long chat',current_leaf_message_uuid:'message-999',updated_at:'fixed',chat_messages:[...messages,{uuid:'alternate',parent_message_uuid:'message-998',sender:'assistant',content:[{type:'text',text:'THIS ALTERNATE MUST NOT APPEAR'}]}]};
    let retry=0,hold=false,requestedFile=false;
    await context.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if (!['https:','http:'].includes(url.protocol)) return route.continue();
      if(url.hostname==='claude.ai' && url.pathname===`/chat/${chat}`) return route.fulfill({contentType:'text/html',body:`<!doctype html><title>Synthetic long chat - Claude</title><button id="manual" onclick="const a=document.createElement('a');a.href='https://example.test/manual.bin';a.download='manual.bin';document.body.appendChild(a);a.click();a.remove();">Manual file</button><main data-autoscroll-container="true"><div data-testid="transcript-list"><div data-testid="transcript-row" data-index="999" data-perf-row="assistant"><article role="article" aria-posinset="1000" aria-setsize="1000"><div class="font-claude-response-body">sentinel-999-9</div></article></div></div></main><script>fetch('/api/organizations/${org}/chat_conversations/${chat}?tree=True')</script>`});
      if(url.pathname.includes(`/chat_conversations/${chat}`)) return route.fulfill({json:payload});
      if(url.pathname.endsWith('/files/upload/contents')) return route.fulfill({body:Buffer.from('originalbytes'),headers:{'content-type':'image/png','content-disposition':'attachment; filename="original.png"','x-served-file-size':'13'}});
      if(url.pathname.endsWith('/wiggle/download-file')){
        requestedFile=true;
        while(hold)await delay(50);
        const filePath=url.searchParams.get('path');
        if(filePath==='/mnt/user-data/outputs/oversized.zip')return route.fulfill({body:Buffer.from('not transferred'),headers:{'content-type':'application/zip','content-disposition':'attachment; filename="oversized.zip"','x-served-file-size':'4294967295'}});
        if(filePath==='/mnt/user-data/uploads/input.pptx')return route.fulfill({body:Buffer.from('original blob\r\n\u0000'),headers:{'content-type':'application/octet-stream','content-disposition':'attachment; filename="input.pptx"','x-served-file-size':'16'}});
        const bytes=fixtures.get(filePath);
        if(!bytes)return route.fulfill({status:404,body:'missing'});
        const body=filePath.endsWith('retry.bin') && retry++===0?bytes.subarray(0,4):bytes;
        return route.fulfill({body,headers:{'content-type':'application/octet-stream','content-disposition':`attachment; filename="${path.basename(filePath)}"`,'x-served-file-size':String(bytes.length)}});
      }
      if(url.hostname==='example.test')return route.fulfill({body:'unrelated download',headers:{'content-type':'application/octet-stream','content-disposition':'attachment; filename="manual.bin"'}});
      return route.fulfill({status:404,body:'synthetic route not found'});
    });
    await context.addCookies([{name:'lastActiveOrg',value:org,domain:'claude.ai',path:'/'}]);
    await worker.evaluate(async org=>chrome.cookies.set({url:'https://claude.ai/',name:'lastActiveOrg',value:org,path:'/'}),org);
    const source=await context.newPage();await source.goto(`https://claude.ai/chat/${chat}`);await source.waitForFunction(()=>performance.getEntriesByType('resource').some(entry=>entry.name.includes('/chat_conversations/')));await source.bringToFront();
    let sequence=0,sessionId,targetId;
    const pending=new Map();
    cdp.on('Target.receivedMessageFromTarget',event=>{const message=JSON.parse(event.message),waiter=pending.get(message.id);if(waiter){pending.delete(message.id);clearTimeout(waiter.timer);message.error?waiter.reject(new Error(message.error.message)):waiter.resolve(message.result);}});
    const command=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`CDP timeout: ${method}`));},20000);pending.set(id,{resolve,reject,timer});cdp.send('Target.sendMessageToTarget',{sessionId,message:JSON.stringify({id,method,params})}).catch(reject);});
    const evaluate=async expression=>{const response=await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});if(response.exceptionDetails)throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);return response.result.value;};
    const open=async()=>{
      await until(async()=>{try{await worker.evaluate(()=>chrome.action.openPopup());return true;}catch{return false;}},'open toolbar popup',15000);
      const target=await until(async()=>(await cdp.send('Target.getTargets')).targetInfos.find(t=>t.url===base+'popup.html'),'popup target');targetId=target.targetId;
      ({sessionId}=await cdp.send('Target.attachToTarget',{targetId,flatten:false}));
      await until(()=>evaluate('document.readyState === "complete"'),'popup ready');
      await evaluate('document.getElementById("tab-btn-tools").click()');
    };
    const job=async()=>worker.evaluate(async()=> (await chrome.storage.local.get('hotswapExportJobV2')).hotswapExportJobV2);
    const manual=async()=>{
      const existing=new Set((await worker.evaluate(()=>chrome.downloads.search({url:'https://example.test/manual.bin'}))).map(item=>item.id));
      await source.locator('#manual').click();
      try {return await until(async()=> (await worker.evaluate(async()=>chrome.downloads.search({url:'https://example.test/manual.bin'}))).find(item=>!existing.has(item.id)&&item.state==='complete'),'manual download',15000);}
      catch(error){console.log('Download diagnostics',await worker.evaluate(()=>chrome.downloads.search({})));throw error;}
    };
    await manual();check(true,'ordinary manual download works before export');
    hold=true;await open();await evaluate('document.getElementById("export-raw-btn").click()');
    await until(async()=>{const current=await job();if(current?.status==='error')throw new Error(`Export failed before file read: ${JSON.stringify(current)}`);return requestedFile;},'file read begins',15000).catch(async error=>{console.log('Job diagnostics',await job());console.log('Runner tabs',await worker.evaluate(()=>chrome.tabs.query({})));for(const page of context.pages()){if(page.url().includes('export-runner'))console.log('Runner body',await page.locator('body').innerText({timeout:2000}).catch(()=>'(not loaded)'));}console.log('Popup diagnostics',await evaluate('document.body.innerText'));throw error;});
    await manual();check(true,'unrelated native download survives during active export');
    await cdp.send('Target.closeTarget',{targetId}).catch(()=>{});
    hold=false;
    const complete=await until(async()=>{const value=await job();return ['complete','incomplete','error'].includes(value?.status)?value:null;},'export completed');
    assert.notEqual(complete.status,'error',complete.error);
    check(complete.status==='incomplete','missing file produces an explicitly incomplete export');
    const [download]=await worker.evaluate(async id=>chrome.downloads.search({id}),complete.downloadId);
    const entries=zipEntries(await fs.readFile(download.filename));
    const report=JSON.parse(entries.get('export-report.json'));
    const transcript=entries.get('transcript.md').toString('utf8');
    check(report.messageCount===1000 && transcript.includes('sentinel-0-0') && transcript.includes('sentinel-500-5') && transcript.includes('sentinel-999-9'),'full 1,000-turn transcript retained despite one mounted DOM row');
    check(!transcript.includes('THIS ALTERNATE MUST NOT APPEAR'),'hidden alternative branch excluded');
    for(const file of report.files.filter(file=>file.status==='saved')){
      const expected=file.source==='upload'?Buffer.from(file.fileKind==='blob'?'original blob\r\n\u0000':'originalbytes'):fixtures.get(file.filePath);
      assert.deepEqual(entries.get(file.localPath),expected,file.filename);
    }
    check(report.files.filter(file=>file.status==='failed').length===2 && !transcript.includes('](attachments/020-missing.pdf)'),'every recovered file has exact original bytes and failed file has no local link');
    check(report.files.some(file=>file.filename==='oversized.zip' && file.error==='ZIP_CAPACITY_EXCEEDED') && entries.has('export-report.json'),'oversized attachment leaves room for the transcript and detailed failure report');
    check(retry===2,'short response retried and complete bytes recovered');
    check(await source.evaluate(()=>window.__hotSwapExportReadersV2.size)===0,'MAIN reader released immediately after completion');
    const runner=context.pages().find(page=>page.url().startsWith(base+'export-runner.html'));
    check(await runner.evaluate(async()=>{const request=indexedDB.open('hotswap-export-staging-v2',1);return new Promise(resolve=>{request.onsuccess=()=>{const db=request.result;const count=db.transaction('chunks').objectStore('chunks').count();count.onsuccess=()=>{db.close();resolve(count.result===0);};};});}),'temporary file chunks cleared');
    await source.bringToFront();await open();
    check(await evaluate('document.getElementById("status").textContent.includes("Incomplete")'),'reopened popup reconnects to final export result');
    await cdp.send('Target.closeTarget',{targetId});
    await manual();check(true,'ordinary manual download works immediately after export');
    // Repeated export plus explicit cancellation must save no additional ZIP.
    hold=true;requestedFile=false;await source.bringToFront();await open();await evaluate('document.getElementById("export-raw-btn").click()');
    await until(()=>requestedFile,'second export starts');
    await evaluate('document.getElementById("export-cancel-btn").click()');
    await until(async()=> (await job()).status==='cancelled','cancelled state');hold=false;
    check(await source.evaluate(()=>window.__hotSwapExportReadersV2.size)===0,'cancellation aborts and releases page reader');
    const zips=await worker.evaluate(async()=> (await chrome.downloads.search({})).filter(item=>item.filename.endsWith('.zip')));
    check(zips.length===1,'explicit cancellation creates no second archive');
    await fs.writeFile(path.join(root,'temp/export-installed-results.json'),JSON.stringify({browser:context.browser()?.version(),checks,profile},null,2));
  } finally {await context.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
