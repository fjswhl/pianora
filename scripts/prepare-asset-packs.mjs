// Prepare lossless, independently cacheable files below the Workers Static Assets size limit.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { gzipSync } from 'node:zlib';

const releases = JSON.parse(await readFile(new URL('../src/engine/assetSources.json', import.meta.url)));
const out = 'public/packs';
const staging = out + '-' + process.pid;
const chunkSize = 2 * 1024 * 1024;
const hash = (algorithm, data) => createHash(algorithm).update(data).digest('hex');
const runtime = '/ort/ort-wasm-simd-threaded.jsep.wasm';
const assets = [releases.model, releases.abbey, { path: runtime }, releases.nice, releases.fazioli];
const manifest = {};

async function source(asset) {
  try {
    return await readFile('public' + asset.path);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  // In CI the large originals live in R2. Local builds can use raw R2 fallbacks.
  if (!process.env.PIANORA_PACK_ORIGIN || !asset.revision) return;
  const url = new URL(asset.path, process.env.PIANORA_PACK_ORIGIN);
  url.searchParams.set('rev', asset.revision);
  const headers = { 'Accept-Encoding': 'identity' };
  const head = await fetch(url, { method: 'HEAD', redirect: 'error', headers, signal: AbortSignal.timeout(30000) });
  const size = Number(head.headers.get('content-length'));
  if (!head.ok || !Number.isSafeInteger(size) || size <= 0)
    throw new Error('Cannot determine release size: ' + asset.path);
  const bytes = Buffer.allocUnsafe(size);
  const rangeSize = 8 * 1024 * 1024;
  for (let begin = 0; begin < size; begin += rangeSize) {
    const end = Math.min(size, begin + rangeSize) - 1;
    for (let attempt = 1; ; attempt++) {
      try {
        const response = await fetch(url, {
          headers: { ...headers, Range: `bytes=${begin}-${end}` },
          redirect: 'error', signal: AbortSignal.timeout(45000),
        });
        if (response.status !== 206 || response.headers.get('content-range') !== `bytes ${begin}-${end}/${size}`) {
          await response.body?.cancel();
          throw new Error('Invalid byte range: ' + asset.path);
        }
        const part = new Uint8Array(await response.arrayBuffer());
        if (part.length !== end - begin + 1) throw new Error('Incomplete range: ' + asset.path);
        bytes.set(part, begin);
        break;
      } catch (error) {
        if (attempt === 3) throw error;
        await new Promise(resolve => setTimeout(resolve, attempt * 500));
      }
    }
  }
  return bytes;
}

try {
  await mkdir(staging, { recursive: true });
  for (const asset of assets) {
    const bytes = await source(asset);
    if (!bytes) continue;
    const revision = hash('md5', bytes);
    if (asset.revision && asset.revision !== revision) throw new Error('Unexpected release ' + asset.path);
    const stride = asset.path.endsWith('.onnx') ? 4 : asset.path.endsWith('.sf2') ? 2 : 1;
    const parts = [];
    let wire = 0;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      const raw = bytes.subarray(offset, offset + chunkSize);
      // Group equal byte positions of float32 weights / 16-bit samples before gzip.
      let data = raw;
      if (stride > 1) {
        data = Buffer.allocUnsafe(raw.length);
        let dest = 0;
        for (let lane = 0; lane < stride; lane++)
          for (let i = lane; i < raw.length; i += stride) data[dest++] = raw[i];
      }
      const packed = gzipSync(data, { level: 6 });
      const digest = hash('sha256', packed);
      const name = basename(asset.path) + '-' + digest + '.pack';
      await writeFile(join(staging, name), packed);
      parts.push(digest);
      wire += packed.length;
    }
    manifest[asset.path] = { revision, size: bytes.length, chunkSize, stride, parts };
    console.log(`[packs] ${asset.path} · ${bytes.length} → ${wire} bytes · ${parts.length} chunks`);
  }
  await writeFile(join(staging, 'manifest.json'), JSON.stringify(manifest));
  await rm(out, { recursive: true, force: true });
  await rename(staging, out);
} finally {
  await rm(staging, { recursive: true, force: true });
}
