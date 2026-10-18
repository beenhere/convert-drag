// Tiny DOM helpers shared by the editor tools.

export function h(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of [].concat(children)) if (c != null) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

export function icon(name, size = 16) {
  const span = document.createElement('span');
  span.style.display = 'inline-flex';
  span.innerHTML = window.Icons.icon(name, size);
  return span;
}

/** Fit a w×h box inside the container with a margin; returns position and scale. */
export function fitRect(w, h, cw, ch, margin = 20) {
  const s = Math.max(0.0001, Math.min((cw - margin * 2) / w, (ch - margin * 2) / h));
  const width = w * s;
  const height = h * s;
  return { left: (cw - width) / 2, top: (ch - height) / 2, width, height, scale: s };
}

export function place(el, r) {
  el.style.left = `${r.left}px`;
  el.style.top = `${r.top}px`;
  el.style.width = `${r.width}px`;
  el.style.height = `${r.height}px`;
}

/** Labelled range slider row. */
export function slider({ label, min, max, step = 1, value, unit = '', onInput, format }) {
  const input = h('input', { type: 'range', min, max, step, value, 'aria-label': label });
  const out = h('span', { class: 'value' });
  const show = () => {
    const v = Number(input.value);
    out.textContent = format ? format(v) : `${v}${unit}`;
    input.style.setProperty('--fill', `${((v - min) / (max - min || 1)) * 100}%`);
  };
  input.addEventListener('input', () => {
    show();
    onInput(Number(input.value));
  });
  show();
  const row = h('div', { class: 'row' }, [h('span', { class: 'label' }, label), input, out]);
  row.set = (v) => {
    input.value = String(v);
    show();
  };
  return row;
}

/** Segmented control. options: [{value, label, icon?, title?}] */
export function segmented(options, value, onChange, ariaLabel) {
  const wrap = h('div', { class: 'seg', role: 'group', 'aria-label': ariaLabel || '' });
  const buttons = options.map((o) => {
    const b = h('button', { type: 'button', title: o.title || o.label, 'aria-pressed': String(o.value === value) }, [o.icon ? icon(o.icon, 15) : null, o.label != null ? h('span', {}, o.label) : null]);
    b.addEventListener('click', () => {
      wrap.set(o.value);
      onChange(o.value);
    });
    wrap.append(b);
    return b;
  });
  wrap.set = (v) => buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(options[i].value === v)));
  return wrap;
}

export function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

export function onResize(el, fn) {
  const ro = new ResizeObserver(() => fn());
  ro.observe(el);
  return ro;
}
