import { message, errorText, display, type DisplayText, LocalizedError, t, getLocale } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, BookOpen, Disc3, Download, FileMusic, LibraryBig, Link2, LockKeyhole, LogOut, MoreHorizontal, Unlink, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { captureNotation, packNotation, unpackNotation, notationFromSource } from '../engine/savedNotation';
import { useScoreStore } from '../store/useScoreStore';

import { ClerkFailed, ClerkProvider, SignIn, useAuth, useClerk, useUser } from '@clerk/react';
import { zhCN } from '@clerk/localizations/zh-CN';
interface Item { created_at: number; id: string; title: string; filename: string; has_performance: number; has_audio: number; take_label: string | null; share_id: string | null }
interface Draft { title: string; source?: File; notation?: Blob; performance?: Uint8Array<ArrayBuffer>; takeLabel?: string }
type Intent = 'editor' | 'studio';

type GetToken = () => Promise<string | null>;
async function api(getToken: GetToken, path: string, body?: FormData | Blob, method = body ? 'POST' : 'GET', optional = false) {
  const token = await getToken();
  if (!token) throw new LocalizedError("登录已过期，请重新打开我的曲库并登录。");
  const response = await fetch('/api/' + path, {
    method, body,
    headers: { 'Accept-Language': getLocale(), Authorization: 'Bearer ' + token },
  });
  if (optional && response.status === 404) return response;
  if (!response.ok) {
    if (response.status === 401) throw new LocalizedError("登录已过期，请重新打开我的曲库并登录。");
    throw new LocalizedError("请求未完成，请重试。");
  }
  return response;
}

async function currentDraft(intent: Intent): Promise<Draft> {
  if (intent === 'editor') {
    const { originalFile, lyCode, selectedPresetId, loading } = useScoreStore.getState();
    if (loading || (!originalFile && !lyCode.trim())) throw new LocalizedError("请先打开乐谱。");
    const title = originalFile?.name.replace(/\.[^.]+$/, '') || lyCode.match(/^\s*title\s*=\s*"([^"\n]+)"/m)?.[1] || selectedPresetId;
    return { title, source: originalFile ?? new File([lyCode], selectedPresetId + '.ly') };
  }
  const { useStudioStore } = await import('../store/useStudioStore');
  const s = useStudioStore.getState();
  const take = s.takes.find(item => item.id === s.activeTakeId);
  if (!take || s.liveActive || s.busy) throw new LocalizedError("请先完成演奏生成。");
  const performance = new Uint8Array(s.activeMidi('final_restored'));
  const notation = s.savedNotation ?? (s.performanceSource && s.loadSheetPages && s.scoreMidi
    ? await captureNotation(s.loadSheetPages, s.scoreMidi, take.restoredNotes, s.writtenChords, s.totalBars, !!s.midiNotation)
    : null);
  return { title: display(s.performanceTitle), performance, notation: notation ? await packNotation(notation) : undefined,
    takeLabel: display(take.label) };
}

// Keep Clerk's completion redirect inside the workspace so authentication preserves the selected take.
const completed = '/?pianora-clerk=complete';
function navigate(to: string) {
  const url = new URL(to, location.href);
  if (url.origin === location.origin && url.pathname === '/' && url.search === '?pianora-clerk=complete') return;
  location.assign(url.href);
}

function AccountProvider({publishableKey, children, recovery}: {publishableKey:string; children:ReactNode; recovery?:ReactNode}) {
  const base = getLocale() === 'zh-CN' ? zhCN : undefined;
  const localization = {
    ...base,
    signIn:{...base?.signIn, start:{...base?.signIn?.start, title:t("登录 Pianora"),titleCombined:t("登录 Pianora")}},
    signUp:{...base?.signUp, start:{...base?.signUp?.start, subtitle:'Pianora',subtitleCombined:'Pianora'}},
  };
  return <ClerkProvider publishableKey={publishableKey} localization={localization}
    routerPush={navigate} routerReplace={navigate} signInForceRedirectUrl={completed} signUpForceRedirectUrl={completed}>
    <ClerkFailed><p role="alert">{t("请求未完成，请重试。")} {recovery}</p></ClerkFailed>
    {children}
  </ClerkProvider>;
}

function Login() {
  const [ready,setReady] = useState(false);
  useEffect(() => {
    const current = new URL(location.href);
    const page = current.searchParams.get('pianora-login') || current.hash.slice(1) || 'profile';
    if (!current.searchParams.has('pianora-login')) {
      current.searchParams.set('pianora-login',page);
      current.hash = '';
      history.replaceState(history.state,'',current.href);
    }
    setReady(true);
    return () => {
      const next = new URL(location.href);
      if (!next.searchParams.has('pianora-login')) return;
      next.searchParams.delete('pianora-login');
      if (!/^#(library|editor|studio|profile)(\/|$)/.test(next.hash)) next.hash = page;
      history.replaceState(history.state,'',next.href);
    };
  }, []);
  if (!ready) return null;
  return <SignIn routing="hash" withSignUp oauthFlow="popup" appearance={{
    variables:{colorPrimary:'#28513d', borderRadius:'8px'},
    elements:{rootBox:{maxWidth:'100%'}, cardBox:{maxWidth:'100%',boxShadow:'none',border:'1px solid #d8dcd1'}},
  }}/>;
}

function LoginDialog({close, title}: {close:()=>void; title:string}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog className="save-login" ref={ref} aria-label={title} onCancel={close}>
    <header><strong>{title}</strong><button aria-label={t("关闭")} onClick={close}><X size={18}/></button></header>
    <Login/>
  </dialog>;
}

type SaveProps = {intent:Intent; finish:(saved:boolean, error?:DisplayText)=>void};
export function SaveRequest({publishableKey,...props}: SaveProps & {publishableKey:string}) {
  return <AccountProvider publishableKey={publishableKey} recovery={<button onClick={()=>props.finish(false)}>{t("关闭")}</button>}><SaveDraft {...props}/></AccountProvider>;
}

function SaveDraft({intent,finish}:SaveProps) {
  const {getToken,isLoaded,userId} = useAuth();
  const [draft,setDraft] = useState<Draft | null>(null);
  const callback = useRef(finish);
  callback.current = finish;
  useEffect(() => {
    let active = true;
    currentDraft(intent).then(value => { if (active) setDraft(value); })
      .catch(err => { if (active) callback.current(false,errorText(err)); });
    return () => { active=false; };
  }, [intent]);
  const submitted = useRef<Promise<Response> | null>(null);
  useEffect(() => {
    if (!draft || !isLoaded || !userId) return;
    let active = true;
    const form = new FormData();
    form.set('title',draft.title);
    if (draft.source) form.set('source',draft.source);
    if (draft.notation) form.set('notation',draft.notation,'notation.gz');
    if (draft.performance) {
      form.set('performance',new Blob([draft.performance],{type:'audio/midi'}),'performance.mid');
      form.set('take_label',draft.takeLabel ?? '');
    }
    submitted.current ??= api(getToken,'library',form);
    submitted.current.then(() => { if (active) callback.current(true); })
      .catch(err => { if (active) callback.current(false,errorText(err)); });
    return () => { active=false; };
  }, [draft,isLoaded,userId,getToken]);
  return isLoaded && !userId && draft ? <LoginDialog title={t("登录后将保存《{0}》。",draft.title)} close={()=>finish(false)}/> : null;
}

function RecordArt() {
  return <div className="profile-art" aria-hidden="true"><div className="vinyl"/><div className="record-sleeve"><i/><i/><i/></div></div>;
}

export default function AccountLibrary({publishableKey}:{publishableKey:string}) {
  return <AccountProvider publishableKey={publishableKey}><Profile/></AccountProvider>;
}

function Profile() {
  const {isLoaded,userId} = useAuth();
  if (!isLoaded) return <p role="status">{t("正在打开曲库…")}</p>;
  if (userId) return <PrivateLibrary key={userId}/>;
  return <section className="profile-page profile-guest">
    <div className="guest-cover"><LibraryBig size={28}/><h1>{t("个人中心")}</h1>
      <p>{t("登录后，在这里打开保存的乐谱和演奏，管理分享链接。")}</p><RecordArt/></div>
    <div className="profile-signin"><Login/></div>
  </section>;
}

function PrivateLibrary() {
  const { getToken } = useAuth();
  const { signOut } = useClerk();
  const { user } = useUser();
  const mounted = useRef(false);
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(true);
  const [filter, setFilter] = useState<'all'|'scores'|'takes'|'shared'>('all');
  const [status, setStatus] = useState<DisplayText>('');
  const [error, setError] = useState<DisplayText>('');
  const refresh = async () => setItems(await (await api(getToken, 'library')).json());
  useEffect(() => {
    mounted.current = true;
    void run(refresh);
    return () => { mounted.current = false; };
  }, []);
  async function run(work: () => Promise<unknown>) {
    setBusy(true); setError(''); setStatus('');
    try { await work(); } catch (e) { setError(() => errorText(e) || message("操作失败，请重试。")); }
    finally { setBusy(false); }
  }
  async function openPerformance(item: Item) {
    const path = 'library/'+item.id;
    const [response, sheet, { useStudioStore }] = await Promise.all([
      api(getToken, path+'/performance'), api(getToken,path+'/notation',undefined,'GET',true), import('../store/useStudioStore'),
    ]);
    const bytes = new Uint8Array(await response.arrayBuffer());
    let notation = sheet.ok ? await unpackNotation(sheet) : undefined;
    if (!notation) {
      const { recoverNotation } = await import('../store/generationHistory');
      notation = await recoverNotation(bytes,item.title).catch(() => undefined);
      if (!notation && item.filename) {
        const { Midi } = await import('@tonejs/midi');
        const source = await api(getToken,path+'/source',undefined,'GET',true);
        if (source.ok) notation = await notationFromSource(new File([await source.blob()],item.filename),new Midi(bytes)).catch(() => undefined);
      }
      if (notation && !item.has_audio) {
        // Preserve the existing item and its public link when recovering an older take.
        void packNotation(notation).then(blob => api(getToken,path+'/notation',blob,'PUT')).catch(() => {});
      }
    }
    if (!mounted.current) return;
    useStudioStore.getState().openPerformanceMidi(bytes, item.title, item.take_label, notation);
    location.hash='studio';
  }
  async function share(item: Item, method: 'POST' | 'DELETE') {
    const {share_id} = await (await api(getToken, 'library/'+item.id+'/share', undefined, method)).json();
    setItems(rows => rows.map(row => row.id === item.id ? {...row, share_id} : row));
    setStatus(() => message(share_id ? "有链接的人都可以试听这版演奏。" : "已取消公开分享。"));
  }
  async function openScore(item:Item) {
    const file = new File([await (await api(getToken,'library/'+item.id+'/source')).blob()],item.filename);
    if (!mounted.current) return;
    if (!await useScoreStore.getState().importFile(file)) throw new LocalizedError("无法打开这份乐谱。");
    if (mounted.current) location.hash='editor';
  }
  async function download(item:Item) {
    const blob = await (await api(getToken,'library/'+item.id+'/performance')).blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href=url; link.download=item.title+'.mid'; link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  const filters = [
    {key:'all',label:t("全部作品"),rows:items},
    {key:'scores',label:t("乐谱"),rows:items.filter(item=>item.filename)},
    {key:'takes',label:t("演奏"),rows:items.filter(item=>item.has_performance)},
    {key:'shared',label:t("已分享"),rows:items.filter(item=>item.share_id)},
  ] as const;
  const visible = filters.find(f=>f.key===filter)!.rows;
  const date = new Intl.DateTimeFormat(getLocale(),{year:'numeric',month:'short',day:'numeric'});
  const name = user?.fullName || user?.username || t("个人中心");
  const initial = Array.from(user?.fullName || user?.username || user?.primaryEmailAddress?.emailAddress || 'P')[0];
  return <section className="profile-page">
    <header className="profile-cover"><div className="profile-identity">
      <div className="profile-monogram" aria-hidden="true">{initial.toUpperCase()}</div>
      <h1>{name}</h1><p title={user?.primaryEmailAddress?.emailAddress}>{user?.primaryEmailAddress?.emailAddress}</p>
      <button className="profile-signout" disabled={busy} onClick={()=>void run(()=>signOut({redirectUrl:'/#profile'}))}><LogOut size={15}/>{t("退出登录")}</button>
    </div><RecordArt/></header>
    <section className="profile-collection" aria-labelledby="collection-title">
      <header><h2 id="collection-title">{t("我的曲库")}</h2></header>
      <div className="collection-filters">{filters.map(f=><button key={f.key} aria-pressed={filter===f.key}
        aria-label={f.key==='takes'?t("仅看演奏"):f.label} onClick={()=>setFilter(f.key)}>{f.label}<span>{f.rows.length}</span></button>)}</div>
      {status && <p className="profile-message" role="status">{display(status)}</p>}
      {error && <p className="profile-message" role="alert">{display(error)} <button onClick={()=>void run(refresh)}>{t("重试")}</button></p>}
      {busy && !items.length && <p role="status">{t("正在打开曲库…")}</p>}
      {!busy && !error && !visible.length && <div className="collection-empty"><LibraryBig size={30}/>
        <h3>{items.length ? t("暂无此类作品") : t("曲库里还没有作品")}</h3>
        {!items.length && <a href="#editor">{t("前往乐谱编辑")} <ArrowUpRight size={16}/></a>}</div>}
      <ul className="collection-list">{visible.map(item=>{
        const performance=Boolean(item.has_performance);
        return <li key={item.id}><div className="work-main">
          <div aria-hidden="true" className={'work-cover '+(performance?'disc-cover':'score-cover')}>{performance?<Disc3/>:<FileMusic/>}</div>
          <div className="work-info"><div className="work-meta">{performance?t("演奏"):t("乐谱")}<span>·</span><time dateTime={new Date(item.created_at).toISOString()}>{date.format(item.created_at)}</time></div>
            <h3>{item.title}</h3><small>{item.take_label || item.filename}</small></div>
          <span className="work-visibility">{item.share_id?<Link2 size={14}/>:<LockKeyhole size={14}/>}
            {item.share_id?t("已分享"):t("仅自己可见")}</span>
          <button className="work-open" disabled={busy} onClick={()=>void run(()=>performance?openPerformance(item):openScore(item))}>
            {performance?t("打开演奏"):t("打开乐谱")}<ArrowUpRight size={15}/></button>
        </div>
        {performance && <details className="work-options"><summary><MoreHorizontal size={17}/>{t("作品操作")}</summary><div>
          {item.filename && <button disabled={busy} onClick={()=>void run(()=>openScore(item))}><BookOpen size={15}/>{t("打开乐谱")}</button>}
          <button disabled={busy} onClick={()=>void run(()=>download(item))}><Download size={15}/>{t("下载 MIDI")}</button>
          {item.share_id ? <>
            <a href={'/p/'+item.share_id} target="_blank" rel="noreferrer">{t("打开分享页")}<ArrowUpRight size={15}/></a>
            <button disabled={busy} onClick={()=>void run(async()=>{await navigator.clipboard.writeText(location.origin+'/p/'+item.share_id); setStatus(() => message("已复制分享链接。"));})}><Link2 size={15}/>{t("复制链接")}</button>
            <button disabled={busy} onClick={()=>void run(()=>share(item,'DELETE'))}><Unlink size={15}/>{t("取消公开分享")}</button>
          </> : <button disabled={busy} onClick={()=>void run(()=>share(item,'POST'))}><Link2 size={15}/>{t("公开分享演奏")}</button>}
          {!item.has_audio && <small>{t("公开后，持链接者可试听、下载 MIDI，并查看已保存的谱面。")}</small>}
        </div></details>}</li>;
      })}</ul>
    </section>
  </section>;
}
