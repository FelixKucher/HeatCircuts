// Zustand mit Undo/Redo (JSON-Schnappschüsse), Mehrfachauswahl, Arbeitsphase und zwischengespeicherter Auslegung.

import type { Floor, ImageStore, Project } from './types';
import { computeDesign, type DesignResult } from '../calc/design';
import { normalizeProject } from './normalize';

export type SelKind = 'wall' | 'opening' | 'room' | 'furniture' | 'stair' | 'dimension' | 'label' | 'void' | 'manifold' | 'heatSource' | 'route';
export interface SelItem {
  kind: SelKind;
  id: string;
  /** Öffnung: Id der Wand */
  wallId?: string;
}

/** Arbeitsphasen: Grundriss → Bauteile → Heizflächen → Heizkreise → Ergebnisse */
export type Phase = 'build' | 'parts' | 'heating' | 'circuits' | 'results';
export const PHASES: { id: Phase; label: string; short: string }[] = [
  { id: 'build', label: 'Grundriss', short: '1' },
  { id: 'parts', label: 'Bauteile', short: '2' },
  { id: 'heating', label: 'Heizflächen', short: '3' },
  { id: 'circuits', label: 'Heizkreise', short: '4' },
  { id: 'results', label: 'Ergebnisse', short: '5' },
];

export type ChangeReason = 'project' | 'live' | 'selection' | 'view' | 'floor' | 'load' | 'phase';
type Listener = (reason: ChangeReason) => void;

const MAX_UNDO = 150;

export class Store {
  project: Project;
  images: ImageStore;
  activeFloorId: string;
  selection: SelItem[] = [];
  phase: Phase = 'build';
  dirty = false;
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private listeners = new Set<Listener>();
  private cachedDesign: DesignResult | null = null;
  private liveSnapshot: string | null = null;

  constructor(project: Project, images: ImageStore) {
    this.project = project;
    this.images = images;
    normalizeProject(project);
    this.activeFloorId = project.floors[0].id;
  }

  get floor(): Floor {
    return this.project.floors.find((f) => f.id === this.activeFloorId) ?? this.project.floors[0];
  }

  get design(): DesignResult {
    if (!this.cachedDesign) this.cachedDesign = computeDesign(this.project);
    return this.cachedDesign;
  }

  /** erstes gewähltes Objekt */
  get sel(): SelItem | null {
    return this.selection[0] ?? null;
  }

  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(reason: ChangeReason): void {
    if (reason === 'project' || reason === 'load' || reason === 'live') this.cachedDesign = null;
    this.listeners.forEach((fn) => fn(reason));
  }

  /** Änderung als ein Undo-Schritt; `mutate` arbeitet direkt auf Projekt und aktivem Geschoss. */
  commit(mutate: (p: Project, f: Floor) => void): void {
    const before = JSON.stringify(this.project);
    mutate(this.project, this.floor);
    normalizeProject(this.project);
    if (JSON.stringify(this.project) === before) {
      this.emit('selection');
      return;
    }
    this.undoStack.push(before);
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    this.redoStack = [];
    this.dirty = true;
    this.validateSelection();
    this.emit('project');
  }

  /** Beginn einer fortlaufenden Änderung (Ziehen); erst endLive() erzeugt den Undo-Schritt. */
  beginLive(): void {
    if (this.liveSnapshot === null) this.liveSnapshot = JSON.stringify(this.project);
  }

  live(mutate: (p: Project, f: Floor) => void): void {
    if (this.liveSnapshot === null) this.beginLive();
    mutate(this.project, this.floor);
    normalizeProject(this.project);
    this.emit('live');
  }

  endLive(): void {
    if (this.liveSnapshot === null) return;
    if (this.liveSnapshot !== JSON.stringify(this.project)) {
      this.undoStack.push(this.liveSnapshot);
      if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
      this.redoStack = [];
      this.dirty = true;
    }
    this.liveSnapshot = null;
    this.validateSelection();
    this.emit('project');
  }

  cancelLive(): void {
    if (this.liveSnapshot === null) return;
    this.project = JSON.parse(this.liveSnapshot);
    this.liveSnapshot = null;
    this.emit('project');
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(JSON.stringify(this.project));
    this.project = JSON.parse(prev);
    this.fixActiveFloor();
    this.validateSelection();
    this.emit('project');
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(JSON.stringify(this.project));
    this.project = JSON.parse(next);
    this.fixActiveFloor();
    this.validateSelection();
    this.emit('project');
  }

  load(project: Project, images: ImageStore): void {
    normalizeProject(project);
    this.project = project;
    this.images = images;
    this.undoStack = [];
    this.redoStack = [];
    this.selection = [];
    this.dirty = false;
    this.activeFloorId = project.floors.slice().sort((a, b) => a.elevation - b.elevation).find((f) => f.elevation >= -0.01)?.id ?? project.floors[0].id;
    this.emit('load');
  }

  setFloor(id: string): void {
    if (this.activeFloorId === id) return;
    this.activeFloorId = id;
    this.selection = [];
    this.emit('floor');
  }

  setPhase(p: Phase): void {
    if (this.phase === p) return;
    this.phase = p;
    this.emit('phase');
  }

  select(items: SelItem[] | SelItem | null): void {
    this.selection = items === null ? [] : Array.isArray(items) ? items : [items];
    this.emit('selection');
  }

  isSelected(kind: SelKind, id: string): boolean {
    return this.selection.some((s) => s.kind === kind && s.id === id);
  }

  private fixActiveFloor(): void {
    if (!this.project.floors.some((f) => f.id === this.activeFloorId)) this.activeFloorId = this.project.floors[0].id;
  }

  private validateSelection(): void {
    const f = this.floor;
    const p = this.project;
    this.selection = this.selection.filter((s) => {
      switch (s.kind) {
        case 'wall':
          return f.walls.some((w) => w.id === s.id);
        case 'opening':
          return f.walls.some((w) => w.id === s.wallId && w.openings.some((o) => o.id === s.id));
        case 'room':
          return f.rooms.some((r) => r.id === s.id);
        case 'furniture':
          return f.furniture.some((x) => x.id === s.id);
        case 'stair':
          return f.stairs.some((x) => x.id === s.id);
        case 'dimension':
          return f.dimensions.some((x) => x.id === s.id);
        case 'label':
          return f.labels.some((x) => x.id === s.id);
        case 'void':
          return f.voids.some((x) => x.id === s.id);
        case 'manifold':
          return f.manifolds.some((x) => x.id === s.id);
        case 'route':
          return f.routes.some((x) => x.id === s.id);
        case 'heatSource':
          return p.heatSource?.floorId === f.id;
      }
    });
  }

  /** Bilder, die von keinem Geschoss mehr referenziert werden, entfernen. */
  pruneImages(): void {
    const used = new Set(this.project.floors.map((f) => f.background?.imageId).filter(Boolean) as string[]);
    for (const k of Object.keys(this.images)) if (!used.has(k)) delete this.images[k];
  }
}
