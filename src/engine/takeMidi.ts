import type { Midi } from '@tonejs/midi';
import type { TakeRecord } from '../store/useStudioStore';
import { takeModelNames } from './performance/types';
import { notesToMidiBytes } from './pianoflow';

export function finalTakeMidi(take: TakeRecord, header: Midi['header']) {
  if (take.finalMidi) return take.finalMidi;
  return take.midi
    ? notesToMidiBytes(take.midi.restored, takeModelNames[take.model], take.midi.pedals,
      take.model === 'pianist' ? header : undefined)
    : notesToMidiBytes(take.restoredNotes, 'final_restored');
}
