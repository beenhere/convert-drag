import { h, fitRect, slider, segmented, onResize, icon } from '../dom.js';

const FORMATS = [
  { value: '', label: 'Same' },
  { value: 'jpg', label: 'JPG' },
  { value: 'png', label: 'PNG' },
  { value: 'webp', label: 'WEBP' },
];

export function mount({ info, stage, controls }) {
  const W = info.width;
  const H = info.height;
  const defaults = () => ({ brightness: 0, contrast: 0, saturation: 0, grayscale: false, rotate: 0, flipH: false, flipV: false, width: W, height: H, lock: true, format: '' });
  let p = defaults();

  const img = h('img', { src: info.preview.url, alt: '' });
  const wrap = h('div', { class: 'adjust-wrap' }, [img]);
  stage.append(wrap);

  const quarter = () => ((p.rotate % 360) + 360) % 180 === 90;

  function draw() {
    const rw = quarter() ? H : W;
    const rh = quarter() ? W : H;
    const view = fitRect(rw, rh, stage.clientWidth, stage.clientHeight, 24);
    Object.assign(wrap.style, { left: `${view.left}px`, top: `${view.top}px`, width: `${view.width}px`, height: `${view.height}px` });
    // The <img> keeps the unrotated size; the transform turns it into the box.
    const iw = W * view.scale;
    const ih = H * view.scale;
    Object.assign(img.style, { width: `${iw}px`, height: `${ih}px` });
    const s = p.grayscale ? 0 : 1 + p.saturation / 100;
    img.style.filter = `brightness(${1 + p.brightness / 100}) contrast(${1 + p.contrast / 100}) saturate(${s})`;
    img.style.transform = `rotate(${p.rotate}deg) scale(${p.flipH ? -1 : 1}, ${p.flipV ? -1 : 1})`;
    wIn.value = String(p.width);
    hIn.value = String(p.height);
    grayBtn.setAttribute('aria-pressed', String(p.grayscale));
  }

  const bright = slider({ label: 'Brightness', min: -100, max: 100, value: 0, onInput: (v) => ((p.brightness = v), draw()) });
  const contrast = slider({ label: 'Contrast', min: -100, max: 100, value: 0, onInput: (v) => ((p.contrast = v), draw()) });
  const sat = slider({ label: 'Saturation', min: -100, max: 100, value: 0, onInput: (v) => ((p.saturation = v), draw()) });

  const turn = (deg) => {
    p.rotate = (p.rotate + deg + 360) % 360;
    [p.width, p.height] = [p.height, p.width];
    draw();
  };
  // Flips are applied before rotation (as sharp does), so swap axes when the
  // image is on its side to keep "horizontal" meaning horizontal on screen.
  const flip = (horizontal) => {
    if (horizontal !== quarter()) p.flipH = !p.flipH;
    else p.flipV = !p.flipV;
    draw();
  };
  const grayBtn = h('button', { type: 'button', class: 'btn icon-btn', 'aria-pressed': 'false', onclick: () => ((p.grayscale = !p.grayscale), draw()) }, 'Black & White');

  const wIn = h('input', { type: 'number', min: 1, max: 20000, 'aria-label': 'Width' });
  const hIn = h('input', { type: 'number', min: 1, max: 20000, 'aria-label': 'Height' });
  const lock = h('input', { type: 'checkbox', checked: true, id: 'lock' });
  const ratioNow = () => (quarter() ? H / W : W / H);
  wIn.addEventListener('change', () => {
    p.width = Math.max(1, Math.round(Number(wIn.value) || p.width));
    if (p.lock) p.height = Math.max(1, Math.round(p.width / ratioNow()));
    draw();
  });
  hIn.addEventListener('change', () => {
    p.height = Math.max(1, Math.round(Number(hIn.value) || p.height));
    if (p.lock) p.width = Math.max(1, Math.round(p.height * ratioNow()));
    draw();
  });
  lock.addEventListener('change', () => (p.lock = lock.checked));
  const format = segmented(FORMATS, '', (v) => (p.format = v), 'Format');

  controls.append(
    bright,
    contrast,
    sat,
    h('div', { class: 'row' }, [
      h('span', { class: 'label' }, 'Transform'),
      h('button', { type: 'button', class: 'btn icon-btn', title: 'Rotate left', onclick: () => turn(-90) }, [icon('rotate', 15), 'Left']),
      h('button', { type: 'button', class: 'btn icon-btn', title: 'Rotate right', onclick: () => turn(90) }, [icon('rotate', 15), 'Right']),
      h('button', { type: 'button', class: 'btn', onclick: () => flip(true) }, 'Flip ↔'),
      h('button', { type: 'button', class: 'btn', onclick: () => flip(false) }, 'Flip ↕'),
      grayBtn,
    ]),
    h('div', { class: 'row' }, [
      h('span', { class: 'label' }, 'Size'),
      wIn,
      h('span', { style: { color: 'var(--muted)' } }, '×'),
      hIn,
      h('label', { for: 'lock', style: { display: 'inline-flex', gap: '6px', alignItems: 'center', color: 'var(--muted)' } }, [lock, 'Keep ratio']),
      h('span', { class: 'spacer' }),
      h('span', { style: { color: 'var(--muted)' } }, 'Format'),
      format,
    ]),
  );

  onResize(stage, draw);
  img.addEventListener('load', draw);
  draw();

  return {
    params: () => {
      const out = { brightness: p.brightness, contrast: p.contrast, saturation: p.saturation, grayscale: p.grayscale, rotate: p.rotate, flipH: p.flipH, flipV: p.flipV };
      const natural = quarter() ? [H, W] : [W, H];
      if (p.width !== natural[0] || p.height !== natural[1]) Object.assign(out, { width: p.width, height: p.height });
      if (p.format) out.format = p.format;
      return out;
    },
    reset() {
      p = defaults();
      bright.set(0);
      contrast.set(0);
      sat.set(0);
      format.set('');
      lock.checked = true;
      draw();
    },
    demo(over = { saturation: -40, contrast: 20 }) {
      Object.assign(p, over);
      bright.set(p.brightness);
      contrast.set(p.contrast);
      sat.set(p.saturation);
      draw();
    },
  };
}
