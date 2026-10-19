import type { DesignParams, Project } from './types';
import { PIPES, ROOM_TYPES, SURFACE_LIMITS } from './catalog';
import { num } from '../ui/format';

/**
 * Normwerte und Annahmen: Wo ein Wert schwer zu beschaffen ist, setzt HeatCircuits den europäischen
 * Standard (EN 12831-1, EN 1264, EN ISO 6946/13370) bzw. die gängige Herstellerpraxis als Vorgabe.
 * Jeder Eintrag nennt Quelle und Verbindlichkeit, damit Bericht und Oberfläche ihn ausweisen können.
 */
export type NormStatus = 'norm' | 'national' | 'praxis' | 'annahme';

export const NORM_STATUS: Record<NormStatus, { label: string; note: string }> = {
  norm: { label: 'Norm', note: 'normativer Wert bzw. normatives Verfahren' },
  national: { label: 'Norm (national)', note: 'Wert aus nationalem Anhang bzw. informativem Normanhang' },
  praxis: { label: 'Praxiswert', note: 'übliche Herstellerangabe, in der Norm nicht festgelegt' },
  annahme: { label: 'Annahme', note: 'plausible Vorgabe, im Einzelfall prüfen' },
};

export interface NormRow {
  group: 'Heizlast' | 'Bauteile' | 'Flächenheizung' | 'Hydraulik';
  label: string;
  value: string;
  source: string;
  status: NormStatus;
}

/** Vorgaben der Auslegung nach europäischer Praxis (für „Normwerte setzen“) */
export function normDesignDefaults(d: DesignParams): Partial<DesignParams> {
  return {
    maxPressureDrop: 25000,
    maxCircuitLength: PIPES[d.pipe]?.maxLength ?? 100,
    sigmaDesign: 5,
    wallDistance: 0.1,
    screedCover: 0.045,
  };
}

/** Kurzer Quellhinweis für Eingabefelder der Auslegung */
export const NORM_HINTS: Record<string, string> = {
  maxPressureDrop: 'Standard 250 mbar je Kreis inkl. Anbindung · Herstellerpraxis',
  maxCircuitLength: 'Standard je Rohr (16 × 2: 100 m) · Herstellerpraxis',
  sigmaDesign: 'EN 1264-3: σ ≤ 5 K im Auslegungsraum',
  screedCover: 'DIN 18560-2: ≥ 45 mm über Rohr (CT, Bauart A)',
  wallDistance: 'Praxis: 5–10 cm zur Wand',
};

export function normRows(p: Project): NormRow[] {
  const d = p.design;
  const pipe = PIPES[d.pipe];
  const rt = (k: string) => ROOM_TYPES[k];
  const rows: NormRow[] = [
    { group: 'Heizlast', label: 'Verfahren Norm-Heizlast', value: 'vereinfacht, raumweise', source: 'EN 12831-1:2017', status: 'norm' },
    { group: 'Heizlast', label: 'Norm-Außentemperatur θe', value: `${num(p.building.thetaE, 1)} °C`, source: 'nationale Klimadaten (DE: DIN/TS 12831-1), Stationen interpoliert, −0,5 K je 100 m Höhe', status: 'national' },
    { group: 'Heizlast', label: 'Jahresmitteltemperatur θm,e', value: `${num(p.building.thetaMeanYear, 1)} °C`, source: 'nationale Klimadaten, für Erdreich nach EN ISO 13370', status: 'national' },
    { group: 'Heizlast', label: 'Innentemperatur Wohnen / Bad / Flur', value: `${rt('wohnen').thetaI} / ${rt('bad').thetaI} / ${rt('flur').thetaI} °C`, source: 'EN 12831-1 Anhang B (informativ), DIN/TS 12831-1', status: 'national' },
    { group: 'Heizlast', label: 'Mindestluftwechsel Wohnräume', value: `${num(rt('wohnen').airChange, 1)} 1/h`, source: 'EN 12831-1 Anhang B (informativ)', status: 'national' },
    { group: 'Heizlast', label: 'Mindestluftwechsel Küche / Bad', value: `${num(rt('kueche').airChange, 1)} 1/h`, source: 'EN 12831:2003 Tab. D.5.1 (Räume mit Fenster); EN 12831-1:2017 nennt teils 0,5 1/h', status: 'annahme' },
    { group: 'Heizlast', label: 'Temperatur beheizter Nachbarn', value: `${num(p.site.neighbourTemp, 1)} °C`, source: 'EN 12831-1 Anhang D bzw. nationaler Anhang', status: 'annahme' },
    { group: 'Heizlast', label: 'Temperaturfaktor unbeheizter Räume b_u', value: `Abstell/Technik ${num(rt('abstell').bU ?? 0, 1)}, Keller ${num(rt('keller').bU ?? 0, 1)}, Garage ${num(rt('garage').bU ?? 0, 1)}, Dachraum ${num(rt('dachboden').bU ?? 0, 1)}`, source: 'EN 12831-1 Abs. 6.3.2.4 / Anhang B, national festzulegen', status: 'annahme' },
    { group: 'Heizlast', label: 'Wärmebrückenzuschlag ΔU_WB', value: `${num(p.building.deltaUTB, 2)} W/(m²·K)`, source: 'EN 12831-1 Anhang B, DIN 4108 Bbl. 2 (nach Baualter)', status: 'national' },
    { group: 'Bauteile', label: 'U-Werte der Bauteile', value: 'aus Schichtaufbau', source: 'EN ISO 6946 (R_si/R_se je Wärmestromrichtung)', status: 'norm' },
    { group: 'Bauteile', label: 'Wärmeverlust über das Erdreich', value: 'U_equiv mit B′ und Wandeinbindetiefe', source: 'EN ISO 13370', status: 'norm' },
    { group: 'Flächenheizung', label: 'Auslegungsverfahren', value: 'Kennlinien, Grenzkurven', source: 'EN 1264-2 / EN 1264-3', status: 'norm' },
    { group: 'Flächenheizung', label: 'max. Oberflächentemperatur Aufenthaltszone', value: `${SURFACE_LIMITS.occupied} °C`, source: 'EN 1264-2/-3 (θi + 9 K bei 20 °C)', status: 'norm' },
    { group: 'Flächenheizung', label: 'max. Oberflächentemperatur Bad', value: `${SURFACE_LIMITS.bathroom} °C`, source: 'EN 1264-2/-3 (θi + 9 K bei 24 °C)', status: 'norm' },
    { group: 'Flächenheizung', label: 'max. Oberflächentemperatur Randzone', value: `${SURFACE_LIMITS.edge} °C`, source: 'EN 1264-2/-3 (Randzone ≤ 1 m)', status: 'norm' },
    { group: 'Flächenheizung', label: 'Oberflächentemperatur Wand / Decke', value: `${SURFACE_LIMITS.wall} / ${SURFACE_LIMITS.ceiling} °C`, source: 'Behaglichkeitsrichtwert (Strahlungsasymmetrie nach EN ISO 7730)', status: 'praxis' },
    { group: 'Flächenheizung', label: 'Spreizung σ im Auslegungsraum', value: `${num(d.sigmaDesign, 1)} K`, source: 'EN 1264-3: σ ≤ 5 K', status: 'norm' },
    { group: 'Flächenheizung', label: 'Rohrüberdeckung Nassestrich', value: `${num(d.screedCover * 1000, 0)} mm`, source: 'DIN 18560-2 / EN 13813 (CT ≥ 45 mm)', status: 'national' },
    { group: 'Flächenheizung', label: 'Randabstand Heizrohr', value: `${num(d.wallDistance * 100, 0)} cm`, source: 'Herstellerpraxis', status: 'praxis' },
    { group: 'Hydraulik', label: 'max. Druckverlust je Heizkreis', value: `${num(d.maxPressureDrop / 100, 0)} mbar`, source: 'Herstellerpraxis (z. B. Uponor: 250 mbar inkl. Anbindung); EN 1264 legt keinen Wert fest', status: 'praxis' },
    { group: 'Hydraulik', label: 'max. Heizkreislänge', value: `${num(d.maxCircuitLength, 0)} m (${pipe?.label ?? d.pipe})`, source: 'Herstellerpraxis je Rohrdimension', status: 'praxis' },
    { group: 'Hydraulik', label: 'Rohrreibung', value: 'Darcy-Weisbach, λ = 64/Re bzw. Blasius (hydraulisch glatt)', source: 'Stoffwerte Wasser 35 °C: ρ = 994 kg/m³, ν = 0,72 mm²/s', status: 'praxis' },
    { group: 'Hydraulik', label: 'Spezifische Wärmekapazität Wasser', value: '1,163 Wh/(kg·K)', source: 'EN 1264-3 (c_W = 4187 J/(kg·K))', status: 'norm' },
  ];
  return rows;
}
