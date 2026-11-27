import { create } from 'zustand';
import { scorePresets } from '../engine/presets';

let revision = 0;
const sources = new Map<string, string>();
interface ScoreState {
  lyCode: string;
  selectedPresetId: string;
  loading: boolean;
  error: string;
  pipelineBusy: boolean;
  selectPreset: (id: string) => Promise<void>;
  setLyCode: (code: string) => void;
}

export const useScoreStore = create<ScoreState>((set) => ({
  lyCode: '',
  selectedPresetId: 'short_etude',
  loading: false,
  error: '',
  pipelineBusy: false,
  setLyCode(code) {
    revision++;
    set({
      lyCode: code,
      selectedPresetId: 'custom',
      loading: false,
      error: '',
    });
  },
  async selectPreset(id) {
    const preset = scorePresets.find((p) => p.id === id);
    if (!preset) return;
    const request = ++revision;
    set({ selectedPresetId: id, loading: true, error: '' });
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
      if (request === revision) set({ lyCode: source, loading: false });
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
