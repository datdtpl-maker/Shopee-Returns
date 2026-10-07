const {test} = require('node:test');
const assert = require('node:assert/strict');
const {GeminiClient} = require('../src/studio-gemini.cjs');

const key = 'LOCAL_TEST_KEY_FOR_CONNECTION';
const model = 'gemini-test-flash';
const article = {name: 'Sản phẩm kiểm tra', description: 'Nội dung bài viết kiểm tra.'};
const completed = value => ({candidates: [{finishReason: 'STOP', content: {parts: [{text: JSON.stringify(value)}]}}]});
const response = value => new Response(JSON.stringify(value), {headers: {'Content-Type': 'application/json'}});
const models = {models: [{name: 'models/' + model, supportedGenerationMethods: ['generateContent']}]};
function fixture(generate = () => response(completed(article))) {
  const calls = [];
  const client = new GeminiClient(() => ({geminiModel: model}), () => ({geminiApiKey: key}), {
    fetch: async (url, options) => {
      calls.push({url, options});
      return url.includes(':generateContent') ? generate(JSON.parse(options.body)) : response(models);
    },
    sleep: async () => {}
  });
  return {client, calls};
}
const writingMode = body => ({
  systemInstruction: body.systemInstruction,
  responseMimeType: body.generationConfig?.responseMimeType,
  responseSchema: body.generationConfig?.responseSchema,
  responseJsonSchema: body.generationConfig?.responseJsonSchema
});

test('Gemini connection check exercises the article writing mode and keeps the API key out of request content', async () => {
  const {client, calls} = fixture();
  const result = await client.test();
  await client.generate({prompt: 'Viết bài theo dữ kiện được cung cấp.', requestedName: 'Tên sản phẩm mới'});
  const generated = calls.filter(call => call.url.includes(':generateContent')).map(call => JSON.parse(call.options.body));
  assert.equal(generated.length, 2);
  assert.equal(generated[0].generationConfig.responseMimeType, 'application/json', 'testing plain text cannot establish JSON article writing support');
  assert.ok(generated[0].generationConfig.responseSchema || generated[0].generationConfig.responseJsonSchema, 'test the structured output schema used for articles');
  assert.deepEqual(writingMode(generated[0]), writingMode(generated[1]));
  const input = JSON.parse(generated[0].contents[0].parts[0].text);
  assert.equal(typeof input.prompt, 'string');
  assert.equal(typeof input.requestedName, 'string');
  assert.match(result.message, /thành công/);
  for (const call of calls) {
    assert.equal(call.options.headers['x-goog-api-key'], key);
    assert.equal(call.url.includes(key), false);
    assert.equal((call.options.body || '').includes(key), false);
  }
});

test('Gemini connection check cannot report success when only plain text works and the article request returns 503', async () => {
  let plainRequests = 0;
  const {client} = fixture(body => {
    if (body.generationConfig?.responseMimeType === 'application/json') return new Response('', {status: 503});
    plainRequests++;
    return response({candidates: [{finishReason: 'STOP', content: {parts: [{text: 'OK'}]}}]});
  });
  await assert.rejects(client.test(), error => /HTTP 503/.test(error.message) && !error.message.includes(key));
  assert.equal(plainRequests, 0, 'no plain-text fallback may hide the failure to write an article');
});

test('Gemini connection check validates complete article JSON before claiming writing works', async t => {
  for (const [label, value] of [
    ['missing description', {name: 'Sản phẩm kiểm tra'}],
    ['blank description', {name: 'Sản phẩm kiểm tra', description: ' '}],
    ['unexpected field', {...article, extra: true}],
    ['name exceeds Shopee limit', {...article, name: 'A'.repeat(121)}],
    ['description exceeds Shopee limit', {...article, description: 'A'.repeat(5001)}]
  ]) {
    await t.test(label, async () => {
      const {client} = fixture(() => response(completed(value)));
      await assert.rejects(client.test(), /chưa đủ|giới hạn|kiểm tra|JSON|hợp lệ/i);
    });
  }
  await t.test('unfinished response', async () => {
    const incomplete = completed(article); incomplete.candidates[0].finishReason = 'MAX_TOKENS';
    const {client} = fixture(() => response(incomplete));
    await assert.rejects(client.test(), /hoàn chỉnh/);
  });
});
