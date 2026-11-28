import { t, display } from '../i18n';
import { useState } from 'react';
import { AudioLines, BookOpen, SlidersHorizontal } from 'lucide-react';
import { PipelineHeader, GenerationRecord } from './PipelineHeader';
import { useHarmony, HarmonyReadout } from './HarmonyAnalysis';
import { TransportBar } from './TransportBar';
import { PianoRollCanvas } from './PianoRollCanvas';
import { WorkbenchPanel } from './WorkbenchPanel';
import { FollowScorePanel } from './FollowScorePanel';
import { SheetMusicPanel } from './SheetMusicPanel';
import { fmtTime, useStudioStore } from '../store/useStudioStore';

const views = [
  { id: 'listen', get label() { return t("试听与导出"); }, icon: AudioLines },
  { id: 'shape', get label() { return t("调整演绎"); }, icon: SlidersHorizontal },
  { id: 'sheet', get label() { return t("查看谱面"); }, icon: BookOpen },
] as const;

export function StudioPanel() {
  const [view, setView] = useState<(typeof views)[number]['id']>('listen');
  const [showHarmony, setShowHarmony] = useState(true);
  const [degrees, setDegrees] = useState(false);
  const harmony = useHarmony(showHarmony && view !== 'shape');
  const playing = useStudioStore(s => s.isPlaying);
  const togglePlay = useStudioStore(s => s.togglePlay);
  const title = useStudioStore((s) => s.performanceTitle);
  const midiNotation = useStudioStore(s => s.midiNotation);
  const score = useStudioStore(s => s.scoreMidi);
  const [requestedScore, setRequestedScore] = useState<typeof score>(null);
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
          <span>{t("演奏室")}</span>
          <h1>{display(title)}</h1>
          <p>
            {t("钢琴独奏")} <i /> {bars} {t("小节")} <i /> {t("原谱")} {fmtTime(duration)}
          </p>
        </div>
        <div className="session-print" aria-hidden="true">
          <div className="session-disc" />
        </div>
      </header>
      <div className="studio-views" aria-label={t("演奏工具")}>
        {views.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            aria-pressed={view === id}
            onClick={() => {
              if (id === 'sheet' && midiNotation) setRequestedScore(score);
              setView(id);
            }}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </div>
      {view !== 'shape' && <div className="harmony-tools">
        <label><input type="checkbox" checked={showHarmony} onChange={e => setShowHarmony(e.target.checked)} /> {t('和声分析')}</label>
        {showHarmony && <label><input type="checkbox" checked={degrees} onChange={e => setDegrees(e.target.checked)} /> {t('显示级数')}</label>}
        {view === 'sheet' && <button onClick={togglePlay}>{playing ? t('暂停') : t('播放')}</button>}
        {showHarmony && <HarmonyReadout harmony={harmony} degrees={degrees} />}
      </div>}
      {busy && <p role="status">{display(progress)}</p>}
      {error && <p role="alert">{display(error)}</p>}
      <div className="console">
        {view === 'listen' && (
          <section className="listening-desk">
            <div className="roll-card">
              <PipelineHeader />
              {midiNotation && requestedScore !== score
                ? <button onClick={() => setRequestedScore(score)}>{t("显示 MIDI 随奏谱")}</button>
                : <FollowScorePanel harmony={harmony} degrees={degrees} />}
              <PianoRollCanvas />
            </div>
            <TransportBar pianoStatus={display(pianoStatus)} />
            <GenerationRecord />
          </section>
        )}
        <div hidden={view !== 'shape'}>
          <WorkbenchPanel />
        </div>
        {view === 'sheet' && <SheetMusicPanel harmony={harmony} degrees={degrees} />}
      </div>
    </section>
  );
}
