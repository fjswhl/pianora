import { display, message, type DisplayText } from '../i18n';
import type { createReusableCompiler } from '@sightread/lilypond-wasm';
import { Midi } from '@tonejs/midi';
import { injectSchemeHook, type RawArpeggioAnnotation } from './arpeggio';
import midiOnly from './midiOnly.ily?raw';
import glyphCache from './svgGlyphCache.ily?raw';
import { readScoreFiles } from './scoreFiles';

interface ScoreData {
  scoreMidi: Midi;
  loadPages: () => Promise<string[]>;
  rawAnnotations: RawArpeggioAnnotation[];
}

type Progress = (msg: DisplayText, pct?: number) => void;
type Compiler = ReturnType<typeof createReusableCompiler>;

export class BrowserLilyPondEngine {
  private ready?: Promise<Compiler>;
  private progress?: Progress;
  private last?: { source: string; data: ScoreData };

  // Share initialization between editing and generation, including the first download.
  private prepare(): Promise<Compiler> {
    return (this.ready ??= this.initialize().catch((error) => {
      this.ready = undefined;
      throw error;
    }));
  }

  private async initialize() {
    const compiler = (
      await import('@sightread/lilypond-wasm')
    ).createReusableCompiler();
    try {
      const start = performance.now();
      await compiler.preload({
        onProgress: ({ loadedBytes, totalBytes }) => {
          if (totalBytes)
            this.progress?.(
              message("加载 LilyPond：{0}%", Math.round((100 * loadedBytes) / totalBytes)),
              5 + (15 * loadedBytes) / totalBytes,
            );
        },
      });
      performance.measure('pianora:lilypond-preload', { start });
      return compiler;
    } catch (error) {
      compiler.dispose();
      throw error;
    }
  }

  async warmForSource(source: string) {
    if (this.last?.source !== source) await this.prepare();
  }

  private async run(source: string, format: 'midi' | 'svg') {
    const compiler = await this.prepare();
    try {
      const start = performance.now();
      const settings = `pianora-${format}.ily`;
      const { files } = await compiler.compile(injectSchemeHook(source), {
        format,
        includeSettings: settings,
        files: { [settings]: new TextEncoder().encode(format === 'svg' ? glyphCache : midiOnly) },
      });
      performance.measure('pianora:lilypond-' + format, { start });
      return readScoreFiles(files);
    } catch (error) {
      if (/unreachable|RuntimeError|abort/i.test(String(error))) {
        compiler.dispose();
        this.ready = undefined;
      }
      throw error;
    }
  }

  private sheetLoader(source: string) {
    let pending: Promise<string[]> | undefined;
    return () =>
      (pending ??= this.run(source, 'svg').then(result => result.svgPages).catch(error => {
        pending = undefined;
        throw error;
      }));
  }

  async compile(source: string, onProgress?: Progress) {
    const start = performance.now();
    const result = (data: ScoreData, method: DisplayText) => {
      const duration = performance.now() - start;
      performance.measure('pianora:score-ready', { start, detail: { method: display(method) } });
      return {
        ...data,
        compileSec: Number((duration / 1000).toFixed(2)),
        method,
      };
    };
    if (this.last?.source === source)
      return result(this.last.data, message("复用上次结果"));

    onProgress?.(message("正在准备浏览器 LilyPond 编译器…"), 5);
    this.progress = onProgress;
    try {
      await this.prepare();
      onProgress?.(message("正在提取演奏 MIDI 和琶音标记…"), 22);
      const { midi, rawAnnotations } = await this.run(source, 'midi');
      const data = {
        scoreMidi: new Midi(midi),
        loadPages: this.sheetLoader(source),
        rawAnnotations,
      };
      this.last = { source, data };
      return result(data, message("浏览器编译"));
    } finally {
      this.progress = undefined;
    }
  }
}
