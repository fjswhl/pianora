import type { SimpleNote } from './arpeggio';

// Call with ascending score times. Use the earliest attack when a chord is rolled.
export function scoreToPerformanceTime(notes: Pick<SimpleNote, 'scoreTime' | 's'>[]) {
  const earliest = new Map<number, number>();
  for (const note of notes) {
    if (note.scoreTime !== undefined)
      earliest.set(note.scoreTime, Math.min(earliest.get(note.scoreTime) ?? Infinity, note.s));
  }
  const anchors = [...earliest].sort(([a], [b]) => a - b);
  let next = 0;
  return (seconds: number) => {
    if (!anchors.length || seconds <= 0) return seconds;
    // Score note onsets are stored to four decimals.
    seconds = Number(seconds.toFixed(4));
    while (next < anchors.length && anchors[next][0] < seconds) next++;
    const left = anchors[next - 1] ?? [0, 0];
    const right = anchors[next];
    if (!right) return left[1] + seconds - left[0];
    if (right[0] === seconds) return right[1];
    return left[1] + (right[1] - left[1]) * (seconds - left[0]) / (right[0] - left[0]);
  };
}
