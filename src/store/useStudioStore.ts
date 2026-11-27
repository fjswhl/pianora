import { create } from 'zustand';
import { Midi } from '@tonejs/midi';
import {
  restoreArpeggios,
  type RawArpeggioAnnotation,
  type RestoredArpeggioInfo,
  type SimpleNote,
} from '../engine/arpeggio';
import {
  LiveConductorSession,
  alignPerformanceMidiToScore,
  clonePerfState,
  decodePerfState,
  notesToMidiBytes,
  synthesizeRomanticDemoMidi,
  type ConductorCue,
  type PerfState,
} from '../engine/pianoflow';
import {
  DEFAULT_TIMBRE,
  DEFAULT_TIMBRE_ID,
  HALL_IR_PRESETS,
  PIANO_PRESETS,
} from '../engine/pianoAudio';
import { useScoreStore } from './useScoreStore';
import { lilypondEngine, pianoFlowEngine, pianoPlayer } from '../engine/instances';

export type TrackKey = 'score' | 'pianoflow_raw' | 'final_restored';
export type StageStatus = 'idle' | 'active' | 'done';

export interface TakeRecord {
  id: string;
  label: string;
  subtitle: string;
  seed: number;
  perfState: PerfState;
  rawNotes: SimpleNote[];
  rawDuration: number;
  restoredNotes: SimpleNote[];
  restoredDuration: number;
  arpeggios: RestoredArpeggioInfo[];
}

export interface CustomTimbreItem {
  id: string;
  name: string;
}

export function fmtTime(sec: number): string {
  sec = Math.max(0, sec || 0);
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function summarizeNotes(notes: SimpleNote[]): string {
  if (!notes.length) return '0 音';
  let sumV = 0;
  let minV = 127;
  let maxV = 0;
  for (const n of notes) {
    sumV += n.v;
    if (n.v < minV) minV = n.v;
    if (n.v > maxV) maxV = n.v;
  }
  return `均力 ${Math.round(sumV / notes.length)} (${minV}–${maxV})`;
}

function defaultCuesForBars(totalBars: number): ConductorCue[] {
  if (totalBars >= 40) {
    return [
      { id: 'c1', startBar: 1, endBar: Math.min(14, totalBars), tempoScale: 0.85, velOffset: -18, strength: 0.85 },
      { id: 'c2', startBar: 15, endBar: Math.min(26, totalBars), tempoScale: 1.08, velOffset: 8, strength: 0.85 },
      { id: 'c3', startBar: 27, endBar: Math.min(42, totalBars), tempoScale: 1.18, velOffset: 22, strength: 0.9 },
      { id: 'c4', startBar: 43, endBar: totalBars, tempoScale: 0.82, velOffset: -20, strength: 0.85 },
    ];
  }
  const mid = Math.max(2, Math.floor(totalBars / 2));
  return [
    { id: 'c1', startBar: 1, endBar: mid, tempoScale: 0.82, velOffset: -20, strength: 0.88 },
    { id: 'c2', startBar: Math.min(totalBars, mid + 1), endBar: totalBars, tempoScale: 1.22, velOffset: 24, strength: 0.9 },
  ];
}

// Keep live conductor session & interval outside React render tree
let liveSessionRef: LiveConductorSession | null = null;
let liveLoopTimer: number | null = null;

export function getLiveSession(): LiveConductorSession | null {
  return liveSessionRef;
}

interface StudioState {
  // Engine status pills
  wasmReady: boolean;
  wasmStatus: string;
  ortReady: boolean;
  ortStatus: string;
  pianoReady: boolean;
  pianoLoading: boolean;
  pianoStatus: string;

  // Audio controls
  activeTimbreId: string;
  timbreDesc: string;
  customTimbres: CustomTimbreItem[];
  activeHallId: string;
  reverbWet: number;
  resonanceAmount: number;
  isPlaying: boolean;
  exportingWav: boolean;

  // Score & Pipeline params
  performanceTitle: string;
  cfmSteps: number;
  stepFactor: number;
  seed: number;
  batchCount: number;
  arpMs: number;

  // Pipeline execution
  busy: boolean;
  progressMsg: string;
  progressPct: number;
  errorMsg: string;
  stages: Record<'st1' | 'st2' | 'st3' | 'st4' | 'st5', { status: StageStatus; stat: string }>;

  // Compiled score & Takes pool
  scoreMidi: Midi | null;
  scoreNotes: SimpleNote[];
  scoreDuration: number;
  rawAnnotations: RawArpeggioAnnotation[];
  svgPages: string[];
  totalBars: number;
  takes: TakeRecord[];
  activeTakeId: string;
  activeTrack: TrackKey;

  // Mode 5 Conductor cues
  cues: ConductorCue[];

  // Mode 6 Live Real-Time Conductor
  liveActive: boolean;
  liveTempo: number;
  liveVel: number;
  liveStatus: string;

  // Mode 7 Master Style Relay
  refMasterMidi: Midi | null;
  refMasterLabel: string;
  m7Status: string;

  // Actions
  setCfmSteps: (v: number) => void;
  setStepFactor: (v: number) => void;
  setSeed: (v: number) => void;
  setBatchCount: (v: number) => void;
  setArpMs: (v: number) => void;

  switchTimbre: (presetId: string) => Promise<void>;
  importCustomSf2: (file: File) => Promise<void>;
  switchHallIr: (hallId: string) => Promise<void>;
  setReverbWet: (v: number) => void;
  setResonanceAmount: (v: number) => void;

  runFullPipeline: () => Promise<void>;
  selectTake: (id: string) => void;
  selectTrack: (track: TrackKey) => void;
  getActiveTrackData: () => { notes: SimpleNote[]; duration: number };

  togglePlay: () => void;
  playFrom: (sec: number) => void;
  stopPlayback: () => void;
  seekTo: (sec: number) => void;
  downloadMidi: () => void;
  exportWav: () => Promise<void>;

  // 7 Advanced PianoFlow Modes
  runMode1Batch: (count: number, startSeed: number) => Promise<void>;
  runMode2Continuation: (lockBars: number, count: number, startSeed: number) => Promise<void>;
  runMode3Inpainting: (startBar: number, endBar: number, seed: number) => Promise<void>;
  runMode4Dimensions: (dims: [boolean, boolean, boolean, boolean], startBar: number, endBar: number, seed: number) => Promise<void>;
  setCues: (cues: ConductorCue[]) => void;
  resetDefaultCues: () => void;
  runMode5Conductor: (seed: number) => Promise<void>;
  startLiveConductor: () => Promise<void>;
  updateLiveControls: (tempo: number, vel: number) => Promise<void>;
  stopLiveConductor: (saveTake?: boolean) => void;
  loadRefMasterFile: (file: File) => Promise<void>;
  loadBuiltinMasterDemo: (style: 'debussy_poetic' | 'horowitz_dramatic') => void;
  runMode7MasterRelay: (prefixBars: number, seed: number) => Promise<void>;
}


export const useStudioStore = create<StudioState>((set, get) => {
  const buildTake = (id: string, label: string, seed: number, perfState: PerfState): TakeRecord => {
    const st = get();
    const decoded = decodePerfState(perfState);
    const fixed = restoreArpeggios(st.scoreMidi!, decoded.perfSustainNotes, st.rawAnnotations, st.arpMs);
    return {
      id,
      label,
      subtitle: `${fmtTime(fixed.duration)} · ${summarizeNotes(fixed.notes)}`,
      seed,
      perfState,
      rawNotes: decoded.perfSustainNotes,
      rawDuration: decoded.perfDuration,
      restoredNotes: fixed.notes,
      restoredDuration: fixed.duration,
      arpeggios: fixed.arpeggios,
    };
  };

  const runGuardedMode = async (title: string, fn: () => Promise<void>) => {
    const st = get();
    if (!st.scoreMidi || st.busy) return;
    if (st.liveActive) st.stopLiveConductor(false);
    set({ busy: true, errorMsg: '', progressMsg: `${title}...`, progressPct: 12 });
    try {
      await fn();
    } catch (err) {
      console.error(err);
      set({ errorMsg: (err as Error).message || String(err) });
    } finally {
      set({ busy: false });
    }
  };

  return {
    wasmReady: false,
    wasmStatus: 'LilyPond WASM 待命',
    ortReady: false,
    ortStatus: 'PianoFlow ONNX 待加载',
    pianoReady: false,
    pianoLoading: false,
    pianoStatus: '钢琴音色待加载',

    activeTimbreId: DEFAULT_TIMBRE_ID,
    timbreDesc: DEFAULT_TIMBRE.desc,
    customTimbres: [],
    activeHallId: HALL_IR_PRESETS[0].id,
    reverbWet: 0.28,
    resonanceAmount: 0.55,
    isPlaying: false,
    exportingWav: false,

    performanceTitle: '',
    cfmSteps: 10,
    stepFactor: 0.75,
    seed: 42,
    batchCount: 1,
    arpMs: 240,

    busy: false,
    progressMsg: '',
    progressPct: 0,
    errorMsg: '',
    stages: {
      st1: { status: 'idle', stat: '待运行' },
      st2: { status: 'idle', stat: '待运行' },
      st3: { status: 'idle', stat: '待运行' },
      st4: { status: 'idle', stat: '待运行' },
      st5: { status: 'idle', stat: DEFAULT_TIMBRE.shortName },
    },

    scoreMidi: null,
    scoreNotes: [],
    scoreDuration: 0,
    rawAnnotations: [],
    svgPages: [],
    totalBars: 0,
    takes: [],
    activeTakeId: '',
    activeTrack: 'final_restored',

    cues: defaultCuesForBars(4),

    liveActive: false,
    liveTempo: 1.0,
    liveVel: 0,
    liveStatus: '就绪：点击「启动实时指挥演奏」后随时拖动速度与情绪滑块',

    refMasterMidi: null,
    refMasterLabel: '',
    m7Status: '尚未选择参考演奏 MIDI（可直接点击上方内置大师引子试玩）',

    setCfmSteps: (v) => set({ cfmSteps: v }),
    setStepFactor: (v) => set({ stepFactor: v }),
    setSeed: (v) => set({ seed: v }),
    setBatchCount: (v) => set({ batchCount: v }),

    setArpMs: (v) => {
      set({ arpMs: v });
      const st = get();
      const tk = st.takes.find((t) => t.id === st.activeTakeId);
      if (!st.scoreMidi || !tk) return;
      const t0 = performance.now();
      const fixed = restoreArpeggios(st.scoreMidi, tk.rawNotes, st.rawAnnotations, v);
      const updatedTakes = st.takes.map((item) =>
        item.id === tk.id
          ? {
              ...item,
              restoredNotes: fixed.notes,
              restoredDuration: fixed.duration,
              arpeggios: fixed.arpeggios,
              subtitle: `${fmtTime(fixed.duration)} · ${summarizeNotes(fixed.notes)}`,
            }
          : item,
      );
      set({
        takes: updatedTakes,
        stages: { ...st.stages, st4: { status: 'done', stat: `${(performance.now() - t0).toFixed(1)} ms 即时重调` } },
      });
      if (st.activeTrack === 'final_restored' && !st.liveActive) {
        const cur = pianoPlayer.getCurrentTime();
        const wasPlaying = pianoPlayer.isPlaying;
        pianoPlayer.setTrack(fixed.notes, fixed.duration);
        if (wasPlaying) void pianoPlayer.play(cur, () => set({ isPlaying: false }));
      }
    },

    switchTimbre: async (presetId) => {
      const wasPlaying = pianoPlayer.isPlaying && !get().liveActive;
      const curT = pianoPlayer.getCurrentTime();
      if (wasPlaying) pianoPlayer.pause();
      set({ activeTimbreId: presetId, pianoLoading: true, pianoReady: false });
      try {
        const spec = await pianoPlayer.loadPreset(presetId, (loading, text) => {
          set((s) => ({
            pianoLoading: loading,
            pianoReady: !loading,
            pianoStatus: text,
            stages: {
              ...s.stages,
              st5: { status: loading ? 'active' : 'done', stat: loading ? '加载音色中...' : specShort(presetId) },
            },
          }));
        });
        set({ timbreDesc: spec.desc });
        if (wasPlaying) {
          set({ isPlaying: true });
          void pianoPlayer.play(curT, () => set({ isPlaying: false }));
        }
      } catch (e) {
        console.error(e);
        set({ pianoLoading: false, pianoReady: false, pianoStatus: '音色加载失败，请重试' });
      }
    },

    importCustomSf2: async (file) => {
      const wasPlaying = pianoPlayer.isPlaying && !get().liveActive;
      const curT = pianoPlayer.getCurrentTime();
      if (wasPlaying) pianoPlayer.pause();
      try {
        const name = await pianoPlayer.loadCustomSf2File(file, (loading, text) => {
          set((s) => ({
            pianoLoading: loading,
            pianoReady: !loading,
            pianoStatus: text,
            stages: {
              ...s.stages,
              st5: { status: loading ? 'active' : 'done', stat: loading ? '加载本地 SF2...' : file.name.slice(0, 18) },
            },
          }));
        });
        const id = `custom_${file.name}`;
        set((s) => ({
          activeTimbreId: id,
          timbreDesc: `本地导入 SoundFont2 (${file.name}, ${(file.size / 1e6).toFixed(1)} MB) · 琴弦共鸣 + 音乐厅卷积`,
          customTimbres: s.customTimbres.some((c) => c.id === id)
            ? s.customTimbres
            : [...s.customTimbres, { id, name: `${name} (本地 SF2)` }],
        }));
        if (wasPlaying) {
          set({ isPlaying: true });
          void pianoPlayer.play(curT, () => set({ isPlaying: false }));
        }
      } catch (err) {
        set({ errorMsg: `本地 SF2 加载失败: ${(err as Error).message}` });
      }
    },

    switchHallIr: async (hallId) => {
      set({ activeHallId: hallId });
      try {
        await pianoPlayer.loadHallIr(hallId);
      } catch (err) {
        console.error('IR 加载失败:', err);
      }
    },

    setReverbWet: (v) => {
      set({ reverbWet: v });
      pianoPlayer.setReverbWet(v);
    },

    setResonanceAmount: (v) => {
      set({ resonanceAmount: v });
      pianoPlayer.setResonanceAmount(v);
    },

    getActiveTrackData: () => {
      const st = get();
      if (st.liveActive && liveSessionRef) {
        const dur = liveSessionRef.committedNotes.reduce((mx, n) => Math.max(mx, n.s + n.d), 0);
        return { notes: liveSessionRef.committedNotes, duration: dur };
      }
      const tk = st.takes.find((t) => t.id === st.activeTakeId) ?? st.takes[0];
      if (st.activeTrack === 'score' || !tk) {
        return { notes: st.scoreNotes, duration: st.scoreDuration };
      }
      if (st.activeTrack === 'pianoflow_raw') {
        return { notes: tk.rawNotes, duration: tk.rawDuration };
      }
      return { notes: tk.restoredNotes, duration: tk.restoredDuration };
    },

    selectTake: (id) => {
      const st = get();
      if (!st.takes.some((t) => t.id === id)) return;
      set({ activeTakeId: id });
      get().selectTrack(st.activeTrack);
    },

    selectTrack: (track) => {
      const st = get();
      const wasPlaying = pianoPlayer.isPlaying && !st.liveActive;
      const curT = pianoPlayer.getCurrentTime();
      if (wasPlaying) pianoPlayer.pause();
      set({ activeTrack: track });
      if (!st.liveActive) {
        const tr = get().getActiveTrackData();
        pianoPlayer.setTrack(tr.notes, tr.duration);
        const clamped = Math.min(curT, tr.duration);
        pianoPlayer.seek(clamped);
        if (wasPlaying) {
          set({ isPlaying: true });
          void pianoPlayer.play(clamped, () => set({ isPlaying: false }));
        }
      }
    },

    runFullPipeline: async () => {
      const st = get();
      const score = useScoreStore.getState();
      const lyCode = score.lyCode.trim();
      if (!lyCode || st.busy || score.loading || score.error) return;
      if (st.liveActive) st.stopLiveConductor(false);

      pianoPlayer.stop(true);
      set({
        busy: true,
        isPlaying: false,
        errorMsg: '',
        progressMsg: '准备编译乐谱...',
        progressPct: 4,
        stages: {
          ...st.stages,
          st1: { status: 'active', stat: 'WASM 编译中...' },
          st2: { status: 'active', stat: 'Scheme 监听中...' },
          st3: { status: 'active', stat: '等待 MIDI...' },
          st4: { status: 'active', stat: '等待 AI...' },
        },
      });

      try {
        const controller = new AbortController();
        let compileProgress = 0;
        let modelProgress = 0;
        const report = (msg: string) => set({
          progressMsg: msg,
          progressPct: 4 + compileProgress * 0.7 + modelProgress * 0.28,
        });
        const compileStarted = performance.now();
        const compile = lilypondEngine.compile(lyCode, (msg, pct) => {
          compileProgress = pct ?? compileProgress;
          report(msg);
        }).then(compiled => {
          performance.measure('pianora:score-compile', { start: compileStarted });
          set(s => ({
            wasmReady: true,
            wasmStatus: 'LilyPond WASM 就绪',
            stages: {
              ...s.stages,
              st1: { status: 'done', stat: `${compiled.compileSec}s · ${compiled.svgPages.length} 页 SVG` },
              st2: { status: 'done', stat: `提取 ${compiled.rawAnnotations.length} 条事件` },
            },
          }));
          return compiled;
        }).catch(error => { controller.abort(); throw error; });
        const model = pianoFlowEngine.load((msg, pct) => {
          if (pct === modelProgress) return;
          modelProgress = pct ?? modelProgress;
          report(msg);
        }, controller.signal).then(() => {
          set({ ortReady: true, ortStatus: `PianoFlow (${pianoFlowEngine.provider}) 就绪` });
        });
        // Let both jobs settle before allowing a retry or another generation.
        const [scoreResult, modelResult] = await Promise.allSettled([compile, model]);
        if (scoreResult.status === 'rejected') throw scoreResult.reason;
        if (modelResult.status === 'rejected') throw modelResult.reason;
        const compiled = scoreResult.value;

        const { cfmSteps, stepFactor, seed, batchCount } = get();
        const t3 = performance.now();
        const generated = [];
        for (let b = 0; b < batchCount; b++) {
          const sd = seed + b;
          const out = await pianoFlowEngine.performScore(compiled.scoreMidi, {
            cfmSteps,
            stepFactor,
            seed: sd,
            onProgress: (done, total) => {
              const pct = total ? Math.round(((b + done / total) / batchCount) * 100) : 100;
              set((s) => ({
                progressMsg: `Stage 3/5: PianoFlow (${pianoFlowEngine.provider}) 第 ${b + 1}/${batchCount} 版 (Seed ${sd}) ${done}/${total}`,
                progressPct: 52 + pct * 0.43,
                stages: { ...s.stages, st3: { status: 'active', stat: `${b + 1}/${batchCount} · ${pianoFlowEngine.provider}` } },
              }));
            },
          });
          generated.push({ seed: sd, out });
        }
        const dt3 = ((performance.now() - t3) / 1000).toFixed(2);

        // Stage 4: Symbolic Arpeggio Restoration
        set({ progressMsg: 'Stage 4/5: 正在执行符号级琶音精准还原...', progressPct: 97 });
        const t4 = performance.now();
        const firstOut = generated[0].out;
        const totalBars = firstOut.perfState.scoreData.totalBars;

        set({
          performanceTitle: lyCode.match(/^\s*title\s*=\s*"([^"\n]+)"/m)?.[1] || '自定义乐谱',
          scoreMidi: compiled.scoreMidi,
          scoreNotes: firstOut.scoreNotes,
          scoreDuration: firstOut.scoreDuration,
          rawAnnotations: compiled.rawAnnotations,
          svgPages: compiled.svgPages,
          totalBars,
          cues: defaultCuesForBars(totalBars),
        });

        const takes = generated.map((item, idx) =>
          buildTake(`take_${Date.now()}_${idx}`, `#${idx + 1} 演奏 (Seed ${item.seed})`, item.seed, item.out.perfState),
        );
        const dt4 = (performance.now() - t4).toFixed(1);

        set((s) => ({
          takes,
          activeTakeId: takes[0].id,
          activeTrack: 'final_restored',
          stages: {
            ...s.stages,
            st3: { status: 'done', stat: `${dt3}s · ${batchCount} 版` },
            st4: { status: 'done', stat: `${dt4} ms · ${takes[0].arpeggios.length} 处琶音` },
          },
          progressMsg: `全部 5 阶段纯浏览器完成！(${compiled.compileSec}s 编译 + ${dt3}s AI × ${batchCount}版 + ${dt4}ms 还原)`,
          progressPct: 100,
        }));

        pianoPlayer.setTrack(takes[0].restoredNotes, takes[0].restoredDuration);
        pianoPlayer.seek(0);
      } catch (err) {
        console.error(err);
        set((s) => ({
          errorMsg: (err as Error).message || String(err),
          stages: {
            ...s.stages,
            st1: s.stages.st1.status === 'active' ? { status: 'idle', stat: '失败' } : s.stages.st1,
            st2: s.stages.st2.status === 'active' ? { status: 'idle', stat: '中止' } : s.stages.st2,
            st3: s.stages.st3.status === 'active' ? { status: 'idle', stat: '中止' } : s.stages.st3,
            st4: s.stages.st4.status === 'active' ? { status: 'idle', stat: '中止' } : s.stages.st4,
          },
        }));
      } finally {
        set({ busy: false });
      }
    },

    togglePlay: () => {
      const st = get();
      if (st.liveActive) {
        st.stopLiveConductor(false);
        return;
      }
      if (pianoPlayer.isPlaying) {
        pianoPlayer.pause();
        set({ isPlaying: false });
      } else {
        set({ isPlaying: true });
        void pianoPlayer.play(undefined, () => set({ isPlaying: false }));
      }
    },

    playFrom: (sec) => {
      if (get().liveActive) return;
      set({ isPlaying: true });
      void pianoPlayer.play(sec, () => set({ isPlaying: false }));
    },

    stopPlayback: () => {
      if (get().liveActive) {
        get().stopLiveConductor(false);
        return;
      }
      pianoPlayer.stop(true);
      set({ isPlaying: false });
    },

    seekTo: (sec) => {
      if (get().liveActive) return;
      pianoPlayer.seek(sec);
    },

    downloadMidi: () => {
      const st = get();
      if (!st.scoreMidi) return;
      const tr = st.getActiveTrackData();
      const bytes = notesToMidiBytes(tr.notes, st.activeTrack);
      const blob = new Blob([bytes as BlobPart], { type: 'audio/midi' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pianora_${st.activeTrack}.mid`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    },

    exportWav: async () => {
      const st = get();
      if (!st.scoreMidi || st.exportingWav) return;
      set({ exportingWav: true, errorMsg: '' });
      try {
        const tr = st.getActiveTrackData();
        const blob = await pianoPlayer.renderOfflineWav(tr.notes, tr.duration, st.reverbWet, st.resonanceAmount);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `pianora_${st.activeTrack}.wav`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      } catch (e) {
        set({ errorMsg: `WAV 导出失败: ${(e as Error).message}` });
      } finally {
        set({ exportingWav: false });
      }
    },

    // =========================================================================
    // 7 Advanced PianoFlow Modes
    // =========================================================================
    runMode1Batch: async (count, startSeed) => {
      await runGuardedMode(`玩法 ① 批量盲盒抽卡 (${count} 版)`, async () => {
        const st = get();
        const t0 = performance.now();
        const added: TakeRecord[] = [];
        for (let i = 0; i < count; i++) {
          const sd = startSeed + i;
          const res = await pianoFlowEngine.performScore(st.scoreMidi!, {
            cfmSteps: st.cfmSteps,
            stepFactor: st.stepFactor,
            seed: sd,
            onProgress: (d, tot) => {
              const pct = Math.round(((i + (tot ? d / tot : 1)) / count) * 100);
              set({ progressMsg: `批量抽卡：第 ${i + 1}/${count} 版 (Seed ${sd}) ${pct}%`, progressPct: pct });
            },
          });
          added.push(buildTake(`m1_${Date.now()}_${i}`, `抽卡 (Seed ${sd})`, sd, res.perfState));
        }
        const last = added[added.length - 1];
        set((s) => ({
          takes: [...s.takes, ...added],
          progressMsg: `玩法 ① 完成！新增 ${count} 版进入版本池 (${((performance.now() - t0) / 1000).toFixed(2)}s)`,
          progressPct: 100,
        }));
        get().selectTake(last.id);
      });
    },

    runMode2Continuation: async (lockBarsRaw, count, startSeed) => {
      await runGuardedMode(`玩法 ② 锁前 ${lockBarsRaw} 小节续弹 (${count} 版)`, async () => {
        const st = get();
        const baseTake = st.takes.find((t) => t.id === st.activeTakeId) ?? st.takes[0];
        if (!baseTake) return;
        const lockBars = Math.max(1, Math.min(st.totalBars - 1, lockBarsRaw));
        const t0 = performance.now();
        const scoreData = baseTake.perfState.scoreData;
        const N = scoreData.noteCount;
        const mask = new Uint8Array(N * 4);
        let unlocked = 0;
        for (let i = 0; i < N; i++) {
          const u = scoreData.noteBars[i] > lockBars ? 1 : 0;
          if (u) unlocked++;
          for (let j = 0; j < 4; j++) mask[i * 4 + j] = u;
        }
        if (unlocked === 0) throw new Error('所有小节都已被锁死，请调小锁死小节数。');

        const added: TakeRecord[] = [];
        for (let k = 0; k < count; k++) {
          const sd = startSeed + k;
          const res = await pianoFlowEngine.performScore(st.scoreMidi!, {
            cfmSteps: st.cfmSteps,
            stepFactor: st.stepFactor,
            seed: sd,
            baseState: clonePerfState(baseTake.perfState),
            maskMatrix: mask,
            onProgress: (d, tot) => {
              const pct = Math.round(((k + (tot ? d / tot : 1)) / count) * 100);
              set({ progressMsg: `锁 1–${lockBars} 小节续弹：第 ${k + 1}/${count} 版 (${pct}%)`, progressPct: pct });
            },
          });
          added.push(buildTake(`m2_${Date.now()}_${k}`, `锁1–${lockBars}续弹 #${k + 1}`, sd, res.perfState));
        }
        const last = added[added.length - 1];
        set((s) => ({
          takes: [...s.takes, ...added],
          progressMsg: `玩法 ② 完成！保留 1–${lockBars} 小节，重抽后面 ${count} 版 (${((performance.now() - t0) / 1000).toFixed(2)}s)`,
          progressPct: 100,
        }));
        get().selectTake(last.id);
      });
    },

    runMode3Inpainting: async (sBarRaw, eBarRaw, seed) => {
      await runGuardedMode(`玩法 ③ 双向局部重弹 (第 ${sBarRaw}–${eBarRaw} 小节)`, async () => {
        const st = get();
        const baseTake = st.takes.find((t) => t.id === st.activeTakeId) ?? st.takes[0];
        if (!baseTake) return;
        const sBar = Math.max(1, Math.min(st.totalBars, sBarRaw));
        const eBar = Math.max(sBar, Math.min(st.totalBars, eBarRaw));
        const t0 = performance.now();
        const scoreData = baseTake.perfState.scoreData;
        const N = scoreData.noteCount;
        const mask = new Uint8Array(N * 4);
        let cnt = 0;
        for (let i = 0; i < N; i++) {
          const inside = scoreData.noteBars[i] >= sBar && scoreData.noteBars[i] <= eBar ? 1 : 0;
          if (inside) cnt++;
          for (let j = 0; j < 4; j++) mask[i * 4 + j] = inside;
        }
        if (cnt === 0) throw new Error(`第 ${sBar}–${eBar} 小节内未找到音符`);

        const res = await pianoFlowEngine.performScore(st.scoreMidi!, {
          cfmSteps: st.cfmSteps,
          stepFactor: st.stepFactor,
          seed,
          baseState: clonePerfState(baseTake.perfState),
          maskMatrix: mask,
          onProgress: (d, tot) => set({ progressMsg: `双向缝合第 ${sBar}–${eBar} 小节 (${d}/${tot})`, progressPct: (d / Math.max(1, tot)) * 100 }),
        });
        const tk = buildTake(`m3_${Date.now()}`, `重绘 ${sBar}–${eBar} 小节`, seed, res.perfState);
        set((s) => ({
          takes: [...s.takes, tk],
          progressMsg: `玩法 ③ 完成！已双向缝合第 ${sBar}–${eBar} 小节 (${cnt} 音，${((performance.now() - t0) / 1000).toFixed(2)}s)`,
          progressPct: 100,
        }));
        get().selectTake(tk.id);
      });
    },

    runMode4Dimensions: async (dims, sBarRaw, eBarRaw, seed) => {
      if (dims.every((x) => !x)) {
        set({ errorMsg: '请至少勾选 1 个要重算的演奏维度' });
        return;
      }
      const dimNames = ['力度', '呼吸', '触键', '踏板'].filter((_, i) => dims[i]).join('+');
      await runGuardedMode(`玩法 ④ 拆维度精修 (${dimNames})`, async () => {
        const st = get();
        const baseTake = st.takes.find((t) => t.id === st.activeTakeId) ?? st.takes[0];
        if (!baseTake) return;
        const sBar = Math.max(1, Math.min(st.totalBars, sBarRaw));
        const eBar = Math.max(sBar, Math.min(st.totalBars, eBarRaw));
        const t0 = performance.now();
        const scoreData = baseTake.perfState.scoreData;
        const N = scoreData.noteCount;
        const mask = new Uint8Array(N * 4);
        for (let i = 0; i < N; i++) {
          const inRange = scoreData.noteBars[i] >= sBar && scoreData.noteBars[i] <= eBar;
          for (let j = 0; j < 4; j++) mask[i * 4 + j] = inRange && dims[j] ? 1 : 0;
        }
        const res = await pianoFlowEngine.performScore(st.scoreMidi!, {
          cfmSteps: st.cfmSteps,
          stepFactor: st.stepFactor,
          seed,
          baseState: clonePerfState(baseTake.perfState),
          maskMatrix: mask,
          onProgress: (d, tot) => set({ progressMsg: `拆维度重算 [${dimNames}] (${d}/${tot})`, progressPct: (d / Math.max(1, tot)) * 100 }),
        });
        const tk = buildTake(`m4_${Date.now()}`, `仅修${dimNames}`, seed, res.perfState);
        set((s) => ({
          takes: [...s.takes, tk],
          progressMsg: `玩法 ④ 完成！锁定其余维度，仅重算「${dimNames}」(${((performance.now() - t0) / 1000).toFixed(2)}s)`,
          progressPct: 100,
        }));
        get().selectTake(tk.id);
      });
    },

    setCues: (cues) => set({ cues }),
    resetDefaultCues: () => set((s) => ({ cues: defaultCuesForBars(Math.max(4, s.totalBars)) })),

    runMode5Conductor: async (seed) => {
      const cues = get().cues;
      if (!cues.length) {
        set({ errorMsg: '请先添加至少 1 个指挥段落' });
        return;
      }
      await runGuardedMode(`玩法 ⑤ 分段指挥家 (${cues.length} 段引导)`, async () => {
        const st = get();
        const t0 = performance.now();
        const res = await pianoFlowEngine.performScore(st.scoreMidi!, {
          cfmSteps: st.cfmSteps,
          stepFactor: st.stepFactor,
          seed,
          cues,
          onProgress: (d, tot) => set({ progressMsg: `分段指挥 Flow 引导 (${d}/${tot})`, progressPct: (d / Math.max(1, tot)) * 100 }),
        });
        const tk = buildTake(`m5_${Date.now()}`, `指挥家 (${cues.length}段)`, seed, res.perfState);
        set((s) => ({
          takes: [...s.takes, tk],
          progressMsg: `玩法 ⑤ 完成！已按 ${cues.length} 段指挥曲线生成 (${((performance.now() - t0) / 1000).toFixed(2)}s)`,
          progressPct: 100,
        }));
        get().selectTake(tk.id);
      });
    },

    startLiveConductor: async () => {
      const st = get();
      if (!st.scoreMidi || st.liveActive) return;
      if (!pianoPlayer.ready) {
        set({ errorMsg: '钢琴音色正在加载中，请稍等 1 秒再启动实时指挥。' });
        return;
      }
      pianoPlayer.stop(true);
      liveSessionRef = pianoFlowEngine.createLiveSession(st.scoreMidi, {
        seed: Math.floor(Math.random() * 9000) + 100,
        cfmSteps: 5,
        tempoScale: st.liveTempo,
        velOffset: st.liveVel,
      });
      set({ liveActive: true, isPlaying: true, liveStatus: '正在预热首段 0.8s 实时滑动缓冲...' });

      while (get().liveActive && liveSessionRef && !liveSessionRef.finished && liveSessionRef.getBufferHeadTime() < 0.9) {
        await liveSessionRef.generateNextChunk(10);
      }
      if (!get().liveActive || !liveSessionRef) return;

      await pianoPlayer.startLiveStream(liveSessionRef.committedNotes, () => {
        if (get().liveActive) get().stopLiveConductor(true);
      });
      if (liveSessionRef.finished) {
        const finalDur = liveSessionRef.committedNotes.reduce((mx, n) => Math.max(mx, n.s + n.d), 0);
        pianoPlayer.finishLiveStream(finalDur);
      }
      set({ liveStatus: `实时指挥中！随时拖动滑块 · 单块推理 ${liveSessionRef.lastChunkMs} ms` });

      liveLoopTimer = window.setInterval(async () => {
        if (!get().liveActive || !liveSessionRef) return;
        const curT = pianoPlayer.getCurrentTime();
        const headT = liveSessionRef.getBufferHeadTime();
        const idx = Math.min(liveSessionRef.scoreData.noteCount - 1, Math.max(0, liveSessionRef.generatedNoteCount - 1));
        const curBar = liveSessionRef.scoreData.noteBars[idx] || 1;
        if (!liveSessionRef.finished && headT < curT + 1.1) {
          const added = await liveSessionRef.generateNextChunk(10);
          if (added.length && get().liveActive && liveSessionRef) {
            pianoPlayer.hotReplaceNotes(liveSessionRef.committedNotes, liveSessionRef.finished ? headT + 1.0 : 9999);
            if (liveSessionRef.finished) {
              const finalDur = liveSessionRef.committedNotes.reduce((mx, n) => Math.max(mx, n.s + n.d), 0);
              pianoPlayer.finishLiveStream(finalDur);
            }
            set({
              liveStatus: `实时指挥中 · 缓冲至第 ${curBar}/${liveSessionRef.scoreData.totalBars} 小节 · 响应 ${liveSessionRef.lastChunkMs} ms`,
            });
          }
        }
      }, 90);
    },

    updateLiveControls: async (tempo, vel) => {
      set({ liveTempo: tempo, liveVel: vel });
      if (!get().liveActive || !liveSessionRef) return;
      liveSessionRef.tempoScale = tempo;
      liveSessionRef.velOffset = vel;
      const curT = pianoPlayer.getCurrentTime();
      liveSessionRef.dropFutureAfter(curT + 0.25);
      set({ liveStatus: `已丢弃 0.25s 后缓存，实时重算新表情 (${tempo.toFixed(2)}x / ${vel >= 0 ? '+' : ''}${vel})...` });
      const added = await liveSessionRef.generateNextChunk(10);
      if (added.length && get().liveActive && liveSessionRef) {
        pianoPlayer.hotReplaceNotes(
          liveSessionRef.committedNotes,
          liveSessionRef.finished ? liveSessionRef.getBufferHeadTime() + 1.0 : 9999,
        );
        set({
          liveStatus: `已响应手势 (${liveSessionRef.lastChunkMs} ms) · 当前 ${tempo.toFixed(2)}x / ${vel >= 0 ? '+' : ''}${vel}`,
        });
      }
    },

    stopLiveConductor: (saveTake = true) => {
      if (liveLoopTimer !== null) {
        window.clearInterval(liveLoopTimer);
        liveLoopTimer = null;
      }
      const sess = liveSessionRef;
      liveSessionRef = null;
      pianoPlayer.stop(true);
      set({ liveActive: false, isPlaying: false });

      if (saveTake && sess && get().scoreMidi && sess.generatedNoteCount >= sess.scoreData.noteCount) {
        const tk = buildTake(`m6_${Date.now()}`, '实时指挥实录', 77, sess.toPerfState());
        set((s) => ({
          takes: [...s.takes, tk],
          liveStatus: `实时指挥实录已保存到版本池！(共 ${sess.generatedNoteCount} 音)`,
        }));
        get().selectTake(tk.id);
      } else if (sess) {
        set({ liveStatus: `已停止实时指挥（已实时演奏 ${sess.generatedNoteCount}/${sess.scoreData.noteCount} 音）` });
      }
    },

    loadRefMasterFile: async (file) => {
      try {
        const ab = await file.arrayBuffer();
        const midi = new Midi(ab);
        const label = file.name.replace(/\.(mid|midi)$/i, '');
        const noteCnt = midi.tracks.reduce((acc, t) => acc + t.notes.length, 0);
        set({
          refMasterMidi: midi,
          refMasterLabel: label,
          m7Status: `已载入参考演奏「${file.name}」(${noteCnt} 音) — 点击「对齐并开始大师接力」`,
        });
      } catch (err) {
        set({ errorMsg: `MIDI 读取失败: ${(err as Error).message}` });
      }
    },

    loadBuiltinMasterDemo: (style) => {
      const midi = get().scoreMidi;
      if (!midi) return;
      const demo = synthesizeRomanticDemoMidi(midi, style);
      if (style === 'debussy_poetic') {
        set({
          refMasterMidi: demo,
          refMasterLabel: '浪漫诗意大师',
          m7Status: '已载入「浪漫诗意大师引子」（舒缓呼吸 + 歌唱性高声部 + 绵长踏板）— 点击右侧开始接力',
        });
      } else {
        set({
          refMasterMidi: demo,
          refMasterLabel: '戏剧炫技大师',
          m7Status: '已载入「戏剧炫技大师引子」（紧凑推进 + 强对比触键）— 点击右侧开始接力',
        });
      }
    },

    runMode7MasterRelay: async (prefixBarsRaw, seed) => {
      const { refMasterMidi, refMasterLabel } = get();
      if (!refMasterMidi) return;
      await runGuardedMode(`玩法 ⑦ 大师风格接力 (${refMasterLabel})`, async () => {
        const st = get();
        const t0 = performance.now();
        if (!pianoFlowEngine.meta) await pianoFlowEngine.load();
        const prefixBars = Math.max(1, Math.min(st.totalBars - 1, prefixBarsRaw));
        const report = alignPerformanceMidiToScore(st.scoreMidi!, refMasterMidi, prefixBars, pianoFlowEngine.meta!);
        set({
          m7Status: `DP 对齐完成：前 ${report.prefixBars} 小节匹配 ${report.alignedCount}/${report.prefixNoteCount} 音 (${Math.round(
            report.matchRate * 100,
          )}%) · 均力 ${report.avgVel} / 相对速度 ${report.avgTempoRatio}x → PianoFlow 接力续弹中...`,
        });

        const res = await pianoFlowEngine.performScore(st.scoreMidi!, {
          cfmSteps: st.cfmSteps,
          stepFactor: st.stepFactor,
          seed,
          baseState: report.baseState,
          maskMatrix: report.maskMatrix,
          onProgress: (d, tot) => set({ progressMsg: `大师风格接力续弹 (${d}/${tot})`, progressPct: (d / Math.max(1, tot)) * 100 }),
        });

        const tk = buildTake(`m7_${Date.now()}`, `${refMasterLabel.slice(0, 6)}接力(前${prefixBars}小节)`, seed, res.perfState);
        const dt = ((performance.now() - t0) / 1000).toFixed(2);
        set((s) => ({
          takes: [...s.takes, tk],
          m7Status: `接力完成 (${dt}s)！前 ${report.prefixBars} 小节锁死「${refMasterLabel}」(匹配 ${Math.round(
            report.matchRate * 100,
          )}%)，后续全曲已顺着大师风格续弹`,
          progressMsg: `玩法 ⑦ 大师风格接力完成！(${dt}s)`,
          progressPct: 100,
        }));
        get().selectTake(tk.id);
      });
    },
  };
});

function specShort(id: string): string {
  return PIANO_PRESETS.find((p) => p.id === id)?.shortName ?? 'SF2 Grand';
}

useStudioStore.subscribe((state, previous) => {
  if (state.busy !== previous.busy) useScoreStore.setState({ pipelineBusy: state.busy });
});
