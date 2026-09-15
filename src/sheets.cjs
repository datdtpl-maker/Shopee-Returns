const DEFAULT_SHEET='https://docs.google.com/spreadsheets/d/1_hGDSYB7W5fwubSg9glDXFFzIKIewqcD3le68mr-5Yk/edit?gid=0';
const normalize=s=>String(s??'').normalize('NFC').trim();
const orderKey=s=>normalize(s);
const validTracking=s=>/^[A-Za-z0-9][A-Za-z0-9-]{3,79}$/.test(s)&&!['null','none','undefined','pending'].includes(s.toLowerCase());
function sheetUrl(input) {
  let u;try {u=new URL(input);}catch {throw Error('Link Google Sheet không hợp lệ.');}
  const id=u.pathname.match(/^\/spreadsheets\/d\/([\w-]+)(?:\/|$)/)?.[1];
  if(u.protocol!=='https:'||u.hostname!=='docs.google.com'||!id) throw Error('Chỉ nhận link https://docs.google.com/spreadsheets/d/...');
  const gid=new URLSearchParams(u.hash.slice(1)).get('gid')||u.searchParams.get('gid')||'0';
  if(!/^\d+$/.test(gid)) throw Error('Mã trang tính (gid) không hợp lệ.');
  return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`;
}
// RFC 4180: preserve quoted commas, embedded newlines and doubled quotes.
function parseCsv(text) {
  text=text.replace(/^\uFEFF/,'');const rows=[];let row=[],field='',quoted=false;
  for(let n=0;n<text.length;n++) {
    const c=text[n];
    if(quoted) {if(c==='"'&&text[n+1]==='"'){field+='"';n++;}else if(c==='"')quoted=false;else field+=c;}
    else if(c==='"'&&!field)quoted=true;
    else if(c===','){row.push(field);field='';}
    else if(c==='\n'||c==='\r'){if(c==='\r'&&text[n+1]==='\n')n++;row.push(field);rows.push(row);row=[];field='';}
    else field+=c;
  }
  if(quoted)throw Error('CSV chưa hoàn chỉnh: ô có dấu ngoặc kép chưa đóng.');
  if(field||row.length){row.push(field);rows.push(row);}return rows;
}
function indexSheet(csv) {
  if(/^\s*</.test(csv))throw Error('Google Sheet yêu cầu quyền truy cập hoặc không trả dữ liệu CSV.');
  const rows=parseCsv(csv),header=rows.shift()?.map(s=>normalize(s).toLowerCase());
  const orderColumn=header?.indexOf('mã đơn hàng'),trackingColumn=header?.indexOf('mã vận đơn'),statusColumn=header?.indexOf('tình trạng');
  if(!(orderColumn>=0&&trackingColumn>=0))throw Error('Sheet cần có cột Mã đơn hàng và Mã vận đơn.');
  const index=new Map();let count=0;
  for(let n=0;n<rows.length;n++) {
    const r=rows[n],id=orderKey(r[orderColumn]);if(!id)continue;
    if(!/^[A-Z0-9]{8,30}$/.test(id))continue;
    const record=index.get(id)||{trackingNumbers:[],statuses:[],rows:[],incomplete:false};
    const tracking=normalize(r[trackingColumn]),status=statusColumn>=0?normalize(r[statusColumn]):'';
    if(!validTracking(tracking))record.incomplete=true;
    else if(!record.trackingNumbers.includes(tracking))record.trackingNumbers.push(tracking);
    if(status&&!record.statuses.includes(status))record.statuses.push(status);
    record.rows.push(n+2);index.set(id,record);count++;
  }
  const owners=new Map();
  for(const [id,record] of index)for(const tracking of record.trackingNumbers){if(!owners.has(tracking))owners.set(tracking,new Set());owners.get(tracking).add(id);}
  for(const record of index.values())record.sharedTracking=record.trackingNumbers.some(t=>owners.get(t).size>1);
  return {index,count};
}
async function fetchSheet(url=DEFAULT_SHEET) {
  const freshUrl=new URL(sheetUrl(url));freshUrl.searchParams.set('_srm',`${Date.now()}-${require('node:crypto').randomUUID()}`);
  const r=await fetch(freshUrl,{cache:'no-store',headers:{'Cache-Control':'no-cache, no-store, max-age=0',Pragma:'no-cache'},signal:AbortSignal.timeout(30000)});
  if(!r.ok)throw Error(`Google Sheet trả lỗi HTTP ${r.status}. Kiểm tra quyền đọc trang tính.`);
  const csv=await r.text();if(csv.length>20_000_000)throw Error('Sheet vượt giới hạn 20 MB.');
  return {...indexSheet(csv),checkedAt:new Date().toISOString()};
}
function matchSheet(orderId,index) {
  const found=index.get(orderKey(orderId));
  if(!found)return {trackingNumbers:[],sheetStatus:'',sheetMatch:'not_found',sheetRows:[]};
  return {trackingNumbers:found.trackingNumbers,sheetStatus:found.statuses.join(' | '),sheetRows:found.rows,
    sheetMatch:found.trackingNumbers.length>1||found.statuses.length>1||found.sharedTracking?'conflict':found.incomplete||!found.trackingNumbers.length?'missing_tracking':'matched'};
}
const MATCH_LABELS={matched:'Đã khớp',not_found:'Chưa có trong Sheet',missing_tracking:'Sheet thiếu mã vận đơn',conflict:'Sheet có dữ liệu khác nhau',pending:'Chưa đối chiếu'};
module.exports={DEFAULT_SHEET,sheetUrl,parseCsv,indexSheet,fetchSheet,matchSheet,MATCH_LABELS,validTracking};
