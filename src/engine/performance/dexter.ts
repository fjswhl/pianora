import { float, ints, values, type Run } from './runtime';
import config from './dexter.json';
import type { ModelScore, Performance, Progress } from './types';

export async function dexter(
  score: ModelScore,
  run: Run,
  normal: () => number,
  steps: number,
  progress: Progress,
): Promise<Performance> {
  const notes = score.notes,
    width = 200,
    stride = 190,
    frames = new Float32Array(notes.length * 5);
  const chunks = Math.max(1, Math.ceil((notes.length - 10) / stride));
  const last = config.alpha.length - 2;
  for (let chunk = 0; chunk < chunks; chunk++) {
    const offset = chunk * stride;
    const condition = new Float32Array(width * 4 * 2);
    for (let i = 0; i < width && offset + i < notes.length; i++) {
      const n = notes[offset + i];
      condition.set([n.quarter * n.divisions, n.length * n.divisions, n.p, n.voice], i * 4);
    }
    const scoreTensor = float(condition, [2, width, 4]);
    const x = Float32Array.from({ length: width * 5 }, normal);
    for (let i = 0; i < steps; i++) {
      const t = Math.round(last * (1 - i / (steps - 1)));
      const next = i === steps - 1 ? -1 : Math.round(last * (1 - (i + 1) / (steps - 1)));
      const a = config.alpha[t],
        b = next === -1 ? 1 : config.alpha[next];
      const batch = new Float32Array(x.length * 2);
      batch.set(x);
      batch.set(x, x.length);
      const out = await run('denoise', {
        noise: float(batch, [2, 1, width, 5]),
        score: scoreTensor,
        step: ints([t, t], [2]),
      });
      const eps = values(out.epsilon);
      // Full schedule uses the authors' stochastic guided DDPM. Sparse steps use DDIM.
      const sigma = steps === last + 1 && next >= 0 ? Math.sqrt(((1 - b) / (1 - a)) * (1 - a / b)) : 0;
      const cleanScale = Math.sqrt(b / a);
      const epsScale = Math.sqrt(Math.max(0, 1 - b - sigma * sigma)) - cleanScale * Math.sqrt(1 - a);
      for (let j = 0; j < x.length; j++) {
        x[j] =
          cleanScale * x[j] +
          epsScale * (1.2 * eps[j] - 0.2 * eps[j + x.length]) +
          (sigma ? sigma * normal() : 0);
      }
      progress(chunk * steps + i + 1, chunks * steps);
    }
    for (let i = 0; i < Math.min(width, notes.length - offset); i++)
      for (let k = 0; k < 5; k++) {
        const dest = (offset + i) * 5 + k;
        const value = x[i * 5 + k] * config.std[k] + config.mean[k];
        frames[dest] = chunk > 0 && i < 10 ? (frames[dest] + value) / 2 : value;
      }
  }
  const result: Performance = { notes: [], pedals: [] };
  let time = 0,
    minStart = Infinity;
  for (let i = 0; i < notes.length; ) {
    let end = i + 1;
    while (end < notes.length && notes[end].quarter === notes[i].quarter) end++;
    let period = 0;
    for (let j = i; j < end; j++) period += frames[j * 5];
    period = Math.max(0.05, period / (end - i));
    for (let j = i; j < end; j++) {
      const n = notes[j],
        k = j * 5,
        s = time - frames[k + 2];
      minStart = Math.min(minStart, s);
      result.notes.push({
        scoreTime: n.s,
        p: n.p,
        s,
        d: Math.max(0.01, ((2 ** frames[k + 3] * n.length * n.denominator) / 4) * period),
        v: Math.max(1, Math.min(127, Math.round(frames[k + 1] * 127))),
      });
      result.pedals.push({
        time: s,
        number: 64,
        value: Math.max(1, Math.min(127, Math.round(frames[k + 4] * 127))),
      });
    }
    if (end < notes.length)
      time += (((notes[end].quarter - notes[i].quarter) * notes[i].denominator) / 4) * period;
    i = end;
  }
  for (const n of result.notes) n.s -= minStart;
  for (const p of result.pedals) p.time -= minStart;
  return result;
}
