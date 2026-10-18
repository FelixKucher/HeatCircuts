// Datenmodell von HeatCircuits.
// Alle Längen in Metern, Temperaturen in °C, U-Werte in W/(m²·K), Wärmewiderstände in m²·K/W.
// Planlage: x nach rechts, y nach unten (wie in der Bildschirmdarstellung).

export interface Vec {
  x: number;
  y: number;
}

export type WallKind = 'exterior' | 'interior' | 'unheated';
export type FloorBoundary = 'ground' | 'unheated' | 'heated' | 'outside';
export type CeilingBoundary = 'roof' | 'unheated' | 'heated';
export type LayingPattern = 'spiral' | 'meander';

export interface Wall {
  id: string;
  a: Vec;
  b: Vec;
  /** Wanddicke in m (Zeichnung = Wandachse). */
  thickness: number;
  kind: WallKind;
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
  /** Verlegeabstand VA in m */
  spacing: number;
  pattern: LayingPattern;
  /** null = nächstgelegener Verteiler */
  manifoldId: string | null;
  /** Anschlusspunkt der Heizkreise; null = automatisch (Raumkontur, nächster Punkt zum Verteiler) */
  connector: Vec | null;
  /** Fensterfläche in m² (in Außenwänden) */
  windowArea: number;
  /** Außenwandlänge in m; null = aus gezeichneten Außenwänden ermitteln */
  extWallLengthOverride: number | null;
  floorBoundary: FloorBoundary;
  ceilingBoundary: CeilingBoundary;
  /** Anzahl Heizkreise; null = automatisch aus maximaler Kreislänge */
  circuitsOverride: number | null;
  /** Nicht belegte Fläche (Einbauten, Küchenzeile, Dusche) in m² */
  excludedArea: number;
}

export interface Manifold {
  id: string;
  name: string;
  pos: Vec;
  /** manuelle Länge Verteiler ↔ Wärmeerzeuger (einfach) in m; null = automatisch */
  supplyLengthOverride: number | null;
}

export interface Route {
  id: string;
  roomId: string;
  /** Zwischenpunkte zwischen Anschlusspunkt des Raums und Verteiler */
  points: Vec[];
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
  /** true, sobald der Maßstab kalibriert wurde */
  calibrated: boolean;
}

export interface Floor {
  id: string;
  name: string;
  /** Höhe Oberkante Fertigfußboden über ±0,00 in m */
  elevation: number;
  /** Geschosshöhe (Rohbau, für Außenwandflächen) in m */
  storeyHeight: number;
  /** lichte Raumhöhe (für Raumvolumen) in m */
  clearHeight: number;
  background: BackgroundImage | null;
  walls: Wall[];
  rooms: Room[];
  manifolds: Manifold[];
  routes: Route[];
}

export interface HeatSource {
  floorId: string;
  pos: Vec;
  name: string;
  /** Schlüssel in HEAT_SOURCE_TYPES */
  type: string;
}

export interface BuildingData {
  client: string;
  address: string;
  planner: string;
  /** Schlüssel in CLIMATE_LOCATIONS oder 'custom' */
  location: string;
  /** Norm-Außentemperatur θ_e in °C */
  thetaE: number;
  /** Jahresmittel der Außentemperatur θ_m,e in °C */
  thetaMeanYear: number;
  /** Schlüssel in BUILDING_STANDARDS */
  standard: string;
  uExtWall: number;
  uWindow: number;
  uRoof: number;
  uGroundFloor: number;
  /** Decke/Boden gegen unbeheizte Räume */
  uUnheatedSlab: number;
  /** Wand gegen unbeheizte Räume */
  uUnheatedWall: number;
  /** Innenwand zwischen beheizten Räumen unterschiedlicher Temperatur */
  uInteriorWall: number;
  /** Wärmebrückenzuschlag ΔU_WB */
  deltaUTB: number;
  heatRecovery: boolean;
  /** Wirkungsgrad der Wärmerückgewinnung (0…1) */
  etaHR: number;
  notes: string;
}

export interface DesignParams {
  /** Schlüssel in PIPES */
  pipe: string;
  /** maximale Heizkreislänge inkl. Anbindeleitung in m */
  maxCircuitLength: number;
  /** maximaler Druckverlust je Heizkreis in Pa (Rohrreibung) */
  maxPressureDrop: number;
  /** Spreizung σ des Auslegungsraums in K */
  sigmaDesign: number;
  /** feste Vorlauftemperatur; null = nach EN 1264-3 ermitteln */
  supplyTempFixed: number | null;
  /** Schlüssel in SCREEDS */
  screed: string;
  /** Wärmeleitfähigkeit des Estrichs λ_E in W/(m·K) */
  lambdaScreed: number;
  /** Estrichüberdeckung über Rohr s_ü in m */
  screedCover: number;
  /** Dämmdicke unter dem System in m */
  insulationThickness: number;
  /** Wärmeleitfähigkeit der Dämmung in W/(m·K) */
  lambdaInsulation: number;
  /** Abstand der Rohre zur Wand in m */
  wallDistance: number;
  /** Rollenlänge für die Materialliste in m */
  rollLength: number;
}

export interface Project {
  version: 1;
  name: string;
  isExample: boolean;
  building: BuildingData;
  design: DesignParams;
  floors: Floor[];
  heatSource: HeatSource | null;
}

/** Bilder werden getrennt vom Projekt gehalten, damit Undo-Schritte sie nicht kopieren. */
export type ImageStore = Record<string, string>;
