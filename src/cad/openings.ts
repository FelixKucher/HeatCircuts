// Öffnungsarten: Darstellung (style) und bauphysikalische Art (kind) mit Vorgabemaßen.

import type { Opening, OpeningKind, OpeningStyle, Wall } from '../model/types';

export const OPENING_STYLES: Record<OpeningStyle, { label: string; width: number; height: number; sill: number; color: string; door: boolean }> = {
  door: { label: 'Tür', width: 0.885, height: 2.01, sill: 0, color: '#f4f1ea', door: true },
  doubleDoor: { label: 'Doppelflügeltür', width: 1.51, height: 2.01, sill: 0, color: '#f4f1ea', door: true },
  slidingDoor: { label: 'Schiebetür (verglast)', width: 2.01, height: 2.135, sill: 0, color: '#ffffff', door: true },
  passage: { label: 'Durchgang', width: 1.01, height: 2.135, sill: 0, color: '#ffffff', door: true },
  window: { label: 'Fenster', width: 1.26, height: 1.385, sill: 0.885, color: '#ffffff', door: false },
  frenchWindow: { label: 'Fenstertür', width: 1.01, height: 2.26, sill: 0, color: '#ffffff', door: false },
  roofWindow: { label: 'Oberlicht', width: 1.01, height: 0.51, sill: 1.76, color: '#ffffff', door: false },
  garageDoor: { label: 'Garagentor', width: 2.5, height: 2.125, sill: 0, color: '#d9dcde', door: true },
};

/** Darstellung einer Öffnung (ältere Projekte ohne `style`: aus der Art) */
export function styleOf(o: Opening): OpeningStyle {
  if (o.style) return o.style;
  return o.kind === 'window' ? 'window' : o.kind === 'garage' ? 'garageDoor' : 'door';
}

/** bauphysikalische Art aus Darstellung und Wandart */
export function kindForStyle(style: OpeningStyle, wall: Wall): OpeningKind {
  if (style === 'garageDoor') return 'garage';
  if (style === 'window' || style === 'frenchWindow' || style === 'roofWindow' || style === 'slidingDoor') return 'window';
  return wall.kind === 'exterior' ? 'entrance' : 'door';
}

let n = 0;
export function newOpening(style: OpeningStyle, offset: number, wall: Wall): Opening {
  const d = OPENING_STYLES[style];
  return { id: `o${Date.now().toString(36)}${(n++).toString(36)}`, kind: kindForStyle(style, wall), style, offset, width: d.width, height: d.height, sill: d.sill, side: 'left', hinge: 'a', color: d.color, uValue: null };
}
