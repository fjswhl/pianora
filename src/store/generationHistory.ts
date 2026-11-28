import type { Midi } from '@tonejs/midi';
import { display } from '../i18n';
import type { StudioState, TakeRecord } from './useStudioStore';

const stores = ['entries', 'sessions', 'pages'];
const limit = 10;

export interface HistoryEntry {
  id: number;
  time: number;
  title: string;
  model: TakeRecord['model'];
  seed: number;
  count: number;
  duration: number;
}

type Session = Pick<StudioState, 'writtenChords' | 'scoreNotes' | 'scoreDuration' |
  'rawAnnotations' | 'midiNotation' | 'totalBars' | 'arpMs' | 'cues' | 'cfmSteps' | 'stepFactor' | 'dexSteps'> & {
  mixer: Pick<StudioState, 'activeTimbreId' | 'activeHallId' | 'reverbWet' | 'resonanceAmount'> & { customFile?: File };
  performanceTitle: string;
  performanceSource: File;
  score: ReturnType<Midi['toJSON']>;
  takes: TakeRecord[];
  activeTakeId: string;
  stages: StudioState['stages'];
};

async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('pianora-generations', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('entries', { keyPath: 'id', autoIncrement: true });
      request.result.createObjectStore('sessions');
      request.result.createObjectStore('pages');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Database upgrade blocked'));
  });
}

async function transaction<T>(names: string[], mode: IDBTransactionMode,
  work: (tx: IDBTransaction) => IDBRequest<T>) {
  const db = await database();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(names, mode);
      tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));
      const result = work(tx);
      tx.oncomplete = () => resolve(result.result);
    });
  } finally { db.close(); }
}

export async function listGenerations(): Promise<HistoryEntry[]> {
  const entries = await transaction(['entries'], 'readonly', tx => tx.objectStore('entries').getAll());
  return entries.reverse();
}

export function getGeneration(id: number): Promise<Session | undefined> {
  return transaction(['sessions'], 'readonly', tx => tx.objectStore('sessions').get(id));
}

export function getGenerationPages(id: number): Promise<string[] | undefined> {
  return transaction(['pages'], 'readonly', tx => tx.objectStore('pages').get(id));
}

export function storeGenerationPages(id: number, pages: string[]) {
  return transaction(['entries', 'pages'], 'readwrite', tx => {
    const entry = tx.objectStore('entries').count(id);
    entry.onsuccess = () => { if (entry.result) tx.objectStore('pages').put(pages, id); };
    return entry;
  });
}

export async function rememberGeneration(state: StudioState, takes: TakeRecord[]) {
  if (!state.scoreMidi || !state.performanceSource || !takes.length) return;
  const take = takes.find(item => item.id === state.activeTakeId) ?? takes[0];
  const title = display(state.performanceTitle);
  const snapshot: Session = {
    mixer: { activeTimbreId: state.activeTimbreId, activeHallId: state.activeHallId,
      reverbWet: state.reverbWet, resonanceAmount: state.resonanceAmount,
      customFile: state.customTimbres.find(item => item.id === state.activeTimbreId)?.file },
    performanceTitle: title, performanceSource: state.performanceSource, score: state.scoreMidi.toJSON(),
    writtenChords: state.writtenChords, scoreNotes: state.scoreNotes, scoreDuration: state.scoreDuration,
    rawAnnotations: state.rawAnnotations, midiNotation: state.midiNotation, totalBars: state.totalBars,
    arpMs: state.arpMs, cues: state.cues, cfmSteps: state.cfmSteps, stepFactor: state.stepFactor, dexSteps: state.dexSteps,
    takes: takes.map(item => ({ ...item, label: display(item.label), subtitle: display(item.subtitle) })),
    activeTakeId: take.id,
    stages: Object.fromEntries(Object.entries(state.stages).map(([key, stage]) =>
      [key, { ...stage, stat: display(stage.stat) }])) as Session['stages'],
  };
  const key = await transaction(stores, 'readwrite', tx => {
    const entries = tx.objectStore('entries');
    const added = entries.add({ time: Date.now(), title, model: take.model, seed: take.seed,
      count: takes.length, duration: take.restoredDuration });
    added.onsuccess = () => {
      tx.objectStore('sessions').put(snapshot, added.result);
      const keys = entries.getAllKeys();
      keys.onsuccess = () => {
        for (const old of keys.result.slice(0, -limit)) {
          for (const name of stores) tx.objectStore(name).delete(old);
        }
      };
    };
    return added;
  });
  // The listening view already requests these pages. MIDI engraving is opt-in.
  if (!state.midiNotation && state.loadSheetPages) {
    void state.loadSheetPages().then(pages => storeGenerationPages(Number(key), pages)).catch(() => {});
  }
}
