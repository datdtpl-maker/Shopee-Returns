const {DEFAULT_GEMINI_API_KEY}=require('./studio-settings.cjs');
const fail=(message,code='GEMINI_ERROR')=>Object.assign(Error(message),{code});
function formatDescription(raw){
 if(!raw||typeof raw!=='string')return '';
 let text=raw.trim();
 const headings=['MÔ TẢ SẢN PHẨM','THÀNH PHẦN NỔI BẬT','CÔNG DỤNG HỖ TRỢ','ĐỐI TƯỢNG SỬ DỤNG','CÁCH DÙNG','LƯU Ý','HASHTAG'];
 for(const h of headings){
  const re=new RegExp('(?:^|\\s+)(?:[📍✨]|⭐\\s*⭐?)\\s*'+h+'(?::|\\s*:)?\\s*|(?:^|\\n+|\\s{2,}|(?<=[.!?])\\s+)'+h+'(?::|\\s*:)?\\s*','gi');
  text=text.replace(re,'\n\n📍 '+h+'\n');
 }
 text=text.replace(/[\s(]*cần người kiểm duyệt bổ sung[^.)\n]*[.)]*/gi,'');
 text=text.replace(/[\s(]*dữ liệu nguồn chưa cung cấp[^.)\n]*[.)]*/gi,'');
 text=text.replace(/[\s(]*thông tin cụ thể[^.)\n]*chưa có trong dữ liệu nguồn[^.)\n]*[.)]*/gi,'');
 text=text.replace(/[\s(]*chưa có dữ liệu[^.)\n]*cần người kiểm duyệt[^.)\n]*[.)]*/gi,'');
 text=text.replace(/([^\n])\s*([•*■-])\s+/g,'$1\n• ');
 text=text.replace(/^\s*[-*■]\s+/gm,'• ');
 text=text.split('\n').map(line=>line.trim()).join('\n');
 text=text.replace(/\n{3,}/g,'\n\n');
 return text.trim();
}
class GeminiClient {
 constructor(settings,secrets,{fetch:request=globalThis.fetch,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),onRetry=()=>{}}={}){this.settings=settings;this.secrets=secrets;this.fetch=request;this.sleep=sleep;this.onRetry=onRetry;}
 async request(endpoint,body){const key=this.secrets().geminiApiKey;if(!key)throw fail('Nhập Gemini API key trong phần Kết nối.');
  let response;const signal=AbortSignal.timeout(60000);
  for(let attempt=0;attempt<3;attempt++){
   try{response=await this.fetch('https://generativelanguage.googleapis.com/v1beta/'+endpoint,{method:body?'POST':'GET',redirect:'error',headers:{'x-goog-api-key':key,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal});}catch{throw fail('Không kết nối được Gemini. Kiểm tra mạng rồi thử lại.');}
   if(![500,502,503,504].includes(response.status)||attempt===2)break;
   await response.body?.cancel().catch(()=>{});
   this.onRetry('Gemini tạm bận (HTTP '+response.status+'). Đang thử lại '+(attempt+1)+'/2…');
   await this.sleep(1000*(attempt+1));
   if(signal.aborted)throw fail('Gemini chưa phản hồi trong 60 giây. Thử viết lại sau.');
  }
  const data=await response.json().catch(()=>({}));
  if(!response.ok){
    const reasons=(data.error?.details||[]).map(detail=>detail.reason);
    const overloaded=response.status===503&&data.error?.status==='UNAVAILABLE'&&/high demand|overload/i.test(data.error?.message||'');
    const advice=overloaded?'Google báo mô hình đang quá tải. Đã thử lại; chờ rồi viết lại hoặc chọn mô hình khác trong danh sách.':response.status>=500?'Dịch vụ Gemini tạm bận hoặc gặp sự cố. Đã thử lại; bấm Viết bài khi dịch vụ sẵn sàng.':response.status===429?'Đã chạm hạn mức hoặc giới hạn tốc độ. Kiểm tra quota/billing của dự án Google.':response.status===401||response.status===403?'Google từ chối xác thực hoặc quyền truy cập. Kiểm tra API key và quyền Gemini API.':reasons.includes('API_KEY_INVALID')?'Google xác nhận API key không hợp lệ. Sao chép lại khóa từ Google AI Studio.':'Kiểm tra yêu cầu và quyền dùng mô hình Gemini.';
    throw fail('Gemini trả lỗi HTTP '+response.status+'. '+advice,response.status>=500?'GEMINI_UNAVAILABLE':'GEMINI_ERROR');
  }
  return data;
 }
 async models(){const all=[],seen=new Set();let token;
  let pages=0;
  do{if(++pages>100)throw fail('Gemini trả quá nhiều trang mô hình.');const data=await this.request('models?pageSize=100'+(token?'&pageToken='+encodeURIComponent(token):''));for(const model of data.models||[])if(model.supportedGenerationMethods?.includes('generateContent')&&/^models\/gemini-[a-z\d.-]+$/i.test(model.name)&&!all.some(item=>item.id===model.name.slice(7)))all.push({id:model.name.slice(7),label:model.displayName||model.name.slice(7)});
   token=data.nextPageToken;if(token&&seen.has(token))throw fail('Gemini trả phân trang mô hình bị lặp.');if(token)seen.add(token);
  }while(token&&all.length<1000);
  if(!all.length)throw fail('Key chưa có mô hình Gemini hỗ trợ viết bài.');
  const requested=this.settings().geminiModel||'gemini-3.8-flash',selected=all.find(m=>m.id===requested)?.id||all.filter(m=>m.id.includes('flash')&&!/image|tts|live|embedding/i.test(m.id)).sort((a,b)=>b.id.localeCompare(a.id,undefined,{numeric:true}))[0]?.id||all[0].id;
  return {models:all,selected,message:all.some(m=>m.id===requested)?'Mô hình có trong tài khoản.':'Không thấy '+requested+' trong API; đã chọn mô hình có thật: '+selected+'.'};
 }
 async test(){
  const result=await this.models();
  try{await this.write({prompt:'Kiểm tra kết nối: trả tên sản phẩm đã cho và mô tả ngắn đúng câu "Bài kiểm tra định dạng viết bài.". Không thêm thông tin bán hàng.',requestedName:'Sản phẩm kiểm tra kết nối',price:10000},result.selected);}
  catch(error){if(error.code==='GEMINI_INVALID_ARTICLE')throw fail('Gemini chưa trả nội dung kiểm tra hoàn chỉnh ở định dạng viết bài.');throw error;}
  return {...result,message:result.message+' Đã kiểm tra định dạng viết bài JSON thành công tại thời điểm này.'};
 }
 async generate({prompt,requestedName,source,price}){
  if(typeof prompt!=='string'||!prompt.trim()||prompt.length>16000)throw fail('Prompt cần 1–16.000 ký tự.');
  const name=requestedName??source?.name;
  if(typeof name!=='string'||!name.trim()||name.length>120)throw fail('Nhập tên sản phẩm mới từ 1 đến 120 ký tự.');
  const model=this.settings().geminiModel;if(!model||!/^gemini-[a-z\d.-]+$/i.test(model))throw fail('Kiểm tra kết nối và chọn mô hình Gemini trước khi viết.');
  const available=await this.models();if(!available.models.some(item=>item.id===model))throw fail('Mô hình đã chọn không có trong API của key này. Kiểm tra kết nối và chọn lại; chưa viết bài.');
  return this.write({prompt,requestedName:name.trim(),hasCustomName:typeof requestedName==='string'&&Boolean(requestedName.trim()),price},model);
 }
 async write({prompt,requestedName:name,hasCustomName,price},model){
  const reference=this.settings().writingReference||'';
   const body={systemInstruction:{parts:[{text:'Bạn viết mô tả sản phẩm Shopee bằng tiếng Việt chuyên nghiệp cho sản phẩm mới có tên requestedName; không đổi sang sản phẩm khác. BẮT BUỘC: Giữ nguyên 100% chính xác tên sản phẩm requestedName do nhân viên đã nhập, tuyệt đối không được tự ý sửa đổi hay thay thế tên sản phẩm này. Dựa vào prompt và tên sản phẩm mới để viết đầy đủ, hoàn chỉnh và chi tiết tất cả các nội dung (Mô tả, Thành phần nổi bật, Công dụng hỗ trợ, Đối tượng sử dụng, Cách dùng, Lưu ý, Hashtag) theo đúng bố cục chuẩn, tuyệt đối không dùng các câu thoái thác như "chưa có dữ liệu" hay "cần người kiểm duyệt bổ sung". Phân cách giữa các mục bằng 2 dấu xuống dòng (\\n\\n). Các tiêu đề dùng icon "📍 " (ví dụ: "📍 MÔ TẢ SẢN PHẨM", "📍 THÀNH PHẦN NỔI BẬT", "📍 CÔNG DỤNG HỖ TRỢ", "📍 ĐỐI TƯỢNG SỬ DỤNG", "📍 CÁCH DÙNG", "📍 LƯU Ý", "📍 HASHTAG"). Trong các mục thành phần, công dụng, đối tượng, cách dùng, lưu ý: mỗi ý phải xuống dòng riêng và bắt đầu bằng chấm tròn "• ". Tên tối đa 120 ký tự; mô tả tối đa 5000 ký tự. Trả về JSON đúng hai trường name và description, trong đó name giữ nguyên là requestedName. Giữ cấu trúc bài tham khảo nếu có, nhưng không sao chép dữ kiện của sản phẩm tham khảo.'}]},contents:[{role:'user',parts:[{text:JSON.stringify({prompt,requestedName:name.trim(),price,reference})}]}],generationConfig:{responseMimeType:'application/json',responseJsonSchema:{type:'object',properties:{name:{type:'string'},description:{type:'string'}},required:['name','description'],additionalProperties:false},maxOutputTokens:8192}};
  const data=await this.request('models/'+model+':generateContent',body),candidate=data.candidates?.find(c=>c.finishReason==='STOP');
  if(!candidate)throw fail('Gemini chưa trả bài viết hoàn chỉnh; không lưu bài bị cắt hoặc bị chặn.','GEMINI_INVALID_ARTICLE');
  let article;try{article=JSON.parse(candidate.content.parts.filter(p=>typeof p.text==='string'&&!p.thought).map(p=>p.text).join(''));}catch{throw fail('Gemini trả nội dung sai JSON. Chưa lưu bài.','GEMINI_INVALID_ARTICLE');}
  const formattedDescription=formatDescription(article?.description);
  if(!article||typeof article.name!=='string'||!article.name.trim()||article.name.length>120||!formattedDescription||formattedDescription.length>5000||Object.keys(article).some(k=>!['name','description'].includes(k)))throw fail('Bài Gemini chưa đủ tên/mô tả hoặc vượt giới hạn Shopee.','GEMINI_INVALID_ARTICLE');
  const finalName=hasCustomName?name.trim():(article.name.trim()||name.trim());
  return {name:finalName,description:formattedDescription};
 }
}
module.exports={GeminiClient,formatDescription,DEFAULT_GEMINI_KEY:DEFAULT_GEMINI_API_KEY};
