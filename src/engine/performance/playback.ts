import type { SimpleNote } from '../arpeggio';
import type { Pedal } from './types';

// The synthesizer plays note events. Extend key releases until pedal-up or the next strike of that key.
export function withSustain(notes: SimpleNote[], pedals: Pedal[]): SimpleNote[] {
  const changes = pedals.filter((cc) => cc.number === 64);
  const releases = changes.filter((cc, i) => cc.value < 64 && i > 0 && changes[i - 1].value >= 64);
  const byPitch = new Map<number, number[]>();
  for (const n of notes) {
    if (!byPitch.has(n.p)) byPitch.set(n.p, []);
    byPitch.get(n.p)!.push(n.s);
  }
  for (const strikes of byPitch.values()) strikes.sort((a, b) => a - b);
  const tail = notes.reduce((last, n) => Math.max(last, n.s + n.d), 0);
  function after<T>(events: T[], time: number, getTime: (v: T) => number) {
    let lo = 0,
      hi = events.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (getTime(events[mid]) <= time) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
  return notes.map((n) => {
    const off = n.s + n.d,
      current = after(changes, off, (cc) => cc.time) - 1;
    if (current < 0 || changes[current].value < 64) return n;
    const strikes = byPitch.get(n.p)!;
    const next = strikes[after(strikes, n.s, (t) => t)] ?? Infinity;
    const up = releases[after(releases, off, (cc) => cc.time)]?.time ?? tail;
    return { ...n, d: Math.max(n.d, Math.min(next, up) - n.s) };
  });
}
