import type { Floor, ImageStore, Project } from '../model/types';
import type { DesignResult } from '../calc/design';
import { backgroundMarkup, floorBounds, renderLayers } from '../ui/render';
import { esc, level, num } from '../ui/format';

// Feste Farben für den Plan-Export (unabhängig vom Bildschirmthema)
const EXPORT_CSS = `
.room{fill:#e8eef3;fill-opacity:.55;stroke:#1d2a35;stroke-width:.02}
.room-warn{fill:#f6e2d8}
.room-unheated{fill:#f1f1ef;stroke:#8a9399;stroke-width:.02;stroke-dasharray:.1 .06}
.wall{stroke:#1d2a35;stroke-linecap:square}
.wall-interior{stroke:#45525d}
.wall-unheated{stroke:#6b7780;stroke-dasharray:.12 .05}
.hit,.route-hit{display:none}
.pipe-supply{fill:none;stroke:#c8372d;stroke-width:.018;stroke-linejoin:round}
.pipe-return{fill:none;stroke:#2d64c8;stroke-width:.018;stroke-linejoin:round}
.pipe-supply.alt{stroke:#e0663a}.pipe-return.alt{stroke:#3d8fd9}
.feeder-supply{fill:none;stroke:#c8372d;stroke-width:.03}
.feeder-return{fill:none;stroke:#2d64c8;stroke-width:.03}
.main-line{fill:none;stroke:#7a3fb3;stroke-width:.05;stroke-dasharray:.2 .1}
.manifold rect{fill:#fff;stroke:#0f6f62;stroke-width:.03}
.manifold .bar-s{stroke:#c8372d;stroke-width:.03}.manifold .bar-r{stroke:#2d64c8;stroke-width:.03}
.heat-source rect{fill:#fff;stroke:#7a3fb3;stroke-width:.04}
.heat-source .flame{fill:none;stroke:#7a3fb3;stroke-width:.04}
.riser circle{fill:#fff;stroke:#7a3fb3;stroke-width:.03}.riser path{stroke:#7a3fb3;stroke-width:.03}
text{font-family:Barlow,"Helvetica Neue",Arial,sans-serif;text-anchor:middle;fill:#1d2a35}
.lbl-title{font-weight:600}.lbl{fill:#45525d}.lbl-warn{fill:#b4361f}.lbl-muted{fill:#8a9399}.lbl-feeder{fill:#6b2f9e}
.title-block text{text-anchor:start}
`;

export function exportFloorSvg(project: Project, floor: Floor, design: DesignResult, images: ImageStore, withBackground: boolean): string | null {
  const b = floorBounds(floor, project);
  if (!b) return null;
  const pad = 1.0;
  const minX = b.min.x - pad;
  const minY = b.min.y - pad;
  const w = b.max.x - b.min.x + 2 * pad;
  const h = b.max.y - b.min.y + 2 * pad + 1.4;
  const scale = 50;
  const L = renderLayers({ project, floor, design, images, scale, selection: null, showCircuits: true, showLabels: true, ghost: null });
  const date = new Date().toLocaleDateString('de-DE');
  const ty = b.max.y + pad + 0.5;
  const title = `<g class="title-block">
    <text x="${minX + 0.3}" y="${ty}" font-size="0.32" class="lbl-title">${esc(project.name)} · ${esc(floor.name)} (${level(floor.elevation)})</text>
    <text x="${minX + 0.3}" y="${ty + 0.42}" font-size="0.24" class="lbl">Vorlauf ${num(design.thetaSupply, 1)} °C · σ ${num(design.sigmaDesign, 0)} K · θe ${num(project.building.thetaE, 0)} °C · ${date} · HeatCircuits</text>
  </g>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${w} ${h}" width="${Math.round(w * scale)}" height="${Math.round(h * scale)}">
<style>${EXPORT_CSS}</style>
<rect x="${minX}" y="${minY}" width="${w}" height="${h}" fill="#ffffff"/>
${withBackground ? backgroundMarkup(floor, images) : ''}
<g>${L.rooms}${L.circuits}${L.feeders}${L.walls}${L.objects}${L.labels}</g>
${title}
</svg>`;
}
