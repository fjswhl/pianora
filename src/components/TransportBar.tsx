import { t, display } from '../i18n';
import { useEffect, useRef } from 'react';
import {
  Play,
  Pause,
  Square,
  FolderOpen,
  Download,
  AudioWaveform,
  ChevronRight,
} from 'lucide-react';
import { PIANO_PRESETS, HALL_IR_PRESETS } from '../engine/pianoAudio';
import { pianoPlayer } from '../engine/instances';
import { useStudioStore, fmtTime } from '../store/useStudioStore';
import { takeLetter } from './PipelineHeader';
import { Card } from './ui/card';
import { NativeSelect, NativeSelectOption } from './ui/native-select';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';

/** The persistent dark player: the one place playback lives in the studio. */
export function PlayerBar({ title }: { title: string }) {
  const hasScore = useStudioStore((s) => Boolean(s.scoreMidi));
  const pianoReady = useStudioStore(s => s.pianoReady);
  const isPlaying = useStudioStore((s) => s.isPlaying);
  const liveActive = useStudioStore((s) => s.liveActive);
  const togglePlay = useStudioStore((s) => s.togglePlay);
  const stopPlayback = useStudioStore((s) => s.stopPlayback);
  const seekTo = useStudioStore((s) => s.seekTo);
  const track = useStudioStore((s) => s.activeTrack);
  const takeIndex = useStudioStore((s) => s.takes.findIndex(take => take.id === s.activeTakeId));
  const finalTake = useStudioStore((s) => Boolean(s.takes.find(take => take.id === s.activeTakeId)?.finalMidi));

  // Update seek bar & clock via direct DOM refs -> zero React re-renders during playback.
  const seekRef = useRef<HTMLInputElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let raf = 0;
    const syncClock = () => {
      const tr = useStudioStore.getState().getActiveTrackData();
      const cur = pianoPlayer.getCurrentTime();
      const dur = tr.duration || 0;
      if (seekRef.current && !useStudioStore.getState().liveActive) {
        seekRef.current.max = String(dur || 100);
        seekRef.current.value = String(Math.min(cur, dur));
      }
      if (timeRef.current) {
        timeRef.current.textContent = `${fmtTime(cur)} / ${fmtTime(dur)}`;
      }
      raf = requestAnimationFrame(syncClock);
    };
    raf = requestAnimationFrame(syncClock);
    return () => cancelAnimationFrame(raf);
  }, []);

  const trackName = track === 'score' && !finalTake ? t("原谱演奏")
    : track === 'pianoflow_raw' ? t("AI 演绎") : t("版本 {0}", takeLetter(Math.max(0, takeIndex)));
  return (
    <div className="player" role="region" aria-label={t("播放")}>
      <div className="player-now">
        <b>{title}</b>
        <span>{trackName}</span>
      </div>
      <div className="player-main">
        <button id="playBtn" disabled={!hasScore || !pianoReady} onClick={togglePlay} title={isPlaying ? t("暂停") : t("播放")}>
          {isPlaying ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" style={{ marginLeft: 2 }} />}
          <span className="sr-only">{isPlaying ? t("暂停") : t("播放")}</span>
        </button>
        <Tooltip>
          <TooltipTrigger asChild>
            <button id="stopBtn" disabled={!hasScore} onClick={stopPlayback} aria-label={t("停止")}>
              <Square />
            </button>
          </TooltipTrigger>
          <TooltipContent>{t("停止")}</TooltipContent>
        </Tooltip>
        <input
          ref={seekRef}
          aria-label={t("播放位置")}
          id="seekSlider"
          type="range"
          min={0}
          max={100}
          step={0.1}
          defaultValue={0}
          disabled={!hasScore || liveActive}
          onChange={(e) => seekTo(Number(e.target.value))}
        />
        <span ref={timeRef} id="timeTxt">00:00 / 00:00</span>
      </div>
      <div className="player-side">
        <span><kbd>Space</kbd> {t("播放 / 暂停")}</span>
      </div>
    </div>
  );
}

export function SoundPanel({ pianoStatus }: { pianoStatus: string }) {
  const hasScore = useStudioStore((s) => Boolean(s.scoreMidi));
  const activeTimbreId = useStudioStore((s) => s.activeTimbreId);
  const timbreDesc = useStudioStore((s) => s.timbreDesc);
  const customTimbres = useStudioStore((s) => s.customTimbres);
  const activeHallId = useStudioStore((s) => s.activeHallId);
  const reverbWet = useStudioStore((s) => s.reverbWet);
  const resonanceAmount = useStudioStore((s) => s.resonanceAmount);
  const exportingWav = useStudioStore((s) => s.exportingWav);
  const switchTimbre = useStudioStore((s) => s.switchTimbre);
  const importCustomSf2 = useStudioStore((s) => s.importCustomSf2);
  const switchHallIr = useStudioStore((s) => s.switchHallIr);
  const setReverbWet = useStudioStore((s) => s.setReverbWet);
  const setResonanceAmount = useStudioStore((s) => s.setResonanceAmount);
  const downloadMidi = useStudioStore((s) => s.downloadMidi);
  const exportWav = useStudioStore((s) => s.exportWav);

  const handleSf2 = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) void importCustomSf2(f);
    e.target.value = '';
  };

  return (
    <Card asChild className="studio-mixer"><aside>
      <h2 className="panel-title" style={{ marginBottom: 0 }}>{t("声音设置")}</h2>
      <div className="mixer-field">
        <label htmlFor="timbreSelect">{t("钢琴音色")}</label>
        <NativeSelect
          id="timbreSelect"
          wrapperClassName="w-full"
          title={display(timbreDesc)}
          value={activeTimbreId}
          onChange={(e) => void switchTimbre(e.target.value)}
        >
          {PIANO_PRESETS.map((p) => (
            <NativeSelectOption key={p.id} value={p.id}>{p.shortName}</NativeSelectOption>
          ))}
          {customTimbres.map((c) => (
            <NativeSelectOption key={c.id} value={c.id}>{c.name}</NativeSelectOption>
          ))}
        </NativeSelect>
        <small>{pianoStatus}</small>
        <label className="sf-import">
          <FolderOpen size={14} />
          {t("导入本地音色")}
          <input type="file" accept=".sf2,.sf3,.dls" className="sr-only" onChange={handleSf2} />
        </label>
      </div>
      <div className="mixer-field">
        <label htmlFor="hallSelect">{t("演奏空间")}</label>
        <NativeSelect id="hallSelect" wrapperClassName="w-full" value={activeHallId} onChange={(e) => void switchHallIr(e.target.value)}>
          {HALL_IR_PRESETS.map((h) => (
            <NativeSelectOption key={h.id} value={h.id}>{h.shortName}</NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      <label className="level-control">
        {t("厅堂混响")} <output>{Math.round(reverbWet * 100)}%</output>
        <input id="reverbSlider" type="range" min={0} max={0.65} step={0.05} value={reverbWet}
          onChange={(e) => setReverbWet(Number(e.target.value))} />
      </label>
      <label className="level-control">
        {t("琴弦共鸣")} <output>{Math.round(resonanceAmount * 100)}%</output>
        <input id="resSlider" type="range" min={0} max={1} step={0.05} value={resonanceAmount}
          onChange={(e) => setResonanceAmount(Number(e.target.value))} />
      </label>
      <footer>
        <h2 className="panel-title" style={{ margin: '4px 0 4px' }}>{t("带走这一版")}</h2>
        <button id="dlMidiBtn" className="row-link" disabled={!hasScore} onClick={downloadMidi}>
          <i><Download /></i>
          <span><b>{t("下载 MIDI")}</b><small>{t("含踏板控制")}</small></span>
          <ChevronRight />
        </button>
        <button id="exportWavBtn" className="row-link" disabled={!hasScore || exportingWav} onClick={() => void exportWav()}>
          <i><AudioWaveform /></i>
          <span><b>{exportingWav ? t("渲染中…") : t("导出 WAV")}</b><small>{t("包含音色与厅堂混响")}</small></span>
          <ChevronRight />
        </button>
      </footer>
    </aside></Card>
  );
}
