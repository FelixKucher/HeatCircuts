// Stammdaten: Klimadaten, Raumtypen, Bodenbeläge, Rohre, Estriche, Baustandards.
// Klimawerte sind Richtwerte zur Vorbelegung. Für die verbindliche Auslegung gelten die Werte
// des nationalen Anhangs (DE: DIN/TS 12831-1, Tabelle nach PLZ; AT: ÖNORM H 7500-1; CH: SIA 384/2).

export interface ClimateLocation {
  label: string;
  country: string;
  thetaE: number;
  thetaMeanYear: number;
}

export const CLIMATE_LOCATIONS: Record<string, ClimateLocation> = {
  berlin: { label: 'Berlin', country: 'DE', thetaE: -14, thetaMeanYear: 9.5 },
  hamburg: { label: 'Hamburg', country: 'DE', thetaE: -12, thetaMeanYear: 9.0 },
  bremen: { label: 'Bremen', country: 'DE', thetaE: -12, thetaMeanYear: 9.0 },
  hannover: { label: 'Hannover', country: 'DE', thetaE: -14, thetaMeanYear: 9.0 },
  koeln: { label: 'Köln', country: 'DE', thetaE: -10, thetaMeanYear: 10.0 },
  duesseldorf: { label: 'Düsseldorf', country: 'DE', thetaE: -10, thetaMeanYear: 10.0 },
  frankfurt: { label: 'Frankfurt am Main', country: 'DE', thetaE: -12, thetaMeanYear: 10.0 },
  stuttgart: { label: 'Stuttgart', country: 'DE', thetaE: -12, thetaMeanYear: 9.5 },
  freiburg: { label: 'Freiburg', country: 'DE', thetaE: -12, thetaMeanYear: 10.5 },
  nuernberg: { label: 'Nürnberg', country: 'DE', thetaE: -16, thetaMeanYear: 8.5 },
  muenchen: { label: 'München', country: 'DE', thetaE: -16, thetaMeanYear: 8.5 },
  garmisch: { label: 'Garmisch-Partenkirchen', country: 'DE', thetaE: -18, thetaMeanYear: 7.0 },
  leipzig: { label: 'Leipzig', country: 'DE', thetaE: -14, thetaMeanYear: 9.0 },
  dresden: { label: 'Dresden', country: 'DE', thetaE: -14, thetaMeanYear: 9.0 },
  erfurt: { label: 'Erfurt', country: 'DE', thetaE: -14, thetaMeanYear: 8.5 },
  wien: { label: 'Wien', country: 'AT', thetaE: -12, thetaMeanYear: 10.5 },
  graz: { label: 'Graz', country: 'AT', thetaE: -12, thetaMeanYear: 9.5 },
  linz: { label: 'Linz', country: 'AT', thetaE: -13, thetaMeanYear: 9.0 },
  salzburg: { label: 'Salzburg', country: 'AT', thetaE: -14, thetaMeanYear: 9.0 },
  innsbruck: { label: 'Innsbruck', country: 'AT', thetaE: -14, thetaMeanYear: 9.0 },
  zuerich: { label: 'Zürich', country: 'CH', thetaE: -8, thetaMeanYear: 9.5 },
  basel: { label: 'Basel', country: 'CH', thetaE: -8, thetaMeanYear: 10.5 },
  bern: { label: 'Bern', country: 'CH', thetaE: -10, thetaMeanYear: 9.0 },
  amsterdam: { label: 'Amsterdam', country: 'NL', thetaE: -10, thetaMeanYear: 10.5 },
  bruessel: { label: 'Brüssel', country: 'BE', thetaE: -8, thetaMeanYear: 10.5 },
  luxemburg: { label: 'Luxemburg', country: 'LU', thetaE: -10, thetaMeanYear: 9.5 },
  paris: { label: 'Paris', country: 'FR', thetaE: -7, thetaMeanYear: 12.0 },
  strasbourg: { label: 'Straßburg', country: 'FR', thetaE: -15, thetaMeanYear: 10.5 },
  kopenhagen: { label: 'Kopenhagen', country: 'DK', thetaE: -12, thetaMeanYear: 9.0 },
  stockholm: { label: 'Stockholm', country: 'SE', thetaE: -18, thetaMeanYear: 7.5 },
  oslo: { label: 'Oslo', country: 'NO', thetaE: -20, thetaMeanYear: 6.0 },
  helsinki: { label: 'Helsinki', country: 'FI', thetaE: -26, thetaMeanYear: 6.0 },
  warschau: { label: 'Warschau', country: 'PL', thetaE: -20, thetaMeanYear: 8.5 },
  prag: { label: 'Prag', country: 'CZ', thetaE: -12, thetaMeanYear: 9.0 },
  budapest: { label: 'Budapest', country: 'HU', thetaE: -13, thetaMeanYear: 11.0 },
  bozen: { label: 'Bozen', country: 'IT', thetaE: -10, thetaMeanYear: 12.5 },
  mailand: { label: 'Mailand', country: 'IT', thetaE: -5, thetaMeanYear: 13.5 },
  madrid: { label: 'Madrid', country: 'ES', thetaE: -3, thetaMeanYear: 15.0 },
  london: { label: 'London', country: 'GB', thetaE: -3, thetaMeanYear: 11.5 },
  dublin: { label: 'Dublin', country: 'IE', thetaE: -3, thetaMeanYear: 10.0 },
};

export interface RoomType {
  label: string;
  thetaI: number;
  airChange: number;
  spacing: number;
  covering: string;
  heated: boolean;
}

// θ_int nach DIN/TS 12831-1 (Wohngebäude); n_min nach EN 12831 (Tab. D.5a).
export const ROOM_TYPES: Record<string, RoomType> = {
  wohnen: { label: 'Wohnzimmer', thetaI: 20, airChange: 0.5, spacing: 0.15, covering: 'parkett_klebe', heated: true },
  essen: { label: 'Essbereich', thetaI: 20, airChange: 0.5, spacing: 0.15, covering: 'parkett_klebe', heated: true },
  kueche: { label: 'Küche', thetaI: 20, airChange: 1.5, spacing: 0.15, covering: 'fliesen', heated: true },
  schlafen: { label: 'Schlafzimmer', thetaI: 20, airChange: 0.5, spacing: 0.15, covering: 'parkett_klebe', heated: true },
  kind: { label: 'Kinderzimmer', thetaI: 20, airChange: 0.5, spacing: 0.15, covering: 'parkett_klebe', heated: true },
  buero: { label: 'Arbeitszimmer', thetaI: 20, airChange: 0.5, spacing: 0.15, covering: 'parkett_klebe', heated: true },
  bad: { label: 'Bad', thetaI: 24, airChange: 1.5, spacing: 0.10, covering: 'fliesen', heated: true },
  dusche: { label: 'Duschbad', thetaI: 24, airChange: 1.5, spacing: 0.10, covering: 'fliesen', heated: true },
  wc: { label: 'WC', thetaI: 20, airChange: 1.5, spacing: 0.10, covering: 'fliesen', heated: true },
  flur: { label: 'Flur / Diele', thetaI: 15, airChange: 0.5, spacing: 0.20, covering: 'fliesen', heated: true },
  treppe: { label: 'Treppenraum', thetaI: 15, airChange: 0.5, spacing: 0.20, covering: 'fliesen', heated: true },
  hwr: { label: 'Hauswirtschaftsraum', thetaI: 15, airChange: 0.5, spacing: 0.20, covering: 'fliesen', heated: true },
  abstell: { label: 'Abstellraum', thetaI: 15, airChange: 0.5, spacing: 0.25, covering: 'fliesen', heated: false },
  technik: { label: 'Technikraum', thetaI: 15, airChange: 0.5, spacing: 0.25, covering: 'none', heated: false },
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

export const PIPES: Record<string, Pipe> = {
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

export const SPACINGS = [0.05, 0.075, 0.10, 0.125, 0.15, 0.20, 0.25, 0.30];

/** Grenzwerte der Fußbodenoberflächentemperatur nach EN 1264-2 */
export const SURFACE_LIMITS = {
  occupied: 29,
  bathroom: 33,
  edge: 35,
};

export const BATHROOM_TYPES = new Set(['bad', 'dusche']);
