import { float, ints, values, type Run, type Tensor } from './runtime';
import type { ModelScore, Performance, Progress } from './types';

const ranges = [
  [5, 133],
  [261, 5252],
  [133, 261],
  [261, 5261],
  [5261, 5389],
  [5261, 5389],
  [5261, 5389],
  [5261, 5389],
];

function sample(scores: Float32Array, lo: number, hi: number, random: () => number) {
  if (hi === lo + 1) return lo;
  const sorted = Array.from({ length: hi - lo }, (_, i) => lo + i).sort((a, b) => scores[b] - scores[a]);
  const max = scores[sorted[0]];
  const weights = sorted.map((i) => Math.exp(scores[i] - max));
  const threshold = weights.reduce((x, y) => x + y, 0) * 0.95;
  let count = 0,
    sum = 0;
  while (count < weights.length && sum < threshold) sum += weights[count++];
  let pick = random() * sum;
  for (let i = 0; i < count; i++) {
    pick -= weights[i];
    if (pick <= 0) return sorted[i];
  }
  return sorted[0];
}

// The timing vocabulary ends at about five seconds. Keep overflow on the score
// clock while feeding the saturated token back to the autoregressive decoder.
const timingStart = ranges[1][0];

function sampleMillis(
  logits: Float32Array, column: 1 | 3, target: number, early: number, late: number, random: () => number,
) {
  const limit = ranges[column][1] - timingStart - 1;
  const overflow = Math.max(0, target - limit);
  const center = target - overflow;
  const low = Math.max(column === 3 ? 1 : 0, center - early);
  const high = Math.min(limit, center + late);
  return overflow + sample(logits, timingStart + low, timingStart + high + 1, random) - timingStart;
}

function onsetGroups(notes: ModelScore['notes'], starts: number[]) {
  const groups = [];
  let previousFirst = 0;
  let soundingUntilQuarter = 0;
  for (let first = 0; first < notes.length;) {
    let end = first + 1;
    while (end < starts.length && starts[end] === starts[first]) end++;
    const beat = 60000 / notes[first].bpm;
    const after = (starts[end] ?? Infinity) - starts[first];
    const spread = Math.floor(Math.min(30, beat / 20, after / 4));
    const restQuarters = Math.max(0, notes[first].quarter - soundingUntilQuarter);
    const group = { first, previousFirst, spread, restQuarters };
    previousFirst = first;
    for (let i = first; i < end; i++) {
      groups.push(group);
      soundingUntilQuarter = Math.max(soundingUntilQuarter, notes[i].quarter + notes[i].length);
    }
    first = end;
  }
  return groups;
}

export async function pianist(
  score: ModelScore,
  run: Run,
  random: () => number,
  progress: Progress,
): Promise<Performance> {
  const { notes, pedals } = score;
  const tokens: number[] = [];
  const starts = notes.map((n) => Math.round(n.s * 1000));
  let pedalIndex = 0,
    pedal = 0;
  for (const [i, n] of notes.entries()) {
    const step = ((starts[i + 1] ?? starts[i] + 4990) - starts[i]) / 4;
    const row = [
      5 + n.p,
      261 + starts[i] - (starts[i - 1] ?? 0),
      133 + n.v,
      261 + Math.max(1, Math.round((n.s + n.d) * 1000) - starts[i]),
    ];
    for (let p = 0; p < 4; p++) {
      while (pedalIndex < pedals.length && pedals[pedalIndex].time * 1000 <= starts[i] + p * step)
        pedal = pedals[pedalIndex++].value;
      row.push(5261 + pedal);
    }
    tokens.push(...row.map((v, j) => Math.min(ranges[j][1] - 1, Math.max(ranges[j][0], v))));
  }
  const groups = onsetGroups(notes, starts);
  // Index tempo history by score onset so rewriting a decoder window also
  // rewinds the tempo estimates. Chord tones share their first strike's pulse.
  const beatTrend: number[] = [];
  const phraseTrend: number[] = [];
  const pulse: number[] = [];
  const onsets: number[] = [];

  function nextInterval(i: number, logits: Float32Array) {
    const { first, previousFirst, spread, restQuarters } = groups[i];
    if (i === 0) {
      beatTrend[i] = phraseTrend[i] = 0;
      pulse[i] = 1;
      return starts[i]; // Keep the written lead-in.
    }
    if (i !== first) {
      const remaining = spread - (onsets[i - 1] - onsets[first]);
      return sampleMillis(logits, 1, 0, 0, remaining, random);
    }

    const gap = starts[i] - starts[previousFirst];
    const rolled = onsets[i - 1] - onsets[previousFirst];
    const quarters = notes[i].quarter - notes[previousFirst].quarter;
    const meterLength = notes[i].numerator * 4 / notes[i].denominator;
    // A written rest spanning a full measure carries the accumulated time offset through
    // the silence and gives the next entrance a fresh pulse.
    if (restQuarters >= meterLength) {
      beatTrend[i] = phraseTrend[i] = 0;
      pulse[i] = 1;
      return gap - rolled;
    }
    const movable = Math.min(gap, 90000 / notes[previousFirst].bpm);
    const proposal = sampleMillis(logits, 1, gap - rolled,
      Math.floor(0.30 * movable), Math.floor(0.38 * movable), random);
    const logStretch = Math.log((rolled + proposal) / gap);

    // Average log period ratios in musical time, independent of note density.
    // Keep local accelerando/ritardando; gently compress a persistent tempo
    // preference toward the score over approximately three measures.
    const smooth = (previous: number, span: number) =>
      previous + (-Math.expm1(-quarters / span)) * (logStretch - previous);
    beatTrend[i] = smooth(beatTrend[previousFirst], 1);
    phraseTrend[i] = smooth(phraseTrend[previousFirst], 3 * meterLength);
    const bias = phraseTrend[i];
    // Retain about ±8% of sustained period variation, with a smooth knee.
    const correction = bias - 0.08 * Math.tanh(bias / 0.08);
    pulse[i] = Math.exp(beatTrend[i] - correction);
    const stretch = Math.exp(0.7 * logStretch + 0.3 * beatTrend[i] - correction);
    return Math.max(1, Math.round(gap * Math.max(0.68, Math.min(1.45, stretch))) - rolled);
  }

  const durations: number[] = [];
  const generated: number[] = [];
  // The trained window is 512 notes. Retain a performance prefix across overlapping windows.
  for (let start = 0; start < tokens.length; start += 2048) {
    const input = tokens.slice(start, start + 4096);
    const { cross } = await run('encoder', { tokens: ints(input, [1, input.length]) });
    const prefix = Math.max(0, Math.floor(((generated.length - start) * 0.8) / 8) * 8);
    generated.length = start + prefix;
    let past: Tensor = float([], [4, 1, 4, 0, 128]);
    let prev = 2;
    for (let pos = 0; pos < input.length; pos++) {
      const out = await run('step', {
        token: ints([prev], [1, 1]),
        position: ints([pos], [1, 1]),
        cross,
        past,
      });
      past.dispose();
      past = out.present;
      if (pos < prefix) prev = generated[start + pos];
      else {
        const column = pos % 8;
        const i = Math.floor((start + pos) / 8);
        const logits = values(out.logits);
        if (column === 1) {
          const interval = nextInterval(i, logits);
          onsets[i] = (onsets[i - 1] ?? 0) + interval;
          prev = Math.min(ranges[1][1] - 1, timingStart + interval);
        } else if (column === 3) {
          const written = Math.max(1, Math.round(notes[i].d * 1000));
          const beat = 60000 / notes[i].bpm;
          // Let the pianist articulate short notes, but retain held notes and ties.
          const early = Math.floor(Math.min(written * 0.48, beat * 0.45));
          const late = Math.floor(Math.min(written * 0.15, beat * 0.12));
          const target = Math.max(1, Math.round(written + Math.min(written, beat) * (pulse[groups[i].first] - 1)));
          durations[i] = sampleMillis(logits, 3, target, early, late, random);
          prev = Math.min(ranges[3][1] - 1, timingStart + durations[i]);
        } else {
          prev = column === 0 ? input[pos] : sample(logits, ranges[column][0], ranges[column][1], random);
        }
        generated.push(prev);
      }
      out.logits.dispose();
      if (pos % 8 === 7) progress(Math.min(start + pos + 1, tokens.length), tokens.length);
    }
    past.dispose();
    cross.dispose();
    if (start + input.length === tokens.length) break;
  }
  const result: Performance = { notes: [], pedals: [] };
  const previousByPitch = new Map<number, number>();
  let lastPedal = 0;
  for (let i = 0; i < notes.length; i++) {
    const time = onsets[i] / 1000;
    const row = i * 8;
    const p = notes[i].p;
    const previous = previousByPitch.get(p);
    if (previous !== undefined && onsets[i] > onsets[previous]) {
      const earlier = result.notes[previous];
      earlier.d = Math.min(earlier.d, time - earlier.s);
    }
    previousByPitch.set(p, i);
    result.notes.push({
      scoreTime: notes[i].s,
      p,
      s: time,
      d: durations[i] / 1000,
      v: Math.max(1, generated[row + 2] - 133),
    });
    const span = i + 1 < notes.length ? onsets[i + 1] - onsets[i] : durations[i];
    for (let j = 0; j < 4; j++) {
      const value = generated[row + j + 4] - 5261;
      if (value !== lastPedal)
        result.pedals.push({ time: time + (j * span) / 4000, value, number: 64 });
      lastPedal = value;
    }
  }
  if (lastPedal >= 64) {
    const end = result.notes.reduce((last, n) => Math.max(last, n.s + n.d), 0);
    result.pedals.push({ time: end, value: 0, number: 64 });
  }
  return result;
}
