import type { Midi } from '@tonejs/midi';
import type { Note } from '@tonejs/midi/dist/Note';
import type { ScoreMark } from './performance/types';

const kinds = ['trill', 'prall', 'mordent', 'turn', 'reverseturn'] as const;
type Kind = typeof kinds[number];
export interface Ornament {
  kind: Kind;
  upper: number;
  lower: number;
  start?: 'upper' | 'below';
  beats?: number;
  ending?: boolean;
}

function strokes(note: Note, mark: Ornament) {
  const p = note.midi;
  const { upper, lower } = mark;
  let pitches: number[];
  switch (mark.kind) {
    case 'trill': {
      const pair = mark.start ? [upper, p] : [p, upper];
      const count = Math.min(2048, note.durationTicks,
        Math.max(3, Math.round(mark.beats ?? note.duration / 0.095)));
      pitches = Array.from({ length: count }, (_, i) => pair[i % 2]);
      if (mark.start === 'below') pitches[0] = lower;
      if (mark.ending) pitches.push(lower, p);
      break;
    }
    case 'prall': pitches = [p, upper, p]; break;
    case 'mordent': pitches = [p, lower, p]; break;
    case 'turn': pitches = [upper, p, lower, p]; break;
    case 'reverseturn': pitches = [lower, p, upper, p]; break;
  }
  if (pitches.length < 2 || pitches.length > note.durationTicks ||
      pitches.some(n => !Number.isInteger(n) || n < 0 || n > 127)) return [];
  // A mordent or turn resolves onto a sustained principal. A trill fills the note.
  const tickStep = mark.kind === 'trill' ? note.durationTicks / pitches.length :
    Math.max(1, Math.min(note.durationTicks / pitches.length, 0.085 * note.durationTicks / note.duration));
  return pitches.map((midi, i) => {
    const start = Math.round(i * tickStep);
    const end = i === pitches.length - 1 ? note.durationTicks : Math.round((i + 1) * tickStep);
    return { midi, ticks: note.ticks + start, durationTicks: end - start,
      velocity: note.velocity, noteOffVelocity: note.noteOffVelocity };
  });
}

export function realizeOrnaments(midi: Midi, marks: Map<Note, Ornament>, scoreMarks?: Map<string, ScoreMark>) {
  if (!marks.size) return;
  for (const [index, track] of midi.tracks.entries()) {
    const additions = [];
    for (const note of track.notes) {
      const mark = marks.get(note);
      if (!mark) continue;
      const [first, ...rest] = strokes(note, mark);
      if (!first) continue;
      const features = scoreMarks?.get([index, note.ticks, note.midi].join('/'));
      Object.assign(note, first);
      additions.push(...rest);
      if (features && scoreMarks)
        for (const s of [first, ...rest]) scoreMarks.set([index, s.ticks, s.midi].join('/'), features);
    }
    if (additions.length) {
      // Build a sorted run separately to avoid shifting the entire track on every strike.
      additions.sort((a, b) => a.ticks - b.ticks);
      const original = track.notes;
      track.notes = [];
      for (const stroke of additions) track.addNote(stroke);
      track.notes = original.concat(track.notes).sort((a, b) => a.ticks - b.ticks);
    }
  }
}

export function realizeLilyOrnaments(midi: Midi, sidecar: string) {
  if (!sidecar.trim()) return;
  const at = new Map<string, Note | null>();
  for (const track of midi.tracks) for (const note of track.notes) {
    const id = note.ticks + '/' + note.midi;
    at.set(id, at.has(id) ? null : note);
  }
  const marks = new Map<Note, Ornament>();
  for (const line of sidecar.trim().split('\n')) {
    const [moment, pitch, name, upper, lower] = line.split('\t');
    const kind = kinds.find(k => k === name);
    if (!kind) continue;
    const tick = Math.round(Number(moment) * 4 * midi.header.ppq);
    // LilyPond truncates fractional ticks independently when shifting initial grace time.
    for (const offset of [0, -1, 1]) {
      const id = (tick + offset) + '/' + pitch;
      if (!at.has(id)) continue;
      const note = at.get(id);
      if (note) marks.set(note, { kind, upper: Number(upper), lower: Number(lower) });
      break;
    }
  }
  realizeOrnaments(midi, marks);
}

const xmlKinds: Record<string, Kind> = {
  'trill-mark': 'trill', 'inverted-mordent': 'prall', mordent: 'mordent',
  turn: 'turn', 'inverted-turn': 'reverseturn',
};
const steps = 'CDEFGAB';
const semitones = [0, 2, 4, 5, 7, 9, 11];
const accidentals: Record<string, number> = {
  sharp: 1, flat: -1, natural: 0, 'double-sharp': 2, 'flat-flat': -2,
};

export function readXmlOrnament(note: Element, step: string, octave: number, pitch: number,
  fifths: number, continuedTrill: boolean, measureAccidental: (step: string, octave: number) => number | undefined
): Ornament | undefined {
  const ornaments = note.querySelector('notations > ornaments');
  const symbol = Array.from(ornaments?.children ?? []).find(el => Object.hasOwn(xmlKinds, el.tagName));
  const kind = symbol ? xmlKinds[symbol.tagName] : continuedTrill ? 'trill' : undefined;
  const playback = symbol ?? ornaments?.querySelector('wavy-line');
  const ending = playback?.getAttribute('two-note-turn');
  if (!kind) return;
  const neighbor = (dir: number) => {
    const index = steps.indexOf(step) + dir;
    const i = (index + 7) % 7;
    const oct = octave + Math.floor(index / 7);
    const letter = steps[i];
    const keyAlter = fifths > 0 ? Number('FCGDAEB'.slice(0, fifths).includes(letter)) :
      -Number('BEADGCF'.slice(0, -fifths).includes(letter));
    const signs = Array.from(ornaments?.querySelectorAll('accidental-mark') ?? []);
    // On a single-neighbor ornament the sign modifies that neighbor, even
    // when the engraver printed the entire ornament above the staff.
    const accidental = signs.length === 1 && (kind === 'mordent' || kind === 'prall')
      ? signs[0] : signs.find(el => (el.getAttribute('placement') === 'below') === (dir < 0));
    const explicit = accidentals[accidental?.textContent?.trim() ?? ''];
    const interval = dir > 0 ? playback?.getAttribute('trill-step') : ending;
    if (explicit == null && (interval === 'half' || interval === 'whole'))
      return pitch + dir * (interval === 'half' ? 1 : 2);
    return (oct + 1) * 12 + semitones[i] + (explicit ?? measureAccidental(letter, oct) ?? keyAlter);
  };
  const start = playback?.getAttribute('start-note');
  const beats = Number(playback?.getAttribute('beats'));
  return { kind, upper: neighbor(1), lower: neighbor(-1), ending: ending === 'half' || ending === 'whole',
    start: start === 'upper' || start === 'below' ? start : undefined,
    beats: Number.isFinite(beats) && beats > 0 ? beats : undefined };
}
