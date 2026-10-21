// Datenmodell von HeatCircuits (Version 3): Gebäude-CAD und Flächenheizung in einem Modell.
// Alle Längen in Metern, Temperaturen in °C, U-Werte in W/(m²·K), Wärmewiderstände in m²·K/W.
// Planlage: x nach rechts, y nach unten (wie in der Bildschirmdarstellung), z nach oben.

export interface Vec {
  x: number;
  y: number;
}

export type WallKind = 'exterior' | 'interior' | 'unheated' | 'party';
export type FloorBoundary = 'auto' | 'ground' | 'unheated' | 'heated' | 'outside' | 'neighbor';
export type CeilingBoundary = 'auto' | 'roof' | 'unheated' | 'heated' | 'neighbor';
export type LayingPattern = 'spiral' | 'meander';
export type SurfaceKind = 'floor' | 'ceiling' | 'wall';
export type OpeningKind = 'window' | 'door' | 'entrance' | 'garage';
export type VoidKind = 'stair' | 'spiral' | 'void';
export type RoofType = 'gable' | 'hip' | 'shed' | 'flat' | 'none';
/** Darstellung einer Öffnung (Plan/3D); die bauphysikalische Art steht in `kind` */
export type OpeningStyle = 'door' | 'doubleDoor' | 'slidingDoor' | 'passage' | 'window' | 'frenchWindow' | 'roofWindow' | 'garageDoor';
export type FloorFinish = 'parkett' | 'laminat' | 'fliesen' | 'naturstein' | 'teppich' | 'beton' | 'farbe';
export type HouseType = 'efh' | 'dhh' | 'rmh' | 'reh' | 'bungalow' | 'villa' | 'mfh' | 'whg';
export type Compass4 = 'N' | 'O' | 'S' | 'W';

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
  /** Darstellung; fehlt = aus `kind` */
  style?: OpeningStyle;
  /** Türblatt öffnet zur linken (+n) bzw. rechten Wandseite */
  side?: 'left' | 'right';
  /** Bandseite am Anfang (a) oder Ende (b) der Öffnung */
  hinge?: 'a' | 'b';
  color?: string;
  /** U-Wert dieser Öffnung; null/undefined = Gebäudewert (Fenster bzw. Tür) */
  uValue?: number | null;
}

export interface Wall {
  id: string;
  a: Vec;
  b: Vec;
  /** Wanddicke in m (Zeichnung = Wandachse). */
  thickness: number;
  kind: WallKind;
  openings: Opening[];
  /** Höhe des angeschütteten Erdreichs über OK FFB dieses Geschosses in m; undefined/null = aus dem Gelände */
  earthHeight?: number | null;
  /** Art automatisch aus den angrenzenden Räumen bestimmen */
  kindAuto?: boolean;
  /** Wandhöhe; null = Geschosshöhe */
  height?: number | null;
  /** Farbe der linken (+n) und rechten Wandseite */
  colorLeft?: string;
  colorRight?: string;
  /** Schichtaufbau nur dieser Wand; null = Gebäudeaufbau der Wandart */
  construction?: Construction | null;
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
  /** Oberfläche und Darstellung */
  floorFinish?: FloorFinish;
  floorColor?: string;
  ceilingColor?: string;
  showFloor?: boolean;
  showCeiling?: boolean;
  labelOffset?: Vec;
  /** Aufbau von Boden und Decke nur dieses Raums; null = Gebäudeaufbau */
  floorConstruction?: Construction | null;
  ceilingConstruction?: Construction | null;
}

export interface Dimension {
  id: string;
  a: Vec;
  b: Vec;
  /** Abstand der Maßlinie (links positiv) */
  offset: number;
}

export interface Label {
  id: string;
  pos: Vec;
  text: string;
  size: number;
  angle: number;
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
  /** Deckenstärke unter diesem Geschoss (Darstellung) */
  floorThickness: number;
  /** in 3D anzeigen */
  visible: boolean;
  dimensions: Dimension[];
  labels: Label[];
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
  color?: string;
}

/** Gelände: eben oder geneigte Ebene (Hanglage). Plan oben = Norden, Osten = +x. */
export interface Terrain {
  type: 'flat' | 'slope';
  /** Geländehöhe an der Talseite (bzw. überall bei ebenem Gelände) relativ zu ±0,00 in m */
  gradeLow: number;
  /** Höhenunterschied Talseite → Bergseite über die Gebäudetiefe in m */
  rise: number;
  /** Bergseite */
  uphill: 'N' | 'O' | 'S' | 'W';
}

/** Standort und Gebäudeart */
export interface Site {
  houseType: HouseType;
  /** angebaute Seiten (Haustrennwand zum beheizten Nachbarhaus) */
  attached: Compass4[];
  /** Wohnung: Lage im Gebäude */
  unitPosition: 'ground' | 'middle' | 'top';
  /** Temperatur beheizter Nachbarhäuser/-wohnungen (Annahme) */
  neighbourTemp: number;
  /** Nordrichtung: Drehung von Plan-oben im Uhrzeigersinn in Grad */
  north: number;
  lat: number | null;
  lon: number | null;
  /** Höhe über NN in m */
  altitude: number;
  /** Bezeichnung des Orts (frei) */
  place: string;
}

/** Zeicheneinstellungen */
export interface Settings {
  wallThickness: number;
  gridStep: number;
  showGrid: boolean;
  magnetism: boolean;
  showRoomArea: boolean;
  showWallDims: boolean;
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
  /** Haustrennwand / Wohnungstrennwand zum beheizten Nachbarn */
  uPartyWall: number;
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
  /** Kreisanzahl je Verteiler so wählen, dass die Kreislängen möglichst gleich sind */
  balanceLengths: boolean;
  /** vorgesehener Wärmeerzeuger (Schlüssel in HEAT_SOURCE_TYPES) */
  generator: string;
}

export interface Project {
  version: 3;
  name: string;
  isExample: boolean;
  building: BuildingData;
  design: DesignParams;
  roof: Roof;
  terrain: Terrain;
  site: Site;
  settings: Settings;
  floors: Floor[];
  heatSource: HeatSource | null;
  /** Assistent abgeschlossen / aktueller Schritt */
  wizard: { done: boolean; step: number };
}

/** Bilder werden getrennt vom Projekt gehalten, damit Undo-Schritte sie nicht kopieren. */
export type ImageStore = Record<string, string>;
