import { Midi } from '@tonejs/midi';
import { readFollowScore, registerFollowScore, type FollowScore } from './followScore';
import type { WrittenChord } from './harmony';
import type { SimpleNote } from './arpeggio';

export interface SavedNotation {
  version: 1;
  pages: string[];
  layout: FollowScore;
  score: ReturnType<Midi['toJSON']>;
  clock: { scoreTime: number; s: number }[];
  writtenChords: WrittenChord[];
  bars: number;
  midiNotation: boolean;
}

export async function captureNotation(load: () => Promise<string[]>, midi: Midi, notes: Pick<SimpleNote, 's' | 'scoreTime'>[],
  writtenChords: WrittenChord[], bars: number, midiNotation: boolean): Promise<SavedNotation> {
  const pages = await load();
  if (!pages.length) throw new Error('Missing engraved score');
  const earliest = new Map<number, number>();
  for (const note of notes) if (note.scoreTime !== undefined)
    earliest.set(note.scoreTime, Math.min(earliest.get(note.scoreTime) ?? Infinity, note.s));
  return { version: 1, pages, layout: readFollowScore(pages), score: midi.toJSON(),
    clock: Array.from(earliest, ([scoreTime, s]) => ({ scoreTime, s })), writtenChords, bars, midiNotation };
}

export async function packNotation(notation: SavedNotation) {
  const json = new Blob([JSON.stringify(notation)]);
  if (json.size > maxBytes) throw new Error('Score exceeds the notation size limit');
  return new Response(json.stream().pipeThrough(new CompressionStream('gzip'))).blob();
}

const maxBytes = 64 * 1024 * 1024;
export async function unpackNotation(response: Response): Promise<SavedNotation> {
  if (!response.ok || !response.body) throw new Error('Missing saved notation');
  const reader = response.body.pipeThrough(new DecompressionStream('gzip')).getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error('Score exceeds the notation size limit');
    }
    chunks.push(value as Uint8Array<ArrayBuffer>);
  }
  const data: SavedNotation = JSON.parse(await new Blob(chunks).text());
  if (data.version !== 1 || !Array.isArray(data.pages) || !data.pages.length ||
      !data.pages.every(p => typeof p === 'string') || data.layout?.pages?.length !== data.pages.length ||
      !data.layout.pages.every(page => Array.isArray(page?.box) && page.box.length === 4 && page.box.every(Number.isFinite)) ||
      typeof data.layout.repeats !== 'string' || !Array.isArray(data.layout.rows) || !Array.isArray(data.layout.measures) ||
      !Array.isArray(data.clock) || !Array.isArray(data.writtenChords) || !data.score?.header)
    throw new Error('Invalid saved notation');
  registerFollowScore(data.pages, data.layout);
  return data;
}

// Earlier library entries could already contain a private source file. Use its
// notation, and match successive attacks per pitch to recover the playback clock.
export async function notationFromSource(source: File, performance: Midi) {
  const { isDirectScoreFile, parseDirectScoreFile } = await import('./scoreImport');
  const { importedSheetLoader } = await import('./importedSheet');
  const { lilypondEngine } = await import('./instances');
  const imported = isDirectScoreFile(source.name) ? await parseDirectScoreFile(source) : null;
  const score = imported ? { scoreMidi: imported.midi, writtenChords: imported.writtenChords ?? [],
    loadPages: importedSheetLoader(imported) } : await lilypondEngine.compile(await source.text());
  const played = performance.tracks.flatMap(track => track.notes).sort((a,b) => b.time-a.time);
  const byPitch = new Map<number, number[]>();
  for (const n of played) {
    const group = byPitch.get(n.midi) ?? [];
    group.push(n.time);
    byPitch.set(n.midi, group);
  }
  const notes = score.scoreMidi.tracks.flatMap(track => track.notes).sort((a,b) => a.time-b.time);
  const clock: SavedNotation['clock'] = [];
  if (notes.length === played.length) {
    for (const n of notes) {
      const s = byPitch.get(n.midi)?.pop();
      if (s === undefined) { clock.length = 0; break; }
      clock.push({s, scoreTime:n.time});
    }
  }
  const last = Math.max(0, ...score.scoreMidi.tracks.map(track => track.notes.at(-1)?.ticks ?? 0));
  return captureNotation(score.loadPages,score.scoreMidi,clock,score.writtenChords,
    1 + Math.floor(score.scoreMidi.header.ticksToMeasures(last)), imported?.kind === 'midi');
}
