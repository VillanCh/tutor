import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';
import { readFileSync } from 'node:fs';

export default defineConfig({
  root: 'src/ui',
  envDir: '../..',
  define: {
    __TUTOR_VERSION__: JSON.stringify(
      JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version,
    ),
  },
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src/ui', import.meta.url)) } },
  build: { outDir: '../../dist/ui', emptyOutDir: true, sourcemap: false },
});
