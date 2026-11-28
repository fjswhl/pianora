// Run only in GitHub Actions with the repository's existing Cloudflare deployment credentials.
import { appendFile } from 'node:fs/promises';
const { CLOUDFLARE_ACCOUNT_ID: account, CLOUDFLARE_API_TOKEN: token } = process.env;
if (!account || !token) throw new Error('Cloudflare deployment credentials are missing');
const report = [];
async function cf(path, method='GET', body) {
  const response = await fetch('https://api.cloudflare.com/client/v4'+path, {
    method, redirect:'error', headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!data.success) throw new Error('HTTP '+response.status+' / Cloudflare '+data.errors?.map(e=>e.code).join(','));
  return data.result;
}
const api = '/accounts/'+account;
const prepare = process.argv.includes('--prepare');
async function check(name, run) {
  try { report.push(name+' · '+await run()); }
  catch(e) { report.push(name+' · '+e.message); process.exitCode=1; }
}
await check('D1', async()=>{
  const name='pianora-accounts';
  let db=(await cf(api+'/d1/database?name='+name)).find(x=>x.name===name);
  if (!db && prepare) db=await cf(api+'/d1/database','POST',{name});
  return db ? name+' database_id '+db.uuid : 'not provisioned';
});
await check('Private R2',async()=>{
  const name='pianora-private-scores';
  try { await cf(api+'/r2/buckets/'+name); }
  catch(e) {
    if (!/HTTP 404|10006/.test(e.message)) throw e;
    if (!prepare) return 'not provisioned';
    await cf(api+'/r2/buckets','POST',{name});
  }
  // An existing bucket must also be private before we accept personal uploads.
  const publicUrl=await cf(api+'/r2/buckets/'+name+'/domains/managed');
  const domains=await cf(api+'/r2/buckets/'+name+'/domains/custom');
  if(publicUrl.enabled || domains.domains?.length) throw new Error('Disable public access on the private scores bucket before activation');
  return 'private bucket ready';
});
for(const line of report) console.log(line);
if(process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,report.map(s=>'- '+s).join('\n')+'\n');
