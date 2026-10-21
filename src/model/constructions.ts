// Bauteilkatalog: Baustoffe, Schichtaufbauten und U-Werte nach EN ISO 6946,
// Baualtersklassen (Richtwerte in Anlehnung an die deutsche Gebäudetypologie IWU/TABULA).

import type { Construction, ConstructionSlot, Layer } from './types';

export interface Material {
  label: string;
  /** Bemessungswert der Wärmeleitfähigkeit λ in W/(m·K) */
  lambda: number;
  group: 'masonry' | 'concrete' | 'insulation' | 'plaster' | 'wood' | 'screed' | 'board' | 'other';
}

export const MATERIALS: Record<string, Material> = {
  putz_kz: { label: 'Kalkzementputz', lambda: 0.87, group: 'plaster' },
  putz_gips: { label: 'Gipsputz', lambda: 0.51, group: 'plaster' },
  putz_leicht: { label: 'Leichtputz / Dämmputz', lambda: 0.31, group: 'plaster' },
  vollziegel: { label: 'Vollziegel (1800 kg/m³)', lambda: 0.68, group: 'masonry' },
  bims: { label: 'Hohlblock Bims / Leichtbeton', lambda: 0.45, group: 'masonry' },
  hlz_alt: { label: 'Hochlochziegel (vor 1979)', lambda: 0.39, group: 'masonry' },
  hlz_1979: { label: 'Hochlochziegel (1979–1983)', lambda: 0.33, group: 'masonry' },
  hlz_1984: { label: 'Hochlochziegel porosiert (1984–1994)', lambda: 0.24, group: 'masonry' },
  plz_016: { label: 'Planziegel λ 0,16', lambda: 0.16, group: 'masonry' },
  plz_012: { label: 'Planziegel λ 0,12', lambda: 0.12, group: 'masonry' },
  plz_009: { label: 'Planziegel λ 0,09', lambda: 0.09, group: 'masonry' },
  plz_008: { label: 'Planziegel gefüllt λ 0,08', lambda: 0.08, group: 'masonry' },
  kalksandstein: { label: 'Kalksandstein (1800 kg/m³)', lambda: 0.99, group: 'masonry' },
  porenbeton: { label: 'Porenbeton PP2', lambda: 0.09, group: 'masonry' },
  naturstein: { label: 'Naturstein', lambda: 2.3, group: 'masonry' },
  beton: { label: 'Stahlbeton', lambda: 2.3, group: 'concrete' },
  mineralwolle: { label: 'Mineralwolle 035', lambda: 0.035, group: 'insulation' },
  mineralwolle_040: { label: 'Mineralwolle 040', lambda: 0.04, group: 'insulation' },
  eps: { label: 'EPS 035', lambda: 0.035, group: 'insulation' },
  eps_grau: { label: 'EPS 032 (grau)', lambda: 0.032, group: 'insulation' },
  xps: { label: 'XPS 035', lambda: 0.035, group: 'insulation' },
  pur: { label: 'PUR/PIR 024', lambda: 0.024, group: 'insulation' },
  holzfaser: { label: 'Holzfaser 040', lambda: 0.04, group: 'insulation' },
  holzfaser_045: { label: 'Holzfaser 045 (druckfest)', lambda: 0.045, group: 'insulation' },
  zellulose: { label: 'Zellulose 040', lambda: 0.04, group: 'insulation' },
  holzwolle: { label: 'Holzwolle-Leichtbauplatte', lambda: 0.09, group: 'insulation' },
  trittschall: { label: 'Trittschalldämmung 040', lambda: 0.04, group: 'insulation' },
  holz: { label: 'Nadelholz', lambda: 0.13, group: 'wood' },
  osb: { label: 'OSB-Platte', lambda: 0.13, group: 'wood' },
  dielen: { label: 'Holzdielen', lambda: 0.13, group: 'wood' },
  lehm: { label: 'Lehmschlag / Lehmwickel', lambda: 0.9, group: 'other' },
  gipskarton: { label: 'Gipskarton', lambda: 0.25, group: 'board' },
  gipsfaser: { label: 'Gipsfaser', lambda: 0.32, group: 'board' },
  estrich_ct: { label: 'Zementestrich', lambda: 1.4, group: 'screed' },
  estrich_ca: { label: 'Calciumsulfatestrich', lambda: 1.2, group: 'screed' },
  bitumen: { label: 'Bitumenbahn', lambda: 0.17, group: 'other' },
};

/** Wärmeübergangswiderstände R_si / R_se in m²K/W nach EN ISO 6946 */
export const SURFACE_RESISTANCE: Record<ConstructionSlot, { rsi: number; rse: number; label: string }> = {
  extWall: { rsi: 0.13, rse: 0.04, label: 'Außenwand' },
  roof: { rsi: 0.1, rse: 0.04, label: 'Dach (Dämmung in der Dachfläche)' },
  topSlab: { rsi: 0.1, rse: 0.1, label: 'Oberste Geschossdecke zum Dachraum' },
  groundSlab: { rsi: 0.17, rse: 0, label: 'Bodenplatte gegen Erdreich' },
  basementSlab: { rsi: 0.17, rse: 0.17, label: 'Kellerdecke zu unbeheizt' },
  unheatedWall: { rsi: 0.13, rse: 0.13, label: 'Wand zu unbeheizt (z. B. Garage)' },
};

export interface ConstructionTemplate {
  label: string;
  slot: ConstructionSlot;
  /** Schichten von innen nach außen */
  layers: Layer[];
}

const L = (material: string, cm: number): Layer => ({ material, thickness: cm / 100 });

export const CONSTRUCTION_TEMPLATES: Record<string, ConstructionTemplate> = {
  // Außenwände
  aw_vollziegel_38: { label: 'Vollziegel 38 cm, verputzt (bis 1918)', slot: 'extWall', layers: [L('putz_kz', 1.5), L('vollziegel', 38), L('putz_kz', 2)] },
  aw_vollziegel_25: { label: 'Vollziegel 25 cm, verputzt (1919–1948)', slot: 'extWall', layers: [L('putz_kz', 1.5), L('vollziegel', 25), L('putz_kz', 2)] },
  aw_bims_30: { label: 'Hohlblock Bims 30 cm (1949–1968)', slot: 'extWall', layers: [L('putz_kz', 1.5), L('bims', 30), L('putz_kz', 2)] },
  aw_hlz_30: { label: 'Hochlochziegel 30 cm (1969–1978)', slot: 'extWall', layers: [L('putz_kz', 1.5), L('hlz_alt', 30), L('putz_kz', 2)] },
  aw_hlz_30_79: { label: 'Hochlochziegel 30 cm (1979–1983)', slot: 'extWall', layers: [L('putz_kz', 1.5), L('hlz_1979', 30), L('putz_leicht', 2)] },
  aw_hlz_365_84: { label: 'Porosierter Ziegel 36,5 cm (1984–1994)', slot: 'extWall', layers: [L('putz_gips', 1.5), L('hlz_1984', 36.5), L('putz_leicht', 2)] },
  aw_plz_365_016: { label: 'Planziegel 36,5 cm λ 0,16 (1995–2001)', slot: 'extWall', layers: [L('putz_gips', 1.5), L('plz_016', 36.5), L('putz_leicht', 2)] },
  aw_plz_365_012: { label: 'Planziegel 36,5 cm λ 0,12 (2002–2008)', slot: 'extWall', layers: [L('putz_gips', 1.5), L('plz_012', 36.5), L('putz_leicht', 2)] },
  aw_plz_365_009: { label: 'Planziegel 36,5 cm λ 0,09 (2009–2015)', slot: 'extWall', layers: [L('putz_gips', 1.5), L('plz_009', 36.5), L('putz_leicht', 2)] },
  aw_plz_425_008: { label: 'Planziegel gefüllt 42,5 cm λ 0,08 (ab 2016)', slot: 'extWall', layers: [L('putz_gips', 1.5), L('plz_008', 42.5), L('putz_leicht', 2)] },
  aw_ks_wdvs: { label: 'Kalksandstein 17,5 cm + WDVS EPS', slot: 'extWall', layers: [L('putz_gips', 1.5), L('kalksandstein', 17.5), L('eps_grau', 16), L('putz_kz', 1)] },
  aw_beton_wdvs: { label: 'Stahlbeton 20 cm + WDVS EPS', slot: 'extWall', layers: [L('putz_gips', 1), L('beton', 20), L('eps_grau', 20), L('putz_kz', 1)] },
  aw_porenbeton: { label: 'Porenbeton 36,5 cm PP2', slot: 'extWall', layers: [L('putz_gips', 1), L('porenbeton', 36.5), L('putz_leicht', 2)] },
  aw_holzrahmen: { label: 'Holzrahmenbau mit Holzfaser-Fassade', slot: 'extWall', layers: [L('gipskarton', 1.25), L('osb', 1.5), L('mineralwolle', 20), L('holzfaser_045', 6), L('putz_kz', 1)] },
  aw_altbau_saniert: { label: 'Altbau-Mauerwerk + WDVS 14 cm (saniert)', slot: 'extWall', layers: [L('putz_kz', 1.5), L('vollziegel', 30), L('eps', 14), L('putz_kz', 1)] },
  // Dach (Dämmung in der Dachfläche)
  da_alt: { label: 'Sparrendach, 3 cm Dämmung (bis 1968)', slot: 'roof', layers: [L('putz_gips', 1.5), L('holzwolle', 2.5), L('mineralwolle_040', 3)] },
  da_1979: { label: 'Zwischensparren 8 cm (1969–1983)', slot: 'roof', layers: [L('gipskarton', 1.25), L('mineralwolle_040', 8)] },
  da_1984: { label: 'Zwischensparren 10 cm (1984–1994)', slot: 'roof', layers: [L('gipskarton', 1.25), L('mineralwolle_040', 10)] },
  da_1995: { label: 'Zwischensparren 14 cm (1995–2001)', slot: 'roof', layers: [L('gipskarton', 1.25), L('mineralwolle_040', 14)] },
  da_2002: { label: 'Zwischensparren 16 cm (2002–2008)', slot: 'roof', layers: [L('gipskarton', 1.25), L('mineralwolle', 16)] },
  da_2009: { label: 'Zwischen- + Untersparren 22 cm (2009–2015)', slot: 'roof', layers: [L('gipskarton', 1.25), L('mineralwolle', 6), L('mineralwolle', 16)] },
  da_geg: { label: 'Zwischensparren 24 cm + Holzfaser 6 cm', slot: 'roof', layers: [L('gipskarton', 1.25), L('mineralwolle', 24), L('holzfaser_045', 6)] },
  // Oberste Geschossdecke
  od_holzbalken: { label: 'Holzbalkendecke mit Lehmschlag (Altbau)', slot: 'topSlab', layers: [L('putz_kz', 1.5), L('lehm', 8), L('dielen', 2.4)] },
  od_beton_alt: { label: 'Stahlbetondecke, 4 cm Dämmung', slot: 'topSlab', layers: [L('putz_gips', 1), L('beton', 16), L('eps', 4)] },
  od_beton_16: { label: 'Stahlbetondecke + 16 cm Dämmung', slot: 'topSlab', layers: [L('putz_gips', 1), L('beton', 16), L('eps', 16)] },
  od_beton_24: { label: 'Stahlbetondecke + 24 cm Dämmung', slot: 'topSlab', layers: [L('putz_gips', 1), L('beton', 16), L('mineralwolle', 24)] },
  // Bodenplatte
  bp_alt: { label: 'Bodenplatte ungedämmt (bis 1978)', slot: 'groundSlab', layers: [L('estrich_ct', 4), L('beton', 15)] },
  bp_1984: { label: 'Bodenplatte, 4 cm Dämmung (1979–1994)', slot: 'groundSlab', layers: [L('estrich_ct', 5), L('eps', 4), L('beton', 15)] },
  bp_2002: { label: 'Bodenplatte, 8 cm Dämmung (1995–2008)', slot: 'groundSlab', layers: [L('estrich_ct', 5), L('eps', 8), L('beton', 20)] },
  bp_2009: { label: 'Bodenplatte, 12 cm Dämmung (2009–2015)', slot: 'groundSlab', layers: [L('estrich_ct', 6.5), L('eps', 4), L('beton', 20), L('xps', 8)] },
  bp_geg: { label: 'Bodenplatte, 16 cm Perimeterdämmung', slot: 'groundSlab', layers: [L('estrich_ct', 6.5), L('eps', 4), L('beton', 25), L('xps', 12)] },
  // Kellerdecke
  kd_alt: { label: 'Kellerdecke ungedämmt', slot: 'basementSlab', layers: [L('estrich_ct', 4), L('beton', 16), L('putz_kz', 1)] },
  kd_4: { label: 'Kellerdecke, 4 cm Trittschall', slot: 'basementSlab', layers: [L('estrich_ct', 5), L('trittschall', 4), L('beton', 16)] },
  kd_12: { label: 'Kellerdecke, 12 cm Dämmung', slot: 'basementSlab', layers: [L('estrich_ct', 6.5), L('eps', 4), L('beton', 18), L('eps', 8)] },
  // Wand zu unbeheizt
  uw_ks: { label: 'Kalksandstein 17,5 cm ungedämmt', slot: 'unheatedWall', layers: [L('putz_gips', 1), L('kalksandstein', 17.5), L('putz_kz', 1)] },
  uw_ks_10: { label: 'Kalksandstein 17,5 cm + 10 cm Dämmung', slot: 'unheatedWall', layers: [L('putz_gips', 1), L('kalksandstein', 17.5), L('eps', 10)] },
  uw_hlz: { label: 'Ziegel 24 cm', slot: 'unheatedWall', layers: [L('putz_gips', 1), L('hlz_1984', 24), L('putz_kz', 1)] },
};

export interface WindowType {
  label: string;
  u: number;
}

export const WINDOW_TYPES: Record<string, WindowType> = {
  einfach: { label: 'Einfachverglasung', u: 5.0 },
  kasten: { label: 'Kasten- / Verbundfenster', u: 2.7 },
  iso_alt: { label: 'Isolierverglasung 2-fach (bis 1994)', u: 2.8 },
  wsv_1995: { label: 'Wärmeschutzglas 2-fach (1995–2001)', u: 1.6 },
  wsv2: { label: 'Wärmeschutzglas 2-fach', u: 1.3 },
  wsv3: { label: 'Wärmeschutzglas 3-fach', u: 0.9 },
  passiv: { label: 'Passivhausfenster', u: 0.75 },
};

export interface AgeClass {
  until: number;
  label: string;
  templates: Record<ConstructionSlot, string>;
  window: string;
  deltaUTB: number;
}

export const AGE_CLASSES: AgeClass[] = [
  { until: 1918, label: 'bis 1918', templates: { extWall: 'aw_vollziegel_38', roof: 'da_alt', topSlab: 'od_holzbalken', groundSlab: 'bp_alt', basementSlab: 'kd_alt', unheatedWall: 'uw_ks' }, window: 'kasten', deltaUTB: 0.1 },
  { until: 1948, label: '1919–1948', templates: { extWall: 'aw_vollziegel_25', roof: 'da_alt', topSlab: 'od_holzbalken', groundSlab: 'bp_alt', basementSlab: 'kd_alt', unheatedWall: 'uw_ks' }, window: 'kasten', deltaUTB: 0.1 },
  { until: 1968, label: '1949–1968', templates: { extWall: 'aw_bims_30', roof: 'da_alt', topSlab: 'od_beton_alt', groundSlab: 'bp_alt', basementSlab: 'kd_alt', unheatedWall: 'uw_ks' }, window: 'kasten', deltaUTB: 0.1 },
  { until: 1978, label: '1969–1978', templates: { extWall: 'aw_hlz_30', roof: 'da_1979', topSlab: 'od_beton_alt', groundSlab: 'bp_alt', basementSlab: 'kd_4', unheatedWall: 'uw_ks' }, window: 'iso_alt', deltaUTB: 0.1 },
  { until: 1983, label: '1979–1983', templates: { extWall: 'aw_hlz_30_79', roof: 'da_1979', topSlab: 'od_beton_alt', groundSlab: 'bp_1984', basementSlab: 'kd_4', unheatedWall: 'uw_hlz' }, window: 'iso_alt', deltaUTB: 0.1 },
  { until: 1994, label: '1984–1994', templates: { extWall: 'aw_hlz_365_84', roof: 'da_1984', topSlab: 'od_beton_16', groundSlab: 'bp_1984', basementSlab: 'kd_4', unheatedWall: 'uw_hlz' }, window: 'iso_alt', deltaUTB: 0.1 },
  { until: 2001, label: '1995–2001', templates: { extWall: 'aw_plz_365_016', roof: 'da_1995', topSlab: 'od_beton_16', groundSlab: 'bp_2002', basementSlab: 'kd_12', unheatedWall: 'uw_ks_10' }, window: 'wsv_1995', deltaUTB: 0.1 },
  { until: 2008, label: '2002–2008', templates: { extWall: 'aw_plz_365_012', roof: 'da_2002', topSlab: 'od_beton_16', groundSlab: 'bp_2002', basementSlab: 'kd_12', unheatedWall: 'uw_ks_10' }, window: 'wsv2', deltaUTB: 0.05 },
  { until: 2015, label: '2009–2015', templates: { extWall: 'aw_plz_365_009', roof: 'da_2009', topSlab: 'od_beton_24', groundSlab: 'bp_2009', basementSlab: 'kd_12', unheatedWall: 'uw_ks_10' }, window: 'wsv2', deltaUTB: 0.05 },
  { until: 2023, label: '2016–2023', templates: { extWall: 'aw_plz_425_008', roof: 'da_geg', topSlab: 'od_beton_24', groundSlab: 'bp_geg', basementSlab: 'kd_12', unheatedWall: 'uw_ks_10' }, window: 'wsv3', deltaUTB: 0.05 },
  { until: 9999, label: 'ab 2024 (GEG)', templates: { extWall: 'aw_ks_wdvs', roof: 'da_geg', topSlab: 'od_beton_24', groundSlab: 'bp_geg', basementSlab: 'kd_12', unheatedWall: 'uw_ks_10' }, window: 'wsv3', deltaUTB: 0.05 },
];

export function ageClassFor(year: number): AgeClass {
  return AGE_CLASSES.find((a) => year <= a.until) ?? AGE_CLASSES[AGE_CLASSES.length - 1];
}

export function constructionFromTemplate(key: string): Construction {
  const t = CONSTRUCTION_TEMPLATES[key];
  return { template: key, layers: t ? t.layers.map((l) => ({ ...l })) : [] };
}

/** Wärmedurchlasswiderstand der Schichten Σ d/λ */
export function layersResistance(layers: Layer[]): number {
  return layers.reduce((a, l) => a + l.thickness / (MATERIALS[l.material]?.lambda ?? 1), 0);
}

/** U-Wert nach EN ISO 6946 (homogene Schichten) */
export function uValue(slot: ConstructionSlot, layers: Layer[]): number {
  const rs = SURFACE_RESISTANCE[slot];
  return 1 / (rs.rsi + layersResistance(layers) + rs.rse);
}

export function constructionThickness(layers: Layer[]): number {
  return layers.reduce((a, l) => a + l.thickness, 0);
}

export function defaultConstructions(year: number): Record<ConstructionSlot, Construction> {
  const ac = ageClassFor(year);
  const out = {} as Record<ConstructionSlot, Construction>;
  (Object.keys(ac.templates) as ConstructionSlot[]).forEach((slot) => (out[slot] = constructionFromTemplate(ac.templates[slot])));
  return out;
}
