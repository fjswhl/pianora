// Restore the immutable deployment assets without installing Python or exporting models in CI.
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, rename, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const graphs = JSON.parse(await readFile(join(root, 'src/engine/performance/graphs.json')));
const target = join(root, 'public/performance-packs');
const temp = await mkdtemp(join(tmpdir(), 'pianora-performance-'));
const release = 'performance-models-v1';
await mkdir(target, { recursive: true });
try {
  for (const model of ['pianist', 'dexter', 'virtuosonet']) {
    const files = Object.entries(graphs)
      .filter(([name]) => name.startsWith(model + '-'))
      .flatMap(([name, graph]) => graph.parts.map((hash) => ({ name: name + '-' + hash + '.pack', hash })));
    async function verify(dir) {
      for (const file of files) {
        const bytes = await readFile(join(dir, file.name));
        if (createHash('sha256').update(bytes).digest('hex') !== file.hash)
          throw new Error('Invalid model pack ' + file.name);
      }
    }
    try {
      await verify(target);
      continue;
    } catch {
      /* Restore this model. */
    }
    const archive = model + '.tar';
    execFileSync(
      'curl',
      ['--fail', '--location', '--silent', '--show-error', '--retry', '3', '--output', join(temp, archive),
        'https://github.com/fjswhl/pianora/releases/download/' + release + '/' + archive],
      { stdio: 'inherit' },
    );
    execFileSync('tar', ['-xf', join(temp, archive), '-C', temp, ...files.map((f) => f.name)]);
    await verify(temp);
    for (const file of files) {
      // Copy across filesystems when the temporary directory is on a different volume.
      const stage = join(target, file.name + '.' + process.pid);
      await copyFile(join(temp, file.name), stage);
      await rename(stage, join(target, file.name));
    }
  }
} finally {
  await rm(temp, { recursive: true, force: true });
}
