import formats from '../catalog/formats.json';
import { storageKey } from '../catalog/objects.mjs';

interface CatalogEnv {
  CATALOG: D1Database;
  BIG_FILES: R2Bucket;
}
interface ScoreRow {
  number: number;
  id: string;
  composer: string;
  file: string;
  metadata: string;
  object_name: string;
}
const selectScore = `SELECT s.number,s.id,s.composer,s.file,s.metadata,f.object_name
  FROM catalog_scores s JOIN catalog_files f ON f.path=s.file`;
const filesRoute = '/api/catalog/files/';
const shortCache = 'public, max-age=60, s-maxage=300';
const missing = () => new Response('Not found', { status: 404 });
const invalid = () => new Response('Invalid catalog query', { status: 400 });
const json = (body: unknown) =>
  Response.json(body, { headers: { 'cache-control': shortCache } });
function score(row: ScoreRow) {
  return {
    ...JSON.parse(row.metadata),
    number: row.number,
    id: row.id,
    composer: row.composer,
    file: row.file,
    url: filesRoute + row.object_name,
  };
}
function pageNumber(value: string | null, fallback: number, max: number) {
  if (value === null) return fallback;
  if (!/^\d{1,15}$/.test(value) || Number(value) > max) return NaN;
  return Number(value);
}
async function catalogFile(
  name: string,
  bucket: R2Bucket,
): Promise<{ response: Response; cacheable: boolean }> {
  const match = /^[a-f0-9]{64}\.([a-z0-9]+)$/.exec(name);
  if (!match || !Object.hasOwn(formats, match[1]))
    return { response: missing(), cacheable: false };
  const key = storageKey(name);
  const object = await bucket.get(key);
  if (!object) return { response: missing(), cacheable: false };
  const compressed = key.endsWith('.gz');
  const response = new Response(
    compressed
      ? object.body.pipeThrough(new DecompressionStream('gzip'))
      : object.body,
    {
      headers: {
        'content-type': formats[match[1] as keyof typeof formats],
        'content-security-policy': "sandbox; default-src 'none'",
        'x-content-type-options': 'nosniff',
        etag: '"' + name.split('.')[0] + '"',
        'cache-control': 'public, max-age=31536000, immutable',
      },
    },
  );
  // Cache API tees the response stream. Bound buffered data on slow clients.
  const cacheable = object.size <= (compressed ? 32_768 : 2_000_000);
  return { response, cacheable };
}

async function readCatalog(url: URL, env: CatalogEnv) {
  const path = url.pathname;
  if (path.startsWith('/presets/')) {
    let file;
    try {
      file = decodeURIComponent(path.slice(9));
    } catch {
      return invalid();
    }
    const name = await env.CATALOG.prepare(
      'SELECT object_name FROM catalog_files WHERE path=?',
    )
      .bind(file)
      .first<string>('object_name');
    return name
      ? new Response(null, {
          status: 302,
          headers: { location: filesRoute + name, 'cache-control': shortCache },
        })
      : missing();
  }
  if (path === '/api/catalog/composers') {
    const after = url.searchParams.get('after') ?? '';
    if (after.length > 160) return invalid();
    const { results } = await env.CATALOG.prepare(
      'SELECT composer,pieces FROM catalog_composers WHERE composer>? ORDER BY composer LIMIT 101',
    )
      .bind(after)
      .all<{ composer: string; pieces: number }>();
    const next = results.length > 100 ? results[99].composer : null;
    // The total is maintained on publication, so even a cold catalog page takes one point lookup.
    const total = await env.CATALOG.prepare(
      'SELECT pieces FROM catalog_total WHERE id=1',
    ).first<number>('pieces');
    return json({ items: results.slice(0, 100), next, total });
  }
  if (path === '/api/catalog/scores') {
    const after = pageNumber(
      url.searchParams.get('after'),
      0,
      Number.MAX_SAFE_INTEGER,
    );
    const limit = pageNumber(url.searchParams.get('limit'), 48, 64);
    const composer = url.searchParams.get('composer');
    if (
      !Number.isFinite(after) ||
      !limit ||
      (composer !== null && (!composer || composer.length > 160))
    )
      return invalid();
    const query = composer
      ? env.CATALOG.prepare(
          selectScore +
            ' WHERE s.composer=? AND s.number>? ORDER BY s.number LIMIT ?',
        ).bind(composer, after, limit + 1)
      : env.CATALOG.prepare(
          selectScore + ' WHERE s.number>? ORDER BY s.number LIMIT ?',
        ).bind(after, limit + 1);
    const { results } = await query.all<ScoreRow>();
    return json({
      items: results.slice(0, limit).map(score),
      next: results.length > limit ? results[limit - 1].number : null,
    });
  }
  const match = /^\/api\/catalog\/scores\/([a-z0-9][a-z0-9_-]{0,95})$/.exec(
    path,
  );
  if (!match) return missing();
  const row = await env.CATALOG.prepare(selectScore + ' WHERE s.id=?')
    .bind(match[1])
    .first<ScoreRow>();
  return row ? json(score(row)) : missing();
}
export async function catalogApi(
  request: Request,
  env: CatalogEnv,
  ctx: ExecutionContext,
) {
  if (!['HEAD', 'GET'].includes(request.method))
    return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } });
  const url = new URL(request.url);
  const allowed =
    url.pathname === '/api/catalog/scores'
      ? ['composer', 'after', 'limit']
      : url.pathname === '/api/catalog/composers'
        ? ['after']
        : [];
  for (const key of [...url.searchParams.keys()])
    if (!allowed.includes(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  const key = new Request(url.toString());
  let response = await caches.default.match(key);
  if (!response) {
    let cacheable = true;
    if (url.pathname.startsWith(filesRoute)) {
      const file = await catalogFile(
        url.pathname.slice(filesRoute.length),
        env.BIG_FILES,
      );
      response = file.response;
      cacheable = file.cacheable;
    } else {
      response = await readCatalog(url, env);
    }
    if (cacheable && (response.ok || response.status === 302))
      ctx.waitUntil(caches.default.put(key, response.clone()).catch(() => {}));
  }
  const etag = response.headers.get('etag');
  if (
    etag &&
    request.headers
      .get('if-none-match')
      ?.split(',')
      .some((tag) => ['*', etag, 'W/' + etag].includes(tag.trim()))
  ) {
    await response.body?.cancel();
    return new Response(null, { status: 304, headers: response.headers });
  }
  if (request.method === 'HEAD') {
    await response.body?.cancel();
    return new Response(null, {
      status: response.status,
      headers: response.headers,
    });
  }
  return response;
}
