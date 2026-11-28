import { LocalizedError } from '../i18n';
import sources from './assetSources.json';

interface Pack {
  revision: string;
  size: number;
  chunkSize: number;
  stride: number;
  parts: string[];
}

// The manifest is embedded in the build so an open tab keeps its own release.
const manifests = import.meta.glob<Record<string, Pack>>('/public/packs/manifest.json', { eager: true, import: 'default' });
const packs = Object.values(manifests)[0] ?? {};
export const ortWasmPath = '/ort/ort-wasm-simd-threaded.jsep.wasm';
const defaultPaths = [sources.abbey.path, sources.model.path, ortWasmPath];
interface PartRead {
  bytes: Uint8Array<ArrayBuffer>;
  fromCache: boolean;
}

export interface PartProgress {
  cached: number;
  fetched: number;
  total: number;
}

export type AssetProgress = (loaded: number, total: number, parts?: PartProgress) => void;

const jobs = new Map<string, Promise<PartRead>>();
let activeReads = 0;
let cachePromise: Promise<Cache | undefined> | undefined;
let storageFull = false;

function diskCache() {
  return cachePromise ??= Promise.resolve().then(() => caches.open('pianora-asset-packs-v1')).catch(() => undefined);
}

function partUrl(path: string, digest: string) {
  const dir = path.startsWith('/performance-packs/') ? '/performance-packs/' : '/packs/';
  return dir + path.slice(path.lastIndexOf('/') + 1) + '-' + digest + '.pack';
}

async function verified(response: Response, digest: string) {
  if (!response.ok || response.status !== 200) throw new LocalizedError("下载分块失败");
  const bytes = new Uint8Array(await response.arrayBuffer());
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  if (!hash.every((v, i) => v === parseInt(digest.slice(i * 2, i * 2 + 2), 16))) throw new LocalizedError("资源分块校验失败");
  return bytes;
}

async function readPart(url: string, digest: string, background: boolean) {
  const cache = await diskCache();
  const hit = await cache?.match(url).catch(() => undefined);
  if (hit) {
    try { return { bytes: await verified(hit, digest), fromCache: true }; }
    catch { await cache?.delete(url).catch(() => {}); }
  }
  const response = await fetch(url, {
    cache: cache && !storageFull ? 'no-store' : 'default',
    priority: background ? 'low' : 'auto',
  }).catch(error => {
    if (!navigator.onLine) throw new LocalizedError("离线所需资源尚未下载完整，请联网继续。");
    throw error;
  });
  const bytes = await verified(response, digest);
  if (cache && !storageFull) {
    try { await cache.put(url, new Response(bytes, { headers: { Date: new Date().toUTCString() } })); }
    catch { storageFull = true; }
  }
  return { bytes, fromCache: false };
}

function part(path: string, digest: string, background: boolean) {
  const url = partUrl(path, digest);
  const pending = jobs.get(url);
  if (pending) return pending;
  const read = () => readPart(url, digest, background);
  // Another tab may already be filling this content-addressed cache entry.
  const download = navigator.locks ? navigator.locks.request('pianora:' + url, read).then(bytes => bytes) : read();
  const promise = download.finally(() => jobs.delete(url));
  jobs.set(url, promise);
  return promise;
}

export function packedAsset(url: string) {
  const request = new URL(url, location.href);
  const pack = packs[request.pathname];
  if (!pack || !globalThis.crypto?.subtle || typeof DecompressionStream === 'undefined') return;
  if (request.searchParams.get('rev') !== pack.revision && request.pathname !== ortWasmPath) return;
  return { path: request.pathname, pack };
}

export async function unpackAsset(
  { path, pack }: NonNullable<ReturnType<typeof packedAsset>>,
  progress?: AssetProgress,
  signal?: AbortSignal,
) {
  activeReads++;
  try {
    const output = new Uint8Array(pack.size);
    let loaded = 0;
    let cached = 0;
    let fetched = 0;
    let next = 0;
    let failed = false;
    async function read() {
      while (!failed && next < pack.parts.length) {
        signal?.throwIfAborted();
        const index = next++;
        const { bytes, fromCache } = await part(path, pack.parts[index], false);
        signal?.throwIfAborted();
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
        const raw = new Uint8Array(await new Response(stream).arrayBuffer());
        const offset = index * pack.chunkSize;
        const length = Math.min(pack.chunkSize, pack.size - offset);
        if (raw.length !== length) throw new LocalizedError("资源分块长度不匹配");
        if (pack.stride === 1) output.set(raw, offset);
        else {
          let src = 0;
          for (let lane = 0; lane < pack.stride; lane++)
            for (let i = lane; i < length; i += pack.stride) output[offset + i] = raw[src++];
        }
        if (failed) return;
        loaded += length;
        if (fromCache) cached++;
        else fetched++;
        progress?.(loaded, pack.size, { cached, fetched, total: pack.parts.length });
      }
    }
    try { await Promise.all([read(), read()]); }
    finally { failed = true; }
    return output;
  } finally {
    activeReads--;
  }
}

interface Connection extends EventTarget {
  saveData?: boolean;
  effectiveType?: string;
  type?: string;
}

let warmPianoFlow = true;
export function setPianoFlowPreload(enabled: boolean) {
  warmPianoFlow = enabled;
  window.dispatchEvent(new Event('pianora:preload-model'));
}

export function warmPerformanceAssets() {
  const connection = (navigator as Navigator & { connection?: Connection }).connection;
  let disposed = false;
  let running = false;
  let timer = 0;
  let idle = 0;
  let index = 0;
  let initialized = false;
  let failures = 0;
  const queue = defaultPaths.flatMap(path => (packs[path]?.parts ?? []).map(digest => ({ path, digest })));
  const eligible = () => !disposed && !storageFull && failures < 3 && !!globalThis.crypto?.subtle && typeof DecompressionStream !== 'undefined' && document.visibilityState === 'visible' && navigator.onLine &&
    !connection?.saveData && !['slow-2g', '2g', '3g'].includes(connection?.effectiveType ?? '') &&
    connection?.type !== 'cellular' &&
    // Some mobile browsers report a cellular link as effectiveType "4g" even on Wi-Fi.
    // Only speculate on touch devices when the browser identifies an unmetered link.
    (!matchMedia('(pointer: coarse)').matches || ['wifi','ethernet'].includes(connection?.type ?? ''));
  function schedule(delay = 250) {
    clearTimeout(timer);
    if (idle) window.cancelIdleCallback(idle);
    if (running || !eligible() || index >= queue.length) return;
    if (!warmPianoFlow && queue[index].path !== sources.abbey.path) return;
    timer = window.setTimeout(() => {
      if ('requestIdleCallback' in window) idle = window.requestIdleCallback(() => { idle = 0; void warm(); });
      else void warm();
    }, delay);
  }
  async function warm() {
    if (!eligible()) return;
    if (activeReads) { schedule(750); return; }
    running = true;
    let retry = false;
    try {
      const cache = await diskCache();
      if (!cache) { index = queue.length; return; }
      if (!initialized) {
        initialized = true;
        const keys = await cache.keys();
        const expected = new Set(Object.entries(packs).flatMap(([path, pack]) => pack.parts.map(hash => partUrl(path, hash))));
        for (const key of keys) {
          const pathname = new URL(key.url).pathname;
          if (!pathname.startsWith('/packs/') || expected.has(pathname)) continue;
          const entry = await cache.match(key);
          const date = Date.parse(entry?.headers.get('date') ?? '');
          if (date < Date.now() - 7 * 86400000) await cache.delete(key);
        }
      }
      if (index % 8 === 0) {
        const estimate = await navigator.storage?.estimate?.();
        // Leave room for a recent generation and the next application update.
        if (estimate?.quota && estimate.quota - (estimate.usage ?? 0) < 32 * 1024 * 1024) {
          index = queue.length;
          return;
        }
      }
      if (!eligible() || activeReads) return;
      const { path, digest } = queue[index];
      // keys() checks for a completed entry without loading its multi-MB body.
      if (!(await cache.keys(partUrl(path, digest))).length) await part(path, digest, true);
      index++;
      failures = 0;
    } catch { failures++; retry = true; }
    finally {
      running = false;
      schedule(retry ? 30000 : 50);
    }
  }
  const resume = () => schedule(1000);
  document.addEventListener('visibilitychange', resume);
  window.addEventListener('pianora:preload-model', resume);
  window.addEventListener('online', resume);
  window.addEventListener('hashchange', resume);
  connection?.addEventListener('change', resume);
  schedule(3500);
  return () => {
    disposed = true;
    clearTimeout(timer);
    if (idle) window.cancelIdleCallback(idle);
    document.removeEventListener('visibilitychange', resume);
    window.removeEventListener('pianora:preload-model', resume);
    window.removeEventListener('online', resume);
    window.removeEventListener('hashchange', resume);
    connection?.removeEventListener('change', resume);
  };
}
