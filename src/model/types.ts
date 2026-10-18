// Datenmodell von HeatCircuits (Version 2).
// Alle Längen in Metern, Temperaturen in °C, U-Werte in W/(m²·K), Wärmewiderstände in m²·K/W.
// Planlage: x nach rechts, y nach unten (wie in der Bildschirmdarstellung), z nach oben.

export interface Vec {
  x: number;
  y: number;
}

export type WallKind = 'exterior' | 'interior' | 'unheated';
export type FloorBoundary = 'auto' | 'ground' | 'unheated' | 'heated' | 'outside';
export type CeilingBoundary = 'auto' | 'roof' | 'unheated' | 'heated';
export type LayingPattern = 'spiral' | 'meander';
export type SurfaceKind = 'floor' | 'ceiling' | 'wall';
export type OpeningKind = 'window' | 'door' | 'entrance' | 'garage';
export type VoidKind = 'stair' | 'spiral' | 'void';
export type RoofType = 'gable' | 'hip' | 'shed' | 'flat' | 'none';

/** Fenster, Tür oder Tor in einer Wand. Lage über den Abstand der Öffnungsmitte vom Wandanfang a. */
export interface Opening {
  id: string;
  kind: OpeningKind;
  /** Abstand der Öffnungsmitte vom Wandpunkt a entlang der Achse */
  offset: number;
  width: number;
  height: number;
  /** Brüstungshöhe über OK FFB */
  sill: number;
}

export interface Wall {
  id: string;
  a: Vec;
  b: Vec;
  /** Wanddicke in m (Zeichnung = Wandachse). */
  thickness: number;
  kind: WallKind;
  openings: Opening[];
}

/** Heizfläche eines Raums. Ein Raum kann mehrere Heizflächen haben (z. B. Fußboden + Wand). */
export interface HeatingSurface {
  id: string;
  kind: SurfaceKind;
  /** Schlüssel in HEATING_SYSTEMS */
  system: string;
  /** Verlegeabstand VA in m (Wassersysteme) */
  spacing: number;
  pattern: LayingPattern;
  /** belegter Anteil der Raumfläche (Boden/Decke), 0…1 */
  coverage: number;
  /** Elektro: installierte Leistung in W/m² */
  electricPower: number;
  /** Verlegeabstand von Hand festgelegt – die automatische Auslegung ändert ihn nicht */
  spacingLocked?: boolean;
  /** Wandheizung: Wand und Heizfeld (Abstand entlang der Wand ab a, Höhe ab OK FFB) */
  wallId?: string;
  field?: { x0: number; x1: number; z0: number; z1: number };
}

export interface Room {
  id: string;
  name: string;
  /** Schlüssel in ROOM_TYPES */
  type: string;
  polygon: Vec[];
  heated: boolean;
  /** Norm-Innentemperatur θ_int in °C */
  thetaI: number;
  /** Mindestluftwechsel n_min in 1/h */
  airChange: number;
  /** Schlüssel in COVERINGS */
  covering: string;
  /** Wärmeleitwiderstand des Bodenbelags R_λ,B in m²·K/W */
  rLambdaB: number;
  surfaces: HeatingSurface[];
  /** null = nächstgelegener Verteiler */
  manifoldId: string | null;
  /** Verteiler von Hand gewählt – die automatische Verteilung ändert ihn nicht */
  manifoldLocked?: boolean;
  /** Anschlusspunkt der Heizkreise; null = automatisch */
  connector: Vec | null;
  /** zusätzliche Fensterfläche in m² (zu den gezeichneten Fenstern) */
  windowArea: number;
  /** Außenwandlänge in m; null = aus gezeichneten Außenwänden ermitteln */
  extWallLengthOverride: number | null;
  floorBoundary: FloorBoundary;
  ceilingBoundary: CeilingBoundary;
  /** Anzahl Heizkreise der Fußbodenfläche; null = automatisch */
  circuitsOverride: number | null;
  /** Nicht belegte Bodenfläche (Einbauten, Küchenzeile, Dusche) in m² */
  excludedArea: number;
}

export interface Manifold {
  id: string;
  name: string;
  pos: Vec;
  /** manuelle Länge Verteiler ↔ Wärmeerzeuger (einfach) in m; null = automatisch */
  supplyLengthOverride: number | null;
  /** maximale Anzahl Abgänge */
  maxOutlets: number;
}

export interface Route {
  id: string;
  roomId: string;
  /** Zwischenpunkte zwischen Anschlusspunkt des Raums und Verteiler */
  points: Vec[];
  /** true = automatisch geführt (wird bei der Auslegung neu berechnet) */
  auto?: boolean;
}

/** Deckenöffnung im Fußboden dieses Geschosses (Treppe, Spindeltreppe, Luftraum). */
export interface FloorVoid {
  id: string;
  kind: VoidKind;
  polygon: Vec[];
  /** Spindeltreppe */
  center?: Vec;
  radius?: number;
  /** gerade Treppe: Laufrichtung (Antritt → Austritt) */
  direction?: 'x+' | 'x-' | 'y+' | 'y-';
}

export interface BackgroundImage {
  imageId: string;
  widthPx: number;
  heightPx: number;
  /** Pixel pro Meter (nach Kalibrierung) */
  pxPerM: number;
  /** Lage der linken oberen Bildecke im Plan, in m */
  offset: Vec;
  opacity: number;
  visible: boolean;
  locked: boolean;
  calibrated: boolean;
}

export interface Floor {
  id: string;
  name: string;
  /** Höhe Oberkante Fertigfußboden über ±0,00 in m */
  elevation: number;
  /** Geschosshöhe (OK FFB bis OK FFB) in m */
  storeyHeight: number;
  /** lichte Raumhöhe in m */
  clearHeight: number;
  /** Geschoss liegt im Erdreich (Keller) */
  belowGrade: boolean;
  background: BackgroundImage | null;
  walls: Wall[];
  rooms: Room[];
  manifolds: Manifold[];
  routes: Route[];
  voids: FloorVoid[];
}

export interface HeatSource {
  floorId: string;
  pos: Vec;
  name: string;
  /** Schlüssel in HEAT_SOURCE_TYPES */
  type: string;
}

export interface Layer {
  /** Schlüssel in MATERIALS */
  material: string;
  thickness: number;
}

export interface Construction {
  /** Schlüssel der Vorlage oder 'custom' */
  template: string;
  layers: Layer[];
}

export type ConstructionSlot = 'extWall' | 'roof' | 'topSlab' | 'groundSlab' | 'basementSlab' | 'unheatedWall';

export interface Roof {
  type: RoofType;
  /** Dachneigung in Grad */
  pitch: number;
  /** Firstrichtung */
  ridge: 'x' | 'y';
  overhang: number;
  /** Dämmebene: in der Dachfläche (beheiztes DG) oder auf der obersten Geschossdecke */
  insulation: 'rafters' | 'topSlab';
  /** Kniestock (Drempel) über OK FFB des obersten Geschosses */
  kneeWall: number;
}

export interface BuildingData {
  client: string;
  address: string;
  planner: string;
  /** Schlüssel in CLIMATE_LOCATIONS oder 'custom' */
  location: string;
  thetaE: number;
  thetaMeanYear: number;
  /** Baujahr */
  yearBuilt: number;
  /** unter dem untersten gezeichneten Geschoss: Bodenplatte oder unbeheizter Keller */
  basement: 'none' | 'unheated';
  /** Schlüssel in BUILDING_STANDARDS oder 'custom' */
  standard: string;
  constructions: Record<ConstructionSlot, Construction>;
  /** Schlüssel in WINDOW_TYPES */
  windowType: string;
  uExtWall: number;
  uWindow: number;
  uDoor: number;
  /** Dach (Dämmung in der Dachfläche) */
  uRoof: number;
  /** oberste Geschossdecke zum unbeheizten Dachraum */
  uTopSlab: number;
  uGroundFloor: number;
  uUnheatedSlab: number;
  uUnheatedWall: number;
  uInteriorWall: number;
  deltaUTB: number;
  heatRecovery: boolean;
  etaHR: number;
  notes: string;
}

export interface DesignParams {
  /** Schlüssel in PIPES */
  pipe: string;
  maxCircuitLength: number;
  maxPressureDrop: number;
  sigmaDesign: number;
  /** feste Vorlauftemperatur; null = nach EN 1264-3 ermitteln */
  supplyTempFixed: number | null;
  /** Ziel-Vorlauftemperatur für die automatische Auslegung */
  targetSupply: number;
  /** zulässige Verlegeabstände in m */
  allowedSpacings: number[];
  /** Standardsystem für neue Fußbodenflächen (Schlüssel in HEATING_SYSTEMS) */
  defaultFloorSystem: string;
  screed: string;
  lambdaScreed: number;
  /** Estrichdicke über Rohr s_ü in m (Nasssystem) */
  screedCover: number;
  /** Rohrüberdeckung im Fräs-System in m */
  milledCover: number;
  insulationThickness: number;
  lambdaInsulation: number;
  wallDistance: number;
  rollLength: number;
  /** maximale Anzahl Abgänge je Verteiler (automatische Verteilung) */
  maxOutlets: number;
}

export interface Project {
  version: 2;
  name: string;
  isExample: boolean;
  building: BuildingData;
  design: DesignParams;
  roof: Roof;
  floors: Floor[];
  heatSource: HeatSource | null;
  /** Assistent abgeschlossen / aktueller Schritt */
  wizard: { done: boolean; step: number };
}

/** Bilder werden getrennt vom Projekt gehalten, damit Undo-Schritte sie nicht kopieren. */
export type ImageStore = Record<string, string>;
