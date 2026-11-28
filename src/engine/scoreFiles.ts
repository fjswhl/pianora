import { LocalizedError } from '../i18n';
import type { RawArpeggioAnnotation } from './arpeggio';

export function readScoreFiles(files: Record<string, Uint8Array>) {
  const midiKey = Object.keys(files).find((key) => /\.midi?$/.test(key));
  if (!midiKey)
    throw new LocalizedError("LilyPond WASM 未输出 MIDI，请确认源码中包含 \\midi {} 块。");
  const decoder = new TextDecoder();
  const svgPages = Object.keys(files)
    .filter((key) => key.endsWith('.svg'))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((key) => decoder.decode(files[key]));
  const rawAnnotations: RawArpeggioAnnotation[] = files['annotations.json']
    ? JSON.parse(decoder.decode(files['annotations.json']))
    : [];
  return { midi: files[midiKey], svgPages, rawAnnotations, chordText: decoder.decode(files['pn-chords.tsv']) };
}
