const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');
const sharp = require('sharp');
const extension = path.join(__dirname, '../src/chrome-image-extension');
const executable = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean)
  .map(root => path.join(root, 'Google/Chrome/Application/chrome.exe')).find(file => fs.existsSync(file));
const lazyPage = '<!doctype html><html><head><title>ChatGPT fixture</title></head><body><main></main><input id="unrelated-file" type="file" accept="image/*"><input id="other-file" type="file" accept="image/*"><form id="composer"><button type="button" id="unrelated-plus" aria-label="Add unrelated">+</button><button type="button" id="composer-plus-btn" aria-label="Add files and more" aria-haspopup="menu" aria-controls="composer-attach-menu">+</button><textarea id="prompt-textarea"></textarea><button type="button" data-testid="send-button">Gửi</button></form></body></html>';
const plainPage = '<!doctype html><html><head><title>ChatGPT fixture</title></head><body><main></main><form id="composer"><textarea id="prompt-textarea"></textarea><button type="button" data-testid="send-button">Gửi</button></form></body></html>';

async function fixture(t, html, configure, verify) {
  if (!executable) return t.skip('Chrome không có để chạy fixture độc lập.');
  const png = await sharp({create: {width: 1024, height: 1024, channels: 3, background: '#75a23b'}}).png().toBuffer();
  const browser = await chromium.launch({executablePath: executable, headless: true});
  try {
    const context = await browser.newContext();
    await context.route('**/*', route => {
      if (route.request().url() === 'https://chatgpt.com/') return route.fulfill({contentType: 'text/html', body: html});
      if (route.request().url() === 'https://chatgpt.com/preview.png') return route.fulfill({contentType: 'image/png', body: png});
      return route.abort();
    });
    const page = await context.newPage(); await page.goto('https://chatgpt.com/');
    await page.evaluate(dataUrl => {
      window.fixture = {events: [], clicks: 0, uploadCount: 0, menuClicks: 0, unrelatedClicks: 0, inputBeforeReady: false, submittedWhileBusy: false, polled: false};
      window.chrome.runtime = {onMessage: {addListener() {}}, sendMessage: async message => {
        if (message.kind === 'poll') {
          if (fixture.polled) return {ok: true, result: {command: null}}; fixture.polled = true;
          return {ok: true, result: {command: {id: 'cmd-attachment', kind: 'generate', jobId: 'job-attachment', index: 0, prompt: 'Tạo đúng ảnh từ mẫu.',
            reference: {name: 'reference.png', mimeType: 'image/png', dataUrl}, expectedConversationPath: null}}};
        }
        if (message.kind === 'event') {fixture.events.push(message.payload); if (message.payload.type === 'submitted') fixture.submittedWhileBusy = Boolean(document.querySelector('[aria-busy="true"]')); return {ok: true, result: {ok: true}};}
        return {ok: true, result: {ok: true}};
      }};
      window.fixture.mountInput = ({id = 'image-file', parent = document.querySelector('#composer'), accept = 'image/*', delayed = false} = {}) => {
        const input = document.createElement('input'); input.type = 'file'; input.id = id; input.accept = accept;
        input.addEventListener('change', () => {
          fixture.uploadCount++; fixture.uploadInput = input.id;
          if (delayed) {
            document.querySelector('form').setAttribute('aria-busy', 'true'); document.querySelector('[data-testid="send-button"]').disabled = true;
            setTimeout(() => {const preview = document.createElement('img'); preview.src = 'https://chatgpt.com/preview.png'; document.querySelector('form').append(preview);}, 900);
            setTimeout(() => {document.querySelector('form').removeAttribute('aria-busy'); document.querySelector('[data-testid="send-button"]').disabled = false;}, 1400);
          } else {const preview = document.createElement('img'); preview.src = 'https://chatgpt.com/preview.png'; document.querySelector('form').append(preview);}
        });
        parent.append(input); return input;
      };
      document.querySelector('[data-testid="send-button"]').addEventListener('click', () => fixture.clicks++);
      document.querySelector('textarea').addEventListener('input', () => {if (!fixture.uploadCount) fixture.inputBeforeReady = true;});
      document.querySelector('#unrelated-plus')?.addEventListener('click', () => fixture.unrelatedClicks++);
    }, 'data:image/png;base64,' + png.toString('base64'));
    if (configure) await page.evaluate(configure);
    await page.addScriptTag({path: path.join(extension, 'guards.js')}); await page.addScriptTag({path: path.join(extension, 'content.js')});
    await page.waitForFunction(() => fixture.events.some(event => ['error', 'submitted'].includes(event.type)), null, {timeout: 7000});
    await verify(page, await page.evaluate(() => ({...fixture, mountInput: undefined})));
  } finally {await browser.close();}
}

test('lazy image input: open only composer plus/menu, attach correct fresh portal input and verify upload before submit', async t => {
  await fixture(t, lazyPage, () => {
    document.querySelector('#composer-plus-btn').addEventListener('click', () => {
      fixture.menuClicks++;
      const menu = document.createElement('div'); menu.id = 'composer-attach-menu'; menu.setAttribute('role', 'menu');
      const item = document.createElement('button'); item.setAttribute('role', 'menuitem'); item.textContent = 'Add photos & files';
      item.addEventListener('click', () => {fixture.menuClicks++; fixture.mountInput({parent: menu, delayed: true});});
      menu.append(item); document.body.append(menu);
    });
  }, async (page, result) => {
    assert.ok(result.events.some(event => event.type === 'submitted'), result.events.find(event => event.type === 'error')?.message || 'Prompt chưa gửi');
    assert.equal(result.menuClicks, 2); assert.equal(result.uploadCount, 1); assert.equal(result.uploadInput, 'image-file');
    assert.equal(result.unrelatedClicks, 0); assert.equal(result.submittedWhileBusy, false); assert.equal(result.inputBeforeReady, false);
    assert.equal(await page.locator('#unrelated-file').evaluate(input => input.files.length), 0);
    assert.equal(await page.locator('#image-file').evaluate(input => input.files[0].name), 'reference.png');
  });
});

test('prefer exact scoped image input over generic input and reject incompatible image accept', async t => {
  await fixture(t, plainPage, () => {fixture.mountInput({id: 'generic-file', accept: '*/*'}); fixture.mountInput({id: 'svg-only', accept: 'image/svg+xml'}); fixture.mountInput({id: 'correct-file', accept: 'image/png'});},
    async (page, result) => {
      assert.ok(result.events.some(event => event.type === 'submitted'), result.events.find(event => event.type === 'error')?.message);
      assert.equal(result.uploadInput, 'correct-file'); assert.equal(result.uploadCount, 1);
      assert.equal(await page.locator('#generic-file').evaluate(input => input.files.length), 0);
      assert.equal(await page.locator('#svg-only').evaluate(input => input.files.length), 0);
    });
});

test('equally suitable scoped inputs stop without upload, prompt fill or arbitrary click', async t => {
  await fixture(t, lazyPage, () => {fixture.mountInput({id: 'first'}); fixture.mountInput({id: 'second'});}, async (page, result) => {
    assert.ok(result.events.some(event => event.type === 'error')); assert.equal(result.uploadCount, 0); assert.equal(result.clicks, 0); assert.equal(result.unrelatedClicks, 0); assert.equal(result.menuClicks, 0);
    assert.equal(await page.locator('textarea').inputValue(), '');
  });
});

test('existing draft or attachment and verification gate are left untouched before lazy menu opening', async t => {
  for (const state of ['draft', 'attachment', 'gate']) {
    await fixture(t, lazyPage, state === 'draft' ? () => {document.querySelector('textarea').value = 'Bản nháp đang viết';}
      : state === 'attachment' ? () => {const img = document.createElement('img'); img.src = 'https://chatgpt.com/preview.png'; document.querySelector('form').append(img);}
        : () => {document.title = 'Just a moment…';}, async (page, result) => {
      assert.ok(result.events.some(event => event.type === 'error')); assert.equal(result.uploadCount, 0); assert.equal(result.clicks, 0); assert.equal(result.menuClicks, 0);
      if (state === 'draft') assert.equal(await page.locator('textarea').inputValue(), 'Bản nháp đang viết');
      if (state === 'attachment') assert.equal(await page.locator('form img').count(), 1);
    });
  }
});
