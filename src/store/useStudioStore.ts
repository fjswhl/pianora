import { modelNames, takeModelNames, type Pedal } from '../engine/performance/types';
import { modelScore, renderLocal } from '../engine/performance/client';
import { setPianoFlowPreload } from '../engine/assetPacks';
import { withSustain } from '../engine/performance/playback';
import type { WrittenChord } from '../engine/harmony';
import { errorText, LocalizedError, t, message, type DisplayText } from '../i18n';
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
import { importedSheetLoader } from '../engine/importedSheet';
import { parseDirectScoreFile, isDirectScoreFile } from '../engine/scoreImport';
import { rememberGeneration, getGeneration, getGenerationPages, storeGenerationPages } from './generationHistory';

import type { SavedNotation } from '../engine/savedNotation';
import { readFollowScore } from '../engine/followScore';
import { finalTakeMidi } from '../engine/takeMidi';

export type TrackKey = 'score' | 'pianoflow_raw' | 'final_restored';
export type StageStatus = 'idle' | 'active' | 'done';

export interface TakeRecord {
  id: string;
  label: DisplayText;
  subtitle: DisplayText;
  seed: number;
  model: keyof typeof takeModelNames;
  scoreClock?: SavedNotation['clock'];
  finalMidi?: Uint8Array<ArrayBuffer>;
  perfState?: PerfState;
  midi?: { raw: SimpleNote[]; restored: SimpleNote[]; pedals: Pedal[] };
  rawNotes: SimpleNote[];
  rawDuration: number;
  restoredNotes: SimpleNote[];
  restoredDuration: number;
  arpeggios: RestoredArpeggioInfo[];
}

export interface CustomTimbreItem {
  file: File;
  id: string;
  name: string;
}

export function fmtTime(sec: number): string {
  sec = Math.max(0, sec || 0);
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function summarizeNotes(notes: SimpleNote[]): DisplayText {
  if (!notes.length) return message("0 音");
  let sumV = 0;
  let minV = 127;
  let maxV = 0;
  for (const n of notes) {
    sumV += n.v;
    if (n.v < minV) minV = n.v;
    if (n.v > maxV) maxV = n.v;
  }
  return message("均力 {0} ({1}–{2})", Math.round(sumV / notes.length), minV, maxV);
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
let generationController: AbortController | null = null;
let liveSessionRef: LiveConductorSession | null = null;
let liveLoopTimer: number | null = null;

export function getLiveSession(): LiveConductorSession | null {
  return liveSessionRef;
}

export interface StudioState {
  historyWarning: DisplayText;
  openPerformanceMidi: (bytes: Uint8Array<ArrayBuffer>, title: string, label: string | null, notation?: SavedNotation) => void;
  openGeneration: (id: number) => Promise<boolean>;
  // Engine status pills
  wasmReady: boolean;
  wasmStatus: DisplayText;
  ortReady: boolean;
  ortStatus: DisplayText;
  pianoReady: boolean;
  pianoLoading: boolean;
  pianoStatus: DisplayText;

  // Audio controls
  activeTimbreId: string;
  timbreDesc: DisplayText;
  customTimbres: CustomTimbreItem[];
  activeHallId: string;
  reverbWet: number;
  resonanceAmount: number;
  isPlaying: boolean;
  exportingWav: boolean;

  // Score & Pipeline params
  performanceTitle: DisplayText;
  savedNotation: SavedNotation | null;
  performanceSource: File | null;
  model: keyof typeof modelNames;
  dexSteps: number;
  setModel: (model: keyof typeof modelNames) => void;
  setDexSteps: (steps: number) => void;
  cancelGeneration: () => void;
  activeMidi: (track?: TrackKey) => Uint8Array;
  cfmSteps: number;
  stepFactor: number;
  seed: number;
  batchCount: number;
  arpMs: number;

  // Pipeline execution
  busy: boolean;
  progressMsg: DisplayText;
  progressPct: number;
  errorMsg: DisplayText;
  stages: Record<'st1' | 'st2' | 'st3' | 'st4' | 'st5', { status: StageStatus; stat: DisplayText }>;

  // Compiled score & Takes pool
  scoreMidi: Midi | null;
  writtenChords: WrittenChord[];
  scoreNotes: SimpleNote[];
  scoreDuration: number;
  rawAnnotations: RawArpeggioAnnotation[];
  midiNotation: boolean;
  loadSheetPages: (() => Promise<string[]>) | null;
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
  liveStatus: DisplayText;

  // Mode 7 Master Style Relay
  refMasterMidi: Midi | null;
  refMasterLabel: DisplayText;
  m7Status: DisplayText;

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
  const buildTake = (id: string, label: DisplayText, seed: number, perfState: PerfState): TakeRecord => {
    const st = get();
    const decoded = decodePerfState(perfState);
    const fixed = restoreArpeggios(st.scoreMidi!, decoded.perfSustainNotes, st.rawAnnotations, st.arpMs);
    return {
      id,
      label,
      subtitle: message("{0} · {1}", fmtTime(fixed.duration), summarizeNotes(fixed.notes)),
      seed,
      model: 'pianoflow',
      perfState,
      rawNotes: decoded.perfSustainNotes,
      rawDuration: decoded.perfDuration,
      restoredNotes: fixed.notes,
      restoredDuration: fixed.duration,
      arpeggios: fixed.arpeggios,
    };
  };

  const remember = async (takes: TakeRecord[]) => {
    try {
      await rememberGeneration(get(), takes);
      set({ historyWarning: '' });
      window.dispatchEvent(new Event('pianora:history'));
    } catch {
      set({ historyWarning: message("演奏已生成，但浏览器未能保存本次记录。") });
    }
  };

  const runGuardedMode = async (title: DisplayText, fn: () => Promise<void>) => {
    const st = get();
    if (!st.scoreMidi || st.busy) return;
    if (st.liveActive) st.stopLiveConductor(false);
    set({ busy: true, errorMsg: '', progressMsg: message("{0}…", title), progressPct: 12 });
    try {
      await fn();
      const added = get().takes.slice(st.takes.length);
      if (added.length) await remember(added);
    } catch (err) {
      console.error(err);
      set({ errorMsg: errorText(err) });
    } finally {
      set({ busy: false });
    }
  };

  return {
    historyWarning: '',
    openPerformanceMidi: (bytes, title, label, notation) => {
      const st = get();
      if (st.busy || st.liveActive) throw new LocalizedError("请在当前演奏生成结束后试听。");
      const midi = new Midi(bytes);
      const notes = midi.tracks.filter(track => track.channel !== 9).flatMap(track => {
        const strikes = track.notes.map(n => ({p:n.midi, s:n.time, d:n.duration, v:Math.round(n.velocity*127)}));
        const pedal = (track.controlChanges[64] ?? []).map(cc => ({
          number:64 as const, time:cc.time, value:Math.round(cc.value*127),
        }));
        return withSustain(strikes, pedal);
      }).sort((a,b) => a.s-b.s);
      if (!notes.length) throw new LocalizedError("无法打开这份演奏 MIDI。");
      const duration = notes.reduce((end,n) => Math.max(end, n.s+n.d),0);
      const scoreMidi = notation ? new Midi() : midi;
      if (notation) scoreMidi.fromJSON(notation.score);
      const source = new File([bytes], title+'.mid', {type:'audio/midi'});
      const take: TakeRecord = {
        id:crypto.randomUUID(), model:'midi', label:label || message("最终演奏"), subtitle:fmtTime(duration),
        seed:0, scoreClock:notation?.clock, finalMidi:bytes, rawNotes:notes, rawDuration:duration, restoredNotes:notes,
        restoredDuration:duration, arpeggios:[],
      };
      pianoPlayer.stop(true);
      pianoPlayer.setTrack(notes, duration);
      pianoPlayer.seek(0);
      const lastTick = midi.tracks.reduce((last, track) => Math.max(last, track.notes.at(-1)?.ticks ?? 0),0);
      set({ performanceTitle:title, performanceSource:null, savedNotation:notation ?? null, scoreMidi, scoreNotes:notes,
        scoreDuration:duration, totalBars:notation?.bars ?? (1 + Math.floor(midi.header.ticksToMeasures(lastTick))),
        takes:[take], activeTakeId:take.id, activeTrack:'final_restored', rawAnnotations:[], writtenChords:notation?.writtenChords ?? [],
        loadSheetPages:notation ? async () => notation.pages : importedSheetLoader({midiFile:source, title, composer:''}),
        midiNotation:notation?.midiNotation ?? true,
        isPlaying:false, progressMsg:'', progressPct:100, errorMsg:'' });
      if (!st.pianoReady && !st.pianoLoading) void st.switchTimbre(st.activeTimbreId);
    },
    openGeneration: async id => {
      const previous = get();
      if (previous.busy || previous.liveActive || previous.exportingWav) return false;
      set({ busy: true, errorMsg: '', progressMsg: message("正在打开演奏…") });
      try {
        const saved = await getGeneration(id);
        if (!saved) throw new LocalizedError("这条生成记录已不可用。");
        const { score, mixer, ...session } = saved;
        const scoreMidi = new Midi();
        scoreMidi.fromJSON(score);
        const source = session.performanceSource;
        let pending: Promise<string[]> | undefined;
        const loadPages = async () => {
          const cached = await getGenerationPages(id).catch(() => undefined);
          // MusicXML geometry is registered in memory by OSMD and older page caches lack it.
          if (cached && (!isDirectScoreFile(source.name) || readFollowScore(cached).rows.length)) return cached;
          const loader = isDirectScoreFile(source.name)
            ? importedSheetLoader(await parseDirectScoreFile(source))
            : lilypondEngine.sheetLoader(await source.text());
          const pages = await loader();
          void storeGenerationPages(id, pages).catch(() => {});
          return pages;
        };
        const take = session.takes.find(item => item.id === session.activeTakeId)!;
        pianoPlayer.stop(true);
        pianoPlayer.setTrack(take.restoredNotes, take.restoredDuration);
        pianoPlayer.seek(0);
        set({
          ...session, savedNotation:null, scoreMidi, isPlaying: false, activeTrack: 'final_restored',
          loadSheetPages: () => pending ??= loadPages().catch(e => { pending = undefined; throw e; }),
          stages: { ...session.stages, st5: get().stages.st5 }, progressMsg: '', progressPct: 100,
        });
        get().setReverbWet(mixer.reverbWet);
        get().setResonanceAmount(mixer.resonanceAmount);
        if (mixer.activeHallId !== previous.activeHallId) await get().switchHallIr(mixer.activeHallId);
        if (mixer.customFile) await get().importCustomSf2(mixer.customFile);
        else if (!pianoPlayer.ready || pianoPlayer.activePresetId !== mixer.activeTimbreId)
          await get().switchTimbre(mixer.activeTimbreId);
        return true;
      } catch (error) {
        set({ errorMsg: errorText(error) });
        return false;
      } finally { set({ busy: false }); }
    },

    wasmReady: false,
    wasmStatus: message("LilyPond WASM 待命"),
    ortReady: false,
    ortStatus: message("PianoFlow ONNX 待加载"),
    pianoReady: false,
    pianoLoading: false,
    pianoStatus: message("钢琴音色待加载"),

    activeTimbreId: DEFAULT_TIMBRE_ID,
    timbreDesc: () => DEFAULT_TIMBRE.desc,
    customTimbres: [],
    activeHallId: HALL_IR_PRESETS[0].id,
    reverbWet: 0.28,
    resonanceAmount: 0.55,
    isPlaying: false,
    exportingWav: false,

    savedNotation: null,
    performanceSource: null,
    performanceTitle: '',
    model: 'pianoflow',
    setModel: model => {
      if (get().busy) return;
      setPianoFlowPreload(model === 'pianoflow');
      set({ model });
    },
    dexSteps: 32,
    setDexSteps: dexSteps => set({ dexSteps }),
    cancelGeneration: () => generationController?.abort(new LocalizedError("已取消生成")),
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
      st1: { status: 'idle', stat: message("待运行") },
      st2: { status: 'idle', stat: message("待运行") },
      st3: { status: 'idle', stat: message("待运行") },
      st4: { status: 'idle', stat: message("待运行") },
      st5: { status: 'idle', stat: () => DEFAULT_TIMBRE.shortName },
    },

    scoreMidi: null,
    writtenChords: [],
    scoreNotes: [],
    scoreDuration: 0,
    rawAnnotations: [],
    midiNotation: false,
    loadSheetPages: null,
    totalBars: 0,
    takes: [],
    activeTakeId: '',
    activeTrack: 'final_restored',

    cues: defaultCuesForBars(4),

    liveActive: false,
    liveTempo: 1.0,
    liveVel: 0,
    liveStatus: message("就绪：点击「启动实时指挥演奏」后随时拖动速度与情绪滑块"),

    refMasterMidi: null,
    refMasterLabel: '',
    m7Status: message("尚未选择参考演奏 MIDI（可直接点击上方内置大师引子试玩）"),

    setCfmSteps: (v) => set({ cfmSteps: v }),
    setStepFactor: (v) => set({ stepFactor: v }),
    setSeed: (v) => set({ seed: v }),
    setBatchCount: (v) => set({ batchCount: v }),

    setArpMs: (v) => {
      set({ arpMs: v });
      const st = get();
      const tk = st.takes.find((t) => t.id === st.activeTakeId);
      if (!st.scoreMidi || !tk || tk.finalMidi) return;
      const t0 = performance.now();
      const fixed = restoreArpeggios(st.scoreMidi, tk.midi?.raw ?? tk.rawNotes, st.rawAnnotations, v);
      const restored = tk.midi ? withSustain(fixed.notes, tk.midi.pedals) : fixed.notes;
      const length = restored.reduce((end,n) => Math.max(end,n.s+n.d),fixed.duration);
      const updatedTakes = st.takes.map((item) =>
        item.id === tk.id
          ? {
              ...item,
              midi: tk.midi && { ...tk.midi, restored: fixed.notes },
              restoredNotes: restored,
              restoredDuration: length,
              arpeggios: fixed.arpeggios,
              subtitle: message("{0} · {1}", fmtTime(length), summarizeNotes(restored)),
            }
          : item,
      );
      set({
        takes: updatedTakes,
        stages: { ...st.stages, st4: { status: 'done', stat: message("{0} ms 即时重调", (performance.now() - t0).toFixed(1)) } },
      });
      if (st.activeTrack === 'final_restored' && !st.liveActive) {
        const cur = pianoPlayer.getCurrentTime();
        const wasPlaying = pianoPlayer.isPlaying;
        pianoPlayer.setTrack(restored, length);
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
              st5: { status: loading ? 'active' : 'done', stat: loading ? message("加载音色中...") : () => specShort(presetId) },
            },
          }));
        });
        set({ timbreDesc: () => spec.desc });
        if (wasPlaying) {
          set({ isPlaying: true });
          void pianoPlayer.play(curT, () => set({ isPlaying: false }));
        }
      } catch (e) {
        console.error(e);
        set({ pianoLoading: false, pianoReady: false, pianoStatus: message("音色加载失败，请重试") });
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
              st5: { status: loading ? 'active' : 'done', stat: loading ? message("加载本地 SF2...") : file.name.slice(0, 18) },
            },
          }));
        });
        const id = `custom_${file.name}`;
        set((s) => ({
          activeTimbreId: id,
          timbreDesc: message("本地导入 SoundFont2 ({0}, {1} MB) · 琴弦共鸣 + 音乐厅卷积", file.name, (file.size / 1e6).toFixed(1)),
          customTimbres: [...s.customTimbres.filter(c => c.id !== id),
            { id, file, get name() { return t("{0} (本地 SF2)", name); } }],
        }));
        if (wasPlaying) {
          set({ isPlaying: true });
          void pianoPlayer.play(curT, () => set({ isPlaying: false }));
        }
      } catch (err) {
        set({ errorMsg: message("本地 SF2 加载失败: {0}", errorText(err)) });
      }
    },

    switchHallIr: async (hallId) => {
      set({ activeHallId: hallId });
      try {
        await pianoPlayer.loadHallIr(hallId);
      } catch (err) {
        console.error(t("IR 加载失败:"), err);
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
      const imported = score.importedScore;
      const lyCode = score.lyCode.trim();
      if ((!imported && !lyCode) || st.busy || score.loading || score.error) return;
      if (st.liveActive) st.stopLiveConductor(false);

      pianoPlayer.stop(true);
      set({
        busy: true,
        isPlaying: false,
        errorMsg: '',
        progressMsg: imported ? message("准备解析 {0} 乐谱并加载 AI 引擎...", imported.kind.toUpperCase()) : message("准备编译乐谱..."),
        progressPct: 4,
        stages: {
          ...st.stages,
          st1: { status: 'active', stat: imported ? message("{0} 直通解析", imported.kind.toUpperCase()) : message("WASM 编译中...") },
          st2: { status: 'active', stat: imported ? message("读取符号标记...") : message("Scheme 监听中...") },
          st3: { status: 'active', stat: message("等待 MIDI...") },
          st4: { status: 'active', stat: message("等待 AI...") },
        },
      });

      try {
        const controller = new AbortController();
        generationController = controller;
        const modelId = st.model;
        let compileProgress = imported ? 100 : 0;
        let modelProgress = 0;
        const report = (msg: DisplayText) => set({
          progressMsg: msg,
          progressPct: modelId === 'pianoflow' ? 4 + compileProgress * 0.7 + modelProgress * 0.28 : 4 + compileProgress * 0.16,
        });
        let compiled: Awaited<ReturnType<typeof lilypondEngine.compile>> | {
          scoreMidi: Midi; writtenChords: WrittenChord[]; rawAnnotations: RawArpeggioAnnotation[]; compileSec: number;
          loadPages: (() => Promise<string[]>) | null; method: DisplayText;
        };
        if (imported) {
          const method = imported.kind === 'musicxml' ? 'MusicXML' : 'MIDI';
          const loadPages = importedSheetLoader(imported);
          compiled = { method, writtenChords: imported.writtenChords ?? [], scoreMidi: imported.midi, rawAnnotations: imported.rawAnnotations, compileSec: 0, loadPages };
          set(s => ({ stages: { ...s.stages,
            st1: { status: 'done', stat: message("{0} · {1} 音", method, imported.noteCount) },
            st2: { status: 'done', stat: message("提取 {0} 条事件", imported.rawAnnotations.length) },
          } }));
          if (modelId === 'pianoflow') {
            await pianoFlowEngine.load(report, controller.signal);
            set({ ortReady: true, ortStatus: message("PianoFlow ({0}) 就绪", pianoFlowEngine.provider) });
          }
        } else {
          const compileStarted = performance.now();
          const compile = lilypondEngine.compile(lyCode, (msg, pct) => {
            compileProgress = pct ?? compileProgress;
            report(msg);
          }).then(res => {
            performance.measure('pianora:score-compile', { start: compileStarted });
            set(s => ({
              wasmReady: true,
              wasmStatus: res.method,
              stages: {
                ...s.stages,
                st1: { status: 'done', stat: message("{0} {1}s", res.method, res.compileSec) },
                st2: { status: 'done', stat: message("提取 {0} 条事件", res.rawAnnotations.length) },
              },
            }));
            return res;
          }).catch(error => { controller.abort(); throw error; });
          const model = modelId !== 'pianoflow' ? Promise.resolve() : pianoFlowEngine.load((msg, pct) => {
            if (pct === modelProgress) return;
            modelProgress = pct ?? modelProgress;
            report(msg);
          }, controller.signal).then(() => {
            set({ ortReady: true, ortStatus: message("PianoFlow ({0}) 就绪", pianoFlowEngine.provider) });
          });
          // Let both jobs settle before allowing a retry or another generation.
          const [scoreResult, modelResult] = await Promise.allSettled([compile, model]);
          if (scoreResult.status === 'rejected') throw scoreResult.reason;
          if (modelResult.status === 'rejected') throw modelResult.reason;
          compiled = scoreResult.value;
          // Start the listening view's engraving alongside inference when a core is available.
          // sheetLoader shares this promise and lets the view retry an engraving failure.
          if (navigator.hardwareConcurrency >= 4) void scoreResult.value.loadPages().catch(() => {});
        }

        const { cfmSteps, stepFactor, seed, batchCount } = get();
        const t3 = performance.now();
        const input = modelId === 'pianoflow' ? null : modelScore(
          compiled.scoreMidi,
          imported?.composer ?? lyCode.match(/composer\s*=\s*"([^"]+)"/)?.[1],
          imported?.performanceMarks,
        );
        const generated = [];
        for (let b = 0; b < batchCount; b++) {
          const sd = seed + b;
          if (input && modelId !== 'pianoflow') {
            controller.signal.throwIfAborted();
            const performance = await renderLocal({
              model: modelId, score: input, seed: sd, dexSteps: st.dexSteps,
            }, (done, total, loading) => {
              const pct = Math.round(done / total * 100);
              const status = loading ? message("正在加载 {0} · {1}%", modelNames[modelId], pct)
                : message("{0} 正在本机演奏 · 第 {1}/{2} 版 · {3}%", modelNames[modelId], b+1, batchCount, pct);
              const takeFraction = loading ? 0.25 * done / total : 0.25 + 0.75 * done / total;
              set(s => ({
                progressMsg: status,
                progressPct: 20 + 75 * (b + takeFraction) / batchCount,
                stages: { ...s.stages, st3: { status: 'active', stat: status } },
              }));
            }, controller.signal);
            generated.push({ seed: sd, performance });
            continue;
          }
          const out = await pianoFlowEngine.performScore(compiled.scoreMidi, {
            cfmSteps,
            stepFactor,
            seed: sd,
            onProgress: (done, total) => {
              const pct = total ? Math.round(((b + done / total) / batchCount) * 100) : 100;
              set((s) => ({
                progressMsg: message("Stage 3/5: PianoFlow ({0}) 第 {1}/{2} 版 (Seed {3}) {4}/{5}", pianoFlowEngine.provider, b + 1, batchCount, sd, done, total),
                progressPct: 52 + pct * 0.43,
                stages: { ...s.stages, st3: { status: 'active', stat: `${b + 1}/${batchCount} · ${pianoFlowEngine.provider}` } },
              }));
            },
          });
          generated.push({ seed: sd, out });
        }
        const dt3 = ((performance.now() - t3) / 1000).toFixed(2);

        // Stage 4: Symbolic Arpeggio Restoration
        set({ progressMsg: message("Stage 4/5: 正在执行符号级琶音精准还原..."), progressPct: 97 });
        const t4 = performance.now();
        const firstOut = generated[0].out;
        const totalBars = firstOut?.perfState.scoreData.totalBars ?? input!.notes.reduce((max,n) => Math.max(max,n.bar+1),1);
        const scoreNotes = firstOut?.scoreNotes ?? input!.notes;
        const duration = (notes: SimpleNote[]) => notes.reduce((end,n) => Math.max(end,n.s+n.d),0);

        set({
          savedNotation: null,
          performanceSource: score.originalFile ?? new File([lyCode], score.selectedPresetId + ".ly"),
          performanceTitle:
            imported ? () => imported.title :
            lyCode.match(/^\s*title\s*=\s*"([^"\n]+)"/m)?.[1] ||
            message("自定义乐谱"),
          scoreMidi: compiled.scoreMidi,
          writtenChords: compiled.writtenChords,
          scoreNotes,
          scoreDuration: firstOut?.scoreDuration ?? duration(scoreNotes),
          ortReady: true,
          ortStatus: modelId === 'pianoflow' ? get().ortStatus : modelNames[modelId] + ' · WASM',
          rawAnnotations: compiled.rawAnnotations,
          midiNotation: imported?.kind === 'midi',
          loadSheetPages: compiled.loadPages,
          totalBars,
          cues: defaultCuesForBars(totalBars),
        });

        const takes: TakeRecord[] = generated.map((item, idx) => {
          const id = `take_${Date.now()}_${idx}`;
          if (item.out) return buildTake(id, message("#{0} 演奏 (Seed {1})", idx + 1, item.seed), item.seed, item.out.perfState);
          const { notes, pedals } = item.performance;
          const fixed = restoreArpeggios(compiled.scoreMidi, notes, compiled.rawAnnotations, st.arpMs);
          const rawNotes = withSustain(notes, pedals);
          const restoredNotes = withSustain(fixed.notes, pedals);
          return { id, model: modelId, label: `${modelNames[modelId]} #${idx+1} (Seed ${item.seed})`,
            subtitle: summarizeNotes(restoredNotes), seed: item.seed, rawNotes, restoredNotes, arpeggios: fixed.arpeggios,
            rawDuration: duration(rawNotes), restoredDuration: duration(restoredNotes),
            midi: { raw: notes, restored: fixed.notes, pedals },
          };
        });
        const dt4 = (performance.now() - t4).toFixed(1);

        set((s) => ({
          takes,
          activeTakeId: takes[0].id,
          activeTrack: 'final_restored',
          stages: {
            ...s.stages,
            st3: { status: 'done', stat: message("{0}s · {1} 版", dt3, batchCount) },
            st4: { status: 'done', stat: message("{0} ms · {1} 处琶音", dt4, takes[0].arpeggios.length) },
          },
          progressMsg: message("演奏已生成({0} {1}s + {2}s AI × {3}版 + {4}ms 还原)", compiled.method, compiled.compileSec, dt3, batchCount, dt4),
          progressPct: 100,
        }));

        pianoPlayer.setTrack(takes[0].restoredNotes, takes[0].restoredDuration);
        pianoPlayer.seek(0);
        await remember(takes);
      } catch (err) {
        console.error(err);
        set((s) => ({
          errorMsg: errorText(err),
          stages: {
            ...s.stages,
            st1: s.stages.st1.status === 'active' ? { status: 'idle', stat: message("失败") } : s.stages.st1,
            st2: s.stages.st2.status === 'active' ? { status: 'idle', stat: message("中止") } : s.stages.st2,
            st3: s.stages.st3.status === 'active' ? { status: 'idle', stat: message("中止") } : s.stages.st3,
            st4: s.stages.st4.status === 'active' ? { status: 'idle', stat: message("中止") } : s.stages.st4,
          },
        }));
      } finally {
        generationController = null;
        set({ busy: false });
      }
    },

    togglePlay: () => {
      const st = get();
      if (st.liveActive) {
        st.stopLiveConductor(false);
        return;
      }
      if (!pianoPlayer.ready) return;
      if (pianoPlayer.isPlaying) {
        pianoPlayer.pause();
        set({ isPlaying: false });
      } else {
        set({ isPlaying: true });
        void pianoPlayer.play(undefined, () => set({ isPlaying: false }));
      }
    },

    playFrom: (sec) => {
      if (!pianoPlayer.ready) return;
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

    activeMidi: (track = get().activeTrack) => {
      const st = get();
      const take = st.takes.find(t => t.id === st.activeTakeId);
      if (track === 'final_restored' && take && st.scoreMidi) return finalTakeMidi(take, st.scoreMidi.header);
      if (take?.finalMidi) return take.finalMidi;
      const scoreHeader = take?.model === 'pianist' || track === 'score' ? st.scoreMidi?.header : undefined;
      if (take?.midi && track !== 'score') {
        const notes = track === 'pianoflow_raw' ? take.midi.raw : take.midi.restored;
        return notesToMidiBytes(notes, takeModelNames[take.model], take.midi.pedals, scoreHeader);
      }
      return notesToMidiBytes(track === 'final_restored' && take ? take.restoredNotes : st.getActiveTrackData().notes, track, [], scoreHeader);
    },
    downloadMidi: () => {
      const st = get();
      if (!st.scoreMidi) return;
      const bytes = st.activeMidi();
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
        set({ errorMsg: message("WAV 导出失败: {0}", errorText(e)) });
      } finally {
        set({ exportingWav: false });
      }
    },

    // =========================================================================
    // 7 Advanced PianoFlow Modes
    // =========================================================================
    runMode1Batch: async (count, startSeed) => {
      await runGuardedMode(message("玩法 ① 批量盲盒抽卡 ({0} 版)", count), async () => {
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
              set({ progressMsg: message("批量抽卡：第 {0}/{1} 版 (Seed {2}) {3}%", i + 1, count, sd, pct), progressPct: pct });
            },
          });
          added.push(buildTake(`m1_${Date.now()}_${i}`, message("抽卡 (Seed {0})", sd), sd, res.perfState));
        }
        const last = added[added.length - 1];
        set((s) => ({
          takes: [...s.takes, ...added],
          progressMsg: message("玩法 ① 完成！新增 {0} 版进入版本池 ({1}s)", count, ((performance.now() - t0) / 1000).toFixed(2)),
          progressPct: 100,
        }));
        get().selectTake(last.id);
      });
    },

    runMode2Continuation: async (lockBarsRaw, count, startSeed) => {
      await runGuardedMode(message("玩法 ② 锁前 {0} 小节续弹 ({1} 版)", lockBarsRaw, count), async () => {
        const st = get();
        const baseTake = st.takes.find((t) => t.id === st.activeTakeId) ?? st.takes[0];
        if (!baseTake?.perfState) return;
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
        if (unlocked === 0) throw new LocalizedError("所有小节都已被锁死，请调小锁死小节数。");

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
              set({ progressMsg: message("锁 1–{0} 小节续弹：第 {1}/{2} 版 ({3}%)", lockBars, k + 1, count, pct), progressPct: pct });
            },
          });
          added.push(buildTake(`m2_${Date.now()}_${k}`, message("锁1–{0}续弹 #{1}", lockBars, k + 1), sd, res.perfState));
        }
        const last = added[added.length - 1];
        set((s) => ({
          takes: [...s.takes, ...added],
          progressMsg: message("玩法 ② 完成！保留 1–{0} 小节，重抽后面 {1} 版 ({2}s)", lockBars, count, ((performance.now() - t0) / 1000).toFixed(2)),
          progressPct: 100,
        }));
        get().selectTake(last.id);
      });
    },

    runMode3Inpainting: async (sBarRaw, eBarRaw, seed) => {
      await runGuardedMode(message("玩法 ③ 双向局部重弹 (第 {0}–{1} 小节)", sBarRaw, eBarRaw), async () => {
        const st = get();
        const baseTake = st.takes.find((t) => t.id === st.activeTakeId) ?? st.takes[0];
        if (!baseTake?.perfState) return;
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
        if (cnt === 0) throw new LocalizedError("第 {0}–{1} 小节内未找到音符", sBar, eBar);

        const res = await pianoFlowEngine.performScore(st.scoreMidi!, {
          cfmSteps: st.cfmSteps,
          stepFactor: st.stepFactor,
          seed,
          baseState: clonePerfState(baseTake.perfState),
          maskMatrix: mask,
          onProgress: (d, tot) => set({ progressMsg: message("双向缝合第 {0}–{1} 小节 ({2}/{3})", sBar, eBar, d, tot), progressPct: (d / Math.max(1, tot)) * 100 }),
        });
        const tk = buildTake(`m3_${Date.now()}`, message("重绘 {0}–{1} 小节", sBar, eBar), seed, res.perfState);
        set((s) => ({
          takes: [...s.takes, tk],
          progressMsg: message("玩法 ③ 完成！已双向缝合第 {0}–{1} 小节 ({2} 音，{3}s)", sBar, eBar, cnt, ((performance.now() - t0) / 1000).toFixed(2)),
          progressPct: 100,
        }));
        get().selectTake(tk.id);
      });
    },

    runMode4Dimensions: async (dims, sBarRaw, eBarRaw, seed) => {
      if (dims.every((x) => !x)) {
        set({ errorMsg: message("请至少勾选 1 个要重算的演奏维度") });
        return;
      }
      const dimNames = () => [t("力度"), t("呼吸"), t("触键"), t("踏板")].filter((_, i) => dims[i]).join('+');
      await runGuardedMode(message("玩法 ④ 拆维度精修 ({0})", dimNames), async () => {
        const st = get();
        const baseTake = st.takes.find((t) => t.id === st.activeTakeId) ?? st.takes[0];
        if (!baseTake?.perfState) return;
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
          onProgress: (d, tot) => set({ progressMsg: message("拆维度重算 [{0}] ({1}/{2})", dimNames, d, tot), progressPct: (d / Math.max(1, tot)) * 100 }),
        });
        const tk = buildTake(`m4_${Date.now()}`, message("仅修{0}", dimNames), seed, res.perfState);
        set((s) => ({
          takes: [...s.takes, tk],
          progressMsg: message("玩法 ④ 完成！锁定其余维度，仅重算「{0}」({1}s)", dimNames, ((performance.now() - t0) / 1000).toFixed(2)),
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
        set({ errorMsg: message("请先添加至少 1 个指挥段落") });
        return;
      }
      await runGuardedMode(message("玩法 ⑤ 分段指挥家 ({0} 段引导)", cues.length), async () => {
        const st = get();
        const t0 = performance.now();
        const res = await pianoFlowEngine.performScore(st.scoreMidi!, {
          cfmSteps: st.cfmSteps,
          stepFactor: st.stepFactor,
          seed,
          cues,
          onProgress: (d, tot) => set({ progressMsg: message("分段指挥 Flow 引导 ({0}/{1})", d, tot), progressPct: (d / Math.max(1, tot)) * 100 }),
        });
        const tk = buildTake(`m5_${Date.now()}`, message("指挥家 ({0}段)", cues.length), seed, res.perfState);
        set((s) => ({
          takes: [...s.takes, tk],
          progressMsg: message("玩法 ⑤ 完成！已按 {0} 段指挥曲线生成 ({1}s)", cues.length, ((performance.now() - t0) / 1000).toFixed(2)),
          progressPct: 100,
        }));
        get().selectTake(tk.id);
      });
    },

    startLiveConductor: async () => {
      const st = get();
      if (!st.scoreMidi || st.liveActive || st.busy) return;
      if (!pianoPlayer.ready) {
        set({ errorMsg: message("钢琴音色正在加载中，请稍等 1 秒再启动实时指挥。") });
        return;
      }
      pianoPlayer.stop(true);
      if (!pianoFlowEngine.meta) {
        set({ busy: true, progressMsg: message("正在加载 PianoFlow…") });
        try { await pianoFlowEngine.load(); }
        catch (error) { set({ errorMsg: errorText(error) }); return; }
        finally { set({ busy: false }); }
      }
      liveSessionRef = pianoFlowEngine.createLiveSession(st.scoreMidi, {
        seed: Math.floor(Math.random() * 9000) + 100,
        cfmSteps: 5,
        tempoScale: st.liveTempo,
        velOffset: st.liveVel,
      });
      set({ liveActive: true, isPlaying: true, liveStatus: message("正在预热首段 0.8s 实时滑动缓冲...") });

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
      set({ liveStatus: message("实时指挥中！随时拖动滑块 · 单块推理 {0} ms", liveSessionRef.lastChunkMs) });

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
              liveStatus: message("实时指挥中 · 缓冲至第 {0}/{1} 小节 · 响应 {2} ms", curBar, liveSessionRef.scoreData.totalBars, liveSessionRef.lastChunkMs),
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
      set({ liveStatus: message("已丢弃 0.25s 后缓存，实时重算新表情 ({0}x / {1}{2})...", tempo.toFixed(2), vel >= 0 ? '+' : '', vel) });
      const added = await liveSessionRef.generateNextChunk(10);
      if (added.length && get().liveActive && liveSessionRef) {
        pianoPlayer.hotReplaceNotes(
          liveSessionRef.committedNotes,
          liveSessionRef.finished ? liveSessionRef.getBufferHeadTime() + 1.0 : 9999,
        );
        set({
          liveStatus: message("已响应手势 ({0} ms) · 当前 {1}x / {2}{3}", liveSessionRef.lastChunkMs, tempo.toFixed(2), vel >= 0 ? '+' : '', vel),
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
        const tk = buildTake(`m6_${Date.now()}`, message("实时指挥实录"), 77, sess.toPerfState());
        set((s) => ({
          takes: [...s.takes, tk],
          liveStatus: message("实时指挥实录已保存到版本池！(共 {0} 音)", sess.generatedNoteCount),
        }));
        get().selectTake(tk.id);
        void remember([tk]);
      } else if (sess) {
        set({ liveStatus: message("已停止实时指挥（已实时演奏 {0}/{1} 音）", sess.generatedNoteCount, sess.scoreData.noteCount) });
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
          m7Status: message("已载入参考演奏「{0}」({1} 音) — 点击「对齐并开始大师接力」", file.name, noteCnt),
        });
      } catch (err) {
        set({ errorMsg: message("MIDI 读取失败: {0}", errorText(err)) });
      }
    },

    loadBuiltinMasterDemo: (style) => {
      const midi = get().scoreMidi;
      if (!midi) return;
      const demo = synthesizeRomanticDemoMidi(midi, style);
      if (style === 'debussy_poetic') {
        set({
          refMasterMidi: demo,
          refMasterLabel: message("浪漫诗意大师"),
          m7Status: message("已载入「浪漫诗意大师引子」（舒缓呼吸 + 歌唱性高声部 + 绵长踏板）— 点击右侧开始接力"),
        });
      } else {
        set({
          refMasterMidi: demo,
          refMasterLabel: message("戏剧炫技大师"),
          m7Status: message("已载入「戏剧炫技大师引子」（紧凑推进 + 强对比触键）— 点击右侧开始接力"),
        });
      }
    },

    runMode7MasterRelay: async (prefixBarsRaw, seed) => {
      const { refMasterMidi, refMasterLabel } = get();
      if (!refMasterMidi) return;
      await runGuardedMode(message("玩法 ⑦ 大师风格接力 ({0})", refMasterLabel), async () => {
        const st = get();
        const t0 = performance.now();
        if (!pianoFlowEngine.meta) await pianoFlowEngine.load();
        const prefixBars = Math.max(1, Math.min(st.totalBars - 1, prefixBarsRaw));
        const report = alignPerformanceMidiToScore(st.scoreMidi!, refMasterMidi, prefixBars, pianoFlowEngine.meta!);
        set({
          m7Status: message("DP 对齐完成：前 {0} 小节匹配 {1}/{2} 音 ({3}%) · 均力 {4} / 相对速度 {5}x → PianoFlow 接力续弹中...", report.prefixBars, report.alignedCount, report.prefixNoteCount, Math.round(
            report.matchRate * 100,
          ), report.avgVel, report.avgTempoRatio),
        });

        const res = await pianoFlowEngine.performScore(st.scoreMidi!, {
          cfmSteps: st.cfmSteps,
          stepFactor: st.stepFactor,
          seed,
          baseState: report.baseState,
          maskMatrix: report.maskMatrix,
          onProgress: (d, tot) => set({ progressMsg: message("大师风格接力续弹 ({0}/{1})", d, tot), progressPct: (d / Math.max(1, tot)) * 100 }),
        });

        const tk = buildTake(`m7_${Date.now()}`, message("{0}接力(前{1}小节)", refMasterLabel, prefixBars), seed, res.perfState);
        const dt = ((performance.now() - t0) / 1000).toFixed(2);
        set((s) => ({
          takes: [...s.takes, tk],
          m7Status: message("接力完成 ({0}s)！前 {1} 小节锁死「{2}」(匹配 {3}%)，后续全曲已顺着大师风格续弹", dt, report.prefixBars, refMasterLabel, Math.round(
            report.matchRate * 100,
          )),
          progressMsg: message("玩法 ⑦ 大师风格接力完成！({0}s)", dt),
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
