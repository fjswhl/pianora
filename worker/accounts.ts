import { authFor, providers, type AccountEnv } from './auth';

const maxScoreSize = 12 * 1024 * 1024;

export async function accountApi(request: Request, env: AccountEnv): Promise<Response> {
  const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
  const json = (data: unknown, status = 200) => Response.json(data, { status, headers });
  const path = new URL(request.url).pathname;
  const enabled = providers(env);
  if (request.method === 'GET' && path === '/api/account/options') return json(enabled);
  if (!enabled.email && !enabled.google) return json({ error: '账户服务尚未启用' }, 503);
  const auth = authFor(env);
  if (path.startsWith('/api/auth/')) {
    const res = await auth.handler(request);
    const copy = new Response(res.body, res);
    copy.headers.set('cache-control', 'private, no-store');
    return copy;
  }
  if (!path.startsWith('/api/library')) return json({ error: '未找到接口' }, 404);
  if (request.method !== 'GET' && request.headers.get('origin') !== new URL(env.BETTER_AUTH_URL!).origin)
    return json({ error: '请求来源无效' }, 403);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return json({ error: '请先登录' }, 401);
  const owner = session.user.id;
  const db = env.DB!, bucket = env.PRIVATE_SCORES!;
  if (path === '/api/library' && request.method === 'GET') {
    const { results } = await db.prepare(
      'SELECT id, title, filename, has_performance, created_at FROM saved_scores WHERE user_id=? AND ready=1 ORDER BY created_at DESC',
    ).bind(owner).all();
    return json(results);
  }
  if (path === '/api/library' && request.method === 'POST') {
    const length = Number(request.headers.get('content-length'));
    if (!length || length > maxScoreSize) return json({ error: '单次保存上限为 12 MB' }, 413);
    let form: FormData;
    try { form = await request.formData(); } catch { return json({ error: '文件格式无效' }, 400); }
    const source = form.get('source'), midi = form.get('performance'), title = form.get('title');
    if (!(source instanceof File) || !source.size || !/\.(ly|txt|mid|midi|musicxml|xml|mxl)$/i.test(source.name)
      || source.name.length > 255 || typeof title !== 'string' || !title.trim() || title.length > 200
      || (midi !== null && (!(midi instanceof File) || !midi.size)))
      return json({ error: '乐谱文件或名称无效' }, 400);
    // A retry (including two tabs saving the same take) completes the same private entry.
    const digest = async (bytes: BufferSource) =>
      Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('');
    const sourceHash = await digest(await source.arrayBuffer());
    const takeHash = midi instanceof File ? await digest(await midi.arrayBuffer()) : '';
    const id = await digest(new TextEncoder().encode(JSON.stringify([owner, title.trim(), source.name, sourceHash, takeHash])));
    const prefix = `${owner}/${id}`;
    await db.prepare('INSERT OR IGNORE INTO saved_scores (id,user_id,title,filename,has_performance,created_at) VALUES (?,?,?,?,?,?)')
      .bind(id, owner, title.trim(), source.name, midi ? 1 : 0, Date.now()).run();
    const row = await db.prepare('SELECT ready FROM saved_scores WHERE id=? AND user_id=?').bind(id, owner).first<{ready: number}>();
    if (row?.ready) return json({ id });
    await bucket.put(prefix + '/source', source.stream());
    if (midi instanceof File) await bucket.put(prefix + '/performance', midi.stream());
    await db.prepare('UPDATE saved_scores SET ready=1 WHERE id=? AND user_id=?').bind(id, owner).run();
    return json({ id }, 201);
  }
  const match = /^\/api\/library\/([a-f0-9]{64})\/(source|performance)$/.exec(path);
  if (match && request.method === 'GET') {
    const row = await db.prepare('SELECT filename, has_performance FROM saved_scores WHERE ready=1 AND id=? AND user_id=?')
      .bind(match[1], owner).first<{ filename: string; has_performance: number }>();
    if (row && (match[2] === 'source' || row.has_performance)) {
      const object = await bucket.get(`${owner}/${match[1]}/${match[2]}`);
      if (object) return new Response(object.body, { headers: { ...headers,
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(match[2] === 'source' ? row.filename : 'Pianora.mid'),
      } });
    }
  }
  return json({ error: '未找到作品' }, 404);
}
