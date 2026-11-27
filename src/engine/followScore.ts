import { scoreToPerformanceTime } from './performanceClock';
import type { Midi } from '@tonejs/midi';
import type { SimpleNote } from './arpeggio';

interface Measure {
  moment: number; // LilyPond time in whole notes
  end: number;
  number: number;
  left: number;
  right: number;
  row: number;
}

interface System {
  page: number;
  moment: number;
  end: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface FollowScore {
  rows: System[];
  measures: Measure[];
  repeats: string;
  pages: { box: number[] }[];
}

function translation(element: Element) {
  const match = /translate\(([-+.\deE]+)[,\s]+([-+.\deE]+)\)/.exec(element.getAttribute('transform') ?? '');
  return match && [Number(match[1]), Number(match[2])];
}

const engravedScores = new WeakMap<string[], FollowScore>();

export function registerFollowScore(sources: string[], score: FollowScore): void {
  engravedScores.set(sources, score);
}

export function readFollowScore(sources: string[]): FollowScore {
  const cached = engravedScores.get(sources);
  if (cached) return cached;
  const rows: System[] = [];
  const measures: Measure[] = [];
  let repeats = '';
  let number = 1;
  const pages = sources.map((source, page) => {
    const svg = new DOMParser().parseFromString(source, 'image/svg+xml');
    const box = (svg.documentElement.getAttribute('viewBox') ?? '').split(/\s+/).map(Number);
    const systems = new Map<number, System>();
    for (const staff of svg.querySelectorAll('[data-system]')) {
      repeats ||= staff.getAttribute('data-repeats') ?? '';
      const moment = Number(staff.getAttribute('data-system'));
      if (systems.has(moment)) continue;
      const lines = [...staff.querySelectorAll('line')];
      if (!lines.length) continue;
      const first = lines[0];
      const start = translation(first.parentElement!);
      const last = translation(lines[lines.length - 1].parentElement!);
      if (!start || !last) continue;
      const center = (start[1] + last[1]) / 2;
      systems.set(moment, {
        page, moment, end: Number(staff.getAttribute('data-end')),
        left: start[0], right: start[0] + Number(first.getAttribute('x2')),
        top: center + Number(staff.getAttribute('data-top')),
        bottom: center + Number(staff.getAttribute('data-bottom')),
      });
    }
    const boundaries = new Map<number, Map<number, { x: number; number: number }>>();
    for (const bar of svg.querySelectorAll('[data-line][data-moment]')) {
      const row = Number(bar.getAttribute('data-line'));
      const moment = Number(bar.getAttribute('data-moment'));
      const mark = bar.querySelector('[transform]');
      const position = mark && translation(mark);
      if (!position) continue;
      if (!boundaries.has(row)) boundaries.set(row, new Map());
      boundaries.get(row)!.set(moment, {
        x: position[0], number: Number(bar.getAttribute('data-number')),
      });
    }
    for (const system of [...systems.values()].sort((a, b) => a.moment - b.moment)) {
      const row = rows.length;
      rows.push(system);
      let left = system.left;
      let moment = system.moment;
      const bars = boundaries.get(moment) ?? [];
      for (const [end, mark] of [...bars].sort(([a], [b]) => a - b)) {
        if (end > moment && mark.x > left) {
          measures.push({ row, left, right: mark.x, moment, end, number });
          moment = end;
          left = mark.x;
        }
        number = mark.number;
      }
      if (system.end > moment && system.right > left)
        measures.push({ row, left, right: system.right, moment, end: system.end, number });
    }
    return { box };
  });
  const score = { rows, measures, pages, repeats };
  engravedScores.set(sources, score);
  return score;
}

// LilyPond emits repeat and alternative events even when the MIDI score has
// been unfolded separately from the printed score (e.g. Mozart K.331).
function performanceOrder({ measures, repeats }: FollowScore, midi: Midi) {
  const writtenEnd = measures.at(-1)?.end ?? 0;
  if (!repeats) return measures;
  const endTick = midi.tracks.reduce((end, track) => Math.max(end, track.endOfTrackTicks ?? 0), midi.durationTicks);
  if (endTick <= writtenEnd * midi.header.ppq * 4 + 1) return measures;
  const events = repeats.split(';').map(value => {
    const [moment, kind, numbers] = value.split(':');
    return { moment: Number(moment), kind, numbers: numbers ? numbers.split(',').map(Number) : [] };
  });
  type Section = { passes: number[]; bars: Measure[] };
  const stack: { count: number; sections: Section[] }[] = [];
  const order: Measure[] = [];
  const current = () => stack.at(-1)?.sections.at(-1)?.bars ?? order;
  let next = 0;
  for (let i = 0; i <= measures.length; i++) {
    const bar = measures[i];
    while (next < events.length && events[next].moment <= (bar?.moment ?? Infinity)) {
      const { kind, numbers } = events[next++];
      const frame = stack.at(-1);
      if (kind === 'start') {
        stack.push({ count: numbers[0], sections: [{ passes: [], bars: [] }] });
      } else if (frame && kind === 'ending' && numbers.length) {
        frame.sections.push({ passes: numbers, bars: [] });
      } else if (frame && (kind === 'ending' || frame.sections.length === 1)) {
        stack.pop();
        const target = current();
        for (let pass = 1; pass <= frame.count; pass++) {
          for (const section of frame.sections) {
            if (!section.passes.length || section.passes.includes(pass))
              for (const measure of section.bars) target.push(measure);
          }
        }
      }
    }
    if (bar) current().push(bar);
  }
  return stack.length || !order.length ? measures : order;
}

export function followTimeline(score: FollowScore, midi: Midi, notes: SimpleNote[], duration: number) {
  const playbackTime = scoreToPerformanceTime(notes);
  let ticks = 0;
  let previous = 0;
  const bars = performanceOrder(score, midi).map(bar => {
    const start = Math.max(previous, playbackTime(midi.header.ticksToSeconds(Math.round(ticks))));
    ticks += (bar.end - bar.moment) * midi.header.ppq * 4;
    previous = start;
    return { bar, start };
  });
  return bars.map((entry, i) => ({ ...entry, end: bars[i + 1]?.start ?? Math.max(entry.start, duration) }));
}
