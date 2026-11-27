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

const Workspace = lazy(() => import('./components/Workspace'));

const pages = {
  library: {
    title: '曲谱馆',
    icon: LibraryBig,
    desc: '挑选一份钢琴谱，开始你的演奏。',
  },
  editor: {
    title: '乐谱编辑',
    icon: FileMusic,
    desc: '编写乐谱，设定演奏细节，生成可供试听的版本。',
  },
  studio: {
    title: '演奏室',
    icon: SlidersHorizontal,
    desc: '试听、比较与调整你的钢琴演奏。',
  },
};
type Page = keyof typeof pages;
function currentPage(): Page {
  const hash = location.hash.slice(1);
  return Object.hasOwn(pages, hash) ? (hash as Page) : 'library';
}

export function App() {
  const [page, setPage] = useState<Page>(currentPage);
  const upload = useRef<HTMLInputElement>(null);
  const pipelineBusy = useScoreStore((s) => s.pipelineBusy);
  const { selectPreset, importFile } = useScoreStore.getState();
  const [fileError, setFileError] = useState('');
  useEffect(() => {
    const navigate = () => {
      setPage(currentPage());
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
        <nav aria-label="工作空间">
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
          <span>本地演奏工作站</span>
        </div>
      </aside>
      <div className="workspace">
        <header className="crumb">
          <BookOpen size={16} /> 工作空间 <ChevronRight size={13} />{' '}
          <strong>{pages[page].title}</strong>
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
                <Upload size={16} /> 导入乐谱 (.ly / .mid / MusicXML)
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
              if (ok) {
                setFileError('');
                location.hash = 'editor';
              } else {
                setFileError(useScoreStore.getState().error || '无法读取乐谱文件，请重新导入。');
              }
            }}
          />
          {fileError && <p role="alert">{fileError}</p>}
          {page === 'library' && (
            <Library
              openScore={(id) => {
                selectPreset(id);
                location.hash = 'editor';
              }}
            />
          )}
          {page !== 'library' && (
            <Suspense fallback={<p role="status">正在打开工作区…</p>}>
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
