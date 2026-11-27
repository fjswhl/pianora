import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useScoreStore } from '../store/useScoreStore';

export interface Providers { email: boolean; google: boolean }
interface Item { id: string; title: string; filename: string; has_performance: number }
interface Draft { title: string; source: File; performance?: Uint8Array<ArrayBuffer> }
type Intent = 'library' | 'editor' | 'studio';

async function api(path: string, body?: object | FormData) {
  const form = body instanceof FormData;
  const response = await fetch('/api/' + path, body ? {
    method: 'POST', headers: form ? undefined : { 'Content-Type': 'application/json' },
    body: form ? body : JSON.stringify(body),
  } : undefined);
  if (!response.ok) {
    if (response.status === 429) throw new Error('请求次数过多，请稍后再试。');
    if (response.status === 401 && path.startsWith('library')) throw new Error('登录已过期，请重新打开我的曲库并登录。');
    if (path === 'auth/sign-in/email-otp') throw new Error('验证码无效或已过期，请检查后重试。');
    throw new Error(path.includes('send-verification') ? '验证码发送失败，请稍后重试。' : '请求未完成，请重试。');
  }
  return response;
}

async function currentDraft(intent: Intent): Promise<Draft | null> {
  if (intent === 'library') return null;
  if (intent === 'editor') {
    const { originalFile, lyCode, selectedPresetId, loading } = useScoreStore.getState();
    if (loading || (!originalFile && !lyCode.trim())) throw new Error('请先打开乐谱。');
    const title = originalFile?.name.replace(/\.[^.]+$/, '') || lyCode.match(/^\s*title\s*=\s*"([^"\n]+)"/m)?.[1] || selectedPresetId;
    return { title, source: originalFile ?? new File([lyCode], selectedPresetId + '.ly') };
  }
  const { useStudioStore } = await import('../store/useStudioStore');
  const { notesToMidiBytes } = await import('../engine/pianoflow');
  const s = useStudioStore.getState();
  if (!s.performanceSource || s.liveActive || s.busy) throw new Error('请先完成演奏生成。');
  return { title: s.performanceTitle, source: s.performanceSource,
    performance: new Uint8Array(notesToMidiBytes(s.getActiveTrackData().notes, s.activeTrack)) };
}

async function preview(id: string) {
  const [{ Midi }, { pianoPlayer }, { useStudioStore }] = await Promise.all([
    import('@tonejs/midi'), import('../engine/instances'), import('../store/useStudioStore'),
  ]);
  const midi = new Midi(await (await api('library/' + id + '/performance')).arrayBuffer());
  const notes = midi.tracks.flatMap(t => t.notes.map(n => ({ p: n.midi, s: n.time, d: n.duration,
    v: Math.round(n.velocity * 127) }))).sort((a,b) => a.s - b.s);
  const studio = useStudioStore.getState();
  if (studio.liveActive || studio.busy) throw new Error('请在当前演奏生成结束后试听。');
  if (!pianoPlayer.ready) await pianoPlayer.loadPreset(studio.activeTimbreId);
  const previousTime = pianoPlayer.getCurrentTime();
  studio.stopPlayback();
  const restore = () => {
    pianoPlayer.stop(true);
    const tr = studio.getActiveTrackData();
    pianoPlayer.setTrack(tr.notes, tr.duration);
    pianoPlayer.seek(previousTime);
  };
  pianoPlayer.setTrack(notes, midi.duration);
  return { play: (end: () => void) => pianoPlayer.play(0, end), restore };
}

export default function AccountLibrary({ intent, providers, close }: {
  intent: Intent; providers: Providers; close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const mounted = useRef(false);
  const stop = useRef<(() => void) | null>(null);
  const [playing, setPlaying] = useState('');
  const [user, setUser] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(true);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const refresh = async () => setItems(await (await api('library')).json());
  async function checkSession() {
    const s = await (await api('auth/get-session')).json();
    setUser(s?.user?.email ?? '');
    if (s?.user) await refresh();
    return !!s?.user;
  }
  useEffect(() => {
    mounted.current = true;
    dialog.current?.showModal();
    Promise.all([currentDraft(intent).then(setDraft), checkSession()])
      .catch(e => setError(e.message)).finally(() => setBusy(false));
    return () => { mounted.current = false; stop.current?.(); };
  }, [intent]);
  async function run(work: () => Promise<unknown>) {
    setBusy(true); setError(''); setStatus('');
    try { await work(); } catch (e) { setError(e instanceof Error ? e.message : '操作失败，请重试。'); }
    finally { setBusy(false); }
  }
  async function send() {
    await api('auth/email-otp/send-verification-otp', { email, type: 'sign-in' });
    setSent(true); setStatus('验证码已发送，5 分钟内有效。');
  }
  async function save(value: Draft) {
    const form = new FormData();
    form.set('title', value.title); form.set('source', value.source);
    if (value.performance) form.set('performance', new Blob([value.performance]), 'performance.mid');
    await api('library', form);
    setDraft(null); setStatus('已保存到我的曲库。');
    await refresh();
  }
  async function afterSignIn() {
    if (await checkSession() && draft) await save(draft);
  }
  async function google() {
    const popup = window.open('about:blank', '_blank', 'width=480,height=650');
    if (!popup) throw new Error('请允许打开 Google 登录窗口。');
    popup.opener = null;
    try {
      const res = await (await api('auth/sign-in/social', { provider: 'google',
        callbackURL: location.origin + '/?account=complete', disableRedirect: true })).json();
      popup.location.replace(res.url);
      while (!popup.closed && mounted.current) await new Promise(r => setTimeout(r, 500));
      if (mounted.current) await afterSignIn();
    } finally { popup.close(); }
  }
  return <dialog className="account-dialog" ref={dialog} aria-labelledby="account-title" onCancel={close}>
    <header><h2 id="account-title">{user ? '我的曲库' : draft ? '登录并保存' : '登录 Pianora'}</h2>
      <button aria-label="关闭" onClick={close}><X size={19}/></button></header>
    {!user ? <>
      {draft && <p>登录后将保存《{draft.title}》。</p>}
      {providers.email && <form onSubmit={e => { e.preventDefault(); void run(async () => {
        if (!sent) return send();
        await api('auth/sign-in/email-otp', { email, otp: code }); await afterSignIn();
      }); }}>
        <label>邮箱<input required type="email" autoComplete="email" value={email} disabled={busy || sent} onChange={e=>setEmail(e.target.value)}/></label>
        {sent && <label>验证码<input required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={e=>setCode(e.target.value)}/></label>}
        <button className="account-primary" disabled={busy}>{sent ? '验证并登录' : '发送验证码'}</button>
        {sent && <div><button type="button" disabled={busy} onClick={()=>void run(send)}>重新发送</button>
          <button type="button" disabled={busy} onClick={()=>{setSent(false);setCode('');setStatus('');}}>更换邮箱</button></div>}
      </form>}
      {providers.google && <button disabled={busy} onClick={()=>void run(google)}>使用 Google 登录</button>}
    </> : <>
      <div className="account-identity"><span>{user}</span><button disabled={busy} onClick={()=>void run(async()=>{
        await api('auth/sign-out', {}); stop.current?.(); close();
      })}>退出登录</button></div>
      {draft && <button className="account-primary" disabled={busy} onClick={()=>void run(()=>save(draft))}>保存《{draft.title}》</button>}
      {!items.length && !busy && <p>曲库里还没有作品。在编辑页或演奏室点击「保存到曲库」即可添加。</p>}
      <ul>{items.map(item=><li key={item.id}><strong>{item.title}</strong><div>
        <button disabled={busy} onClick={()=>void run(async()=>{
          const file=new File([await (await api('library/'+item.id+'/source')).blob()],item.filename);
          if (!await useScoreStore.getState().importFile(file)) throw new Error('无法打开这份乐谱。');
          close(); location.hash='editor';
        })}>打开乐谱</button>
        {Boolean(item.has_performance) && <><button disabled={busy} onClick={()=>void run(async()=>{
          stop.current?.(); stop.current=null;
          if (playing===item.id) {setPlaying('');return;}
          setPlaying('');
          const player=await preview(item.id);
          if (!mounted.current) {player.restore();return;}
          stop.current=player.restore;setPlaying(item.id);
          await player.play(()=>{player.restore();stop.current=null;setPlaying('');});
        })}>{playing===item.id?'停止试听':'试听演奏'}</button><a href={'/api/library/'+item.id+'/performance'} download>下载 MIDI</a></>}
      </div></li>)}</ul>
    </>}
    {status && <p role="status">{status}</p>}{error && <p role="alert">{error}</p>}
  </dialog>;
}
