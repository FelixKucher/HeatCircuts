// Heizsysteme je Heizfläche: Fußboden, Wand, Decke; Wasser oder elektrisch.

import type { SurfaceKind } from './types';

export interface HeatingSystem {
  label: string;
  short: string;
  kind: SurfaceKind;
  medium: 'water' | 'electric';
  /**
   * en1264: Kennlinienverfahren EN 1264-2 (Typ A) mit systemspezifischer Überdeckung
   * embedded: Widerstandsmodell für Rohre in Putz/Platte mit Basiskennlinie EN 1264-5
   */
  model: 'en1264' | 'embedded' | 'electric';
  /** Überdeckung über Rohr in m; 'screed' = Estrich aus Auslegung, 'milled' = Fräsüberdeckung aus Auslegung */
  cover: 'screed' | 'milled' | number;
  /** Wärmeleitfähigkeit der Lastverteil- bzw. Putzschicht; 'screed' = Estrich aus Auslegung */
  lambda: 'screed' | number;
  /** Abminderung für Trockensysteme (Wärmeleitbleche, Luftspalte) – Näherung */
  kFactor: number;
  /** systemtypisches Rohr; null = Rohr aus der Auslegung */
  pipe: string | null;
  defaultSpacing: number;
  /** Aufbauhöhe in mm (Richtwert, Fußboden ohne Belag) */
  buildHeight: number;
  note: string;
}

export const HEATING_SYSTEMS: Record<string, HeatingSystem> = {
  wet: {
    label: 'Nasssystem im Estrich (Tacker / Noppe)',
    short: 'Nass',
    kind: 'floor',
    medium: 'water',
    model: 'en1264',
    cover: 'screed',
    lambda: 'screed',
    kFactor: 1,
    pipe: null,
    defaultSpacing: 0.15,
    buildHeight: 95,
    note: 'Rohr im Heizestrich (Bauart A nach EN 1264), Neubau und Kernsanierung.',
  },
  milled: {
    label: 'Fräs-System im Bestandsestrich',
    short: 'Fräs',
    kind: 'floor',
    medium: 'water',
    model: 'en1264',
    cover: 'milled',
    lambda: 'screed',
    kFactor: 1,
    pipe: '12x1.5',
    defaultSpacing: 0.1,
    buildHeight: 0,
    note: 'Rohrnuten werden in den vorhandenen Estrich gefräst; keine zusätzliche Aufbauhöhe, geringe Überdeckung, reagiert schnell.',
  },
  dry: {
    label: 'Trockensystem mit Wärmeleitblech',
    short: 'Trocken',
    kind: 'floor',
    medium: 'water',
    model: 'en1264',
    cover: 0.025,
    lambda: 0.32,
    kFactor: 0.85,
    pipe: '14x2',
    defaultSpacing: 0.125,
    buildHeight: 50,
    note: 'Systemplatte mit Leitblechen und Trockenestrich (Bauart B) – Leistung genähert.',
  },
  electric: {
    label: 'Elektro-Heizmatte / Heizkabel',
    short: 'Elektro',
    kind: 'floor',
    medium: 'electric',
    model: 'electric',
    cover: 0.01,
    lambda: 1.0,
    kFactor: 1,
    pipe: null,
    defaultSpacing: 0,
    buildHeight: 5,
    note: 'Dünnbett-Heizmatte unter Fliesen, kein Verteiler; Anschluss über Raumthermostat (max. 16 A je Kreis).',
  },
  ceiling_wet: {
    label: 'Deckenheizung im Putz',
    short: 'Decke nass',
    kind: 'ceiling',
    medium: 'water',
    model: 'embedded',
    cover: 0.015,
    lambda: 0.7,
    kFactor: 1,
    pipe: '10x1.3',
    defaultSpacing: 0.1,
    buildHeight: 25,
    note: 'Rohrregister auf der Rohdecke, eingeputzt.',
  },
  ceiling_dry: {
    label: 'Deckenheizung Trockenbau (Gipskarton)',
    short: 'Decke trocken',
    kind: 'ceiling',
    medium: 'water',
    model: 'embedded',
    cover: 0.0125,
    lambda: 0.25,
    kFactor: 0.85,
    pipe: '10x1.3',
    defaultSpacing: 0.1,
    buildHeight: 30,
    note: 'Heiz-/Kühlelemente in abgehängter Gipskartondecke – Leistung genähert.',
  },
  wall_wet: {
    label: 'Wandheizung im Putz',
    short: 'Wand nass',
    kind: 'wall',
    medium: 'water',
    model: 'embedded',
    cover: 0.015,
    lambda: 0.7,
    kFactor: 1,
    pipe: '14x2',
    defaultSpacing: 0.1,
    buildHeight: 30,
    note: 'Rohrregister auf der Wand, eingeputzt (Kalk-, Lehm- oder Gipsputz).',
  },
  wall_dry: {
    label: 'Wandheizung Trockenbau',
    short: 'Wand trocken',
    kind: 'wall',
    medium: 'water',
    model: 'embedded',
    cover: 0.0125,
    lambda: 0.25,
    kFactor: 0.85,
    pipe: '10x1.3',
    defaultSpacing: 0.1,
    buildHeight: 30,
    note: 'Gipsfaser- oder Lehmbauplatten mit integrierten Rohren – Leistung genähert.',
  },
};

export const systemsFor = (kind: SurfaceKind): [string, HeatingSystem][] => Object.entries(HEATING_SYSTEMS).filter(([, s]) => s.kind === kind);

/** Installierbare Leistungsdichten elektrischer Heizmatten in W/m² */
export const ELECTRIC_POWERS = [100, 130, 150, 160, 200];

export const SURFACE_LABEL: Record<SurfaceKind, string> = {
  floor: 'Fußbodenheizung',
  ceiling: 'Deckenheizung',
  wall: 'Wandheizung',
};
