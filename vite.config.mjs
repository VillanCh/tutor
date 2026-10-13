import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  root: 'src/ui',
  envDir: '../..',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src/ui', import.meta.url)) } },
  build: { outDir: '../../dist/ui', emptyOutDir: true, sourcemap: false },
});
