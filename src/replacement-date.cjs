const fail=message=>Object.assign(Error(message),{code:'REPLACEMENT_INVALID'});
const clean=value=>String(value??'').replace(/\s+/g,' ').trim();
const MAX_NAVIGATION=120;

function validateDate(value){
 const match=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(value));
 if(!match)throw fail('Ngày hết hạn phải có định dạng dd/mm/yyyy.');
 const [,dayText,monthText,yearText]=match,day=Number(dayText),month=Number(monthText),year=Number(yearText);
 const date=new Date(0);date.setUTCFullYear(year,month-1,day);date.setUTCHours(0,0,0,0);
 if(year<1||month<1||month>12||day<1||date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day)throw fail('Ngày hết hạn không phải ngày hợp lệ.');
 return {day,month,year,value:match[0]};
}

async function readMonth(panel){
 const labels=(await panel.locator('.eds-picker-header__label:visible').allTextContents()).map(clean);
 const monthLabel=labels.find(s=>/^Tháng \d{1,2}$/i.test(s)),yearLabel=labels.find(s=>/^\d{4}$/.test(s));
 if(labels.length!==2||!monthLabel||!yearLabel)throw fail('Không đọc được tháng và năm trên lịch Shopee. Chưa lưu.');
 const month=Number(monthLabel.match(/\d+/)[0]),year=Number(yearLabel);
 if(month<1||month>12||year<1)throw fail('Tháng hoặc năm trên lịch Shopee không hợp lệ. Chưa lưu.');
 return {month,year};
}

async function setDate(scope,value){
 const wanted=validateDate(value),picker=scope.locator('.eds-date-picker:visible');
 if(await picker.count()===0){
  const input=scope.locator('input:not([type=hidden]):not([type=checkbox]):not([type=file]):visible,textarea:visible');
  if(await input.count()!==1)throw fail('Không xác định duy nhất ô ngày hết hạn. Chưa lưu.');
  await input.fill(wanted.value);await input.blur();
  if(await input.inputValue()!==wanted.value)throw fail('Không xác minh được ngày hết hạn vừa nhập. Chưa lưu.');
  return;
 }
 if(await picker.count()!==1)throw fail('Không xác định duy nhất lịch ngày hết hạn. Chưa lưu.');
 const display=picker.locator('.eds-date-picker__input .eds-selector__inner');
 if(await display.count()!==1)throw fail('Không xác định duy nhất giá trị ngày hết hạn. Chưa lưu.');
 if(clean(await display.innerText())===wanted.value)return;
 await display.scrollIntoViewIfNeeded();await display.click();
 const panel=picker.locator('.eds-date-picker__picker:visible');
 await panel.waitFor({timeout:5000});
 if(await panel.count()!==1)throw fail('Không xác định duy nhất bảng lịch Shopee. Chưa lưu.');
 let current=await readMonth(panel);
 if(Math.abs(current.year-wanted.year)+Math.abs(current.month-wanted.month)>MAX_NAVIGATION)throw fail('Ngày yêu cầu vượt giới hạn điều hướng lịch. Chưa lưu.');
 for(let steps=0;current.year!==wanted.year||current.month!==wanted.month;steps++){
  if(steps>=MAX_NAVIGATION)throw fail('Lịch Shopee vượt giới hạn điều hướng. Chưa lưu.');
  const previous=panel.locator('.eds-picker-header__prev:visible'),next=panel.locator('.eds-picker-header__next:visible');
  if(await previous.count()!==2||await next.count()!==2)throw fail('Nút điều hướng lịch Shopee đã thay đổi. Chưa lưu.');
  const yearMove=current.year!==wanted.year;
  const forward=yearMove?wanted.year>current.year:wanted.month>current.month;
  const expected=yearMove?{year:current.year+(forward?1:-1),month:current.month}:{year:current.year,month:current.month+(forward?1:-1)};
  const control=forward?next.nth(yearMove?1:0):previous.nth(yearMove?0:1);
  if(await control.getAttribute('aria-disabled')==='true'||await control.evaluate(e=>e.classList.contains('disabled')||e.classList.contains('is-disabled')))throw fail('Shopee không cho chuyển đến ngày hết hạn yêu cầu. Chưa lưu.');
  await control.click();
  try{
   await panel.locator('.eds-picker-header__label:visible').filter({hasText:new RegExp('^'+expected.year+'$')}).waitFor({timeout:3000});
   await panel.locator('.eds-picker-header__label:visible').filter({hasText:new RegExp('^Tháng '+expected.month+'$','i')}).waitFor({timeout:3000});
  }catch{throw fail('Lịch Shopee không chuyển đúng tháng và năm. Chưa lưu.');}
  current=await readMonth(panel);
  if(current.year!==expected.year||current.month!==expected.month)throw fail('Lịch Shopee chuyển sai tháng và năm. Chưa lưu.');
 }
 const day=panel.locator('.eds-date-table__rows .eds-date-table__cell.normal:not(.disabled):not(.is-disabled):not(.out-of-month):not([aria-disabled=true]):visible').filter({hasText:new RegExp('^'+wanted.day+'$')});
 if(await day.count()!==1||await day.locator('.disabled,.is-disabled,[aria-disabled=true]').count())throw fail('Ngày hết hạn yêu cầu không có hoặc bị khóa trên Shopee. Chưa lưu.');
 await day.click();
 try{await display.filter({hasText:new RegExp('^'+wanted.value+'$')}).waitFor({timeout:3000});}catch{throw fail('Không xác minh được ngày hết hạn đã chọn trên Shopee. Chưa lưu.');}
 if(clean(await display.innerText())!==wanted.value)throw fail('Ngày hết hạn sau khi chọn không khớp yêu cầu. Chưa lưu.');
}

module.exports={setDate,validateDate};
