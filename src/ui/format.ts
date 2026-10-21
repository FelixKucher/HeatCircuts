const nf = new Map<string, Intl.NumberFormat>();

function fmt(digits: number, grouping = true, minDigits = digits): Intl.NumberFormat {
  const key = `${digits}:${grouping}:${minDigits}`;
  let f = nf.get(key);
  if (!f) {
    f = new Intl.NumberFormat('de-DE', { minimumFractionDigits: minDigits, maximumFractionDigits: digits, useGrouping: grouping });
    nf.set(key, f);
  }
  return f;
}

/** Zahl im deutschen Format, z. B. 1.234,5 */
export const num = (x: number, digits = 1): string => (Number.isFinite(x) ? fmt(digits).format(x) : '–');
/** Zahl ohne Tausenderpunkt (für Eingabefelder) */
export const numInput = (x: number, digits = 3): string => (Number.isFinite(x) ? fmt(digits, false, 0).format(x) : '');

export const m = (x: number, d = 2) => `${num(x, d)} m`;
export const m2 = (x: number, d = 2) => `${num(x, d)} m²`;
export const W = (x: number) => `${num(x, 0)} W`;
export const Wm2 = (x: number) => `${num(x, 1)} W/m²`;
export const degC = (x: number, d = 1) => `${num(x, d)} °C`;
export const K = (x: number, d = 1) => `${num(x, d)} K`;
export const cm = (xm: number, d = 1) => `${num(xm * 100, d).replace(/,0$/, '')} cm`;
export const mbar = (pa: number) => `${num(pa / 100, 0)} mbar`;
export const kgh = (x: number) => `${num(x, 0)} kg/h`;
export const lmin = (x: number) => `${num(x, 2)} l/min`;
export const level = (x: number) => (Math.abs(x) < 0.005 ? '±0,00 m' : `${x > 0 ? '+' : '−'}${num(Math.abs(x), 2)} m`);

/** Liest deutsche und englische Dezimalschreibweise (Komma oder Punkt). */
export function parseNum(s: string): number | null {
  const t = s.trim().replace(/\s/g, '').replace(/[^\d,.\-−+]/g, '').replace('−', '-');
  if (!t) return null;
  let normalized = t;
  if (t.includes(',') && t.includes('.')) normalized = t.replace(/\./g, '').replace(',', '.');
  else normalized = t.replace(',', '.');
  const x = Number(normalized);
  return Number.isFinite(x) ? x : null;
}

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
