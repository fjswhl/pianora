import { create } from 'zustand';
import { scorePresets } from '../engine/presets';
import {
  isDirectScoreFile,
  parseDirectScoreFile,
  type ImportedScoreData,
} from '../engine/scoreImport';

let revision = 0;
const sources = new Map<string, string>();

interface ScoreState {
  lyCode: string;
  selectedPresetId: string;
  importedScore: ImportedScoreData | null;
  loading: boolean;
  error: string;
  pipelineBusy: boolean;
  selectPreset: (id: string) => Promise<void>;
  setLyCode: (code: string) => void;
  importFile: (file: File) => Promise<boolean>;
  clearImportedScore: () => void;
}

export const useScoreStore = create<ScoreState>((set, get) => ({
  lyCode: '',
  selectedPresetId: 'short_etude',
  importedScore: null,
  loading: false,
  error: '',
  pipelineBusy: false,

  setLyCode(code) {
    revision++;
    set({
      lyCode: code,
      selectedPresetId: 'custom',
      importedScore: null,
      loading: false,
      error: '',
    });
  },

  clearImportedScore() {
    set({ importedScore: null, error: '' });
    if (!get().lyCode) {
      void get().selectPreset('short_etude');
    }
  },

  async importFile(file) {
    const request = ++revision;
    set({ loading: true, error: '' });
    try {
      if (isDirectScoreFile(file.name)) {
        const parsed = await parseDirectScoreFile(file);
        if (request === revision) {
          set({
            importedScore: parsed,
            selectedPresetId: 'imported',
            loading: false,
            error: '',
          });
        }
        return true;
      }
      const text = await file.text();
      if (request === revision) {
        set({
          lyCode: text,
          importedScore: null,
          selectedPresetId: 'custom',
          loading: false,
          error: '',
        });
      }
      return true;
    } catch (err) {
      if (request === revision) {
        set({
          loading: false,
          error: (err as Error).message || '无法读取乐谱文件，请确认格式为 .ly / .mid / .musicxml / .mxl',
        });
      }
      return false;
    }
  },

  async selectPreset(id) {
    const preset = scorePresets.find((p) => p.id === id);
    if (!preset) return;
    const request = ++revision;
    set({ selectedPresetId: id, importedScore: null, loading: true, error: '' });
    try {
      let source = sources.get(id);
      if (source === undefined) {
        const response = await fetch(preset.url);
        if (
          !response.ok ||
          response.headers.get('content-type')?.includes('text/html')
        )
          throw new Error();
        source = await response.text();
        sources.set(id, source);
      }
      if (request === revision) set({ lyCode: source, importedScore: null, loading: false });
    } catch {
      if (request === revision)
        set({
          selectedPresetId: 'custom',
          loading: false,
          error: '曲谱加载失败，请重新选择。',
        });
    }
  },
}));
