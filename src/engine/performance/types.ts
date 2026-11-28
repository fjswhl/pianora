import type { SimpleNote } from '../arpeggio';

export const modelNames = {
  pianoflow: 'PianoFlow',
  pianist: 'Pianist Transformer',
  dexter: 'DExter',
  virtuosonet: 'VirtuosoNet',
};
export type LocalModel = Exclude<keyof typeof modelNames, 'pianoflow'>;
export interface ScoreMark {
  voice: number;
  divisions: number;
  measure: number;
  measureStart: number;
  notation: number[];
  slurBeam: number[];
  dynamic: number;
  dynamicStart: number;
}
export interface InputNote extends SimpleNote {
  quarter: number;
  length: number;
  voice: number;
  divisions: number;
  bar: number;
  barStart: number;
  numerator: number;
  denominator: number;
  bpm: number;
  tempoStart: number;
  notation: number[];
  slurBeam: number[];
  dynamic: number;
  dynamicStart: number;
}
export interface Pedal {
  time: number;
  value: number;
  number: 64 | 67;
}
export interface ModelScore {
  notes: InputNote[];
  pedals: Pedal[];
  composer: string;
}
export interface Performance {
  notes: SimpleNote[];
  pedals: Pedal[];
}
export interface RenderRequest {
  model: LocalModel;
  score: ModelScore;
  seed: number;
  dexSteps: number;
}
export type Update =
  | { status: 'progress'; done: number; total: number; loading?: boolean }
  | { status: 'result'; output: Performance }
  | { status: 'error'; message: string };
export type Progress = (done: number, total: number, loading?: boolean) => void;
