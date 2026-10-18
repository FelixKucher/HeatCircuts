import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// HausCAD als eigene App neben HeatCircuits: `npm run cad:dev`, `cad:build`, `cad:build:single`
export default defineConfig(({ mode }) => ({
  // Aufruf aus dem Repository-Wurzelverzeichnis (npm-Skripte)
  root: 'cad',
  base: './',
  plugins: mode === 'single' ? [viteSingleFile()] : [],
  build: {
    outDir: mode === 'single' ? '../dist-cad-single' : '../dist-cad',
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
  server: { port: 5174 },
}));
