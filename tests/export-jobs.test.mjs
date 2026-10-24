import test from 'node:test';
import assert from 'node:assert/strict';
import { createExportJobs } from '../extension/export-jobs.js';

function fixture(initialOrg='org') {
  let handler,removed,connect,org=initialOrg,execute=async()=>({released:true});
  const data={},calls=[],cancelled=[];
  const tabs=new Map([[1,{id:1,url:'https://claude.ai/chat/chat'}]]);
  const runtime={id:'fixture',getURL:path=>`chrome-extension://fixture/${path}`,onMessage:{addListener:fn=>{handler=fn;}},onConnect:{addListener:fn=>{connect=fn;}},sendMessage:async()=>({})};
  globalThis.chrome={runtime,storage:{local:{get:async key=>structuredClone({[key]:data[key]}),set:async update=>{Object.assign(data,structuredClone(update));}}},tabs:{query:async()=>[tabs.get(1)],get:async id=>{if(!tabs.has(id))throw new Error('missing');return tabs.get(id);},create:async options=>{const tab={id:2,url:options.url};tabs.set(2,tab);return tab;},onRemoved:{addListener:fn=>{removed=fn;}}},scripting:{executeScript:async input=>{calls.push(input);return [{result:await execute(input.args[0])}];}},downloads:{search:async({id})=>[{id,url:'https://example.test/unrelated.pdf'}],cancel:async id=>cancelled.push(id)}};
  const jobs=createExportJobs({getOrgId:async()=>org});
  const popup={id:'fixture',url:runtime.getURL('popup.html')};
  const source={id:'fixture',url:'https://claude.ai/chat/chat',tab:{id:1}};
  const runner=id=>({id:'fixture',url:runtime.getURL(`export-runner.html#${id}`),tab:{id:2}});
  const request=(type,args={},sender=popup)=>new Promise(resolve=>handler({type:`HOTSWAP_EXPORT_${type}`,...args},sender,resolve));
  return {jobs,data,tabs,calls,cancelled,popup,source,runner,request,setOrg:value=>{org=value;},setExecute:fn=>{execute=fn;},remove:async id=>{tabs.delete(id);await removed(id);},connect:port=>connect(port)};
}

test('only the registered runner can relay page reads, and source/account identity is enforced',async()=>{
  const f=fixture(),job=await f.jobs.start();
  for(const sender of [f.source,{...f.runner(job.jobId),tab:{id:99}},{...f.runner(job.jobId),url:'chrome-extension://fixture/other.html'},{...f.runner(job.jobId),id:'other'}]) {
    assert.equal((await f.request('PAGE',{jobId:job.jobId,action:'snapshot'},sender)).ok,false);
  }
  assert.equal(f.calls.length,0);
  f.setOrg('different');
  assert.equal((await f.request('PAGE',{jobId:job.jobId,action:'snapshot'},f.runner(job.jobId))).error,'SOURCE_ACCOUNT_CHANGED');
  f.setOrg('org');f.tabs.get(1).url='https://claude.ai/chat/other';
  assert.equal((await f.request('PAGE',{jobId:job.jobId,action:'snapshot'},f.runner(job.jobId))).error,'SOURCE_NAVIGATED');
  assert.equal(f.calls.length,0);
});
test('session work serializes before export and refreshes defer until cancellation',async()=>{
  const f=fixture(),order=[];
  let release;
  const first=f.jobs.withSession(async()=>{order.push('refresh');await new Promise(resolve=>{release=resolve;});order.push('restored');});
  const start=f.jobs.start().then(value=>{order.push('export');return value;});
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(order,['refresh']);release();await first;await start;
  assert.deepEqual(order,['refresh','restored','export']);
  await assert.rejects(()=>f.jobs.withSession(async()=>order.push('wrong swap')),/deferred/);
  await f.jobs.cancel();
  await f.jobs.withSession(async()=>order.push('refresh after cancel'));
  assert.equal(order.at(-1),'refresh after cancel');
});
test('a late snapshot response cannot resurrect a cancelled export',async()=>{
  const f=fixture(null),job=await f.jobs.start();
  let replySnapshot,entered;
  const started=new Promise(resolve=>{entered=resolve;});
  f.setExecute(async options=>{if(options.action==='snapshot'){entered();return new Promise(resolve=>{replySnapshot=resolve;});}return {released:true};});
  const reading=f.request('PAGE',{jobId:job.jobId,action:'snapshot'},f.runner(job.jobId));
  await started;await f.jobs.cancel();
  replySnapshot({source:'api',orgId:'org',length:10});
  await reading;
  assert.equal(f.data.hotswapExportJobV2.status,'cancelled');
});
test('an unrelated download cannot become owned by the export',async()=>{
  const f=fixture(),job=await f.jobs.start();
  assert.equal((await f.request('DOWNLOAD',{jobId:job.jobId,downloadId:42},f.runner(job.jobId))).ok,false);
  assert.equal(f.data.hotswapExportJobV2.downloadId,undefined);
  await f.jobs.cancel();
  assert.deepEqual(f.cancelled,[]);
});
test('page scripts cannot cancel exports or subscribe as the popup',async()=>{
  const f=fixture(),job=await f.jobs.start();
  assert.equal((await f.request('CANCEL',{jobId:job.jobId},f.source)).ok,false);
  assert.equal(f.data.hotswapExportJobV2.status,'starting');
  let disconnected=false;
  f.connect({name:'export-chat',sender:f.source,disconnect:()=>{disconnected=true;}});
  assert.equal(disconnected,true);
});
test('closing the registered runner cancels only its job',async()=>{
  const f=fixture();await f.jobs.start();
  await f.remove(2);
  assert.equal(f.data.hotswapExportJobV2.status,'cancelled');
});

test('summary capture verifies the source and releases the reader on a changed branch',async()=>{
  const f=fixture();
  const text=JSON.stringify({uuid:'chat',name:'Synthetic',current_leaf_message_uuid:'a',chat_messages:[{uuid:'a',parent_message_uuid:'00000000-0000-4000-8000-000000000000',sender:'human',content:[{type:'text',text:'original'}]}]});
  f.setExecute(async args=>({snapshot:{source:'api',orgId:'org',length:text.length},textChunk:{offset:0,text},textAck:{acknowledged:true},verify:{unchanged:false},release:{released:true}}[args.action]));
  await assert.rejects(()=>f.jobs.readForSummary(f.tabs.get(1)),/changed during capture/);
  assert.equal(f.calls.at(-1).args[0].action,'release');
});
