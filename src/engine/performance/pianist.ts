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

function scoreTiming(notes: ModelScore['notes'], starts: number[]) {
  const groups = [];
  for (let first = 0; first < notes.length;) {
    let end = first + 1;
    while (end < starts.length && starts[end] === starts[first]) end++;
    const beat = 60000 / notes[first].bpm;
    const before = starts[first] - (starts[first - 1] ?? 0);
    const after = (starts[end] ?? Infinity) - starts[first];
    // Anchor each bar's first strike. On interior strikes leave room on both
    // sides for rubato, scaled to the beat and the surrounding note density.
    const anchor = first === 0 || notes[first].bar !== notes[first - 1].bar;
    const slack = anchor ? 0 : Math.floor(Math.min(80, beat / 8, before / 4, after / 4));
    const spread = Math.floor(Math.min(30, beat / 20, after / 4));
    const group = { first, slack, spread };
    for (let i = first; i < end; i++) groups.push(group);
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
  const groups = scoreTiming(notes, starts);
  // Absolute milliseconds indexed by score note survive overlapping windows.
  // When the decoder rewrites a suffix, its first interval uses the retained onset.
  const onsets: number[] = [];
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
          const group = groups[i];
          const preceding = onsets[i - 1] ?? 0;
          const first = group.first === i;
          const target = first ? starts[i] - preceding : 0;
          const late = first ? group.slack : onsets[group.first] + group.spread - preceding;
          const interval = sampleMillis(logits, 1, target, first ? group.slack : 0, late, random);
          onsets[i] = preceding + interval;
          prev = Math.min(ranges[1][1] - 1, timingStart + interval);
        } else if (column === 3) {
          const written = Math.max(1, Math.round(notes[i].d * 1000));
          const beat = 60000 / notes[i].bpm;
          // Let the pianist articulate short notes, but retain held notes and ties.
          const early = Math.floor(Math.min(written * 0.48, beat * 0.45));
          const late = Math.floor(Math.min(written * 0.15, beat * 0.12));
          durations[i] = sampleMillis(logits, 3, written, early, late, random);
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
