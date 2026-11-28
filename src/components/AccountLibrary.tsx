import { message, errorText, display, type DisplayText, LocalizedError, t, getLocale } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useScoreStore } from '../store/useScoreStore';

import { ClerkFailed, ClerkProvider, SignIn, useAuth, useClerk, useUser } from '@clerk/react';
import { zhCN } from '@clerk/localizations/zh-CN';
interface Item { id: string; title: string; filename: string; has_performance: number; has_audio: number; take_label: string | null; share_id: string | null }
interface Draft { title: string; source?: File; performance?: Uint8Array<ArrayBuffer>; takeLabel?: string }
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
  if (!take || s.liveActive || s.busy) throw new LocalizedError("请先完成演奏生成。");
  return { title: display(s.performanceTitle), performance: new Uint8Array(s.activeMidi('final_restored')),
    takeLabel: display(take.label) };
}

// A successful authentication stays in this dialog so the open score and take survive sign-in.
const completed = '/?pianora-clerk=complete';
function navigate(to: string) {
  const url = new URL(to, location.href);
  if (url.origin === location.origin && url.pathname === '/' && url.search === '?pianora-clerk=complete') return;
  location.assign(url.href);
}

export default function AccountLibrary({ intent, publishableKey, close }: {
  intent: Intent; publishableKey: string; close: (target?: 'editor' | 'studio') => void;
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

interface LibraryProps { draft: Draft | null; clearDraft: () => void; close: (target?: 'editor' | 'studio') => void }
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
    return () => { mounted.current = false; };
  }, []);
  async function run(work: () => Promise<unknown>) {
    setBusy(true); setError(''); setStatus('');
    try { await work(); } catch (e) { setError(() => errorText(e) || message("操作失败，请重试。")); }
    finally { setBusy(false); }
  }
  async function save(value: Draft) {
    const form = new FormData();
    form.set('title', value.title);
    if (value.source) form.set('source', value.source);
    if (value.performance) {
      form.set('performance', new Blob([value.performance], {type:'audio/midi'}), 'performance.mid');
      form.set('take_label', value.takeLabel ?? '');
      setStatus(() => message("正在保存演奏…"));
    }
    await api(getToken, 'library', form);
    clearDraft(); setStatus(() => message("已保存到我的曲库。"));
    await refresh();
  }
  async function openPerformance(item: Item) {
    const [response, { useStudioStore }] = await Promise.all([
      api(getToken, 'library/'+item.id+'/performance'), import('../store/useStudioStore'),
    ]);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!mounted.current) return;
    useStudioStore.getState().openPerformanceMidi(bytes, item.title, item.take_label);
    close('studio');
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
        {item.filename && <button disabled={busy} onClick={()=>void run(async()=>{
          const file=new File([await (await api(getToken, 'library/'+item.id+'/source')).blob()],item.filename);
          if (!await useScoreStore.getState().importFile(file)) throw new LocalizedError("无法打开这份乐谱。");
          close('editor');
        })}>{t("打开乐谱")}</button>}
        {Boolean(item.has_performance) && <><button disabled={busy} onClick={()=>void run(()=>openPerformance(item))}>{t("打开演奏")}</button><button disabled={busy} onClick={()=>void run(async()=>{
          const blob = await (await api(getToken, 'library/'+item.id+'/performance')).blob();
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a'); link.href=url; link.download='Pianora.mid'; link.click();
          setTimeout(()=>URL.revokeObjectURL(url), 1000);
        })}>{t("下载 MIDI")}</button></>}
      </div>
      {!!item.has_performance && <div className="share-actions">
        {!item.has_audio && <small>{t("公开后，持链接者可在演奏室播放和下载这份 MIDI。")}</small>}
        {item.share_id ? <>
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
