// Generate deployment bindings without shipping Clerk management credentials.
import { readFile, writeFile } from 'node:fs/promises';
import ts from 'typescript';

const local = process.argv.includes('--local');
const { config, error } = ts.parseConfigFileTextToJson('wrangler.jsonc', await readFile('wrangler.jsonc', 'utf8'));
if (error) throw new Error('Invalid wrangler.jsonc');
if (local) delete config.routes;
const databaseId = local ? '00000000-0000-4000-8000-000000000001' : process.env.PIANORA_D1_ID;
const key = process.env.CLERK_PUBLISHABLE_KEY;
if (key && !databaseId) throw new Error('Clerk requires the private library D1 binding');
if (databaseId) {
  if (!/^[0-9a-f-]{36}$/i.test(databaseId)) throw new Error('Invalid PIANORA_D1_ID');
  config.d1_databases.push({binding:'DB', database_name:'pianora-accounts', database_id:databaseId});
  config.r2_buckets.push({binding:'PRIVATE_SCORES',bucket_name:'pianora-private-scores'});
  config.vars = { APP_ORIGIN: local ? 'http://127.0.0.1:8791' : 'https://opuslin.uk' };
  if (key) {
    const match = /^pk_(test|live)_([A-Za-z0-9+/=_-]+)$/.exec(key);
    if (!match || (!local && match[1] !== 'live') ||
        !/^(?:[a-z0-9-]+\.)+[a-z0-9-]+\$$/i.test(Buffer.from(match[2], 'base64').toString())) {
      throw new Error('Invalid Clerk publishable key for this environment');
    }
    config.vars.CLERK_PUBLISHABLE_KEY = key;
  }
}
await writeFile(process.env.PIANORA_TEST_CONFIG && local ? process.env.PIANORA_TEST_CONFIG : 'wrangler.accounts.generated.json', JSON.stringify(config, null, 2));
