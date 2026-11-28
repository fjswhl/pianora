import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  optimizeDeps: {
    exclude: ['@sightread/lilypond-wasm', 'onnxruntime-web'],
  },
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
  },
  server: {
    proxy: Object.fromEntries(['/api/catalog/', '/presets/'].map(path => [path, {
      target: process.env.PIANORA_CATALOG_ORIGIN || 'https://opuslin.uk', changeOrigin: true,
    }])),
    host: '127.0.0.1',
    port: 5173,
  },
});
