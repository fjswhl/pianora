import { message, errorText, display, type DisplayText, LocalizedError, t, getLocale } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useScoreStore } from '../store/useScoreStore';

import { ClerkFailed, ClerkProvider, SignIn, useAuth, useClerk, useUser } from '@clerk/react';
import { zhCN } from '@clerk/localizations/zh-CN';
interface Item { id: string; title: string; filename: string; has_performance: number; has_audio: number; take_label: string | null; share_id: string | null }
interface Draft { title: string; source: File; performance?: Uint8Array<ArrayBuffer>; takeLabel?: string; recording?: () => Promise<Blob> }
type Intent = 'library' | 'editor' | 'studio';

type GetToken = () => Promise<string | null>;
async function api(getToken: GetToken, path: string, body?: FormData | Blob, method = body ? 'POST' : 'GET') {
  const token = await getToken();
  if (!token) throw new LocalizedError("登录已过期，请重新打开我的曲库并登录。");
  const response = await fetch('/api/' + path, {
    method, body,
    headers: { 'Accept-Language': getLocale(), Authorization: 'Bearer ' + token },
  });
  if (!response.ok) {
    if (response.status === 401) throw new LocalizedError("登录已过期，请重新打开我的曲库并登录。");
    throw new LocalizedError("请求未完成，请重试。");
  }
  return response;
}

async function currentDraft(intent: Intent): Promise<Draft | null> {
  if (intent === 'library') return null;
  if (intent === 'editor') {
    const { originalFile, lyCode, selectedPresetId, loading } = useScoreStore.getState();
    if (loading || (!originalFile && !lyCode.trim())) throw new LocalizedError("请先打开乐谱。");
    const title = originalFile?.name.replace(/\.[^.]+$/, '') || lyCode.match(/^\s*title\s*=\s*"([^"\n]+)"/m)?.[1] || selectedPresetId;
    return { title, source: originalFile ?? new File([lyCode], selectedPresetId + '.ly') };
  }
  const { useStudioStore } = await import('../store/useStudioStore');
  const s = useStudioStore.getState();
  const take = s.takes.find(item => item.id === s.activeTakeId);
  if (!take || !s.performanceSource || s.liveActive || s.busy) throw new LocalizedError("请先完成演奏生成。");
  let encoded: Blob | undefined;
  return { title: display(s.performanceTitle), source: s.performanceSource,
    performance: new Uint8Array(s.activeMidi('final_restored')), takeLabel: display(take.label),
    recording: async () => {
      if (encoded) return encoded;
      const [{ pianoPlayer }, { encodeRecording }] = await Promise.all([import('../engine/instances'), import('../engine/encodeRecording')]);
      if (!pianoPlayer.ready || pianoPlayer.activePresetId !== s.activeTimbreId) await pianoPlayer.loadPreset(s.activeTimbreId);
      const audio = await pianoPlayer.renderOfflineAudio(take.restoredNotes, take.restoredDuration, s.reverbWet, s.resonanceAmount, s.activeHallId);
      encoded = await encodeRecording(audio);
      return encoded;
    } };
}

async function previewMidi(getToken: GetToken, id: string) {
  const [{ Midi }, { pianoPlayer }, { useStudioStore }] = await Promise.all([
    import('@tonejs/midi'), import('../engine/instances'), import('../store/useStudioStore'),
  ]);
  const midi = new Midi(await (await api(getToken, 'library/' + id + '/performance')).arrayBuffer());
  const notes = midi.tracks.flatMap(t => t.notes.map(n => ({ p: n.midi, s: n.time, d: n.duration,
    v: Math.round(n.velocity * 127) }))).sort((a,b) => a.s - b.s);
  const studio = useStudioStore.getState();
  if (studio.liveActive || studio.busy) throw new LocalizedError("请在当前演奏生成结束后试听。");
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

// A successful authentication stays in this dialog so the open score and take survive sign-in.
const completed = '/?pianora-clerk=complete';
function navigate(to: string) {
  const url = new URL(to, location.href);
  if (url.origin === location.origin && url.pathname === '/' && url.search === '?pianora-clerk=complete') return;
  location.assign(url.href);
}

export default function AccountLibrary({ intent, publishableKey, close }: {
  intent: Intent; publishableKey: string; close: (target?: 'editor') => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<DisplayText>('');
  useEffect(() => {
    let active = true;
    dialog.current?.showModal();
    currentDraft(intent).then(value => { if (active) setDraft(value); })
      .catch(e => { if (active) setError(() => errorText(e)); })
      .finally(() => { if (active) setReady(true); });
    return () => { active = false; };
  }, [intent]);
  return <dialog className="account-dialog" ref={dialog} aria-labelledby="account-title" onCancel={()=>close()}>
    <header><h2 id="account-title">{t("我的曲库")}</h2>
      <button aria-label={t("关闭")} onClick={()=>close()}><X size={19}/></button></header>
    {error && <p role="alert">{display(error)}</p>}
    <ClerkProvider publishableKey={publishableKey} localization={getLocale() === 'zh-CN' ? zhCN : undefined}
      routerPush={navigate} routerReplace={navigate} signInForceRedirectUrl={completed} signUpForceRedirectUrl={completed}>
      <ClerkFailed><p role="alert">{t("请求未完成，请重试。")}</p></ClerkFailed>
      {ready && <SessionLibrary draft={draft} clearDraft={() => setDraft(null)} close={close}/>}
    </ClerkProvider>
  </dialog>;
}

interface LibraryProps { draft: Draft | null; clearDraft: () => void; close: (target?: 'editor') => void }
function SessionLibrary(props: LibraryProps) {
  const { isLoaded, userId } = useAuth();
  const needsSave = useRef(false);
  useEffect(() => {
    if (isLoaded && !userId) needsSave.current = !!props.draft;
  }, [isLoaded, userId, props.draft]);
  if (!isLoaded) return <p role="status">{t("正在打开曲库…")}</p>;
  if (!userId) return <>
    {props.draft && <p>{t("登录后将保存《{0}》。", props.draft.title)}</p>}
    <SignIn routing="hash" withSignUp oauthFlow="popup" />
  </>;
  return <PrivateLibrary key={userId} {...props} autoSave={needsSave.current}/>;
}

function PrivateLibrary({ draft, clearDraft, close, autoSave }: LibraryProps & { autoSave: boolean }) {
  const { getToken } = useAuth();
  const { signOut } = useClerk();
  const { user } = useUser();
  const mounted = useRef(false);
  const initialized = useRef(false);
  const stop = useRef<(() => void) | null>(null);
  const [playing, setPlaying] = useState('');
  const [recordingUrl, setRecordingUrl] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(true);
  const [status, setStatus] = useState<DisplayText>('');
  const [error, setError] = useState<DisplayText>('');
  const refresh = async () => setItems(await (await api(getToken, 'library')).json());
  useEffect(() => {
    mounted.current = true;
    if (!initialized.current) {
      initialized.current = true;
      void run(() => autoSave && draft ? save(draft) : refresh());
    }
    return () => { mounted.current = false; stop.current?.(); };
  }, []);
  async function run(work: () => Promise<unknown>) {
    setBusy(true); setError(''); setStatus('');
    try { await work(); } catch (e) { setError(() => errorText(e) || message("操作失败，请重试。")); }
    finally { setBusy(false); }
  }
  async function save(value: Draft) {
    const form = new FormData();
    form.set('title', value.title); form.set('source', value.source);
    if (value.performance) form.set('performance', new Blob([value.performance]), 'performance.mid');
    let recording: Blob | undefined;
    if (value.recording) {
      setStatus(() => message("正在渲染最终演奏…"));
      recording = await value.recording();
      const digest = await crypto.subtle.digest('SHA-256', await recording.arrayBuffer());
      form.set('audio_sha256', Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2,'0')).join(''));
      form.set('take_label', value.takeLabel ?? '');
      setStatus(() => message("正在保存演奏…"));
    }
    const saved = await (await api(getToken, 'library', form)).json();
    if (recording && !saved.ready) await api(getToken,'library/'+saved.id+'/audio',recording,'PUT');
    clearDraft(); setStatus(() => message("已保存到我的曲库。"));
    await refresh();
  }
  async function listen(item: Item) {
    stop.current?.(); stop.current = null;
    setRecordingUrl(''); setPlaying('');
    if (playing === item.id) return;
    if (item.has_audio) {
      const blob = await (await api(getToken, 'library/'+item.id+'/audio')).blob();
      if (!mounted.current) return;
      const studio = (await import('../store/useStudioStore')).useStudioStore.getState();
      if (!mounted.current) return;
      if (studio.busy || studio.liveActive) throw new LocalizedError("请在当前演奏生成结束后试听。");
      if (studio.isPlaying) studio.stopPlayback();
      const url = URL.createObjectURL(blob);
      stop.current = () => URL.revokeObjectURL(url);
      setRecordingUrl(url); setPlaying(item.id);
      return;
    }
    const player = await previewMidi(getToken, item.id);
    if (!mounted.current) { player.restore(); return; }
    stop.current = player.restore;
    setPlaying(item.id);
    const finish = () => { player.restore(); stop.current = null; setPlaying(''); };
    try { await player.play(finish); } catch (e) { finish(); throw e; }
  }
  async function share(item: Item, method: 'POST' | 'DELETE') {
    const {share_id} = await (await api(getToken, 'library/'+item.id+'/share', undefined, method)).json();
    setItems(rows => rows.map(row => row.id === item.id ? {...row, share_id} : row));
    setStatus(() => message(share_id ? "有链接的人都可以试听这版演奏。" : "已取消公开分享。"));
  }
  return <>
      <div className="account-identity"><span>{user?.primaryEmailAddress?.emailAddress}</span>
        <button disabled={busy} onClick={()=>void run(async()=>{
          await signOut({ redirectUrl: completed }); close();
        })}>{t("退出登录")}</button></div>
      {draft && <button className="account-primary" disabled={busy} onClick={()=>void run(()=>save(draft))}>{t("保存《{0}》", draft.title)}</button>}
      {!items.length && !busy && <p>{t("曲库里还没有作品。在编辑页或演奏室点击「保存到曲库」即可添加。")}</p>}
      <ul>{items.map(item=><li key={item.id}><strong>{item.title}</strong>{item.take_label && <small className="take-label">{item.take_label}</small>}<div>
        <button disabled={busy} onClick={()=>void run(async()=>{
          const file=new File([await (await api(getToken, 'library/'+item.id+'/source')).blob()],item.filename);
          if (!await useScoreStore.getState().importFile(file)) throw new LocalizedError("无法打开这份乐谱。");
          close('editor');
        })}>{t("打开乐谱")}</button>
        {Boolean(item.has_performance) && <><button disabled={busy} onClick={()=>void run(()=>listen(item))}>{playing===item.id?t("停止试听"):t("试听演奏")}</button><button disabled={busy} onClick={()=>void run(async()=>{
          const blob = await (await api(getToken, 'library/'+item.id+'/performance')).blob();
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a'); link.href=url; link.download='Pianora.mid'; link.click();
          setTimeout(()=>URL.revokeObjectURL(url), 1000);
        })}>{t("下载 MIDI")}</button></>}
      </div>
      {playing === item.id && recordingUrl && <audio className="library-audio" controls autoPlay src={recordingUrl} aria-label={item.title}/>}
      {!!item.has_audio && <div className="share-actions">{item.share_id ? <>
        <a href={'/p/'+item.share_id} target="_blank" rel="noreferrer">{t("打开分享页")}</a>
        <button disabled={busy} onClick={()=>void run(async()=>{
          const url = location.origin+'/p/'+item.share_id;
          await navigator.clipboard.writeText(url); setStatus(() => message("已复制分享链接。"));
        })}>{t("复制链接")}</button>
        <button disabled={busy} onClick={()=>void run(()=>share(item,'DELETE'))}>{t("取消公开分享")}</button>
      </> : <button disabled={busy} onClick={()=>void run(()=>share(item,'POST'))}>{t("公开分享演奏")}</button>}</div>}
      </li>)}</ul>
    {status && <p role="status">{display(status)}</p>}{error && <p role="alert">{display(error)}</p>}
  </>;
}
