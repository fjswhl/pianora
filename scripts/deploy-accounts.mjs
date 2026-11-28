// A limited deployment token can publish a schema already applied by the database owner.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';

await import('./account-config.mjs');
const config = ['-c', 'wrangler.accounts.generated.json'];
const wrangler = (...args) => execFileSync('node_modules/.bin/wrangler', args, { stdio: 'inherit' });
const record = process.argv.includes('--apply-schema');
if (record && !process.env.PIANORA_D1_ID) throw new Error('Set PIANORA_D1_ID to apply the schema');
if (process.env.PIANORA_D1_ID) {
  const hash = createHash('sha256');
  for (const name of readdirSync('migrations').filter(f => f.endsWith('.sql')).sort()) {
    hash.update(name).update('\0').update(readFileSync('migrations/' + name)).update('\0');
  }
  const schema = process.env.PIANORA_D1_ID + ':' + hash.digest('hex');
  if (record || process.env.PIANORA_APPLIED_SCHEMA !== schema) {
    wrangler('d1', 'migrations', 'apply', 'DB', '--remote', ...config);
  }
  if (record) {
    console.log('Applied schema: ' + schema);
    process.exit(0);
  }
}
wrangler('deploy', ...config);
