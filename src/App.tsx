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
  Upload,
} from 'lucide-react';
import { Library } from './components/Library';
import { useScoreStore } from './store/useScoreStore';

const AccountLibrary = lazy(() => import('./components/AccountLibrary'));

const Workspace = lazy(() => import('./components/Workspace'));

const pages = {
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
function currentPage(): Page {
  const hash = location.hash.slice(1);
  return Object.hasOwn(pages, hash) ? (hash as Page) : 'library';
}

export function App() {
  const language = useLocale();
  useEffect(() => {
    document.documentElement.lang = language;
    document.title = t('Pianora 琴境 · 钢琴演奏工作站');
  }, [language]);
  const [publishableKey, setPublishableKey] = useState<string | null>(null);
  const [account, setAccount] = useState<'library' | 'editor' | 'studio' | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    fetch('/api/account/options', { signal: abort.signal }).then(r => r.json()).then(options => setPublishableKey(options.publishableKey ?? null)).catch(() => {});
    return () => abort.abort();
  }, []);
  const [page, setPage] = useState<Page>(currentPage);
  function openAccount(intent: 'library' | 'editor' | 'studio') {
    // Clerk uses the fragment for the steps inside its sign-in component.
    history.replaceState(history.state, '', location.pathname + location.search);
    setAccount(intent);
  }
  function closeAccount(target: Page = page) {
    history.replaceState(history.state, '', '#' + target);
    setPage(target);
    setAccount(null);
  }
  useEffect(() => {
    let disposed = false;
    let stop: (() => void) | undefined;
    const timer = window.setTimeout(() => {
      void import('./engine/assetPacks').then(({ warmPerformanceAssets }) => {
        if (!disposed) stop = warmPerformanceAssets();
      }).catch(() => {});
    }, 1000);
    return () => { disposed = true; clearTimeout(timer); stop?.(); };
  }, []);
  const upload = useRef<HTMLInputElement>(null);
  const pipelineBusy = useScoreStore((s) => s.pipelineBusy);
  const { selectPreset, importFile } = useScoreStore.getState();
  const fileError = useScoreStore(s => s.error);
  useEffect(() => {
    const navigate = () => {
      if (account) return;
      setPage(currentPage());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', navigate);
    return () => window.removeEventListener('hashchange', navigate);
  }, [account]);
  return (
    <div className="shell">
      <aside className="rail">
        <a className="brand" href="#library">
          <Piano aria-hidden="true" /> Pianora
        </a>
        <nav aria-label={t("工作空间")}>
          {(Object.keys(pages) as Page[]).map((key) => {
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
          {publishableKey && <div className="account-actions">
            {page !== 'library' && <button disabled={pipelineBusy} onClick={()=>openAccount(page)}>{page === 'studio' ? t("保存最终演奏") : t("保存到曲库")}</button>}
            <button onClick={()=>openAccount('library')}>{t("我的曲库")}</button>
          </div>}
        </header>
        {account && publishableKey && <Suspense fallback={<p role="status">{t("正在打开曲库…")}</p>}>
          <AccountLibrary intent={account} publishableKey={publishableKey} close={closeAccount} />
        </Suspense>}
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
          {page !== 'library' && (
            <Suspense fallback={<p role="status">{t("正在打开工作区…")}</p>}>
              <Workspace
                page={page}
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
