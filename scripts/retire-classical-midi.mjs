// Retire only the superseded MIDI objects from the initial classical import.
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { storageKey } from '../catalog/objects.mjs';

const revision = 'f323baf8a1af48f64e690afdd214624d79537c64';
const editions = ['keyboard-editions', 'mutopia-keyboard'].flatMap((group) => {
  const manifest = execFileSync('git', ['show', revision + ':catalog/collections/' + group + '.json']);
  return JSON.parse(manifest).scores;
});
const objects = new Set(editions.map((s) => s.sha256 + '.mid'));
if (editions.length !== 887 || objects.size !== 887 || editions.some((s) =>
  !/^[a-f0-9]{64}$/.test(s.sha256) || !/^[a-zA-Z0-9/_-]+\.mid$/.test(s.file) || !/^[a-z0-9_]+$/.test(s.id)))
  throw Error('Unexpected historical import');

if (process.argv[2] === '--sql-out') {
  const values = editions.map((s) => "('" + s.id + "','" + s.file + "','" + s.sha256 + ".mid')").join(',\n');
  // Hash + path + id must all match. A score upgraded in place keeps its catalog number.
  await writeFile(process.argv[3], `CREATE TABLE retiring_classical_midi(id TEXT PRIMARY KEY, path TEXT UNIQUE, name TEXT UNIQUE);
INSERT INTO retiring_classical_midi VALUES ${values};
DELETE FROM catalog_scores WHERE (id,file) IN (
  SELECT r.id,r.path FROM retiring_classical_midi r JOIN catalog_files f ON f.path=r.path AND f.object_name=r.name
);
DELETE FROM catalog_files WHERE (path,object_name) IN (SELECT path,name FROM retiring_classical_midi)
  AND path NOT IN (SELECT file FROM catalog_scores);
CREATE TABLE retirement_check(no_references INTEGER NOT NULL CHECK(no_references = 0));
INSERT INTO retirement_check SELECT COUNT(*) FROM catalog_files WHERE object_name IN (SELECT name FROM retiring_classical_midi);
DROP TABLE retirement_check;
DROP TABLE retiring_classical_midi;
`);
} else if (process.argv[2] === '--remove-r2') {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!/^[a-f0-9]{32}$/.test(account ?? '') || !token) throw Error('Missing R2 credentials');
  let after = null;
  do {
    const url = new URL('https://opuslin.uk/api/catalog/scores');
    url.searchParams.set('limit', '63');
    if (after !== null) url.searchParams.set('after', after);
    const response = await fetch(url, { redirect: 'error' });
    if (!response.ok) throw Error('Catalog verification HTTP ' + response.status);
    const data = await response.json();
    if (data.items.some((s) => objects.has(s.url.split('/').pop())))
      throw Error('A MIDI that would be removed is still present in the live catalog');
    after = data.next;
  } while (after !== null);

  async function request(key, method) {
    const url = 'https://api.cloudflare.com/client/v4/accounts/' + account + '/r2/buckets/pianora-assets/objects/' + storageKey(key);
    for (let attempt = 0; attempt < 9; attempt++) {
      const response = await fetch(url, { method, redirect: 'error', headers: {Authorization: 'Bearer ' + token} });
      await response.body?.cancel();
      if (response.status === 404 || response.ok) return response.status;
      if (response.status !== 429 && response.status < 500) throw Error(method + ' HTTP ' + response.status);
      const seconds = Math.max(Number(response.headers.get('retry-after')) || 0, Math.min(60, 2 ** attempt));
      await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
    }
    throw Error('R2 retry limit reached for ' + key);
  }
  const pending = objects.values();
  await Promise.all(Array.from({ length: 4 }, async () => {
    for (const key of pending) {
      await request(key, 'DELETE');
      if (await request(key, 'GET') !== 404) throw Error('Object still exists: ' + key);
    }
  }));
  console.log('Verified removal of ' + objects.size + ' historical MIDI objects.');
} else {
  throw Error('Specify --sql-out PATH or --remove-r2');
}
