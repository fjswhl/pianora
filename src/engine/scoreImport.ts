import { LocalizedError, t } from '../i18n';
/**
 * Pure-browser multi-format score importer for Pianora:
 *  - Standard MIDI (.mid / .midi)
 *  - Uncompressed MusicXML (.musicxml / .xml)
 *  - Compressed MusicXML (.mxl — standard ZIP archive, decompressed natively via DecompressionStream)
 *
 * Extracts a clean @tonejs/midi `Midi` object + symbolic arpeggio annotations (`RawArpeggioAnnotation[]`)
 * ready to feed directly into PianoFlow WebGPU inference & Stage 4 arpeggio restoration.
 */
import { keyNames, readWrittenChord, type WrittenChord } from './harmony';
import { Midi } from '@tonejs/midi';
import type { RawArpeggioAnnotation } from './arpeggio';

import { realizeOrnaments, readXmlOrnament, type Ornament } from './ornaments';
import type { Note } from '@tonejs/midi/dist/Note';
import type { ScoreMark } from './performance/types';

export type ImportedFormat = 'midi' | 'musicxml';

export interface ImportedScoreData {
  kind: ImportedFormat;
  fileName: string;
  title: string;
  composer: string;
  midi: Midi;
  rawAnnotations: RawArpeggioAnnotation[];
  musicXmlText?: string;
  performanceMarks?: Map<string, ScoreMark>;
  midiFile?: File;
  writtenChords?: WrittenChord[];
  noteCount: number;
  barCount: number;
  durationSec: number;
  tempoBpm: number;
  timeSig: string;
}

const STEP_SEMITONES: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

const DYNAMICS_VEL: Record<string, number> = {
  ppp: 0.22,
  pp: 0.32,
  p: 0.44,
  mp: 0.56,
  mf: 0.68,
  f: 0.80,
  ff: 0.90,
  fff: 0.98,
};

// MusicXML sound tempo counts quarter notes; a printed metronome counts
// whichever (possibly dotted) note value is engraved next to the number.
function directionTempo(direction: Element): number {
  const sound = parseFloat(direction.querySelector('sound[tempo]')?.getAttribute('tempo') ?? '');
  if (Number.isFinite(sound) && sound > 0) return sound;
  const metro = direction.querySelector('metronome');
  const perMinute = parseFloat(metro?.querySelector('per-minute')?.textContent ?? '');
  const unit = metro?.querySelector('beat-unit')?.textContent?.trim() || 'quarter';
  const quarters: Record<string, number> = {
    maxima: 32, long: 16, breve: 8, whole: 4, half: 2, quarter: 1, eighth: 0.5,
    '16th': 0.25, '32nd': 0.125, '64th': 1/16, '128th': 1/32, '256th': 1/64,
    '512th': 1/128, '1024th': 1/256,
  };
  const dots = metro?.querySelectorAll('beat-unit-dot').length ?? 0;
  return perMinute * quarters[unit] * (2 - 2 ** -dots);
}

function cleanBaseName(fileName: string): string {
  return fileName.replace(/\.(mid|midi|musicxml|xml|mxl)$/i, '').replace(/[_-]+/g, ' ').trim() || t("导入乐谱");
}

function summarizeMidi(midi: Midi): {
  noteCount: number;
  barCount: number;
  durationSec: number;
  tempoBpm: number;
  timeSig: string;
} {
  const notes = midi.tracks.flatMap((t) => t.notes);
  const ppq = midi.header.ppq || 480;
  const ts = midi.header.timeSignatures[0]?.timeSignature ?? [4, 4];
  const barTicks = Math.max(1, (ppq * 4 * ts[0]) / ts[1]);
  const maxTick = notes.reduce((mx, n) => Math.max(mx, n.ticks), 0);
  const durationSec = notes.reduce((mx, n) => Math.max(mx, n.time + n.duration), 0);
  const tempoBpm = Math.round(midi.header.tempos[0]?.bpm ?? 100);
  return {
    noteCount: notes.length,
    barCount: notes.length ? Math.floor(maxTick / barTicks) + 1 : 0,
    durationSec: Number(durationSec.toFixed(2)),
    tempoBpm,
    timeSig: `${ts[0]}/${ts[1]}`,
  };
}

/**
 * Parse a standard .mid / .midi file into a piano-ready Midi object (filtering percussion channel 9).
 */
export async function parseMidiScoreFile(file: File): Promise<ImportedScoreData> {
  const ab = await file.arrayBuffer();
  const raw = new Midi(ab);

  // Rebuild clean piano-focused Midi filtering percussion tracks (channel 9) & empty tracks
  const clean = new Midi();
  const ppq = raw.header.ppq || 480;
  // Copy header tempos & time signatures via private-safe header API
  if (raw.header.tempos.length) {
    clean.header.tempos = raw.header.tempos.map((t) => ({
      ticks: Math.round((t.ticks * clean.header.ppq) / ppq),
      bpm: t.bpm,
    }));
  } else {
    clean.header.setTempo(100);
  }
  if (raw.header.timeSignatures.length) {
    clean.header.timeSignatures = raw.header.timeSignatures.map((ts) => ({
      ticks: Math.round((ts.ticks * clean.header.ppq) / ppq),
      timeSignature: [...ts.timeSignature],
      measures: ts.measures,
    }));
  } else {
    clean.header.timeSignatures.push({ ticks: 0, timeSignature: [4, 4] });
  }
  clean.header.keySignatures = raw.header.keySignatures.map(k => ({
    ...k, ticks: Math.round(k.ticks * clean.header.ppq / ppq),
  }));
  clean.header.update();

  const scale = clean.header.ppq / ppq;
  let totalAdded = 0;

  for (const srcTrack of raw.tracks) {
    if (srcTrack.channel === 9 || srcTrack.instrument.percussion) continue;
    if (!srcTrack.notes.length) continue;
    const dst = clean.addTrack();
    dst.name = srcTrack.name || 'Piano';
    dst.instrument.number = 0;
    for (const cc of srcTrack.controlChanges[64] ?? []) dst.addCC({ number: 64, ticks: Math.round(cc.ticks * scale), value: cc.value });
    for (const n of srcTrack.notes) {
      if (n.midi < 21 || n.midi > 108) continue;
      dst.addNote({
        midi: n.midi,
        ticks: Math.max(0, Math.round(n.ticks * scale)),
        durationTicks: Math.max(1, Math.round(Math.max(1, n.durationTicks) * scale)),
        velocity: Math.max(0.08, Math.min(1.0, n.velocity || 0.65)),
      });
      totalAdded++;
    }
  }

  if (totalAdded === 0) {
    throw new LocalizedError("该 MIDI 文件中没有找到可用的钢琴音符（可能仅包含打击乐轨道或为空文件）。");
  }

  const stats = summarizeMidi(clean);
  const title = raw.name?.trim() || cleanBaseName(file.name);
  return {
    kind: 'midi',
    midiFile: file,
    fileName: file.name,
    title,
    get composer() { return t("MIDI 导入"); },
    midi: clean,
    rawAnnotations: [],
    ...stats,
  };
}

/**
 * Lightweight zero-dependency ZIP reader for compressed MusicXML (.mxl) files
 * using browser-native `DecompressionStream('deflate-raw')`.
 */
async function extractZipEntries(ab: ArrayBuffer): Promise<Map<string, Uint8Array>> {
  const view = new DataView(ab);
  const bytes = new Uint8Array(ab);
  const entries = new Map<string, Uint8Array>();

  // Locate End of Central Directory (EOCD signature 0x06054b50)
  let eocdOffset = -1;
  const minPos = Math.max(0, bytes.length - 65557);
  for (let i = bytes.length - 22; i >= minPos; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) {
    throw new LocalizedError("无效的 .mxl 压缩文件（未找到 ZIP 目录尾）。");
  }

  const cdEntries = view.getUint16(eocdOffset + 10, true);
  let cdOffset = view.getUint32(eocdOffset + 16, true);
  const decoder = new TextDecoder('utf-8');

  for (let i = 0; i < cdEntries; i++) {
    if (view.getUint32(cdOffset, true) !== 0x02014b50) break;
    const method = view.getUint16(cdOffset + 10, true);
    const compSize = view.getUint32(cdOffset + 20, true);
    const nameLen = view.getUint16(cdOffset + 28, true);
    const extraLen = view.getUint16(cdOffset + 30, true);
    const commentLen = view.getUint16(cdOffset + 32, true);
    const localHeaderOff = view.getUint32(cdOffset + 42, true);
    const fileName = decoder.decode(bytes.subarray(cdOffset + 46, cdOffset + 46 + nameLen));
    cdOffset += 46 + nameLen + extraLen + commentLen;

    if (fileName.endsWith('/')) continue;
    const lhNameLen = view.getUint16(localHeaderOff + 26, true);
    const lhExtraLen = view.getUint16(localHeaderOff + 28, true);
    const dataStart = localHeaderOff + 30 + lhNameLen + lhExtraLen;
    const compressed = bytes.subarray(dataStart, dataStart + compSize);

    if (method === 0) {
      entries.set(fileName, compressed);
    } else if (method === 8) {
      const ds = new DecompressionStream('deflate-raw');
      const writer = ds.writable.getWriter();
      const copy = new Uint8Array(compressed.byteLength);
      copy.set(compressed);
      void writer.write(copy).then(() => writer.close());
      const out = await new Response(ds.readable).arrayBuffer();
      entries.set(fileName, new Uint8Array(out));
    }
  }
  return entries;
}

async function readMusicXmlText(file: File): Promise<string> {
  if (!/\.mxl$/i.test(file.name)) {
    return await file.text();
  }
  const ab = await file.arrayBuffer();
  const entries = await extractZipEntries(ab);
  const decoder = new TextDecoder('utf-8');

  // Prefer META-INF/container.xml rootfile path
  let targetPath: string | null = null;
  const containerBytes = entries.get('META-INF/container.xml');
  if (containerBytes) {
    const containerXml = decoder.decode(containerBytes);
    const m = containerXml.match(/full-path\s*=\s*"([^"]+)"/i);
    if (m && entries.has(m[1])) targetPath = m[1];
  }
  if (!targetPath) {
    for (const key of entries.keys()) {
      if (!key.startsWith('META-INF/') && /\.(musicxml|xml)$/i.test(key)) {
        targetPath = key;
        break;
      }
    }
  }
  if (!targetPath) {
    throw new LocalizedError("压缩包 .mxl 中未找到有效的 MusicXML 乐谱文件。");
  }
  return decoder.decode(entries.get(targetPath)!);
}

/**
 * Parse MusicXML (.musicxml / .xml / .mxl) into a standard Midi object + extracted arpeggio annotations.
 */
export async function parseMusicXmlFile(file: File): Promise<ImportedScoreData> {
  const xmlText = await readMusicXmlText(file);
  const ornamentMarks = new Map<Note, Ornament>();
  const performanceMarks = new Map<string, ScoreMark>();
  const writtenChords = new Map<number, WrittenChord>();
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (doc.querySelector('parsererror')) {
    throw new LocalizedError("MusicXML 文件解析失败，请检查 XML 格式是否完整。");
  }

  const workTitle =
    doc.querySelector('work > work-title')?.textContent?.trim() ||
    doc.querySelector('movement-title')?.textContent?.trim() ||
    cleanBaseName(file.name);
  const composer =
    doc.querySelector('identification > creator[type="composer"]')?.textContent?.trim();

  const midi = new Midi();
  const PPQ = midi.header.ppq; // 480
  const tempos: Array<{ ticks: number; bpm: number }> = [];
  const timeSigs: Array<{ ticks: number; timeSignature: number[] }> = [];
  const rawAnnotations: RawArpeggioAnnotation[] = [];
  const arpDedup = new Set<string>();

  const parts = Array.from(doc.querySelectorAll('score-partwise > part'));
  if (!parts.length) {
    throw new LocalizedError("仅支持标准 score-partwise 格式的 MusicXML 文件（未找到 <part> 节点）。");
  }

  let totalNotes = 0;

  for (let pIdx = 0; pIdx < parts.length; pIdx++) {
    const part = parts[pIdx];
    const partId = part.getAttribute('id') || '';
    const partName =
      doc.querySelector(`part-list > score-part[id="${partId}"] > part-name`)?.textContent?.trim() ||
      `Part ${pIdx + 1}`;

    const track = midi.addTrack();
    track.name = partName;
    track.instrument.number = 0;

    let divisions = 1;
    let partTick = 0;
    let curVel = 0.65;
    let dynamic = 0;
    let dynamicStart = 0;
    let barNum = 0;
    let fifths = 0;
    const staffKeys = new Map<string, number>();
    const trillLines = new Set<string>();

    // Active ties keyed by `${voice}_${staff}_${midiPitch}` -> { ticks, durationTicks, velocity }
    const openTies = new Map<string, { midi: number; ticks: number; durationTicks: number; velocity: number }>();
    const pendingNotes: Array<{ midi: number; ticks: number; durationTicks: number; velocity: number; ornament?: Ornament }> = [];

    const measures = Array.from(part.children).filter((el) => el.tagName === 'measure');
    for (const measure of measures) {
      barNum++;
      const accidentals = new Map<string, number>();
      let measureStartTick = partTick;
      let cursorTick = measureStartTick;
      let lastNoteOnsetTick = measureStartTick;
      let maxMeasureEndTick = measureStartTick;

      for (const child of Array.from(measure.children)) {
        const tag = child.tagName;

        if (tag === 'attributes') {
          const divTxt = child.querySelector('divisions')?.textContent;
          if (divTxt) {
            const parsed = parseFloat(divTxt);
            if (parsed > 0) divisions = parsed;
          }
          for (const key of child.querySelectorAll('key')) {
            const value = key.querySelector('fifths')?.textContent;
            if (value == null) continue;
            const number = key.getAttribute('number');
            if (number) staffKeys.set(number, Number(value));
            else { fifths = Number(value); staffKeys.clear(); }
          }
          if (pIdx === 0) {
            const key = child.querySelector('key');
            if (key?.querySelector('fifths')) {
              const name = keyNames[7 + Number(key.querySelector('fifths')?.textContent)];
              const scale = key.querySelector('mode')?.textContent || 'major';
              if (name && (scale === 'minor' || scale === 'major'))
                midi.header.keySignatures.push({ ticks: cursorTick, key: name, scale });
            }
            const beatsEl = child.querySelector('time > beats');
            const beatTypeEl = child.querySelector('time > beat-type');
            if (beatsEl && beatTypeEl) {
              const num = parseInt(beatsEl.textContent || '4', 10) || 4;
              const den = parseInt(beatTypeEl.textContent || '4', 10) || 4;
              if (!timeSigs.length || timeSigs[timeSigs.length - 1].ticks !== cursorTick) {
                timeSigs.push({ ticks: cursorTick, timeSignature: [num, den] });
              }
            }
          }
        } else if (tag === 'harmony') {
          const offset = Number(child.querySelector('offset')?.textContent ?? 0);
          const tick = Math.max(0, cursorTick + Math.round(offset * PPQ / divisions));
          if (Number.isFinite(tick) && !writtenChords.has(tick))
            writtenChords.set(tick, { tick, chord: readWrittenChord(child) });
        } else if (tag === 'direction') {
          if (pIdx === 0) {
            const bpm = directionTempo(child);
            if (Number.isFinite(bpm) && bpm > 0) {
              if (!tempos.length || tempos[tempos.length - 1].ticks !== cursorTick) {
                tempos.push({ ticks: cursorTick, bpm });
              }
            }
          }
          const dynEl = child.querySelector('direction-type > dynamics');
          if (dynEl && dynEl.firstElementChild) {
            const v = DYNAMICS_VEL[dynEl.firstElementChild.tagName.toLowerCase()];
            if (v !== undefined) {
              curVel = v;
              const word = dynEl.firstElementChild.tagName.toLowerCase();
              const scale: Record<string, number> = { ppp:-.9, pp:-.7, p:-.4, mp:-.2, mf:.2, f:.4, ff:.7, fff:.9 };
              dynamic = scale[word] ?? 0;
              dynamicStart = cursorTick / PPQ;
            }
          }
        } else if (tag === 'sound') {
          if (pIdx === 0) {
            const bpm = parseFloat(child.getAttribute('tempo') || '');
            if (Number.isFinite(bpm) && bpm >= 20 && bpm <= 300) {
              tempos.push({ ticks: cursorTick, bpm });
            }
          }
        } else if (tag === 'backup') {
          const dur = parseFloat(child.querySelector('duration')?.textContent || '0');
          const dTicks = Math.round((dur / divisions) * PPQ);
          cursorTick = Math.max(measureStartTick, cursorTick - dTicks);
        } else if (tag === 'forward') {
          const dur = parseFloat(child.querySelector('duration')?.textContent || '0');
          const dTicks = Math.round((dur / divisions) * PPQ);
          cursorTick += dTicks;
          if (cursorTick > maxMeasureEndTick) maxMeasureEndTick = cursorTick;
        } else if (tag === 'note') {
          const isGrace = Boolean(child.querySelector('grace'));
          const isChord = Boolean(child.querySelector('chord'));
          const isRest = Boolean(child.querySelector('rest'));
          const durDiv = parseFloat(child.querySelector('duration')?.textContent || '0');
          const durTicks = isGrace ? Math.round(PPQ * 0.14) : Math.max(1, Math.round((durDiv / divisions) * PPQ));

          const onsetTick = isGrace
            ? Math.max(0, cursorTick - durTicks)
            : isChord
              ? lastNoteOnsetTick
              : cursorTick;

          if (!isRest) {
            const pitchEl = child.querySelector('pitch');
            if (pitchEl) {
              const step = (pitchEl.querySelector('step')?.textContent || 'C').trim().toUpperCase();
              const alter = parseFloat(pitchEl.querySelector('alter')?.textContent || '0') || 0;
              const octave = parseInt(pitchEl.querySelector('octave')?.textContent || '4', 10);
              const semi = STEP_SEMITONES[step] ?? 0;
              const midiPitch = Math.round((octave + 1) * 12 + semi + alter);

              if (midiPitch >= 21 && midiPitch <= 108) {
                const voice = child.querySelector('voice')?.textContent?.trim() || '1';
                const staff = child.querySelector('staff')?.textContent?.trim() || '1';
                const accidentalKey = (s: string, o: number) => [staff, s, o].join('/');
                accidentals.set(accidentalKey(step, octave), alter);
                const lineKey = voice + '/' + staff + '/';
                const lines = Array.from(child.querySelectorAll('ornaments > wavy-line'));
                for (const line of lines) if (line.getAttribute('type') === 'start')
                  trillLines.add(lineKey + (line.getAttribute('number') || '1'));
                const ornament = readXmlOrnament(child, step, octave, midiPitch, staffKeys.get(staff) ?? fifths,
                  lines.length > 0 || (!isChord && !isGrace && Array.from(trillLines).some(key => key.startsWith(lineKey))),
                  (s, o) => accidentals.get(accidentalKey(s, o)));
                for (const line of lines) if (line.getAttribute('type') === 'stop')
                  trillLines.delete(lineKey + (line.getAttribute('number') || '1'));
                const tieKey = `${voice}_${staff}_${midiPitch}`;
                const tieEls = Array.from(child.querySelectorAll('tie'));
                const hasTieStart = tieEls.some((t) => t.getAttribute('type') === 'start');
                const hasTieStop = tieEls.some((t) => t.getAttribute('type') === 'stop');

                // Extract symbolic <arpeggiate/> moment for Stage 4 restoration!
                if (child.querySelector('notations > arpeggiate')) {
                  const wholeTicks = PPQ * 4;
                  const key = `${barNum}:${onsetTick}`;
                  if (!arpDedup.has(key)) {
                    arpDedup.add(key);
                    rawAnnotations.push({ bar: barNum, num: onsetTick, den: wholeTicks });
                  }
                }

                if (hasTieStop && openTies.has(tieKey)) {
                  const prev = openTies.get(tieKey)!;
                  prev.durationTicks += durTicks;
                  if (!hasTieStart) openTies.delete(tieKey);
                } else {
                  const noteObj = {
                    ornament,
                    midi: midiPitch,
                    ticks: onsetTick,
                    durationTicks: durTicks,
                    velocity: curVel,
                  };
                  performanceMarks.set([midi.tracks.length - 1, onsetTick, midiPitch].join('/'), {
                    voice: Number(voice) || pIdx + 1, divisions, measure: barNum - 1, measureStart: measureStartTick,
                    dynamic, dynamicStart,
                    slurBeam: [
                      ...['start','continue','stop'].map(type => Number(Boolean(child.querySelector('slur[type="'+type+'"]')))),
                      ...['begin','continue','end'].map(type => Number(Array.from(child.querySelectorAll('beam')).some(el => el.textContent?.trim()===type))),
                    ],
                    notation: ['trill-mark','tenuto','accent','staccato','fermata','arpeggiate','strong-accent','cue','slash']
                      .map(tag => Number(Boolean(child.querySelector(tag)))),
                  });
                  pendingNotes.push(noteObj);
                  if (hasTieStart) openTies.set(tieKey, noteObj);
                }
              }
            }
          }

          if (!isGrace && !isChord) {
            lastNoteOnsetTick = cursorTick;
            cursorTick += durTicks;
            if (cursorTick > maxMeasureEndTick) maxMeasureEndTick = cursorTick;
          }
        }
      }

      partTick = maxMeasureEndTick;
    }

    pendingNotes.sort((a, b) => a.ticks - b.ticks || a.midi - b.midi);
    for (const { ornament, ...n } of pendingNotes) {
      track.addNote(n);
      if (ornament) ornamentMarks.set(track.notes[track.notes.length - 1], ornament);
      totalNotes++;
    }
  }

  if (totalNotes === 0) {
    throw new LocalizedError("该 MusicXML 文件中未解析到任何音符。");
  }

  if (tempos.length) {
    midi.header.tempos = tempos;
  } else {
    midi.header.setTempo(92);
  }
  if (timeSigs.length) {
    midi.header.timeSignatures = timeSigs;
  } else {
    midi.header.timeSignatures.push({ ticks: 0, timeSignature: [4, 4] });
  }
  midi.header.update();
  realizeOrnaments(midi, ornamentMarks, performanceMarks);

  const stats = summarizeMidi(midi);
  return {
    kind: 'musicxml',
    fileName: file.name,
    title: workTitle,
    get composer() { return composer || t("MusicXML 导入"); },
    midi,
    rawAnnotations,
    musicXmlText: xmlText,
    performanceMarks,
    writtenChords: [...writtenChords.values()],
    ...stats,
  };
}

/** Unified file format dispatcher */
export function isDirectScoreFile(fileName: string): boolean {
  return /\.(mid|midi|musicxml|xml|mxl)$/i.test(fileName);
}

export async function parseDirectScoreFile(file: File): Promise<ImportedScoreData> {
  if (/\.(mid|midi)$/i.test(file.name)) {
    return parseMidiScoreFile(file);
  }
  if (/\.(musicxml|xml|mxl)$/i.test(file.name)) {
    return parseMusicXmlFile(file);
  }
  throw new LocalizedError("不支持的文件格式，请导入 .ly、.mid / .midi、.musicxml / .mxl 乐谱文件。");
}
