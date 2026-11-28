import type { Midi } from '@tonejs/midi';

const naturals: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export const keyNames = [
  'Cb',
  'Gb',
  'Db',
  'Ab',
  'Eb',
  'Bb',
  'F',
  'C',
  'G',
  'D',
  'A',
  'E',
  'B',
  'F#',
  'C#',
];
const flats = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
const sharps = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const shapes = [
  { kind: 'major', suffix: '', tones: [0, 4, 7] },
  { kind: 'minor', suffix: 'm', tones: [0, 3, 7] },
  { kind: 'dominant', suffix: '7', tones: [0, 4, 7, 10] },
  { kind: 'major-seventh', suffix: 'maj7', tones: [0, 4, 7, 11] },
  { kind: 'minor-seventh', suffix: 'm7', tones: [0, 3, 7, 10] },
  { kind: 'diminished', suffix: 'dim', tones: [0, 3, 6] },
  { kind: 'half-diminished', suffix: 'ø7', tones: [0, 3, 6, 10] },
  { kind: 'diminished-seventh', suffix: 'dim7', tones: [0, 3, 6, 9] },
  { kind: 'augmented', suffix: '+', tones: [0, 4, 8] },
  { kind: 'suspended-fourth', suffix: 'sus4', tones: [0, 5, 7] },
  { kind: 'suspended-second', suffix: 'sus2', tones: [0, 2, 7] },
];

export interface Chord {
  root: number;
  kind: string;
  symbol: string;
}
export interface WrittenChord {
  tick: number;
  endTick?: number;
  chord: Chord | null;
}
export interface HarmonyEvent {
  tick: number;
  end: number;
  chord: Chord;
  degree: string;
  written: boolean;
}

function pitch(name: string) {
  return (
    (naturals[name[0]] +
      (name.slice(1).match(/[#♯]/g)?.length ?? 0) -
      (name.slice(1).match(/[b♭]/g)?.length ?? 0) +
      12) %
    12
  );
}

export function readWrittenChord(node: Element): Chord | null {
  function spelled(part: string) {
    const step = node.querySelector(part + '-step')?.textContent ?? '';
    const alter = Number(node.querySelector(part + '-alter')?.textContent ?? 0);
    if (!(step in naturals) || !Number.isInteger(alter) || Math.abs(alter) > 2) return '';
    return step + (alter < 0 ? '♭' : '♯').repeat(Math.abs(alter));
  }
  const name = spelled('root');
  const kindNode = node.querySelector('kind');
  const kind = kindNode?.textContent?.trim() || 'major';
  if (!name || kind === 'none') return null;
  const extensions: Record<string, string> = {
    'major-sixth': '6',
    'minor-sixth': 'm6',
    'dominant-ninth': '9',
    'major-ninth': 'maj9',
    'minor-ninth': 'm9',
    power: '5',
  };
  const suffix =
    kindNode?.getAttribute('text') ||
    shapes.find((s) => s.kind === kind)?.suffix ||
    extensions[kind] ||
    (kind === 'major' ? '' : '(' + kind + ')');
  const bass = spelled('bass');
  const degrees = [...node.querySelectorAll('degree')]
    .map((d) => {
      const alter = Number(d.querySelector('degree-alter')?.textContent);
      const type = d.querySelector('degree-type')?.textContent;
      return (
        (type === 'subtract' ? 'no' : type === 'add' && !alter ? 'add' : '') +
        (alter < 0 ? '♭' : alter > 0 ? '♯' : '') +
        (d.querySelector('degree-value')?.textContent ?? '')
      );
    })
    .join('');
  return { root: pitch(name), kind, symbol: name + suffix + degrees + (bass ? '/' + bass : '') };
}

// LilyPond emits score moments in whole notes and pitches in semitones.
export function readLilyChords(source: string, ppq: number): WrittenChord[] {
  const written: WrittenChord[] = [];
  const spell = (step: number, alter: number) =>
    'CDEFGAB'[step] + (alter < 0 ? '♭' : '♯').repeat(Math.min(2, Math.abs(alter)));
  for (const line of source.trim().split('\n')) {
    const [moment, step, alter, tones, bass, bassAlter, duration, text] = line.split('|');
    if (!tones) continue;
    const pitches = tones.split(',').map(Number);
    const intervals = [...new Set(pitches.map((p) => (p - pitches[0]) % 12))].sort((a, b) => a - b);
    const shape = shapes.find((s) => s.tones.join(',') === intervals.join(','));
    const root = spell(Number(step), Number(alter));
    const slash = Number(bass) >= 0 ? '/' + spell(Number(bass), Number(bassAlter)) : '';
    written.push({
      tick: Math.round(Number(moment) * 4 * ppq),
      endTick: Math.round((Number(moment) + Number(duration)) * 4 * ppq),
      chord: {
        root: pitch(root),
        kind: shape?.kind ?? 'other',
        symbol: shape ? root + shape.suffix + slash : text || root,
      },
    });
  }
  return written;
}

interface Key {
  tonic: number;
  minor: boolean;
  sharp: boolean;
}

// Compare duration-weighted pitch classes with major/minor key profiles.
// A close relative-major/minor match is insufficient evidence for a degree.
function estimateKey(hist: number[]): Key | undefined {
  const profiles = [
    [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88],
    [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17],
  ];
  const candidates = profiles
    .flatMap((profile, mode) => {
      const mean = profile.reduce((a, b) => a + b) / 12;
      const norm = Math.sqrt(profile.reduce((sum, v) => sum + (v - mean) ** 2, 0));
      return hist.map((_, tonic) => ({
        tonic,
        minor: mode === 1,
        sharp: false,
        value: hist.reduce((sum, v, i) => sum + (v * (profile[(i - tonic + 12) % 12] - mean)) / norm, 0),
      }));
    })
    .sort((a, b) => b.value - a.value);
  return candidates[0].value > 0 && candidates[1].value < candidates[0].value * 0.9
    ? candidates[0]
    : undefined;
}

function degreeOf(chord: Chord, key?: Key) {
  if (!key) return '';
  const scale = key.minor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
  const index = scale.indexOf((chord.root - key.tonic + 12) % 12);
  if (index < 0) return '';
  const shape = shapes.find((s) => s.kind === chord.kind);
  if (!shape || chord.kind.startsWith('suspended')) return '';
  const inKey = shape.tones.every(tone => {
    const step = (chord.root + tone - key.tonic + 12) % 12;
    return scale.includes(step) || (key.minor && step === 11);
  });
  if (!inKey) return '';
  const numeral = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'][index];
  return (
    (shape.tones.includes(3) ? numeral.toLowerCase() : numeral) +
    ({
      diminished: '°',
      'half-diminished': 'ø7',
      'diminished-seventh': '°7',
      augmented: '+',
      'major-seventh': 'maj7',
      'minor-seventh': '7',
      dominant: '7',
    }[chord.kind] ?? '')
  );
}

interface Note {
  ticks: number;
  durationTicks: number;
  midi: number;
}
function recognize(notes: Note[], start: number, end: number, key?: Key): Chord | null {
  const weights: number[] = Array(12).fill(0);
  let bass = Infinity;
  for (const n of notes) {
    const span = Math.min(end, n.ticks + n.durationTicks) - Math.max(start, n.ticks);
    if (span <= 0) continue;
    weights[n.midi % 12] += span * (n.ticks === start ? 1.2 : 1);
    bass = Math.min(bass, n.midi);
  }
  const total = weights.reduce((a, b) => a + b);
  if (!total) return null;
  const names = key?.sharp ? sharps : flats;
  let best: Chord | null = null;
  let bestScore = 0.87;
  for (let root = 0; root < 12; root++) {
    if (!weights[root]) continue;
    for (const shape of shapes) {
      const tones = shape.tones.map((n) => weights[(n + root) % 12]);
      if (tones.some((w) => w < total * 0.045)) continue;
      const coverage = tones.reduce((a, b) => a + b) / total;
      const score = coverage + (bass % 12 === root ? 0.09 : 0) - (tones.length - 3) * 0.035;
      if (score <= bestScore) continue;
      bestScore = score;
      const inversion = bass % 12 !== root && shape.tones.includes((bass - root + 12) % 12);
      best = {
        root,
        kind: shape.kind,
        symbol: names[root] + shape.suffix + (inversion ? '/' + names[bass % 12] : ''),
      };
    }
  }
  return best;
}

export function analyzeHarmony(midi: Midi, marks: WrittenChord[]): HarmonyEvent[] {
  const notes = midi.tracks
    .filter((tr) => !tr.instrument.percussion)
    .flatMap((tr) => tr.notes)
    .sort((a, b) => a.ticks - b.ticks);
  if (!notes.length) return [];
  const histogram: number[] = Array(12).fill(0);
  for (const n of notes) histogram[n.midi % 12] += n.durationTicks;
  const inferredKey = estimateKey(histogram);
  const authored = [...marks].sort((a, b) => a.tick - b.tick);
  const keys = [...midi.header.keySignatures].sort((a, b) => a.ticks - b.ticks);
  const end = midi.durationTicks;
  const beatChanges = midi.header.timeSignatures;
  const events: HarmonyEvent[] = [];
  let key = inferredKey,
    markIndex = 0,
    keyIndex = 0,
    meterIndex = 0,
    beat = midi.header.ppq;
  let noteIndex = 0,
    sounding: Note[] = [];
  for (let tick = 0; tick < end; ) {
    while (keyIndex < keys.length && keys[keyIndex].ticks <= tick) {
      const signature = keys[keyIndex++];
      const minor = signature.scale === 'minor';
      key = {
        tonic: (pitch(signature.key) + (minor ? 9 : 0)) % 12,
        minor,
        sharp: keyNames.indexOf(signature.key) > 7,
      };
    }
    while (meterIndex < beatChanges.length && beatChanges[meterIndex].ticks <= tick) {
      const [num, den] = beatChanges[meterIndex++].timeSignature;
      beat = Math.max(
        1,
        Math.round(((midi.header.ppq * 4) / den) * (den === 8 && num >= 6 && num % 3 === 0 ? 3 : 1)),
      );
    }
    while (markIndex < authored.length && authored[markIndex].tick <= tick) markIndex++;
    const previousMark = authored[markIndex - 1];
    const mark = tick < (previousMark?.endTick ?? Infinity) ? previousMark : undefined;
    const next = Math.min(
      end,
      mark?.endTick ?? Infinity,
      tick + beat,
      authored[markIndex]?.tick ?? Infinity,
      beatChanges[meterIndex]?.ticks ?? Infinity,
      keys[keyIndex]?.ticks ?? Infinity,
    );
    sounding = sounding.filter((n) => n.ticks + n.durationTicks > tick);
    while (noteIndex < notes.length && notes[noteIndex].ticks < next) sounding.push(notes[noteIndex++]);
    let chord = mark ? mark.chord : recognize(sounding, tick, next, key);
    // Broken chords may need the next beat to complete the triad.
    if (!mark && !chord && sounding.length) {
      const context = [...sounding];
      for (let i = noteIndex; i < notes.length && notes[i].ticks < next + beat; i++)
        context.push(notes[i]);
      chord = recognize(context, tick, next + beat, key);
    }
    if (chord) {
      const start = mark || sounding.some((n) => n.ticks <= tick) ? tick : sounding[0].ticks;
      const degree = degreeOf(chord, key);
      const last = events.at(-1);
      if (
        last?.end === start &&
        last.chord.symbol === chord.symbol &&
        last.degree === degree &&
        last.written === !!mark
      )
        last.end = next;
      else events.push({ tick: start, end: next, chord, degree, written: !!mark });
    }
    tick = next;
  }
  return events;
}
