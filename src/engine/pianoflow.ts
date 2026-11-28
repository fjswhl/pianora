import { LocalizedError, message, type DisplayText } from '../i18n';
/**
 * Pure-TypeScript SyMuPe/PianoFlow-base inference engine running 100% in the browser
 * via onnxruntime-web (WebGPU with automatic WASM fallback).
 *
 * Implements ALL 7 advanced PianoFlow workflows natively in-browser:
 *  1. Multi-take Batch Gacha (numTakes, cfmSteps, cfmStepFactor, seed)
 *  2. Continuation / Prefix Lock (lock bars 1..K, regenerate K+1..end)
 *  3. Bidirectional Inpainting (lock before Bar A & after Bar B, seamlessly repaint A..B)
 *  4. Per-Dimension Resampling (selectively unmask Velocity / TimeShift / Touch / Sustain Pedal)
 *  5. Conductor Timeline (bar-range Tempo & Dynamics Guided Flow Matching ODE steering)
 *  6. Live Real-Time Interactive Conductor (0.25s sliding window + instant drop-future re-steering)
 *  7. Master Style Relay (pure-TS DP score-to-performance MIDI alignment -> prefix lock -> continue)
 */
import type * as Ort from 'onnxruntime-web';
import { pianoFlowRelease, releaseUrl } from './assetRelease';
import { packedAsset, ortWasmPath } from './assetPacks';
import { assetLoadMessage, downloadBytes } from './download';
import { Midi } from '@tonejs/midi';
import type { SimpleNote } from './arpeggio';

export interface TokenizerMeta {
  token_types: string[];
  value_keys: string[];
  value_indices: number[];
  value_mean: number[];
  value_std: number[];
  sigma: number;
  special_tokens: Record<string, number>;
  special_tokens_value: number;
  max_num_pos_per_beat: number;
  pitch_range: [number, number];
  token_values_norm: Record<string, number[]>;
  token_values_raw: Record<string, number[]>;
}

export interface TokenizedScore {
  noteCount: number;
  pitches: number[];
  noteBars: number[]; // 1-based bar index for each note
  totalBars: number;
  scoreTokens: Int32Array; // [N, 4]
  scoreValues: Float32Array; // [N, 4]
  scoreSimpleNotes: SimpleNote[];
  scoreDuration: number;
}

export interface PerfState {
  allTokens: Int32Array; // [(N + 1) * 8] row 0 = BOS
  allValues: Float32Array; // [(N + 1) * 8]
  scoreData: TokenizedScore;
}

export interface ConductorCue {
  id: string;
  startBar: number;
  endBar: number;
  tempoScale: number; // 0.65 (much slower) .. 1.0 .. 1.45 (much faster)
  velOffset: number; // -40 (ppp) .. 0 .. +40 (fff) in MIDI velocity units
  strength: number; // 0.0 .. 1.0 Flow guidance strength
}

export interface PerformResult {
  scoreNotes: SimpleNote[];
  scoreDuration: number;
  perfDryNotes: SimpleNote[];
  perfSustainNotes: SimpleNote[];
  perfDuration: number;
  perfState: PerfState;
}

export interface PerformOptions {
  cfmSteps?: number;
  stepFactor?: number;
  seed?: number;
  maxSeqLen?: number;
  maxNewNotes?: number;
  baseState?: PerfState;
  /** [N * 4] uint8 mask: 1 = generate/resample, 0 = lock from baseState */
  maskMatrix?: Uint8Array;
  /** Mode 5: Bar-based Conductor Timeline cues (Guided Flow Matching) */
  cues?: ConductorCue[];
  /** Optional explicit global note-range to run windows over (inclusive 0-based note indices) */
  activeRange?: [number, number];
  onProgress?: (doneNotes: number, totalNotes: number) => void;
}

export interface AlignmentReport {
  alignedCount: number;
  prefixNoteCount: number;
  prefixBars: number;
  matchRate: number;
  avgVel: number;
  avgTempoRatio: number;
  baseState: PerfState;
  maskMatrix: Uint8Array;
}

const BOS_ID = 2;
const MASK_ID = 1;
const BOS_VAL = -102.0;
const MASK_VAL = -101.0;

/** Deterministic mulberry32 PRNG + Box-Muller Gaussian sampler */
function createGaussianRng(seed: number): () => number {
  let a = seed >>> 0;
  const rand = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let spare: number | null = null;
  return () => {
    if (spare !== null) {
      const v = spare;
      spare = null;
      return v;
    }
    let u = 0;
    let v = 0;
    while (u <= 1e-12) u = rand();
    v = rand();
    const mag = Math.sqrt(-2.0 * Math.log(u));
    spare = mag * Math.sin(2.0 * Math.PI * v);
    return mag * Math.cos(2.0 * Math.PI * v);
  };
}

/** Find closest valid non-special token ID (>= 9) in sorted table */
function findClosestTokenId(val: number, table: number[], startIdx = 9): number {
  let lo = startIdx;
  let hi = table.length - 1;
  if (val <= table[lo]) return lo;
  if (val >= table[hi]) return hi;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (table[mid] < val) lo = mid + 1;
    else hi = mid - 1;
  }
  const left = Math.max(startIdx, hi);
  const right = Math.min(table.length - 1, lo);
  return Math.abs(val - table[left]) <= Math.abs(val - table[right]) ? left : right;
}

/** Build Flow Matching time schedule matching SyMuPe (cfm_step_factor = 0.75) */
function buildTimeSteps(steps: number, stepFactor = 0.75): number[] {
  if (stepFactor >= 0.9999) {
    return Array.from({ length: steps + 1 }, (_, i) => i / steps);
  }
  const logsp = Array.from({ length: steps + 1 }, (_, i) => Math.pow(stepFactor, i));
  const diffs: number[] = [];
  let sum = 0;
  for (let i = 0; i < steps; i++) {
    const d = -(logsp[i + 1] - logsp[i]);
    diffs.push(d);
    sum += d;
  }
  const ts = [0.0];
  let acc = 0;
  for (let i = 0; i < steps; i++) {
    acc += diffs[i] / sum;
    ts.push(Math.min(1.0, acc));
  }
  ts[steps] = 1.0;
  return ts;
}

/** Build smooth per-note conductor curves from bar cues */
function buildConductorCurves(
  noteBars: number[],
  cues?: ConductorCue[],
): { tempoScale: Float32Array; velOffsetNorm: Float32Array; strength: Float32Array } | null {
  if (!cues || cues.length === 0) return null;
  const N = noteBars.length;
  const tempoScale = new Float32Array(N).fill(1.0);
  const velOffsetNorm = new Float32Array(N).fill(0.0);
  const strength = new Float32Array(N).fill(0.0);

  for (let i = 0; i < N; i++) {
    const bar = noteBars[i];
    for (const c of cues) {
      if (bar >= c.startBar && bar <= c.endBar) {
        tempoScale[i] = Math.max(0.55, Math.min(1.6, c.tempoScale));
        velOffsetNorm[i] = Math.max(-0.45, Math.min(0.45, c.velOffset / 127.0));
        strength[i] = Math.max(0, Math.min(1.0, c.strength));
      }
    }
  }

  // Smooth over a 5-note window so cue boundaries feel musical and organic
  const smTempo = new Float32Array(N);
  const smVel = new Float32Array(N);
  const smStr = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let tSum = 0;
    let vSum = 0;
    let sSum = 0;
    let cnt = 0;
    for (let k = Math.max(0, i - 2); k <= Math.min(N - 1, i + 2); k++) {
      tSum += tempoScale[k];
      vSum += velOffsetNorm[k];
      sSum += strength[k];
      cnt++;
    }
    smTempo[i] = tSum / cnt;
    smVel[i] = vSum / cnt;
    smStr[i] = sSum / cnt;
  }
  return { tempoScale: smTempo, velOffsetNorm: smVel, strength: smStr };
}

/** Reconstruct dry & sustain SimpleNote arrays from PerfState */
export function decodePerfState(perfState: PerfState): {
  perfDryNotes: SimpleNote[];
  perfSustainNotes: SimpleNote[];
  perfDuration: number;
} {
  const { allValues, scoreData } = perfState;
  const N = scoreData.noteCount;
  const perfDryNotes: SimpleNote[] = [];
  const perfSustainNotes: SimpleNote[] = [];
  let curSec = 0;
  for (let i = 0; i < N; i++) {
    const rOff = (i + 1) * 8;
    const vel = Math.max(12, Math.min(122, Math.round(allValues[rOff + 4] * 127)));
    const dt = i === 0 ? Math.max(0, allValues[rOff + 5]) : allValues[rOff + 5];
    curSec = Math.max(0, curSec + dt);
    const dryDur = Math.max(0.04, allValues[rOff + 6]);
    const susDur = Math.max(dryDur, allValues[rOff + 7]);

    const pitch = scoreData.pitches[i];
    perfDryNotes.push({ p: pitch, s: Number(curSec.toFixed(4)), d: Number(dryDur.toFixed(4)), v: vel });
    perfSustainNotes.push({ scoreTime: scoreData.scoreSimpleNotes[i].s, p: pitch, s: Number(curSec.toFixed(4)), d: Number(susDur.toFixed(4)), v: vel });
  }
  const perfDuration = perfSustainNotes.reduce((mx, n) => Math.max(mx, n.s + n.d), 0);
  return { perfDryNotes, perfSustainNotes, perfDuration: Number(perfDuration.toFixed(2)) };
}

export function clonePerfState(st: PerfState): PerfState {
  return {
    allTokens: new Int32Array(st.allTokens),
    allValues: new Float32Array(st.allValues),
    scoreData: st.scoreData,
  };
}

/**
 * Exact pure-TS score tokenizer matching SyMuPe (OctupleM + PositionShift),
 * now also emitting 1-based bar numbers for every note!
 */
export function tokenizeScoreMidi(scoreMidi: Midi, meta: TokenizerMeta): TokenizedScore {
  const ppq = scoreMidi.header.ppq || 384;
  const maxPosPerBeat = meta.max_num_pos_per_beat || 24;
  const posPerWhole = maxPosPerBeat * 4; // 96

  const tsList = scoreMidi.header.timeSignatures.length
    ? [...scoreMidi.header.timeSignatures].sort((a, b) => a.ticks - b.ticks)
    : [{ ticks: 0, timeSignature: [4, 4] }];

  const rawNotes: Array<{ ticks: number; durTicks: number; pitch: number; time: number; durSec: number; vel: number }> = [];
  for (const tr of scoreMidi.tracks) {
    for (const n of tr.notes) {
      rawNotes.push({
        ticks: n.ticks,
        durTicks: Math.max(1, n.durationTicks),
        pitch: Math.max(meta.pitch_range[0], Math.min(meta.pitch_range[1], n.midi)),
        time: n.time,
        durSec: Math.max(0.03, n.duration),
        vel: Math.max(1, Math.min(127, Math.round(n.velocity * 127))),
      });
    }
  }
  rawNotes.sort((a, b) => a.ticks - b.ticks || a.pitch - b.pitch);

  const maxTick = rawNotes.reduce((mx, n) => Math.max(mx, n.ticks + n.durTicks), ppq * 4);

  const barStarts: number[] = [0];
  let curTick = 0;
  let tsIdx = 0;
  while (curTick <= maxTick + ppq * 8) {
    while (tsIdx + 1 < tsList.length && tsList[tsIdx + 1].ticks <= curTick) tsIdx++;
    const [num, den] = tsList[tsIdx].timeSignature;
    const barLenTicks = Math.round((ppq * (4.0 * num)) / den);
    curTick += Math.max(1, barLenTicks);
    barStarts.push(curTick);
  }

  const N = rawNotes.length;
  const scoreTokens = new Int32Array(N * 4);
  const scoreValues = new Float32Array(N * 4);
  const pitches: number[] = new Array(N);
  const noteBars: number[] = new Array(N);
  const scoreSimpleNotes: SimpleNote[] = new Array(N);

  const pitchTbl = meta.token_values_raw['Pitch'];
  const posTbl = meta.token_values_raw['Position'];
  const shiftTbl = meta.token_values_raw['PositionShift'];
  const durTbl = meta.token_values_raw['Duration'];

  let prevPosAbs = 0;
  let barIdx = 0;

  for (let i = 0; i < N; i++) {
    const n = rawNotes[i];
    while (barIdx + 1 < barStarts.length && barStarts[barIdx + 1] <= n.ticks) barIdx++;

    const posInBarRaw = ((n.ticks - barStarts[barIdx]) / ppq) * maxPosPerBeat;
    const posAbsRaw = (n.ticks / ppq) * maxPosPerBeat;
    const shiftRaw = i === 0 ? posInBarRaw : Math.max(0, posAbsRaw - prevPosAbs);
    prevPosAbs = posAbsRaw;
    const durRaw = (n.durTicks / ppq) * maxPosPerBeat;

    const pId = findClosestTokenId(n.pitch, pitchTbl);
    const posId = findClosestTokenId(posInBarRaw, posTbl);
    const shiftId = findClosestTokenId(shiftRaw, shiftTbl);
    const durId = findClosestTokenId(durRaw, durTbl);

    const base = i * 4;
    scoreTokens[base + 0] = pId;
    scoreTokens[base + 1] = posId;
    scoreTokens[base + 2] = shiftId;
    scoreTokens[base + 3] = durId;

    scoreValues[base + 0] = n.pitch / 127.0;
    scoreValues[base + 1] = posInBarRaw / posPerWhole;
    scoreValues[base + 2] = shiftRaw / posPerWhole;
    scoreValues[base + 3] = durRaw / posPerWhole;

    pitches[i] = n.pitch;
    noteBars[i] = barIdx + 1; // 1-based bar number
    scoreSimpleNotes[i] = {
      p: n.pitch,
      s: Number(n.time.toFixed(4)),
      d: Number(n.durSec.toFixed(4)),
      v: n.vel,
    };
  }

  const totalBars = noteBars.length ? noteBars[noteBars.length - 1] : 0;
  const scoreDuration = scoreSimpleNotes.reduce((mx, n) => Math.max(mx, n.s + n.d), 0);
  return {
    noteCount: N,
    pitches,
    noteBars,
    totalBars,
    scoreTokens,
    scoreValues,
    scoreSimpleNotes,
    scoreDuration: Number(scoreDuration.toFixed(2)),
  };
}

/**
 * Mode 7 Helper: Pure-TS Dynamic Programming (Needleman-Wunsch / Monotonic Pitch-Sequence)
 * Score-to-Performance Aligner (inspired by RAScoP).
 * Aligns a human pianist's performance MIDI onto the first `prefixBars` of the score and builds
 * a locked PerfState + maskMatrix ready for PianoFlow style continuation!
 */
export function alignPerformanceMidiToScore(
  scoreMidi: Midi,
  perfMidi: Midi,
  prefixBars: number,
  meta: TokenizerMeta,
): AlignmentReport {
  const scoreData = tokenizeScoreMidi(scoreMidi, meta);
  const N = scoreData.noteCount;
  let prefixCount = 0;
  while (prefixCount < N && scoreData.noteBars[prefixCount] <= prefixBars) prefixCount++;
  prefixCount = Math.max(1, Math.min(N - 1, prefixCount));

  // Extract & sort human performance notes (incorporate CC64 sustain pedal if present!)
  const perfNotes: Array<{ pitch: number; start: number; dryDur: number; susDur: number; vel: number }> = [];
  for (const tr of perfMidi.tracks) {
    // Collect sustain pedal intervals on this track
    const cc64 = tr.controlChanges[64] ? [...tr.controlChanges[64]].sort((a, b) => a.time - b.time) : [];
    const pedalUpTimes = cc64.filter((c) => c.value < 0.5).map((c) => c.time);
    const pedalDownIntervals: Array<[number, number]> = [];
    let downStart: number | null = null;
    for (const c of cc64) {
      if (c.value >= 0.5 && downStart === null) downStart = c.time;
      else if (c.value < 0.5 && downStart !== null) {
        pedalDownIntervals.push([downStart, c.time]);
        downStart = null;
      }
    }

    for (const n of tr.notes) {
      const end = n.time + Math.max(0.03, n.duration);
      let susEnd = end;
      for (const [pStart, pEnd] of pedalDownIntervals) {
        if (end >= pStart - 0.02 && end <= pEnd) {
          susEnd = Math.max(susEnd, pEnd);
          break;
        }
      }
      if (susEnd === end && pedalUpTimes.length === 0) {
        susEnd = end;
      }
      perfNotes.push({
        pitch: n.midi,
        start: n.time,
        dryDur: Math.max(0.04, n.duration),
        susDur: Math.max(0.04, susEnd - n.time),
        vel: Math.max(12, Math.min(125, Math.round(n.velocity * 127))),
      });
    }
  }
  perfNotes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);

  // Limit alignment search window to first ~2.2x prefix notes of performance MIDI
  const M = Math.min(perfNotes.length, Math.max(prefixCount + 24, Math.round(prefixCount * 2.2)));
  const K = prefixCount;

  // Dynamic Programming alignment maximizing exact pitch matches + penalizing gaps
  const cols = M + 1;
  const dp = new Int32Array((K + 1) * cols);
  const bt = new Uint8Array((K + 1) * cols); // 1=diag, 2=up(skip score), 3=left(skip perf)

  const GAP_SCORE = -3;
  const GAP_PERF = -2;
  const MATCH = 6;
  const OCTAVE = 1;
  const MISMATCH = -5;

  for (let i = 1; i <= K; i++) {
    dp[i * cols] = i * GAP_SCORE;
    bt[i * cols] = 2;
  }
  for (let j = 1; j <= M; j++) {
    dp[j] = j * GAP_PERF;
    bt[j] = 3;
  }

  for (let i = 1; i <= K; i++) {
    const sp = scoreData.pitches[i - 1];
    const rowOff = i * cols;
    const prevOff = (i - 1) * cols;
    for (let j = 1; j <= M; j++) {
      const pp = perfNotes[j - 1].pitch;
      const sub = sp === pp ? MATCH : Math.abs(sp - pp) === 12 ? OCTAVE : MISMATCH;
      const dVal = dp[prevOff + (j - 1)] + sub;
      const uVal = dp[prevOff + j] + GAP_SCORE;
      const lVal = dp[rowOff + (j - 1)] + GAP_PERF;
      if (dVal >= uVal && dVal >= lVal) {
        dp[rowOff + j] = dVal;
        bt[rowOff + j] = 1;
      } else if (uVal >= lVal) {
        dp[rowOff + j] = uVal;
        bt[rowOff + j] = 2;
      } else {
        dp[rowOff + j] = lVal;
        bt[rowOff + j] = 3;
      }
    }
  }

  // Find best ending column j in last row (semi-global on performance tail!)
  let bestJ = M;
  let bestVal = -1e9;
  for (let j = Math.max(1, Math.floor(K * 0.5)); j <= M; j++) {
    if (dp[K * cols + j] > bestVal) {
      bestVal = dp[K * cols + j];
      bestJ = j;
    }
  }

  const matchedPerfIdx = new Int32Array(K).fill(-1);
  let ci = K;
  let cj = bestJ;
  let alignedCount = 0;
  while (ci > 0 && cj > 0) {
    const move = bt[ci * cols + cj];
    if (move === 1) {
      if (scoreData.pitches[ci - 1] === perfNotes[cj - 1].pitch) {
        matchedPerfIdx[ci - 1] = cj - 1;
        alignedCount++;
      }
      ci--;
      cj--;
    } else if (move === 2) {
      ci--;
    } else {
      cj--;
    }
  }

  // Build PerfState locking aligned prefix notes (interpolate any unmatched note cleanly)
  const totalLen = N + 1;
  const allTokens = new Int32Array(totalLen * 8);
  const allValues = new Float32Array(totalLen * 8);
  const maskMatrix = new Uint8Array(N * 4).fill(1);

  for (let c = 0; c < 8; c++) {
    allTokens[c] = BOS_ID;
    allValues[c] = BOS_VAL;
  }

  const velTbl = meta.token_values_norm['Velocity'];
  const tsTbl = meta.token_values_norm['TimeShift'];
  const tdTbl = meta.token_values_norm['TimeDuration'];
  const tdsTbl = meta.token_values_norm['TimeDurationSustain'];

  let prevStart = 0;
  let firstMatchedTime: number | null = null;
  for (let i = 0; i < K; i++) {
    if (matchedPerfIdx[i] >= 0) {
      firstMatchedTime = perfNotes[matchedPerfIdx[i]].start;
      break;
    }
  }
  const tOrigin = firstMatchedTime ?? 0;

  let velSum = 0;
  let scoreSpan = 0;
  let perfSpan = 0;

  for (let i = 0; i < N; i++) {
    const rOff = (i + 1) * 8;
    const sOff = i * 4;
    for (let c = 0; c < 4; c++) {
      allTokens[rOff + c] = scoreData.scoreTokens[sOff + c];
      allValues[rOff + c] = scoreData.scoreValues[sOff + c];
    }

    if (i < K) {
      const mIdx = matchedPerfIdx[i];
      let velNorm: number;
      let dt: number;
      let dryDur: number;
      let susDur: number;

      if (mIdx >= 0) {
        const pn = perfNotes[mIdx];
        const relT = Math.max(0, pn.start - tOrigin);
        velNorm = Math.max(0.05, Math.min(1.0, pn.vel / 127.0));
        dt = i === 0 ? 0.0 : Math.max(-0.08, Math.min(6.0, relT - prevStart));
        prevStart = relT;
        dryDur = Math.max(0.04, Math.min(8.0, pn.dryDur));
        susDur = Math.max(dryDur, Math.min(10.0, pn.susDur));
      } else {
        // Fallback smoothly from score timing scaled by current tempo ratio
        const sn = scoreData.scoreSimpleNotes[i];
        const prevSn = i > 0 ? scoreData.scoreSimpleNotes[i - 1] : sn;
        const ratio = scoreSpan > 0.1 && perfSpan > 0.1 ? perfSpan / scoreSpan : 1.0;
        dt = i === 0 ? 0.0 : Math.max(0, (sn.s - prevSn.s) * ratio);
        prevStart += dt;
        velNorm = Math.max(0.08, Math.min(0.95, sn.v / 127.0));
        dryDur = Math.max(0.04, sn.d * ratio);
        susDur = Math.max(dryDur, dryDur * 1.45);
      }

      if (i > 0) {
        scoreSpan = Math.max(scoreSpan, scoreData.scoreSimpleNotes[i].s);
        perfSpan = Math.max(perfSpan, prevStart);
      }
      velSum += velNorm * 127;

      const vals = [velNorm, dt, dryDur, susDur];
      const tbls = [velTbl, tsTbl, tdTbl, tdsTbl];
      for (let j = 0; j < 4; j++) {
        allValues[rOff + 4 + j] = vals[j];
        allTokens[rOff + 4 + j] = findClosestTokenId(vals[j], tbls[j]);
        maskMatrix[i * 4 + j] = 0; // LOCKED prefix!
      }
    } else {
      for (let c = 4; c < 8; c++) {
        allTokens[rOff + c] = MASK_ID;
        allValues[rOff + c] = MASK_VAL;
      }
    }
  }

  const avgTempoRatio = perfSpan > 0.1 && scoreSpan > 0.1 ? scoreSpan / perfSpan : 1.0;
  return {
    alignedCount,
    prefixNoteCount: K,
    prefixBars,
    matchRate: K > 0 ? alignedCount / K : 0,
    avgVel: K > 0 ? Math.round(velSum / K) : 64,
    avgTempoRatio: Number(avgTempoRatio.toFixed(2)),
    baseState: { allTokens, allValues, scoreData },
    maskMatrix,
  };
}

/**
 * Create a realistic built-in "Romantic Master Intro" performance MIDI from any score
 * (so users can immediately test Mode 7 Style Relay even without supplying an external .mid file).
 */
export function synthesizeRomanticDemoMidi(
  scoreMidi: Midi,
  style: 'debussy_poetic' | 'horowitz_dramatic' = 'debussy_poetic',
): Midi {
  const out = new Midi();
  out.header.setTempo(120);
  const tr = out.addTrack();
  const notes: Array<{ midi: number; time: number; dur: number; vel: number }> = [];
  for (const t of scoreMidi.tracks) {
    for (const n of t.notes) {
      notes.push({ midi: n.midi, time: n.time, dur: n.duration, vel: n.velocity });
    }
  }
  notes.sort((a, b) => a.time - b.time || a.midi - b.midi);

  let warpedT = 0;
  let prevRawT = notes.length ? notes[0].time : 0;
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i];
    const dtRaw = Math.max(0, n.time - prevRawT);
    prevRawT = n.time;

    // Expressive rubato curve + melody voicing + lush sustain
    const phrasePhase = (i % 16) / 16;
    const rubato =
      style === 'debussy_poetic'
        ? 1.24 + 0.18 * Math.sin(phrasePhase * Math.PI * 2) // slower, dreamy rubato
        : 0.84 - 0.12 * Math.sin(phrasePhase * Math.PI * 2); // urgent, virtuosic drive
    warpedT += dtRaw * rubato;

    // Right-hand melody singing slightly louder than accompaniment
    const melodyBoost = n.midi >= 64 ? 0.14 : -0.06;
    const baseVel = style === 'debussy_poetic' ? 0.36 : 0.68;
    const dynArch = 0.14 * Math.sin(phrasePhase * Math.PI);
    const vel = Math.max(0.14, Math.min(0.96, baseVel + melodyBoost + dynArch));
    const susScale = style === 'debussy_poetic' ? 1.85 : 1.15;

    tr.addNote({
      midi: n.midi,
      time: warpedT,
      duration: Math.max(0.08, n.dur * rubato * susScale),
      velocity: vel,
    });
  }
  return out;
}

export class BrowserPianoFlow {
  private runtime?: typeof Ort;
  private session: Ort.InferenceSession | null = null;
  public meta: TokenizerMeta | null = null;
  public provider = 'unloaded';

  async load(onProgress?: (msg: DisplayText, pct?: number) => void, signal?: AbortSignal): Promise<void> {
    if (this.session && this.meta) return;
    const modelStart = performance.now();
    const [ort, tokenizer, modelBytes, wasm] = await Promise.all([
      import('onnxruntime-web'),
      pianoFlowRelease.tokenizer(),
      downloadBytes(releaseUrl(pianoFlowRelease.model), (loaded, total, parts) => {
        onProgress?.(assetLoadMessage(message("PianoFlow 模型"), loaded, total, parts), 12 + Math.round(loaded / total * 70));
      }, signal).then(bytes => {
        performance.measure('pianora:model-bytes', { start: modelStart });
        return bytes;
      }),
      packedAsset(ortWasmPath) ? downloadBytes(ortWasmPath, undefined, signal) : undefined,
    ]);
    signal?.throwIfAborted();
    this.runtime = ort;
    this.meta = { ...tokenizer.default, pitch_range: [tokenizer.default.pitch_range[0], tokenizer.default.pitch_range[1]] };
    ort.env.wasm.wasmPaths = { wasm: new URL(ortWasmPath, location.href).href };
    ort.env.wasm.wasmBinary = wasm;
    ort.env.wasm.numThreads = 1;

    const hasWebGPU = typeof navigator !== 'undefined' && 'gpu' in navigator;
    if (hasWebGPU) {
      try {
        onProgress?.(message("初始化 WebGPU 推理引擎..."), 88);
        this.session = await ort.InferenceSession.create(modelBytes, {
          executionProviders: ['webgpu'],
        });
        ort.env.wasm.wasmBinary = undefined;
        this.provider = 'WebGPU';
        onProgress?.(message("PianoFlow-base (WebGPU) 就绪！"), 100);
        return;
      } catch (e) {
        console.warn('[PianoFlow] WebGPU init failed, falling back to WASM:', e);
      }
    }

    onProgress?.(message("初始化 WebAssembly (WASM) 推理引擎..."), 90);
    this.session = await ort.InferenceSession.create(modelBytes, {
      executionProviders: ['wasm'],
    });
    ort.env.wasm.wasmBinary = undefined;
    this.provider = 'WASM';
    onProgress?.(message("PianoFlow-base (WASM) 就绪！"), 100);
  }

  /**
   * Core Flow Matching Window Solver.
   * Solves ODE over [winStart .. winEnd) (1-based global row indices including BOS at 0),
   * clamping all unmasked cells and optionally applying Guided Flow Matching steering for Conductor cues!
   */
  async solveWindow(
    allTokens: Int32Array,
    allValues: Float32Array,
    winStart: number,
    winEnd: number,
    writeStart: number,
    writeEnd: number,
    opts: {
      cfmSteps: number;
      stepFactor: number;
      rng: () => number;
      conductor?: {
        tempoScale: Float32Array;
        velOffsetNorm: Float32Array;
        strength: Float32Array;
      } | null;
      liveOverride?: { tempoScale: number; velOffsetNorm: number; strength: number } | null;
    },
  ): Promise<void> {
    const meta = this.meta!;
    const session = this.session!;
    const L = winEnd - winStart;
    if (L <= 1) return;

    const vMean = meta.value_mean;
    const vStd = meta.value_std;
    const sigma = meta.sigma;
    const perfTables = [
      meta.token_values_norm['Velocity'],
      meta.token_values_norm['TimeShift'],
      meta.token_values_norm['TimeDuration'],
      meta.token_values_norm['TimeDurationSustain'],
    ];

    const wTokens = new BigInt64Array(L * 8);
    const wValues = new Float32Array(L * 8);
    const x1 = new Float32Array(L * 4);
    const x0 = new Float32Array(L * 4);
    const xt = new Float32Array(L * 4);
    const isMasked = new Uint8Array(L * 4);
    const wMask = new Uint8Array(L).fill(1);

    let anyMasked = false;
    for (let row = 0; row < L; row++) {
      const gRow = winStart + row;
      for (let c = 0; c < 8; c++) {
        wTokens[row * 8 + c] = BigInt(allTokens[gRow * 8 + c]);
        wValues[row * 8 + c] = allValues[gRow * 8 + c];
      }
      for (let j = 0; j < 4; j++) {
        const tid = allTokens[gRow * 8 + (4 + j)];
        const val = allValues[gRow * 8 + (4 + j)];
        const idx4 = row * 4 + j;
        const m = tid === MASK_ID ? 1 : 0;
        isMasked[idx4] = m;
        if (m) anyMasked = true;
        x1[idx4] = val <= -100.0 ? 0.0 : (val - vMean[j]) / vStd[j];
        const noise = opts.rng();
        x0[idx4] = noise;
        xt[idx4] = noise;
      }
    }

    if (!anyMasked) return;

    const ort = this.runtime!;
    const tokTensor = new ort.Tensor('int64', wTokens, [1, L, 8]);
    const valTensor = new ort.Tensor('float32', wValues, [1, L, 8]);
    const maskTensor = new ort.Tensor('bool', wMask, [1, L]);
    const timeSteps = buildTimeSteps(opts.cfmSteps, opts.stepFactor);

    for (let s = 0; s < opts.cfmSteps; s++) {
      const t = timeSteps[s];
      const dt = timeSteps[s + 1] - t;

      // Clamp unmasked context / locked dimensions onto conditional flow trajectory
      for (let idx4 = 0; idx4 < L * 4; idx4++) {
        if (!isMasked[idx4]) {
          xt[idx4] = (1 - (1 - sigma) * t) * x0[idx4] + t * x1[idx4];
        }
      }

      const vecTensor = new ort.Tensor('float32', xt, [1, L, 4]);
      const tsTensor = new ort.Tensor('float32', new Float32Array([t]), [1]);
      const out = await session.run({
        tokens: tokTensor,
        values: valTensor,
        vectors: vecTensor,
        time_steps: tsTensor,
        mask: maskTensor,
      });
      const ut = out.u_t.data as Float32Array;

      // Apply Euler step + optional Guided Flow Matching conductor steering!
      const hasGuide = Boolean(opts.conductor || opts.liveOverride);
      for (let row = 0; row < L; row++) {
        const gRow = winStart + row;
        const noteIdx = gRow - 1;
        let tScale = 1.0;
        let vOff = 0.0;
        let gStr = 0.0;

        if (hasGuide && noteIdx >= 0) {
          if (opts.liveOverride) {
            tScale = opts.liveOverride.tempoScale;
            vOff = opts.liveOverride.velOffsetNorm;
            gStr = opts.liveOverride.strength;
          } else if (opts.conductor && noteIdx < opts.conductor.strength.length) {
            tScale = opts.conductor.tempoScale[noteIdx];
            vOff = opts.conductor.velOffsetNorm[noteIdx];
            gStr = opts.conductor.strength[noteIdx];
          }
        }

        for (let j = 0; j < 4; j++) {
          const idx4 = row * 4 + j;
          const d = ut[idx4];
          if (!Number.isFinite(d)) continue;
          let stepDir = d;

          // Guided Flow Matching (Tweedie/CFM endpoint steering on masked cells)
          if (gStr > 0.01 && isMasked[idx4]) {
            const x1Hat = xt[idx4] + (1.0 - t) * d;
            const valHat = x1Hat * vStd[j] + vMean[j];
            let targetVal = valHat;

            if (j === 0 && Math.abs(vOff) > 0.005) {
              // Steer dynamics (Velocity) smoothly inside the ODE
              targetVal = Math.max(0.08, Math.min(0.97, valHat + vOff));
            } else if (j === 1 && Math.abs(tScale - 1.0) > 0.01 && valHat > 0.025) {
              // Steer macro tempo (TimeShift) while preserving micro-timing chords (<= 25ms)
              targetVal = Math.max(0.01, Math.min(6.0, valHat / tScale));
            } else if ((j === 2 || j === 3) && Math.abs(tScale - 1.0) > 0.01) {
              // Harmonize articulation & sustain duration proportionally with tempo
              const durFactor = 1.0 / (0.35 + 0.65 * tScale);
              targetVal = Math.max(0.04, Math.min(9.0, valHat * durFactor));
            }

            if (targetVal !== valHat) {
              const targetNorm = (targetVal - vMean[j]) / vStd[j];
              // Smooth steering impulse integrated across the ODE trajectory
              stepDir += gStr * 1.15 * (targetNorm - x1Hat);
            }
          }

          xt[idx4] += stepDir * dt;
        }
      }
    }

    // Write back ONLY masked cells inside [writeStart .. writeEnd)
    for (let gRow = writeStart; gRow < writeEnd; gRow++) {
      const row = gRow - winStart;
      for (let j = 0; j < 4; j++) {
        const idx4 = row * 4 + j;
        if (!isMasked[idx4]) continue;
        let pred = xt[idx4] * vStd[j] + vMean[j];
        if (j === 0) pred = Math.max(0.05, Math.min(1.0, pred));
        else if (j === 1) pred = Math.max(-0.12, Math.min(8.0, pred));
        else pred = Math.max(0.03, Math.min(10.0, pred));

        allValues[gRow * 8 + (4 + j)] = pred;
        allTokens[gRow * 8 + (4 + j)] = findClosestTokenId(pred, perfTables[j]);
      }
    }
  }

  /**
   * Unified Flow Matching runner supporting ALL batch / continuation / inpainting /
   * per-dimension resampling / conductor-guided / style-relay workflows!
   */
  async performScore(scoreMidi: Midi, opts: PerformOptions = {}): Promise<PerformResult> {
    if (!this.session || !this.meta) await this.load();
    const meta = this.meta!;

    const cfmSteps = opts.cfmSteps ?? 10;
    const stepFactor = opts.stepFactor ?? 0.75;
    const maxSeqLen = opts.maxSeqLen ?? 192;
    const maxNewNotes = opts.maxNewNotes ?? 64;
    const rng = createGaussianRng(opts.seed ?? 42);

    const tokData = opts.baseState ? opts.baseState.scoreData : tokenizeScoreMidi(scoreMidi, meta);
    const N = tokData.noteCount;
    if (N === 0) {
      const emptyState: PerfState = {
        allTokens: new Int32Array(8),
        allValues: new Float32Array(8),
        scoreData: tokData,
      };
      return {
        scoreNotes: [],
        scoreDuration: 0,
        perfDryNotes: [],
        perfSustainNotes: [],
        perfDuration: 0,
        perfState: emptyState,
      };
    }

    const totalLen = N + 1;
    let allTokens: Int32Array;
    let allValues: Float32Array;

    if (opts.baseState) {
      allTokens = new Int32Array(opts.baseState.allTokens);
      allValues = new Float32Array(opts.baseState.allValues);
    } else {
      allTokens = new Int32Array(totalLen * 8);
      allValues = new Float32Array(totalLen * 8);
      for (let c = 0; c < 8; c++) {
        allTokens[c] = BOS_ID;
        allValues[c] = BOS_VAL;
      }
      for (let i = 0; i < N; i++) {
        const rOff = (i + 1) * 8;
        const sOff = i * 4;
        for (let c = 0; c < 4; c++) {
          allTokens[rOff + c] = tokData.scoreTokens[sOff + c];
          allValues[rOff + c] = tokData.scoreValues[sOff + c];
        }
        for (let c = 4; c < 8; c++) {
          allTokens[rOff + c] = MASK_ID;
          allValues[rOff + c] = MASK_VAL;
        }
      }
    }

    // Apply explicit cell-level maskMatrix (Modes 2, 3, 4, 7)
    if (opts.maskMatrix) {
      for (let i = 0; i < N; i++) {
        const rOff = (i + 1) * 8;
        for (let j = 0; j < 4; j++) {
          if (opts.maskMatrix[i * 4 + j]) {
            allTokens[rOff + 4 + j] = MASK_ID;
            allValues[rOff + 4 + j] = MASK_VAL;
          }
        }
      }
    }

    // Determine exact [firstMaskedNote .. lastMaskedNote] span so we skip already-locked prefixes/suffixes!
    let firstMasked = -1;
    let lastMasked = -1;
    for (let i = 0; i < N; i++) {
      const rOff = (i + 1) * 8;
      if (
        allTokens[rOff + 4] === MASK_ID ||
        allTokens[rOff + 5] === MASK_ID ||
        allTokens[rOff + 6] === MASK_ID ||
        allTokens[rOff + 7] === MASK_ID
      ) {
        if (firstMasked === -1) firstMasked = i;
        lastMasked = i;
      }
    }

    if (opts.activeRange) {
      firstMasked = Math.max(0, opts.activeRange[0]);
      lastMasked = Math.min(N - 1, opts.activeRange[1]);
    }

    const conductor = buildConductorCurves(tokData.noteBars, opts.cues);

    if (firstMasked !== -1 && lastMasked >= firstMasked) {
      const hasRightContext =
        lastMasked < N - 1 &&
        allTokens[(lastMasked + 2) * 8 + 4] !== MASK_ID &&
        allTokens[(lastMasked + 2) * 8 + 5] !== MASK_ID;

      const totalWork = lastMasked - firstMasked + 1;
      let cursor = firstMasked;
      opts.onProgress?.(0, totalWork);

      while (cursor <= lastMasked) {
        const chunkEndNote = Math.min(lastMasked + 1, cursor + maxNewNotes);
        const writeStart = cursor + 1; // 1-based global row
        const writeEnd = chunkEndNote + 1;

        let winStart: number;
        let winEnd: number;
        if (hasRightContext) {
          // Mode 3 / 4 Bidirectional Inpainting: center window to include BOTH left & right locked context!
          const chunkLen = writeEnd - writeStart;
          const spare = Math.max(0, maxSeqLen - chunkLen);
          const leftPad = Math.floor(spare * 0.55);
          const rightPad = spare - leftPad;
          winStart = Math.max(0, writeStart - leftPad);
          winEnd = Math.min(totalLen, writeEnd + rightPad);
          if (winEnd - winStart < maxSeqLen) {
            winStart = Math.max(0, winEnd - maxSeqLen);
          }
        } else {
          // Causal / prefix-conditioned sliding window (Modes 1, 2, 5, 7)
          winEnd = writeEnd;
          winStart = Math.max(0, winEnd - maxSeqLen);
        }

        await this.solveWindow(allTokens, allValues, winStart, winEnd, writeStart, writeEnd, {
          cfmSteps,
          stepFactor,
          rng,
          conductor,
        });

        cursor = chunkEndNote;
        opts.onProgress?.(cursor - firstMasked, totalWork);
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    const perfState: PerfState = { allTokens, allValues, scoreData: tokData };
    const decoded = decodePerfState(perfState);
    return {
      scoreNotes: tokData.scoreSimpleNotes,
      scoreDuration: tokData.scoreDuration,
      perfDryNotes: decoded.perfDryNotes,
      perfSustainNotes: decoded.perfSustainNotes,
      perfDuration: decoded.perfDuration,
      perfState,
    };
  }

  /**
   * Mode 6: Real-Time Interactive Live Conductor Session (`time_window = 0.25s`).
   * Continuously generates small upcoming chunks ahead of playback; whenever the user drags
   * Live Tempo or Live Dynamics sliders, drops unplayed future notes beyond `curTime + 0.25s`
   * and immediately re-steers the AI pianist's expression on the fly!
   */
  createLiveSession(
    scoreMidi: Midi,
    opts: { seed?: number; cfmSteps?: number; tempoScale?: number; velOffset?: number } = {},
  ): LiveConductorSession {
    if (!this.meta) throw new LocalizedError("PianoFlow 模型尚未加载");
    return new LiveConductorSession(this, scoreMidi, this.meta, opts);
  }
}

export class LiveConductorSession {
  private pf: BrowserPianoFlow;
  public scoreData: TokenizedScore;
  public allTokens: Int32Array;
  public allValues: Float32Array;
  public committedNotes: SimpleNote[] = [];
  public generatedNoteCount = 0; // how many notes [0..generatedNoteCount-1] currently generated
  public finished = false;

  public tempoScale: number;
  public velOffset: number; // MIDI units -40..+40
  public cfmSteps: number;
  private rng: () => number;
  private noteStartTimes: number[] = [];
  private busy = false;
  public lastChunkMs = 0;

  constructor(
    pf: BrowserPianoFlow,
    scoreMidi: Midi,
    meta: TokenizerMeta,
    opts: { seed?: number; cfmSteps?: number; tempoScale?: number; velOffset?: number },
  ) {
    this.pf = pf;
    this.scoreData = tokenizeScoreMidi(scoreMidi, meta);
    this.tempoScale = opts.tempoScale ?? 1.0;
    this.velOffset = opts.velOffset ?? 0;
    this.cfmSteps = opts.cfmSteps ?? 5;
    this.rng = createGaussianRng(opts.seed ?? 77);

    const N = this.scoreData.noteCount;
    this.allTokens = new Int32Array((N + 1) * 8);
    this.allValues = new Float32Array((N + 1) * 8);
    for (let c = 0; c < 8; c++) {
      this.allTokens[c] = BOS_ID;
      this.allValues[c] = BOS_VAL;
    }
    for (let i = 0; i < N; i++) {
      const rOff = (i + 1) * 8;
      const sOff = i * 4;
      for (let c = 0; c < 4; c++) {
        this.allTokens[rOff + c] = this.scoreData.scoreTokens[sOff + c];
        this.allValues[rOff + c] = this.scoreData.scoreValues[sOff + c];
      }
      for (let c = 4; c < 8; c++) {
        this.allTokens[rOff + c] = MASK_ID;
        this.allValues[rOff + c] = MASK_VAL;
      }
    }
  }

  getBufferHeadTime(): number {
    if (!this.noteStartTimes.length) return 0;
    return this.noteStartTimes[this.noteStartTimes.length - 1];
  }

  /**
   * Drop all unplayed cached future notes beyond `cutoffSec` (e.g. curPlayhead + 0.25s)
   * and re-mask them so the next chunk reflects the user's new slider gesture immediately!
   */
  dropFutureAfter(cutoffSec: number): number {
    let keep = this.noteStartTimes.length;
    while (keep > 0 && this.noteStartTimes[keep - 1] > cutoffSec) {
      keep--;
    }
    const dropped = this.generatedNoteCount - keep;
    if (dropped > 0) {
      for (let i = keep; i < this.generatedNoteCount; i++) {
        const rOff = (i + 1) * 8;
        for (let c = 4; c < 8; c++) {
          this.allTokens[rOff + c] = MASK_ID;
          this.allValues[rOff + c] = MASK_VAL;
        }
      }
      this.noteStartTimes.length = keep;
      this.committedNotes.length = keep;
      this.generatedNoteCount = keep;
      this.finished = false;
    }
    return keep;
  }

  /** Generate one small real-time lookahead chunk (8–12 notes) and return the newly produced SimpleNotes */
  async generateNextChunk(chunkNotes = 10): Promise<SimpleNote[]> {
    if (this.busy || this.finished) return [];
    const N = this.scoreData.noteCount;
    if (this.generatedNoteCount >= N) {
      this.finished = true;
      return [];
    }

    this.busy = true;
    const t0 = performance.now();
    try {
      const startNote = this.generatedNoteCount;
      const endNote = Math.min(N, startNote + chunkNotes);
      const writeStart = startNote + 1;
      const writeEnd = endNote + 1;
      const winStart = Math.max(0, writeEnd - 96); // compact 96-note live context for ultra-low latency!

      // Ensure target rows are masked
      for (let i = startNote; i < endNote; i++) {
        const rOff = (i + 1) * 8;
        for (let c = 4; c < 8; c++) {
          this.allTokens[rOff + c] = MASK_ID;
          this.allValues[rOff + c] = MASK_VAL;
        }
      }

      const hasOverride = Math.abs(this.tempoScale - 1.0) > 0.02 || Math.abs(this.velOffset) > 1.5;
      await this.pf.solveWindow(this.allTokens, this.allValues, winStart, writeEnd, writeStart, writeEnd, {
        cfmSteps: this.cfmSteps,
        stepFactor: 0.75,
        rng: this.rng,
        liveOverride: hasOverride
          ? {
              tempoScale: this.tempoScale,
              velOffsetNorm: this.velOffset / 127.0,
              strength: 0.9,
            }
          : null,
      });

      const outNotes: SimpleNote[] = [];
      let curSec = this.noteStartTimes.length ? this.noteStartTimes[this.noteStartTimes.length - 1] : 0;

      for (let i = startNote; i < endNote; i++) {
        const rOff = (i + 1) * 8;
        const vel = Math.max(12, Math.min(122, Math.round(this.allValues[rOff + 4] * 127)));
        const dt = i === 0 ? Math.max(0, this.allValues[rOff + 5]) : this.allValues[rOff + 5];
        curSec = Math.max(0, curSec + dt);
        const dryDur = Math.max(0.04, this.allValues[rOff + 6]);
        const susDur = Math.max(dryDur, this.allValues[rOff + 7]);

        const sn: SimpleNote = {
          scoreTime: this.scoreData.scoreSimpleNotes[i].s,
          p: this.scoreData.pitches[i],
          s: Number(curSec.toFixed(4)),
          d: Number(susDur.toFixed(4)),
          v: vel,
        };
        this.noteStartTimes.push(curSec);
        this.committedNotes.push(sn);
        outNotes.push(sn);
      }

      this.generatedNoteCount = endNote;
      if (this.generatedNoteCount >= N) this.finished = true;
      this.lastChunkMs = Math.round(performance.now() - t0);
      return outNotes;
    } finally {
      this.busy = false;
    }
  }

  toPerfState(): PerfState {
    return {
      allTokens: new Int32Array(this.allTokens),
      allValues: new Float32Array(this.allValues),
      scoreData: this.scoreData,
    };
  }
}

/** Serialize SimpleNote[] back to a standard downloadable .mid Uint8Array */
export function notesToMidiBytes(notes: SimpleNote[], name = 'PianoFlow', pedals: import('./performance/types').Pedal[] = []): Uint8Array {
  const midi = new Midi();
  midi.header.setTempo(120);
  const tr = midi.addTrack();
  tr.name = name;
  tr.instrument.number = 0;
  for (const n of notes) {
    tr.addNote({
      midi: n.p,
      time: n.s,
      duration: n.d,
      velocity: Math.max(0.01, Math.min(1.0, n.v / 127)),
    });
  }
  for (const cc of pedals) tr.addCC({number:cc.number,time:cc.time,value:cc.value/127});
  return midi.toArray();
}
