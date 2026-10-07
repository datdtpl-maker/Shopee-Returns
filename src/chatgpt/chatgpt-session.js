const path = require('node:path');
const fs = require('node:fs');
const { isChatGptPage, findEditor } = require('./chatgpt-composer');

function isChatGptLoginPage(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ['auth.openai.com', 'auth0.openai.com'].includes(url.hostname);
  } catch { return false; }
}

async function readDebugEndpoint(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(2500) });
  if (!response.ok) throw new Error('Không đọc được phiên Chrome Debug.');
  const endpoint = (await response.json()).webSocketDebuggerUrl;
  const url = new URL(endpoint);
  if (url.protocol !== 'ws:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('Địa chỉ Chrome Debug không hợp lệ.');
  return endpoint;
}

async function getTargetId(page) {
  const session = await page.context().newCDPSession(page);
  try { return (await session.send('Target.getTargetInfo')).targetInfo.targetId; }
  finally { await session.detach(); }
}

async function bindChatGptSession(chromium, endpoint, profileDir, previousBinding) {
  const browser = await chromium.connectOverCDP(endpoint, { noDefaults: true });
  try {
    const allPages = browser.contexts().flatMap(context => context.pages()).filter(page => !page.isClosed());
    let pages = allPages.filter(page => isChatGptPage(page.url()) || isChatGptLoginPage(page.url()));
    if (previousBinding?.endpoint === endpoint && previousBinding.targetId) {
      const matched = [];
      for (const page of allPages) {
        try {
          if (await getTargetId(page) === previousBinding.targetId) matched.push(page);
        } catch {}
      }
      if (matched.length) pages = matched;
    }
    // If no ChatGPT page is open, navigate or open one
    if (!pages.length) {
      const context = browser.contexts()[0];
      if (context) {
        try {
          const page = await context.newPage();
          await page.goto('https://chatgpt.com', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
          pages = [page];
        } catch {}
      }
    }
    if (!pages.length) return { endpoint, profileDir, targetId: null, ready: false };
    let page = pages.length === 1 ? pages[0] : null;
    if (!page) {
      const visible = [];
      for (const candidate of pages) {
        try {
          if (await candidate.evaluate(() => document.hasFocus() && document.visibilityState === 'visible')) visible.push(candidate);
        } catch {}
      }
      if (visible.length === 1) page = visible[0];
      else page = pages[0];
    }
    try { await page.bringToFront(); } catch {}
    let ready = false;
    try {
      const title = await page.title();
      const gate = /just a moment|verify|verification|xác minh/i.test(title)
        || await page.locator('iframe[src*="challenges.cloudflare.com"]').count().catch(() => 0)
        || await page.locator('[data-testid="login-button"]').isVisible().catch(() => false);
      ready = isChatGptPage(page.url()) && !gate && Boolean(await findEditor(page));
    } catch { /* Navigation in the same tab is normal during manual login. */ }
    let targetId = null;
    try { targetId = await getTargetId(page); } catch {}
    return { endpoint, targetId, profileDir, ready };
  } finally { await browser.close().catch(() => {}); }
}

function profileEndpoint(profileDir) {
  const file = path.join(profileDir, 'DevToolsActivePort');
  if (fs.lstatSync(file).isSymbolicLink()) throw new Error('Thông tin Chrome Debug không hợp lệ.');
  const [port, route] = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/);
  if (!/^\d+$/.test(port) || Number(port) < 1024 || Number(port) > 65535 || !/^\/devtools\/browser\/[a-f\d-]+$/i.test(route)) throw new Error('Thông tin Chrome Debug không hợp lệ.');
  return {port:Number(port), endpoint:'ws://127.0.0.1:' + port + route};
}
function ownsDebugEndpoint(profileDir, endpoint) {
  try {return profileEndpoint(profileDir).endpoint === endpoint;} catch {return false;}
}

async function connectBoundChatGpt(chromium, port, binding) {
  if (!binding) throw new Error('Hãy bấm Khởi động Chrome Debug để khóa đúng profile và tab trước khi sinh ảnh.');
  let endpoint = binding.endpoint;
  try {
    const currentEndpoint = await readDebugEndpoint(port);
    if (currentEndpoint) endpoint = currentEndpoint;
  } catch {}
  const browser = await chromium.connectOverCDP(endpoint, { noDefaults: true });
  try {
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        try {
          if (!page.isClosed() && (await getTargetId(page) === binding.targetId || isChatGptPage(page.url()))) {
            return { browser, page };
          }
        } catch {}
      }
    }
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        if (!page.isClosed() && isChatGptPage(page.url())) {
          return { browser, page };
        }
      }
    }
    throw new Error('Tab ChatGPT trong Chrome Debug không tìm thấy hoặc đã đóng. Mở lại tab ChatGPT rồi thử lại.');
  } catch (error) { await browser.close().catch(() => {}); throw error; }
}

module.exports = { readDebugEndpoint, bindChatGptSession, connectBoundChatGpt, profileEndpoint, ownsDebugEndpoint };
