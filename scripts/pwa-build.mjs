import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

// Emit the worker after Vite has produced the real HTML, route chunks and worker binaries.
// Stable public filenames get content-addressed cache keys as well.
export function pianoraPwa() {
  return {
    name: 'pianora-pwa',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const html = bundle['index.html'].source;
      const assets = Object.keys(bundle).filter(name => name.startsWith('assets/')).map(name => '/' + name);
      const runtime = {};
      for (const dir of ['audio', 'irs', 'spessa', 'ort', 'icons']) {
        const root = resolve('public', dir);
        let files;
        try { files = readdirSync(root); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
        for (const file of files.filter(f => /\.(js|mjs|wav|png|svg)$/.test(f))) {
          runtime['/'+dir+'/'+file] = digest(readFileSync(resolve(root,file)));
        }
      }
      runtime['/manifest.webmanifest'] = digest(readFileSync('public/manifest.webmanifest'));
      const core = new Set(['/manifest.webmanifest', ...Object.keys(runtime).filter(k => k.startsWith('/icons/'))]);
      function include(chunk) {
        if (!chunk || chunk.type !== 'chunk' || core.has('/'+chunk.fileName)) return;
        core.add('/'+chunk.fileName);
        for (const css of chunk.viteMetadata?.importedCss ?? []) core.add('/'+css);
        for (const dep of chunk.imports) include(bundle[dep]);
      }
      for (const entry of Object.values(bundle)) {
        if (entry.type === 'chunk' && (entry.isEntry || /\/components\/(Workspace|StudioPanel)\.tsx$/.test(entry.facadeModuleId ?? ''))) include(entry);
      }
      const config = { html, assets, runtime, core:[...core] };
      const worker = readFileSync(new URL('./pwa-worker.js', import.meta.url), 'utf8');
      this.emitFile({type:'asset',fileName:'sw.js',source:'const BUILD = '+JSON.stringify(config)+';\n'+worker});
    },
  };
}
function digest(bytes) { return createHash('sha256').update(bytes).digest('hex').slice(0,24); }
