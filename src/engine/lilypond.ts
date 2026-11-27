import type { createReusableCompiler } from '@sightread/lilypond-wasm';
import { Midi } from '@tonejs/midi';
import compiledScores from 'virtual:pianora-compiled-scores';
import { injectSchemeHook, type RawArpeggioAnnotation } from './arpeggio';
import { readScoreFiles } from './scoreFiles';

interface ScoreData {
  scoreMidi: Midi;
  loadPages: () => Promise<string[]>;
  rawAnnotations: RawArpeggioAnnotation[];
}

type Progress = (msg: string, pct?: number) => void;
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
              `加载 LilyPond：${Math.round((100 * loadedBytes) / totalBytes)}%`,
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

  private async presetUrl(source: string) {
    if (!globalThis.crypto?.subtle || !Object.keys(compiledScores).length)
      return;
    const hash = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(source),
    );
    const key = Array.from(new Uint8Array(hash), (b) =>
      b.toString(16).padStart(2, '0'),
    ).join('');
    return compiledScores[key];
  }

  async warmForSource(source: string) {
    if (this.last?.source !== source && !(await this.presetUrl(source)))
      await this.prepare();
  }

  private async run(source: string, format: 'midi' | 'svg') {
    const compiler = await this.prepare();
    try {
      const start = performance.now();
      const { files } = await compiler.compile(injectSchemeHook(source), {
        format,
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

  private sheetLoader(source: string, url?: string) {
    const load = async (): Promise<string[]> => {
      if (url) {
        try {
          const response = await fetch(url);
          if (response.ok) {
            const pages = await response.json();
            if (
              Array.isArray(pages) &&
              pages.every((p) => typeof p === 'string')
            )
              return pages;
          }
        } catch {
          /* Fall back to the score snapshot that produced this performance. */
        }
      }
      return (await this.run(source, 'svg')).svgPages;
    };
    let pending: Promise<string[]> | undefined;
    return () =>
      (pending ??= load().catch((error) => {
        pending = undefined;
        throw error;
      }));
  }

  private async loadPreset(source: string): Promise<ScoreData | undefined> {
    const urls = await this.presetUrl(source);
    if (!urls) return;
    try {
      const response = await fetch(urls[0]);
      if (!response.ok) return;
      const { midi, rawAnnotations } = await response.json();
      if (typeof midi !== 'string' || !Array.isArray(rawAnnotations)) return;
      return {
        scoreMidi: new Midi(
          Uint8Array.from(atob(midi), (c) => c.charCodeAt(0)),
        ),
        loadPages: this.sheetLoader(source, urls[1]),
        rawAnnotations,
      };
    } catch {
      return;
    }
  }

  async compile(source: string, onProgress?: Progress) {
    const start = performance.now();
    const result = (data: ScoreData, method: string) => {
      const duration = performance.now() - start;
      performance.measure('pianora:score-ready', { start, detail: { method } });
      return {
        ...data,
        compileSec: Number((duration / 1000).toFixed(2)),
        method,
      };
    };
    if (this.last?.source === source)
      return result(this.last.data, '复用上次结果');

    const preset = await this.loadPreset(source);
    if (preset) {
      this.last = { source, data: preset };
      return result(preset, '读取预编译谱');
    }

    onProgress?.('正在准备浏览器 LilyPond 编译器…', 5);
    this.progress = onProgress;
    try {
      await this.prepare();
      onProgress?.('正在提取演奏 MIDI 和琶音标记…', 22);
      const { midi, rawAnnotations } = await this.run(source, 'midi');
      const data = {
        scoreMidi: new Midi(midi),
        loadPages: this.sheetLoader(source),
        rawAnnotations,
      };
      this.last = { source, data };
      return result(data, '浏览器编译');
    } finally {
      this.progress = undefined;
    }
  }
}
