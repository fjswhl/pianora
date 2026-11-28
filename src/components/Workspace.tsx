import { t } from '../i18n';
import { lazy, Suspense, useEffect } from 'react';
import { ArrowRight, AudioLines } from 'lucide-react';
import { useScoreStore } from '../store/useScoreStore';
import { useStudioStore } from '../store/useStudioStore';
import { ScoreSidebar } from './ScoreSidebar';
const StudioPanel = lazy(() =>
  import('./StudioPanel').then((m) => ({ default: m.StudioPanel })),
);

export default function Workspace({
  page,
  title,
  description,
}: {
  page: 'editor' | 'studio';
  title: string;
  description: string;
}) {
  const takes = useStudioStore((s) => s.takes);
  const busy = useStudioStore((s) => s.busy);
  useEffect(() => {
    const source = useScoreStore.getState();
    if (
      page === 'editor' &&
      !source.lyCode &&
      !source.importedScore &&
      !source.loading &&
      source.selectedPresetId === 'short_etude'
    ) {
      void source.selectPreset('short_etude');
    }
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
    <Suspense fallback={<p role="status">{t("正在打开演奏室…")}</p>}>
      {(page === 'editor' || !takes.length) && (
        <div className="page-title">
          <div>
            <h1>{title}</h1>
            <p>{description}</p>
          </div>
        </div>
      )}
      {page === 'editor' && (
        <div className="editing">
          <ScoreSidebar
            onGenerated={() => {
              if (location.hash === '#editor') location.hash = 'studio';
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
            <h2>{busy ? t("正在生成演奏") : t("演奏室等待第一份乐谱")}</h2>
            <p>
              {busy
                ? t("可以在编辑页查看生成进度。")
                : t("在编辑页生成演奏后，就能试听、调整音色和导出音频。")}
            </p>
            <a href="#editor">
              {t("前往乐谱编辑")} <ArrowRight size={16} />
            </a>
          </section>
        ))}
    </Suspense>
  );
}
