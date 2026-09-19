const TEXT=['notionToken','telegramToken','chatId','sheetUrl','notionPageId','notionDatabaseId'];
const FLAGS=['autoScan','telegramEnabled','notionEnabled','startWithWindows','keepAwake','closeToTray'];
function connectionInput(input){
  if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Cấu hình phải là một đối tượng JSON.');
  const result={};
  for(const key of Object.keys(input)){
    if(![...TEXT,...FLAGS,'intervalMinutes'].includes(key))throw Error('File chứa trường cấu hình không được hỗ trợ.');
    const value=input[key];
    if(TEXT.includes(key)&&(typeof value!=='string'||value.length>4096))throw Error('Trường văn bản cấu hình không hợp lệ.');
    if(FLAGS.includes(key)&&typeof value!=='boolean')throw Error('Tuỳ chọn cấu hình phải là true hoặc false.');
    if(key==='intervalMinutes'&&typeof value!=='number'&&typeof value!=='string')throw Error('Chu kỳ quét không hợp lệ.');
    result[key]=value;
  }
  return result;
}
function notionIds(input,current){
  const result={};
  for(const key of ['notionPageId','notionDatabaseId']){
    const id=String(input[key]??current[key]??'').trim();
    if((!id&&key==='notionPageId')||(id&&!/^(?:[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i.test(id)))throw Error('ID Notion phải có 32 ký tự hex (có thể có dấu gạch nối).');
    result[key]=id;
  }
  return result;
}
module.exports={connectionInput,notionIds};
