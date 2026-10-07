const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');

const LIMITS = {maxTemplates: 100, nameLimit: 100, contentLimit: 16000};
const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const STRUCTURE = `Trình bày mô tả theo đúng bố cục chuẩn mẫu Notion sau, phân cách giữa các mục bằng 2 dấu xuống dòng:

📍 MÔ TẢ SẢN PHẨM
[Đoạn văn giới thiệu tổng quan sản phẩm, công dụng chính và điểm nổi bật, viết tự nhiên, thu hút khách hàng]

📍 THÀNH PHẦN NỔI BẬT
• [Liệt kê chi tiết các thành phần, hoạt chất chính phù hợp với sản phẩm và công dụng]

📍 CÔNG DỤNG HỖ TRỢ
• [Liệt kê chi tiết các công dụng hỗ trợ thực tế của sản phẩm]

📍 ĐỐI TƯỢNG SỬ DỤNG
• [Nêu rõ các đối tượng phù hợp nên sử dụng sản phẩm]

📍 CÁCH DÙNG
• [Hướng dẫn cụ thể các bước sử dụng, thời điểm dùng và cách dùng an toàn]

📍 LƯU Ý
• [Các lưu ý sử dụng, bảo quản nơi khô ráo, thận trọng và khuyến cáo an toàn]

📍 HASHTAG
[Các hashtag liên quan tên sản phẩm và công dụng chính, ví dụ: #TenSanPham #CongDung]

Bắt buộc mỗi phần cách nhau 2 lần xuống dòng. Các ý trong mỗi phần (thành phần, công dụng, đối tượng, cách dùng, lưu ý) phải xuống dòng riêng và bắt đầu bằng dấu chấm tròn "• ". Viết đầy đủ chi tiết toàn bộ các mục dựa vào tên sản phẩm và prompt, tuyệt đối không ghi câu "chưa có dữ liệu" hay "cần người kiểm duyệt bổ sung". Không dùng bảng hay HTML. Mô tả tối đa 5.000 ký tự; tên sản phẩm tối đa 120 ký tự.`;
const FACTS = `Bám sát tên sản phẩm mới và prompt đã cung cấp. Bố cục bài Oximin chỉ là mẫu định dạng trình bày, không đưa tên Oximin, Clindamycin, Benzoyl Peroxide hoặc dữ kiện riêng của bài mẫu sang sản phẩm khác. Dựa vào tên sản phẩm và thông tin trong prompt để bổ sung chi tiết, chính xác và đầy đủ các nội dung thành phần, công dụng, đối tượng, cách dùng, lưu ý cho sản phẩm. Viết đầy đủ tất cả các mục, không bỏ trống, không dùng câu thoái thác cần người kiểm duyệt bổ sung. Không biến công dụng hỗ trợ thành thuốc chữa bệnh dứt điểm. Giá được nhập ở trường Giá bán, không tự thêm giá hay khuyến mãi vào mô tả.`;
const DEFAULT_TEMPLATES = [
  {name: 'Shopee · Bố cục đầy đủ', content: `Viết lại tên và mô tả bán hàng Shopee cho đúng sản phẩm đang chọn theo bố cục chuẩn mẫu Oximin. Đặt tên sản phẩm rõ ràng: nhãn hiệu/tên sản phẩm + quy cách + công dụng chính, tối ưu từ khóa tự nhiên, không nhồi nhét. Mở đầu mô tả giải thích sản phẩm là gì và phù hợp nhu cầu nào, sau đó trình bày thông tin chi tiết giúp khách quyết định mua. Giữ giọng văn tự nhiên, cụ thể và dễ đọc trên điện thoại.

${STRUCTURE}

${FACTS}`},
  {name: 'Shopee · Tối ưu tiêu đề và từ khóa', content: `Tối ưu tên và mô tả Shopee cho đúng sản phẩm đang chọn theo nhu cầu tìm kiếm và công dụng thực tế. Đặt tên chuẩn SEO Shopee: Tên sản phẩm/nhãn hiệu + quy cách + công dụng chính hoặc nhu cầu hỗ trợ. Lồng ghép từ khóa tìm kiếm phù hợp vào tên và các đoạn mô tả một cách tự nhiên. Tập trung vào nhu cầu sử dụng chính của sản phẩm. Viết đầy đủ toàn bộ nội dung từng mục theo cấu trúc bên dưới, không bỏ sót mục nào.

${STRUCTURE}

${FACTS}`},
  {name: 'Shopee · Chỉnh bài cũ, giữ nguyên dữ kiện', content: `Biên tập và hoàn thiện tên cùng mô tả Shopee cho đúng sản phẩm đang chọn theo bố cục chuẩn mẫu Oximin. Giữ đúng các dữ kiện nguồn đã cung cấp nếu có (tên sản phẩm, quy cách, công dụng), bổ sung chi tiết đầy đủ và trau chuốt các phần thành phần, công dụng, đối tượng, cách dùng và lưu ý để bài viết hoàn chỉnh, chuyên nghiệp và sẵn sàng đăng bán.

${STRUCTURE}

${FACTS}`},
];
const clone = value => JSON.parse(JSON.stringify(value));
function fail(message) {return Object.assign(Error(message), {code: 'STUDIO_PROMPT_INVALID'});}
function text(value, label, maximum, multiline = false) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || (multiline ? /[\x00-\x08\x0b\x0c\x0e-\x1f]/ : /[\x00-\x1f]/).test(value)) throw fail(label + ' cần 1–' + maximum.toLocaleString('vi-VN') + ' ký tự hợp lệ.');
  return value.trim();
}
function template(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('Mẫu prompt không hợp lệ.');
  return {id: input.id, name: text(input.name, 'Tên mẫu', LIMITS.nameLimit), content: text(input.content, 'Prompt', LIMITS.contentLimit, true)};
}
function state(data) {
  if (!data || data.version !== 1 || !Array.isArray(data.templates) || data.templates.length > LIMITS.maxTemplates) throw fail('Thư viện prompt đã lưu không hợp lệ. Giữ nguyên file để kiểm tra.');
  const ids = new Set();
  const templates = data.templates.map(item => {
    const result = template(item);
    if (typeof result.id !== 'string' || !UUID.test(result.id) || ids.has(result.id)) throw fail('ID mẫu prompt đã lưu không hợp lệ. Giữ nguyên file để kiểm tra.');
    ids.add(result.id); return result;
  });
  return {version: 1, templates};
}

class PromptLibrary {
  constructor(dir, {onChange = () => {}} = {}) {
    this.dir = path.join(dir, 'replacement-studio'); this.file = path.join(this.dir, 'prompts.json'); this.onChange = onChange;
    fs.mkdirSync(this.dir, {recursive: true});
    if (fs.existsSync(this.file)) {
      try {this.data = state(JSON.parse(fs.readFileSync(this.file, 'utf8')));}
      catch (error) {if (error.code === 'STUDIO_PROMPT_INVALID') throw error; throw fail('Không đọc được thư viện prompt đã lưu. Giữ nguyên file để kiểm tra.');}
    } else this.save({version: 1, templates: DEFAULT_TEMPLATES.map(item => ({id: randomUUID(), ...item}))});
  }
  save(data) {
    const temporary = path.join(this.dir, '.prompts-' + randomUUID() + '.tmp');
    try {
      fs.writeFileSync(temporary, JSON.stringify(data, null, 2), {flag: 'wx', mode: 0o600});
      fs.renameSync(temporary, this.file); this.data = data;
    } finally {if (fs.existsSync(temporary)) fs.unlinkSync(temporary);}
    this.onChange();
  }
  snapshot() {return {...LIMITS, templates: clone(this.data.templates)};}
  upsert(input) {
    const value = template(input), templates = clone(this.data.templates);
    if (value.id !== undefined) {
      if (typeof value.id !== 'string' || !UUID.test(value.id)) throw fail('ID mẫu prompt không hợp lệ.');
      const index = templates.findIndex(item => item.id === value.id);
      if (index === -1) throw fail('Không tìm thấy mẫu prompt cần sửa.');
      templates[index] = value;
    } else {
      if (templates.length >= LIMITS.maxTemplates) throw fail('Chỉ lưu tối đa ' + LIMITS.maxTemplates + ' mẫu prompt.');
      value.id = randomUUID(); templates.push(value);
    }
    this.save({version: 1, templates}); return clone(value);
  }
  remove(id) {
    if (typeof id !== 'string' || !UUID.test(id)) throw fail('ID mẫu prompt không hợp lệ.');
    if (!this.data.templates.some(item => item.id === id)) throw fail('Không tìm thấy mẫu prompt cần xoá.');
    this.save({version: 1, templates: this.data.templates.filter(item => item.id !== id)}); return this.snapshot();
  }
}
module.exports = {PromptLibrary, DEFAULT_TEMPLATES, LIMITS};
