import type { Midi } from '@tonejs/midi';
import type { InputNote, ModelScore, Performance, Progress, RenderRequest, ScoreMark, Update } from './types';

export function modelScore(midi: Midi, composer = '', marks?: Map<string, ScoreMark>): ModelScore {
  const ppq = midi.header.ppq;
  const notes = midi.tracks
    .flatMap((tr, track) =>
      tr.notes.map((n): InputNote => {
        const mark = marks?.get([track, n.ticks, n.midi].join('/'));
        const meter = midi.header.timeSignatures.filter((s) => s.ticks <= n.ticks).at(-1);
        const tempo = midi.header.tempos.filter((s) => s.ticks <= n.ticks).at(-1);
        const [numerator, denominator] = meter?.timeSignature ?? [4, 4];
        const quarter = n.ticks / ppq;
        const barLength = (numerator * 4) / denominator;
        const relative = Math.floor((quarter - (meter?.ticks ?? 0) / ppq) / barLength);
        return {
          p: n.midi,
          s: n.time,
          d: n.duration,
          v: Math.round(n.velocity * 127),
          quarter,
          length: n.durationTicks / ppq,
          voice: mark?.voice ?? track + 1,
          divisions: mark?.divisions ?? ppq,
          bar: mark?.measure ?? Math.floor(meter?.measures ?? 0) + relative,
          barStart: mark ? mark.measureStart / ppq : (meter?.ticks ?? 0) / ppq + relative * barLength,
          numerator,
          denominator,
          bpm: tempo?.bpm ?? 120,
          tempoStart: (tempo?.ticks ?? 0) / ppq,
          dynamic: mark?.dynamic ?? 0,
          dynamicStart: mark?.dynamicStart ?? 0,
          slurBeam: mark?.slurBeam ?? [],
          notation: mark?.notation ?? [],
        };
      }),
    )
    .sort((a, b) => a.quarter - b.quarter || a.p - b.p);
  if (!notes.length) throw new Error('Empty piano score');
  return {
    notes,
    composer,
    pedals: midi.tracks
      .flatMap((tr) =>
        (tr.controlChanges[64] ?? []).map((cc) => ({
          time: cc.time,
          value: Math.round(cc.value * 127),
          number: 64 as const,
        })),
      )
      .sort((a, b) => a.time - b.time),
  };
}

// Terminating the worker releases the WASM heap (including model weights) on success, cancellation or error.
export function renderLocal(
  request: RenderRequest,
  progress: Progress,
  signal: AbortSignal,
): Promise<Performance> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    const close = () => {
      worker.terminate();
      signal.removeEventListener('abort', abort);
    };
    const abort = () => {
      close();
      reject(signal.reason);
    };
    signal.addEventListener('abort', abort, { once: true });
    worker.onerror = (e) => {
      close();
      reject(new Error(e.message));
    };
    worker.onmessage = ({ data }: MessageEvent<Update>) => {
      if (data.status === 'progress') {
        progress(data.done, data.total, data.loading);
        return;
      }
      close();
      if (data.status === 'error') reject(new Error(data.message));
      else resolve(data.output);
    };
    worker.postMessage(request);
  });
}
