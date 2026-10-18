import type { BuildingData, DesignParams, Floor, Project, Room, Vec, Wall, WallKind } from './types';
import { BUILDING_STANDARDS, CLIMATE_LOCATIONS, COVERINGS, PIPES, ROOM_TYPES, SCREEDS } from './catalog';

export function uid(prefix = ''): string {
  const r = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return prefix + r.replace(/-/g, '').slice(0, 12);
}

export function defaultBuilding(): BuildingData {
  const loc = CLIMATE_LOCATIONS.frankfurt;
  const std = BUILDING_STANDARDS.enev;
  return {
    client: '',
    address: '',
    planner: '',
    location: 'frankfurt',
    thetaE: loc.thetaE,
    thetaMeanYear: loc.thetaMeanYear,
    standard: 'enev',
    uExtWall: std.uExtWall,
    uWindow: std.uWindow,
    uRoof: std.uRoof,
    uGroundFloor: std.uGroundFloor,
    uUnheatedSlab: std.uUnheatedSlab,
    uUnheatedWall: std.uUnheatedWall,
    uInteriorWall: 1.7,
    deltaUTB: std.deltaUTB,
    heatRecovery: false,
    etaHR: 0.8,
    notes: '',
  };
}

export function defaultDesign(): DesignParams {
  return {
    pipe: '16x2',
    maxCircuitLength: PIPES['16x2'].maxLength,
    maxPressureDrop: 25000,
    sigmaDesign: 5,
    supplyTempFixed: null,
    screed: 'CT',
    lambdaScreed: SCREEDS.CT.lambda,
    screedCover: 0.045,
    insulationThickness: 0.03,
    lambdaInsulation: 0.035,
    wallDistance: 0.1,
    rollLength: 240,
  };
}

export function newFloor(name: string, elevation: number): Floor {
  return {
    id: uid('f'),
    name,
    elevation,
    storeyHeight: 2.9,
    clearHeight: 2.5,
    background: null,
    walls: [],
    rooms: [],
    manifolds: [],
    routes: [],
  };
}

export function newProject(name = 'Neues Projekt'): Project {
  return {
    version: 1,
    name,
    isExample: false,
    building: defaultBuilding(),
    design: defaultDesign(),
    floors: [newFloor('Erdgeschoss', 0)],
    heatSource: null,
  };
}

export function newWall(a: Vec, b: Vec, kind: WallKind, thickness: number): Wall {
  return { id: uid('w'), a, b, kind, thickness };
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

/** Lage des Geschosses bestimmt die Vorbelegung der Begrenzungsflächen. */
export function boundariesFor(project: Project, floor: Floor): Pick<Room, 'floorBoundary' | 'ceilingBoundary'> {
  const sorted = project.floors.slice().sort((a, b) => a.elevation - b.elevation);
  const lowest = sorted[0]?.id === floor.id;
  const highest = sorted[sorted.length - 1]?.id === floor.id;
  return { floorBoundary: lowest ? 'ground' : 'heated', ceilingBoundary: highest ? 'roof' : 'heated' };
}

export function newRoom(project: Project, floor: Floor, polygon: Vec[], type = 'wohnen', name?: string): Room {
  const t = ROOM_TYPES[type] ?? ROOM_TYPES.sonstiges;
  const count = floor.rooms.filter((r) => r.type === type).length;
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
    spacing: t.spacing,
    pattern: 'spiral',
    manifoldId: null,
    connector: null,
    windowArea: 0,
    extWallLengthOverride: null,
    ...boundariesFor(project, floor),
    circuitsOverride: null,
    excludedArea: 0,
  };
}

/** Raumtyp wechseln: Temperatur, Luftwechsel, Belag und Verlegeabstand aus der Vorlage übernehmen. */
export function applyRoomType(room: Room, type: string): void {
  const t = ROOM_TYPES[type];
  if (!t) return;
  room.type = type;
  room.thetaI = t.thetaI;
  room.airChange = t.airChange;
  room.covering = t.covering;
  room.rLambdaB = COVERINGS[t.covering]?.rLambdaB ?? room.rLambdaB;
  room.spacing = t.spacing;
  room.heated = t.heated;
}
