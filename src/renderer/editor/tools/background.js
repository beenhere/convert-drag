import { h, fitRect, place, slider, segmented, onResize } from '../dom.js';

const GRADIENTS = [
  ['#ff9a5a', '#ff5f6d'],
  ['#f6d365', '#fda085'],
  ['#fbc2eb', '#a6c1ee'],
  ['#a1c4fd', '#c2e9fb'],
  ['#d4fc79', '#96e6a1'],
  ['#43e97b', '#38f9d7'],
  ['#fa709a', '#fee140'],
  ['#667eea', '#764ba2'],
  ['#f093fb', '#f5576c'],
  ['#30cfd0', '#330867'],
  ['#0f2027', '#2c5364'],
];
const SOLIDS = ['#ffffff', '#f2f2f7', '#ffd60a', '#ff9f0a', '#34c759', '#30b0c7', '#007aff', '#5856d6', '#1c1c1e'];
const RATIOS = [
  { value: 'auto', label: 'Auto' },
  { value: '1:1', label: '1:1' },
  { value: '16:9', label: '16:9' },
  { value: '4:3', label: '4:3' },
  { value: '4:5', label: '4:5' },
  { value: '9:16', label: '9:16' },
];
const RATIO_VALUES = { '1:1': 1, '16:9': 16 / 9, '4:3': 4 / 3, '4:5': 4 / 5, '9:16': 9 / 16 };

/** Same maths as backgroundLayout() in the main process. */
function layout(width, height, p) {
  const pad = Math.max(0, Math.round(p.padding || 0));
  let cw = width + pad * 2;
  let ch = height + pad * 2;
  const r = RATIO_VALUES[p.ratio];
  if (r) {
    if (cw / ch > r) ch = Math.round(cw / r);
    else cw = Math.round(ch * r);
  }
  return { cw, ch, left: Math.round((cw - width) / 2), top: Math.round((ch - height) / 2) };
}

function cssBackground(bg) {
  if (bg.type === 'solid') return bg.color;
  if (bg.type === 'gradient') return `linear-gradient(${bg.angle ?? 135}deg, ${bg.stops.join(', ')})`;
  return 'transparent';
}

export function mount({ info, stage, controls }) {
  const W = info.width;
  const H = info.height;
  const big = Math.max(W, H);
  const small = Math.min(W, H);
  const defaults = () => ({
    background: { type: 'gradient', stops: GRADIENTS[0], angle: 135 },
    padding: Math.round(big * 0.08),
    radius: Math.round(small * 0.04),
    shadow: Math.round(big * 0.025),
    ratio: 'auto',
  });
  let p = defaults();

  const img = h('img', { src: info.preview.url, alt: '' });
  const canvas = h('div', { class: 'bg-canvas' }, [img]);
  stage.append(canvas);

  function draw() {
    const L = layout(W, H, p);
    const view = fitRect(L.cw, L.ch, stage.clientWidth, stage.clientHeight, 24);
    const s = view.scale;
    place(canvas, view);
    canvas.classList.toggle('checker', p.background.type === 'transparent');
    canvas.style.background = p.background.type === 'transparent' ? '' : cssBackground(p.background);
    place(img, { left: L.left * s, top: L.top * s, width: W * s, height: H * s });
    const r = Math.min(p.radius, small / 2) * s;
    img.style.borderRadius = `${r}px`;
    img.style.boxShadow = p.shadow > 0 ? `0 ${(p.shadow / 3) * s}px ${p.shadow * s}px rgba(0,0,0,0.35)` : 'none';
    swatchButtons.forEach(({ el, match }) => el.setAttribute('aria-pressed', String(match(p.background))));
  }

  // Swatches
  const swatchButtons = [];
  const swatches = h('div', { class: 'swatches', role: 'group', 'aria-label': 'Background' });
  const addSwatch = (bg, title, match) => {
    const el = h('button', { type: 'button', class: `swatch${bg.type === 'transparent' ? ' checker' : ''}`, title, style: { background: bg.type === 'transparent' ? undefined : cssBackground(bg) } });
    el.addEventListener('click', () => {
      p.background = bg;
      draw();
    });
    swatches.append(el);
    swatchButtons.push({ el, match });
  };
  for (const stops of GRADIENTS) addSwatch({ type: 'gradient', stops, angle: 135 }, 'Gradient', (b) => b.type === 'gradient' && b.stops === stops);
  for (const color of SOLIDS) addSwatch({ type: 'solid', color }, color, (b) => b.type === 'solid' && b.color === color);
  addSwatch({ type: 'transparent' }, 'Transparent', (b) => b.type === 'transparent');
  // Custom color
  const picker = h('input', { type: 'color', value: '#ff5a1f', 'aria-label': 'Custom color' });
  const custom = h('button', { type: 'button', class: 'swatch', title: 'Custom color', style: { background: 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)' } }, [picker]);
  picker.addEventListener('input', () => {
    p.background = { type: 'solid', color: picker.value, custom: true };
    draw();
  });
  swatches.append(custom);
  swatchButtons.push({ el: custom, match: (b) => Boolean(b.custom) });

  const pad = slider({ label: 'Padding', min: 0, max: Math.round(big * 0.5), value: p.padding, unit: ' px', onInput: (v) => ((p.padding = v), draw()) });
  const corners = slider({ label: 'Corners', min: 0, max: Math.round(small / 2), value: p.radius, unit: ' px', onInput: (v) => ((p.radius = v), draw()) });
  const shadow = slider({ label: 'Shadow', min: 0, max: Math.max(10, Math.round(big * 0.1)), value: p.shadow, unit: ' px', onInput: (v) => ((p.shadow = v), draw()) });
  const ratio = segmented(RATIOS, p.ratio, (v) => ((p.ratio = v), draw()), 'Ratio');

  controls.append(
    h('div', { class: 'row', style: { alignItems: 'flex-start' } }, [h('span', { class: 'label', style: { paddingTop: '5px' } }, 'Background'), swatches]),
    pad,
    corners,
    shadow,
    h('div', { class: 'row' }, [h('span', { class: 'label' }, 'Ratio'), ratio]),
  );

  onResize(stage, draw);
  img.addEventListener('load', draw);
  draw();

  return {
    params: () => ({ background: p.background, padding: p.padding, radius: p.radius, shadow: p.shadow, ratio: p.ratio }),
    reset() {
      p = defaults();
      pad.set(p.padding);
      corners.set(p.radius);
      shadow.set(p.shadow);
      ratio.set(p.ratio);
      draw();
    },
    demo(over) {
      p = { ...defaults(), ...over };
      if (typeof p.background === 'number') p.background = { type: 'gradient', stops: GRADIENTS[p.background], angle: 135 };
      pad.set(p.padding);
      corners.set(p.radius);
      shadow.set(p.shadow);
      ratio.set(p.ratio);
      draw();
    },
  };
}
