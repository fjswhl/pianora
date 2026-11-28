import { formatMessage } from '../src/i18n/catalog';
import { recordedAudio } from './sharedPerformance';
import { signedInOwner, type AccountEnv } from './auth';

const maxScoreSize = 12 * 1024 * 1024;

export async function accountApi(request: Request, env: AccountEnv): Promise<Response> {
  const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
  const json = (data: unknown, status = 200) => Response.json(data, { status, headers });
  const path = new URL(request.url).pathname;
  const locale = /^en(?:[-,;]|$)/i.test(request.headers.get('accept-language') ?? '') ? 'en' : 'zh-CN';
  const publishableKey = env.DB && env.PRIVATE_SCORES && env.APP_ORIGIN ? env.CLERK_PUBLISHABLE_KEY : undefined;
  if (request.method === 'GET' && path === '/api/account/options') return json({ publishableKey: publishableKey ?? null });
  if (!/^\/api\/library(?:\/|$)/.test(path)) return json({ error: formatMessage(locale, '未找到接口') }, 404);
  if (!publishableKey) return json({ error: formatMessage(locale, '账户服务尚未启用') }, 503);
  if (!['GET','HEAD'].includes(request.method) && request.headers.get('origin') !== env.APP_ORIGIN)
    return json({ error: formatMessage(locale, '请求来源无效') }, 403);
  let owner: string | null;
  try { owner = await signedInOwner(request, env); }
  catch { return json({ error: formatMessage(locale, '请求未完成，请重试。') }, 503); }
  if (!owner) return json({ error: formatMessage(locale, '请先登录') }, 401);
  const db = env.DB!, bucket = env.PRIVATE_SCORES!;
  if (path === '/api/library' && request.method === 'GET') {
    const { results } = await db.prepare(
      'SELECT id, title, filename, has_performance, audio_sha256 IS NOT NULL AS has_audio, take_label, share_id, created_at FROM saved_scores WHERE user_id=? AND ready=1 ORDER BY created_at DESC',
    ).bind(owner).all();
    return json(results);
  }
  if (path === '/api/library' && request.method === 'POST') {
    const length = Number(request.headers.get('content-length'));
    if (!length || length > maxScoreSize) return json({ error: formatMessage(locale, '单次保存上限为 12 MB') }, 413);
    let form: FormData;
    try { form = await request.formData(); } catch { return json({ error: formatMessage(locale, '文件格式无效') }, 400); }
    const source = form.get('source'), midi = form.get('performance'), title = form.get('title');
    const audioHash = form.get('audio_sha256'), label = form.get('take_label');
    if (audioHash !== null && (typeof audioHash !== 'string' || !/^[a-f0-9]{64}$/.test(audioHash) ||
        !(midi instanceof File) || typeof label !== 'string' || label.length > 200)) return json({ error: 'Invalid recording' }, 400);
    if (!(source instanceof File) || !source.size || !/\.(ly|txt|mid|midi|musicxml|xml|mxl)$/i.test(source.name)
      || source.name.length > 255 || typeof title !== 'string' || !title.trim() || title.length > 200
      || (midi !== null && (!(midi instanceof File) || !midi.size)))
      return json({ error: formatMessage(locale, '乐谱文件或名称无效') }, 400);
    // A retry (including two tabs saving the same take) completes the same private entry.
    const digest = async (bytes: BufferSource) =>
      Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('');
    const sourceHash = await digest(await source.arrayBuffer());
    const takeHash = midi instanceof File ? await digest(await midi.arrayBuffer()) : '';
    const identity = [owner, title.trim(), source.name, sourceHash, takeHash];
    if (audioHash) identity.push(audioHash, String(label));
    const id = await digest(new TextEncoder().encode(JSON.stringify(identity)));
    const prefix = `${owner}/${id}`;
    await db.prepare('INSERT OR IGNORE INTO saved_scores (id,user_id,title,filename,has_performance,created_at,audio_sha256,take_label) VALUES (?,?,?,?,?,?,?,?)')
      .bind(id, owner, title.trim(), source.name, midi ? 1 : 0, Date.now(), audioHash, label).run();
    const row = await db.prepare('SELECT ready FROM saved_scores WHERE id=? AND user_id=?').bind(id, owner).first<{ready: number}>();
    if (row?.ready === 1) return json({ id, ready: true });
    if (row?.ready === -1) return json({ id, ready: false });
    await bucket.put(prefix + '/source', source.stream());
    if (midi instanceof File) await bucket.put(prefix + '/performance', midi.stream());
    if (audioHash) {
      // Mark the source and MIDI durable before accepting the recording upload.
      await db.prepare('UPDATE saved_scores SET ready=-1 WHERE id=? AND user_id=? AND ready=0').bind(id, owner).run();
      return json({ id, ready: false }, 201);
    }
    await db.prepare('UPDATE saved_scores SET ready=1 WHERE id=? AND user_id=?').bind(id, owner).run();
    return json({ id }, 201);
  }
  const action = /^\/api\/library\/([a-f0-9]{64})\/(share|audio)$/.exec(path);
  if (action) {
    const id = action[1];
    const row = await db.prepare('SELECT audio_sha256,ready FROM saved_scores WHERE id=? AND user_id=?')
      .bind(id, owner).first<{audio_sha256:string|null;ready:number}>();
    if (!row?.audio_sha256) return json({ error: 'Recording not found' }, 404);
    const key = owner + '/' + id + '/audio';
    if (action[2] === 'audio' && request.method === 'PUT') {
      if (row.ready === 1) return json({ id, ready:true });
      if (row.ready !== -1) return json({error:'Upload the score first'},409);
      const size = Number(request.headers.get('content-length'));
      if (!Number.isSafeInteger(size) || size < 4 || size > 96 * 1024 * 1024 || !request.body) return json({ error:'Invalid audio size' }, 413);
      if (request.headers.get('content-type') !== 'audio/mpeg') return json({error:'Expected MP3'},415);
      // R2 validates the digest while streaming; incomplete uploads never become visible.
      await bucket.put(key, request.body, { sha256: row.audio_sha256, httpMetadata:{contentType:'audio/mpeg'} });
      const prefix = await bucket.get(key, {range:{offset:0,length:4}});
      const bytes = prefix && new Uint8Array(await prefix.arrayBuffer());
      if (!bytes || bytes[0] !== 255 || (bytes[1] & 0xe0) !== 0xe0) {
        await bucket.delete(key);
        return json({error:'Invalid MP3'},400);
      }
      await db.prepare('UPDATE saved_scores SET ready=1 WHERE id=? AND user_id=?').bind(id,owner).run();
      return json({id,ready:true});
    }
    if (row.ready !== 1) return json({error:'Recording not found'},404);
    if (action[2] === 'audio' && ['GET','HEAD'].includes(request.method)) return recordedAudio(request,bucket,key);
    if (action[2] === 'share' && request.method === 'POST') {
      const shared = await db.prepare('UPDATE saved_scores SET share_id=COALESCE(share_id,?) WHERE id=? AND user_id=? RETURNING share_id')
        .bind(crypto.randomUUID().replaceAll('-',''),id,owner).first<{share_id:string}>();
      return json(shared);
    }
    if (action[2] === 'share' && request.method === 'DELETE') {
      await db.prepare('UPDATE saved_scores SET share_id=NULL WHERE id=? AND user_id=?').bind(id,owner).run();
      return json({ share_id:null });
    }
    return json({error:'Method not allowed'},405);
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
  return json({ error: formatMessage(locale, '未找到作品') }, 404);
}
