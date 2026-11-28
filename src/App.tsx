import { display, t, useLocale, setLocale, type Locale } from './i18n';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import {
  AudioLines,
  BookOpen,
  ChevronRight,
  FileMusic,
  LibraryBig,
  Piano,
  SlidersHorizontal,
  Upload, UserRound,
} from 'lucide-react';
import { Library } from './components/Library';
import { useScoreStore } from './store/useScoreStore';

const AccountLibrary = lazy(() => import('./components/AccountLibrary'));

const Workspace = lazy(() => import('./components/Workspace'));

const pages = {
  profile: { get title() { return t('个人中心'); }, icon:UserRound, get desc() { return ''; } },
  library: {
    get title() { return t("曲谱馆"); },
    icon: LibraryBig,
    get desc() { return t("挑选一份钢琴谱，开始你的演奏。"); },
  },
  editor: {
    get title() { return t("乐谱编辑"); },
    icon: FileMusic,
    get desc() { return t("编写乐谱，设定演奏细节，生成可供试听的版本。"); },
  },
  studio: {
    get title() { return t("演奏室"); },
    icon: SlidersHorizontal,
    get desc() { return t("试听、比较与调整你的钢琴演奏。"); },
  },
};
type Page = keyof typeof pages;
function sharedTake() { return /^#studio\/([0-9a-f]{32})$/.exec(location.hash)?.[1] ?? null; }
function currentPage(): Page {
  if (sharedTake()) return 'studio';
  const hash = location.hash.slice(1);
  const loginPage = new URLSearchParams(location.search).get('pianora-login')?.split('/')[0];
  if (Object.hasOwn(pages,hash)) return hash as Page;
  return loginPage && Object.hasOwn(pages,loginPage) ? loginPage as Page : 'library';
}

export function App() {
  const language = useLocale();
  useEffect(() => {
    document.documentElement.lang = language;
    document.title = t('Pianora 琴境 · 钢琴演奏工作站');
  }, [language]);
  const [accountChecked, setAccountChecked] = useState(false);
  const [publishableKey, setPublishableKey] = useState<string | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    fetch('/api/account/options', { signal: abort.signal }).then(r => r.json()).then(options => setPublishableKey(options.publishableKey ?? null)).catch(() => {}).finally(() => { if (!abort.signal.aborted) setAccountChecked(true); });
    return () => abort.abort();
  }, []);
  const [page, setPage] = useState<Page>(currentPage);
  const [shareId, setShareId] = useState(sharedTake);
  useEffect(() => {
    if (shareId || page === 'profile') return;
    let disposed = false;
    let stop: (() => void) | undefined;
    const timer = window.setTimeout(() => {
      void import('./engine/assetPacks').then(({ warmPerformanceAssets }) => {
        if (!disposed) stop = warmPerformanceAssets();
      }).catch(() => {});
    }, 1000);
    return () => { disposed = true; clearTimeout(timer); stop?.(); };
  }, [shareId, page === 'profile']);
  const upload = useRef<HTMLInputElement>(null);
  const pipelineBusy = useScoreStore((s) => s.pipelineBusy);
  const { selectPreset, importFile } = useScoreStore.getState();
  const fileError = useScoreStore(s => s.error);
  useEffect(() => {
    const navigate = () => {
      setPage(currentPage());
      setShareId(sharedTake());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', navigate);
    return () => window.removeEventListener('hashchange', navigate);
  }, []);
  return (
    <div className="shell">
      <aside className="rail">
        <a className="brand" href="#library">
          <Piano aria-hidden="true" /> Pianora
        </a>
        <nav aria-label={t("工作空间")}>
          {(['library','editor','studio',...(publishableKey ? ['profile'] : [])] as Page[]).map((key) => {
            const Icon = pages[key].icon;
            return (
              <a
                href={'#' + key}
                key={key}
                aria-current={page === key ? 'page' : undefined}
              >
                <Icon size={19} />
                {pages[key].title}
              </a>
            );
          })}
        </nav>
        <div className="rail-foot">
          <AudioLines size={19} />
          <span>{t("本地演奏工作站")}</span>
        </div>
      </aside>
      <div className="workspace">
        <header className="crumb">
          <BookOpen size={16} /> {t("工作空间")} <ChevronRight size={13} />{' '}
          <strong>{pages[page].title}</strong>
          <select className="locale-select" aria-label={t('界面语言')} value={language}
            onChange={event => setLocale(event.target.value as Locale)}>
            <option value="zh-CN" lang="zh-CN">中文</option>
            <option value="en" lang="en">English</option>
          </select>
        </header>
        <main className="content">
          {page === 'library' && (
            <div className="page-title">
              <div>
                <h1>{pages[page].title}</h1>
                <p>{pages[page].desc}</p>
              </div>
              <button
                className="import"
                disabled={pipelineBusy}
                onClick={() => upload.current?.click()}
              >
                <Upload size={16} /> {t("导入乐谱 (.ly / .mid / MusicXML)")}
              </button>
            </div>
          )}
          <input
            type="file"
            hidden
            ref={upload}
            accept=".ly,.txt,.mid,.midi,.musicxml,.xml,.mxl"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              const ok = await importFile(file);
              if (ok) location.hash = 'editor';
            }}
          />
          {page === 'library' && fileError && <p role="alert">{display(fileError)}</p>}
          {page === 'library' && (
            <Library
              openScore={(id) => {
                selectPreset(id);
                location.hash = 'editor';
              }}
            />
          )}
          {page === 'profile' && (publishableKey ? <Suspense fallback={<p role="status">{t("正在打开曲库…")}</p>}>
            <AccountLibrary publishableKey={publishableKey} />
          </Suspense> : <p role="status">{accountChecked ? t("账户服务尚未启用") : t("正在打开曲库…")}</p>)}
          {(page === 'editor' || page === 'studio') && (
            <Suspense fallback={<p role="status">{t("正在打开工作区…")}</p>}>
              <Workspace
                page={page} shareId={shareId} publishableKey={publishableKey}
                title={pages[page].title}
                description={pages[page].desc}
              />
            </Suspense>
          )}
        </main>
      </div>
    </div>
  );
}
