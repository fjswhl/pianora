/**
 * Pianora edge Worker.
 *
 * Static UI (HTML/JS/CSS/small assets) is served by Workers Static Assets (25 MiB/file limit).
 * Oversized binaries (ONNX model, ORT WASM, SoundFonts) live in R2 and are streamed here
 * with full HTTP Range support, same-origin (no CORS needed).
 *
 * Files above the R2 single-PUT limit are uploaded as ordered `.partN` chunks and
 * reassembled client-side by the audio engine (see `sf2PartUrls`).
 */
interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  BIG_FILES: R2Bucket;
}

const TYPES: Record<string, string> = {
  wasm: 'application/wasm',
  onnx: 'application/octet-stream',
  sf2: 'application/octet-stream',
  sf3: 'application/octet-stream',
  dls: 'application/octet-stream',
  mjs: 'text/javascript',
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    const url = new URL(request.url);
    const key = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    const wantsRange = request.headers.has('range');
    const obj = await env.BIG_FILES.get(key, {
      range: request.headers,
      onlyIf: request.headers,
    });

    // Not in R2 (e.g. tokenizer json, small ort .mjs) -> fall back to static assets
    if (obj === null) {
      const ext = key.split('.').pop() ?? '';
      // Never let the SPA fallback answer with HTML for a binary request
      if (['sf2', 'sf3', 'dls', 'onnx', 'wasm'].includes(ext)) {
        return new Response('Not Found', { status: 404 });
      }
      return env.ASSETS.fetch(request);
    }

    const ext = key.split('.').pop() ?? '';
    const headers = new Headers();
    obj.writeHttpMetadata(headers);
    headers.set('etag', obj.httpEtag);
    headers.set('accept-ranges', 'bytes');
    headers.set('content-type', TYPES[ext] ?? 'application/octet-stream');
    headers.set('cache-control', 'public, max-age=31536000, immutable');
    headers.set('cross-origin-resource-policy', 'same-origin');

    if (!('body' in obj)) {
      // Conditional request satisfied (If-None-Match etc.)
      return new Response(null, { status: 304, headers });
    }

    let status = 200;
    if (wantsRange && obj.range && 'offset' in obj.range) {
      const off = obj.range.offset ?? 0;
      const len = obj.range.length ?? obj.size - off;
      headers.set('content-range', `bytes ${off}-${off + len - 1}/${obj.size}`);
      headers.set('content-length', String(len));
      status = 206;
    } else {
      headers.set('content-length', String(obj.size));
    }

    return new Response(request.method === 'HEAD' ? null : obj.body, { status, headers });
  },
} satisfies ExportedHandler<Env>;
