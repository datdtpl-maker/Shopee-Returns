const {test}=require('node:test');const assert=require('node:assert/strict');
const {chromium}=require('playwright');const {setDate,validateDate}=require('../src/replacement-date.cjs');

async function fixture(t,{disabled=[],stuck=false}={}){
 const browser=await chromium.launch({channel:'chrome',headless:true});t.after(()=>browser.close());const page=await browser.newPage();
 await page.setContent('<div id="field"><div class="eds-date-picker"><div class="eds-date-picker__input"><div class="eds-selector__inner">31/12/2026</div></div><div class="eds-popper eds-date-picker__picker" style="display:none"></div></div></div>');
 await page.evaluate(({disabled,stuck})=>{
  const display=document.querySelector('.eds-selector__inner'),panel=document.querySelector('.eds-date-picker__picker');
  window.dateState={year:2026,month:12,clicks:[],opened:0,selected:0};
  const render=()=>{
   const state=window.dateState,days=new Date(state.year,state.month,0).getDate();
   panel.innerHTML='<div class="eds-picker-header"><i class="eds-picker-header__prev">«</i><i class="eds-picker-header__prev">‹</i><span class="eds-picker-header__label">Tháng '+state.month+'</span><span class="eds-picker-header__label">'+state.year+'</span><span class="eds-picker-header__label" style="display:none">2020 – 2029</span><i class="eds-picker-header__next">›</i><i class="eds-picker-header__next">»</i></div><div class="eds-date-table__rows"><div class="eds-date-table__cell out-of-month">29</div>'+Array.from({length:days},(_,i)=>'<div class="eds-date-table__cell normal'+(disabled.includes(i+1)?' disabled':'')+'"><span class="eds-date-table__cell-inner">'+(i+1)+'</span></div>').join('')+'<div class="eds-date-table__cell out-of-month">1</div></div>';
   [...panel.querySelectorAll('.eds-picker-header__prev,.eds-picker-header__next')].forEach((button,index)=>button.onclick=()=>{
    state.clicks.push(index);if(stuck)return;
    if(index===0)state.year--;if(index===3)state.year++;if(index===1)state.month--;if(index===2)state.month++;
    if(state.month===0){state.month=12;state.year--;}if(state.month===13){state.month=1;state.year++;}render();
   });
   [...panel.querySelectorAll('.eds-date-table__cell')].forEach(day=>day.onclick=()=>{
    state.selected++;display.textContent=day.textContent.padStart(2,'0')+'/'+String(state.month).padStart(2,'0')+'/'+state.year;panel.style.display='none';
   });
  };
  render();display.onclick=()=>{window.dateState.opened++;panel.style.display='block';};
 },{disabled,stuck});
 return {page,scope:page.locator('#field')};
}

test('date validation checks real calendar days including leap years',()=>{
 assert.deepEqual(validateDate('29/02/2028'),{day:29,month:2,year:2028,value:'29/02/2028'});
 for(const value of ['29/02/2027','31/04/2026','00/12/2026','15/13/2026','01/01/0000','1/12/2026','2026-12-31',null])assert.throws(()=>validateDate(value),/Ngày hết hạn/);
 assert.equal(validateDate('01/01/0099').year,99);
});
test('unchanged expiry does not open or mutate the picker',async t=>{
 const {page,scope}=await fixture(t);await setDate(scope,'31/12/2026');assert.equal((await page.evaluate(()=>window.dateState)).opened,0);
});
test('navigates the real year and month controls and chooses a normal day only',async t=>{
 const {page,scope}=await fixture(t);await setDate(scope,'29/02/2028');const state=await page.evaluate(()=>window.dateState);
 assert.deepEqual(state.clicks.slice(0,2),[3,3]);assert.equal(state.clicks.slice(2).every(i=>i===1),true);assert.equal(state.selected,1);assert.equal(await page.locator('.eds-selector__inner').innerText(),'29/02/2028');
 await setDate(scope,'01/11/2025');const updated=await page.evaluate(()=>window.dateState);assert.deepEqual(updated.clicks.slice(12,15),[0,0,0]);assert.equal(updated.clicks.slice(15).every(i=>i===2),true);assert.equal(updated.selected,2);assert.equal(await page.locator('.eds-selector__inner').innerText(),'01/11/2025');
});
test('disabled days fail without selecting the matching out-of-month date',async t=>{
 const {page,scope}=await fixture(t,{disabled:[29]});await assert.rejects(setDate(scope,'29/12/2026'),/bị khóa/);assert.equal((await page.evaluate(()=>window.dateState)).selected,0);assert.equal(await page.locator('.eds-selector__inner').innerText(),'31/12/2026');
});
test('invalid dates and excessive navigation fail before selecting any date',async t=>{
 const {page,scope}=await fixture(t);await assert.rejects(setDate(scope,'31/02/2026'),/hợp lệ/);assert.equal((await page.evaluate(()=>window.dateState)).opened,0);
 await assert.rejects(setDate(scope,'01/12/9999'),/giới hạn/);assert.deepEqual((await page.evaluate(()=>window.dateState)).clicks,[]);
});
test('changed picker navigation and stalled controls fail without choosing a date',async t=>{
 const {page,scope}=await fixture(t,{stuck:true});await assert.rejects(setDate(scope,'01/12/2027'),/không chuyển đúng/);assert.equal((await page.evaluate(()=>window.dateState)).selected,0);
 await page.locator('.eds-picker-header__prev').first().evaluate(e=>e.remove());await assert.rejects(setDate(scope,'01/11/2026'),/đã thay đổi/);assert.equal((await page.evaluate(()=>window.dateState)).selected,0);
});
test('supports the plain input fixture when Shopee picker is absent',async t=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});t.after(()=>browser.close());const page=await browser.newPage();await page.setContent('<div id="field"><input value="31/12/2026"></div>');
 await setDate(page.locator('#field'),'30/11/2027');assert.equal(await page.locator('input').inputValue(),'30/11/2027');
 await page.locator('#field').evaluate(e=>e.insertAdjacentHTML('beforeend','<input>'));await assert.rejects(setDate(page.locator('#field'),'01/01/2028'),/duy nhất/);
});
