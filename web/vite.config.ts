import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Dev: Vite serves the UI on 5173 and forwards /api to the local API (npm run api).
// Build: the API serves web/dist itself on 4380.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: { '/api': { target: 'http://127.0.0.1:4380', changeOrigin: true } },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
