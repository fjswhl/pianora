/**
 * Browser LilyPond WebAssembly compiler wrapper with Scheme arpeggio extraction,
 * Mutopia/2.18 compatibility sanitization, and automatic WASM worker crash recovery.
 */
import type { createReusableCompiler } from '@sightread/lilypond-wasm';
import { Midi } from '@tonejs/midi';
import { injectSchemeHook, type RawArpeggioAnnotation } from './arpeggio';

export interface LilyPondCompileOutput {
  scoreMidi: Midi;
  svgPages: string[];
  rawAnnotations: RawArpeggioAnnotation[];
  compileSec: number;
}

export class BrowserLilyPondEngine {
  private compiler?: ReturnType<typeof createReusableCompiler>;
  public preloaded = false;

  async compile(
    lyCode: string,
    onProgress?: (msg: string, pct?: number) => void,
  ): Promise<LilyPondCompileOutput> {
    const t0 = performance.now();
    try {
      this.compiler ??= (await import('@sightread/lilypond-wasm')).createReusableCompiler();
      if (!this.preloaded) {
        onProgress?.('首次加载 LilyPond WebAssembly 引擎 (~31 MB)...', 5);
        await this.compiler.preload({
          onProgress: ({ loadedBytes, totalBytes }: { loadedBytes: number; totalBytes: number }) => {
            if (totalBytes > 0) {
              const mb = (loadedBytes / 1e6).toFixed(1);
              const tot = (totalBytes / 1e6).toFixed(1);
              onProgress?.(
                `下载 LilyPond WASM 引擎: ${mb} / ${tot} MB...`,
                5 + (loadedBytes / totalBytes) * 15,
              );
            }
          },
        });
        this.preloaded = true;
      }

      onProgress?.('正在浏览器 WASM 中编译 LilyPond (.ly → SVG + MIDI)...', 22);
      const patchedLy = injectSchemeHook(lyCode);
      const wasmRes = await this.compiler.compile(patchedLy, { format: 'svg' });

      const files = wasmRes.files || {};
      const midiKey = Object.keys(files).find((k) => k.endsWith('.midi') || k.endsWith('.mid'));
      if (!midiKey) {
        throw new Error('LilyPond WASM 未输出 MIDI，请确认源码中包含 \\midi {} 块。');
      }

      const scoreMidi = new Midi(files[midiKey] as Uint8Array);

      const svgKeys = Object.keys(files)
        .filter((k) => k.endsWith('.svg'))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      const svgPages = svgKeys.map((k) => {
        const data = files[k];
        return data instanceof Uint8Array ? new TextDecoder().decode(data) : String(data);
      });

      let rawAnnotations: RawArpeggioAnnotation[] = [];
      if (files['annotations.json']) {
        const txt =
          files['annotations.json'] instanceof Uint8Array
            ? new TextDecoder().decode(files['annotations.json'])
            : String(files['annotations.json']);
        rawAnnotations = JSON.parse(txt);
      }

      return {
        scoreMidi,
        svgPages,
        rawAnnotations,
        compileSec: Number(((performance.now() - t0) / 1000).toFixed(2)),
      };
    } catch (err) {
      const msg = (err as Error).message || String(err);
      if (/unreachable|RuntimeError|abort/i.test(msg)) {
        try {
          await (this.compiler as unknown as { dispose?: () => Promise<void> }).dispose?.();
        } catch {}
        this.compiler = undefined;
        this.preloaded = false;
      }
      throw err;
    }
  }
}
