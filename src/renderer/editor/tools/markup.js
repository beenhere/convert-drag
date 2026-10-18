import { h, fitRect, place, segmented, onResize, icon } from '../dom.js';

const ANNOTATE_TOOLS = [
  { value: 'arrow', label: 'Arrow' },
  { value: 'rect', label: 'Box' },
  { value: 'ellipse', label: 'Circle' },
  { value: 'pen', label: 'Pen', icon: 'pen' },
  { value: 'text', label: 'Text' },
  { value: 'highlight', label: 'Highlight' },
];
const REDACT_TOOLS = [
  { value: 'solid', label: 'Black box' },
  { value: 'pixelate', label: 'Pixelate' },
  { value: 'blur', label: 'Blur' },
];
const COLORS = ['#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#007aff', '#af52de', '#1c1c1e', '#ffffff'];
const SIZES = [
  { value: 0.6, label: 'S' },
  { value: 1, label: 'M' },
  { value: 1.8, label: 'L' },
];

export function mount({ info, tool, stage, controls }) {
  const W = info.width;
  const H = info.height;
  const redact = tool === 'redact';
  const base = Math.max(2, Math.round(Math.max(W, H) / 250));
  let shapes = [];
  let draft = null;
  let mode = redact ? 'solid' : 'arrow';
  let color = COLORS[0];
  let sizeK = 1;
  let view = { scale: 1 };

  const img = h('img', { src: info.preview.url, alt: '' });
  const fx = h('div', { class: 'markup-layer' });
  const layer = h('div', { class: 'markup-layer' });
  const hit = h('div', { class: 'markup-hit' });
  const fit = h('div', { class: 'fit' }, [img, fx, layer, hit]);
  stage.append(fit);

  function layout() {
    view = fitRect(W, H, stage.clientWidth, stage.clientHeight, 24);
    place(fit, view);
    render();
  }

  function render() {
    const all = draft ? [...shapes, draft] : shapes;
    layer.innerHTML = window.MarkupSvg.toSvg(all, W, H, { preview: false });
    // Pixel effects can't be drawn in SVG; preview them with backdrop filters.
    fx.replaceChildren(
      ...all
        .filter((s) => s.type === 'redact' && s.style !== 'solid')
        .map((s) => {
          const x = Math.min(s.x, s.x + s.w) * view.scale;
          const y = Math.min(s.y, s.y + s.h) * view.scale;
          return h('div', { class: `fx ${s.style}`, style: { left: `${x}px`, top: `${y}px`, width: `${Math.abs(s.w) * view.scale}px`, height: `${Math.abs(s.h) * view.scale}px` } });
        }),
    );
    undoBtn.disabled = !shapes.length;
    clearBtn.disabled = !shapes.length;
  }

  function toImage(e) {
    const r = fit.getBoundingClientRect();
    return [(e.clientX - r.left) / view.scale, (e.clientY - r.top) / view.scale];
  }

  const strokeSize = () => Math.max(1, Math.round(base * sizeK));

  hit.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const [x, y] = toImage(e);
    if (mode === 'text') {
      e.preventDefault();
      openText(x, y);
      return;
    }
    hit.setPointerCapture(e.pointerId);
    const size = strokeSize();
    if (redact) draft = { type: 'redact', style: mode, x, y, w: 0, h: 0 };
    else if (mode === 'arrow') draft = { type: 'arrow', x1: x, y1: y, x2: x, y2: y, color, size };
    else if (mode === 'pen') draft = { type: 'pen', points: [[x, y]], color, size };
    else draft = { type: mode, x, y, w: 0, h: 0, color, size };
    render();
  });

  hit.addEventListener('pointermove', (e) => {
    if (!draft) return;
    let [x, y] = toImage(e);
    x = Math.max(0, Math.min(W, x));
    y = Math.max(0, Math.min(H, y));
    if (draft.type === 'arrow') Object.assign(draft, { x2: x, y2: y });
    else if (draft.type === 'pen') draft.points.push([x, y]);
    else Object.assign(draft, { w: x - draft.x, h: y - draft.y });
    render();
  });

  const finish = () => {
    if (!draft) return;
    const big = draft.type === 'arrow' ? Math.hypot(draft.x2 - draft.x1, draft.y2 - draft.y1) > 4 : draft.type === 'pen' ? draft.points.length > 1 : Math.abs(draft.w) > 3 && Math.abs(draft.h) > 3;
    if (big) shapes.push(draft);
    draft = null;
    render();
  };
  hit.addEventListener('pointerup', finish);
  hit.addEventListener('pointercancel', finish);

  function openText(x, y) {
    const fontSize = strokeSize() * 6;
    const entry = h('div', {
      class: 'text-entry',
      contenteditable: 'plaintext-only',
      style: { left: `${x * view.scale}px`, top: `${y * view.scale}px`, fontSize: `${fontSize * view.scale}px`, color },
    });
    fit.append(entry);
    entry.focus();
    let done = false;
    const commit = () => {
      if (done) return;
      done = true;
      const text = entry.innerText.trim();
      entry.remove();
      if (text) shapes.push({ type: 'text', x, y, text, color, fontSize });
      render();
    };
    entry.addEventListener('blur', commit);
    entry.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        commit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        entry.innerText = '';
        commit();
      }
      e.stopPropagation();
    });
  }

  const undo = () => {
    shapes.pop();
    render();
  };
  const undoBtn = h('button', { type: 'button', class: 'btn', onclick: undo }, 'Undo');
  const clearBtn = h('button', { type: 'button', class: 'btn', onclick: () => ((shapes = []), render()) }, 'Clear');

  const toolSeg = segmented(redact ? REDACT_TOOLS : ANNOTATE_TOOLS, mode, (v) => (mode = v), 'Tool');
  const row1 = [h('span', { class: 'label' }, redact ? 'Style' : 'Tool'), toolSeg, h('span', { class: 'spacer' }), undoBtn, clearBtn];
  controls.append(h('div', { class: 'row tool-row' }, row1));

  if (!redact) {
    const colorButtons = COLORS.map((c) => {
      const b = h('button', { type: 'button', title: c, 'aria-pressed': String(c === color), style: { background: c } });
      b.addEventListener('click', () => {
        color = c;
        colorButtons.forEach((x, i) => x.setAttribute('aria-pressed', String(COLORS[i] === c)));
      });
      return b;
    });
    const sizeSeg = segmented(SIZES, sizeK, (v) => (sizeK = v), 'Size');
    controls.append(h('div', { class: 'row tool-row' }, [h('span', { class: 'label' }, 'Color'), h('div', { class: 'colors' }, colorButtons), h('span', { class: 'spacer' }), h('span', { style: { color: 'var(--muted)' } }, 'Size'), sizeSeg]));
  } else {
    controls.append(h('div', { class: 'row', style: { color: 'var(--muted)' } }, [icon('eye-off', 15), 'Drag over anything you want to hide. Pixelate and blur are applied to the saved file.']));
  }

  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      undo();
    }
  });

  onResize(stage, layout);
  img.addEventListener('load', layout);
  layout();

  return {
    params: () => ({ shapes }),
    validate: () => (shapes.length ? null : redact ? 'Drag over the area to hide' : 'Draw something first'),
    reset() {
      shapes = [];
      render();
    },
    demo(given) {
      if (Array.isArray(given)) {
        shapes = given;
      } else if (redact) {
        shapes = [
          { type: 'redact', style: 'solid', x: W * 0.15, y: H * 0.2, w: W * 0.35, h: H * 0.06 },
          { type: 'redact', style: 'pixelate', x: W * 0.15, y: H * 0.35, w: W * 0.45, h: H * 0.12 },
          { type: 'redact', style: 'blur', x: W * 0.15, y: H * 0.55, w: W * 0.5, h: H * 0.12 },
        ];
      } else {
        const s = base;
        shapes = [
          { type: 'rect', x: W * 0.14, y: H * 0.18, w: W * 0.4, h: H * 0.2, color: '#ff3b30', size: s },
          { type: 'arrow', x1: W * 0.8, y1: H * 0.75, x2: W * 0.58, y2: H * 0.32, color: '#ff3b30', size: s },
          { type: 'text', x: W * 0.6, y: H * 0.76, text: 'Look here', color: '#007aff', fontSize: s * 6 },
          { type: 'highlight', x: W * 0.16, y: H * 0.5, w: W * 0.45, h: H * 0.05, color: '#ffcc00' },
        ];
      }
      render();
    },
  };
}
