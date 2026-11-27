// Deploy the existing Worker and attach the private library only after provisioning.
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function wrangler(...args) {
  const env = { ...process.env };
  delete env.BETTER_AUTH_SECRET;
  delete env.GOOGLE_CLIENT_SECRET;
  const result = spawnSync('node_modules/.bin/wrangler', args, { stdio: 'inherit', env });
  if (result.status !== 0) throw new Error('Wrangler failed');
}

await import('./account-config.mjs');
const config = ['-c', 'wrangler.accounts.generated.json'];
const temp = await mkdtemp(join(tmpdir(), 'pianora-deploy-'));
try {
  const args = ['deploy', ...config];
  if (process.env.PIANORA_D1_ID) {
    if (!process.env.BETTER_AUTH_SECRET || process.env.BETTER_AUTH_SECRET.length < 32)
      throw new Error('Configure a stable BETTER_AUTH_SECRET before enabling accounts.');
    const keys = { BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET };
    if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
      keys.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
      keys.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
    }
    const file = join(temp, 'secrets.json');
    await writeFile(file, JSON.stringify(keys), { mode: 0o600 });
    wrangler('d1', 'migrations', 'apply', 'DB', '--remote', ...config);
    args.push('--secrets-file', file);
  }
  wrangler(...args);
} finally { await rm(temp, { recursive: true, force:true }); }
