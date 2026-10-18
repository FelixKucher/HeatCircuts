// Oberflächen-Bausteine: Symbole, Menüs, Dialoge, Formularfelder.

import { esc } from './plan-render';

const ic = (d: string) => `<svg viewBox="0 0 24 24" class="ico" aria-hidden="true">${d}</svg>`;
export const ICONS: Record<string, string> = {
  select: ic('<path d="M5 3l14 8-6 1.5L10 19z"/>'),
  pan: ic('<path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/>'),
  roomRect: ic('<rect x="4" y="5" width="16" height="14" class="thick"/><path d="M8 9h8v6H8z" class="fillsoft"/>'),
  wall: ic('<path d="M3 18L10 6l11 6" class="thick"/>'),
  room: ic('<path d="M4 6l9-2 7 6-3 9H6z" class="fillsoft"/>'),
  opening: ic('<path d="M3 20h18M7 20V5h8v15"/><path d="M15 20A8 8 0 0 0 7 12"/>'),
  window: ic('<rect x="4" y="5" width="16" height="14"/><path d="M12 5v14M4 12h16"/>'),
  stair: ic('<path d="M3 20h4v-4h4v-4h4V8h4V4h2"/>'),
  dimension: ic('<path d="M4 8v8M20 8v8M4 12h16M7 9l-3 3 3 3M17 9l3 3-3 3"/>'),
  label: ic('<path d="M5 6V4h14v2M12 4v16M9 20h6"/>'),
  calibrate: ic('<path d="M3 17l14-14 4 4L7 21H3z"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2"/>'),
  undo: ic('<path d="M9 7H4V2"/><path d="M4 7a9 9 0 1 1-1 7"/>'),
  redo: ic('<path d="M15 7h5V2"/><path d="M20 7a9 9 0 1 0 1 7"/>'),
  theme: ic('<path d="M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9z"/>'),
  plus: ic('<path d="M12 5v14M5 12h14"/>'),
  trash: ic('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  rotate: ic('<path d="M20 12a8 8 0 1 1-3-6.2"/><path d="M20 4v5h-5"/>'),
  copy: ic('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/>'),
  mirror: ic('<path d="M12 3v18M9 7L4 17h5zM15 7l5 10h-5z"/>'),
  eye: ic('<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
};

// ---------- Menüs ----------

export interface MenuItem {
  label: string;
  key?: string;
  act?: () => void;
  sep?: boolean;
  checked?: () => boolean;
}

export function buildMenus(host: HTMLElement, menus: { label: string; items: MenuItem[] }[]): void {
  host.innerHTML = menus.map((m, i) => `<div class="menu"><button class="menu-btn" data-menu="${i}">${esc(m.label)}</button><div class="menu-pop" hidden></div></div>`).join('');
  const closeAll = () => host.querySelectorAll<HTMLElement>('.menu-pop').forEach((p) => (p.hidden = true));
  host.querySelectorAll<HTMLButtonElement>('.menu-btn').forEach((b) => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const pop = b.nextElementSibling as HTMLElement;
      const open = !pop.hidden;
      closeAll();
      if (open) return;
      const m = menus[Number(b.dataset.menu)];
      pop.innerHTML = m.items
        .map((it, k) => (it.sep ? '<hr/>' : `<button class="menu-item" data-k="${k}">${it.checked ? `<span class="tick">${it.checked() ? '✓' : ''}</span>` : ''}<span>${esc(it.label)}</span>${it.key ? `<kbd>${esc(it.key)}</kbd>` : ''}</button>`))
        .join('');
      pop.hidden = false;
      pop.querySelectorAll<HTMLButtonElement>('.menu-item').forEach((x) =>
        x.addEventListener('click', () => {
          closeAll();
          m.items[Number(x.dataset.k)].act?.();
        }),
      );
    });
  });
  document.addEventListener('click', closeAll);
  document.addEventListener('keydown', (e) => e.key === 'Escape' && closeAll());
}

// ---------- Dialoge ----------

export function modal(title: string, body: string, buttons: { label: string; primary?: boolean; value: string }[]): Promise<{ value: string; root: HTMLElement } | null> {
  const root = document.getElementById('modal-root')!;
  root.innerHTML = `<div class="modal-back"><div class="modal" role="dialog" aria-modal="true"><h2>${esc(title)}</h2><div class="modal-body">${body}</div><div class="modal-actions">${buttons.map((b) => `<button class="btn${b.primary ? ' primary' : ''}" data-v="${esc(b.value)}">${esc(b.label)}</button>`).join('')}</div></div></div>`;
  const box = root.querySelector('.modal') as HTMLElement;
  const first = box.querySelector<HTMLInputElement>('input,select,textarea');
  setTimeout(() => {
    first?.focus();
    first?.select?.();
  }, 0);
  return new Promise((res) => {
    const done = (v: string | null) => {
      const r = v === null ? null : { value: v, root: box };
      res(r);
      setTimeout(() => (root.innerHTML = ''), 0);
    };
    box.querySelectorAll<HTMLButtonElement>('[data-v]').forEach((b) => b.addEventListener('click', () => done(b.dataset.v!)));
    root.querySelector('.modal-back')!.addEventListener('pointerdown', (e) => e.target === e.currentTarget && done(null));
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') done(null);
      if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        done(buttons.find((b) => b.primary)?.value ?? buttons[0].value);
      }
    });
  });
}

export async function askText(title: string, value: string): Promise<string | null> {
  const r = await modal(title, `<input class="wide-input" id="ask" value="${esc(value)}"/>`, [
    { label: 'Abbrechen', value: 'no' },
    { label: 'OK', value: 'ok', primary: true },
  ]);
  if (!r || r.value !== 'ok') return null;
  return (r.root.querySelector('#ask') as HTMLInputElement).value.trim() || null;
}

export async function askNumber(title: string, value: number, unit: string): Promise<number | null> {
  const r = await modal(title, `<div class="inp-unit"><input class="wide-input" id="ask" inputmode="decimal" value="${String(value).replace('.', ',')}"/><span>${esc(unit)}</span></div>`, [
    { label: 'Abbrechen', value: 'no' },
    { label: 'OK', value: 'ok', primary: true },
  ]);
  if (!r || r.value !== 'ok') return null;
  const n = parseFloat((r.root.querySelector('#ask') as HTMLInputElement).value.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export function toast(text: string): void {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = text;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('out'), 2600);
  setTimeout(() => t.remove(), 3200);
}

// ---------- Felder ----------

export type Field =
  | { t: 'num'; k: string; label: string; v: number | null; unit?: string; scale?: number; digits?: number; ph?: string; min?: number }
  | { t: 'text'; k: string; label: string; v: string }
  | { t: 'sel'; k: string; label: string; v: string; opts: [string, string][] }
  | { t: 'color'; k: string; label: string; v: string }
  | { t: 'check'; k: string; label: string; v: boolean }
  | { t: 'range'; k: string; label: string; v: number; min: number; max: number; step: number }
  | { t: 'info'; label: string; v: string; tone?: 'ok' | 'warn' };

export function fieldHtml(f: Field): string {
  switch (f.t) {
    case 'num': {
      const sc = f.scale ?? 1;
      const val = f.v == null ? '' : (Math.round(f.v * sc * 10 ** (f.digits ?? 1)) / 10 ** (f.digits ?? 1)).toString().replace('.', ',');
      return `<label class="f"><span>${esc(f.label)}</span><span class="inp-unit"><input data-k="${f.k}" data-t="num" data-scale="${sc}" inputmode="decimal" value="${val}" placeholder="${esc(f.ph ?? '')}"/>${f.unit ? `<i>${esc(f.unit)}</i>` : ''}</span></label>`;
    }
    case 'text':
      return `<label class="f"><span>${esc(f.label)}</span><input data-k="${f.k}" data-t="text" value="${esc(f.v)}"/></label>`;
    case 'sel':
      return `<label class="f"><span>${esc(f.label)}</span><select data-k="${f.k}" data-t="sel">${f.opts.map(([k, l]) => `<option value="${esc(k)}"${k === f.v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
    case 'color':
      return `<label class="f"><span>${esc(f.label)}</span><span class="color-wrap"><input type="color" data-k="${f.k}" data-t="color" value="${esc(f.v)}"/><code>${esc(f.v)}</code></span></label>`;
    case 'check':
      return `<label class="f check"><input type="checkbox" data-k="${f.k}" data-t="check"${f.v ? ' checked' : ''}/><span>${esc(f.label)}</span></label>`;
    case 'range':
      return `<label class="f"><span>${esc(f.label)}</span><input type="range" data-k="${f.k}" data-t="range" min="${f.min}" max="${f.max}" step="${f.step}" value="${f.v}"/></label>`;
    case 'info':
      return `<div class="f info${f.tone ? ` ${f.tone}` : ''}"><span>${esc(f.label)}</span><b>${esc(f.v)}</b></div>`;
  }
}

export function bindFields(root: HTMLElement, apply: (k: string, v: string | number | boolean | null, live: boolean) => void): void {
  const read = (el: HTMLInputElement | HTMLSelectElement): string | number | boolean | null => {
    const t = el.dataset.t;
    if (t === 'check') return (el as HTMLInputElement).checked;
    if (t === 'num') {
      const raw = el.value.trim();
      if (!raw) return null;
      const n = parseFloat(raw.replace(',', '.'));
      return Number.isFinite(n) ? n / Number(el.dataset.scale ?? 1) : null;
    }
    if (t === 'range') return parseFloat(el.value);
    return el.value;
  };
  root.addEventListener('change', (e) => {
    const el = e.target as HTMLInputElement;
    if (!el.dataset?.k) return;
    if (el.dataset.t === 'num' && el.value.trim() && read(el) === null) return;
    apply(el.dataset.k, read(el), false);
  });
  root.addEventListener('input', (e) => {
    const el = e.target as HTMLInputElement;
    if (!el.dataset?.k || (el.dataset.t !== 'range' && el.dataset.t !== 'color')) return;
    apply(el.dataset.k, read(el), true);
  });
  root.addEventListener('keydown', (e) => {
    const el = e.target as HTMLInputElement;
    if (e.key === 'Enter' && el.dataset?.k) el.blur();
  });
}
