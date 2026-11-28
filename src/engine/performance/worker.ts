import { loadGraphs, generator } from './runtime';
import { dexter } from './dexter';
import { pianist } from './pianist';
import { virtuoso } from './virtuoso';
import type { Progress, RenderRequest, Update } from './types';

const send = (data: Update) => self.postMessage(data);
self.onmessage = async ({ data }: MessageEvent<RenderRequest>) => {
  try {
    const { model, score, seed, dexSteps } = data;
    const progress: Progress = (done, total, loading) => send({ status: 'progress', done, total, loading });
    const run = await loadGraphs(model, progress);
    const rng = generator(seed);
    const output =
      model === 'pianist'
        ? await pianist(score, run, rng.uniform, progress)
        : model === 'dexter'
          ? await dexter(score, run, rng.normal, dexSteps, progress)
          : await virtuoso(score, run, rng.normal, progress);
    if (output.notes.some((n) => ![n.s, n.d, n.v].every(Number.isFinite)))
      throw new Error('Non-finite model prediction');
    output.pedals.sort((a, b) => a.time - b.time);
    send({ status: 'result', output });
  } catch (error) {
    send({ status: 'error', message: String(error instanceof Error ? error.message : error) });
  }
};
