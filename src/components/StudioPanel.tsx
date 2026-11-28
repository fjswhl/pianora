import { t, display } from '../i18n';
import { useState } from 'react';
import { GenerationRecord, TakeRail, TrackSwitch } from './PipelineHeader';
import { useHarmony, HarmonyReadout } from './HarmonyAnalysis';
import { PlayerBar, SoundPanel } from './TransportBar';
import { PianoRollCanvas } from './PianoRollCanvas';
import { WorkbenchPanel } from './WorkbenchPanel';
import { FollowScorePanel } from './FollowScorePanel';
import { SheetMusicPanel } from './SheetMusicPanel';
import { SaveControl } from './SaveControl';
import { Alert, AlertDescription } from './ui/alert';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { TooltipProvider } from './ui/tooltip';
import { fmtTime, useStudioStore } from '../store/useStudioStore';

const views = [
  { id: 'listen', get label() { return t("试听与导出"); } },
  { id: 'shape', get label() { return t("调整演绎"); } },
  { id: 'sheet', get label() { return t("查看谱面"); } },
] as const;
type View = (typeof views)[number]['id'];

export function StudioPanel({publishableKey}: {publishableKey:string | null}) {
  const activeTakeId = useStudioStore(s => s.activeTakeId);
  const live = useStudioStore(s => s.liveActive);
  const [view, setView] = useState<View>('listen');
  const [showHarmony, setShowHarmony] = useState(true);
  const [degrees, setDegrees] = useState(false);
  const harmony = useHarmony(showHarmony && view !== 'shape');
  const hasFlowTake = useStudioStore(s => s.takes.find(take => take.id === s.activeTakeId)?.model === 'pianoflow');
  const title = useStudioStore((s) => s.performanceTitle);
  const savedMidi = useStudioStore(s => s.takes[0]?.model === 'midi');
  const missingOriginal = useStudioStore(s => s.takes[0]?.model === 'midi' && !s.savedNotation);
  const midiNotation = useStudioStore(s => s.midiNotation);
  const score = useStudioStore(s => s.scoreMidi);
  const [requestedScore, setRequestedScore] = useState<typeof score>(null);
  const busy = useStudioStore((s) => s.busy);
  const progress = useStudioStore((s) => s.progressMsg);
  const error = useStudioStore((s) => s.errorMsg);
  const pianoStatus = useStudioStore((s) => s.pianoStatus);
  const bars = useStudioStore((s) => s.totalBars);
  const duration = useStudioStore((s) => s.scoreDuration);
  const track = useStudioStore((s) => s.activeTrack);
  const showView = (id: View) => {
    if (id === 'sheet' && midiNotation) setRequestedScore(score);
    setView(id);
  };

  const harmonyTools = <div className="harmony-tools">
    <label><input type="checkbox" checked={showHarmony} onChange={e => setShowHarmony(e.target.checked)} /> {t('和声分析')}</label>
    {showHarmony && <label><input type="checkbox" checked={degrees} onChange={e => setDegrees(e.target.checked)} /> {t('显示级数')}</label>}
    {showHarmony && <HarmonyReadout harmony={harmony} degrees={degrees} />}
  </div>;

  return (
    <TooltipProvider delayDuration={300}>
    <section className="studio-session">
      <header className="session-head">
        <div>
          <div className="eyebrow">{t("演奏室")} · {t("钢琴独奏")}</div>
          <h1>{display(title)}</h1>
          <div className="chips">
            <Badge variant="surface"><b className="tn">{bars}</b> {t("小节")}</Badge>
            <Badge variant="surface">{savedMidi ? t("演奏时长") : t("原谱")} <b className="tn">{fmtTime(duration)}</b></Badge>
            {publishableKey && <div className="studio-save"><SaveControl publishableKey={publishableKey} intent="studio" source={activeTakeId} disabled={busy || live}/></div>}
          </div>
        </div>
        <div className="seg studio-views" role="group" aria-label={t("演奏工具")}>
          {views.filter(v => v.id !== 'shape' || hasFlowTake).map(({ id, label }) => (
            <button key={id} aria-pressed={view === id} onClick={() => showView(id)}>{label}</button>
          ))}
        </div>
      </header>
      {missingOriginal && <p role="status" className="muted" style={{ marginBottom: 12 }}>{t("这份旧演奏没有保存原谱。显示的谱面由演奏 MIDI 估算。")}</p>}
      {busy && <p role="status" className="muted" style={{ marginBottom: 12 }}>{display(progress)}</p>}
      {error && <Alert variant="destructive" className="mb-3"><AlertDescription>{display(error)}</AlertDescription></Alert>}
      <div className="studio-grid console">
        <TakeRail onMore={() => hasFlowTake ? setView('shape') : (location.hash = 'editor')} />
        <div style={{ minWidth: 0, display: 'grid', gap: 16 }}>
          {view === 'listen' && (
            <Card asChild className="roll-card listening-desk"><section>
              <div className="stage-head">
                <h2>{t("跟着谱子听")}{track !== 'score' && <small className="pencil-legend"><i />{t("红笔：AI 相对原谱的快慢处理")}</small>}</h2>
                <TrackSwitch />
                {harmonyTools}
              </div>
              {midiNotation && requestedScore !== score
                ? <Button size="sm" variant="secondary" className="mb-3" onClick={() => setRequestedScore(score)}>{t("显示 MIDI 随奏谱")}</Button>
                : <FollowScorePanel harmony={harmony} degrees={degrees} />}
              <PianoRollCanvas />
              <GenerationRecord />
            </section></Card>
          )}
          <div hidden={view !== 'shape'}>
            <WorkbenchPanel />
          </div>
          {view === 'sheet' && <SheetMusicPanel harmony={harmony} degrees={degrees} tools={harmonyTools} />}
        </div>
        <SoundPanel pianoStatus={display(pianoStatus)} />
      </div>
      <PlayerBar title={display(title)} />
    </section>
    </TooltipProvider>
  );
}
