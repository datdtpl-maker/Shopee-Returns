const path = require('node:path');
const DEFAULTS = {driveLocalFolder: 'G:\\My Drive\\Hình ảnh Shopee\\Sản phẩm thay thế', chatgptPort: 9222, geminiModel: ''};
const DEFAULT_GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
function studioInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Cấu hình Studio không hợp lệ.');
  const result = {};
  for (const [key, value] of Object.entries(input)) {
    if (!['geminiApiKey', 'geminiModel', 'driveLocalFolder', 'chatgptPort', 'writingReference'].includes(key)) throw Error('Trường cấu hình Studio không được hỗ trợ.');
    if (key === 'chatgptPort') {
      const port = Number(value);
      if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('Cổng Chrome Debug phải từ 1024 đến 65535.');
      result[key] = port; continue;
    }
    if (key === 'geminiApiKey') {
      if (typeof value !== 'string' || value.length > 8192) throw Error('Định dạng Gemini API key không hợp lệ.');
      const keyText = value.trim();
      // Google keys are opaque tokens. Check header safety, then let the API verify validity.
      if (keyText && !/^[\x21-\x7e]{20,4096}$/.test(keyText)) throw Error('Gemini API key chứa khoảng trắng, ký tự lạ hoặc độ dài không hợp lệ. Sao chép lại bằng nút Sao chép khóa.');
      result[key] = keyText; continue;
    }
    if (typeof value !== 'string' || value.length > (key === 'writingReference' ? 5000 : 4096) || (key === 'writingReference' ? /\0/ : /[\x00-\x1f]/).test(value)) throw Error('Trường văn bản Studio không hợp lệ.');
    const text = value.trim();
    if (key === 'geminiModel' && text && !/^gemini-[a-z\d.-]+$/i.test(text)) throw Error('ID mô hình Gemini không hợp lệ.');
    if (key === 'driveLocalFolder' && (!path.isAbsolute(text) || /^\\\\/.test(text))) throw Error('Chọn thư mục Drive local trên máy này.');
    result[key] = text;
  }
  return result;
}
module.exports = {DEFAULTS, studioInput, DEFAULT_GEMINI_API_KEY};
