import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createReusableCompiler } from '@sightread/lilypond-wasm';
import type { Plugin } from 'vite';
import { scorePresets } from '../src/engine/presets';
import { injectSchemeHook } from '../src/engine/arpeggio';
import { readScoreFiles } from '../src/engine/scoreFiles';

const moduleId = 'virtual:pianora-compiled-scores';

export function compiledScores(): Plugin {
  let production = false;
  return {
    name: 'pianora-compiled-scores',
    configResolved(config) {
      production = config.command === 'build';
    },
    resolveId(id) {
      if (id === moduleId) return '\0' + id;
    },
    async load(id) {
      if (id !== '\0' + moduleId) return;
      if (!production) return 'export default {}';
      const compiler = createReusableCompiler();
      const entries: string[] = [];
      try {
        for (const preset of scorePresets) {
          const file = resolve('public', '.' + preset.url);
          this.addWatchFile(file);
          const source = (await readFile(file, 'utf8')).trim();
          const digest = createHash('sha256').update(source).digest('hex');
          const start = performance.now();
          const { files } = await compiler.compile(injectSchemeHook(source), {
            format: 'svg',
          });
          const { midi, svgPages, rawAnnotations } = readScoreFiles(files);
          const ref = this.emitFile({
            type: 'asset',
            name: preset.id + '.score.json',
            source: JSON.stringify({
              midi: Buffer.from(midi).toString('base64'),
              rawAnnotations,
            }),
          });
          const pages = this.emitFile({
            type: 'asset',
            name: preset.id + '.pages.json',
            source: JSON.stringify(svgPages),
          });
          entries.push(
            `"${digest}": [import.meta.ROLLUP_FILE_URL_${ref}, import.meta.ROLLUP_FILE_URL_${pages}]`,
          );
          console.info(
            `[scores] ${preset.id} · ${svgPages.length} pages · ${Math.round(performance.now() - start)} ms`,
          );
        }
      } finally {
        compiler.dispose();
      }
      return 'export default {' + entries.join(',') + '}';
    },
  };
}
