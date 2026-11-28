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

function sample(scores: Float32Array, column: number, random: () => number) {
  const [lo, hi] = ranges[column];
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
        prev = pos % 8 === 0 ? input[pos] : sample(values(out.logits), pos % 8, random);
        generated.push(prev);
      }
      out.logits.dispose();
      if (pos % 8 === 7) progress(Math.min(start + pos + 1, tokens.length), tokens.length);
    }
    past.dispose();
    cross.dispose();
    if (start + input.length === tokens.length) break;
  }
  const intervals = notes.map(
    (_, i) => Math.max(tokens[i * 8 + 1] > 261 ? 5 : 0, generated[i * 8 + 1] - 261) / 1000,
  );
  const result: Performance = { notes: [], pedals: [] };
  let time = 0,
    last = 0;
  for (let i = 0; i < notes.length; i++) {
    time += intervals[i];
    const row = i * 8;
    result.notes.push({
      scoreTime: notes[i].s,
      p: notes[i].p,
      s: time,
      d: Math.max(0.001, (generated[row + 3] - 261) / 1000),
      v: Math.max(1, generated[row + 2] - 133),
    });
    for (let j = 0; j < 4; j++) {
      const value = generated[row + j + 4] - 5261;
      if (value !== last)
        result.pedals.push({ time: time + (j * (intervals[i + 1] ?? 4.99)) / 4, value, number: 64 });
      last = value;
    }
  }
  return result;
}
