// Generate Wrangler's environment-specific binding configuration next to wrangler.jsonc.
import { readFile, writeFile } from 'node:fs/promises';
import ts from 'typescript';

const local = process.argv.includes('--local');
const { config, error } = ts.parseConfigFileTextToJson('wrangler.jsonc', await readFile('wrangler.jsonc', 'utf8'));
if (error) throw new Error('Invalid wrangler.jsonc');
if (local) delete config.routes;
const databaseId = local ? '00000000-0000-4000-8000-000000000001' : process.env.PIANORA_D1_ID;
if (databaseId) {
  if (!/^[0-9a-f-]{36}$/i.test(databaseId)) throw new Error('Invalid PIANORA_D1_ID');
  config.d1_databases = [{binding:'DB', database_name:'pianora-accounts', database_id:databaseId}];
  config.r2_buckets.push({binding:'PRIVATE_SCORES',bucket_name:'pianora-private-scores'});
  config.vars = { BETTER_AUTH_URL: local ? 'http://127.0.0.1:8791' : 'https://opuslin.uk' };
  const from = local ? 'login@pianora.test' : process.env.PIANORA_AUTH_FROM;
  if (from) {
    config.send_email = [{name:'EMAIL', allowed_sender_addresses:[from]}];
    config.vars.AUTH_FROM = from;
  }
}
await writeFile('wrangler.accounts.generated.json', JSON.stringify(config, null, 2));
