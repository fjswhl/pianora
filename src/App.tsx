import { useEffect } from 'react';
import { TopBar } from './components/TopBar';
import { ScoreSidebar } from './components/ScoreSidebar';
import { PipelineHeader } from './components/PipelineHeader';
import { TransportBar } from './components/TransportBar';
import { PianoRollCanvas } from './components/PianoRollCanvas';
import { WorkbenchPanel } from './components/WorkbenchPanel';
import { SheetMusicPanel } from './components/SheetMusicPanel';
import { useStudioStore } from './store/useStudioStore';

export function App() {
  const init = useStudioStore((s) => s.init);

  useEffect(() => {
    void init();

    // Global Studio shortcut: Space toggles playback when not typing inside an editor/input
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return;
      const st = useStudioStore.getState();
      if (!st.scoreMidi) return;
      e.preventDefault();
      st.togglePlay();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [init]);

  return (
    <div className="min-h-screen text-slate-100">
      <TopBar />

      <main className="mx-auto grid max-w-[1720px] grid-cols-1 gap-4 px-5 py-4 xl:grid-cols-[430px_1fr]">
        <ScoreSidebar />

        <div className="flex min-w-0 flex-col gap-4">
          <section className="space-y-3 rounded-2xl border border-slate-800/90 bg-[#101624] p-4 shadow-2xl shadow-black/30">
            <PipelineHeader />
            <TransportBar />
            <PianoRollCanvas />
          </section>

          <WorkbenchPanel />
          <SheetMusicPanel />
        </div>
      </main>
    </div>
  );
}
