/**
 * Singleton pure-TypeScript engine instances shared across Zustand actions
 * and 60fps Canvas render loops without triggering React re-renders.
 */
import { BrowserLilyPondEngine } from './lilypond';
import { BrowserPianoFlow } from './pianoflow';
import { StudioGrandPianoPlayer } from './pianoAudio';

export const lilypondEngine = new BrowserLilyPondEngine();
export const pianoFlowEngine = new BrowserPianoFlow();
export const pianoPlayer = new StudioGrandPianoPlayer();
