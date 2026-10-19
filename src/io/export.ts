import type { Floor, ImageStore, Project } from '../model/types';
import type { DesignResult } from '../calc/design';
import { backgroundMarkup, floorBounds, renderLayers, SVG_DEFS } from '../ui/render';
import { PLAN_DEFS, planBaseSvg } from '../ui/plan-render';
import { esc, level, num } from '../ui/format';

// Feste Farben für den Plan-Export (unabhängig vom Bildschirmthema)
const EXPORT_CSS = `
.p-wall{fill:url(#p-hatch);stroke:none}.p-hatch-bg{fill:#fff}.p-hatch-ln{stroke:#555;stroke-width:.012}
.p-edge{stroke:#1d2a35;stroke-width:.025;stroke-linecap:square}
.p-room{fill:#e8eef3;fill-opacity:.45;stroke:none}.p-room.unheated{fill:#f1f1ef}.p-room.warn{fill:#f6e2d8}
.p-room-name{font-weight:600}.p-room-area{fill:#45525d}
.p-op-gap{fill:#fff}.p-op-reveal,.p-op-win{stroke:#1d2a35;stroke-width:.015}.p-op-glass{stroke:#2d64c8;stroke-width:.008}.p-op-leaf{stroke:#1d2a35;stroke-width:.02}.p-op-arc,.p-op-sill{fill:none;stroke:#1d2a35;stroke-width:.008}.p-op-slide{fill:#fff;stroke:#1d2a35;stroke-width:.008}.p-op-garage{stroke:#1d2a35;stroke-width:.01}.p-dashed{stroke-dasharray:.06 .04}.p-hit,.p-hit-line{display:none}
.p-fur .p-fur-bg{fill:#fff;fill-opacity:.7}.p-sym{fill:none;stroke:#5b6670;stroke-width:.01}.sym-t{font-size:.12px;fill:#5b6670;stroke:none}.fill-dark{fill:#5b6670}
.p-tread{fill:#fff;stroke:#45525d;stroke-width:.01}.p-stair-bg{fill:#fff}.p-walkline{fill:none;stroke:#45525d;stroke-width:.01}.p-walk-start,.p-arrow-head{fill:#45525d}
.p-void polygon{fill:none;stroke:#8a9399;stroke-width:.012;stroke-dasharray:.08 .05}.p-void line{stroke:#8a9399;stroke-width:.008}
.p-dim-line,.p-dim-ext{stroke:#45525d;stroke-width:.008}.p-dim-tick{stroke:#45525d;stroke-width:.016}.p-dim-text{fill:#1d2a35}
.p-ghost{display:none}.p-label{text-anchor:start}
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
text{font-family:"IBM Plex Sans","Helvetica Neue",Arial,sans-serif;text-anchor:middle;fill:#1d2a35}
.lbl-title{font-weight:600}.lbl{fill:#45525d}.lbl-warn{fill:#b4361f}.lbl-muted{fill:#8a9399}.lbl-feeder{fill:#6b2f9e}
.title-block text{text-anchor:start}
.opening-cut{fill:#fff;stroke:none}.window-line{stroke:#1d2a35;stroke-width:.015}.door-leaf{stroke:#1d2a35;stroke-width:.025}.door-arc{fill:none;stroke:#8a9399;stroke-width:.012;stroke-dasharray:.05 .04}.garage-line{stroke:#1d2a35;stroke-width:.03;stroke-dasharray:.15 .08}
.void{fill:#f1f1ef;stroke:#45525d;stroke-width:.02}.stair-line{stroke:#45525d;stroke-width:.012}.stair-arrow{fill:none;stroke:#1d2a35;stroke-width:.02}.stair-post{fill:#45525d}.void-cross{stroke:#8a9399;stroke-width:.012}
.elmat-line{stroke:#e08a3a}.elmat{opacity:.6}.ceil-dot{fill:#e0a060}.wall-heat{stroke:#c8372d;stroke-width:.08;stroke-dasharray:.12 .05}
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
  const base = planBaseSvg({ project, floor, design, scale, sel: [], phase: 'circuits', ghost: null });
  const date = new Date().toLocaleDateString('de-DE');
  const ty = b.max.y + pad + 0.5;
  const title = `<g class="title-block">
    <text x="${minX + 0.3}" y="${ty}" font-size="0.32" class="lbl-title">${esc(project.name)} · ${esc(floor.name)} (${level(floor.elevation)})</text>
    <text x="${minX + 0.3}" y="${ty + 0.42}" font-size="0.24" class="lbl">Vorlauf ${num(design.thetaSupply, 1)} °C · σ ${num(design.sigmaDesign, 0)} K · θe ${num(project.building.thetaE, 0)} °C · ${date} · HeatCircuits</text>
  </g>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${w} ${h}" width="${Math.round(w * scale)}" height="${Math.round(h * scale)}">
<style>${EXPORT_CSS}</style>
${SVG_DEFS}${PLAN_DEFS}
<rect x="${minX}" y="${minY}" width="${w}" height="${h}" fill="#ffffff"/>
${withBackground ? backgroundMarkup(floor, images) : ''}
<g>${base.under}${L.heatAreas}${L.circuits}${L.feeders}${base.walls}${L.wallHeat}${base.over}${L.objects}${L.labels}</g>
${title}
</svg>`;
}
