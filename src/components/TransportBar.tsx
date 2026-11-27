import { useEffect, useRef } from 'react';
import {
  Play,
  Pause,
  Square,
  FolderOpen,
  Download,
  AudioWaveform,
  SlidersHorizontal,
} from 'lucide-react';
import { PIANO_PRESETS, HALL_IR_PRESETS } from '../engine/pianoAudio';
import { pianoPlayer } from '../engine/instances';
import { useStudioStore, fmtTime } from '../store/useStudioStore';

export function TransportBar({ pianoStatus }: { pianoStatus: string }) {
  const hasScore = useStudioStore((s) => Boolean(s.scoreMidi));
  const isPlaying = useStudioStore((s) => s.isPlaying);
  const liveActive = useStudioStore((s) => s.liveActive);
  const activeTimbreId = useStudioStore((s) => s.activeTimbreId);
  const timbreDesc = useStudioStore((s) => s.timbreDesc);
  const customTimbres = useStudioStore((s) => s.customTimbres);
  const activeHallId = useStudioStore((s) => s.activeHallId);
  const reverbWet = useStudioStore((s) => s.reverbWet);
  const resonanceAmount = useStudioStore((s) => s.resonanceAmount);
  const exportingWav = useStudioStore((s) => s.exportingWav);

  const togglePlay = useStudioStore((s) => s.togglePlay);
  const stopPlayback = useStudioStore((s) => s.stopPlayback);
  const seekTo = useStudioStore((s) => s.seekTo);
  const switchTimbre = useStudioStore((s) => s.switchTimbre);
  const importCustomSf2 = useStudioStore((s) => s.importCustomSf2);
  const switchHallIr = useStudioStore((s) => s.switchHallIr);
  const setReverbWet = useStudioStore((s) => s.setReverbWet);
  const setResonanceAmount = useStudioStore((s) => s.setResonanceAmount);
  const downloadMidi = useStudioStore((s) => s.downloadMidi);
  const exportWav = useStudioStore((s) => s.exportWav);

  // Update seek bar & clock at 30fps via direct DOM refs -> zero React re-renders during playback!
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

  const handleSf2 = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) void importCustomSf2(f);
    e.target.value = '';
  };

  return (
    <>
      <div className="transport-strip">
        <button id="playBtn" disabled={!hasScore} onClick={togglePlay}>
          {isPlaying ? <Pause /> : <Play />}
          {isPlaying ? '暂停' : '播放'}
        </button>
        <button
          id="stopBtn"
          disabled={!hasScore}
          onClick={stopPlayback}
          aria-label="停止"
          title="停止"
        >
          <Square />
        </button>
        <input
          ref={seekRef}
          aria-label="播放位置"
          id="seekSlider"
          type="range"
          min={0}
          max={100}
          step={0.1}
          defaultValue={0}
          disabled={!hasScore || liveActive}
          onChange={(e) => seekTo(Number(e.target.value))}
        />
        <span ref={timeRef} id="timeTxt">
          00:00 / 00:00
        </span>
      </div>
      <aside className="studio-mixer">
        <header>
          <SlidersHorizontal size={18} />
          <h2>声音设置</h2>
        </header>
        <div className="mixer-field">
          <label htmlFor="timbreSelect">钢琴音色</label>
          <select
            id="timbreSelect"
            title={timbreDesc}
            value={activeTimbreId}
            onChange={(e) => void switchTimbre(e.target.value)}
          >
            {PIANO_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.shortName}
              </option>
            ))}
            {customTimbres.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <small>{pianoStatus}</small>
          <label className="sf-import">
            <FolderOpen size={14} />
            导入本地音色
            <input
              type="file"
              accept=".sf2,.sf3,.dls"
              className="sr-only"
              onChange={handleSf2}
            />
          </label>
        </div>
        <div className="mixer-field">
          <label htmlFor="hallSelect">演奏空间</label>
          <select
            id="hallSelect"
            value={activeHallId}
            onChange={(e) => void switchHallIr(e.target.value)}
          >
            {HALL_IR_PRESETS.map((h) => (
              <option key={h.id} value={h.id}>
                {h.shortName}
              </option>
            ))}
          </select>
        </div>
        <label className="level-control">
          厅堂混响 <output>{Math.round(reverbWet * 100)}%</output>
          <input
            id="reverbSlider"
            type="range"
            min={0}
            max={0.65}
            step={0.05}
            value={reverbWet}
            onChange={(e) => setReverbWet(Number(e.target.value))}
          />
        </label>
        <label className="level-control">
          琴弦共鸣 <output>{Math.round(resonanceAmount * 100)}%</output>
          <input
            id="resSlider"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={resonanceAmount}
            onChange={(e) => setResonanceAmount(Number(e.target.value))}
          />
        </label>
        <footer>
          <button id="dlMidiBtn" disabled={!hasScore} onClick={downloadMidi}>
            <Download /> MIDI
          </button>
          <button
            id="exportWavBtn"
            disabled={!hasScore || exportingWav}
            onClick={() => void exportWav()}
          >
            <AudioWaveform />
            {exportingWav ? '渲染中…' : '导出 WAV'}
          </button>
        </footer>
      </aside>
    </>
  );
}
