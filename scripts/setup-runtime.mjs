/**
 * Copies browser WASM/AudioWorklet runtime files from node_modules into public/.
 * Run automatically after `npm install` via `npm run setup:runtime`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function copyIfExists(src, dst) {
  if (!fs.existsSync(src)) {
    console.warn(`[setup] Missing: ${src}`);
    return;
  }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  console.log(`[setup] Copied -> ${path.relative(root, dst)}`);
}

// 1. SpessaSynth AudioWorklet processor
copyIfExists(
  path.join(root, 'node_modules/spessasynth_lib/dist/spessasynth_processor.min.js'),
  path.join(root, 'public/spessa/spessasynth_processor.min.js'),
);

// 2. ONNX Runtime Web WASM/MJS binaries
const ortDir = path.join(root, 'node_modules/onnxruntime-web/dist');
if (fs.existsSync(ortDir)) {
  for (const name of fs.readdirSync(ortDir)) {
    if (name.startsWith('ort-wasm-simd-threaded') && (name.endsWith('.wasm') || name.endsWith('.mjs'))) {
      copyIfExists(path.join(ortDir, name), path.join(root, 'public/ort', name));
    }
  }
}

console.log('[setup] Browser runtime assets ready.');
