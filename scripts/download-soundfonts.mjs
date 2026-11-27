/**
 * Downloads curated studio-grade concert grand SoundFont2 (.sf2) files from
 * Hugging Face (projectlosangeles/soundfonts4u) into public/soundfonts/.
 *
 * Usage:
 *   npm run setup:soundfonts            # downloads all 4 studio grand pianos
 *   node scripts/download-soundfonts.mjs abbey fazioli
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'public/soundfonts');
fs.mkdirSync(outDir, { recursive: true });

const CATALOG = {
  abbey: {
    file: 'abbey_steinway_d.sf2',
    url: 'https://huggingface.co/datasets/projectlosangeles/soundfonts4u/resolve/main/Abbey-Steinway-D-v1.9.sf2',
  },
  nice: {
    file: 'nice_steinway_v38.sf2',
    url: 'https://huggingface.co/datasets/projectlosangeles/soundfonts4u/resolve/main/Nice-Steinway-v3.8.sf2',
  },
  fazioli: {
    file: 'fazioli_f308.sf2',
    url: 'https://huggingface.co/datasets/projectlosangeles/soundfonts4u/resolve/main/Dore%20Mark%27s%20Fazioli%20F308-v2.6.sf2',
  },
  salamander: {
    file: 'salamander_c5_full.sf2',
    url: 'https://huggingface.co/datasets/projectlosangeles/soundfonts4u/resolve/main/Yamaha-C5-Salamander-JNv5.1.sf2',
  },
};

const requested = process.argv.slice(2);
const keys = requested.length ? requested.filter((k) => k in CATALOG) : Object.keys(CATALOG);

for (const key of keys) {
  const { file, url } = CATALOG[key];
  const dst = path.join(outDir, file);
  if (fs.existsSync(dst) && fs.statSync(dst).size > 1_000_000) {
    console.log(`[skip] ${file} already exists.`);
    continue;
  }
  console.log(`[download] ${file} <- ${url}`);
  const resp = await fetch(url, { headers: { 'User-Agent': 'Pianora-Setup/0.1' } });
  if (!resp.ok || !resp.body) {
    console.error(`[error] Failed ${file}: HTTP ${resp.status}`);
    continue;
  }
  const total = Number(resp.headers.get('content-length') || 0);
  const ws = fs.createWriteStream(dst);
  let loaded = 0;
  for await (const chunk of resp.body) {
    ws.write(chunk);
    loaded += chunk.byteLength;
    if (total > 0) {
      process.stdout.write(`\r  ${(loaded / 1e6).toFixed(1)} / ${(total / 1e6).toFixed(1)} MB (${Math.round((loaded / total) * 100)}%)`);
    }
  }
  ws.end();
  console.log(`\n[done] Saved ${path.relative(root, dst)}`);
}
