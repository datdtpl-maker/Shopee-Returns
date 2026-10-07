const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const sharp = require('sharp');
const {
  prepareImages, processImage, downloadImage, validateSourceUrl, sourceInfo,
  MAX_SOURCE_BYTES, MAX_OUTPUT_BYTES,
} = require('../src/replacement-images.cjs');

const drive = id => `https://drive.google.com/file/d/${id}/view`;
const imageId = 'abcDEFG_hi1234567890';
const png = () => sharp({create: {width: 600, height: 800, channels: 4, background: {r: 30, g: 140, b: 80, alpha: 1}}}).png().toBuffer();
function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'srm-replacement-images-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  return dir;
}

test('only individual Drive files and known Notion image hosts are accepted; source mapping strips credentials', () => {
  assert.equal(sourceInfo(drive(imageId)).downloadUrl, `https://drive.usercontent.google.com/download?id=${imageId}&export=download&confirm=t`);
  assert.equal(sourceInfo(`https://drive.google.com/uc?id=${imageId}&export=download&authuser=2`).sourceUrl, drive(imageId));
  assert.equal(sourceInfo('https://prod-files-secure.s3.us-west-2.amazonaws.com/a/b.png?X-Amz-Security-Token=PRIVATE&X-Amz-Signature=SECRET').sourceUrl, 'https://prod-files-secure.s3.us-west-2.amazonaws.com/a/b.png');
  for (const url of [
    'http://drive.google.com/file/d/' + imageId,
    'https://drive.google.com.evil.test/file/d/' + imageId,
    'https://user:password@drive.google.com/file/d/' + imageId,
    'https://drive.google.com:444/file/d/' + imageId,
    'https://127.0.0.1/image.jpg', 'file:///C:/secret.jpg', 'data:image/png;base64,AA',
    'https://drive.google.com/drive/u/2/folders/' + imageId,
    'https://drive.google.com/document/d/' + imageId,
    'https://drive.usercontent.google.com/download?id=short',
    'https://s3.us-west-2.amazonaws.com/other-bucket/photo.png',
    'https://lh3.googleusercontent.com/unknown/path',
  ]) assert.throws(() => validateSourceUrl(url), {code: 'REPLACEMENT_IMAGE_INVALID'});
  assert.equal(validateSourceUrl('https://s3.us-west-2.amazonaws.com/secure.notion-static.com/folder/a.png').hostname, 's3.us-west-2.amazonaws.com');
});

test('download validates every redirect, omits credentials and enforces source size before and during streaming', async () => {
  const buffer = await png();
  const calls = [];
  await assert.rejects(downloadImage(drive(imageId), {fetch: async (url, init) => {
    calls.push({url, init});
    return new Response(null, {status: 302, headers: {location: 'https://127.0.0.1/private'}});
  }}), /chuyển hướng.*không được phép/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.redirect, 'manual');
  assert.equal(calls[0].init.credentials, 'omit');
  assert.equal(calls[0].init.headers.Authorization, undefined);
  assert.equal(calls[0].init.headers.Cookie, undefined);
  await assert.rejects(downloadImage(drive(imageId), {maxSourceBytes: 100, fetch: async () => new Response(buffer, {headers: {'content-length': '101'}})}), /vượt giới hạn/);
  await assert.rejects(downloadImage(drive(imageId), {maxSourceBytes: 100, fetch: async () => new Response(buffer)}), /vượt giới hạn/);
  await assert.rejects(downloadImage(drive(imageId), {fetch: async () => new Response('<html>Login</html>', {headers: {'content-type': 'text/html'}})}), /đăng nhập/);
  await assert.rejects(downloadImage(drive(imageId), {fetch: async () => new Response('<svg/>', {headers: {'content-type': 'image/png'}})}), /JPEG, PNG/);
  const downloaded = await downloadImage(drive(imageId), {fetch: async () => new Response(buffer, {headers: {'content-type': 'image/png'}})});
  assert.equal(downloaded.sourceBytes, buffer.length);
  assert.equal(downloaded.sourceHash, crypto.createHash('sha256').update(buffer).digest('hex'));
});

test('network deadline and user cancellation work even if a fetch implementation never resolves', async () => {
  await assert.rejects(downloadImage(drive(imageId), {timeoutMs: 10, fetch: () => new Promise(() => {})}), {code: 'REPLACEMENT_IMAGE_TIMEOUT'});
  const controller = new AbortController();
  controller.abort();
  let fetched = false;
  await assert.rejects(downloadImage(drive(imageId), {signal: controller.signal, fetch: async () => { fetched = true; }}), {code: 'REPLACEMENT_IMAGE_ABORTED'});
  assert.equal(fetched, false);
});

test('malformed, excessive and non-raster sources are rejected before producing assets', async () => {
  for (const buffer of [Buffer.from('<svg><script>alert(1)</script></svg>'), Buffer.from('<html/>'), Buffer.from([0xff, 0xd8, 0xff, 0])]) {
    await assert.rejects(processImage(buffer), {code: 'REPLACEMENT_IMAGE_INVALID'});
  }
  await assert.rejects(processImage(Buffer.alloc(MAX_SOURCE_BYTES + 1)), /25 MB/);
  await assert.rejects(processImage(await png(), {maxPixels: 100000}), /quá lớn|điểm ảnh/);
  await assert.rejects(processImage(await png(), {maxOutputBytes: 2000000}), /Giới hạn/);
});

test('multi-megabyte noisy images become verified JPEGs below 1.9 MB without cropping or reducing below 500 pixels', {timeout: 60000}, async () => {
  const width = 2400, height = 2000;
  const source = await sharp(crypto.randomBytes(width * height * 3), {raw: {width, height, channels: 3}}).png().toBuffer();
  assert.ok(source.length > 2000000);
  const result = await processImage(source);
  assert.ok(result.bytes < MAX_OUTPUT_BYTES);
  assert.equal(result.bytes, result.buffer.length);
  assert.ok(result.width >= 500 && result.height >= 500);
  assert.equal(result.width, result.height);
  assert.equal(result.padded, true);
  const actual = await sharp(result.buffer).metadata();
  assert.equal(actual.format, 'jpeg');
  assert.equal(actual.width, result.width);
  assert.equal(actual.height, result.height);
  assert.equal(result.hash, crypto.createHash('sha256').update(result.buffer).digest('hex'));
});

test('EXIF rotation is applied and stripped; transparent landscape images keep full contents on white square padding', async () => {
  const oriented = await sharp({create: {width: 1000, height: 600, channels: 3, background: '#884411'}}).jpeg().withMetadata({orientation: 6}).toBuffer();
  const result = await processImage(oriented, {square: false, maxDimension: 1000});
  assert.equal(result.sourceWidth, 600);
  assert.equal(result.sourceHeight, 1000);
  assert.equal(result.width, 600);
  assert.equal(result.height, 1000);
  assert.equal(result.orientationApplied, true);
  assert.equal((await sharp(result.buffer).metadata()).orientation, undefined);
  assert.equal((await sharp(result.buffer).metadata()).exif, undefined);
  const source = await sharp({create: {width: 1000, height: 600, channels: 4, background: {r: 220, g: 0, b: 0, alpha: 0.5}}}).png().toBuffer();
  const padded = await processImage(source, {maxDimension: 1000});
  const {data, info} = await sharp(padded.buffer).raw().toBuffer({resolveWithObject: true});
  assert.equal(info.channels, 3);
  assert.deepEqual([...data.subarray(0, 3)], [255, 255, 255]);
  const center = (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * 3;
  assert.ok(data[center] > 200 && data[center + 1] > 110 && data[center + 1] < 150);
});

test('preparation keeps ordered source mapping and safe manifests, rejects path traversal and duplicate links before downloading', async t => {
  const dir = temp(t), buffer = await png();
  const secretUrl = 'https://prod-files-secure.s3.us-west-2.amazonaws.com/test/image.png?X-Amz-Security-Token=PRIVATE&X-Amz-Signature=SECRET';
  let count = 0;
  const options = {maxDimension: 600, fetch: async () => { count++; return new Response(buffer); }};
  const ready = await prepareImages([drive(imageId), {url: secretUrl}], dir, 'plan-images-valid', options);
  assert.equal(ready.status, 'ready');
  assert.equal(ready.images.length, 2);
  assert.ok(ready.images[0].filename.startsWith('01-'));
  assert.ok(ready.images[1].filename.startsWith('02-'));
  assert.equal(path.dirname(ready.images[0].path), path.join(dir, 'replacement-assets', 'plan-images-valid'));
  for (const image of ready.images) {
    assert.ok(fs.existsSync(image.path));
    assert.equal(image.hash, crypto.createHash('sha256').update(fs.readFileSync(image.path)).digest('hex'));
  }
  const serialized = fs.readFileSync(ready.manifestPath, 'utf8');
  assert.equal(serialized.includes('PRIVATE'), false);
  assert.equal(serialized.includes('SECRET'), false);
  assert.equal(serialized.includes(dir.replaceAll('\\', '\\\\')), false);
  assert.equal(JSON.parse(serialized).images[0].sourceUrl, drive(imageId));
  await assert.rejects(prepareImages([drive(imageId)], dir, '../outside', options), /không hợp lệ/);
  await assert.rejects(prepareImages([drive(imageId), drive(imageId)], dir, 'plan-duplicate', options), /trùng/);
  await assert.rejects(prepareImages(new Array(10).fill(drive(imageId)), dir, 'plan-too-many', options), /1 đến 9/);
  assert.equal(count, 2);
  const again = await prepareImages([drive(imageId), secretUrl], dir, 'plan-images-valid', options);
  assert.equal(again.images[0].hash, ready.images[0].hash);
  assert.equal(fs.existsSync(path.join(ready.dir, '.preparing')), false);
});

test('partial preparation is durable but never marked ready; junctions cannot escape the assets directory', async t => {
  const dir = temp(t), outside = temp(t), buffer = await png();
  let calls = 0;
  await assert.rejects(prepareImages([drive(imageId), drive('SECOND_file_1234567')], dir, 'plan-partial-images', {
    maxDimension: 600, fetch: async () => ++calls === 1 ? new Response(buffer) : new Response(null, {status: 403}),
  }), /HTTP 403/);
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'replacement-assets', 'plan-partial-images', 'manifest.json'), 'utf8'));
  assert.equal(saved.status, 'failed');
  assert.equal(saved.images.length, 1);
  assert.equal(saved.readyAt, undefined);
  assert.equal(fs.existsSync(path.join(dir, 'replacement-assets', 'plan-partial-images', '.preparing')), false);
  const junction = path.join(dir, 'replacement-assets', 'plan-junction-images');
  fs.symlinkSync(outside, junction, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(prepareImages([drive(imageId)], dir, 'plan-junction-images', {fetch: async () => { throw Error('must not fetch'); }}), /không hợp lệ/);
  assert.deepEqual(fs.readdirSync(outside), []);
});
