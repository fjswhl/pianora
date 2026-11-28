import config from './virtuosonet.json';
import { float, values, type Run } from './runtime';
import type { InputNote, ModelScore, Performance, Progress } from './types';

const composers = [
  'Bach',
  'Balakirev',
  'Beethoven',
  'Brahms',
  'Chopin',
  'Debussy',
  'Glinka',
  'Haydn',
  'Liszt',
  'Mozart',
  'Prokofiev',
  'Rachmaninoff',
  'Ravel',
  'Schubert',
  'Schumann',
  'Scriabin',
];
type Feature = keyof typeof config.stats;
const zeros = (length: number) => new Float32Array(length);
function join(rows: Float32Array[]) {
  const out = zeros(rows.reduce((s, r) => s + r.length, 0));
  let offset = 0;
  for (const row of rows) {
    out.set(row, offset);
    offset += row.length;
  }
  return out;
}
function split(data: Float32Array, width: number) {
  return Array.from({ length: data.length / width }, (_, i) => data.subarray(i * width, (i + 1) * width));
}
function group<T>(items: T[], key: (item: T) => string | number) {
  const map = new Map<string | number, number[]>();
  items.forEach((item, i) => {
    const k = key(item);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(i);
  });
  return Array.from(map.values());
}
function beatImportance(position: number, beats: number): number {
  const division = (d: number) => Math.abs(position * d - Math.round(position * d)) < 1e-5;
  if (position === 0) return 4;
  if (position === 0.5 && [2, 4, 6, 12].includes(beats)) return 3;
  if ((Math.abs(position - 1 / 3) < 0.001 && [3, 9].includes(beats)) || (division(5) && beats === 5)) return 2;
  if ((division(4) && [2, 4].includes(beats)) || (division(6) && [3, 6, 12].includes(beats)) || (division(9) && beats === 9)) return 1;
  if ((division(8) && [2, 4].includes(beats)) || (division(12) && [3, 6, 12].includes(beats))) return 0.5;
  return 0;
}

function features(n: InputNote, total: number, primo: number, composer: number) {
  const x = zeros(84),
    measure = (n.numerator * 4) / n.denominator,
    pos = (n.quarter - n.barStart) / measure;
  const beats = n.numerator;
  const importance = beatImportance(pos, beats);
  const raw = [
    n.p,
    n.length,
    importance,
    measure,
    Math.log10(primo),
    Math.log10(n.bpm),
    0,
    n.quarter - n.dynamicStart,
    n.quarter - n.tempoStart,
  ];
  const keys = [
    'midi_pitch',
    'duration',
    'beat_importance',
    'measure_length',
    'qpm_primo',
    'section_tempo',
    'following_rest',
    'distance_from_abs_dynamic',
    'distance_from_recent_tempo',
  ] as const;
  keys.forEach((k, i) => {
    x[i] = (raw[i] - config.stats[k].mean) / config.stats[k].stds;
  });
  x[9] = pos;
  x[10] = n.quarter / total;
  x[14] = (Math.floor(n.p / 12) - 5) / 4;
  x[15 + (n.p % 12)] = 1;
  const meterBits: Record<number, number[]> = {
    2: [0],
    3: [1],
    4: [0, 2],
    6: [0, 3],
    9: [1, 3],
    12: [0, 2, 3],
    24: [0, 2, 3],
  };
  for (const bit of meterBits[beats] ?? [4]) x[36 + bit] = 1;
  x[41 + Math.min(3, Math.max(0, Math.round(Math.log2(n.denominator)) - 1))] = 1;
  x[32] = n.dynamic;
  x.set(n.slurBeam, 45);
  x[51 + composer] = 1;
  x.set(n.notation, 68);
  x.set([n.p, n.length, importance, measure, 0], 79);
  return x;
}

export async function virtuoso(
  score: ModelScore,
  run: Run,
  normal: () => number,
  progress: Progress,
): Promise<Performance> {
  const notes = score.notes;
  const total = notes.reduce((m, n) => Math.max(m, n.quarter + n.length), 0.001);
  const composer = composers.findIndex((name) => score.composer.toLowerCase().includes(name.toLowerCase()));
  const rows = notes.map((n) => features(n, total, notes[0].bpm, composer < 0 ? 16 : composer));
  async function seq(name: string, input: Float32Array[], width: number) {
    const out = await run(name, { x: float(join(input), [1, input.length, input[0].length]) });
    return split(values(out.y), width);
  }
  const embeddings = await seq('embed', rows, 256);
  const timeline = await seq('notes', embeddings, 512);
  const voices: Float32Array[] = new Array(notes.length);
  for (const indices of group(notes, (n) => n.voice)) {
    const encoded = await seq(
      'voices',
      indices.map((i) => embeddings[i]),
      512,
    );
    indices.forEach((index, j) => {
      voices[index] = encoded[j];
    });
  }
  const noteEnc = timeline.map((r, i) => join([r, voices[i]]));
  const beats = group(notes, (n) => {
    const beatLength = (4 / n.denominator) * (n.numerator > 3 && n.numerator % 3 === 0 ? 3 : 1);
    return n.bar + '/' + Math.floor((n.quarter - n.barStart) / beatLength + 1e-6);
  });
  const measures = group(beats, (indices) => notes[indices[0]].bar);
  async function hierarchy(groups: number[][], input: Float32Array[], pool: string, rnn: string) {
    const pooled: Float32Array[] = [];
    for (const indices of groups)
      pooled.push(
        (
          await seq(
            pool,
            indices.map((i) => input[i]),
            input[0].length,
          )
        )[0],
      );
    return seq(rnn, pooled, 512);
  }
  const beatEnc = await hierarchy(beats, noteEnc, 'beat_pool', 'beats');
  const measureEnc = await hierarchy(measures, beatEnc, 'measure_pool', 'measures');
  const style = (
    await seq('style', [Float32Array.from({ length: 16 }, () => normal() * Math.exp(0.5))], 256)
  )[0];
  const hidden: Record<string, Float32Array> = {};
  async function step(name: string, pieces: Float32Array[]) {
    const input = join(pieces);
    const out = await run(name, {
      x: float(input, [1, 1, input.length]),
      hidden: float(hidden[name] ?? zeros(256), [1, 1, 256]),
    });
    hidden[name] = values(out.next);
    return values(out.y);
  }
  let previousMeasure: Float32Array = zeros(2),
    previousNotes = [zeros(10) as Float32Array];
  let previous: Float32Array = zeros(11);
  const outputs: Float32Array[] = new Array(notes.length);
  for (const [m, beatIds] of measures.entries()) {
    const head = rows[beats[beatIds[0]][0]];
    const residual = join([rows[0].subarray(4, 5), rows[0].subarray(77, 79), head.subarray(27, 32)]);
    previousMeasure = await step('measure_step', [measureEnc[m], style, residual, previousMeasure]);
    const measure = join([measureEnc[m], previousMeasure]);
    for (const b of beatIds) {
      const pool = (await seq('result_pool', previousNotes, 10))[0];
      const tempo = await step('beat_step', [beatEnc[b], measure, previous.subarray(0, 1), pool, style]);
      previous[0] = tempo[0];
      previousNotes = [];
      for (const i of beats[b]) {
        const prediction = await step('note_step', [noteEnc[i], beatEnc[b], measure, previous, style]);
        previous = join([tempo, prediction]);
        outputs[i] = previous.slice();
        previousNotes.push(prediction);
      }
      progress(beats[b].at(-1)! + 1, notes.length);
    }
  }
  const raw = outputs.map((row) =>
    row.map((v, i) => {
      const s = config.stats[config.outputs[i] as Feature];
      return v * s.stds + s.mean;
    }),
  );
  const result: Performance = { notes: [], pedals: [] };
  let beatTime = 0,
    prevQuarter = notes[0].quarter,
    period = 0.5;
  for (const indices of beats) {
    const quarter = notes[indices[0]].quarter;
    beatTime += (quarter - prevQuarter) * period;
    period = 60 / 10 ** raw[indices[0]][0];
    prevQuarter = quarter;
    for (const i of indices) {
      const n = notes[i],
        f = raw[i];
      const s = Math.max(0, 0.5 + beatTime + (n.quarter - quarter + f[2]) * period);
      const d = Math.max(0.01, n.length * period * 10 ** f[3]);
      const clip = (v: number) => Math.max(0, Math.min(127, Math.round(v)));
      result.notes.push({ p: n.p, scoreTime: n.s, s, d, v: Math.max(1, clip(f[1])) });
      result.pedals.push(
        { time: s, value: clip(f[6]), number: 64 },
        { time: s, value: clip(f[8]), number: 67 },
        { time: s + d, value: clip(f[7]), number: 64 },
      );
      if (f[9] < f[6]) result.pedals.push({ time: s + Math.max(0, f[4]), value: clip(f[9]), number: 64 });
      if (f[10] < f[7])
        result.pedals.push({ time: Math.max(s, s + d - Math.max(0, f[5])), value: clip(f[10]), number: 64 });
    }
  }
  return result;
}
