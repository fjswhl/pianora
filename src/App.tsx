import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  AudioLines,
  BookOpen,
  ChevronRight,
  FileMusic,
  LibraryBig,
  Piano,
  SlidersHorizontal,
  Upload,
} from 'lucide-react';
import { ScoreSidebar } from './components/ScoreSidebar';
import { StudioPanel } from './components/StudioPanel';
import { Library } from './components/Library';
import { useStudioStore } from './store/useStudioStore';

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
  const init = useStudioStore((s) => s.init);
  const takes = useStudioStore((s) => s.takes);
  const busy = useStudioStore((s) => s.busy);
  const selectPreset = useStudioStore((s) => s.selectPreset);
  const setLyCode = useStudioStore((s) => s.setLyCode);
  const [fileError, setFileError] = useState('');
  useEffect(() => {
    void init();
    const navigate = () => {
      setPage(currentPage());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', navigate);
    return () => window.removeEventListener('hashchange', navigate);
  }, [init]);
  useEffect(() => {
    const studio = useStudioStore.getState();
    if (page === 'editor' && !studio.pianoReady && !studio.pianoLoading) {
      void studio.switchTimbre(studio.activeTimbreId);
    }
    const play = (e: KeyboardEvent) => {
      if (
        page !== 'studio' ||
        e.code !== 'Space' ||
        (e.target as HTMLElement).closest(
          'button,input,select,textarea,a,summary,[contenteditable]',
        )
      )
        return;
      const st = useStudioStore.getState();
      if (st.scoreMidi) {
        e.preventDefault();
        st.togglePlay();
      }
    };
    window.addEventListener('keydown', play);
    return () => window.removeEventListener('keydown', play);
  }, [page]);
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
          {(page !== 'studio' || takes.length === 0) && <div className="page-title">
            <div>
              <h1>{pages[page].title}</h1>
              <p>{pages[page].desc}</p>
            </div>
            {page === 'library' && (
              <button
                className="import"
                disabled={busy}
                onClick={() => upload.current?.click()}
              >
                <Upload size={16} /> 导入乐谱
              </button>
            )}
          </div>}
          <input
            type="file"
            hidden
            ref={upload}
            accept=".ly,.txt"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              try {
                setLyCode(await file.text());
                setFileError('');
                location.hash = 'editor';
              } catch {
                setFileError('无法读取乐谱文件，请重新导入。');
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
          {page === 'editor' && (
            <div className="editing">
              <ScoreSidebar
                onGenerated={() => {
                  if (currentPage() === 'editor') location.hash = 'studio';
                }}
              />
            </div>
          )}
          {page === 'studio' &&
            (takes.length ? (
              <StudioPanel />
            ) : (
              <section className="empty">
                <AudioLines size={38} />
                <h2>{busy ? '正在生成演奏' : '演奏室等待第一份乐谱'}</h2>
                <p>
                  {busy
                    ? '可以在编辑页查看生成进度。'
                    : '在编辑页生成演奏后，就能试听、调整音色和导出音频。'}
                </p>
                <a href="#editor">
                  前往乐谱编辑 <ArrowRight size={16} />
                </a>
              </section>
            ))}
        </main>
      </div>
    </div>
  );
}
