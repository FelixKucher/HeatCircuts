// pdf.js-Worker als Modul im Hauptthread (Fake-Worker), ohne eigene Typen
declare module 'pdfjs-dist/legacy/build/pdf.worker.min.mjs' {
  export const WorkerMessageHandler: unknown;
}
