const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {chromium} = require('playwright');
const sharp = require('sharp');
const {ChatGPTImages} = require('../src/studio-chatgpt.cjs');
const jobId = 'aaaaaaaa-1234-4567-abcd-123456789abc';
const raster = n => sharp({create:{width:600,height:600,channels:3,background:{r:30+n*30,g:60,b:80}}}).png().toBuffer();

test('CDP attaches the chosen reference to the composer with multiple inputs and waits for every saved image before sending the next prompt', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'srm-cdp-flow-'));
  t.after(() => fs.rmSync(dir, {recursive:true,force:true}));
  const executablePath = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean).map(p => path.join(p,'Google','Chrome','Application','chrome.exe')).find(p=>fs.existsSync(p));
  const browser = await chromium.launch({headless:true, ...(executablePath ? {executablePath} : {})}); t.after(()=>browser.close());
  const page = await browser.newPage();
  await page.setContent(`<input type="file" accept="image/*" id="unrelated"><form id="composer"><textarea id="prompt-textarea"></textarea><input hidden type="file" accept="image/*" id="image"><input hidden type="file" accept="image/*" id="camera"><button type="button" id="composer-plus-btn" onclick="document.querySelector('#menu').hidden=false">Add</button><div role="menu" id="menu" hidden><button type="button" role="menuitem" onclick="document.querySelector('#image').click()">Add photos &amp; files</button></div><button type="button" data-testid="send-button">Send</button></form>`);
  let sent=0, saved=0, clock=0, text='', attached=false;
  await page.exposeFunction('sentPrompt',()=>{assert.equal(sent,saved,'next prompt cannot precede durable save');sent++;text='';attached=false;});
  await page.evaluate(()=>document.querySelector('[data-testid="send-button"]').onclick=()=>window.sentPrompt());
  const sample = await raster(0), editor = await page.$('#prompt-textarea');
  const client = new ChatGPTImages(dir,()=>({}),()=>{}, {
    now:()=>clock,pause:async ms=>{clock+=ms;},
    connectBoundChatGpt:async()=>({page,browser:{close:async()=>{}}}),
    downloadImage:async()=>{throw Error('The selected reference must not be replaced by a Shopee download');},findEditor:async()=>editor,
    composerText:async()=>text,attachmentState:async()=>({count:attached?1:0,busy:false,error:false}),
    fillChatGptPrompt:async(_editor,prompt)=>{text=prompt;attached=true;},
    createImageRequestTracker:async()=>({assertConversation:async()=>{},poll:async()=>({phase:'image-ready',candidate:{image:{dispose:async()=>{}}}})})
  });
  client.original=async()=>({data:await raster(sent),ext:'png'});
  const args={jobId,name:'Tên mới',description:'Bài đã xem',sourceImages:['https://down-vn.img.susercontent.com/reference.jpg'],reference:{name:'sample.png',dataUrl:'data:image/png;base64,'+sample.toString('base64')},prompts:Array.from({length:5},(_,i)=>({text:'Prompt '+(i+1)})),onImage:async ({index,buffer})=>{
    assert.equal(sent,index+1);assert.equal(saved,index);
    assert.equal((await sharp(buffer).metadata()).format,'png');
    await new Promise(resolve=>setTimeout(resolve,5));saved++;
  }};
  const result=await client.generate(args);
  assert.equal(result.images.length,5);assert.equal(saved,5);assert.equal(sent,5);
  assert.equal(await page.locator('#unrelated').evaluate(e=>e.files.length),0);
  assert.equal(await page.locator('#camera').evaluate(e=>e.files.length),0);
  assert.equal(await page.locator('#image').evaluate(e=>e.files[0].name),'reference.png');
  const uploaded=Buffer.from(await page.locator('#image').evaluate(async e=>Array.from(new Uint8Array(await e.files[0].arrayBuffer()))));
  assert.ok(uploaded.equals(await sharp(sample).rotate().png().toBuffer()));
  assert.ok(result.images.every(image=>image.filename.endsWith('.png')));
});

test('managed debug endpoint must match the isolated profile file, not another Chrome port', t=>{
  const {profileEndpoint,ownsDebugEndpoint}=require('../src/chatgpt/chatgpt-session.js');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'srm-endpoint-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'DevToolsActivePort');
  fs.writeFileSync(file,'19224\n/devtools/browser/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa\n');
  const {endpoint,port}=profileEndpoint(dir);assert.equal(port,19224);
  assert.equal(ownsDebugEndpoint(dir,endpoint),true);
  assert.equal(ownsDebugEndpoint(dir,endpoint.replace('19224','19225')),false);
  assert.equal(ownsDebugEndpoint(dir,endpoint.replace('/browser/a','/browser/b')),false);
  fs.writeFileSync(file,'80\n/devtools/browser/aaaaaaaa\n');assert.throws(()=>profileEndpoint(dir));
  fs.writeFileSync(file,'19224\nhttps://untrusted.invalid/\n');assert.throws(()=>profileEndpoint(dir));
});
