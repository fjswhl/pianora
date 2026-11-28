import { catalogApi } from './catalog';
import { sharedPerformance } from './sharedPerformance';
import { accountApi } from './accounts';
import type { AccountEnv } from './auth';

interface Env extends AccountEnv {
  ASSETS: { fetch(request: Request): Promise<Response> };
  BIG_FILES: R2Bucket;
  CATALOG: D1Database;
}

const TYPES: Record<string, string> = {
  wasm: 'application/wasm',
  onnx: 'application/octet-stream',
  sf2: 'application/octet-stream',
  sf3: 'application/octet-stream',
  dls: 'application/octet-stream',
  mjs: 'text/javascript',
};

function rangeOutsideObject(
  range: RegExpExecArray | null,
  size: number,
): boolean {
  if (!range) return false;
  const [, first, last] = range;
  if (!first) return Number(last) === 0 || size === 0;
  return Number(first) >= size || (last !== '' && Number(last) < Number(first));
}

function unsatisfiable(size: number) {
  return new Response(null, {
    status: 416,
    headers: {
      'content-range': `bytes */${size}`,
      'cache-control': 'no-store',
    },
  });
}

// A native tee can queue the whole soundfont for its slower consumer. Await
// both sinks per chunk so a mobile connection never builds an object-sized queue.
function streamAndCache(
  object: R2ObjectBody,
  headers: Headers,
  key: Request,
  ctx: ExecutionContext,
) {
  const client = new FixedLengthStream(object.size);
  const fill = new FixedLengthStream(object.size);
  const clientWriter = client.writable.getWriter();
  const cacheWriter = fill.writable.getWriter();
  let caching = true;
  const cacheTask = caches.default
    .put(key, new Response(fill.readable, { headers }))
    .catch((error) => console.warn('Asset cache fill failed', error))
    .finally(async () => {
      caching = false;
      await fill.readable.cancel().catch(() => {});
    });
  ctx.waitUntil(cacheTask);
  const copy = object.body.pipeTo(
    new WritableStream<Uint8Array>({
      async write(chunk) {
        const cached =
          caching &&
          cacheWriter.write(chunk).catch(() => {
            caching = false;
          });
        await Promise.all([clientWriter.write(chunk), cached]);
      },
      async close() {
        await Promise.all([
          clientWriter.close(),
          cacheWriter.close().catch(() => {}),
        ]);
      },
    }),
  );
  ctx.waitUntil(
    copy.catch((error) =>
      Promise.allSettled([clientWriter.abort(error), cacheWriter.abort(error)]),
    ),
  );
  headers.set('x-pianora-cache', 'MISS');
  return new Response(client.readable, { headers });
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path.startsWith('/api/catalog/') || path.startsWith('/presets/')) return catalogApi(request, env, ctx);
    if (path.startsWith('/p/')) return sharedPerformance(request, env);
    if (new URL(request.url).pathname.startsWith('/api/')) return accountApi(request, env);
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405 });
    }
    const url = new URL(request.url);
    const revision = url.searchParams.get('rev');
    if (revision !== null && !/^[a-f0-9]{32}(?:-\d+)?$/.test(revision)) {
      return new Response('Invalid asset revision', { status: 400 });
    }

    const key = decodeURIComponent(url.pathname.slice(1));
    const ext = key.split('.').pop() ?? '';
    const headersIn = new Headers(request.headers);
    const ifRange = headersIn.get('if-range');
    // Ignore unsupported multipart/malformed ranges and send a complete representation.
    let range = /^bytes=(\d*)-(\d*)$/i.exec(headersIn.get('range') ?? '');
    if (
      !range ||
      (!range[1] && !range[2]) ||
      (ifRange && ifRange !== `"${revision}"`)
    ) {
      headersIn.delete('range');
      range = null;
    }
    const canCache =
      revision &&
      !request.headers.has('if-match') &&
      !request.headers.has('if-unmodified-since') &&
      !request.headers.has('if-range');
    url.search = '';
    if (revision) url.searchParams.set('rev', revision);
    const cacheKey = new Request(url);
    if (canCache) {
      const lookup = new Request(cacheKey, { headers: headersIn });
      const hit = await caches.default.match(lookup);
      if (hit) {
        const size = Number(
          hit.headers.get('content-range')?.split('/')[1] ??
            hit.headers.get('content-length'),
        );
        if (hit.status !== 304 && size > 0 && rangeOutsideObject(range, size))
          return unsatisfiable(size);
        const headers = new Headers(hit.headers);
        headers.set('x-pianora-cache', 'HIT');
        return new Response(request.method === 'HEAD' ? null : hit.body, {
          status: hit.status,
          headers,
        });
      }
    }

    const obj = await env.BIG_FILES.get(key, {
      range: headersIn,
      onlyIf: headersIn,
    });
    if (!obj) {
      // Old clients still use static tokenizer JSON and ORT loaders.
      if (!revision && !['sf2', 'sf3', 'dls', 'onnx', 'wasm'].includes(ext))
        return env.ASSETS.fetch(request);
      return new Response('Not Found', { status: 404 });
    }
    if (revision && revision !== obj.etag) {
      if ('body' in obj) await obj.body.cancel();
      return new Response('Asset revision unavailable', {
        status: 404,
        headers: { 'cache-control': 'no-store' },
      });
    }

    const headers = new Headers();
    obj.writeHttpMetadata(headers);
    headers.set('etag', obj.httpEtag);
    headers.set('accept-ranges', 'bytes');
    headers.set('content-type', TYPES[ext] ?? 'application/octet-stream');
    headers.set(
      'cache-control',
      revision
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=0, must-revalidate',
    );
    headers.set('cross-origin-resource-policy', 'same-origin');
    if (!('body' in obj)) {
      const precondition =
        request.headers.has('if-match') ||
        request.headers.has('if-unmodified-since');
      return new Response(null, { status: precondition ? 412 : 304, headers });
    }

    if (rangeOutsideObject(range, obj.size)) {
      await obj.body.cancel();
      return unsatisfiable(obj.size);
    }
    let status = 200;
    if (range && obj.range && 'offset' in obj.range) {
      const off = obj.range.offset ?? 0;
      const len = obj.range.length ?? obj.size - off;
      headers.set('content-range', `bytes ${off}-${off + len - 1}/${obj.size}`);
      headers.set('content-length', String(len));
      status = 206;
    } else {
      headers.set('content-length', String(obj.size));
    }
    if (request.method === 'HEAD') {
      await obj.body.cancel();
      return new Response(null, { status, headers });
    }
    if (canCache && status === 200 && !request.headers.has('range')) {
      return streamAndCache(obj, headers, cacheKey, ctx);
    }
    headers.set('x-pianora-cache', canCache ? 'MISS' : 'BYPASS');
    return new Response(obj.body, { status, headers });
  },
} satisfies ExportedHandler<Env>;
