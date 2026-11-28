import * as ort from 'onnxruntime-web/wasm';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import { unpackAsset } from '../assetPacks';
import graphs from './graphs.json';
import type { LocalModel, Progress } from './types';

export const float = (data: Float32Array | number[], dims: number[]) =>
  new ort.Tensor('float32', data instanceof Float32Array ? data : Float32Array.from(data), dims);
export const ints = (data: number[], dims: number[]) =>
  new ort.Tensor('int64', BigInt64Array.from(data, BigInt), dims);
export const values = (t: ort.Tensor) => t.data as Float32Array;
export type Tensor = ort.Tensor;
export type Feeds = Record<string, Tensor>;

export function generator(seed: number) {
  let state = seed | 0;
  const uniform = () => {
    state = (state + 0x6d2b79f5) | 0;
    let x = Math.imul(state ^ (state >>> 15), 1 | state);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  return {
    uniform,
    normal: () => Math.sqrt(-2 * Math.log(1 - uniform())) * Math.cos(2 * Math.PI * uniform()),
  };
}

export async function loadGraphs(model: LocalModel, progress: Progress) {
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.wasmPaths = { wasm: new URL(wasmUrl, location.origin).href };
  const sessions = new Map<string, ort.InferenceSession>();
  const selected = Object.entries(graphs).filter(([name]) => name.startsWith(model + '-'));
  const total = selected.reduce((s, [, g]) => s + g.size, 0);
  let loaded = 0;
  for (const [name, pack] of selected) {
    const bytes = await unpackAsset({ path: '/performance-packs/' + name, pack }, (done) =>
      progress(loaded + done, total, true),
    );
    const session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
    sessions.set(name.slice(model.length + 1), session);
    loaded += pack.size;
  }
  return (name: string, feeds: Feeds) => sessions.get(name)!.run(feeds);
}
export type Run = Awaited<ReturnType<typeof loadGraphs>>;
