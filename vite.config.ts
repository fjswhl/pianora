import { defineConfig } from 'vite';

export default defineConfig({
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
    host: '127.0.0.1',
    port: 5173,
  },
});
