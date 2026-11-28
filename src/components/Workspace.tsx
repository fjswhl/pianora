import { unpackNotation } from '../engine/savedNotation';
import { t, display, errorText, type DisplayText } from '../i18n';
import { lazy, Suspense, useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { useScoreStore } from '../store/useScoreStore';
import { useStudioStore } from '../store/useStudioStore';
import { RecentGenerations } from './RecentGenerations';
import { ScoreSidebar } from './ScoreSidebar';
const StudioPanel = lazy(() =>
  import('./StudioPanel').then((m) => ({ default: m.StudioPanel })),
);

export default function Workspace({
  page, shareId, publishableKey,
  title,
  description,
}: {
  page: 'editor' | 'studio';
  shareId: string | null;
  publishableKey: string | null;
  title: string;
  description: string;
}) {
  const [shared, setShared] = useState<{id: string; error?: DisplayText} | null>(null);
  useEffect(() => {
    if (page !== 'studio' || !shareId) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const [response, sheet] = await Promise.all(['performance','notation'].map(name =>
          fetch('/p/'+shareId+'/'+name, {signal:controller.signal})));
        if (!response.ok) throw new Error(t("这场演奏暂不可用。"));
        const bytes = new Uint8Array(await response.arrayBuffer());
        const notation = sheet.status === 404 ? undefined : await unpackNotation(sheet);
        if (controller.signal.aborted) return;
        useStudioStore.getState().openPerformanceMidi(bytes,
          decodeURIComponent(response.headers.get('X-Pianora-Title') ?? ''),
          decodeURIComponent(response.headers.get('X-Pianora-Take') ?? ''), notation);
        setShared({id:shareId});
      } catch (error) { if (!controller.signal.aborted) setShared({id:shareId, error:errorText(error)}); }
    })();
    return () => controller.abort();
  }, [page, shareId]);
  const takes = useStudioStore((s) => s.takes);
  const error = useStudioStore(s => s.errorMsg);
  const progress = useStudioStore(s => s.progressMsg);
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
  if (page === 'studio' && shareId) {
    if (shared?.id !== shareId) return <p role="status">{t("正在打开演奏…")}</p>;
    if (shared.error) return <p role="alert">{display(shared.error)}</p>;
  }
  return (
    <Suspense fallback={<p role="status">{t("正在打开演奏室…")}</p>}>
      {(page === 'editor' || !takes.length) && (
        <div className="page-title">
          <div>
            <h1>{title}</h1>
            <p>{description}</p>
          </div>
          {page === 'studio' && <a href="#editor" className="import">{t("前往乐谱编辑")} <ArrowRight size={16} /></a>}
        </div>
      )}
      {page === 'editor' && (
        <div className="editing">
          <ScoreSidebar publishableKey={publishableKey}
            onGenerated={() => {
              if (location.hash === '#editor') location.hash = 'studio';
            }}
          />
        </div>
      )}
      {page === 'studio' && !shareId && <RecentGenerations hasSession={Boolean(takes.length)} />}
      {page === 'studio' && !takes.length && error && <p role="alert">{display(error)}</p>}
      {page === 'studio' && !takes.length && busy && <p role="status">{display(progress)}</p>}
      {page === 'studio' && takes.length > 0 && <StudioPanel publishableKey={publishableKey} key={takes[0].id} />}
    </Suspense>
  );
}
