import { createReusableCompiler } from '@sightread/lilypond-wasm';
import { Midi } from '@tonejs/midi';
import {
  injectSchemeHook,
  restoreArpeggios,
  type RawArpeggioAnnotation,
  type RestoredArpeggioInfo,
  type SimpleNote,
} from './arpeggio';
import {
  BrowserPianoFlow,
  LiveConductorSession,
  alignPerformanceMidiToScore,
  clonePerfState,
  decodePerfState,
  notesToMidiBytes,
  synthesizeRomanticDemoMidi,
  type ConductorCue,
  type PerfState,
} from './pianoflow';
import { StudioGrandPianoPlayer, PIANO_PRESETS, HALL_IR_PRESETS } from './pianoAudio';

const SHORT_ETUDE_LY = String.raw`\version "2.24.3"
\header {
  title = "Lune Miniature"
  subtitle = "Pure-Browser Quick Etude"
  composer = "Demo Etude"
  tagline = ##f
}
\include "english.ly"

\score {
  \new PianoStaff <<
    \new Staff = "upper" {
      \key df \major
      \time 9/8
      \tempo 4. = 46
      r8\pp <f' af'>4 <f'' af''>4. <df'' f''>4.~ |
      <df'' f''>8 <c'' ef''> <df'' f''> <c'' ef''>2. |
      <af'' df''' af'''>2.\arpeggio <af'' df''' af'''>4.\arpeggio |
      <af' df'' f'' af''>2.\arpeggio r4. \bar "|."
    }
    \new Staff = "lower" {
      \clef bass
      \key df \major
      \time 9/8
      r8 <df, af,>4~ <df, af,>2. |
      <gf, bf, df>2.~ <gf, bf, df>4. |
      <f af df' f'>2.\arpeggio <ff af bf df' ff'>4.\arpeggio |
      <df, af, df f>2.\arpeggio r4. \bar "|."
    }
  >>
  \layout { }
  \midi { }
}
`;

let compiler = createReusableCompiler();
const pianoFlow = new BrowserPianoFlow();
const player = new StudioGrandPianoPlayer();

type TrackKey = 'score' | 'pianoflow_raw' | 'final_restored';

interface TakeRecord {
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

interface RunState {
  scoreMidi: Midi;
  scoreNotes: SimpleNote[];
  scoreDuration: number;
  rawAnnotations: RawArpeggioAnnotation[];
  totalBars: number;
  takes: TakeRecord[];
  activeTakeId: string;
  svgUrls: string[];
}

let state: RunState | null = null;
let activeKey: TrackKey = 'final_restored';
let wasmPreloaded = false;
let busyMode = false;

// Mode 5 Conductor cues
let conductorCues: ConductorCue[] = [];

// Mode 6 Real-Time Live Conductor state
let liveSession: LiveConductorSession | null = null;
let liveLoopTimer: number | null = null;
let liveActive = false;

// Mode 7 Reference Master MIDI
let refMasterMidi: Midi | null = null;
let refMasterLabel = '';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function fmtTime(sec: number): string {
  sec = Math.max(0, sec || 0);
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function setProgress(msg: string, pct: number) {
  $('progressWrap').style.display = 'block';
  $('progressMsg').textContent = msg;
  $('progressFill').style.width = `${Math.max(0, Math.min(100, pct))}%`;
}

function getActiveTake(): TakeRecord | null {
  if (!state) return null;
  return state.takes.find((t) => t.id === state!.activeTakeId) ?? state.takes[0] ?? null;
}

function getActiveTrackData(): { notes: SimpleNote[]; duration: number } {
  if (liveActive && liveSession) {
    const dur = liveSession.committedNotes.reduce((mx, n) => Math.max(mx, n.s + n.d), 0);
    return { notes: liveSession.committedNotes, duration: dur };
  }
  if (!state) return { notes: [], duration: 0 };
  const tk = getActiveTake();
  if (activeKey === 'score' || !tk) {
    return { notes: state.scoreNotes, duration: state.scoreDuration };
  }
  if (activeKey === 'pianoflow_raw') {
    return { notes: tk.rawNotes, duration: tk.rawDuration };
  }
  return { notes: tk.restoredNotes, duration: tk.restoredDuration };
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

function buildTakeRecord(id: string, label: string, seed: number, perfState: PerfState): TakeRecord {
  const decoded = decodePerfState(perfState);
  const baseMs = parseFloat($<HTMLInputElement>('arpSlider').value);
  const fixed = restoreArpeggios(state!.scoreMidi, decoded.perfSustainNotes, state!.rawAnnotations, baseMs);
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
}

function renderTakesBar() {
  const bar = $('takesBar');
  if (!state || !state.takes.length) {
    bar.classList.remove('visible');
    bar.innerHTML = '';
    return;
  }
  bar.classList.add('visible');
  bar.innerHTML = '';
  for (const tk of state.takes) {
    const btn = document.createElement('button');
    btn.className = `take-card${tk.id === state.activeTakeId ? ' active' : ''}`;
    btn.innerHTML = `<div class="tk-title">${tk.label}</div><div class="tk-meta">${tk.subtitle}</div>`;
    btn.onclick = () => selectTake(tk.id);
    bar.appendChild(btn);
  }
}

function selectTake(takeId: string) {
  if (!state) return;
  const tk = state.takes.find((t) => t.id === takeId);
  if (!tk) return;
  state.activeTakeId = takeId;
  renderTakesBar();

  $('qScore').textContent = `${state.scoreNotes.length} 音 · ${fmtTime(state.scoreDuration)}`;
  $('qRaw').textContent = `${pianoFlow.provider} · ${fmtTime(tk.rawDuration)}`;
  $('qFinal').textContent = `${tk.arpeggios.length} 琶音还原 · ${fmtTime(tk.restoredDuration)}`;
  renderAnnotationsUI(tk.arpeggios);
  selectTrack(activeKey);
}

function selectTrack(key: TrackKey) {
  const wasPlaying = player.isPlaying && !liveActive;
  const curT = player.getCurrentTime();
  if (wasPlaying) player.pause();
  activeKey = key;
  document.querySelectorAll<HTMLButtonElement>('.ab-btn').forEach((b) => {
    b.classList.toggle('selected', b.dataset.track === key);
  });
  if (state && !liveActive) {
    const tr = getActiveTrackData();
    player.setTrack(tr.notes, tr.duration);
    const clamped = Math.min(curT, tr.duration);
    player.seek(clamped);
    const seek = $<HTMLInputElement>('seekSlider');
    seek.max = String(tr.duration || 100);
    seek.value = String(clamped);
    $('timeTxt').textContent = `${fmtTime(clamped)} / ${fmtTime(tr.duration)}`;
    if (wasPlaying) {
      void player.play(clamped, () => {
        $('playBtn').textContent = '▶ 播放';
      });
    }
  }
}

function setModesEnabled(enabled: boolean) {
  const ids = [
    'm1RunBtn',
    'm2RunBtn',
    'm3RunBtn',
    'm4RunBtn',
    'm5RunBtn',
    'm6StartBtn',
    'm7DemoPoeticBtn',
    'm7DemoDramaticBtn',
  ];
  for (const id of ids) {
    const el = document.getElementById(id) as HTMLButtonElement | null;
    if (el) el.disabled = !enabled;
  }
  const m7Btn = document.getElementById('m7RunBtn') as HTMLButtonElement | null;
  if (m7Btn) m7Btn.disabled = !(enabled && refMasterMidi);
}

function syncBarBoundsUI(totalBars: number) {
  $('barCountBadge').textContent = `当前乐谱共 ${totalBars} 小节 · 全部 7 种玩法已解锁`;
  const maxBar = Math.max(1, totalBars);
  const half = Math.max(1, Math.min(maxBar - 1, Math.floor(maxBar / 2)));

  const m2 = $<HTMLInputElement>('m2LockBars');
  m2.max = String(Math.max(1, maxBar - 1));
  m2.value = String(half);

  const m3s = $<HTMLInputElement>('m3StartBar');
  const m3e = $<HTMLInputElement>('m3EndBar');
  m3s.max = String(maxBar);
  m3e.max = String(maxBar);
  m3s.value = String(Math.max(1, Math.min(maxBar, Math.floor(maxBar * 0.35) || 2)));
  m3e.value = String(Math.max(Number(m3s.value), Math.min(maxBar, Math.ceil(maxBar * 0.7))));

  const m4s = $<HTMLInputElement>('m4StartBar');
  const m4e = $<HTMLInputElement>('m4EndBar');
  m4s.max = String(maxBar);
  m4e.max = String(maxBar);
  m4s.value = '1';
  m4e.value = String(maxBar);

  const m7 = $<HTMLInputElement>('m7PrefixBars');
  m7.max = String(Math.max(1, maxBar - 1));
  m7.value = String(Math.min(Math.max(1, maxBar - 1), totalBars >= 16 ? 8 : Math.max(1, Math.floor(maxBar / 2))));

  loadDefaultConductorCues(totalBars);
}

function renderAnnotationsUI(arpeggios: RestoredArpeggioInfo[]) {
  const sec = $('chipsSection');
  const wrap = $('chipsWrap');
  const tbody = $('annTableBody');
  wrap.innerHTML = '';
  tbody.innerHTML = '';

  if (!arpeggios.length) {
    sec.style.display = 'none';
    tbody.innerHTML = `<tr><td colspan="6" style="color:var(--muted);text-align:center;">该乐谱未包含 \\arpeggio 记号</td></tr>`;
    return;
  }
  sec.style.display = 'block';
  for (const a of arpeggios) {
    const chip = document.createElement('button');
    chip.className = 'chip';
    chip.textContent = `第 ${a.bar} 小节 (${fmtTime(a.time_sec)}) · ${a.before_ms}ms → ${a.after_ms}ms`;
    chip.onclick = () => {
      $('playBtn').textContent = '⏸ 暂停';
      void player.play(Math.max(0, a.time_sec - 1.5), () => {
        $('playBtn').textContent = '▶ 播放';
      });
    };
    wrap.appendChild(chip);

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><b>第 ${a.bar} 小节</b></td>
      <td>${fmtTime(a.time_sec)} (${a.time_sec}s)</td>
      <td>${a.note_count} 音</td>
      <td>${a.before_ms} ms</td>
      <td style="color:var(--gold);font-weight:700;">${a.after_ms} ms</td>
      <td>${a.action}</td>
    `;
    tbody.appendChild(tr);
  }
}

function instantRetuneArpeggios() {
  if (!state) return;
  const tk = getActiveTake();
  if (!tk) return;
  const t0 = performance.now();
  const baseMs = parseFloat($<HTMLInputElement>('arpSlider').value);
  const fixed = restoreArpeggios(state.scoreMidi, tk.rawNotes, state.rawAnnotations, baseMs);
  tk.restoredNotes = fixed.notes;
  tk.restoredDuration = fixed.duration;
  tk.arpeggios = fixed.arpeggios;
  tk.subtitle = `${fmtTime(fixed.duration)} · ${summarizeNotes(fixed.notes)}`;
  $('st4Stat').textContent = `${(performance.now() - t0).toFixed(1)} ms 即时重调`;
  renderTakesBar();
  renderAnnotationsUI(fixed.arpeggios);
  if (activeKey === 'final_restored' && !liveActive) {
    const cur = player.getCurrentTime();
    const wasPlaying = player.isPlaying;
    player.setTrack(fixed.notes, fixed.duration);
    if (wasPlaying) void player.play(cur);
  }
}

// =============================================================================
// Main 5-Stage Pipeline (includes Mode 1 Initial Batch Gacha!)
// =============================================================================
async function runFullBrowserPipeline() {
  const lyCode = $<HTMLTextAreaElement>('lyEditor').value.trim();
  if (!lyCode) return;
  if (liveActive) stopLiveConductor(false);

  player.stop(true);
  $('playBtn').textContent = '▶ 播放';
  $('errBox').style.display = 'none';
  const btn = $<HTMLButtonElement>('renderBtn');
  btn.disabled = true;
  setModesEnabled(false);
  btn.textContent = '⏳ 正在纯浏览器内运行 5 阶段流水线...';

  ['st1', 'st2', 'st3', 'st4'].forEach((id) => {
    $(id).classList.remove('done');
    $(id).classList.add('active');
  });

  try {
    const t1 = performance.now();
    if (!wasmPreloaded) {
      setProgress('Stage 1/5: 首次加载 LilyPond WebAssembly 引擎 (~31 MB)...', 5);
      $('st1Stat').textContent = '加载 WASM...';
      await compiler.preload({
        onProgress: ({ loadedBytes, totalBytes }: { loadedBytes: number; totalBytes: number }) => {
          if (totalBytes > 0) {
            const mb = (loadedBytes / 1e6).toFixed(1);
            const tot = (totalBytes / 1e6).toFixed(1);
            setProgress(`首次下载 LilyPond WASM 引擎: ${mb} / ${tot} MB...`, 5 + (loadedBytes / totalBytes) * 15);
          }
        },
      });
      wasmPreloaded = true;
      $('wasmDot').className = 'dot ok';
      $('wasmStatus').textContent = 'LilyPond WASM 就绪';
    }

    setProgress('Stage 1/5: 正在浏览器 WebAssembly 中编译 LilyPond (.ly → SVG + MIDI)...', 20);
    $('st1Stat').textContent = 'WASM 编译中...';
    $('st2Stat').textContent = 'Scheme 监听中...';
    const patchedLy = injectSchemeHook(lyCode);
    const wasmRes = await compiler.compile(patchedLy, { format: 'svg' });
    const dt1 = ((performance.now() - t1) / 1000).toFixed(2);

    const files = wasmRes.files || {};
    const midiKey = Object.keys(files).find((k) => k.endsWith('.midi') || k.endsWith('.mid'));
    if (!midiKey) throw new Error('LilyPond WASM 未输出 MIDI，请确认源码中包含 \\midi {} 块。');
    const scoreMidiBytes = files[midiKey] as Uint8Array;
    const scoreMidi = new Midi(scoreMidiBytes);

    if (state) state.svgUrls.forEach((u) => URL.revokeObjectURL(u));
    const svgKeys = Object.keys(files)
      .filter((k) => k.endsWith('.svg'))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const svgUrls = svgKeys.map((k) => {
      const data = files[k];
      const blob = new Blob([data instanceof Uint8Array ? (data as BlobPart) : String(data)], { type: 'image/svg+xml' });
      return URL.createObjectURL(blob);
    });

    let rawAnnotations: RawArpeggioAnnotation[] = [];
    if (files['annotations.json']) {
      const txt =
        files['annotations.json'] instanceof Uint8Array
          ? new TextDecoder().decode(files['annotations.json'])
          : String(files['annotations.json']);
      rawAnnotations = JSON.parse(txt);
    }

    $('st1').classList.remove('active');
    $('st1').classList.add('done');
    $('st1Stat').textContent = `${dt1}s · ${svgUrls.length} 页 SVG`;

    $('st2').classList.remove('active');
    $('st2').classList.add('done');
    $('st2Stat').textContent = `提取 ${rawAnnotations.length} 条事件`;

    const gal = $('svgGallery');
    gal.innerHTML = '';
    svgKeys.forEach((k) => {
      const data = files[k];
      const svgText = data instanceof Uint8Array ? new TextDecoder().decode(data) : String(data);
      const div = document.createElement('div');
      div.className = 'svg-page';
      div.style.color = '#111111';
      div.innerHTML = svgText;
      const svgEl = div.querySelector('svg');
      if (svgEl) {
        svgEl.style.width = '100%';
        svgEl.style.height = 'auto';
        svgEl.style.display = 'block';
      }
      gal.appendChild(div);
    });
    gal.scrollTop = 0;

    if (pianoFlow.provider === 'unloaded') {
      await pianoFlow.load((msg, pct) => {
        setProgress(`Stage 3/5: ${msg}`, 22 + (pct ?? 0) * 0.3);
        $('ortStatus').textContent = msg.slice(0, 28);
      });
      $('ortDot').className = 'dot ok';
      $('ortStatus').textContent = `PianoFlow (${pianoFlow.provider}) 就绪`;
    }

    const cfmSteps = parseInt($<HTMLInputElement>('stepsSlider').value, 10);
    const stepFactor = parseFloat($<HTMLInputElement>('factorSlider').value);
    const baseSeed = parseInt($<HTMLInputElement>('seedInput').value, 10) || 42;
    const batchCount = parseInt($<HTMLSelectElement>('batchCountSelect').value, 10) || 1;

    const t3 = performance.now();
    const generatedResults = [];
    for (let b = 0; b < batchCount; b++) {
      const sd = baseSeed + b;
      const pfOut = await pianoFlow.performScore(scoreMidi, {
        cfmSteps,
        stepFactor,
        seed: sd,
        onProgress: (done, total) => {
          const pct = total ? Math.round(((b + done / total) / batchCount) * 100) : 100;
          setProgress(
            `Stage 3/5: PianoFlow (${pianoFlow.provider}) 第 ${b + 1}/${batchCount} 版 (Seed ${sd}) ${done}/${total}...`,
            52 + pct * 0.43,
          );
          $('st3Stat').textContent = `${b + 1}/${batchCount} · ${pianoFlow.provider}`;
        },
      });
      generatedResults.push({ seed: sd, out: pfOut });
    }
    const dt3 = ((performance.now() - t3) / 1000).toFixed(2);
    $('st3').classList.remove('active');
    $('st3').classList.add('done');
    $('st3Stat').textContent = `${dt3}s · ${batchCount} 版`;

    setProgress('Stage 4/5: 正在执行符号级琶音精准还原...', 97);
    const t4 = performance.now();
    const firstOut = generatedResults[0].out;
    state = {
      scoreMidi,
      scoreNotes: firstOut.scoreNotes,
      scoreDuration: firstOut.scoreDuration,
      rawAnnotations,
      totalBars: firstOut.perfState.scoreData.totalBars,
      takes: [],
      activeTakeId: '',
      svgUrls,
    };

    generatedResults.forEach((item, idx) => {
      const tk = buildTakeRecord(
        `take_${Date.now()}_${idx}`,
        `🎲 #${idx + 1} 盲盒 (Seed ${item.seed})`,
        item.seed,
        item.out.perfState,
      );
      state!.takes.push(tk);
    });
    const dt4 = (performance.now() - t4).toFixed(1);
    $('st4').classList.remove('active');
    $('st4').classList.add('done');
    $('st4Stat').textContent = `${dt4} ms · ${state.takes[0].arpeggios.length} 处琶音`;

    (['playBtn', 'stopBtn', 'seekSlider', 'dlMidiBtn', 'exportWavBtn'] as const).forEach((id) => {
      $<HTMLButtonElement>(id).disabled = false;
    });
    syncBarBoundsUI(state.totalBars);
    setModesEnabled(true);
    activeKey = 'final_restored';
    selectTake(state.takes[0].id);
    setProgress(`✅ 全部 5 阶段纯浏览器完成！(${dt1}s 编译 + ${dt3}s AI × ${batchCount}版 + ${dt4}ms 还原)`, 100);
  } catch (err) {
    console.error(err);
    const msg = (err as Error).message || String(err);
    if (/unreachable|RuntimeError|abort/i.test(msg)) {
      // Recover cleanly from any WASM worker abort so next run starts fresh
      try {
        await (compiler as unknown as { dispose?: () => Promise<void> }).dispose?.();
      } catch {}
      compiler = createReusableCompiler();
      wasmPreloaded = false;
    }
    $('errBox').textContent = `❌ ${msg}`;
    $('errBox').style.display = 'block';
    ['st1', 'st2', 'st3', 'st4'].forEach((id) => $(id).classList.remove('active'));
  } finally {
    btn.disabled = false;
    btn.textContent = '🚀 纯浏览器执行 5 阶段 AI 演奏流水线';
    if (state) setModesEnabled(true);
  }
}

// =============================================================================
// Advanced PianoFlow Modes (Modes 1–7)
// =============================================================================
async function runModeTask(title: string, fn: () => Promise<void>) {
  if (!state || busyMode) return;
  if (liveActive) stopLiveConductor(false);
  busyMode = true;
  setModesEnabled(false);
  $('errBox').style.display = 'none';
  try {
    setProgress(`⏳ ${title}...`, 15);
    await fn();
  } catch (e) {
    console.error(e);
    $('errBox').textContent = `❌ ${(e as Error).message || String(e)}`;
    $('errBox').style.display = 'block';
  } finally {
    busyMode = false;
    setModesEnabled(true);
  }
}

// Mode 1: Multi-Take Batch Gacha
async function runMode1Batch() {
  if (!state) return;
  const count = parseInt($<HTMLSelectElement>('m1Count').value, 10) || 4;
  const startSeed = parseInt($<HTMLInputElement>('m1Seed').value, 10) || 100;
  const cfmSteps = parseInt($<HTMLInputElement>('stepsSlider').value, 10);
  const stepFactor = parseFloat($<HTMLInputElement>('factorSlider').value);

  await runModeTask(`玩法 ① 批量抽卡 (${count} 版)`, async () => {
    const t0 = performance.now();
    let lastId = '';
    for (let i = 0; i < count; i++) {
      const sd = startSeed + i;
      const res = await pianoFlow.performScore(state!.scoreMidi, {
        cfmSteps,
        stepFactor,
        seed: sd,
        onProgress: (d, tot) => {
          const pct = Math.round(((i + (tot ? d / tot : 1)) / count) * 100);
          setProgress(`🎲 批量盲盒抽卡：第 ${i + 1}/${count} 版 (Seed ${sd}) ${pct}%`, pct);
        },
      });
      const tk = buildTakeRecord(`m1_${Date.now()}_${i}`, `🎲 抽卡 (Seed ${sd})`, sd, res.perfState);
      state!.takes.push(tk);
      lastId = tk.id;
    }
    $<HTMLInputElement>('m1Seed').value = String(startSeed + count);
    selectTake(lastId);
    setProgress(`✅ 玩法 ① 完成！新增 ${count} 版进入版本池 (${((performance.now() - t0) / 1000).toFixed(2)}s)`, 100);
  });
}

// Mode 2: Prefix Lock Continuation
async function runMode2Continuation() {
  if (!state) return;
  const baseTake = getActiveTake();
  if (!baseTake) return;
  const lockBars = Math.max(1, Math.min(state.totalBars - 1, parseInt($<HTMLInputElement>('m2LockBars').value, 10) || 2));
  const count = parseInt($<HTMLSelectElement>('m2Count').value, 10) || 2;
  const startSeed = parseInt($<HTMLInputElement>('m2Seed').value, 10) || 202;
  const cfmSteps = parseInt($<HTMLInputElement>('stepsSlider').value, 10);
  const stepFactor = parseFloat($<HTMLInputElement>('factorSlider').value);

  await runModeTask(`玩法 ② 锁死前 ${lockBars} 小节续弹 (${count} 版)`, async () => {
    const t0 = performance.now();
    const scoreData = baseTake.perfState.scoreData;
    const N = scoreData.noteCount;
    const mask = new Uint8Array(N * 4);
    let unlockedNotes = 0;
    for (let i = 0; i < N; i++) {
      const unlock = scoreData.noteBars[i] > lockBars ? 1 : 0;
      if (unlock) unlockedNotes++;
      for (let j = 0; j < 4; j++) mask[i * 4 + j] = unlock;
    }
    if (unlockedNotes === 0) throw new Error('所有小节都已被锁死，请调小锁死小节数。');

    let lastId = '';
    for (let k = 0; k < count; k++) {
      const sd = startSeed + k;
      const res = await pianoFlow.performScore(state!.scoreMidi, {
        cfmSteps,
        stepFactor,
        seed: sd,
        baseState: clonePerfState(baseTake.perfState),
        maskMatrix: mask,
        onProgress: (d, tot) => {
          const pct = Math.round(((k + (tot ? d / tot : 1)) / count) * 100);
          setProgress(`✂️ 锁前 ${lockBars} 小节续弹：第 ${k + 1}/${count} 版 (${pct}%)`, pct);
        },
      });
      const tk = buildTakeRecord(
        `m2_${Date.now()}_${k}`,
        `✂️ 锁1–${lockBars}小节续弹 #${k + 1}`,
        sd,
        res.perfState,
      );
      state!.takes.push(tk);
      lastId = tk.id;
    }
    $<HTMLInputElement>('m2Seed').value = String(startSeed + count);
    selectTake(lastId);
    setProgress(
      `✅ 玩法 ② 完成！保留 1–${lockBars} 小节，重抽后面 ${count} 版 (${((performance.now() - t0) / 1000).toFixed(2)}s)`,
      100,
    );
  });
}

// Mode 3: Bidirectional Local Inpainting
async function runMode3Inpainting() {
  if (!state) return;
  const baseTake = getActiveTake();
  if (!baseTake) return;
  const sBar = Math.max(1, parseInt($<HTMLInputElement>('m3StartBar').value, 10) || 2);
  const eBar = Math.max(sBar, Math.min(state.totalBars, parseInt($<HTMLInputElement>('m3EndBar').value, 10) || sBar));
  const seed = parseInt($<HTMLInputElement>('m3Seed').value, 10) || 303;
  const cfmSteps = parseInt($<HTMLInputElement>('stepsSlider').value, 10);
  const stepFactor = parseFloat($<HTMLInputElement>('factorSlider').value);

  await runModeTask(`玩法 ③ 双向缝合局部重弹 (第 ${sBar}–${eBar} 小节)`, async () => {
    const t0 = performance.now();
    const scoreData = baseTake.perfState.scoreData;
    const N = scoreData.noteCount;
    const mask = new Uint8Array(N * 4);
    let countNotes = 0;
    for (let i = 0; i < N; i++) {
      const inside = scoreData.noteBars[i] >= sBar && scoreData.noteBars[i] <= eBar ? 1 : 0;
      if (inside) countNotes++;
      for (let j = 0; j < 4; j++) mask[i * 4 + j] = inside;
    }
    if (countNotes === 0) throw new Error(`第 ${sBar}–${eBar} 小节内未找到音符`);

    const res = await pianoFlow.performScore(state!.scoreMidi, {
      cfmSteps,
      stepFactor,
      seed,
      baseState: clonePerfState(baseTake.perfState),
      maskMatrix: mask,
      onProgress: (d, tot) => setProgress(`🩹 双向缝合第 ${sBar}–${eBar} 小节 (${d}/${tot} 音符)...`, (d / Math.max(1, tot)) * 100),
    });
    const tk = buildTakeRecord(`m3_${Date.now()}`, `🩹 重绘 ${sBar}–${eBar} 小节`, seed, res.perfState);
    state!.takes.push(tk);
    $<HTMLInputElement>('m3Seed').value = String(seed + 1);
    selectTake(tk.id);
    setProgress(
      `✅ 玩法 ③ 完成！已双向无缝重弹第 ${sBar}–${eBar} 小节 (${countNotes} 音，${((performance.now() - t0) / 1000).toFixed(2)}s)`,
      100,
    );
  });
}

// Mode 4: Per-Dimension Selective Resampling
async function runMode4DimensionResample() {
  if (!state) return;
  const baseTake = getActiveTake();
  if (!baseTake) return;
  const dims = [
    $<HTMLInputElement>('dimVel').checked ? 1 : 0,
    $<HTMLInputElement>('dimTime').checked ? 1 : 0,
    $<HTMLInputElement>('dimDur').checked ? 1 : 0,
    $<HTMLInputElement>('dimSus').checked ? 1 : 0,
  ];
  if (dims.every((x) => x === 0)) {
    alert('请至少勾选 1 个要重算的演奏维度！');
    return;
  }
  const sBar = Math.max(1, parseInt($<HTMLInputElement>('m4StartBar').value, 10) || 1);
  const eBar = Math.max(sBar, Math.min(state.totalBars, parseInt($<HTMLInputElement>('m4EndBar').value, 10) || state.totalBars));
  const seed = parseInt($<HTMLInputElement>('m4Seed').value, 10) || 404;
  const cfmSteps = parseInt($<HTMLInputElement>('stepsSlider').value, 10);
  const stepFactor = parseFloat($<HTMLInputElement>('factorSlider').value);

  const dimNames = ['力度', '呼吸', '触键', '踏板'].filter((_, i) => dims[i] === 1).join('+');

  await runModeTask(`玩法 ④ 拆维度重算 (${dimNames})`, async () => {
    const t0 = performance.now();
    const scoreData = baseTake.perfState.scoreData;
    const N = scoreData.noteCount;
    const mask = new Uint8Array(N * 4);
    for (let i = 0; i < N; i++) {
      const inRange = scoreData.noteBars[i] >= sBar && scoreData.noteBars[i] <= eBar;
      for (let j = 0; j < 4; j++) mask[i * 4 + j] = inRange && dims[j] ? 1 : 0;
    }

    const res = await pianoFlow.performScore(state!.scoreMidi, {
      cfmSteps,
      stepFactor,
      seed,
      baseState: clonePerfState(baseTake.perfState),
      maskMatrix: mask,
      onProgress: (d, tot) => setProgress(`🎛️ 拆维度重算 [${dimNames}] (${d}/${tot})...`, (d / Math.max(1, tot)) * 100),
    });
    const tk = buildTakeRecord(`m4_${Date.now()}`, `🎛️ 仅修${dimNames}`, seed, res.perfState);
    state!.takes.push(tk);
    $<HTMLInputElement>('m4Seed').value = String(seed + 1);
    selectTake(tk.id);
    setProgress(
      `✅ 玩法 ④ 完成！其余维度完全锁死，仅重算「${dimNames}」(${((performance.now() - t0) / 1000).toFixed(2)}s)`,
      100,
    );
  });
}

// Mode 5: Conductor Timeline
function loadDefaultConductorCues(totalBars: number) {
  if (totalBars >= 40) {
    // Clair de Lune / full piece dramatic architecture
    conductorCues = [
      { id: 'c1', startBar: 1, endBar: Math.min(14, totalBars), tempoScale: 0.85, velOffset: -18, strength: 0.85 },
      { id: 'c2', startBar: 15, endBar: Math.min(26, totalBars), tempoScale: 1.08, velOffset: 8, strength: 0.85 },
      { id: 'c3', startBar: 27, endBar: Math.min(42, totalBars), tempoScale: 1.18, velOffset: 22, strength: 0.9 },
      { id: 'c4', startBar: 43, endBar: totalBars, tempoScale: 0.82, velOffset: -20, strength: 0.85 },
    ];
  } else {
    const mid = Math.max(2, Math.floor(totalBars / 2));
    conductorCues = [
      { id: 'c1', startBar: 1, endBar: mid, tempoScale: 0.82, velOffset: -20, strength: 0.88 },
      { id: 'c2', startBar: Math.min(totalBars, mid + 1), endBar: totalBars, tempoScale: 1.22, velOffset: 24, strength: 0.9 },
    ];
  }
  renderCueList();
}

function renderCueList() {
  const list = $('cueList');
  list.innerHTML = '';
  conductorCues.forEach((cue, idx) => {
    const row = document.createElement('div');
    row.className = 'cue-item';
    row.innerHTML = `
      <span>第 <input type="number" min="1" value="${cue.startBar}" data-k="startBar" /> ~ <input type="number" min="1" value="${cue.endBar}" data-k="endBar" /> 小节</span>
      <span>速度 <input type="number" min="0.6" max="1.5" step="0.05" value="${cue.tempoScale.toFixed(2)}" data-k="tempoScale" />x</span>
      <span>力度 <input type="number" min="-40" max="40" step="2" value="${cue.velOffset}" data-k="velOffset" /></span>
      <span>引导 <input type="number" min="0.2" max="1.0" step="0.1" value="${cue.strength.toFixed(1)}" data-k="strength" /></span>
      <button class="btn btn-sm" data-del="${idx}" style="margin-left:auto;padding:3px 8px;">✕</button>
    `;
    row.querySelectorAll<HTMLInputElement>('input').forEach((inp) => {
      inp.onchange = () => {
        const k = inp.dataset.k as keyof ConductorCue;
        (cue[k] as number) = parseFloat(inp.value) || 0;
      };
    });
    const delBtn = row.querySelector<HTMLButtonElement>('[data-del]')!;
    delBtn.onclick = () => {
      conductorCues.splice(idx, 1);
      renderCueList();
    };
    list.appendChild(row);
  });
}

async function runMode5Conductor() {
  if (!state) return;
  if (!conductorCues.length) {
    alert('请先添加至少 1 个指挥段落！');
    return;
  }
  const seed = parseInt($<HTMLInputElement>('m5Seed').value, 10) || 505;
  const cfmSteps = parseInt($<HTMLInputElement>('stepsSlider').value, 10);
  const stepFactor = parseFloat($<HTMLInputElement>('factorSlider').value);

  await runModeTask(`玩法 ⑤ 分段指挥家 (${conductorCues.length} 段引导)`, async () => {
    const t0 = performance.now();
    const res = await pianoFlow.performScore(state!.scoreMidi, {
      cfmSteps,
      stepFactor,
      seed,
      cues: conductorCues,
      onProgress: (d, tot) => setProgress(`🎼 分段指挥 Flow 引导渲染 (${d}/${tot})...`, (d / Math.max(1, tot)) * 100),
    });
    const tk = buildTakeRecord(`m5_${Date.now()}`, `🎼 指挥家 (${conductorCues.length}段)`, seed, res.perfState);
    state!.takes.push(tk);
    $<HTMLInputElement>('m5Seed').value = String(seed + 1);
    selectTake(tk.id);
    setProgress(
      `✅ 玩法 ⑤ 完成！已按 ${conductorCues.length} 段指挥速度/力度曲线生成 (${((performance.now() - t0) / 1000).toFixed(2)}s)`,
      100,
    );
  });
}

// Mode 6: Real-Time Live Interactive Conductor (0.25s Sliding Window)
async function startLiveConductor() {
  if (!state || liveActive) return;
  if (!player.ready) {
    alert('钢琴音色还在加载中，请稍等 1 秒再启动！');
    return;
  }
  player.stop(true);
  const tempoScale = parseFloat($<HTMLInputElement>('liveTempoSlider').value);
  const velOffset = parseFloat($<HTMLInputElement>('liveVelSlider').value);

  liveSession = pianoFlow.createLiveSession(state.scoreMidi, {
    seed: Math.floor(Math.random() * 9000) + 100,
    cfmSteps: 5, // fast 5-step WebGPU ODE (~40–90ms per chunk!)
    tempoScale,
    velOffset,
  });
  liveActive = true;
  $<HTMLButtonElement>('m6StartBtn').disabled = true;
  $<HTMLButtonElement>('m6StopBtn').disabled = false;
  $('playBtn').textContent = '⏸ 暂停';
  $('liveStatus').textContent = '⏳ 正在预热首段 0.8s 实时滑动缓冲...';

  // Pre-buffer ~0.9s before starting audio playback
  while (liveActive && liveSession && !liveSession.finished && liveSession.getBufferHeadTime() < 0.9) {
    await liveSession.generateNextChunk(10);
  }
  if (!liveActive || !liveSession) return;

  await player.startLiveStream(liveSession.committedNotes, () => {
    if (liveActive) stopLiveConductor(true);
  });
  if (liveSession.finished) {
    const finalDur = liveSession.committedNotes.reduce((mx, n) => Math.max(mx, n.s + n.d), 0);
    player.finishLiveStream(finalDur);
  }

  $('liveStatus').textContent = `🎙️ 实时指挥中！随时拖动滑块 · 单块推理 ${liveSession.lastChunkMs} ms`;

  // Continuous 0.25s sliding-window lookahead pump
  liveLoopTimer = window.setInterval(async () => {
    if (!liveActive || !liveSession) return;
    const curT = player.getCurrentTime();
    const headT = liveSession.getBufferHeadTime();
    const barIdx = Math.min(liveSession.scoreData.noteCount - 1, Math.max(0, liveSession.generatedNoteCount - 1));
    const curBar = liveSession.scoreData.noteBars[barIdx] || 1;

    if (!liveSession.finished && headT < curT + 1.1) {
      const added = await liveSession.generateNextChunk(10);
      if (added.length && liveActive && liveSession) {
        player.hotReplaceNotes(liveSession.committedNotes, liveSession.finished ? headT + 1.0 : 9999);
        if (liveSession.finished) {
          const finalDur = liveSession.committedNotes.reduce((mx, n) => Math.max(mx, n.s + n.d), 0);
          player.finishLiveStream(finalDur);
        }
        $('liveStatus').textContent = `🎙️ 实时指挥中 · 缓冲至第 ${curBar}/${liveSession.scoreData.totalBars} 小节 · 响应 ${liveSession.lastChunkMs} ms`;
      }
    }
  }, 90);
}

async function onLiveSliderGesture() {
  const tempo = parseFloat($<HTMLInputElement>('liveTempoSlider').value);
  const vel = parseFloat($<HTMLInputElement>('liveVelSlider').value);
  const tTag = tempo < 0.9 ? '慢板' : tempo > 1.1 ? '急板' : '原速';
  const vTag = vel < -10 ? '柔和 pp' : vel > 10 ? '激昂 ff' : '自然';
  $('liveTempoVal').textContent = `${tempo.toFixed(2)}x (${tTag})`;
  $('liveVelVal').textContent = `${vel >= 0 ? '+' : ''}${vel} (${vTag})`;

  if (!liveActive || !liveSession) return;
  liveSession.tempoScale = tempo;
  liveSession.velOffset = vel;

  // Core Mode 6 magic: immediately drop unplayed notes beyond curTime + 0.25s and regenerate!
  const curT = player.getCurrentTime();
  liveSession.dropFutureAfter(curT + 0.25);
  $('liveStatus').textContent = `⚡ 已丢弃 0.25s 后缓存，实时重算新表情 (${tempo.toFixed(2)}x / ${vel >= 0 ? '+' : ''}${vel})...`;
  const added = await liveSession.generateNextChunk(10);
  if (added.length && liveActive && liveSession) {
    player.hotReplaceNotes(liveSession.committedNotes, liveSession.finished ? liveSession.getBufferHeadTime() + 1.0 : 9999);
    $('liveStatus').textContent = `🎙️ 已响应手势 (${liveSession.lastChunkMs} ms) · 当前 ${tempo.toFixed(2)}x / ${vel >= 0 ? '+' : ''}${vel}`;
  }
}

function stopLiveConductor(saveTake = true) {
  if (liveLoopTimer !== null) {
    window.clearInterval(liveLoopTimer);
    liveLoopTimer = null;
  }
  const sess = liveSession;
  liveActive = false;
  player.stop(true);
  $('playBtn').textContent = '▶ 播放';
  $<HTMLButtonElement>('m6StartBtn').disabled = !state;
  $<HTMLButtonElement>('m6StopBtn').disabled = true;

  if (saveTake && sess && state && sess.generatedNoteCount >= sess.scoreData.noteCount) {
    const tk = buildTakeRecord(`m6_${Date.now()}`, `🎚️ 实时指挥实录`, 77, sess.toPerfState());
    state.takes.push(tk);
    selectTake(tk.id);
    $('liveStatus').textContent = `✅ 实时指挥实录已保存到上方版本池！(共 ${sess.generatedNoteCount} 音)`;
  } else if (sess) {
    $('liveStatus').textContent = `已停止实时指挥（已实时演奏 ${sess.generatedNoteCount}/${sess.scoreData.noteCount} 音）`;
  }
  liveSession = null;
}

// Mode 7: Master Style Relay (Performance MIDI Alignment + Continuation)
async function runMode7MasterRelay() {
  if (!state || !refMasterMidi) return;
  const prefixBars = Math.max(1, Math.min(state.totalBars - 1, parseInt($<HTMLInputElement>('m7PrefixBars').value, 10) || 2));
  const seed = parseInt($<HTMLInputElement>('m7Seed').value, 10) || 707;
  const cfmSteps = parseInt($<HTMLInputElement>('stepsSlider').value, 10);
  const stepFactor = parseFloat($<HTMLInputElement>('factorSlider').value);

  await runModeTask(`玩法 ⑦ 大师风格接力 (${refMasterLabel})`, async () => {
    const t0 = performance.now();
    if (!pianoFlow.meta) await pianoFlow.load();

    // 1. Align human performance MIDI onto first `prefixBars` via Pure-TS DP Aligner
    const report = alignPerformanceMidiToScore(state!.scoreMidi, refMasterMidi!, prefixBars, pianoFlow.meta!);
    $('m7Status').textContent = `✅ DP 对齐完成：前 ${report.prefixBars} 小节匹配 ${report.alignedCount}/${report.prefixNoteCount} 音 (${Math.round(
      report.matchRate * 100,
    )}%) · 提取风格均力 ${report.avgVel} / 相对速度 ${report.avgTempoRatio}x → 正在由 PianoFlow 接力续弹...`;

    // 2. Run PianoFlow with locked aligned prefix
    const res = await pianoFlow.performScore(state!.scoreMidi, {
      cfmSteps,
      stepFactor,
      seed,
      baseState: report.baseState,
      maskMatrix: report.maskMatrix,
      onProgress: (d, tot) =>
        setProgress(`👑 大师风格接力续弹剩余小节 (${d}/${tot} 音符)...`, (d / Math.max(1, tot)) * 100),
    });

    const tk = buildTakeRecord(
      `m7_${Date.now()}`,
      `👑 ${refMasterLabel.slice(0, 8)}接力(前${prefixBars}小节)`,
      seed,
      res.perfState,
    );
    state!.takes.push(tk);
    $<HTMLInputElement>('m7Seed').value = String(seed + 1);
    selectTake(tk.id);
    const dt = ((performance.now() - t0) / 1000).toFixed(2);
    $('m7Status').textContent = `✅ 接力完成 (${dt}s)！前 ${report.prefixBars} 小节锁死「${refMasterLabel}」(匹配 ${Math.round(
      report.matchRate * 100,
    )}%)，后续全曲已由 PianoFlow 顺着大师触键风格续弹！`;
    setProgress(`✅ 玩法 ⑦ 大师风格接力完成！(${dt}s)`, 100);
  });
}

// =============================================================================
// 88-Key Animated Piano Roll Canvas
// =============================================================================
const canvas = $<HTMLCanvasElement>('pianoCanvas');
const ctx = canvas.getContext('2d')!;
const MIN_MIDI = 21;
const MAX_MIDI = 108;
const IS_BLACK = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];

function drawFrame() {
  const w = canvas.width;
  const h = canvas.height;
  const kbH = 44;
  const rollH = h - kbH;
  ctx.fillStyle = '#080c15';
  ctx.fillRect(0, 0, w, h);

  const keyW = w / (MAX_MIDI - MIN_MIDI + 1);
  for (let m = MIN_MIDI; m <= MAX_MIDI; m++) {
    if (m % 12 === 0) {
      const x = (m - MIN_MIDI) * keyW;
      ctx.strokeStyle = 'rgba(103,212,255,0.08)';
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, rollH);
      ctx.stroke();
    }
  }

  const pressed = new Map<number, number>();
  if (state || liveActive) {
    const tr = getActiveTrackData();
    const curT = player.getCurrentTime();
    if (player.isPlaying) {
      if (!liveActive) {
        $<HTMLInputElement>('seekSlider').value = String(Math.min(curT, tr.duration));
      }
      $('timeTxt').textContent = `${fmtTime(curT)} / ${fmtTime(tr.duration)}`;
    }
    const WINDOW_SEC = 4.5;
    for (const n of tr.notes) {
      if (n.s > curT + WINDOW_SEC) break;
      if (n.s + n.d < curT - 0.15) continue;
      const x = (n.p - MIN_MIDI) * keyW;
      const yBottom = rollH - ((n.s - curT) / WINDOW_SEC) * rollH;
      const yTop = rollH - ((n.s + n.d - curT) / WINDOW_SEC) * rollH;
      const rectH = Math.max(4, yBottom - yTop);
      const isNow = n.s <= curT && n.s + n.d >= curT;
      if (isNow) pressed.set(n.p, n.v);

      const alpha = 0.35 + 0.65 * (n.v / 127);
      if (liveActive) {
        ctx.fillStyle = isNow ? 'rgba(74,222,128,1)' : `rgba(103,212,255,${alpha.toFixed(2)})`;
      } else if (activeKey === 'final_restored') {
        ctx.fillStyle = isNow ? 'rgba(255,224,130,1)' : `rgba(240,201,117,${alpha.toFixed(2)})`;
      } else if (activeKey === 'pianoflow_raw') {
        ctx.fillStyle = isNow ? 'rgba(140,230,255,1)' : `rgba(103,212,255,${alpha.toFixed(2)})`;
      } else {
        ctx.fillStyle = isNow ? 'rgba(200,210,240,1)' : `rgba(139,152,188,${alpha.toFixed(2)})`;
      }
      ctx.fillRect(x + 1, yTop, Math.max(3, keyW - 2), rectH);
    }
  }

  for (let m = MIN_MIDI; m <= MAX_MIDI; m++) {
    if (IS_BLACK[m % 12]) continue;
    const x = (m - MIN_MIDI) * keyW;
    ctx.fillStyle = pressed.has(m) ? '#f0c975' : '#dce4f7';
    ctx.fillRect(x, rollH, keyW + 2, kbH);
    ctx.strokeStyle = '#1a2235';
    ctx.strokeRect(x, rollH, keyW + 2, kbH);
  }
  for (let m = MIN_MIDI; m <= MAX_MIDI; m++) {
    if (!IS_BLACK[m % 12]) continue;
    const x = (m - MIN_MIDI) * keyW;
    ctx.fillStyle = pressed.has(m) ? '#67d4ff' : '#111726';
    ctx.fillRect(x, rollH, keyW, kbH * 0.62);
  }
  requestAnimationFrame(drawFrame);
}
requestAnimationFrame(drawFrame);

// =============================================================================
// Bootstrap & Event Bindings
// =============================================================================
async function switchPianoTimbre(presetId: string) {
  const wasPlaying = player.isPlaying && !liveActive;
  const curT = player.getCurrentTime();
  if (wasPlaying) player.pause();
  try {
    const spec = await player.loadPreset(presetId, (loading, text) => {
      $('pianoDot').className = loading ? 'dot busy' : 'dot ok';
      $('pianoStatus').textContent = text;
      $('st5Stat').textContent = loading ? '加载音色中...' : specOrShort(presetId);
      if (!loading) $('st5').classList.add('done');
    });
    $('timbreDesc').textContent = `当前音色：${spec.desc}`;
    if (wasPlaying) {
      void player.play(curT, () => {
        $('playBtn').textContent = '▶ 播放';
      });
    }
  } catch (e) {
    $('pianoDot').className = 'dot';
    $('pianoStatus').textContent = '音色加载失败，请重试';
    console.error(e);
  }
}

function specOrShort(id: string): string {
  return PIANO_PRESETS.find((p) => p.id === id)?.shortName ?? 'SF2 Grand';
}

async function boot() {
  const timbreSel = $<HTMLSelectElement>('timbreSelect');
  for (const p of PIANO_PRESETS) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    timbreSel.appendChild(opt);
  }
  timbreSel.value = 'salamander_c5_multi';
  timbreSel.onchange = () => void switchPianoTimbre(timbreSel.value);

  const hallSel = $<HTMLSelectElement>('hallSelect');
  for (const h of HALL_IR_PRESETS) {
    const opt = document.createElement('option');
    opt.value = h.id;
    opt.textContent = h.name;
    hallSel.appendChild(opt);
  }
  hallSel.value = 'musikverein';
  hallSel.onchange = () => {
    void player.loadHallIr(hallSel.value).catch((err) => console.error('IR 加载失败:', err));
  };

  $<HTMLInputElement>('sf2Input').onchange = async (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    const wasPlaying = player.isPlaying && !liveActive;
    const curT = player.getCurrentTime();
    if (wasPlaying) player.pause();
    try {
      const name = await player.loadCustomSf2File(f, (loading, text) => {
        $('pianoDot').className = loading ? 'dot busy' : 'dot ok';
        $('pianoStatus').textContent = text;
        $('st5Stat').textContent = loading ? '加载本地 SF2...' : f.name.slice(0, 18);
        if (!loading) $('st5').classList.add('done');
      });
      $('timbreDesc').textContent = `当前音色：本地导入 SoundFont2 (${f.name}, ${(f.size / 1e6).toFixed(1)} MB) · 琴弦共鸣 + 音乐厅卷积`;
      const opt = document.createElement('option');
      opt.value = `custom_${f.name}`;
      opt.textContent = `📂 ${name} (本地 SF2)`;
      timbreSel.appendChild(opt);
      timbreSel.value = opt.value;
      if (wasPlaying) void player.play(curT, () => ($('playBtn').textContent = '▶ 播放'));
    } catch (err) {
      alert('本地 SF2 加载失败: ' + (err as Error).message);
    }
  };
  void switchPianoTimbre('salamander_c5_multi');

  // Load presets
  const presets: Record<string, { name: string; ly: string }> = {
    short_etude: { name: '⚡ 4 小节快速体验片段（含 3 处琶音，秒出声）', ly: SHORT_ETUDE_LY },
  };
  try {
    const r1 = await fetch('/presets/clair_de_lune.ly');
    if (r1.ok) presets.clair_de_lune = { name: '🌙 德彪西《月光》全曲（72 小节，7 处原谱琶音）', ly: await r1.text() };
  } catch {}
  try {
    const r2 = await fetch('/presets/rosee_dargent.ly');
    if (r2.ok) presets.rosee_dargent = { name: '✨ 原创印象派夜曲《银露》（48 小节）', ly: await r2.text() };
  } catch {}

  const sel = $<HTMLSelectElement>('presetSelect');
  for (const [k, v] of Object.entries(presets)) {
    const opt = document.createElement('option');
    opt.value = k;
    opt.textContent = v.name;
    sel.appendChild(opt);
  }
  sel.onchange = () => {
    const item = presets[sel.value];
    if (item) $<HTMLTextAreaElement>('lyEditor').value = item.ly;
  };
  sel.value = 'short_etude';
  sel.onchange(new Event('change'));

  // Sliders & core actions
  $<HTMLInputElement>('stepsSlider').oninput = (e) => {
    $('stepsVal').textContent = (e.target as HTMLInputElement).value;
  };
  $<HTMLInputElement>('factorSlider').oninput = (e) => {
    $('factorVal').textContent = parseFloat((e.target as HTMLInputElement).value).toFixed(2);
  };
  $<HTMLInputElement>('arpSlider').oninput = (e) => {
    $('arpVal').textContent = `${(e.target as HTMLInputElement).value} ms`;
    instantRetuneArpeggios();
  };
  $<HTMLInputElement>('reverbSlider').oninput = (e) => {
    player.setReverbWet(parseFloat((e.target as HTMLInputElement).value));
  };
  $<HTMLInputElement>('resSlider').oninput = (e) => {
    player.setResonanceAmount(parseFloat((e.target as HTMLInputElement).value));
  };
  $('renderBtn').onclick = runFullBrowserPipeline;
  $('playBtn').onclick = () => {
    if (liveActive) {
      stopLiveConductor(false);
      return;
    }
    if (player.isPlaying) {
      player.pause();
      $('playBtn').textContent = '▶ 播放';
    } else {
      $('playBtn').textContent = '⏸ 暂停';
      void player.play(undefined, () => ($('playBtn').textContent = '▶ 播放'));
    }
  };
  $('stopBtn').onclick = () => {
    if (liveActive) {
      stopLiveConductor(false);
      return;
    }
    player.stop(true);
    $('playBtn').textContent = '▶ 播放';
    $<HTMLInputElement>('seekSlider').value = '0';
    if (state) $('timeTxt').textContent = `00:00 / ${fmtTime(getActiveTrackData().duration)}`;
  };
  $<HTMLInputElement>('seekSlider').oninput = (e) => {
    if (liveActive) return;
    const t = parseFloat((e.target as HTMLInputElement).value);
    player.seek(t);
    if (state) $('timeTxt').textContent = `${fmtTime(t)} / ${fmtTime(getActiveTrackData().duration)}`;
  };
  document.querySelectorAll<HTMLButtonElement>('.ab-btn').forEach((b) => {
    b.onclick = () => selectTrack(b.dataset.track as TrackKey);
  });
  document.querySelectorAll<HTMLButtonElement>('.tab-btn').forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll('.tab-btn').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      $('tabSheet').style.display = b.dataset.tab === 'sheet' ? 'block' : 'none';
      $('tabAnn').style.display = b.dataset.tab === 'ann' ? 'block' : 'none';
    };
  });
  $<HTMLInputElement>('fileInput').onchange = async (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) $<HTMLTextAreaElement>('lyEditor').value = await f.text();
  };
  $('dlMidiBtn').onclick = () => {
    if (!state) return;
    const tr = getActiveTrackData();
    const bytes = notesToMidiBytes(tr.notes, activeKey);
    const blob = new Blob([bytes as BlobPart], { type: 'audio/midi' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pianora_${activeKey}.mid`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };
  $('exportWavBtn').onclick = async () => {
    if (!state) return;
    const btn = $<HTMLButtonElement>('exportWavBtn');
    btn.disabled = true;
    btn.textContent = '⏳ 渲染 WAV...';
    try {
      const tr = getActiveTrackData();
      const wet = parseFloat($<HTMLInputElement>('reverbSlider').value);
      const resAmt = parseFloat($<HTMLInputElement>('resSlider').value);
      const blob = await player.renderOfflineWav(tr.notes, tr.duration, wet, resAmt);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pianora_${activeKey}.wav`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) {
      alert('WAV 导出失败: ' + (e as Error).message);
    } finally {
      btn.disabled = false;
      btn.textContent = '🎵 导出 WAV';
    }
  };

  // ===========================================================================
  // 7-Mode Workbench Event Bindings
  // ===========================================================================
  document.querySelectorAll<HTMLButtonElement>('.mode-pill').forEach((pill) => {
    pill.onclick = () => {
      document.querySelectorAll('.mode-pill').forEach((x) => x.classList.remove('active'));
      document.querySelectorAll('.mode-pane').forEach((x) => x.classList.remove('active'));
      pill.classList.add('active');
      $(`pane-${pill.dataset.mode}`).classList.add('active');
    };
  });

  $('m1RunBtn').onclick = runMode1Batch;
  $('m2RunBtn').onclick = runMode2Continuation;
  $('m3RunBtn').onclick = runMode3Inpainting;
  $('m4RunBtn').onclick = runMode4DimensionResample;
  document.querySelectorAll<HTMLButtonElement>('.m4-preset').forEach((b) => {
    b.onclick = () => {
      const [v, t, d, s] = (b.dataset.dims || '1,0,0,0').split(',').map((x) => x === '1');
      $<HTMLInputElement>('dimVel').checked = v;
      $<HTMLInputElement>('dimTime').checked = t;
      $<HTMLInputElement>('dimDur').checked = d;
      $<HTMLInputElement>('dimSus').checked = s;
    };
  });

  $('addCueBtn').onclick = () => {
    const maxB = state?.totalBars ?? 4;
    const lastEnd = conductorCues.length ? conductorCues[conductorCues.length - 1].endBar : 0;
    const sB = Math.min(maxB, lastEnd + 1);
    conductorCues.push({
      id: `c_${Date.now()}`,
      startBar: sB,
      endBar: maxB,
      tempoScale: 1.0,
      velOffset: 0,
      strength: 0.85,
    });
    renderCueList();
  };
  $('presetMoonCueBtn').onclick = () => loadDefaultConductorCues(state?.totalBars ?? 4);
  $('m5RunBtn').onclick = runMode5Conductor;

  $('liveTempoSlider').oninput = () => void onLiveSliderGesture();
  $('liveVelSlider').oninput = () => void onLiveSliderGesture();
  $('m6StartBtn').onclick = () => void startLiveConductor();
  $('m6StopBtn').onclick = () => stopLiveConductor(true);

  $<HTMLInputElement>('m7MidiInput').onchange = async (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    try {
      const ab = await f.arrayBuffer();
      refMasterMidi = new Midi(ab);
      refMasterLabel = f.name.replace(/\.(mid|midi)$/i, '');
      const noteCnt = refMasterMidi.tracks.reduce((acc, t) => acc + t.notes.length, 0);
      $('m7Status').textContent = `🎹 已载入参考演奏「${f.name}」(${noteCnt} 音) — 点击「对齐并开始大师接力」`;
      if (state) $<HTMLButtonElement>('m7RunBtn').disabled = false;
    } catch (err) {
      alert('MIDI 读取失败: ' + (err as Error).message);
    }
  };
  $('m7DemoPoeticBtn').onclick = () => {
    if (!state) return;
    refMasterMidi = synthesizeRomanticDemoMidi(state.scoreMidi, 'debussy_poetic');
    refMasterLabel = '浪漫诗意大师';
    $('m7Status').textContent = '🌙 已载入「浪漫诗意大师引子」（舒缓呼吸 + 歌唱性高声部 + 绵长踏板）— 点击右侧按钮开始接力！';
    $<HTMLButtonElement>('m7RunBtn').disabled = false;
  };
  $('m7DemoDramaticBtn').onclick = () => {
    if (!state) return;
    refMasterMidi = synthesizeRomanticDemoMidi(state.scoreMidi, 'horowitz_dramatic');
    refMasterLabel = '戏剧炫技大师';
    $('m7Status').textContent = '🔥 已载入「戏剧炫技大师引子」（紧凑推进 + 强对比触键）— 点击右侧按钮开始接力！';
    $<HTMLButtonElement>('m7RunBtn').disabled = false;
  };
  $('m7RunBtn').onclick = runMode7MasterRelay;

  loadDefaultConductorCues(4);
}

boot();
