import { useEffect, useRef } from 'react';
import { Play, Pause, Square, FolderOpen, Download, AudioWaveform, Landmark, Waves } from 'lucide-react';
import { PIANO_PRESETS, HALL_IR_PRESETS } from '../engine/pianoAudio';
import { pianoPlayer } from '../engine/instances';
import { useStudioStore, fmtTime } from '../store/useStudioStore';

export function TransportBar() {
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
    <div className="space-y-2">
      <div className="space-y-2 rounded-xl border border-slate-800 bg-[#0b101c] px-3 py-2.5">
        {/* Row 1: Playback Transport + Seek + Export */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            id="playBtn"
            disabled={!hasScore}
            onClick={togglePlay}
            className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-slate-700 bg-[#161f33] px-3 py-1.5 text-xs font-semibold text-slate-100 transition hover:border-[#e8be6a] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isPlaying ? <Pause className="h-3.5 w-3.5 text-[#e8be6a]" /> : <Play className="h-3.5 w-3.5 fill-current text-[#e8be6a]" />}
            {isPlaying ? '暂停' : '播放'}
          </button>

          <button
            id="stopBtn"
            disabled={!hasScore}
            onClick={stopPlayback}
            className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-slate-700 bg-[#161f33] px-2.5 py-1.5 text-xs font-semibold text-slate-200 transition hover:border-[#e8be6a] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Square className="h-3 w-3 fill-current" />
            停止
          </button>

          <div className="flex min-w-[200px] flex-1 items-center gap-2.5 px-1">
            <input
              ref={seekRef}
              id="seekSlider"
              type="range"
              min={0}
              max={100}
              step={0.1}
              defaultValue={0}
              disabled={!hasScore || liveActive}
              onChange={(e) => seekTo(parseFloat(e.target.value))}
              className="flex-1"
            />
            <span
              ref={timeRef}
              id="timeTxt"
              className="shrink-0 whitespace-nowrap font-mono text-[11px] tabular-nums text-slate-300"
            >
              00:00 / 00:00
            </span>
          </div>

          <button
            id="dlMidiBtn"
            disabled={!hasScore}
            onClick={downloadMidi}
            className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-lg border border-slate-700 bg-[#161f33] px-2.5 py-1.5 text-xs font-medium text-slate-200 transition hover:border-[#e8be6a] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" />
            MIDI
          </button>

          <button
            id="exportWavBtn"
            disabled={!hasScore || exportingWav}
            onClick={() => void exportWav()}
            className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-lg border border-slate-700 bg-[#161f33] px-2.5 py-1.5 text-xs font-medium text-slate-200 transition hover:border-[#e8be6a] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <AudioWaveform className="h-3.5 w-3.5 text-[#e8be6a]" />
            {exportingWav ? '渲染 WAV...' : '导出 WAV'}
          </button>
        </div>

        {/* Row 2: Acoustic Grand Piano + Hall Convolution + Sympathetic Resonance */}
        <div className="flex flex-wrap items-center gap-2.5 border-t border-slate-800/80 pt-2">
          <select
            id="timbreSelect"
            value={activeTimbreId}
            onChange={(e) => void switchTimbre(e.target.value)}
            className="max-w-[260px] truncate rounded-lg border border-slate-700/80 bg-[#12192a] px-2.5 py-1.5 text-xs text-slate-100 outline-none focus:border-[#e8be6a]"
          >
            {PIANO_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
            {customTimbres.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          <label
            title="导入任意本地 .sf2 / .sf3 / .dls 钢琴音色"
            className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-lg border border-slate-700 bg-[#161f33] px-2.5 py-1.5 text-xs font-medium text-slate-200 transition hover:border-[#e8be6a]"
          >
            <FolderOpen className="h-3.5 w-3.5 text-[#e8be6a]" />
            本地 SF2
            <input type="file" accept=".sf2,.sf3,.dls" className="hidden" onChange={handleSf2} />
          </label>

          <div className="flex items-center gap-1.5">
            <Landmark className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            <select
              id="hallSelect"
              value={activeHallId}
              onChange={(e) => void switchHallIr(e.target.value)}
              className="max-w-[195px] truncate rounded-lg border border-slate-700/80 bg-[#12192a] px-2 py-1.5 text-xs text-slate-100 outline-none focus:border-[#e8be6a]"
            >
              {HALL_IR_PRESETS.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
          </div>

          <label className="flex shrink-0 items-center gap-1.5 text-[11px] text-slate-400" title="真实音乐厅卷积混响">
            <span>厅堂</span>
            <input
              id="reverbSlider"
              type="range"
              min={0}
              max={0.65}
              step={0.05}
              value={reverbWet}
              onChange={(e) => setReverbWet(parseFloat(e.target.value))}
              className="w-16"
            />
          </label>

          <label className="flex shrink-0 items-center gap-1.5 text-[11px] text-slate-400" title="AudioWorklet 琴弦交感共鸣">
            <Waves className="h-3.5 w-3.5 text-sky-400" />
            <span>弦共鸣</span>
            <input
              id="resSlider"
              type="range"
              min={0}
              max={1.0}
              step={0.05}
              value={resonanceAmount}
              onChange={(e) => setResonanceAmount(parseFloat(e.target.value))}
              className="w-16 accent-sky-400"
            />
          </label>
        </div>
      </div>

      <div id="timbreDesc" className="px-1 text-[11px] text-slate-400">
        当前声学引擎：{timbreDesc}
      </div>
    </div>
  );
}
