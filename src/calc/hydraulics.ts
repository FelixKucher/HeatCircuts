// Rohrreibungsdruckverlust nach Darcy-Weisbach.
// Stoffwerte Wasser bei ca. 35 °C: ρ = 994 kg/m³, ν = 0,72·10⁻⁶ m²/s.

const RHO = 994;
const NU = 0.72e-6;

export interface PipeFlow {
  /** Strömungsgeschwindigkeit in m/s */
  velocity: number;
  reynolds: number;
  /** Druckgefälle R in Pa/m */
  gradient: number;
  /** Druckverlust in Pa */
  pressureDrop: number;
}

function frictionFactor(re: number): number {
  if (re <= 0) return 0;
  const lam = 64 / re;
  const turb = 0.3164 / Math.pow(re, 0.25); // Blasius, hydraulisch glatt (PE-X, Verbundrohr)
  if (re < 2300) return lam;
  if (re > 4000) return turb;
  const t = (re - 2300) / 1700;
  return (1 - t) * (64 / 2300) + t * (0.3164 / Math.pow(4000, 0.25));
}

/** massFlowKgH in kg/h, Innendurchmesser in m, Länge in m */
export function pipeFlow(massFlowKgH: number, innerDiameter: number, length: number): PipeFlow {
  const vdot = massFlowKgH / 3600 / RHO;
  const a = (Math.PI * innerDiameter * innerDiameter) / 4;
  const velocity = vdot / a;
  const reynolds = (velocity * innerDiameter) / NU;
  const lambda = frictionFactor(reynolds);
  const gradient = ((lambda / innerDiameter) * RHO * velocity * velocity) / 2;
  return { velocity, reynolds, gradient, pressureDrop: gradient * length };
}

/** kg/h → l/min */
export const toLitresPerMinute = (kgH: number) => kgH / RHO / 60 * 1000;
