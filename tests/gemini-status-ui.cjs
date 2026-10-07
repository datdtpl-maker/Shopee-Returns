const {_electron}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'srm-gemini-status-'));let app;
 try{
  app=await _electron.launch({args:['.'],cwd:path.resolve(__dirname,'..'),env:{...process.env,SRM_DRIVER:'1',SRM_DATA_DIR:dir}});const page=await app.firstWindow();await page.waitForFunction(()=>!!window.srm);
  const id=await app.evaluate(({app})=>{
   const {gemini,studio,store,products,scanner,replacementEditor}=app.srmDriver;
   const profile=store.addProfile('Shop kiểm tra');store.data.settings.autoScan=false;store.data.settings.replacementStudio.geminiModel='gemini-test-flash';store.save();
   products.ingest(profile.id,{shop:'shop.test',rows:[{productId:'123',modelId:'456',name:'Sản phẩm nguồn',variant:'',price:10000,stock:2}],total:1,pages:1,scannedAt:new Date().toISOString()});
   const job=studio.create({rowIds:[products.data.rows[0].id]})[0];studio.update(job.id,{prompt:'Viết bài từ tên mới.',name:'Sản phẩm mới'});
   scanner.context=replacementEditor.inspect=async()=>{throw Error('Không mở Shopee trong bài kiểm tra API');};
   gemini.secrets=()=>({geminiApiKey:'LOCAL_TEST_KEY'});gemini.sleep=async()=>{};
   globalThis.geminiTemporaryError=false;
   gemini.fetch=async url=>{
    const value=url.includes(':generateContent')?(globalThis.geminiTemporaryError?{error:{status:'UNAVAILABLE',message:'This model is currently experiencing high demand. LOCAL_TEST_KEY'}}:{candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({name:'Sản phẩm mới',description:'Mô tả đã viết.'})}]}}]}):{models:[{name:'models/gemini-test-flash',supportedGenerationMethods:['generateContent']}]};
    return {status:globalThis.geminiTemporaryError&&url.includes(':generateContent')?503:200,ok:!globalThis.geminiTemporaryError||!url.includes(':generateContent'),json:async()=>value};
   };
   return job.id;
  });
  await page.locator('nav [data-tab="replacements"]').click();
  await page.evaluate(()=>window.srm.call('studio-test'));
  let s=await page.evaluate(()=>window.srm.call('snapshot'));assert.equal(s.studioConfig.geminiFailed,false);assert.match(s.studioConfig.geminiStatus,/định dạng viết bài JSON/);assert.ok(s.studioConfig.geminiCheckedAt);assert.equal(s.studioConfig.geminiCheckedModel,'gemini-test-flash');
  await app.evaluate(()=>{globalThis.geminiTemporaryError=true;});
  await assert.rejects(page.evaluate(id=>window.srm.call('studio-generate',id),id),/quá tải/);
  await page.waitForFunction(()=>document.querySelector('#studio-gemini-status').classList.contains('studio-form-error'));
  s=await page.evaluate(()=>window.srm.call('snapshot'));assert.equal(s.studioConfig.geminiFailed,true);assert.match(s.studioConfig.geminiStatus,/quá tải/);assert.equal(s.studioConfig.geminiStatus.includes('thành công'),false);assert.equal(JSON.stringify(s).includes('LOCAL_TEST_KEY'),false);
  assert.match(await page.locator('#studio-gemini-status').textContent(),/gemini-test-flash/);
  await assert.rejects(page.evaluate(()=>window.srm.call('studio-test')),/quá tải/);assert.equal((await page.evaluate(()=>window.srm.call('snapshot'))).studioConfig.geminiFailed,true);
  await app.evaluate(()=>{globalThis.geminiTemporaryError=false;});
  await page.evaluate(()=>window.srm.call('studio-test'));assert.equal((await page.evaluate(()=>window.srm.call('snapshot'))).studioConfig.geminiFailed,false);assert.equal(await page.locator('#studio-gemini-status').evaluate(e=>e.classList.contains('studio-form-error')),false);
  await page.evaluate(()=>window.srm.call('studio-config',{geminiModel:'gemini-another-flash'}));s=await page.evaluate(()=>window.srm.call('snapshot'));assert.equal(s.studioConfig.geminiStatus,undefined);assert.equal(s.studioConfig.geminiCheckedAt,undefined);assert.equal(s.studioConfig.geminiFailed,undefined);
  console.log('PASS Gemini status: same writing-format connection check, failed generation and test replace stale success with model/time/error, recovery clears red state, model change invalidates evidence, no key leakage or Shopee browser.');
 }finally{if(app)await app.close();fs.rmSync(dir,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
