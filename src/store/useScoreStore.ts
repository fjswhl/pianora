import { message, errorText, type DisplayText } from '../i18n';
import { create } from 'zustand';
import { getPreset, label, composerName, type ScorePreset } from '../engine/presets';
import {
  isDirectScoreFile,
  parseDirectScoreFile,
  type ImportedScoreData,
} from '../engine/scoreImport';

let revision = 0;
const sources = new Map<string, string>();

interface ScoreState {
  lyCode: string;
  originalFile: File | null;
  selectedPresetId: string;
  selectedPreset: ScorePreset | null;
  importedScore: ImportedScoreData | null;
  loading: boolean;
  error: DisplayText;
  pipelineBusy: boolean;
  selectPreset: (id: string) => Promise<void>;
  setLyCode: (code: string) => void;
  importFile: (file: File) => Promise<boolean>;
  clearImportedScore: () => void;
}

export const useScoreStore = create<ScoreState>((set, get) => ({
  lyCode: '',
  originalFile: null,
  selectedPresetId: 'short_etude',
  selectedPreset: null,
  importedScore: null,
  loading: false,
  error: '',
  pipelineBusy: false,

  setLyCode(code) {
    revision++;
    set({
      lyCode: code,
      originalFile: null,
      selectedPresetId: 'custom',
      importedScore: null,
      loading: false,
      error: '',
    });
  },

  clearImportedScore() {
    set({ originalFile: null, importedScore: null, error: '' });
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
            originalFile: file,
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
          originalFile: file,
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
          error: errorText(err) || message("无法读取乐谱文件，请确认格式为 .ly / .mid / .musicxml / .mxl"),
        });
      }
      return false;
    }
  },

  async selectPreset(id) {
    const request = ++revision;
    set({ selectedPresetId: id, originalFile: null, importedScore: null, loading: true, error: '' });
    try {
      const preset = await getPreset(id);
      if (request !== revision) return;
      set({selectedPreset:preset});
      let source = sources.get(preset.url);
      if (source === undefined) {
        const response = await fetch(preset.url);
        if (
          !response.ok ||
          response.headers.get('content-type')?.includes('text/html')
        )
          throw new Error();
        if (isDirectScoreFile(preset.url)) {
          const fileName = preset.file.split('/').pop()!;
          const file = new File([await response.blob()], fileName);
          const parsed = await parseDirectScoreFile(file);
          if (request === revision) {
            set({
              originalFile: file,
              importedScore: {
                ...parsed,
                get title() { return label(preset, 'name'); },
                get composer() { return composerName(preset.composer); },
              },
              lyCode: '',
              loading: false,
            });
          }
          return;
        }
        source = await response.text();
        sources.set(preset.url, source);
        if (sources.size > 8) sources.delete(sources.keys().next().value!);
      }
      if (request === revision) set({ lyCode: source, importedScore: null, loading: false });
    } catch {
      if (request === revision)
        set({
          selectedPresetId: 'custom',
          loading: false,
          error: navigator.onLine ? message("曲谱加载失败，请重新选择。") : message("本机尚未缓存这份乐谱，请联网打开一次。"),
        });
    }
  },
}));
