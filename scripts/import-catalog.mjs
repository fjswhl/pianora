// Validate a batch before uploading, then publish metadata only after checking every object.
import { createHash } from 'node:crypto';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { gzipSync, gunzipSync } from 'node:zlib';
import { storageKey } from '../catalog/objects.mjs';
import formats from '../catalog/formats.json' with { type: 'json' };

const { values: opts } = parseArgs({
  options: {
    manifest: { type: 'string', default: 'catalog/seed/manifest.json' },
    files: { type: 'string', default: 'catalog/seed/files' },
    remote: { type: 'boolean' },
    local: { type: 'boolean' },
    plan: { type: 'boolean' },
    'sql-out': { type: 'string' },
    'persist-to': { type: 'string' },
  },
});
if ([opts.remote, opts.local, opts.plan].filter(Boolean).length !== 1)
  throw Error('Select exactly one of --plan, --local or --remote');
if (!opts.plan && !opts['sql-out'])
  throw Error('Specify --sql-out for the verified D1 import file');
const root = await realpath(opts.files);
const { scores, attachments = [] } = JSON.parse(
  await readFile(opts.manifest, 'utf8'),
);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sqlString = (s) => "'" + String(s).replaceAll("'", "''") + "'";
const ids = new Set();
const files = new Map();
const objects = new Map();
const statements = [];
for (const score of scores) {
  const { id, composer, file, ...metadata } = score;
  if (
    typeof id !== 'string' ||
    !/^[a-z0-9][a-z0-9_-]{0,95}$/.test(id) ||
    ids.has(id) ||
    ['custom', 'imported'].includes(id) ||
    typeof composer !== 'string' ||
    !composer.trim() ||
    composer.length > 160 ||
    typeof metadata.name !== 'string' ||
    !metadata.name.trim() ||
    [
      'subtitle',
      'title',
      'credit',
      'art',
      'scoreType',
      'displayName',
      'nameEn',
      'creditEn',
      'subtitleEn',
      'displayNameEn',
    ].some(
      (key) => metadata[key] !== undefined && typeof metadata[key] !== 'string',
    ) ||
    (metadata.bars !== undefined &&
      (!Number.isSafeInteger(metadata.bars) || metadata.bars < 0)) ||
    !/\.(ly|mid|midi|musicxml|xml|mxl)$/i.test(file) ||
    Buffer.byteLength(JSON.stringify(metadata)) > 8192
  )
    throw Error('Invalid score or duplicate id: ' + id);
  ids.add(id);
  statements.push(
    `INSERT INTO catalog_scores(id,composer,file,metadata) VALUES (${[id, composer, file, JSON.stringify(metadata)].map(sqlString)}) ON CONFLICT(id) DO UPDATE SET composer=excluded.composer,file=excluded.file,metadata=excluded.metadata WHERE composer<>excluded.composer OR file<>excluded.file OR metadata<>excluded.metadata;`,
  );
}
for (const { file } of [...scores, ...attachments]) {
  if (files.has(file)) continue;
  const ext = extname(file).slice(1).toLowerCase();
  if (
    !Object.hasOwn(formats, ext) ||
    /[\\\x00-\x1f]/.test(file) ||
    file.split('/').some((p) => ['', '.', '..'].includes(p))
  )
    throw Error('Invalid file: ' + file);
  const path = await realpath(resolve(root, file));
  if (!path.startsWith(root + sep))
    throw Error('File outside batch directory: ' + file);
  const bytes = await readFile(path);
  const digest = hash(bytes);
  const name = digest + '.' + ext;
  const key = storageKey(name);
  const size = key.endsWith('.gz')
    ? gzipSync(bytes, { level: 9 }).length
    : bytes.length;
  const info = { path, name, key, digest, bytes: bytes.length, size };
  files.set(file, info);
  objects.set(key, info);
}
const fileSql = [...files].map(
  ([file, f]) =>
    `INSERT INTO catalog_files VALUES (${sqlString(file)},${sqlString(f.name)},${f.bytes},${f.size}) ON CONFLICT(path) DO UPDATE SET object_name=excluded.object_name,bytes=excluded.bytes,stored_bytes=excluded.stored_bytes WHERE object_name<>excluded.object_name;`,
);
console.log(
  JSON.stringify({
    scores: scores.length,
    files: files.size,
    uniqueObjects: objects.size,
    rawBytes: [...objects.values()].reduce((n, f) => n + f.bytes, 0),
    storedBytes: [...objects.values()].reduce((n, f) => n + f.size, 0),
  }),
);
if (opts.plan) process.exit(0);

let proxy;
let bucket;
let endpoint;
if (opts.local) {
  const { getPlatformProxy } = await import('wrangler');
  proxy = await getPlatformProxy({
    configPath: 'wrangler.jsonc',
    ...(opts['persist-to'] && {
      persist: { path: resolve(opts['persist-to'], 'v3') },
    }),
  });
  bucket = proxy.env.BIG_FILES;
} else {
  const { CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID } = process.env;
  if (
    !CLOUDFLARE_API_TOKEN ||
    !/^[0-9a-f]{32}$/.test(CLOUDFLARE_ACCOUNT_ID ?? '')
  )
    throw Error('Provide Cloudflare account ID and R2 token');
  endpoint =
    'https://api.cloudflare.com/client/v4/accounts/' +
    CLOUDFLARE_ACCOUNT_ID +
    '/r2/buckets/pianora-assets/objects/';
}
async function remote(key, method, body) {
  const result = await fetch(endpoint + key, {
    method,
    body,
    redirect: 'error',
    headers: { Authorization: 'Bearer ' + process.env.CLOUDFLARE_API_TOKEN },
  });
  if (method === 'GET' && result.status === 404) return null;
  if (!result.ok) throw Error(method + ' ' + key + ' HTTP ' + result.status);
  return Buffer.from(await result.arrayBuffer());
}
async function get(key) {
  if (!bucket) return remote(key, 'GET');
  const obj = await bucket.get(key);
  return obj && Buffer.from(await obj.arrayBuffer());
}
async function publish(f) {
  let stored = await get(f.key);
  if (stored === null) {
    const bytes = await readFile(f.path);
    if (hash(bytes) !== f.digest)
      throw Error('Source changed during import: ' + f.path);
    const body = f.key.endsWith('.gz') ? gzipSync(bytes, { level: 9 }) : bytes;
    if (bucket) await bucket.put(f.key, body);
    else await remote(f.key, 'PUT', body);
    stored = await get(f.key);
  }
  if (
    !stored ||
    hash(f.key.endsWith('.gz') ? gunzipSync(stored) : stored) !== f.digest
  )
    throw Error('Stored checksum mismatch: ' + f.key);
}
try {
  const queue = objects.values();
  const jobs = Array.from({ length: 4 }, async () => {
    for (const f of queue) await publish(f);
  });
  const results = await Promise.allSettled(jobs);
  for (const r of results) if (r.status === 'rejected') throw r.reason;
  await writeFile(
    opts['sql-out'],
    [...fileSql, ...statements].join('\n') + '\n',
  );
  console.log('Verified objects. D1 publication file: ' + opts['sql-out']);
} finally {
  await proxy?.dispose();
}
