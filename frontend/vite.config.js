import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const pages = [
  'index', '403', 'login', 'tablet', 'auth/set-password',
  'nurse', 'nurse/schedule',
  'admin', 'admin/setup', 'admin/layout', 'admin/tablets', 'admin/nurses', 'admin/settings', 'admin/stats',
];

export default defineConfig({
  server: {
    port: 5173,
    host: true,
    proxy: { '/api': { target: process.env.DEV_API_TARGET || 'http://localhost:8080', changeOrigin: false } },
  },
  esbuild: { target: 'es2022' },
  optimizeDeps: { esbuildOptions: { target: 'es2022' } },
  build: {
    target: 'es2022',
    rollupOptions: {
      input: Object.fromEntries(pages.map((p) => [p, resolve(__dirname, `${p}.html`)])),
    },
  },
});
