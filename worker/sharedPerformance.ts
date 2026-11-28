import type { AccountEnv } from './auth';

const privateHeaders = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };

export async function recordedAudio(request: Request, bucket: R2Bucket, key: string) {
  const head = await bucket.head(key);
  if (!head) return new Response(null, { status: 404, headers: privateHeaders });
  const size = head.size;
  const headers = new Headers({ ...privateHeaders, 'Content-Type': 'audio/mpeg', 'Accept-Ranges': 'bytes' });
  let offset = 0, end = size - 1;
  const range = request.headers.get('range');
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (m && (m[1] || m[2])) {
      if (m[1]) {
        offset = Number(m[1]);
        if (m[2]) end = Math.min(end, Number(m[2]));
      } else offset = Math.max(0, size - Number(m[2]));
    }
    if (!m || !(m[1] || m[2]) || offset > end) {
      headers.set('Content-Range', 'bytes */' + size);
      return new Response(null, { status: 416, headers });
    }
    headers.set('Content-Range', `bytes ${offset}-${end}/${size}`);
  }
  const length = end - offset + 1;
  headers.set('Content-Length', String(length));
  const status = range ? 206 : 200;
  if (request.method === 'HEAD') return new Response(null, { status, headers });
  const object = await bucket.get(key, { range: { offset, length } });
  return object ? new Response(object.body, { status, headers }) : new Response(null, { status: 404, headers: privateHeaders });
}

const escapeText = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

export async function sharedPerformance(request: Request, env: AccountEnv): Promise<Response> {
  if (!['GET','HEAD'].includes(request.method)) return new Response(null, { status: 405, headers: { ...privateHeaders, Allow: 'GET, HEAD' } });
  const path = new URL(request.url).pathname;
  const match = /^\/p\/([a-f0-9]{32})(\/audio|\/performance|\/notation)?\/?$/.exec(path);
  const row = match && env.DB && env.PRIVATE_SCORES ? await env.DB.prepare(
    'SELECT id,user_id,title,take_label,audio_sha256 FROM saved_scores WHERE share_id=? AND ready=1 AND has_performance=1',
  ).bind(match[1]).first<{id:string;user_id:string;title:string;take_label:string;audio_sha256:string|null}>() : null;
  if (match?.[2]) {
    if (row?.audio_sha256 && match[2] === '/audio') return recordedAudio(request, env.PRIVATE_SCORES!, row.user_id+'/'+row.id+'/audio');
    if (row && !row.audio_sha256 && (match[2] === '/performance' || match[2] === '/notation')) {
      const key = row.user_id+'/'+row.id+match[2];
      const object = request.method === 'HEAD' ? await env.PRIVATE_SCORES!.head(key) : await env.PRIVATE_SCORES!.get(key);
      if (object) return new Response('body' in object ? (object as R2ObjectBody).body : null, { headers: {
        ...privateHeaders, 'Content-Type':match[2] === '/performance' ? 'audio/midi' : 'application/octet-stream', 'X-Pianora-Title':encodeURIComponent(row.title),
        'X-Pianora-Take':encodeURIComponent(row.take_label ?? ''),
      } });
    }
    return new Response(null, {status:404, headers:privateHeaders});
  }
  if (row && !row.audio_sha256 && match) return new Response(null, {status:302, headers:{
    ...privateHeaders, Location:'/#studio/'+match[1], 'Referrer-Policy':'no-referrer',
  }});
  const en = /^en\b/i.test(request.headers.get('accept-language') ?? '');
  const title = row ? escapeText(row.title) : en ? 'Performance unavailable' : '这场演奏暂不可用';
  const html = `<!doctype html><html lang="${en?'en':'zh-CN'}"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · Pianora</title><style>
*{box-sizing:border-box}body{margin:0;background:#f6f5ee;color:#23382c;font:1rem/1.5 system-ui,sans-serif}main{width:min(90%,620px);margin:clamp(3rem,12vh,9rem) auto}a{color:inherit;font-weight:600;text-underline-offset:4px}a:focus-visible,audio:focus-visible{outline:3px solid #356b52;outline-offset:5px}
article{margin-top:1.5rem;padding:clamp(1.4rem,5vw,3rem);background:#fffef8;border:1px solid #cfd5c8;border-top:5px solid #40614c;border-radius:9px}h1{margin:0;font:500 clamp(2rem,6vw,3.5rem)/1.15 Georgia,serif;overflow-wrap:anywhere}p{color:#546252;overflow-wrap:anywhere}audio{display:block;width:100%;margin-top:2rem}
</style><main><a href="/">Pianora</a><article><h1>${title}</h1>${row && match ? `<p>${escapeText(row.take_label || '')}</p><audio controls preload="metadata" aria-label="${en?'Performance':'演奏录音'}" src="/p/${match[1]}/audio"></audio>` : `<p>${en?'This link is invalid or sharing has ended.':'链接无效，或作者已取消分享。'}</p>`}</article></main></html>`;
  return new Response(request.method === 'HEAD' ? null : html, { status: row ? 200 : 404, headers: {
    ...privateHeaders, 'Content-Type':'text/html; charset=utf-8', 'Referrer-Policy':'no-referrer', 'X-Robots-Tag':'noindex',
    'Content-Security-Policy': "default-src 'none'; media-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
  } });
}
