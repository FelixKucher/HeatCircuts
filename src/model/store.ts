import type { Floor, ImageStore, Project } from './types';
import { computeDesign, type DesignResult } from '../calc/design';

export type SelectionKind = 'wall' | 'room' | 'manifold' | 'heatSource' | 'route' | 'opening' | 'void';
export interface Selection {
  kind: SelectionKind;
  id: string;
}

type Listener = (reason: ChangeReason) => void;
export type ChangeReason = 'project' | 'selection' | 'view' | 'floor' | 'load';

const MAX_UNDO = 120;

export class Store {
  project: Project;
  images: ImageStore;
  activeFloorId: string;
  selection: Selection | null = null;
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private listeners = new Set<Listener>();
  private cachedDesign: DesignResult | null = null;

  constructor(project: Project, images: ImageStore) {
    this.project = project;
    this.images = images;
    this.activeFloorId = project.floors[0].id;
  }

  get floor(): Floor {
    return this.project.floors.find((f) => f.id === this.activeFloorId) ?? this.project.floors[0];
  }

  get design(): DesignResult {
    if (!this.cachedDesign) this.cachedDesign = computeDesign(this.project);
    return this.cachedDesign;
  }

  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(reason: ChangeReason): void {
    if (reason === 'project' || reason === 'load') this.cachedDesign = null;
    this.listeners.forEach((fn) => fn(reason));
  }

  /** Änderung mit Undo-Schritt. `mutate` arbeitet direkt auf dem Projekt. */
  commit(mutate: (p: Project) => void): void {
    this.undoStack.push(JSON.stringify(this.project));
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    this.redoStack = [];
    mutate(this.project);
    this.validateSelection();
    this.emit('project');
  }

  /** Startpunkt für eine fortlaufende Änderung (z. B. Ziehen); schließt mit endLive(). */
  private liveSnapshot: string | null = null;
  beginLive(): void {
    if (!this.liveSnapshot) this.liveSnapshot = JSON.stringify(this.project);
  }
  live(mutate: (p: Project) => void): void {
    mutate(this.project);
    this.emit('project');
  }
  endLive(): void {
    if (this.liveSnapshot && this.liveSnapshot !== JSON.stringify(this.project)) {
      this.undoStack.push(this.liveSnapshot);
      if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
      this.redoStack = [];
    }
    this.liveSnapshot = null;
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
    this.project = project;
    this.images = images;
    this.undoStack = [];
    this.redoStack = [];
    this.selection = null;
    this.activeFloorId = project.floors[0].id;
    this.emit('load');
  }

  setFloor(id: string): void {
    if (this.activeFloorId === id) return;
    this.activeFloorId = id;
    this.selection = null;
    this.emit('floor');
  }

  select(sel: Selection | null): void {
    this.selection = sel;
    this.emit('selection');
  }

  private fixActiveFloor(): void {
    if (!this.project.floors.some((f) => f.id === this.activeFloorId)) this.activeFloorId = this.project.floors[0].id;
  }

  private validateSelection(): void {
    const s = this.selection;
    if (!s) return;
    const f = this.floor;
    const exists =
      (s.kind === 'wall' && f.walls.some((w) => w.id === s.id)) ||
      (s.kind === 'room' && f.rooms.some((r) => r.id === s.id)) ||
      (s.kind === 'manifold' && f.manifolds.some((m) => m.id === s.id)) ||
      (s.kind === 'route' && f.routes.some((r) => r.id === s.id)) ||
      (s.kind === 'void' && f.voids.some((x) => x.id === s.id)) ||
      (s.kind === 'opening' && f.walls.some((w) => w.openings.some((o) => `${w.id}|${o.id}` === s.id))) ||
      (s.kind === 'heatSource' && this.project.heatSource?.floorId === f.id);
    if (!exists) this.selection = null;
  }

  /** Bilder, die von keinem Geschoss mehr referenziert werden, entfernen. */
  pruneImages(): void {
    const used = new Set(this.project.floors.map((f) => f.background?.imageId).filter(Boolean) as string[]);
    for (const k of Object.keys(this.images)) if (!used.has(k)) delete this.images[k];
  }
}
