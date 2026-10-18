// Zustand mit Undo/Redo (JSON-Schnappschüsse) und Auswahl.

import { migrate, newProject, type Level, type Project } from './model';

export type SelKind = 'wall' | 'opening' | 'room' | 'furniture' | 'stair' | 'dimension' | 'label';
export interface SelItem {
  kind: SelKind;
  id: string;
  /** Öffnung: Wand-Id */
  wallId?: string;
}

type Listener = (structural: boolean) => void;

export class Store {
  project: Project = newProject();
  levelId: string;
  selection: SelItem[] = [];
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private liveBase: string | null = null;
  private listeners: Listener[] = [];
  dirty = false;

  constructor() {
    this.levelId = this.project.levels[0].id;
  }

  get level(): Level {
    return this.project.levels.find((l) => l.id === this.levelId) ?? this.project.levels[0];
  }

  on(fn: Listener): void {
    this.listeners.push(fn);
  }

  emit(structural = true): void {
    for (const fn of this.listeners) fn(structural);
  }

  private snap(): string {
    return JSON.stringify(this.project);
  }

  /** Änderung als ein Undo-Schritt */
  commit(fn: (p: Project, l: Level) => void): void {
    const before = this.snap();
    fn(this.project, this.level);
    if (this.snap() === before) return;
    this.undoStack.push(before);
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
    this.dirty = true;
    this.pruneSelection();
    this.emit(true);
  }

  /** Beginn einer fortlaufenden Änderung (Ziehen): erst endLive() erzeugt den Undo-Schritt */
  beginLive(): void {
    if (this.liveBase === null) this.liveBase = this.snap();
  }

  live(fn: (p: Project, l: Level) => void): void {
    if (this.liveBase === null) this.beginLive();
    fn(this.project, this.level);
    this.emit(false);
  }

  endLive(): void {
    if (this.liveBase === null) return;
    if (this.liveBase !== this.snap()) {
      this.undoStack.push(this.liveBase);
      this.redoStack = [];
      this.dirty = true;
    }
    this.liveBase = null;
    this.emit(true);
  }

  cancelLive(): void {
    if (this.liveBase === null) return;
    this.project = JSON.parse(this.liveBase);
    this.liveBase = null;
    this.emit(true);
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): void {
    const s = this.undoStack.pop();
    if (!s) return;
    this.redoStack.push(this.snap());
    this.project = JSON.parse(s);
    this.fixLevel();
    this.pruneSelection();
    this.emit(true);
  }

  redo(): void {
    const s = this.redoStack.pop();
    if (!s) return;
    this.undoStack.push(this.snap());
    this.project = JSON.parse(s);
    this.fixLevel();
    this.pruneSelection();
    this.emit(true);
  }

  load(p: Project): void {
    this.project = migrate(p);
    this.undoStack = [];
    this.redoStack = [];
    this.selection = [];
    this.levelId = this.project.levels[0].id;
    this.dirty = false;
    this.emit(true);
  }

  setLevel(id: string): void {
    this.levelId = id;
    this.selection = [];
    this.emit(true);
  }

  select(items: SelItem[]): void {
    this.selection = items;
    this.emit(false);
  }

  isSelected(kind: SelKind, id: string): boolean {
    return this.selection.some((s) => s.kind === kind && s.id === id);
  }

  private fixLevel(): void {
    if (!this.project.levels.some((l) => l.id === this.levelId)) this.levelId = this.project.levels[0].id;
  }

  private pruneSelection(): void {
    const l = this.level;
    this.selection = this.selection.filter((s) => {
      switch (s.kind) {
        case 'wall':
          return l.walls.some((w) => w.id === s.id);
        case 'opening':
          return l.walls.some((w) => w.id === s.wallId && w.openings.some((o) => o.id === s.id));
        case 'room':
          return l.rooms.some((r) => r.id === s.id);
        case 'furniture':
          return l.furniture.some((f) => f.id === s.id);
        case 'stair':
          return l.stairs.some((x) => x.id === s.id);
        case 'dimension':
          return l.dimensions.some((x) => x.id === s.id);
        case 'label':
          return l.labels.some((x) => x.id === s.id);
      }
    });
  }
}
