import { h, fitRect, place, segmented, clamp, onResize } from '../dom.js';

const RATIOS = [
  { value: 'free', label: 'Free' },
  { value: 'original', label: 'Original' },
  { value: '1:1', label: '1:1' },
  { value: '4:3', label: '4:3' },
  { value: '3:2', label: '3:2' },
  { value: '16:9', label: '16:9' },
  { value: '9:16', label: '9:16' },
  { value: '4:5', label: '4:5' },
];
const MIN = 8;

export function mount({ info, stage, controls }) {
  const W = info.width;
  const H = info.height;
  let rect = { x: 0, y: 0, w: W, h: H };
  let ratioKey = 'free';
  let view = { left: 0, top: 0, width: 1, height: 1, scale: 1 };

  const img = h('img', { src: info.preview.url, alt: '' });
  const size = h('div', { class: 'crop-size' });
  const box = h('div', { class: 'crop-box' }, [h('div', { class: 'grid' }), ...['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map((d) => h('div', { class: 'h', 'data-h': d })), size]);
  const fit = h('div', { class: 'fit' }, [img, box]);
  stage.append(fit);

  const ratio = () => {
    if (ratioKey === 'free') return null;
    if (ratioKey === 'original') return W / H;
    const [a, b] = ratioKey.split(':').map(Number);
    return a / b;
  };

  function layout() {
    view = fitRect(W, H, stage.clientWidth, stage.clientHeight, 28);
    place(fit, view);
    draw();
  }

  function draw() {
    const s = view.scale;
    place(box, { left: rect.x * s, top: rect.y * s, width: rect.w * s, height: rect.h * s });
    size.textContent = `${Math.round(rect.w)} × ${Math.round(rect.h)}`;
    wInput.value = String(Math.round(rect.w));
    hInput.value = String(Math.round(rect.h));
  }

  function toImage(e) {
    const r = fit.getBoundingClientRect();
    return { x: clamp((e.clientX - r.left) / view.scale, 0, W), y: clamp((e.clientY - r.top) / view.scale, 0, H) };
  }

  /** Largest rect of the given ratio centered on (cx, cy) that fits the image. */
  function centered(r, cx = W / 2, cy = H / 2, maxW = W, maxH = H) {
    let w = maxW;
    let hh = w / r;
    if (hh > maxH) {
      hh = maxH;
      w = hh * r;
    }
    const x = clamp(cx - w / 2, 0, W - w);
    const y = clamp(cy - hh / 2, 0, H - hh);
    return { x, y, w, h: hh };
  }

  let drag = null;
  fit.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    fit.setPointerCapture(e.pointerId);
    const p = toImage(e);
    const handle = e.target.dataset?.h;
    if (handle) drag = { mode: handle, start: p, r0: { ...rect } };
    else if (e.target === box || box.contains(e.target)) drag = { mode: 'move', start: p, r0: { ...rect } };
    else drag = { mode: 'new', start: p, r0: { x: p.x, y: p.y, w: 0, h: 0 } };
  });

  fit.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const p = toImage(e);
    const r = ratio();
    const { r0, start } = drag;
    if (drag.mode === 'move') {
      rect = { ...r0, x: clamp(r0.x + p.x - start.x, 0, W - r0.w), y: clamp(r0.y + p.y - start.y, 0, H - r0.h) };
    } else if (drag.mode === 'new') {
      rect = fromCorners(start, p, r);
    } else {
      rect = resizeEdges(drag.mode, r0, p, r);
    }
    draw();
  });

  const end = () => {
    drag = null;
    if (rect.w < MIN || rect.h < MIN) {
      rect = ratio() ? centered(ratio()) : { x: 0, y: 0, w: W, h: H };
      draw();
    }
  };
  fit.addEventListener('pointerup', end);
  fit.addEventListener('pointercancel', end);

  function fromCorners(a, b, r) {
    let w = Math.abs(b.x - a.x);
    let hh = Math.abs(b.y - a.y);
    if (r) {
      if (w / hh > r) w = hh * r;
      else hh = w / r;
    }
    const x = b.x < a.x ? a.x - w : a.x;
    const y = b.y < a.y ? a.y - hh : a.y;
    return bound({ x, y, w, h: hh }, r, a);
  }

  function resizeEdges(mode, r0, p, r) {
    let left = r0.x;
    let top = r0.y;
    let right = r0.x + r0.w;
    let bottom = r0.y + r0.h;
    if (mode.includes('w')) left = p.x;
    if (mode.includes('e')) right = p.x;
    if (mode.includes('n')) top = p.y;
    if (mode.includes('s')) bottom = p.y;
    if (left > right) [left, right] = [right, left];
    if (top > bottom) [top, bottom] = [bottom, top];
    let next = { x: left, y: top, w: right - left, h: bottom - top };
    if (!r) return bound(next);
    const corner = mode.length === 2;
    if (corner) {
      const anchor = { x: mode.includes('w') ? r0.x + r0.w : r0.x, y: mode.includes('n') ? r0.y + r0.h : r0.y };
      return fromCorners(anchor, p, r);
    }
    if (mode === 'n' || mode === 's') {
      const w = next.h * r;
      next = { ...next, x: r0.x + r0.w / 2 - w / 2, w };
    } else {
      const hh = next.w / r;
      next = { ...next, y: r0.y + r0.h / 2 - hh / 2, h: hh };
    }
    return bound(next, r);
  }

  /** Keep a rect inside the image, shrinking (keeping ratio) if needed. */
  function bound(r, ratioValue, anchor) {
    let { x, y, w, h: hh } = r;
    if (ratioValue) {
      const maxW = anchor ? (x < anchor.x - 0.01 ? anchor.x : W - anchor.x) : W;
      const maxH = anchor ? (y < anchor.y - 0.01 ? anchor.y : H - anchor.y) : H;
      const k = Math.min(1, maxW / (w || 1), maxH / (hh || 1));
      w *= k;
      hh *= k;
      if (anchor) {
        x = x < anchor.x - 0.01 ? anchor.x - w : anchor.x;
        y = y < anchor.y - 0.01 ? anchor.y - hh : anchor.y;
      }
    } else {
      x = clamp(x, 0, W);
      y = clamp(y, 0, H);
      w = Math.min(w, W - x);
      hh = Math.min(hh, H - y);
    }
    return { x: clamp(x, 0, W - w), y: clamp(y, 0, H - hh), w, h: hh };
  }

  // Controls
  const seg = segmented(
    RATIOS,
    ratioKey,
    (v) => {
      ratioKey = v;
      const r = ratio();
      if (r) rect = centered(r, rect.x + rect.w / 2, rect.y + rect.h / 2);
      draw();
    },
    'Aspect ratio',
  );
  const wInput = h('input', { type: 'number', min: 1, max: W, 'aria-label': 'Width' });
  const hInput = h('input', { type: 'number', min: 1, max: H, 'aria-label': 'Height' });
  const applySize = (which) => {
    const r = ratio();
    let w = clamp(Number(wInput.value) || rect.w, MIN, W);
    let hh = clamp(Number(hInput.value) || rect.h, MIN, H);
    if (r) {
      if (which === 'w') hh = w / r;
      else w = hh * r;
    }
    rect = bound({ x: rect.x + (rect.w - w) / 2, y: rect.y + (rect.h - hh) / 2, w, h: hh }, r);
    draw();
  };
  wInput.addEventListener('change', () => applySize('w'));
  hInput.addEventListener('change', () => applySize('h'));

  controls.append(
    h('div', { class: 'row' }, [h('span', { class: 'label' }, 'Aspect ratio'), seg]),
    h('div', { class: 'row' }, [h('span', { class: 'label' }, 'Size'), wInput, h('span', { style: { color: 'var(--muted)' } }, '×'), hInput, h('span', { style: { color: 'var(--muted)' } }, 'px')]),
  );

  onResize(stage, layout);
  img.addEventListener('load', layout);
  layout();

  return {
    params: () => ({ x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.w), height: Math.round(rect.h) }),
    validate: () => (rect.w === W && rect.h === H ? 'Drag on the image to choose an area' : null),
    reset() {
      ratioKey = 'free';
      seg.set('free');
      rect = { x: 0, y: 0, w: W, h: H };
      draw();
    },
    demo() {
      rect = { x: W * 0.12, y: H * 0.1, w: W * 0.6, h: H * 0.7 };
      draw();
    },
  };
}
