// Rasteroperationen auf Binärmasken (1 = belegt): Morphologie mit quadratischem Strukturelement,
// Zusammenhangskomponenten und Konturverfolgung entlang der Zellkanten.

export interface Mask {
  W: number;
  H: number;
  data: Uint8Array;
}

/** Schwellwert nach Otsu für Grauwerte 0…255 */
export function otsu(gray: Uint8Array): number {
  const hist = new Float64Array(256);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  const total = gray.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let thr = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      thr = t;
    }
  }
  return thr;
}

function pass1D(src: Uint8Array, W: number, H: number, r: number, horizontal: boolean, mode: 'min' | 'max'): Uint8Array {
  const out = new Uint8Array(W * H);
  const n = horizontal ? W : H;
  const m = horizontal ? H : W;
  const idx = (line: number, k: number) => (horizontal ? line * W + k : k * W + line);
  const pre = new Int32Array(n + 1);
  for (let line = 0; line < m; line++) {
    pre[0] = 0;
    for (let k = 0; k < n; k++) pre[k + 1] = pre[k] + src[idx(line, k)];
    for (let k = 0; k < n; k++) {
      const a = Math.max(0, k - r);
      const b = Math.min(n - 1, k + r);
      const s = pre[b + 1] - pre[a];
      // außerhalb des Rasters gilt als frei
      if (mode === 'max') out[idx(line, k)] = s > 0 ? 1 : 0;
      else out[idx(line, k)] = s === 2 * r + 1 ? 1 : 0;
    }
  }
  return out;
}

export function dilate(m: Mask, r: number): Mask {
  if (r <= 0) return { ...m, data: m.data.slice() };
  const h = pass1D(m.data, m.W, m.H, r, true, 'max');
  return { W: m.W, H: m.H, data: pass1D(h, m.W, m.H, r, false, 'max') };
}

export function erode(m: Mask, r: number): Mask {
  if (r <= 0) return { ...m, data: m.data.slice() };
  const h = pass1D(m.data, m.W, m.H, r, true, 'min');
  return { W: m.W, H: m.H, data: pass1D(h, m.W, m.H, r, false, 'min') };
}

function pad(m: Mask, p: number): Mask {
  const W = m.W + 2 * p;
  const H = m.H + 2 * p;
  const data = new Uint8Array(W * H);
  for (let j = 0; j < m.H; j++) data.set(m.data.subarray(j * m.W, (j + 1) * m.W), (j + p) * W + p);
  return { W, H, data };
}

function crop(m: Mask, p: number, W: number, H: number): Mask {
  const data = new Uint8Array(W * H);
  for (let j = 0; j < H; j++) data.set(m.data.subarray((j + p) * m.W + p, (j + p) * m.W + p + W), j * W);
  return { W, H, data };
}

/** Öffnen und Schließen auf der unendlichen Ebene (außerhalb des Bildes frei) */
export const open = (m: Mask, r: number): Mask => crop(dilate(erode(pad(m, r + 2), r), r), r + 2, m.W, m.H);
export const close = (m: Mask, r: number): Mask => crop(erode(dilate(pad(m, r + 2), r), r), r + 2, m.W, m.H);

/** Flutung der freien Zellen (data = 0) ab dem Bildrand → 1 = außen */
export function floodOutside(m: Mask): Uint8Array {
  const { W, H, data } = m;
  const out = new Uint8Array(W * H);
  const stack: number[] = [];
  const seed = (k: number) => {
    if (!data[k] && !out[k]) {
      out[k] = 1;
      stack.push(k);
    }
  };
  for (let i = 0; i < W; i++) {
    seed(i);
    seed((H - 1) * W + i);
  }
  for (let j = 0; j < H; j++) {
    seed(j * W);
    seed(j * W + W - 1);
  }
  while (stack.length) {
    const k = stack.pop()!;
    const i = k % W;
    if (i > 0) seed(k - 1);
    if (i < W - 1) seed(k + 1);
    if (k >= W) seed(k - W);
    if (k < W * (H - 1)) seed(k + W);
  }
  return out;
}

/** 4-Zusammenhangskomponenten der Zellen mit sel(k) = true; liefert Label-Feld und Größen. */
export function components(W: number, H: number, sel: (k: number) => boolean): { labels: Int32Array; sizes: number[] } {
  const labels = new Int32Array(W * H).fill(-1);
  const sizes: number[] = [];
  const stack: number[] = [];
  for (let k0 = 0; k0 < W * H; k0++) {
    if (labels[k0] >= 0 || !sel(k0)) continue;
    const id = sizes.length;
    let n = 0;
    labels[k0] = id;
    stack.push(k0);
    while (stack.length) {
      const k = stack.pop()!;
      n++;
      const i = k % W;
      const nb = [i > 0 ? k - 1 : -1, i < W - 1 ? k + 1 : -1, k >= W ? k - W : -1, k < W * (H - 1) ? k + W : -1];
      for (const q of nb) {
        if (q >= 0 && labels[q] < 0 && sel(q)) {
          labels[q] = id;
          stack.push(q);
        }
      }
    }
    sizes.push(n);
  }
  return { labels, sizes };
}

/**
 * Außenkontur einer 4-zusammenhängenden Zellmenge (isIn) als Eckpunktfolge in Rasterkoordinaten.
 * Startet an der Oberkante der obersten, linkesten Zelle; gefüllte Zellen bleiben rechts.
 */
export function traceContour(W: number, H: number, isIn: (i: number, j: number) => boolean, start: number): { x: number; y: number }[] {
  const si = start % W;
  const sj = (start - si) / W;
  const f = (i: number, j: number) => i >= 0 && j >= 0 && i < W && j < H && isIn(i, j);
  const DX = [1, 0, -1, 0];
  const DY = [0, 1, 0, -1];
  const aheadRight = (x: number, y: number, d: number) => (d === 0 ? f(x, y) : d === 1 ? f(x - 1, y) : d === 2 ? f(x - 1, y - 1) : f(x, y - 1));
  const aheadLeft = (x: number, y: number, d: number) => (d === 0 ? f(x, y - 1) : d === 1 ? f(x, y) : d === 2 ? f(x - 1, y) : f(x - 1, y - 1));
  let x = si + 1;
  let y = sj;
  let d = 0;
  const pts = [{ x: si, y: sj }];
  const maxSteps = 8 * (W + H) * 40;
  for (let step = 0; step < maxSteps; step++) {
    if (x === si && y === sj) break;
    let nd = d;
    if (!aheadRight(x, y, d)) nd = (d + 1) % 4;
    else if (aheadLeft(x, y, d)) nd = (d + 3) % 4;
    if (nd !== d) pts.push({ x, y });
    d = nd;
    x += DX[d];
    y += DY[d];
  }
  return pts;
}
