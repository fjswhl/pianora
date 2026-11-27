import type { WorkletSynthesizer } from 'spessasynth_lib';
import { releaseUrl, soundfonts } from './assetRelease';
import { assetLoadMessage, downloadBytes } from './download';
import type { AssetProgress } from './assetPacks';
import type { SimpleNote } from './arpeggio';
import { notesToMidiBytes } from './pianoflow';

export interface PianoPresetSpec {
  id: string;
  name: string;
  shortName: string;
  desc: string;
  engine: 'salamander_multi' | 'sf2';
  sf2Url?: string;
  sizeLabel?: string;
}

export interface HallIrSpec {
  id: string;
  name: string;
  shortName: string;
  url: string;
}

export const HALL_IR_PRESETS: HallIrSpec[] = [
  {
    id: 'musikverein',
    name: '🏛️ 维也纳金色大厅 (Musikverein)',
    shortName: '维也纳金色大厅',
    url: '/irs/musikverein_hall.wav',
  },
  {
    id: 'french_salon',
    name: '🕯️ 18 世纪法式沙龙 (德彪西推荐)',
    shortName: '法式沙龙',
    url: '/irs/french_salon.wav',
  },
  {
    id: 'la_scala',
    name: '🎭 米兰斯卡拉歌剧院 (La Scala)',
    shortName: '斯卡拉歌剧院',
    url: '/irs/la_scala_opera.wav',
  },
  {
    id: 'st_nicolaes',
    name: '⛪ 圣尼古拉大教堂 (深邃长混响)',
    shortName: '圣尼古拉大教堂',
    url: '/irs/st_nicolaes_church.wav',
  },
];

export const PIANO_PRESETS: PianoPresetSpec[] = [
  {
    id: 'salamander_c5_multi',
    name: '🎹 雅马哈 C5 三角（Salamander · 5 力度层快开版）',
    shortName: 'Yamaha C5 (5层)',
    desc: 'AKG C414 实录 5 力度层 (v2/v6/v10/v13/v16) + AudioWorklet 琴弦交感共鸣 + 真实音乐厅卷积混响',
    engine: 'salamander_multi',
  },
  {
    id: 'abbey_steinway_d',
    name: '🏛️ Abbey Road 施坦威 Model D（38 MB · SF2）',
    shortName: 'Abbey Steinway D',
    desc: 'Abbey Steinway Model D 38 MB 专业 SF2 + 琴弦交感共鸣 + 真实音乐厅卷积',
    engine: 'sf2',
    sf2Url: releaseUrl(soundfonts.abbey),
    sizeLabel: '38 MB',
  },
  {
    id: 'nice_steinway_v38',
    name: '🎼 Nice Steinway v3.8 音乐会施坦威（205 MB · 多力度 SF2）',
    shortName: 'Nice Steinway v3.8',
    desc: '205 MB 多力度立体声音乐会施坦威 + 琴弦交感共鸣 + 真实音乐厅卷积',
    engine: 'sf2',
    sf2Url: releaseUrl(soundfonts.nice),
    sizeLabel: '205 MB',
  },
  {
    id: 'fazioli_f308',
    name: '✨ Dore Mark Fazioli F308 法奇奥里大三角（299 MB · 顶流 SF2）',
    shortName: 'Fazioli F308 大三角',
    desc: '意大利 3.08 米 Fazioli F308 旗舰大三角（299 MB 多力度 SF2）+ 琴弦交感共鸣 + 真实音乐厅卷积',
    engine: 'sf2',
    sf2Url: releaseUrl(soundfonts.fazioli),
    sizeLabel: '299 MB',
  },
];

/** Timbre preselected on first load: studio Steinway, small enough to start quickly. */
export const DEFAULT_TIMBRE_ID = 'abbey_steinway_d';
export const DEFAULT_TIMBRE =
  PIANO_PRESETS.find((preset) => preset.id === DEFAULT_TIMBRE_ID) ?? PIANO_PRESETS[0];

// 30 minor-third sampled pitches hosted on Tambien/Piano (Salamander Grand Piano v3)
const SAL_MULTI_BASE = 'https://tambien.github.io/Piano/audio/';
const SAL_NOTE_SPECS: Array<{ midi: number; filePrefix: string }> = [
  { midi: 21, filePrefix: 'A0' },
  { midi: 24, filePrefix: 'C1' },
  { midi: 27, filePrefix: 'Ds1' },
  { midi: 30, filePrefix: 'Fs1' },
  { midi: 33, filePrefix: 'A1' },
  { midi: 36, filePrefix: 'C2' },
  { midi: 39, filePrefix: 'Ds2' },
  { midi: 42, filePrefix: 'Fs2' },
  { midi: 45, filePrefix: 'A2' },
  { midi: 48, filePrefix: 'C3' },
  { midi: 51, filePrefix: 'Ds3' },
  { midi: 54, filePrefix: 'Fs3' },
  { midi: 57, filePrefix: 'A3' },
  { midi: 60, filePrefix: 'C4' },
  { midi: 63, filePrefix: 'Ds4' },
  { midi: 66, filePrefix: 'Fs4' },
  { midi: 69, filePrefix: 'A4' },
  { midi: 72, filePrefix: 'C5' },
  { midi: 75, filePrefix: 'Ds5' },
  { midi: 78, filePrefix: 'Fs5' },
  { midi: 81, filePrefix: 'A5' },
  { midi: 84, filePrefix: 'C6' },
  { midi: 87, filePrefix: 'Ds6' },
  { midi: 90, filePrefix: 'Fs6' },
  { midi: 93, filePrefix: 'A6' },
  { midi: 96, filePrefix: 'C7' },
  { midi: 99, filePrefix: 'Ds7' },
  { midi: 102, filePrefix: 'Fs7' },
  { midi: 105, filePrefix: 'A7' },
  { midi: 108, filePrefix: 'C8' },
];

// 5 true velocity layers spanning ppp -> fff (original Salamander v1..v16)
const SAL_VEL_LAYERS = [2, 6, 10, 13, 16] as const;

interface ActiveMultiVoice {
  src: AudioBufferSourceNode;
  gain: GainNode;
  midi: number;
  stopAt: number;
}

async function downloadSf2(
  spec: PianoPresetSpec,
  onProgress?: AssetProgress,
): Promise<ArrayBuffer> {
  const url = spec.sf2Url;
  if (!url) throw new Error(`音色 ${spec.shortName} 缺少音源地址`);

  return (await downloadBytes(url, onProgress)).buffer;
}

export class StudioGrandPianoPlayer {
  // Unified Master Acoustic AudioContext & Chain
  // dryBus ──┬──► sympNode (AudioWorklet) ──► sympWetGain ──┐
  //          └──────────────────────────────────────────────┴──► sumBus ──┬──► directGain ──────────────┐
  //                                                                       └──► hallHp ──► convolver ──► hallWetGain ──┴──► limiter ──► destination
  private ctx: AudioContext | null = null;
  private dryBus: GainNode | null = null;
  private sympNode: AudioWorkletNode | null = null;
  private sympWetGain: GainNode | null = null;
  private sumBus: GainNode | null = null;
  private directGain: GainNode | null = null;
  private hallConvolver: ConvolverNode | null = null;
  private hallWetGain: GainNode | null = null;
  private masterInitPromise: Promise<void> | null = null;

  // Real Concert Hall IR cache (raw ArrayBuffer for both live & offline contexts)
  private irRawCache = new Map<string, ArrayBuffer>();
  public activeHallId = 'musikverein';

  // Engine A: Multi-Velocity Salamander C5 (5 velocity layers x 30 pitches)
  private salBuffers = new Map<string, AudioBuffer>(); // key: `${midi}_v${v}`
  private salRawCache = new Map<string, ArrayBuffer>(); // kept for identical offline WAV render
  private salReady = false;
  private salLoadPromise: Promise<void> | null = null;
  private activeVoices: ActiveMultiVoice[] = [];

  // Engine B: SpessaSynth AudioWorklet SoundFont2 Engine (routed DRY into Master Acoustic Chain)
  private sfSynth: WorkletSynthesizer | null = null;
  private sf2Cache = new Map<string, ArrayBuffer>();
  private sf2CacheOrder: string[] = [];
  private activeSf2Id: string | null = null;

  public activePresetId = DEFAULT_TIMBRE_ID;
  public activeEngine: 'salamander_multi' | 'sf2' = 'salamander_multi';
  public ready = false;
  public isPlaying = false;

  private reverbWet = 0.28;
  private resonanceAmount = 0.55;
  private offsetSec = 0;
  private startPerfMs = 0;
  private timer: number | null = null;
  private pendingTimers: number[] = [];
  private nextIdx = 0;
  private lastScheduledSec = -1;
  private notes: SimpleNote[] = [];
  private duration = 0;
  private onEnd?: () => void;

  // =========================================================================
  // Master Acoustic Chain Initialization (Sympathetic Worklet + Real Hall IR)
  // =========================================================================
  private async ensureMasterChain(): Promise<AudioContext> {
    if (this.ctx && this.dryBus && this.hallConvolver) {
      return this.ctx;
    }
    if (this.masterInitPromise) {
      await this.masterInitPromise;
      return this.ctx!;
    }

    this.masterInitPromise = (async () => {
      const ctx = new AudioContext({ sampleRate: 44100 });
      this.ctx = ctx;

      const dryBus = ctx.createGain();
      dryBus.gain.value = 1.0;

      const sumBus = ctx.createGain();
      sumBus.gain.value = 1.0;

      const sympWetGain = ctx.createGain();
      sympWetGain.gain.value = this.resonanceAmount;

      // Load our custom AudioWorklet sympathetic string & soundboard resonance processor
      try {
        await ctx.audioWorklet.addModule('/audio/sympathetic_resonance.js');
        const sympNode = new AudioWorkletNode(ctx, 'sympathetic-resonance-processor', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [2],
        });
        dryBus.connect(sympNode);
        sympNode.connect(sympWetGain);
        sympWetGain.connect(sumBus);
        this.sympNode = sympNode;
      } catch (err) {
        console.warn('Sympathetic resonance worklet unavailable, falling back to direct chain:', err);
      }

      // Direct dry path (zero latency, phase-clean)
      dryBus.connect(sumBus);

      // Real Concert Hall Convolution Reverb branch with 90 Hz mud-cut highpass
      const directGain = ctx.createGain();
      directGain.gain.value = 1.0;

      const hallHp = ctx.createBiquadFilter();
      hallHp.type = 'highpass';
      hallHp.frequency.value = 90;
      hallHp.Q.value = 0.707;

      const convolver = ctx.createConvolver();
      convolver.normalize = true;

      const hallWetGain = ctx.createGain();
      hallWetGain.gain.value = this.reverbWet;

      // Gentle master safety limiter (prevents clipping on dense fff chords + hall tail)
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -4.0;
      limiter.knee.value = 10.0;
      limiter.ratio.value = 3.5;
      limiter.attack.value = 0.004;
      limiter.release.value = 0.14;

      sumBus.connect(directGain);
      directGain.connect(limiter);

      sumBus.connect(hallHp);
      hallHp.connect(convolver);
      convolver.connect(hallWetGain);
      hallWetGain.connect(limiter);

      limiter.connect(ctx.destination);

      this.dryBus = dryBus;
      this.sympWetGain = sympWetGain;
      this.sumBus = sumBus;
      this.directGain = directGain;
      this.hallConvolver = convolver;
      this.hallWetGain = hallWetGain;

      // Load default real concert hall IR
      await this.loadHallIr(this.activeHallId);
    })();

    await this.masterInitPromise;
    return this.ctx!;
  }

  private async fetchIrRaw(hallId: string): Promise<ArrayBuffer> {
    const cached = this.irRawCache.get(hallId);
    if (cached) return cached;
    const spec = HALL_IR_PRESETS.find((h) => h.id === hallId) ?? HALL_IR_PRESETS[0];
    const resp = await fetch(spec.url);
    if (!resp.ok) throw new Error(`无法加载音乐厅脉冲响应 ${spec.url}`);
    const ab = await resp.arrayBuffer();
    this.irRawCache.set(spec.id, ab);
    return ab;
  }

  async loadHallIr(hallId: string): Promise<HallIrSpec> {
    const spec = HALL_IR_PRESETS.find((h) => h.id === hallId) ?? HALL_IR_PRESETS[0];
    this.activeHallId = spec.id;
    const ab = await this.fetchIrRaw(spec.id);
    if (this.ctx && this.hallConvolver) {
      const decoded = await this.ctx.decodeAudioData(ab.slice(0));
      this.hallConvolver.buffer = decoded;
    }
    return spec;
  }

  setReverbWet(v: number) {
    this.reverbWet = Math.max(0, Math.min(0.85, v));
    if (this.hallWetGain && this.ctx) {
      this.hallWetGain.gain.setTargetAtTime(this.reverbWet, this.ctx.currentTime, 0.02);
    }
  }

  setResonanceAmount(v: number) {
    this.resonanceAmount = Math.max(0, Math.min(1.2, v));
    if (this.sympWetGain && this.ctx) {
      this.sympWetGain.gain.setTargetAtTime(this.resonanceAmount, this.ctx.currentTime, 0.02);
    }
  }

  // =========================================================================
  // Engine A: Multi-Velocity Yamaha C5 Salamander (5 velocity layers x 30 notes)
  // =========================================================================
  private async ensureSalamanderMulti(onStatus?: (loading: boolean, text: string) => void): Promise<void> {
    if (this.salReady) return;
    if (this.salLoadPromise) {
      await this.salLoadPromise;
      return;
    }

    this.salLoadPromise = (async () => {
      const ctx = await this.ensureMasterChain();
      const tasks: Array<{ key: string; url: string }> = [];
      for (const note of SAL_NOTE_SPECS) {
        for (const v of SAL_VEL_LAYERS) {
          tasks.push({
            key: `${note.midi}_v${v}`,
            url: `${SAL_MULTI_BASE}${note.filePrefix}v${v}.mp3`,
          });
        }
      }

      const total = tasks.length;
      let done = 0;
      const CONCURRENCY = 12;
      let cursor = 0;

      const worker = async () => {
        while (cursor < tasks.length) {
          const idx = cursor++;
          const t = tasks[idx];
          const resp = await fetch(t.url);
          if (!resp.ok) throw new Error(`采样下载失败: ${t.url}`);
          const raw = await resp.arrayBuffer();
          this.salRawCache.set(t.key, raw);
          const decoded = await ctx.decodeAudioData(raw.slice(0));
          this.salBuffers.set(t.key, decoded);
          done++;
          if (done % 6 === 0 || done === total) {
            const pct = Math.round((done / total) * 100);
            onStatus?.(true, `加载 5 力度层 Yamaha C5: ${done}/${total} (${pct}%)`);
          }
        }
      };

      await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
      this.salReady = true;
    })();

    try {
      await this.salLoadPromise;
    } catch (e) {
      this.salLoadPromise = null;
      throw e;
    }
  }

  private findClosestSample(midi: number, velocity: number): {
    key: string;
    playbackRate: number;
    gain: number;
  } {
    // Find nearest minor-third sampled pitch
    let best = SAL_NOTE_SPECS[0];
    let bestDist = Math.abs(midi - best.midi);
    for (let i = 1; i < SAL_NOTE_SPECS.length; i++) {
      const d = Math.abs(midi - SAL_NOTE_SPECS[i].midi);
      if (d < bestDist) {
        bestDist = d;
        best = SAL_NOTE_SPECS[i];
      }
    }
    const semitoneDiff = midi - best.midi;
    const playbackRate = Math.pow(2, semitoneDiff / 12);

    // Map MIDI velocity 1..127 to one of the 5 real recorded velocity layers (v2, v6, v10, v13, v16)
    const vNorm = Math.max(0.02, Math.min(1.0, velocity / 127));
    let layerIdx = 0;
    if (vNorm < 0.22) layerIdx = 0; // v2 (ppp-pp)
    else if (vNorm < 0.42) layerIdx = 1; // v6 (p-mp)
    else if (vNorm < 0.64) layerIdx = 2; // v10 (mf)
    else if (vNorm < 0.84) layerIdx = 3; // v13 (f)
    else layerIdx = 4; // v16 (ff-fff)

    // Smooth continuous dynamic curve within each recorded layer (since layers already have real loudness + timbre)
    const layerCenters = [0.14, 0.32, 0.53, 0.74, 0.94];
    const ratio = vNorm / layerCenters[layerIdx];
    const fineScale = Math.max(0.55, Math.min(1.25, Math.pow(ratio, 0.75)));
    // Overall perceptual loudness curve across ppp..fff
    const macroGain = 0.22 + 0.78 * Math.pow(vNorm, 0.82);

    return {
      key: `${best.midi}_v${SAL_VEL_LAYERS[layerIdx]}`,
      playbackRate,
      gain: Math.min(1.05, macroGain * fineScale * 0.72),
    };
  }

  private triggerMultiNote(
    targetCtx: BaseAudioContext,
    dest: AudioNode,
    bufMap: Map<string, AudioBuffer>,
    midi: number,
    vel: number,
    startTime: number,
    durSec: number,
    trackLive: boolean,
  ) {
    const { key, playbackRate, gain } = this.findClosestSample(midi, vel);
    const buf = bufMap.get(key);
    if (!buf) return;

    const src = targetCtx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = playbackRate;

    const env = targetCtx.createGain();
    env.gain.setValueAtTime(gain, startTime);

    // Realistic pitch-dependent felt damper release time (longer in bass, crisp in treble)
    const pitchNorm = Math.max(0, Math.min(1, (midi - 21) / 87));
    const releaseSec = 0.32 - 0.16 * pitchNorm;
    const relStart = startTime + Math.max(0.05, durSec);
    const stopAt = relStart + releaseSec + 0.04;

    env.gain.setValueAtTime(gain, relStart);
    env.gain.exponentialRampToValueAtTime(0.0008, relStart + releaseSec);
    env.gain.linearRampToValueAtTime(0, stopAt);

    src.connect(env);
    env.connect(dest);

    src.start(startTime);
    src.stop(stopAt + 0.01);

    if (trackLive) {
      const vObj: ActiveMultiVoice = { src, gain: env, midi, stopAt };
      this.activeVoices.push(vObj);
      src.onended = () => {
        const idx = this.activeVoices.indexOf(vObj);
        if (idx !== -1) this.activeVoices.splice(idx, 1);
      };
    }
  }

  // =========================================================================
  // Engine B: SpessaSynth AudioWorklet SoundFont2 (Dry -> Master Acoustic Chain)
  // =========================================================================
  private async ensureSf2Worklet(): Promise<WorkletSynthesizer> {
    const ctx = await this.ensureMasterChain();
    if (this.sfSynth) {
      if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
      return this.sfSynth;
    }
    await ctx.audioWorklet.addModule('/spessa/spessasynth_processor.min.js');
    const { WorkletSynthesizer } = await import('spessasynth_lib');
    const synth = new WorkletSynthesizer(ctx);
    // Route SpessaSynth DRY into our Master Acoustic Chain (Sympathetic Worklet + Real Concert Hall IR)
    synth.connect(this.dryBus!);
    await synth.isReady;
    this.sfSynth = synth;
    return synth;
  }

  private cacheSf2Buffer(id: string, buf: ArrayBuffer) {
    this.sf2Cache.set(id, buf);
    this.sf2CacheOrder = this.sf2CacheOrder.filter((k) => k !== id);
    this.sf2CacheOrder.push(id);

    // Keep memory bounded (~400 MB max cache besides active buffer) so switching between 299MB & 205MB never OOMs
    let totalBytes = 0;
    for (const v of this.sf2Cache.values()) totalBytes += v.byteLength;
    while (totalBytes > 700_000_000 && this.sf2CacheOrder.length > 1) {
      const oldest = this.sf2CacheOrder.shift()!;
      if (oldest === id) {
        this.sf2CacheOrder.push(oldest);
        break;
      }
      const removed = this.sf2Cache.get(oldest);
      if (removed) {
        totalBytes -= removed.byteLength;
        this.sf2Cache.delete(oldest);
      }
    }
  }

  private async activateSf2Buffer(
    id: string,
    buf: ArrayBuffer,
    label: string,
    onStatus?: (loading: boolean, text: string) => void,
  ): Promise<void> {
    onStatus?.(true, `初始化 AudioWorklet 并装载 ${label}...`);
    const synth = await this.ensureSf2Worklet();
    await synth.soundBankManager.addSoundBank(buf.slice(0), 'main', 0);
    synth.programChange(0, 0);
    // Disable SpessaSynth's built-in Schroeder reverb & chorus so our real Concert Hall IR handles all space!
    synth.controllerChange(0, 91, 0);
    synth.controllerChange(0, 93, 0);
    this.cacheSf2Buffer(id, buf);
    this.activeSf2Id = id;
    this.activeEngine = 'sf2';
    this.activePresetId = id;
    this.ready = true;
    onStatus?.(false, `${label} 就绪`);
  }

  async loadPreset(
    presetId: string,
    onStatus?: (loading: boolean, text: string) => void,
  ): Promise<PianoPresetSpec> {
    const spec = PIANO_PRESETS.find((p) => p.id === presetId) ?? DEFAULT_TIMBRE;
    this.activePresetId = spec.id;
    this.releaseAll();

    if (spec.engine === 'salamander_multi') {
      this.activeEngine = 'salamander_multi';
      if (this.salReady) {
        this.ready = true;
        onStatus?.(false, `${spec.shortName} 就绪`);
        return spec;
      }
      this.ready = false;
      onStatus?.(true, `加载 5 力度层 ${spec.shortName}...`);
      await this.ensureSalamanderMulti(onStatus);
      if (this.activePresetId === spec.id) {
        this.ready = true;
        onStatus?.(false, `${spec.shortName} 就绪`);
      }
      return spec;
    }

    // SF2 preset via SpessaSynth AudioWorklet
    this.ready = false;
    const cached = this.sf2Cache.get(spec.id);
    if (cached) {
      await this.activateSf2Buffer(spec.id, cached, spec.shortName, onStatus);
      return spec;
    }

    onStatus?.(true, `加载 ${spec.shortName} (${spec.sizeLabel || 'SF2'})...`);
    let lastReport = 0;
    const ab = await downloadSf2(spec, (loaded, total, parts) => {
      const now = performance.now();
      if (now - lastReport < 120 && loaded < total) return;
      lastReport = now;
      onStatus?.(true, assetLoadMessage(spec.shortName, loaded, total, parts));
    });

    if (this.activePresetId === spec.id) {
      await this.activateSf2Buffer(spec.id, ab, spec.shortName, onStatus);
    } else {
      this.cacheSf2Buffer(spec.id, ab);
    }
    return spec;
  }

  async loadCustomSf2File(
    file: File,
    onStatus?: (loading: boolean, text: string) => void,
  ): Promise<string> {
    this.releaseAll();
    this.ready = false;
    const shortName = file.name.replace(/\.(sf2|sf3|dls)$/i, '').slice(0, 24);
    onStatus?.(true, `读取本地音色 ${shortName}...`);
    const ab = await file.arrayBuffer();
    const customId = `custom_${file.name}`;
    await this.activateSf2Buffer(customId, ab, shortName, onStatus);
    return shortName;
  }

  // =========================================================================
  // Transport & Live Playback
  // =========================================================================
  setTrack(notes: SimpleNote[], duration: number) {
    this.notes = notes;
    this.duration = duration;
    if (this.offsetSec > duration) this.offsetSec = 0;
  }

  /**
   * Mode 6 Live Streaming Hot-Update:
   * Replace future notes beyond the current playhead cleanly WITHOUT stopping playback!
   */
  hotReplaceNotes(notes: SimpleNote[], duration: number) {
    this.notes = notes;
    this.duration = duration;
    if (!this.isPlaying) return;
    const cutoff = Math.max(this.lastScheduledSec + 0.001, this.getCurrentTime() + 0.03);
    let lo = 0;
    let hi = notes.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (notes[mid].s <= cutoff) lo = mid + 1;
      else hi = mid;
    }
    this.nextIdx = lo;
  }

  async startLiveStream(initialNotes: SimpleNote[], onEnd?: () => void) {
    this.notes = initialNotes;
    this.duration = 9999; // Open-ended until live session marks finished
    await this.play(0, onEnd);
  }

  finishLiveStream(finalDuration: number) {
    this.duration = Math.max(this.getCurrentTime() + 0.2, finalDuration);
  }

  getCurrentTime(): number {
    if (!this.isPlaying) return this.offsetSec;
    return this.offsetSec + (performance.now() - this.startPerfMs) / 1000;
  }

  seek(sec: number) {
    const wasPlaying = this.isPlaying;
    this.offsetSec = Math.max(0, Math.min(sec, this.duration));
    if (wasPlaying) void this.play(this.offsetSec, this.onEnd);
  }

  private releaseAll() {
    for (const id of this.pendingTimers) window.clearTimeout(id);
    this.pendingTimers = [];

    if (this.ctx) {
      const now = this.ctx.currentTime;
      for (const v of this.activeVoices) {
        try {
          v.gain.gain.cancelScheduledValues(now);
          v.gain.gain.setValueAtTime(v.gain.gain.value, now);
          v.gain.gain.linearRampToValueAtTime(0, now + 0.04);
          v.src.stop(now + 0.05);
        } catch {}
      }
      this.activeVoices = [];
    }

    this.sfSynth?.stopAll(false);
    this.sympNode?.port.postMessage({ type: 'reset' });
  }

  stop(resetZero = false) {
    this.isPlaying = false;
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    this.releaseAll();
    if (resetZero) this.offsetSec = 0;
  }

  pause() {
    if (!this.isPlaying) return;
    this.offsetSec = this.getCurrentTime();
    this.stop(false);
  }

  async play(fromSec?: number, onEnd?: () => void) {
    if (!this.notes.length || !this.ready) return;
    const ctx = await this.ensureMasterChain();
    if (ctx.state === 'suspended') await ctx.resume();

    this.onEnd = onEnd;
    this.stop(false);
    this.offsetSec = fromSec !== undefined ? Math.max(0, Math.min(fromSec, this.duration)) : this.offsetSec;
    if (this.offsetSec >= this.duration - 0.1) this.offsetSec = 0;

    let lo = 0;
    let hi = this.notes.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.notes[mid].s < this.offsetSec - 0.01) lo = mid + 1;
      else hi = mid;
    }
    this.nextIdx = lo;
    this.lastScheduledSec = this.offsetSec - 0.02;
    this.startPerfMs = performance.now();
    this.isPlaying = true;

    const LOOKAHEAD = this.activeEngine === 'salamander_multi' ? 0.12 : 0.055;
    const INTERVAL_MS = this.activeEngine === 'salamander_multi' ? 30 : 15;

    this.timer = window.setInterval(() => {
      if (!this.isPlaying || !this.ctx || !this.dryBus) return;
      const songSec = this.offsetSec + (performance.now() - this.startPerfMs) / 1000;
      const nowAudio = this.ctx.currentTime;

      while (this.nextIdx < this.notes.length && this.notes[this.nextIdx].s <= songSec + LOOKAHEAD) {
        const n = this.notes[this.nextIdx++];
        if (n.s > this.lastScheduledSec) this.lastScheduledSec = n.s;
        const delta = Math.max(0, n.s - songSec);
        const dur = Math.max(0.06, n.d);
        const onMs = Math.round(delta * 1000);
        const offMs = Math.round((delta + dur) * 1000);
        const pitch = n.p;
        const vel = Math.max(1, Math.min(127, n.v));

        if (this.activeEngine === 'salamander_multi') {
          this.triggerMultiNote(
            this.ctx,
            this.dryBus,
            this.salBuffers,
            pitch,
            vel,
            nowAudio + delta,
            dur,
            true,
          );
        } else if (this.activeEngine === 'sf2' && this.sfSynth) {
          const synth = this.sfSynth;
          if (onMs <= 4) {
            synth.noteOn(0, pitch, vel);
          } else {
            const tOn = window.setTimeout(() => {
              if (this.isPlaying) synth.noteOn(0, pitch, vel);
            }, onMs);
            this.pendingTimers.push(tOn);
          }
          const tOff = window.setTimeout(() => {
            synth.noteOff(0, pitch);
          }, offMs);
          this.pendingTimers.push(tOff);
        }

        // Notify Sympathetic Resonance AudioWorklet in sync with key-down / damper-drop
        if (this.sympNode) {
          const port = this.sympNode.port;
          if (onMs <= 4) {
            port.postMessage({ type: 'noteOn', midi: pitch, vel });
          } else {
            const sOn = window.setTimeout(() => {
              if (this.isPlaying) port.postMessage({ type: 'noteOn', midi: pitch, vel });
            }, onMs);
            this.pendingTimers.push(sOn);
          }
          const sOff = window.setTimeout(() => {
            port.postMessage({ type: 'noteOff', midi: pitch });
          }, offMs);
          this.pendingTimers.push(sOff);
        }
      }

      if (songSec >= this.duration + 1.5) {
        this.stop(true);
        this.onEnd?.();
      }
    }, INTERVAL_MS);
  }

  // =========================================================================
  // Offline Studio WAV Rendering (Identical Acoustic Chain: Dry + Sympathetic + Hall IR)
  // =========================================================================
  async renderOfflineWav(
    notes: SimpleNote[],
    duration: number,
    reverbWet: number,
    resonanceAmount = this.resonanceAmount,
  ): Promise<Blob> {
    const { WorkletSynthesizer, audioBufferToWav } = await import('spessasynth_lib');
    const sr = 44100;
    const leadIn = 0.05;
    const totalSamples = Math.ceil((duration + 3.8) * sr);
    const offCtx = new OfflineAudioContext(2, totalSamples, sr);

    // Build identical Master Acoustic Chain inside OfflineAudioContext
    const offDry = offCtx.createGain();
    offDry.gain.value = 1.0;

    const offSum = offCtx.createGain();
    offSum.gain.value = 1.0;

    offDry.connect(offSum);

    // 1. Sample-accurate Sympathetic String Resonance Worklet
    if (resonanceAmount > 0.001) {
      await offCtx.audioWorklet.addModule('/audio/sympathetic_resonance.js');
      const offSymp = new AudioWorkletNode(offCtx, 'sympathetic-resonance-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      const events: Array<{ frame: number; type: 'noteOn' | 'noteOff'; midi: number; vel: number }> = [];
      for (const n of notes) {
        const tOn = n.s + leadIn;
        const tOff = tOn + Math.max(0.06, n.d);
        events.push({ frame: Math.round(tOn * sr), type: 'noteOn', midi: n.p, vel: n.v });
        events.push({ frame: Math.round(tOff * sr), type: 'noteOff', midi: n.p, vel: 0 });
      }
      events.sort((a, b) => a.frame - b.frame);
      offSymp.port.postMessage({ type: 'scheduleEvents', events });

      const offSympGain = offCtx.createGain();
      offSympGain.gain.value = resonanceAmount;
      offDry.connect(offSymp);
      offSymp.connect(offSympGain);
      offSympGain.connect(offSum);
    }

    // 2. Real Concert Hall Convolution Reverb + Safety Limiter
    const offLimiter = offCtx.createDynamicsCompressor();
    offLimiter.threshold.value = -4.0;
    offLimiter.knee.value = 10.0;
    offLimiter.ratio.value = 3.5;
    offLimiter.attack.value = 0.004;
    offLimiter.release.value = 0.14;
    offLimiter.connect(offCtx.destination);

    offSum.connect(offLimiter);

    if (reverbWet > 0.001) {
      const irRaw = await this.fetchIrRaw(this.activeHallId);
      const irBuf = await offCtx.decodeAudioData(irRaw.slice(0));
      const hp = offCtx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 90;
      const conv = offCtx.createConvolver();
      conv.normalize = true;
      conv.buffer = irBuf;
      const wet = offCtx.createGain();
      wet.gain.value = reverbWet;
      offSum.connect(hp);
      hp.connect(conv);
      conv.connect(wet);
      wet.connect(offLimiter);
    }

    // 3. Feed active piano source into offDry
    if (this.activeEngine === 'sf2' && this.activeSf2Id) {
      const sfBuf = this.sf2Cache.get(this.activeSf2Id);
      if (sfBuf) {
        await offCtx.audioWorklet.addModule('/spessa/spessasynth_processor.min.js');
        const offSynth = new WorkletSynthesizer(offCtx);
        offSynth.connect(offDry);
        await offSynth.isReady;
        // Disable built-in reverb so our real Concert Hall IR handles all reverb
        offSynth.controllerChange(0, 91, 0);
        offSynth.controllerChange(0, 93, 0);
        offSynth.midiChannels[0]?.lockController(91 as never, true);

        const shiftedNotes = notes.map((n) => ({ ...n, s: n.s + leadIn }));
        const midiBytes = notesToMidiBytes(shiftedNotes, 'PianoFlow');
        const { BasicMIDI } = await import('spessasynth_core');
        const basicMidi = BasicMIDI.fromArrayBuffer(midiBytes.buffer as ArrayBuffer);
        await offSynth.startOfflineRender({
          midiSequence: basicMidi,
          loopCount: 0,
          soundBankList: [{ bankOffset: 0, soundBankBuffer: sfBuf.slice(0) }],
        });
        const renderedBuf = await offCtx.startRendering();
        return audioBufferToWav(renderedBuf);
      }
    }

    // Multi-Velocity Salamander C5 offline render
    const offBufs = new Map<string, AudioBuffer>();
    // Decode only samples actually used by these notes (fast!)
    const neededKeys = new Set<string>();
    for (const n of notes) {
      neededKeys.add(this.findClosestSample(n.p, n.v).key);
    }
    await Promise.all(
      Array.from(neededKeys).map(async (k) => {
        const raw = this.salRawCache.get(k);
        if (raw) offBufs.set(k, await offCtx.decodeAudioData(raw.slice(0)));
      }),
    );

    for (const n of notes) {
      this.triggerMultiNote(offCtx, offDry, offBufs, n.p, n.v, n.s + leadIn, Math.max(0.06, n.d), false);
    }

    const renderedBuf = await offCtx.startRendering();
    return audioBufferToWav(renderedBuf);
  }
}
