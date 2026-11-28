import type { SimpleNote } from './arpeggio';
import type { MessageKey } from '../i18n/catalog';

export interface TakeCharacter {
  /** Local tempo relative to the score (1 = as written), sampled across the piece. */
  curve: number[];
  /** Plain-language descriptors, as message keys. */
  tags: MessageKey[];
}

const SEGMENTS = 16;

/**
 * Describe a take in musical terms instead of seeds and sampler settings:
 * overall pace, how much the tempo breathes, and how firmly the keys are struck.
 */
export function takeCharacter(notes: SimpleNote[]): TakeCharacter {
  const timed = notes
    .filter((n): n is SimpleNote & { scoreTime: number } => n.scoreTime !== undefined)
    .sort((a, b) => a.scoreTime - b.scoreTime);
  const tags: MessageKey[] = [];
  let curve: number[] = [];
  if (timed.length >= 8) {
    const first = timed[0], last = timed[timed.length - 1];
    const span = last.scoreTime - first.scoreTime;
    const played = last.s - first.s;
    if (span > 0 && played > 0) {
      const pace = span / played;
      if (pace > 1.04) tags.push('偏快');
      else if (pace < 0.96) tags.push('偏慢');
      // Each segment compares written and played time between its first and last onset.
      for (let i = 0; i < SEGMENTS; i++) {
        const from = first.scoreTime + span * i / SEGMENTS;
        const to = first.scoreTime + span * (i + 1) / SEGMENTS;
        const inside = timed.filter(n => n.scoreTime >= from && n.scoreTime <= to);
        if (inside.length < 2) continue;
        const written = inside[inside.length - 1].scoreTime - inside[0].scoreTime;
        const actual = inside[inside.length - 1].s - inside[0].s;
        if (written > 0 && actual > 0) curve.push(written / actual / pace);
      }
      if (curve.length >= 3) {
        const mean = curve.reduce((a, b) => a + b, 0) / curve.length;
        const spread = Math.sqrt(curve.reduce((a, b) => a + (b - mean) ** 2, 0) / curve.length);
        tags.push(spread > 0.08 ? '呼吸大' : spread > 0.035 ? '有起伏' : '速度稳');
      } else curve = [];
    }
  }
  if (notes.length) {
    const loudness = notes.reduce((sum, n) => sum + n.v, 0) / notes.length;
    if (loudness >= 82) tags.push('触键有力');
    else if (loudness <= 56) tags.push('触键轻柔');
  }
  return { curve, tags };
}

/** Smooth SVG path for a small tempo sparkline. */
export function curvePath(values: number[], width: number, height: number) {
  if (values.length < 2) return `M0,${height / 2} L${width},${height / 2}`;
  const lo = Math.min(...values, 0.9), hi = Math.max(...values, 1.1);
  const points = values.map((v, i) => [i / (values.length - 1) * width, height - 2 - (v - lo) / (hi - lo) * (height - 4)]);
  let path = `M${points[0][0].toFixed(1)},${points[0][1].toFixed(1)}`;
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1], [x1, y1] = points[i];
    const mid = ((x0 + x1) / 2).toFixed(1);
    path += ` C${mid},${y0.toFixed(1)} ${mid},${y1.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`;
  }
  return path;
}
