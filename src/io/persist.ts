// Speicherung: Autosave im Browser (IndexedDB), Projektdatei als JSON, Downloads.

import type { ImageStore, Project } from '../model/types';

const DB_NAME = 'heatcircuts';
const STORE = 'projects';
const KEY = 'current';

export interface ProjectFile {
  format: 'heatcircuits';
  version: 1;
  savedAt: string;
  project: Project;
  images: ImageStore;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function autosave(project: Project, images: ImageStore): Promise<boolean> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(toFile(project, images), KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return true;
  } catch {
    return false;
  }
}

export async function loadAutosave(): Promise<ProjectFile | null> {
  try {
    const db = await openDb();
    const file = await new Promise<ProjectFile | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve((req.result as ProjectFile) ?? null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return file && validateFile(file) ? file : null;
  } catch {
    return null;
  }
}

export function toFile(project: Project, images: ImageStore): ProjectFile {
  const used = new Set(project.floors.map((f) => f.background?.imageId).filter(Boolean) as string[]);
  const imgs: ImageStore = {};
  for (const id of used) if (images[id]) imgs[id] = images[id];
  return { format: 'heatcircuits', version: 1, savedAt: new Date().toISOString(), project, images: imgs };
}

export function validateFile(x: unknown): x is ProjectFile {
  if (!x || typeof x !== 'object') return false;
  const f = x as ProjectFile;
  return f.format === 'heatcircuits' && !!f.project && Array.isArray(f.project.floors) && f.project.floors.length > 0;
}

export function parseProjectFile(text: string): ProjectFile {
  const data = JSON.parse(text);
  if (!validateFile(data)) throw new Error('Die Datei ist keine HeatCircuits-Projektdatei.');
  return data;
}

interface DownloadsApi {
  save(req: { filename: string; data: string | Blob }): Promise<unknown>;
}

let downloadsApi: Promise<DownloadsApi | null> | null = null;

function getDownloads(): Promise<DownloadsApi | null> {
  if (!downloadsApi) {
    const w = window as unknown as { claude?: { use?: (n: string) => Promise<unknown> } };
    downloadsApi = w.claude?.use ? (w.claude.use('downloads') as Promise<DownloadsApi | null>).catch(() => null) : Promise.resolve(null);
  }
  return downloadsApi;
}

/** Datei anbieten: in der claude.ai-Ansicht über die Download-Freigabe, lokal über einen Blob-Link. */
export async function offerDownload(filename: string, data: string | Blob, mime: string): Promise<'saved' | 'declined' | 'failed'> {
  const api = await getDownloads();
  if (api) {
    try {
      await api.save({ filename, data });
      return 'saved';
    } catch (e) {
      const code = (e as { code?: string })?.code;
      return code === 'declined' ? 'declined' : 'failed';
    }
  }
  try {
    const blob = typeof data === 'string' ? new Blob([data], { type: mime }) : data;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return 'saved';
  } catch {
    return 'failed';
  }
}

export function safeFilename(name: string): string {
  return (name || 'Projekt').replace(/[^\p{L}\p{N} _.-]+/gu, '').trim().replace(/\s+/g, '_').slice(0, 80) || 'Projekt';
}
