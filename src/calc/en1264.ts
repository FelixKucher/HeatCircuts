// Auslegung von Fußbodenheizungen (Nasssystem Typ A) nach EN 1264-2/-3, vereinfachtes Kennlinienverfahren.
//
//   q = B · a_B · a_T^m_T · a_ü^m_ü · a_D^m_D · Δθ_H
//
// Die Tabellenwerte a_T, a_ü, a_D sind interpoliert; die Ergebnisse ersetzen nicht die
// geprüften Systemkennlinien des Herstellers.

export const ALPHA = 10.8; // Gesamtwärmeübergangskoeffizient an der Oberfläche, W/(m²K)
const B0 = 6.7; // Systemkoeffizient für λ_R = 0,35 W/(mK), s_R = 2 mm
const S_U0 = 0.045;
const LAMBDA_U0 = 1.0;
/** spez. Wärmekapazität Wasser in Wh/(kg·K) */
export const C_W = 1.163;

export interface FloorBuildUp {
  spacing: number; // T in m
  rLambdaB: number; // m²K/W
  screedCover: number; // s_ü in m
  lambdaScreed: number; // W/(mK)
  pipeOuter: number; // D in m
}

function interp(x: number, xs: number[], ys: number[]): number {
  if (x <= xs[0]) return ys[0];
  for (let i = 1; i < xs.length; i++) {
    if (x <= xs[i]) {
      const t = (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
      return ys[i - 1] + t * (ys[i] - ys[i - 1]);
    }
  }
  return ys[ys.length - 1];
}

const R_GRID = [0, 0.05, 0.1, 0.15];
const A_T = [1.23, 1.188, 1.156, 1.134];

/** a_ü in Abhängigkeit von T (Zeilen) und R_λ,B (Spalten). */
const T_GRID = [0.05, 0.075, 0.1, 0.15, 0.2, 0.225, 0.3, 0.375];
const A_U: number[][] = [
  [1.069, 1.056, 1.043, 1.037],
  [1.066, 1.053, 1.041, 1.035],
  [1.063, 1.05, 1.039, 1.0335],
  [1.057, 1.046, 1.035, 1.0305],
  [1.051, 1.041, 1.0315, 1.0275],
  [1.048, 1.038, 1.0295, 1.026],
  [1.04, 1.0315, 1.0245, 1.0215],
  [1.03, 1.0225, 1.017, 1.015],
];
const A_D: number[][] = [
  [1.013, 1.013, 1.012, 1.011],
  [1.021, 1.019, 1.016, 1.014],
  [1.029, 1.025, 1.022, 1.018],
  [1.04, 1.034, 1.029, 1.024],
  [1.046, 1.04, 1.035, 1.03],
  [1.049, 1.043, 1.038, 1.033],
  [1.053, 1.049, 1.044, 1.039],
  [1.056, 1.051, 1.046, 1.042],
];

function table2(T: number, R: number, tab: number[][]): number {
  const col = R_GRID.map((_, c) => interp(T, T_GRID, tab.map((row) => row[c])));
  return interp(R, R_GRID, col);
}

/** Äquivalenter Wärmedurchgangskoeffizient K_H in W/(m²K): q = K_H · Δθ_H */
export function kH(b: FloorBuildUp): number {
  const T = Math.min(0.375, Math.max(0.05, b.spacing));
  const R = Math.min(0.15, Math.max(0, b.rLambdaB));
  const aB = (1 / ALPHA + S_U0 / LAMBDA_U0) / (1 / ALPHA + S_U0 / b.lambdaScreed + R);
  const aT = interp(R, R_GRID, A_T);
  const mT = 1 - T / 0.075;
  const aU = table2(T, R, A_U);
  const mU = 100 * (0.045 - b.screedCover);
  const aD = table2(T, R, A_D);
  const mD = 250 * (b.pipeOuter - 0.02);
  return B0 * aB * Math.pow(aT, mT) * Math.pow(aU, mU) * Math.pow(aD, mD);
}

/** Logarithmische Übertemperatur Δθ_H aus Vorlauf, Rücklauf und Raumtemperatur. */
export function logMeanExcess(thetaV: number, thetaR: number, thetaI: number): number {
  const a = thetaV - thetaI;
  const b = thetaR - thetaI;
  if (a <= 0 || b <= 0) return 0;
  if (Math.abs(a - b) < 1e-9) return a;
  return (a - b) / Math.log(a / b);
}

/** Vorlaufübertemperatur θ_V − θ_i für gegebene Δθ_H und Spreizung σ (exakt). */
export function supplyExcess(dThetaH: number, sigma: number): number {
  return sigma / (1 - Math.exp(-sigma / dThetaH));
}

/**
 * Spreizung σ eines Raumes bei vorgegebener Vorlauftemperatur und benötigter Δθ_H.
 * Liefert null, wenn die Vorlauftemperatur nicht ausreicht.
 */
export function sigmaFor(thetaV: number, thetaI: number, dThetaH: number): number | null {
  const a = thetaV - thetaI;
  if (dThetaH <= 0) return a;
  if (dThetaH >= a) return null;
  // Δθ_H(σ) = σ / ln(a/(a−σ)) fällt streng monoton von a (σ→0) auf 0 (σ→a)
  let lo = 1e-6;
  let hi = a - 1e-6;
  for (let i = 0; i < 80; i++) {
    const m = (lo + hi) / 2;
    const dh = m / Math.log(a / (a - m));
    if (dh > dThetaH) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}

/** Wärmestromdichte aus mittlerer Oberflächentemperatur (Basiskennlinie EN 1264): q = 8,92·(θ_F,m − θ_i)^1,1 */
export function fluxFromSurface(thetaF: number, thetaI: number): number {
  const d = thetaF - thetaI;
  return d > 0 ? 8.92 * Math.pow(d, 1.1) : 0;
}

export function surfaceFromFlux(q: number, thetaI: number): number {
  return q > 0 ? thetaI + Math.pow(q / 8.92, 1 / 1.1) : thetaI;
}

/** Wärmeleitwiderstand nach oben R_o in m²K/W */
export function resistanceUp(b: FloorBuildUp): number {
  return 1 / ALPHA + b.rLambdaB + b.screedCover / b.lambdaScreed;
}

/**
 * Heizwassermassenstrom nach EN 1264-3 in kg/h, inkl. Wärmeabgabe nach unten.
 * rDown: Wärmeleitwiderstand nach unten (Dämmung + Rohdecke + Übergang) in m²K/W
 */
export function massFlow(areaM2: number, q: number, sigma: number, rUp: number, rDown: number, thetaI: number, thetaBelow: number): number {
  if (sigma <= 0 || q <= 0) return 0;
  const factor = 1 + rUp / rDown + (thetaI - thetaBelow) / (q * rDown);
  return (areaM2 * q * factor) / (C_W * sigma);
}
