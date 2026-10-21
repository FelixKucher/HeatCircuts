import { defineConfig } from 'vitest/config';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `--mode single` erzeugt eine einzelne, eigenständige HTML-Datei (dist-single/index.html),
// die ohne Server per Doppelklick läuft und als Vorschau veröffentlicht werden kann.
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: mode === 'single' ? [viteSingleFile()] : [],
  build: {
    outDir: mode === 'single' ? 'dist-single' : 'dist',
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
}));
