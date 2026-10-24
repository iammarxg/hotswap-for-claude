// The actual serialized reader against synthetic delayed/recycled browser DOM.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || process.argv[2] || 'playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const org='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',chat='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const checks=[];
const check=(condition,label)=>{assert.ok(condition,label);checks.push(label);console.log('PASS',label);};
(async()=>{
  const {exportClaudeConversationInPage:reader}=await import(pathToFileURL(path.resolve(__dirname,'../extension/export-reader.js')));
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_BINARY || process.argv[3] || chromium.executablePath()});
  try{
    const context=await browser.newContext();
    await context.route('https://claude.ai/**',route=>route.request().url().includes('/api/')?route.fulfill({status:503,body:'temporarily unavailable'}):route.fulfill({contentType:'text/html',body:'<!doctype html><title>Synthetic fallback - Claude</title><body></body>'}));
    const page=await context.newPage();
    const setup=async({missing=false,unknown=false,total=100}={})=>{
      await page.goto(`https://claude.ai/chat/${chat}`);
      await page.evaluate(({missing,unknown,total})=>{
        const scroll=document.createElement('main');scroll.dataset.autoscrollContainer='true';scroll.style.cssText='height:320px;overflow:auto;position:relative';
        const list=document.createElement('div');list.dataset.testid='transcript-list';list.style.cssText=`height:${total*100}px;position:relative`;scroll.append(list);document.body.append(scroll);
        const pool=Array.from({length:6},()=>{const row=document.createElement('div');row.dataset.testid='transcript-row';row.dataset.perfRow='assistant';row.style.position='absolute';const article=document.createElement('article');article.setAttribute('role','article');article.setAttribute('aria-setsize',String(total));const content=document.createElement('div');content.className='font-claude-response-body';article.append(content);row.append(article);list.append(row);return row;});
        const render=()=>{
          const start=Math.floor(scroll.scrollTop/100);
          for(let offset=0;offset<pool.length;offset++){
            const index=start+offset,row=pool[offset];
            row.hidden=index>=total || missing&&index===31;
            if(row.hidden)continue;
            row.style.top=`${index*100}px`;
            if(!unknown){row.dataset.index=String(index);row.firstChild.setAttribute('aria-posinset',String(index+1));}
            row.firstChild.firstChild.replaceChildren(document.createTextNode(`turn-${index}\n${Array.from({length:14},(_,line)=>`line-${index}-${line}`).join('\n')}`));
            if(index===12){const pre=document.createElement('pre'),code=document.createElement('code');code.className='language-js';code.textContent='  const exact = 1;\n\n\n  end();\n';pre.append(code);row.firstChild.firstChild.append(pre);}
            if(index===13){const table=document.createElement('table');table.innerHTML='<tr><th>A</th><th>B</th></tr><tr><td>x</td><td>y</td></tr>';row.firstChild.firstChild.append(table);}
          }
        };
        let pending;
        scroll.addEventListener('scroll',()=>{clearTimeout(pending);pending=setTimeout(render,70);});
        scroll.scrollTop=1800;render();
      },{missing,unknown,total});
    };
    const capture=async(jobId)=>{
      const metadata=await page.evaluate(reader,{jobId,chatId:chat,orgId:org,action:'snapshot'});
      let offset=0;const parts=[];
      while(offset<metadata.length){const chunk=await page.evaluate(reader,{jobId,chatId:chat,orgId:org,action:'textChunk',offset});parts.push(chunk.text);offset+=chunk.text.length;}
      await page.evaluate(reader,{jobId,chatId:chat,orgId:org,action:'textAck',offset});
      await page.evaluate(reader,{jobId,chatId:chat,orgId:org,action:'release'});
      return JSON.parse(parts.join(''));
    };
    await setup();
    const out=await capture('complete');
    check(out.messages.length===100 && out.completeness.complete,'overlapping traversal captures every delayed/recycled row');
    check(out.messages.every((message,index)=>message.text.startsWith(`turn-${index}\n`)),'fallback ordering is chronological when capture begins midway');
    check(out.messages[12].text.includes('  const exact = 1;\n\n\n  end();\n'),'fallback preserves code indentation and blank lines');
    check(out.messages[13].text.includes('| A | B |\n| --- | --- |\n| x | y |'),'fallback preserves table cells and columns');
    check(await page.locator('main').evaluate(element=>element.scrollTop)===1800,'original scroll position restored');
    await setup({missing:true});
    const hole=await capture('missing');
    check(!hole.completeness.complete && hole.messages.length===99,'missing middle row cannot be reported complete');
    await setup({unknown:true,total:5});
    const unknown=await capture('unknown');
    check(!unknown.completeness.complete && unknown.messages.length>=5,'missing indices retain recovered rows with incomplete coverage');
    await setup();
    const running=page.evaluate(reader,{jobId:'cancel',chatId:chat,orgId:org,action:'snapshot'}).then(()=>false,error=>error.message.includes('CANCELLED'));
    await page.waitForFunction(()=>document.querySelector('main').scrollTop>0 && document.querySelector('main').scrollTop<1800);
    await page.evaluate(reader,{jobId:'cancel',chatId:chat,orgId:org,action:'cancel'});
    check(await running,'cancellation aborts a running fallback scan');
    check(await page.locator('main').evaluate(element=>element.scrollTop)===1800,'cancelled fallback restores scroll position');
    await require('node:fs/promises').writeFile(path.resolve(__dirname,'../temp/export-dom-results.json'),JSON.stringify({checks},null,2));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
