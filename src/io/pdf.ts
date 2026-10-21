// PDF-Grundriss als Vorlage: Seite rastern, Plan-Maßstab („M 1:100“) aus dem Text erkennen.
// pdf.js läuft im Hauptthread (kein Worker-Skript nötig, funktioniert auch in der Einzeldatei).
// Legacy-Build: enthält Polyfills (z. B. Map.getOrInsertComputed) für Safari/WebKit und ältere Chromium.
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';

/** 1 pt = 1/72 Zoll */
export const PT_TO_M = 0.0254 / 72;

let lib: Promise<typeof import('pdfjs-dist/legacy/build/pdf.mjs')> | null = null;

function pdfjs(): Promise<typeof import('pdfjs-dist/legacy/build/pdf.mjs')> {
  lib ??= (async () => {
    const worker = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs');
    (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = worker;
    return import('pdfjs-dist/legacy/build/pdf.mjs');
  })();
  return lib;
}

export async function openPdf(data: ArrayBuffer): Promise<PDFDocumentProxy> {
  const { getDocument } = await pdfjs();
  return getDocument({ data: new Uint8Array(data) }).promise;
}

export interface PdfRaster {
  dataUrl: string;
  widthPx: number;
  heightPx: number;
  /** Papiergröße der Seite in m */
  paperW: number;
  paperH: number;
}

/** Seite rastern; maxPx begrenzt die längere Kante */
export async function renderPdfPage(doc: PDFDocumentProxy, pageNo: number, maxPx: number, type: 'image/png' | 'image/jpeg' = 'image/png'): Promise<PdfRaster> {
  const page = await doc.getPage(pageNo);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(maxPx / Math.max(base.width, base.height), 8);
  const vp = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(vp.width);
  canvas.height = Math.round(vp.height);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
  const dataUrl = canvas.toDataURL(type, 0.9);
  page.cleanup();
  return { dataUrl, widthPx: canvas.width, heightPx: canvas.height, paperW: base.width * PT_TO_M, paperH: base.height * PT_TO_M };
}

/** Plan-Maßstab aus dem Seitentext, z. B. „M 1:100“, „Maßstab 1 : 50“ */
export function detectScale(text: string): number | null {
  const hits = [...text.matchAll(/(?:^|[^\d.,])1\s*:\s*(\d{2,4})(?![\d.,])/g)].map((m) => Number(m[1]));
  const plausible = hits.filter((n) => [20, 25, 50, 75, 100, 125, 200, 250, 500].includes(n));
  if (!plausible.length) return null;
  const count = new Map<number, number>();
  for (const n of plausible) count.set(n, (count.get(n) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
}

export async function pageText(doc: PDFDocumentProxy, pageNo: number): Promise<string> {
  const page = await doc.getPage(pageNo);
  const tc = await page.getTextContent();
  return tc.items.map((i) => ('str' in i ? i.str : '')).join(' ');
}
