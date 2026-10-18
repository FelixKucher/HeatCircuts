// Möbelkatalog: Abmessungen, Planzeichen (SVG, lokale Koordinaten, Mitte = Ursprung, Vorderseite +y)
// und parametrische 3D-Modelle aus Grundkörpern (lokal: x Breite, y Höhe, z Tiefe, Vorderseite +z).

import * as THREE from 'three';

export interface CatalogItem {
  key: string;
  name: string;
  category: string;
  width: number;
  depth: number;
  height: number;
  elevation?: number;
  color: string;
  /** Planzeichen in einem Rechteck w × d */
  plan: (w: number, d: number) => string;
  model: (w: number, d: number, h: number, color: string) => THREE.Group;
  /** an die Wand (Rückseite) anlegen */
  wallSide?: boolean;
}

// ---------- 3D-Hilfen ----------

const matCache = new Map<string, THREE.MeshStandardMaterial>();
export function mat(color: string, opts: { rough?: number; metal?: number; opacity?: number } = {}): THREE.MeshStandardMaterial {
  const k = `${color}|${opts.rough ?? 0.7}|${opts.metal ?? 0}|${opts.opacity ?? 1}`;
  let m = matCache.get(k);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: opts.rough ?? 0.7, metalness: opts.metal ?? 0, transparent: (opts.opacity ?? 1) < 1, opacity: opts.opacity ?? 1 });
    matCache.set(k, m);
  }
  return m;
}

function box(g: THREE.Group, w: number, h: number, d: number, x: number, y: number, z: number, color: string, o?: Parameters<typeof mat>[1]): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.005, w), Math.max(0.005, h), Math.max(0.005, d)), mat(color, o));
  m.position.set(x, y + h / 2, z);
  m.castShadow = true;
  m.receiveShadow = true;
  g.add(m);
  return m;
}

function cyl(g: THREE.Group, r: number, h: number, x: number, y: number, z: number, color: string, o?: Parameters<typeof mat>[1], seg = 24): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), mat(color, o));
  m.position.set(x, y + h / 2, z);
  m.castShadow = true;
  g.add(m);
  return m;
}

function legs(g: THREE.Group, w: number, d: number, h: number, t: number, inset: number, color: string): void {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(g, t, h, t, sx * (w / 2 - inset - t / 2), 0, sz * (d / 2 - inset - t / 2), color);
}

const shade = (hex: string, f: number): string => {
  const c = new THREE.Color(hex);
  c.multiplyScalar(f);
  return `#${c.getHexString()}`;
};

const WHITE = '#f4f3ef';
const STEEL = '#b9bdc1';
const DARK = '#3b3f44';
const WOOD = '#b0855a';
const GLASS = '#a9d2e6';

// ---------- Planzeichen-Hilfen ----------

const R = (x: number, y: number, w: number, h: number, extra = '') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" ${extra}/>`;
const frame = (w: number, d: number, r = 0) => R(-w / 2, -d / 2, w, d, r ? `rx="${r}"` : '');
const line = (x1: number, y1: number, x2: number, y2: number) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
const circ = (x: number, y: number, r: number) => `<circle cx="${x}" cy="${y}" r="${r}"/>`;
const ell = (x: number, y: number, rx: number, ry: number) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}"/>`;

// ---------- Modelle ----------

function sofa(w: number, d: number, h: number, c: string, seats: number): THREE.Group {
  const g = new THREE.Group();
  const arm = Math.min(0.2, w * 0.1);
  box(g, w, 0.12, d, 0, 0.06, 0, shade(c, 0.6));
  box(g, w - 2 * arm, 0.2, d - 0.2, 0, 0.18, 0.1, c);
  const cw = (w - 2 * arm) / seats;
  for (let i = 0; i < seats; i++) box(g, cw - 0.02, 0.06, d - 0.24, -w / 2 + arm + cw * (i + 0.5), 0.38, 0.11, shade(c, 1.08));
  box(g, w - 2 * arm, h - 0.18, 0.2, 0, 0.18, -d / 2 + 0.1, c);
  box(g, arm, 0.62 - 0.06, d, -w / 2 + arm / 2, 0.06, 0, c);
  box(g, arm, 0.62 - 0.06, d, w / 2 - arm / 2, 0.06, 0, c);
  return g;
}

function table(w: number, d: number, h: number, c: string, round = false): THREE.Group {
  const g = new THREE.Group();
  if (round) {
    const top = new THREE.Mesh(new THREE.CylinderGeometry(w / 2, w / 2, 0.04, 40), mat(c));
    top.position.set(0, h - 0.02, 0);
    top.castShadow = true;
    g.add(top);
    cyl(g, 0.05, h - 0.04, 0, 0, 0, DARK, { metal: 0.4 });
    cyl(g, w * 0.22, 0.02, 0, 0, 0, DARK, { metal: 0.4 });
  } else {
    box(g, w, 0.04, d, 0, h - 0.04, 0, c);
    legs(g, w, d, h - 0.04, 0.06, 0.05, shade(c, 0.85));
  }
  return g;
}

function chair(w: number, d: number, h: number, c: string): THREE.Group {
  const g = new THREE.Group();
  box(g, w, 0.04, d, 0, 0.44, 0, c);
  legs(g, w, d, 0.44, 0.035, 0.02, shade(c, 0.8));
  box(g, w, h - 0.48, 0.03, 0, 0.48, -d / 2 + 0.03, c);
  return g;
}

function cabinet(w: number, d: number, h: number, c: string, doors: number, plinth = 0.08, top?: string): THREE.Group {
  const g = new THREE.Group();
  box(g, w - 0.04, plinth, d - 0.06, 0, 0, -0.02, DARK);
  box(g, w, h - plinth - (top ? 0.04 : 0), d, 0, plinth, 0, c);
  if (top) box(g, w + 0.01, 0.04, d + 0.02, 0, h - 0.04, 0.01, top);
  const dw = w / doors;
  for (let i = 0; i < doors; i++) {
    const x = -w / 2 + dw * (i + 0.5);
    box(g, 0.012, Math.min(0.3, h * 0.25), 0.02, x + (i % 2 ? -1 : 1) * (dw / 2 - 0.05), plinth + (h - plinth) * 0.55, d / 2 + 0.01, STEEL, { metal: 0.6, rough: 0.3 });
    if (i > 0) box(g, 0.004, h - plinth - 0.06, 0.004, -w / 2 + dw * i, plinth + 0.02, d / 2 + 0.002, shade(c, 0.75));
  }
  return g;
}

function bed(w: number, d: number, h: number, c: string): THREE.Group {
  const g = new THREE.Group();
  box(g, w, 0.3, d, 0, 0.05, 0, c);
  legs(g, w, d, 0.05, 0.05, 0.03, DARK);
  box(g, w - 0.06, 0.2, d - 0.08, 0, 0.35, 0.02, WHITE, { rough: 0.95 });
  box(g, w, h - 0.05, 0.06, 0, 0.05, -d / 2 + 0.03, c);
  const n = w > 1.2 ? 2 : 1;
  const pw = (w - 0.2) / n;
  for (let i = 0; i < n; i++) box(g, pw - 0.06, 0.1, 0.4, -w / 2 + 0.1 + pw * (i + 0.5), 0.55, -d / 2 + 0.3, '#ffffff', { rough: 1 });
  box(g, w - 0.04, 0.04, d * 0.6, 0, 0.55, d * 0.18, '#9fb6c9', { rough: 1 });
  return g;
}

function bathtub(w: number, d: number, h: number): THREE.Group {
  const g = new THREE.Group();
  box(g, w, h, d, 0, 0, 0, WHITE, { rough: 0.25 });
  const inner = new THREE.Mesh(new THREE.BoxGeometry(w - 0.14, 0.02, d - 0.14), mat('#dfe8ee', { rough: 0.15 }));
  inner.position.set(0, h - 0.005, 0);
  g.add(inner);
  cyl(g, 0.015, 0.12, -w / 2 + 0.06, h, 0, STEEL, { metal: 0.8, rough: 0.2 });
  return g;
}

function shower(w: number, d: number, h: number): THREE.Group {
  const g = new THREE.Group();
  box(g, w, 0.04, d, 0, 0, 0, WHITE, { rough: 0.3 });
  box(g, 0.01, h - 0.04, d, w / 2 - 0.005, 0.04, 0, GLASS, { opacity: 0.35, rough: 0.05 });
  box(g, w, h - 0.04, 0.01, 0, 0.04, d / 2 - 0.005, GLASS, { opacity: 0.35, rough: 0.05 });
  cyl(g, 0.012, h - 0.2, -w / 2 + 0.08, 0.04, -d / 2 + 0.08, STEEL, { metal: 0.8 });
  cyl(g, 0.11, 0.015, -w / 2 + 0.2, h - 0.2, -d / 2 + 0.2, STEEL, { metal: 0.8 });
  return g;
}

function wc(w: number, d: number): THREE.Group {
  const g = new THREE.Group();
  box(g, w, 0.4, 0.16, 0, 0.35, -d / 2 + 0.08, WHITE, { rough: 0.2 });
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.48, w * 0.36, 0.4, 28), mat(WHITE, { rough: 0.2 }));
  bowl.scale.set(1, 1, (d - 0.16) / w);
  bowl.position.set(0, 0.2, 0.08);
  bowl.castShadow = true;
  g.add(bowl);
  box(g, 0.2, 0.004, 0.14, 0, 1.0, -d / 2 + 0.005, WHITE);
  return g;
}

function basin(w: number, d: number, h: number, double = false): THREE.Group {
  const g = new THREE.Group();
  box(g, w, 0.45, d, 0, h - 0.5, 0, '#8d6e52');
  box(g, w, 0.05, d, 0, h - 0.05, 0, WHITE, { rough: 0.2 });
  const n = double ? 2 : 1;
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + (w / n) * (i + 0.5);
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.15, 0.02, 28), mat('#dfe8ee', { rough: 0.1 }));
    s.scale.set(1, 1, 0.7);
    s.position.set(x, h + 0.001, 0.02);
    g.add(s);
    cyl(g, 0.015, 0.18, x, h, -d / 2 + 0.06, STEEL, { metal: 0.9, rough: 0.2 });
    box(g, Math.min(0.6, w / n - 0.1), 0.7, 0.02, x, h + 0.25, -d / 2 + 0.01, '#d6e4ea', { metal: 0.9, rough: 0.05 });
  }
  return g;
}

function appliance(w: number, d: number, h: number, c: string, kind: 'fridge' | 'washer' | 'dishwasher' | 'stove'): THREE.Group {
  const g = new THREE.Group();
  box(g, w, h, d, 0, 0, 0, c, { rough: 0.35, metal: 0.2 });
  if (kind === 'fridge') {
    box(g, w - 0.02, 0.004, 0.004, 0, h * 0.62, d / 2 + 0.002, shade(c, 0.7));
    box(g, 0.02, 0.4, 0.03, w / 2 - 0.06, h * 0.7, d / 2 + 0.015, STEEL, { metal: 0.8 });
  } else if (kind === 'washer') {
    const door = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.02, 32), mat('#4f5a63', { rough: 0.1, metal: 0.5 }));
    door.rotation.x = Math.PI / 2;
    door.position.set(0, h * 0.45, d / 2 + 0.01);
    g.add(door);
  } else if (kind === 'stove') {
    box(g, w, 0.01, d, 0, h, 0, '#1d1f22', { rough: 0.1 });
    for (const [x, z] of [[-0.14, -0.12], [0.14, -0.12], [-0.14, 0.12], [0.14, 0.12]]) cyl(g, 0.08, 0.002, x * (w / 0.6), h + 0.01, z * (d / 0.6), '#3a3d40');
    box(g, w - 0.08, 0.35, 0.01, 0, 0.25, d / 2 + 0.005, '#2a2d30', { rough: 0.1 });
  }
  return g;
}

function plant(w: number, h: number): THREE.Group {
  const g = new THREE.Group();
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.3, w * 0.22, h * 0.25, 20), mat('#b46a3c'));
  pot.position.y = h * 0.125;
  g.add(pot);
  const leaves = new THREE.Mesh(new THREE.IcosahedronGeometry(w / 2, 1), mat('#4f7f45', { rough: 0.9 }));
  leaves.position.y = h * 0.62;
  leaves.scale.set(1, (h * 0.75) / w, 1);
  leaves.castShadow = true;
  g.add(leaves);
  return g;
}

function car(w: number, d: number, h: number, c: string): THREE.Group {
  const g = new THREE.Group();
  box(g, w, h * 0.45, d, 0, 0.18, 0, c, { rough: 0.3, metal: 0.4 });
  box(g, w * 0.86, h * 0.38, d * 0.5, 0, 0.18 + h * 0.45, -d * 0.04, GLASS, { opacity: 0.8, rough: 0.1 });
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.2, 20), mat('#1c1c1c'));
      wh.rotation.z = Math.PI / 2;
      wh.position.set(sx * (w / 2 - 0.1), 0.32, sz * (d / 2 - 0.7));
      g.add(wh);
    }
  return g;
}

function radiator(w: number, d: number, h: number): THREE.Group {
  const g = new THREE.Group();
  const n = Math.max(3, Math.round(w / 0.06));
  for (let i = 0; i < n; i++) box(g, w / n - 0.012, h, d, -w / 2 + (w / n) * (i + 0.5), 0, 0, WHITE, { rough: 0.4 });
  return g;
}

function manifold(w: number, d: number, h: number): THREE.Group {
  const g = new THREE.Group();
  box(g, w, h, d, 0, 0, 0, '#e9e9e6', { rough: 0.4 });
  box(g, w - 0.04, 0.004, 0.004, 0, h * 0.5, d / 2 + 0.002, '#a7a7a3');
  return g;
}

function shelf(w: number, d: number, h: number, c: string): THREE.Group {
  const g = new THREE.Group();
  box(g, 0.02, h, d, -w / 2 + 0.01, 0, 0, c);
  box(g, 0.02, h, d, w / 2 - 0.01, 0, 0, c);
  const n = Math.max(2, Math.round(h / 0.38));
  for (let i = 0; i <= n; i++) box(g, w - 0.04, 0.02, d, 0, Math.min(h - 0.02, (h / n) * i), 0, c);
  const colors = ['#7d4b3a', '#365a7a', '#a6894d', '#55704a', '#8a8f94'];
  for (let i = 0; i < n; i++) {
    let x = -w / 2 + 0.04;
    let k = i;
    while (x < w / 2 - 0.12) {
      const bw = 0.03 + ((k * 7) % 5) * 0.006;
      box(g, bw, h / n - 0.08, d * 0.8, x + bw / 2, (h / n) * i + 0.02, 0, colors[k % colors.length]);
      x += bw + 0.004;
      k++;
    }
  }
  return g;
}

function rug(w: number, d: number, c: string): THREE.Group {
  const g = new THREE.Group();
  box(g, w, 0.01, d, 0, 0, 0, c, { rough: 1 });
  return g;
}

function fireplace(w: number, d: number, h: number): THREE.Group {
  const g = new THREE.Group();
  box(g, w, h, d, 0, 0, 0, '#6b6e70');
  box(g, w * 0.6, h * 0.35, 0.02, 0, 0.25, d / 2 + 0.005, '#121212', { rough: 0.2 });
  box(g, w * 0.5, 0.06, 0.01, 0, 0.3, d / 2 + 0.012, '#ff8a3c', { rough: 1 });
  return g;
}

function piano(w: number, d: number, h: number): THREE.Group {
  const g = new THREE.Group();
  box(g, w, h, d * 0.55, 0, 0, -d * 0.225, '#16171a', { rough: 0.15 });
  box(g, w - 0.08, 0.04, d * 0.45, 0, 0.7, d * 0.275 - 0.02, '#16171a', { rough: 0.15 });
  box(g, w - 0.12, 0.02, 0.15, 0, 0.74, d * 0.2, WHITE, { rough: 0.2 });
  return g;
}

function heatPump(w: number, d: number, h: number): THREE.Group {
  const g = new THREE.Group();
  box(g, w, h, d, 0, 0, 0, '#f0f0ee', { rough: 0.35 });
  box(g, w * 0.5, 0.08, 0.005, 0, h * 0.8, d / 2 + 0.002, '#202426', { rough: 0.1 });
  return g;
}

function deskModel(w: number, d: number, h: number, c: string): THREE.Group {
  const g = new THREE.Group();
  box(g, w, 0.03, d, 0, h - 0.03, 0, c);
  box(g, 0.03, h - 0.03, d - 0.05, -w / 2 + 0.03, 0, 0, DARK, { metal: 0.5 });
  box(g, 0.03, h - 0.03, d - 0.05, w / 2 - 0.03, 0, 0, DARK, { metal: 0.5 });
  box(g, 0.55, 0.32, 0.02, 0, h + 0.1, -d / 2 + 0.1, '#111214', { rough: 0.15 });
  return g;
}

function officeChair(w: number, d: number, h: number, c: string): THREE.Group {
  const g = new THREE.Group();
  cyl(g, w * 0.4, 0.04, 0, 0.04, 0, DARK, { metal: 0.5 });
  cyl(g, 0.03, 0.36, 0, 0.08, 0, DARK, { metal: 0.6 });
  box(g, w * 0.9, 0.08, d * 0.85, 0, 0.44, 0, c);
  box(g, w * 0.85, h - 0.55, 0.06, 0, 0.55, -d / 2 + 0.06, c);
  return g;
}

function wardrobe(w: number, d: number, h: number, c: string): THREE.Group {
  return cabinet(w, d, h, c, Math.max(2, Math.round(w / 0.5)), 0.05);
}

const CAT: CatalogItem[] = [];
const add = (i: CatalogItem) => CAT.push(i);

// Wohnen
add({ key: 'sofa3', name: 'Sofa 3-Sitzer', category: 'Wohnen', width: 2.2, depth: 0.95, height: 0.85, color: '#6f7d8c', wallSide: true, plan: (w, d) => frame(w, d, 0.06) + R(-w / 2, -d / 2, w, 0.2) + R(-w / 2, -d / 2, 0.2, d) + R(w / 2 - 0.2, -d / 2, 0.2, d) + line(-w / 6 + 0.03, -d / 2 + 0.2, -w / 6 + 0.03, d / 2) + line(w / 6 - 0.03, -d / 2 + 0.2, w / 6 - 0.03, d / 2), model: (w, d, h, c) => sofa(w, d, h, c, 3) });
add({ key: 'sofa2', name: 'Sofa 2-Sitzer', category: 'Wohnen', width: 1.6, depth: 0.9, height: 0.85, color: '#8a6e5a', wallSide: true, plan: (w, d) => frame(w, d, 0.06) + R(-w / 2, -d / 2, w, 0.2) + R(-w / 2, -d / 2, 0.2, d) + R(w / 2 - 0.2, -d / 2, 0.2, d) + line(0, -d / 2 + 0.2, 0, d / 2), model: (w, d, h, c) => sofa(w, d, h, c, 2) });
add({ key: 'armchair', name: 'Sessel', category: 'Wohnen', width: 0.85, depth: 0.85, height: 0.85, color: '#9a6b4f', plan: (w, d) => frame(w, d, 0.08) + R(-w / 2, -d / 2, w, 0.18) + R(-w / 2, -d / 2, 0.16, d) + R(w / 2 - 0.16, -d / 2, 0.16, d), model: (w, d, h, c) => sofa(w, d, h, c, 1) });
add({ key: 'coffeetable', name: 'Couchtisch', category: 'Wohnen', width: 1.1, depth: 0.6, height: 0.42, color: WOOD, plan: (w, d) => frame(w, d, 0.02), model: (w, d, h, c) => table(w, d, h, c) });
add({ key: 'tvboard', name: 'TV-Board', category: 'Wohnen', width: 1.8, depth: 0.42, height: 0.5, color: '#ece9e3', wallSide: true, plan: (w, d) => frame(w, d) + R(-0.6, -d / 2 + 0.05, 1.2, 0.05, 'class="fill-dark"'), model: (w, d, h, c) => { const g = cabinet(w, d, h, c, 3, 0.1); box(g, Math.min(1.45, w * 0.8), 0.82, 0.04, 0, h + 0.06, -0.08, '#121315', { rough: 0.1 }); return g; } });
add({ key: 'shelf', name: 'Bücherregal', category: 'Wohnen', width: 1.0, depth: 0.35, height: 2.0, color: '#e2ded6', wallSide: true, plan: (w, d) => frame(w, d) + line(-w / 2, 0, w / 2, 0), model: (w, d, h, c) => shelf(w, d, h, c) });
add({ key: 'sideboard', name: 'Sideboard', category: 'Wohnen', width: 1.6, depth: 0.45, height: 0.8, color: '#7a5a3e', wallSide: true, plan: (w, d) => frame(w, d) + line(-w / 6, -d / 2, -w / 6, d / 2) + line(w / 6, -d / 2, w / 6, d / 2), model: (w, d, h, c) => cabinet(w, d, h, c, 3, 0.1) });
add({ key: 'fireplace', name: 'Kaminofen', category: 'Wohnen', width: 0.6, depth: 0.45, height: 1.1, color: '#6b6e70', wallSide: true, plan: (w, d) => frame(w, d) + R(-w * 0.3, -d * 0.1, w * 0.6, d * 0.5), model: (w, d, h) => fireplace(w, d, h) });
add({ key: 'piano', name: 'Klavier', category: 'Wohnen', width: 1.5, depth: 0.6, height: 1.25, color: '#16171a', wallSide: true, plan: (w, d) => frame(w, d) + R(-w / 2 + 0.05, d * 0.1, w - 0.1, 0.12), model: (w, d, h) => piano(w, d, h) });
add({ key: 'rug', name: 'Teppich', category: 'Wohnen', width: 2.0, depth: 1.4, height: 0.01, color: '#b9a48a', plan: (w, d) => frame(w, d) + R(-w / 2 + 0.08, -d / 2 + 0.08, w - 0.16, d - 0.16), model: (w, d, _h, c) => rug(w, d, c) });
add({ key: 'plant', name: 'Zimmerpflanze', category: 'Wohnen', width: 0.5, depth: 0.5, height: 1.2, color: '#4f7f45', plan: (w) => circ(0, 0, w / 2) + circ(0, 0, w * 0.2), model: (w, _d, h) => plant(w, h) });

// Essen
add({ key: 'dining4', name: 'Esstisch 4 Personen', category: 'Essen', width: 1.4, depth: 0.85, height: 0.75, color: WOOD, plan: (w, d) => frame(w, d, 0.02), model: (w, d, h, c) => table(w, d, h, c) });
add({ key: 'dining6', name: 'Esstisch 6 Personen', category: 'Essen', width: 2.0, depth: 0.95, height: 0.75, color: WOOD, plan: (w, d) => frame(w, d, 0.02), model: (w, d, h, c) => table(w, d, h, c) });
add({ key: 'roundtable', name: 'Runder Tisch', category: 'Essen', width: 1.1, depth: 1.1, height: 0.75, color: '#d8c9b0', plan: (w) => circ(0, 0, w / 2), model: (w, d, h, c) => table(w, d, h, c, true) });
add({ key: 'chair', name: 'Stuhl', category: 'Essen', width: 0.45, depth: 0.5, height: 0.9, color: '#8b6a4a', plan: (w, d) => frame(w, d, 0.03) + R(-w / 2, -d / 2, w, 0.06), model: (w, d, h, c) => chair(w, d, h, c) });

// Küche
add({ key: 'kbase60', name: 'Unterschrank 60', category: 'Küche', width: 0.6, depth: 0.6, height: 0.9, color: WHITE, wallSide: true, plan: (w, d) => frame(w, d) + line(-w / 2, d / 2 - 0.04, w / 2, d / 2 - 0.04), model: (w, d, h, c) => cabinet(w, d, h, c, 1, 0.12, '#5b5853') });
add({ key: 'kbase120', name: 'Unterschrank 120', category: 'Küche', width: 1.2, depth: 0.6, height: 0.9, color: WHITE, wallSide: true, plan: (w, d) => frame(w, d) + line(-w / 2, d / 2 - 0.04, w / 2, d / 2 - 0.04) + line(0, -d / 2, 0, d / 2), model: (w, d, h, c) => cabinet(w, d, h, c, 2, 0.12, '#5b5853') });
add({ key: 'ksink', name: 'Spülenschrank', category: 'Küche', width: 0.9, depth: 0.6, height: 0.9, color: WHITE, wallSide: true, plan: (w, d) => frame(w, d) + R(-w * 0.35, -d * 0.28, w * 0.7, d * 0.5, 'rx="0.04"') + circ(0, -d * 0.36, 0.03), model: (w, d, h, c) => { const g = cabinet(w, d, h, c, 2, 0.12, '#5b5853'); box(g, w * 0.7, 0.012, d * 0.5, 0, h - 0.01, 0.02, STEEL, { metal: 0.9, rough: 0.2 }); cyl(g, 0.015, 0.3, 0, h, -d / 2 + 0.07, STEEL, { metal: 0.9, rough: 0.2 }); return g; } });
add({ key: 'kstove', name: 'Herd mit Backofen', category: 'Küche', width: 0.6, depth: 0.6, height: 0.9, color: '#d9dadb', wallSide: true, plan: (w, d) => frame(w, d) + circ(-w * 0.23, -d * 0.2, 0.08) + circ(w * 0.23, -d * 0.2, 0.08) + circ(-w * 0.23, d * 0.2, 0.08) + circ(w * 0.23, d * 0.2, 0.08), model: (w, d, h, c) => appliance(w, d, h, c, 'stove') });
add({ key: 'fridge', name: 'Kühlschrank', category: 'Küche', width: 0.6, depth: 0.65, height: 1.85, color: '#e6e7e8', wallSide: true, plan: (w, d) => frame(w, d) + line(-w / 2, d / 2 - 0.05, w / 2, d / 2 - 0.05) + `<text x="0" y="0.05" class="sym-t">KS</text>`, model: (w, d, h, c) => appliance(w, d, h, c, 'fridge') });
add({ key: 'ktall', name: 'Hochschrank', category: 'Küche', width: 0.6, depth: 0.6, height: 2.2, color: WHITE, wallSide: true, plan: (w, d) => frame(w, d) + line(-w / 2, -d / 2, w / 2, d / 2) + line(w / 2, -d / 2, -w / 2, d / 2), model: (w, d, h, c) => cabinet(w, d, h, c, 1, 0.12) });
add({ key: 'kisland', name: 'Kücheninsel', category: 'Küche', width: 1.8, depth: 0.9, height: 0.92, color: '#4c5a66', plan: (w, d) => frame(w, d) + R(-w / 2 + 0.05, -d / 2 + 0.05, w - 0.1, d - 0.1), model: (w, d, h, c) => cabinet(w, d, h, c, 3, 0.12, '#e8e4dc') });
add({ key: 'kwall', name: 'Hängeschrank', category: 'Küche', width: 0.6, depth: 0.35, height: 0.72, elevation: 1.45, color: WHITE, wallSide: true, plan: (w, d) => `<g class="dashed">${frame(w, d)}</g>`, model: (w, d, h, c) => cabinet(w, d, h, c, 1, 0) });
add({ key: 'dishwasher', name: 'Geschirrspüler', category: 'Küche', width: 0.6, depth: 0.6, height: 0.9, color: '#d9dadb', wallSide: true, plan: (w, d) => frame(w, d) + `<text x="0" y="0.05" class="sym-t">GS</text>`, model: (w, d, h, c) => appliance(w, d, h, c, 'dishwasher') });

// Schlafen
add({ key: 'bed180', name: 'Doppelbett 180 × 200', category: 'Schlafen', width: 1.8, depth: 2.1, height: 0.95, color: '#b9a088', wallSide: true, plan: (w, d) => frame(w, d) + R(-w / 2 + 0.1, -d / 2 + 0.1, w / 2 - 0.15, 0.4, 'rx="0.06"') + R(0.05, -d / 2 + 0.1, w / 2 - 0.15, 0.4, 'rx="0.06"') + line(-w / 2, -d / 2 + 0.7, w / 2, -d / 2 + 0.7), model: (w, d, h, c) => bed(w, d, h, c) });
add({ key: 'bed140', name: 'Doppelbett 140 × 200', category: 'Schlafen', width: 1.4, depth: 2.1, height: 0.95, color: '#c9b49a', wallSide: true, plan: (w, d) => frame(w, d) + R(-w / 2 + 0.1, -d / 2 + 0.1, w / 2 - 0.15, 0.4, 'rx="0.06"') + R(0.05, -d / 2 + 0.1, w / 2 - 0.15, 0.4, 'rx="0.06"') + line(-w / 2, -d / 2 + 0.7, w / 2, -d / 2 + 0.7), model: (w, d, h, c) => bed(w, d, h, c) });
add({ key: 'bed90', name: 'Einzelbett 90 × 200', category: 'Schlafen', width: 0.95, depth: 2.05, height: 0.9, color: '#c9b49a', wallSide: true, plan: (w, d) => frame(w, d) + R(-w / 2 + 0.1, -d / 2 + 0.1, w - 0.2, 0.4, 'rx="0.06"') + line(-w / 2, -d / 2 + 0.7, w / 2, -d / 2 + 0.7), model: (w, d, h, c) => bed(w, d, h, c) });
add({ key: 'nightstand', name: 'Nachttisch', category: 'Schlafen', width: 0.45, depth: 0.4, height: 0.5, color: '#b9a088', wallSide: true, plan: (w, d) => frame(w, d), model: (w, d, h, c) => cabinet(w, d, h, c, 1, 0.06) });
add({ key: 'wardrobe', name: 'Kleiderschrank', category: 'Schlafen', width: 2.0, depth: 0.6, height: 2.2, color: '#ece9e3', wallSide: true, plan: (w, d) => frame(w, d) + line(-w / 2, d / 2 - 0.04, w / 2, d / 2 - 0.04) + line(-w / 2 + 0.05, 0, w / 2 - 0.05, 0), model: (w, d, h, c) => wardrobe(w, d, h, c) });
add({ key: 'dresser', name: 'Kommode', category: 'Schlafen', width: 1.2, depth: 0.5, height: 0.85, color: '#ece9e3', wallSide: true, plan: (w, d) => frame(w, d) + line(0, -d / 2, 0, d / 2), model: (w, d, h, c) => cabinet(w, d, h, c, 2, 0.06) });

// Bad
add({ key: 'bathtub', name: 'Badewanne 170 × 75', category: 'Bad', width: 1.7, depth: 0.75, height: 0.58, color: WHITE, wallSide: true, plan: (w, d) => frame(w, d) + R(-w / 2 + 0.07, -d / 2 + 0.07, w - 0.14, d - 0.14, `rx="${Math.min(0.25, d / 3)}"`) + circ(-w / 2 + 0.2, 0, 0.03), model: (w, d, h) => bathtub(w, d, h) });
add({ key: 'shower', name: 'Dusche 90 × 90', category: 'Bad', width: 0.9, depth: 0.9, height: 2.0, color: WHITE, wallSide: true, plan: (w, d) => frame(w, d) + line(-w / 2, -d / 2, w / 2, d / 2) + line(w / 2, -d / 2, -w / 2, d / 2) + circ(0, 0, 0.04), model: (w, d, h) => shower(w, d, h) });
add({ key: 'wc', name: 'WC wandhängend', category: 'Bad', width: 0.38, depth: 0.55, height: 0.4, color: WHITE, wallSide: true, plan: (w, d) => R(-w / 2, -d / 2, w, 0.16) + ell(0, 0.06, w * 0.46, (d - 0.16) / 2), model: (w, d) => wc(w, d) });
add({ key: 'basin', name: 'Waschtisch', category: 'Bad', width: 0.8, depth: 0.48, height: 0.85, color: '#8d6e52', wallSide: true, plan: (w, d) => frame(w, d) + ell(0, 0.02, 0.2, d * 0.3), model: (w, d, h) => basin(w, d, h) });
add({ key: 'basin2', name: 'Doppelwaschtisch', category: 'Bad', width: 1.4, depth: 0.5, height: 0.85, color: '#8d6e52', wallSide: true, plan: (w, d) => frame(w, d) + ell(-w / 4, 0.02, 0.18, d * 0.3) + ell(w / 4, 0.02, 0.18, d * 0.3), model: (w, d, h) => basin(w, d, h, true) });
add({ key: 'washer', name: 'Waschmaschine', category: 'Bad', width: 0.6, depth: 0.6, height: 0.85, color: WHITE, wallSide: true, plan: (w, d) => frame(w, d) + circ(0, 0.04, 0.18), model: (w, d, h, c) => appliance(w, d, h, c, 'washer') });

// Arbeiten
add({ key: 'desk', name: 'Schreibtisch', category: 'Arbeiten', width: 1.6, depth: 0.8, height: 0.74, color: '#e8e4dc', wallSide: true, plan: (w, d) => frame(w, d) + R(-0.28, -d / 2 + 0.06, 0.56, 0.04, 'class="fill-dark"'), model: (w, d, h, c) => deskModel(w, d, h, c) });
add({ key: 'officechair', name: 'Bürostuhl', category: 'Arbeiten', width: 0.62, depth: 0.62, height: 1.1, color: '#2e3338', plan: (w, d) => circ(0, 0, w / 2) + R(-w * 0.4, -d / 2, w * 0.8, 0.1), model: (w, d, h, c) => officeChair(w, d, h, c) });

// Haustechnik
add({ key: 'manifold', name: 'Heizkreisverteiler', category: 'Haustechnik', width: 0.75, depth: 0.15, height: 0.75, elevation: 0.3, color: '#e9e9e6', wallSide: true, plan: (w, d) => frame(w, d) + `<text x="0" y="0.04" class="sym-t">HKV</text>`, model: (w, d, h) => manifold(w, d, h) });
add({ key: 'heatpump', name: 'Wärmepumpe Innengerät', category: 'Haustechnik', width: 0.6, depth: 0.7, height: 1.8, color: '#f0f0ee', wallSide: true, plan: (w, d) => frame(w, d) + `<text x="0" y="0.05" class="sym-t">WP</text>`, model: (w, d, h) => heatPump(w, d, h) });
add({ key: 'radiator', name: 'Heizkörper', category: 'Haustechnik', width: 1.0, depth: 0.1, height: 0.6, elevation: 0.15, color: WHITE, wallSide: true, plan: (w, d) => frame(w, d) + line(-w / 2, 0, w / 2, 0), model: (w, d, h) => radiator(w, d, h) });

// Außen
add({ key: 'car', name: 'Auto', category: 'Außen', width: 1.85, depth: 4.6, height: 1.45, color: '#2f4f6f', plan: (w, d) => frame(w, d, 0.3) + R(-w / 2 + 0.12, -d * 0.18, w - 0.24, d * 0.42, 'rx="0.12"'), model: (w, d, h, c) => car(w, d, h, c) });
add({ key: 'gardentable', name: 'Gartentisch mit Bänken', category: 'Außen', width: 1.8, depth: 1.5, height: 0.75, color: '#8a6a45', plan: (w, d) => R(-w / 2, -0.4, w, 0.8) + R(-w / 2, -d / 2, w, 0.28) + R(-w / 2, d / 2 - 0.28, w, 0.28), model: (w, d, h, c) => { const g = table(w, 0.8, h, c); box(g, w, 0.04, 0.28, 0, 0.44, -d / 2 + 0.14, c); box(g, w, 0.04, 0.28, 0, 0.44, d / 2 - 0.14, c); legs(g, w, d, 0.44, 0.05, 0.1, shade(c, 0.8)); return g; } });

export const CATALOG: CatalogItem[] = CAT;
export const CATALOG_BY_KEY: Record<string, CatalogItem> = Object.fromEntries(CAT.map((c) => [c.key, c]));
export const CATEGORIES: string[] = [...new Set(CAT.map((c) => c.category))];

/** Vorschaubild als kleines SVG (Planzeichen) */
export function catalogIcon(item: CatalogItem): string {
  const s = Math.max(item.width, item.depth) * 1.12;
  return `<svg viewBox="${-s / 2} ${-s / 2} ${s} ${s}" class="cat-icon"><g class="sym" style="stroke-width:${s / 40}">${item.plan(item.width, item.depth)}</g></svg>`;
}
