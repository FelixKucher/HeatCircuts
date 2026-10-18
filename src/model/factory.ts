import type { BuildingData, DesignParams, Floor, HeatingSurface, Project, Roof, Room, SurfaceKind, Vec, Wall, WallKind } from './types';
import { BUILDING_STANDARDS, CLIMATE_LOCATIONS, COVERINGS, DEFAULT_ALLOWED_SPACINGS, PIPES, ROOM_TYPES, SCREEDS } from './catalog';
import { ageClassFor, defaultConstructions, uValue, WINDOW_TYPES } from './constructions';
import { HEATING_SYSTEMS } from './systems';

export function uid(prefix = ''): string {
  const r = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return prefix + r.replace(/-/g, '').slice(0, 12);
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;

/** Überträgt die U-Werte der Konstruktionen und des Fenstertyps in die Gebäudedaten. */
export function applyConstructionUValues(b: BuildingData): void {
  const c = b.constructions;
  b.uExtWall = round3(uValue('extWall', c.extWall.layers));
  b.uRoof = round3(uValue('roof', c.roof.layers));
  b.uTopSlab = round3(uValue('topSlab', c.topSlab.layers));
  b.uGroundFloor = round3(uValue('groundSlab', c.groundSlab.layers));
  b.uUnheatedSlab = round3(uValue('basementSlab', c.basementSlab.layers));
  b.uUnheatedWall = round3(uValue('unheatedWall', c.unheatedWall.layers));
  b.uWindow = WINDOW_TYPES[b.windowType]?.u ?? b.uWindow;
}

/** Baujahr setzen: Konstruktionen, Fenster und Wärmebrückenzuschlag aus der Baualtersklasse. */
export function applyYearBuilt(b: BuildingData, year: number): void {
  const ac = ageClassFor(year);
  b.yearBuilt = year;
  b.constructions = defaultConstructions(year);
  b.windowType = ac.window;
  b.deltaUTB = ac.deltaUTB;
  b.standard = 'custom';
  applyConstructionUValues(b);
}

export function defaultBuilding(): BuildingData {
  const loc = CLIMATE_LOCATIONS.frankfurt;
  const std = BUILDING_STANDARDS.enev;
  const b: BuildingData = {
    client: '',
    address: '',
    planner: '',
    location: 'frankfurt',
    thetaE: loc.thetaE,
    thetaMeanYear: loc.thetaMeanYear,
    yearBuilt: 2012,
    basement: 'none',
    standard: 'custom',
    constructions: defaultConstructions(2012),
    windowType: 'wsv2',
    uExtWall: std.uExtWall,
    uWindow: std.uWindow,
    uDoor: 1.8,
    uRoof: std.uRoof,
    uTopSlab: std.uRoof,
    uGroundFloor: std.uGroundFloor,
    uUnheatedSlab: std.uUnheatedSlab,
    uUnheatedWall: std.uUnheatedWall,
    uInteriorWall: 1.7,
    deltaUTB: std.deltaUTB,
    heatRecovery: false,
    etaHR: 0.8,
    notes: '',
  };
  applyConstructionUValues(b);
  return b;
}

export function defaultDesign(): DesignParams {
  return {
    pipe: '16x2',
    maxCircuitLength: PIPES['16x2'].maxLength,
    maxPressureDrop: 25000,
    sigmaDesign: 5,
    supplyTempFixed: null,
    targetSupply: 35,
    allowedSpacings: DEFAULT_ALLOWED_SPACINGS.slice(),
    defaultFloorSystem: 'wet',
    screed: 'CT',
    lambdaScreed: SCREEDS.CT.lambda,
    screedCover: 0.045,
    milledCover: 0.015,
    insulationThickness: 0.03,
    lambdaInsulation: 0.035,
    wallDistance: 0.1,
    rollLength: 240,
    maxOutlets: 12,
    balanceLengths: true,
  };
}

export function defaultRoof(): Roof {
  return { type: 'gable', pitch: 35, ridge: 'x', overhang: 0.5, insulation: 'topSlab', kneeWall: 0.5 };
}

export function newFloor(name: string, elevation: number): Floor {
  return {
    id: uid('f'),
    name,
    elevation,
    storeyHeight: 2.9,
    clearHeight: 2.5,
    belowGrade: false,
    background: null,
    walls: [],
    rooms: [],
    manifolds: [],
    routes: [],
    voids: [],
  };
}

export function newProject(name = 'Neues Projekt'): Project {
  return {
    version: 2,
    name,
    isExample: false,
    building: defaultBuilding(),
    design: defaultDesign(),
    roof: defaultRoof(),
    floors: [newFloor('Erdgeschoss', 0)],
    heatSource: null,
    wizard: { done: false, step: 0 },
  };
}

export function newWall(a: Vec, b: Vec, kind: WallKind, thickness: number): Wall {
  return { id: uid('w'), a, b, kind, thickness, openings: [] };
}

export function newSurface(kind: SurfaceKind, system: string, spacing?: number): HeatingSurface {
  const sys = HEATING_SYSTEMS[system];
  return {
    id: uid('s'),
    kind,
    system,
    spacing: spacing ?? sys?.defaultSpacing ?? 0.15,
    pattern: kind === 'wall' ? 'meander' : 'spiral',
    coverage: kind === 'ceiling' ? 0.8 : 1,
    electricPower: 150,
  };
}

/** Übliche Kurzbezeichnung eines Geschosses (EG, OG, 2.OG, DG, KG). */
export function floorShort(name: string): string {
  const n = name.trim();
  const num = n.match(/^(\d+)\.?\s*/)?.[1];
  const pre = num ? `${num}.` : '';
  if (/erd/i.test(n)) return 'EG';
  if (/ober/i.test(n)) return `${pre}OG`;
  if (/dach/i.test(n)) return `${pre}DG`;
  if (/keller|unter|souterrain/i.test(n)) return `${pre}KG`;
  return n.slice(0, 3).toUpperCase();
}

export function nearestAllowed(project: Project, spacing: number): number {
  const list = project.design.allowedSpacings.length ? project.design.allowedSpacings : DEFAULT_ALLOWED_SPACINGS;
  return list.reduce((best, s) => (Math.abs(s - spacing) < Math.abs(best - spacing) ? s : best), list[0]);
}

export function newRoom(project: Project, floor: Floor, polygon: Vec[], type = 'wohnen', name?: string): Room {
  const t = ROOM_TYPES[type] ?? ROOM_TYPES.sonstiges;
  const count = floor.rooms.filter((r) => r.type === type).length;
  const sys = project.design.defaultFloorSystem;
  const spacing = nearestAllowed(project, sys === 'milled' ? Math.min(t.spacing, 0.1) : t.spacing);
  return {
    id: uid('r'),
    name: name ?? (count ? `${t.label} ${count + 1}` : t.label),
    type,
    polygon,
    heated: t.heated,
    thetaI: t.thetaI,
    airChange: t.airChange,
    covering: t.covering,
    rLambdaB: COVERINGS[t.covering]?.rLambdaB ?? 0.02,
    surfaces: t.heated ? [newSurface('floor', sys, spacing)] : [],
    manifoldId: null,
    connector: null,
    windowArea: 0,
    extWallLengthOverride: null,
    floorBoundary: 'auto',
    ceilingBoundary: 'auto',
    circuitsOverride: null,
    excludedArea: 0,
  };
}

/** Raumtyp wechseln: Temperatur, Luftwechsel, Belag und Verlegeabstand aus der Vorlage übernehmen. */
export function applyRoomType(project: Project, room: Room, type: string): void {
  const t = ROOM_TYPES[type];
  if (!t) return;
  room.type = type;
  room.thetaI = t.thetaI;
  room.airChange = t.airChange;
  room.covering = t.covering;
  room.rLambdaB = COVERINGS[t.covering]?.rLambdaB ?? room.rLambdaB;
  room.heated = t.heated;
  const floorSurf = room.surfaces.find((s) => s.kind === 'floor');
  if (floorSurf) floorSurf.spacing = nearestAllowed(project, t.spacing);
  if (t.heated && room.surfaces.length === 0) room.surfaces.push(newSurface('floor', project.design.defaultFloorSystem, nearestAllowed(project, t.spacing)));
  if (!t.heated) room.surfaces = [];
}

/** Liest Projekte älterer Versionen und ergänzt fehlende Felder. */
export function migrateProject(raw: unknown): Project {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = raw as any;
  const base = newProject(p.name ?? 'Projekt');
  p.version = 2;
  p.building = { ...base.building, ...(p.building ?? {}) };
  if (!p.building.constructions) p.building.constructions = defaultConstructions(p.building.yearBuilt ?? 2012);
  if (p.building.uTopSlab == null) p.building.uTopSlab = p.building.uRoof;
  p.design = { ...base.design, ...(p.design ?? {}) };
  if (!Array.isArray(p.design.allowedSpacings) || !p.design.allowedSpacings.length) p.design.allowedSpacings = DEFAULT_ALLOWED_SPACINGS.slice();
  p.roof = { ...base.roof, ...(p.roof ?? {}) };
  p.wizard = p.wizard ?? { done: true, step: 0 };
  for (const f of p.floors ?? []) {
    f.voids = f.voids ?? [];
    f.belowGrade = f.belowGrade ?? false;
    for (const w of f.walls) w.openings = w.openings ?? [];
    for (const m of f.manifolds) m.maxOutlets = m.maxOutlets ?? 12;
    for (const r of f.rooms) {
      if (!Array.isArray(r.surfaces)) {
        r.surfaces = r.heated ? [{ ...newSurface('floor', 'wet', r.spacing ?? 0.15), pattern: r.pattern ?? 'spiral' }] : [];
        delete r.spacing;
        delete r.pattern;
      }
      r.floorBoundary = r.floorBoundary ?? 'auto';
      r.ceilingBoundary = r.ceilingBoundary ?? 'auto';
    }
  }
  return p as Project;
}
