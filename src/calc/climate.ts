// Klimadaten am Standort: inverse Distanzgewichtung der nächsten Stationen mit Höhenkorrektur.
// Die Stationswerte werden mit einem Temperaturgradienten auf Meereshöhe reduziert, interpoliert und
// auf die Standorthöhe zurückgerechnet. Näherung zur Vorbelegung – verbindlich sind die Werte des
// nationalen Anhangs (DE: DIN/TS 12831-1 nach PLZ, AT: ÖNORM H 7500-1, CH: SIA 384/2).

import { CLIMATE_LOCATIONS } from '../model/catalog';

/** Abnahme der Temperatur mit der Höhe in K/m (≈ 0,5 K je 100 m, Annahme) */
export const LAPSE_RATE = 0.005;
const NEIGHBOURS = 4;

export interface ClimateEstimate {
  thetaE: number;
  thetaMeanYear: number;
  /** genutzte Stationen mit Entfernung in km und Gewicht */
  stations: { key: string; label: string; km: number; weight: number }[];
  /** Entfernung zur nächsten Station in km */
  nearestKm: number;
}

/** Großkreisentfernung in km */
export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r;
  const dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function estimateClimate(lat: number, lon: number, altitude: number): ClimateEstimate {
  const all = Object.entries(CLIMATE_LOCATIONS)
    .map(([key, s]) => ({ key, s, km: distanceKm(lat, lon, s.lat, s.lon) }))
    .sort((a, b) => a.km - b.km)
    .slice(0, NEIGHBOURS);
  // sehr nah an einer Station: deren Wert (höhenkorrigiert)
  const w = all.map((x) => 1 / Math.max(1, x.km) ** 2);
  const sw = w.reduce((a, b) => a + b, 0);
  let e0 = 0;
  let m0 = 0;
  all.forEach((x, i) => {
    e0 += (w[i] / sw) * (x.s.thetaE + LAPSE_RATE * x.s.alt);
    m0 += (w[i] / sw) * (x.s.thetaMeanYear + LAPSE_RATE * x.s.alt);
  });
  const r1 = (v: number) => Math.round(v * 10) / 10;
  return {
    thetaE: r1(e0 - LAPSE_RATE * altitude),
    thetaMeanYear: r1(m0 - LAPSE_RATE * altitude),
    stations: all.map((x, i) => ({ key: x.key, label: x.s.label, km: x.km, weight: w[i] / sw })),
    nearestKm: all[0]?.km ?? Infinity,
  };
}

/** Höhe als gewichtetes Mittel der Nachbarstationen – nur als Startwert, bitte prüfen */
export function guessAltitude(lat: number, lon: number): number {
  const est = estimateClimate(lat, lon, 0);
  let alt = 0;
  for (const st of est.stations) alt += st.weight * CLIMATE_LOCATIONS[st.key].alt;
  return Math.round(alt / 10) * 10;
}
