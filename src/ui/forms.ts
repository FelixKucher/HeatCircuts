import { esc, numInput, parseNum } from './format';

export type FieldSpec =
  | { kind: 'num'; key: string; label: string; value: number | null; unit?: string; digits?: number; placeholder?: string; hint?: string; scale?: number }
  | { kind: 'text'; key: string; label: string; value: string; placeholder?: string; wide?: boolean }
  | { kind: 'textarea'; key: string; label: string; value: string }
  | { kind: 'select'; key: string; label: string; value: string; options: [string, string][] | { group: string; options: [string, string][] }[]; hint?: string }
  | { kind: 'check'; key: string; label: string; value: boolean }
  | { kind: 'range'; key: string; label: string; value: number; min: number; max: number; step: number; display: string }
  | { kind: 'readout'; label: string; value: string; tone?: 'warn' | 'ok' | 'muted' };

export function fieldHtml(s: FieldSpec, prefix: string): string {
  if (s.kind === 'readout') {
    return `<div class="field readout${s.tone ? ` tone-${s.tone}` : ''}"><span class="lab">${esc(s.label)}</span><span class="val">${esc(s.value)}</span></div>`;
  }
  const id = `${prefix}-${s.key}`.replace(/[^\w-]/g, '_');
  switch (s.kind) {
    case 'num': {
      const sc = s.scale ?? 1;
      const val = s.value == null ? '' : numInput(s.value * sc, s.digits ?? 3);
      return `<label class="field" for="${id}"><span class="lab">${esc(s.label)}</span><span class="inp-wrap"><input id="${id}" data-key="${s.key}" data-kind="num" data-scale="${sc}" type="text" inputmode="decimal" autocomplete="off" value="${esc(val)}" placeholder="${esc(s.placeholder ?? '')}"/>${s.unit ? `<span class="unit">${esc(s.unit)}</span>` : ''}</span>${s.hint ? `<span class="hint">${esc(s.hint)}</span>` : ''}</label>`;
    }
    case 'text':
      return `<label class="field${s.wide ? ' wide' : ''}" for="${id}"><span class="lab">${esc(s.label)}</span><input id="${id}" data-key="${s.key}" data-kind="text" type="text" autocomplete="off" value="${esc(s.value)}" placeholder="${esc(s.placeholder ?? '')}"/></label>`;
    case 'textarea':
      return `<label class="field wide" for="${id}"><span class="lab">${esc(s.label)}</span><textarea id="${id}" data-key="${s.key}" data-kind="text" rows="3">${esc(s.value)}</textarea></label>`;
    case 'select': {
      const opts = s.options
        .map((o) =>
          Array.isArray(o)
            ? `<option value="${esc(o[0])}"${o[0] === s.value ? ' selected' : ''}>${esc(o[1])}</option>`
            : `<optgroup label="${esc(o.group)}">${o.options.map(([k, l]) => `<option value="${esc(k)}"${k === s.value ? ' selected' : ''}>${esc(l)}</option>`).join('')}</optgroup>`,
        )
        .join('');
      return `<label class="field" for="${id}"><span class="lab">${esc(s.label)}</span><select id="${id}" data-key="${s.key}" data-kind="select">${opts}</select>${s.hint ? `<span class="hint">${esc(s.hint)}</span>` : ''}</label>`;
    }
    case 'check':
      return `<label class="field check" for="${id}"><input id="${id}" data-key="${s.key}" data-kind="check" type="checkbox"${s.value ? ' checked' : ''}/><span class="lab">${esc(s.label)}</span></label>`;
    case 'range':
      return `<label class="field" for="${id}"><span class="lab">${esc(s.label)} <b>${esc(s.display)}</b></span><input id="${id}" data-key="${s.key}" data-kind="range" type="range" min="${s.min}" max="${s.max}" step="${s.step}" value="${s.value}"/></label>`;
  }
}

export type FieldValue = string | number | boolean | null;

/** Delegiert Änderungen aller Felder in `root` an `apply(key, value)`. */
export function bindFields(root: HTMLElement, apply: (key: string, value: FieldValue, el: HTMLElement, live: boolean) => void): void {
  const handler = (e: Event) => {
    const el = e.target as HTMLInputElement | HTMLSelectElement;
    const key = el.dataset?.key;
    if (!key) return;
    const kind = el.dataset.kind;
    if (e.type === 'input' && kind !== 'range') return;
    let value: FieldValue;
    if (kind === 'num') {
      const raw = el.value.trim();
      if (raw === '') value = null;
      else {
        const n = parseNum(raw);
        if (n === null) {
          el.classList.add('invalid');
          return;
        }
        value = n / Number(el.dataset.scale || 1);
      }
      el.classList.remove('invalid');
    } else if (kind === 'check') value = (el as HTMLInputElement).checked;
    else if (kind === 'range') value = Number(el.value);
    else value = el.value;
    apply(key, value, el, e.type === 'input');
  };
  root.addEventListener('change', handler);
  root.addEventListener('input', handler);
  root.addEventListener('keydown', (e) => {
    const el = e.target as HTMLElement;
    if (e.key === 'Enter' && el.tagName === 'INPUT') (el as HTMLInputElement).blur();
  });
}
