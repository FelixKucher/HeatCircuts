// Stammdaten: Klimadaten, Raumtypen, Bodenbeläge, Rohre, Estriche, Baustandards.
// Klimawerte sind Richtwerte zur Vorbelegung. Für die verbindliche Auslegung gelten die Werte
// des nationalen Anhangs (DE: DIN/TS 12831-1, Tabelle nach PLZ; AT: ÖNORM H 7500-1; CH: SIA 384/2).

export interface ClimateLocation {
  label: string;
  country: string;
  thetaE: number;
  thetaMeanYear: number;
  /** Lage und Höhe über NN (für die Interpolation auf der Standortkarte) */
  lat: number;
  lon: number;
  alt: number;
}

export const CLIMATE_LOCATIONS: Record<string, ClimateLocation> = {
  berlin: { label: 'Berlin', country: 'DE', thetaE: -14, thetaMeanYear: 9.5, lat: 52.52, lon: 13.4, alt: 34 },
  hamburg: { label: 'Hamburg', country: 'DE', thetaE: -12, thetaMeanYear: 9.0, lat: 53.55, lon: 9.99, alt: 11 },
  bremen: { label: 'Bremen', country: 'DE', thetaE: -12, thetaMeanYear: 9.0, lat: 53.08, lon: 8.8, alt: 5 },
  hannover: { label: 'Hannover', country: 'DE', thetaE: -14, thetaMeanYear: 9.0, lat: 52.37, lon: 9.73, alt: 55 },
  koeln: { label: 'Köln', country: 'DE', thetaE: -10, thetaMeanYear: 10.0, lat: 50.94, lon: 6.96, alt: 53 },
  duesseldorf: { label: 'Düsseldorf', country: 'DE', thetaE: -10, thetaMeanYear: 10.0, lat: 51.23, lon: 6.78, alt: 38 },
  frankfurt: { label: 'Frankfurt am Main', country: 'DE', thetaE: -12, thetaMeanYear: 10.0, lat: 50.11, lon: 8.68, alt: 112 },
  stuttgart: { label: 'Stuttgart', country: 'DE', thetaE: -12, thetaMeanYear: 9.5, lat: 48.78, lon: 9.18, alt: 245 },
  freiburg: { label: 'Freiburg', country: 'DE', thetaE: -12, thetaMeanYear: 10.5, lat: 47.99, lon: 7.85, alt: 278 },
  nuernberg: { label: 'Nürnberg', country: 'DE', thetaE: -16, thetaMeanYear: 8.5, lat: 49.45, lon: 11.08, alt: 309 },
  muenchen: { label: 'München', country: 'DE', thetaE: -16, thetaMeanYear: 8.5, lat: 48.14, lon: 11.58, alt: 519 },
  garmisch: { label: 'Garmisch-Partenkirchen', country: 'DE', thetaE: -18, thetaMeanYear: 7.0, lat: 47.49, lon: 11.1, alt: 708 },
  leipzig: { label: 'Leipzig', country: 'DE', thetaE: -14, thetaMeanYear: 9.0, lat: 51.34, lon: 12.37, alt: 113 },
  dresden: { label: 'Dresden', country: 'DE', thetaE: -14, thetaMeanYear: 9.0, lat: 51.05, lon: 13.74, alt: 113 },
  erfurt: { label: 'Erfurt', country: 'DE', thetaE: -14, thetaMeanYear: 8.5, lat: 50.98, lon: 11.03, alt: 195 },
  kiel: { label: 'Kiel', country: 'DE', thetaE: -10, thetaMeanYear: 9.0, lat: 54.32, lon: 10.14, alt: 5 },
  rostock: { label: 'Rostock', country: 'DE', thetaE: -10, thetaMeanYear: 9.0, lat: 54.09, lon: 12.1, alt: 13 },
  schwerin: { label: 'Schwerin', country: 'DE', thetaE: -12, thetaMeanYear: 8.8, lat: 53.63, lon: 11.41, alt: 38 },
  magdeburg: { label: 'Magdeburg', country: 'DE', thetaE: -14, thetaMeanYear: 9.5, lat: 52.13, lon: 11.63, alt: 55 },
  braunschweig: { label: 'Braunschweig', country: 'DE', thetaE: -14, thetaMeanYear: 9.5, lat: 52.27, lon: 10.52, alt: 75 },
  osnabrueck: { label: 'Osnabrück', country: 'DE', thetaE: -12, thetaMeanYear: 9.8, lat: 52.28, lon: 8.05, alt: 63 },
  muenster: { label: 'Münster', country: 'DE', thetaE: -10, thetaMeanYear: 10.0, lat: 51.96, lon: 7.63, alt: 60 },
  dortmund: { label: 'Dortmund', country: 'DE', thetaE: -10, thetaMeanYear: 10.0, lat: 51.51, lon: 7.47, alt: 86 },
  kassel: { label: 'Kassel', country: 'DE', thetaE: -12, thetaMeanYear: 9.0, lat: 51.31, lon: 9.48, alt: 167 },
  aachen: { label: 'Aachen', country: 'DE', thetaE: -10, thetaMeanYear: 10.0, lat: 50.78, lon: 6.08, alt: 175 },
  koblenz: { label: 'Koblenz', country: 'DE', thetaE: -10, thetaMeanYear: 10.6, lat: 50.36, lon: 7.59, alt: 65 },
  trier: { label: 'Trier', country: 'DE', thetaE: -10, thetaMeanYear: 10.0, lat: 49.75, lon: 6.64, alt: 140 },
  saarbruecken: { label: 'Saarbrücken', country: 'DE', thetaE: -12, thetaMeanYear: 9.8, lat: 49.24, lon: 6.99, alt: 230 },
  mannheim: { label: 'Mannheim', country: 'DE', thetaE: -12, thetaMeanYear: 10.8, lat: 49.49, lon: 8.47, alt: 97 },
  karlsruhe: { label: 'Karlsruhe', country: 'DE', thetaE: -12, thetaMeanYear: 11.0, lat: 49.01, lon: 8.4, alt: 115 },
  wuerzburg: { label: 'Würzburg', country: 'DE', thetaE: -12, thetaMeanYear: 10.0, lat: 49.79, lon: 9.95, alt: 177 },
  regensburg: { label: 'Regensburg', country: 'DE', thetaE: -16, thetaMeanYear: 8.8, lat: 49.01, lon: 12.1, alt: 343 },
  augsburg: { label: 'Augsburg', country: 'DE', thetaE: -14, thetaMeanYear: 8.7, lat: 48.37, lon: 10.9, alt: 494 },
  passau: { label: 'Passau', country: 'DE', thetaE: -14, thetaMeanYear: 9.0, lat: 48.57, lon: 13.43, alt: 300 },
  konstanz: { label: 'Konstanz', country: 'DE', thetaE: -12, thetaMeanYear: 9.5, lat: 47.66, lon: 9.18, alt: 405 },
  kempten: { label: 'Kempten', country: 'DE', thetaE: -16, thetaMeanYear: 7.8, lat: 47.73, lon: 10.31, alt: 674 },
  hof: { label: 'Hof', country: 'DE', thetaE: -18, thetaMeanYear: 7.5, lat: 50.31, lon: 11.92, alt: 500 },
  goerlitz: { label: 'Görlitz', country: 'DE', thetaE: -16, thetaMeanYear: 8.9, lat: 51.15, lon: 14.99, alt: 238 },
  cottbus: { label: 'Cottbus', country: 'DE', thetaE: -16, thetaMeanYear: 9.6, lat: 51.76, lon: 14.33, alt: 70 },
  wien: { label: 'Wien', country: 'AT', thetaE: -12, thetaMeanYear: 10.5, lat: 48.21, lon: 16.37, alt: 190 },
  graz: { label: 'Graz', country: 'AT', thetaE: -12, thetaMeanYear: 9.5, lat: 47.07, lon: 15.44, alt: 353 },
  linz: { label: 'Linz', country: 'AT', thetaE: -13, thetaMeanYear: 9.0, lat: 48.31, lon: 14.29, alt: 266 },
  salzburg: { label: 'Salzburg', country: 'AT', thetaE: -14, thetaMeanYear: 9.0, lat: 47.81, lon: 13.06, alt: 424 },
  innsbruck: { label: 'Innsbruck', country: 'AT', thetaE: -14, thetaMeanYear: 9.0, lat: 47.27, lon: 11.39, alt: 574 },
  zuerich: { label: 'Zürich', country: 'CH', thetaE: -8, thetaMeanYear: 9.5, lat: 47.38, lon: 8.54, alt: 408 },
  basel: { label: 'Basel', country: 'CH', thetaE: -8, thetaMeanYear: 10.5, lat: 47.56, lon: 7.59, alt: 260 },
  bern: { label: 'Bern', country: 'CH', thetaE: -10, thetaMeanYear: 9.0, lat: 46.95, lon: 7.45, alt: 540 },
  amsterdam: { label: 'Amsterdam', country: 'NL', thetaE: -10, thetaMeanYear: 10.5, lat: 52.37, lon: 4.9, alt: 0 },
  bruessel: { label: 'Brüssel', country: 'BE', thetaE: -8, thetaMeanYear: 10.5, lat: 50.85, lon: 4.35, alt: 13 },
  luxemburg: { label: 'Luxemburg', country: 'LU', thetaE: -10, thetaMeanYear: 9.5, lat: 49.61, lon: 6.13, alt: 300 },
  paris: { label: 'Paris', country: 'FR', thetaE: -7, thetaMeanYear: 12.0, lat: 48.86, lon: 2.35, alt: 35 },
  strasbourg: { label: 'Straßburg', country: 'FR', thetaE: -15, thetaMeanYear: 10.5, lat: 48.57, lon: 7.75, alt: 142 },
  kopenhagen: { label: 'Kopenhagen', country: 'DK', thetaE: -12, thetaMeanYear: 9.0, lat: 55.68, lon: 12.57, alt: 5 },
  stockholm: { label: 'Stockholm', country: 'SE', thetaE: -18, thetaMeanYear: 7.5, lat: 59.33, lon: 18.07, alt: 28 },
  oslo: { label: 'Oslo', country: 'NO', thetaE: -20, thetaMeanYear: 6.0, lat: 59.91, lon: 10.75, alt: 23 },
  helsinki: { label: 'Helsinki', country: 'FI', thetaE: -26, thetaMeanYear: 6.0, lat: 60.17, lon: 24.94, alt: 17 },
  warschau: { label: 'Warschau', country: 'PL', thetaE: -20, thetaMeanYear: 8.5, lat: 52.23, lon: 21.01, alt: 100 },
  prag: { label: 'Prag', country: 'CZ', thetaE: -12, thetaMeanYear: 9.0, lat: 50.08, lon: 14.44, alt: 235 },
  budapest: { label: 'Budapest', country: 'HU', thetaE: -13, thetaMeanYear: 11.0, lat: 47.5, lon: 19.04, alt: 105 },
  bozen: { label: 'Bozen', country: 'IT', thetaE: -10, thetaMeanYear: 12.5, lat: 46.5, lon: 11.35, alt: 262 },
  mailand: { label: 'Mailand', country: 'IT', thetaE: -5, thetaMeanYear: 13.5, lat: 45.46, lon: 9.19, alt: 120 },
  madrid: { label: 'Madrid', country: 'ES', thetaE: -3, thetaMeanYear: 15.0, lat: 40.42, lon: -3.7, alt: 657 },
  london: { label: 'London', country: 'GB', thetaE: -3, thetaMeanYear: 11.5, lat: 51.51, lon: -0.13, alt: 11 },
  dublin: { label: 'Dublin', country: 'IE', thetaE: -3, thetaMeanYear: 10.0, lat: 53.35, lon: -6.26, alt: 8 },
};

export interface RoomType {
  label: string;
  thetaI: number;
  airChange: number;
  spacing: number;
  covering: string;
  heated: boolean;
  /** Temperatur-Korrekturfaktor b_u, wenn der Raum unbeheizt an beheizte Räume grenzt */
  bU?: number;
}

// θ_int nach DIN/TS 12831-1 (Wohngebäude); n_min nach EN 12831 (Tab. D.5a).
export const ROOM_TYPES: Record<string, RoomType> = {
  wohnen: { label: 'Wohnzimmer', thetaI: 20, airChange: 0.5, spacing: 0.15, covering: 'parkett_klebe', heated: true },
  essen: { label: 'Essbereich', thetaI: 20, airChange: 0.5, spacing: 0.15, covering: 'parkett_klebe', heated: true },
  kueche: { label: 'Küche', thetaI: 20, airChange: 1.5, spacing: 0.15, covering: 'fliesen', heated: true },
  schlafen: { label: 'Schlafzimmer', thetaI: 20, airChange: 0.5, spacing: 0.15, covering: 'parkett_klebe', heated: true },
  kind: { label: 'Kinderzimmer', thetaI: 20, airChange: 0.5, spacing: 0.15, covering: 'parkett_klebe', heated: true },
  buero: { label: 'Arbeitszimmer', thetaI: 20, airChange: 0.5, spacing: 0.15, covering: 'parkett_klebe', heated: true },
  bad: { label: 'Bad', thetaI: 24, airChange: 1.5, spacing: 0.1, covering: 'fliesen', heated: true },
  dusche: { label: 'Duschbad', thetaI: 24, airChange: 1.5, spacing: 0.1, covering: 'fliesen', heated: true },
  wc: { label: 'WC', thetaI: 20, airChange: 1.5, spacing: 0.1, covering: 'fliesen', heated: true },
  flur: { label: 'Flur / Diele', thetaI: 15, airChange: 0.5, spacing: 0.2, covering: 'fliesen', heated: true },
  treppe: { label: 'Treppenraum', thetaI: 15, airChange: 0.5, spacing: 0.2, covering: 'fliesen', heated: true },
  hwr: { label: 'Hauswirtschaftsraum', thetaI: 15, airChange: 0.5, spacing: 0.2, covering: 'fliesen', heated: true },
  abstell: { label: 'Abstellraum', thetaI: 15, airChange: 0.5, spacing: 0.2, covering: 'fliesen', heated: false, bU: 0.3 },
  technik: { label: 'Technikraum', thetaI: 15, airChange: 0.5, spacing: 0.2, covering: 'none', heated: false, bU: 0.3 },
  garage: { label: 'Garage (im Haus)', thetaI: 5, airChange: 0, spacing: 0.2, covering: 'none', heated: false, bU: 0.8 },
  keller: { label: 'Keller unbeheizt', thetaI: 10, airChange: 0, spacing: 0.2, covering: 'none', heated: false, bU: 0.5 },
  dachboden: { label: 'Dachboden unbeheizt', thetaI: 0, airChange: 0, spacing: 0.2, covering: 'none', heated: false, bU: 0.9 },
  galerie: { label: 'Galerie / Luftraum', thetaI: 20, airChange: 0.5, spacing: 0.15, covering: 'parkett_klebe', heated: true },
  sonstiges: { label: 'Sonstiger Raum', thetaI: 20, airChange: 0.5, spacing: 0.15, covering: 'fliesen', heated: true },
};

export interface Covering {
  label: string;
  rLambdaB: number;
}

// R_λ,B Richtwerte; EN 1264 begrenzt auf 0,15 m²K/W.
export const COVERINGS: Record<string, Covering> = {
  none: { label: 'ohne Belag (Estrich)', rLambdaB: 0.0 },
  naturstein: { label: 'Naturstein (20 mm)', rLambdaB: 0.01 },
  fliesen: { label: 'Fliesen / Feinsteinzeug', rLambdaB: 0.02 },
  vinyl: { label: 'Vinyl / Designbelag (verklebt)', rLambdaB: 0.02 },
  linoleum: { label: 'Linoleum', rLambdaB: 0.03 },
  laminat: { label: 'Laminat inkl. Trittschalldämmung', rLambdaB: 0.07 },
  parkett_klebe: { label: 'Parkett verklebt (10–14 mm)', rLambdaB: 0.07 },
  parkett_schwimmend: { label: 'Parkett schwimmend', rLambdaB: 0.10 },
  teppich: { label: 'Teppich (für FBH geeignet)', rLambdaB: 0.10 },
  teppich_dick: { label: 'Teppich dick', rLambdaB: 0.15 },
};

export interface Pipe {
  label: string;
  /** Außendurchmesser in m */
  outer: number;
  /** Innendurchmesser in m */
  inner: number;
  maxLength: number;
}

/** Mindestbiegeradius (kalt gebogen) als Vielfaches des Außendurchmessers */
export const BEND_RADIUS_FACTOR = 5;

export const PIPES: Record<string, Pipe> = {
  '10x1.3': { label: 'PE-RT 10 × 1,3 (Wand/Decke)', outer: 0.01, inner: 0.0074, maxLength: 60 },
  '12x1.5': { label: 'PE-RT 12 × 1,5 (Fräs-/Dünnschicht)', outer: 0.012, inner: 0.009, maxLength: 80 },
  '14x2': { label: 'PE-Xa / PE-RT 14 × 2,0', outer: 0.014, inner: 0.010, maxLength: 80 },
  '16x2': { label: 'PE-Xa / PE-RT 16 × 2,0', outer: 0.016, inner: 0.012, maxLength: 100 },
  '17x2': { label: 'PE-Xa / PE-RT 17 × 2,0', outer: 0.017, inner: 0.013, maxLength: 120 },
  '20x2': { label: 'PE-Xa / PE-RT 20 × 2,0', outer: 0.020, inner: 0.016, maxLength: 120 },
};

export interface Screed {
  label: string;
  lambda: number;
}

export const SCREEDS: Record<string, Screed> = {
  CT: { label: 'Zementestrich CT', lambda: 1.2 },
  CAF: { label: 'Calciumsulfat-Fließestrich CAF', lambda: 1.6 },
};

/** Verbundrohr-Dimensionen für die Anbindung Verteiler ↔ Wärmeerzeuger */
export const SUPPLY_PIPES: { label: string; inner: number }[] = [
  { label: 'MSVR 16 × 2,0', inner: 0.012 },
  { label: 'MSVR 20 × 2,0', inner: 0.016 },
  { label: 'MSVR 26 × 3,0', inner: 0.020 },
  { label: 'MSVR 32 × 3,0', inner: 0.026 },
  { label: 'MSVR 40 × 3,5', inner: 0.033 },
  { label: 'MSVR 50 × 4,0', inner: 0.042 },
];

export interface BuildingStandard {
  label: string;
  uExtWall: number;
  uWindow: number;
  uRoof: number;
  uGroundFloor: number;
  uUnheatedSlab: number;
  uUnheatedWall: number;
  deltaUTB: number;
}

export const BUILDING_STANDARDS: Record<string, BuildingStandard> = {
  altbau: { label: 'Altbau bis 1977, unsaniert', uExtWall: 1.4, uWindow: 2.8, uRoof: 0.9, uGroundFloor: 1.2, uUnheatedSlab: 1.0, uUnheatedWall: 1.5, deltaUTB: 0.10 },
  wsvo84: { label: 'WSchVO 1984 (1984–1994)', uExtWall: 0.6, uWindow: 2.6, uRoof: 0.45, uGroundFloor: 0.6, uUnheatedSlab: 0.6, uUnheatedWall: 0.8, deltaUTB: 0.10 },
  wsvo95: { label: 'WSchVO 1995 (1995–2001)', uExtWall: 0.5, uWindow: 1.6, uRoof: 0.3, uGroundFloor: 0.5, uUnheatedSlab: 0.5, uUnheatedWall: 0.6, deltaUTB: 0.10 },
  enev: { label: 'EnEV 2009/2014', uExtWall: 0.28, uWindow: 1.3, uRoof: 0.20, uGroundFloor: 0.35, uUnheatedSlab: 0.35, uUnheatedWall: 0.35, deltaUTB: 0.05 },
  geg: { label: 'GEG 2024 / Effizienzhaus 55', uExtWall: 0.20, uWindow: 1.0, uRoof: 0.14, uGroundFloor: 0.25, uUnheatedSlab: 0.25, uUnheatedWall: 0.30, deltaUTB: 0.05 },
  passiv: { label: 'Passivhaus', uExtWall: 0.12, uWindow: 0.8, uRoof: 0.10, uGroundFloor: 0.12, uUnheatedSlab: 0.15, uUnheatedWall: 0.15, deltaUTB: 0.0 },
};

export const HEAT_SOURCE_TYPES: Record<string, string> = {
  wp_luft: 'Luft/Wasser-Wärmepumpe',
  wp_sole: 'Sole/Wasser-Wärmepumpe',
  gas: 'Gas-Brennwertkessel',
  oel: 'Öl-Brennwertkessel',
  pellet: 'Pelletkessel',
  fernwaerme: 'Fernwärme-Übergabestation',
  speicher: 'Pufferspeicher',
  sonstige: 'Sonstiger Wärmeerzeuger',
};

export const WALL_PRESETS: { kind: 'exterior' | 'interior' | 'unheated'; thickness: number; label: string }[] = [
  { kind: 'exterior', thickness: 0.365, label: 'Außenwand 36,5 cm' },
  { kind: 'exterior', thickness: 0.30, label: 'Außenwand 30 cm' },
  { kind: 'exterior', thickness: 0.24, label: 'Außenwand 24 cm' },
  { kind: 'interior', thickness: 0.175, label: 'Innenwand 17,5 cm' },
  { kind: 'interior', thickness: 0.115, label: 'Innenwand 11,5 cm' },
  { kind: 'unheated', thickness: 0.24, label: 'Wand zu unbeheizt 24 cm' },
];

/** alle wählbaren Verlegeabstände in m */
export const SPACINGS = [0.05, 0.075, 0.1, 0.125, 0.15, 0.175, 0.2, 0.25, 0.3];
/** Standard der automatischen Auslegung */
export const DEFAULT_ALLOWED_SPACINGS = [0.075, 0.1, 0.125, 0.15, 0.175, 0.2];

/** Grenzwerte der Oberflächentemperatur: Fußboden nach EN 1264-2, Wand und Decke als Behaglichkeits-Richtwerte */
export const SURFACE_LIMITS = {
  occupied: 29,
  bathroom: 33,
  edge: 35,
  wall: 35,
  ceiling: 30,
};

export const BATHROOM_TYPES = new Set(['bad', 'dusche']);
