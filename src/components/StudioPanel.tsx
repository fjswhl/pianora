import { useState } from 'react';
import { AudioLines, BookOpen, SlidersHorizontal } from 'lucide-react';
import { PipelineHeader, GenerationRecord } from './PipelineHeader';
import { TransportBar } from './TransportBar';
import { PianoRollCanvas } from './PianoRollCanvas';
import { WorkbenchPanel } from './WorkbenchPanel';
import { FollowScorePanel } from './FollowScorePanel';
import { SheetMusicPanel } from './SheetMusicPanel';
import { fmtTime, useStudioStore } from '../store/useStudioStore';

const views = [
  { id: 'listen', label: '试听与导出', icon: AudioLines },
  { id: 'shape', label: '调整演绎', icon: SlidersHorizontal },
  { id: 'sheet', label: '查看谱面', icon: BookOpen },
] as const;

export function StudioPanel() {
  const [view, setView] = useState<(typeof views)[number]['id']>('listen');
  const title = useStudioStore((s) => s.performanceTitle);
  const busy = useStudioStore((s) => s.busy);
  const progress = useStudioStore((s) => s.progressMsg);
  const error = useStudioStore((s) => s.errorMsg);
  const pianoStatus = useStudioStore((s) => s.pianoStatus);
  const bars = useStudioStore((s) => s.totalBars);
  const duration = useStudioStore((s) => s.scoreDuration);
  return (
    <section className="studio-session">
      <header className="session-title">
        <div>
          <span>演奏室</span>
          <h1>{title}</h1>
          <p>
            钢琴独奏 <i /> {bars} 小节 <i /> 原谱 {fmtTime(duration)}
          </p>
        </div>
        <div className="session-print" aria-hidden="true">
          <div className="session-disc" />
        </div>
      </header>
      <div className="studio-views" aria-label="演奏工具">
        {views.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            aria-pressed={view === id}
            onClick={() => setView(id)}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </div>
      {busy && <p role="status">{progress}</p>}
      {error && <p role="alert">{error}</p>}
      <div className="console">
        {view === 'listen' && (
          <section className="listening-desk">
            <div className="roll-card">
              <PipelineHeader />
              <FollowScorePanel />
              <PianoRollCanvas />
            </div>
            <TransportBar pianoStatus={pianoStatus} />
            <GenerationRecord />
          </section>
        )}
        <div hidden={view !== 'shape'}>
          <WorkbenchPanel />
        </div>
        {view === 'sheet' && <SheetMusicPanel />}
      </div>
    </section>
  );
}
