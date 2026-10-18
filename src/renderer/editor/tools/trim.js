import { h, clamp, icon } from '../dom.js';

const THUMBS = 10;

function fmt(t) {
  if (!Number.isFinite(t)) return '0:00.0';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
}

function parse(str) {
  const parts = String(str).trim().split(':').map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return NaN;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

export function mount({ info, stage, controls, setStatus }) {
  const m = info.media;
  const duration = m.duration || 0;
  let start = 0;
  let end = duration;
  let still = false; // true when the browser can't play this codec

  const holder = h('div', { class: 'trim-stage' });
  stage.append(holder);
  let player;
  let stillImg = null;
  if (m.hasVideo) {
    player = h('video', { src: m.url, preload: 'auto', playsinline: true });
    holder.append(player);
  } else {
    player = h('audio', { src: m.url, preload: 'auto' });
    holder.append(h('div', { class: 'audio-art' }, [h('div', { class: 'big' }, [icon('wave', 40)]), h('div', {}, info.name)]), player);
  }
  player.addEventListener('error', () => {
    still = true;
    if (m.hasVideo) {
      player.remove();
      stillImg = h('img', { class: 'still', alt: '' });
      holder.append(stillImg);
      showFrame(0);
    }
    setStatus("Preview isn't available for this format, but trimming still works.");
  });

  let frameReq = 0;
  async function showFrame(t) {
    if (!stillImg) return;
    const id = ++frameReq;
    const url = await window.cd.frame(t);
    if (id === frameReq && url) stillImg.src = url;
  }

  // Timeline
  const strip = h('div', { class: m.hasVideo ? 'strip' : 'wave' });
  const shadeL = h('div', { class: 'shade' });
  const shadeR = h('div', { class: 'shade' });
  const sel = h('div', { class: 'sel' });
  const gripL = h('div', { class: 'grip', title: 'Start' });
  const gripR = h('div', { class: 'grip', title: 'End' });
  const head = h('div', { class: 'head' });
  const timeline = h('div', { class: 'timeline', role: 'slider', 'aria-label': 'Trim range', tabindex: '0' }, [strip, shadeL, shadeR, sel, head, gripL, gripR]);

  if (m.hasVideo) {
    for (let i = 0; i < THUMBS; i++) strip.append(h('img', { alt: '' }));
    (async () => {
      const imgs = strip.querySelectorAll('img');
      for (let i = 0; i < THUMBS; i++) {
        const url = await window.cd.frame(((i + 0.5) / THUMBS) * duration);
        if (url) imgs[i].src = url;
      }
    })();
  } else {
    for (let i = 0; i < 60; i++) strip.append(h('i', { style: { height: '30%' } }));
  }

  const pct = (t) => `${(duration ? t / duration : 0) * 100}%`;
  function draw() {
    shadeL.style.left = '0';
    shadeL.style.width = pct(start);
    shadeR.style.left = pct(end);
    shadeR.style.right = '0';
    sel.style.left = pct(start);
    sel.style.width = `calc(${pct(end - start)})`;
    gripL.style.left = pct(start);
    gripR.style.left = pct(end);
    head.style.left = pct(player.currentTime || start);
    startIn.value = fmt(start);
    endIn.value = fmt(end);
    len.textContent = `Length ${fmt(end - start)}`;
    timeline.setAttribute('aria-valuetext', `${fmt(start)} to ${fmt(end)}`);
  }

  const timeAt = (e) => {
    const r = timeline.getBoundingClientRect();
    return clamp(((e.clientX - r.left) / r.width) * duration, 0, duration);
  };

  function seek(t) {
    if (still) showFrame(t);
    else player.currentTime = t;
    head.style.left = pct(t);
  }

  let dragging = null;
  timeline.addEventListener('pointerdown', (e) => {
    timeline.setPointerCapture(e.pointerId);
    const t = timeAt(e);
    if (e.target === gripL) dragging = 'start';
    else if (e.target === gripR) dragging = 'end';
    else {
      dragging = 'head';
      seek(t);
    }
  });
  timeline.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const t = timeAt(e);
    const minLen = Math.min(0.1, duration / 2);
    if (dragging === 'start') {
      start = clamp(t, 0, end - minLen);
      seek(start);
    } else if (dragging === 'end') {
      end = clamp(t, start + minLen, duration);
      seek(end);
    } else seek(t);
    draw();
  });
  const stop = () => (dragging = null);
  timeline.addEventListener('pointerup', stop);
  timeline.addEventListener('pointercancel', stop);
  timeline.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 1 : 0.1;
    if (e.key === 'ArrowLeft') start = clamp(start - step, 0, end - 0.1);
    else if (e.key === 'ArrowRight') start = clamp(start + step, 0, end - 0.1);
    else return;
    e.preventDefault();
    draw();
  });

  player.addEventListener('timeupdate', () => {
    head.style.left = pct(player.currentTime);
    if (!player.paused && player.currentTime >= end) {
      player.pause();
      player.currentTime = end;
    }
  });
  player.addEventListener('play', () => (playBtn.textContent = 'Pause'));
  player.addEventListener('pause', () => (playBtn.textContent = 'Play'));

  const playBtn = h('button', { type: 'button', class: 'btn', style: { minWidth: '72px' } }, 'Play');
  playBtn.addEventListener('click', () => {
    if (still) return;
    if (player.paused) {
      if (player.currentTime < start || player.currentTime >= end - 0.05) player.currentTime = start;
      player.play();
    } else player.pause();
  });

  const startIn = h('input', { type: 'text', 'aria-label': 'Start time' });
  const endIn = h('input', { type: 'text', 'aria-label': 'End time' });
  const len = h('span', { class: 'len' });
  startIn.addEventListener('change', () => {
    const t = parse(startIn.value);
    if (Number.isFinite(t)) start = clamp(t, 0, end - 0.1);
    draw();
  });
  endIn.addEventListener('change', () => {
    const t = parse(endIn.value);
    if (Number.isFinite(t)) end = clamp(t, start + 0.1, duration);
    draw();
  });
  const fromHead = (which) => () => {
    const t = still ? start : player.currentTime;
    if (which === 'start') start = clamp(t, 0, end - 0.1);
    else end = clamp(t, start + 0.1, duration);
    draw();
  };

  controls.append(
    timeline,
    h('div', { class: 'times' }, [
      playBtn,
      h('span', { style: { color: 'var(--muted)' } }, 'Start'),
      startIn,
      h('button', { type: 'button', class: 'btn', title: 'Set start to the playhead', onclick: fromHead('start') }, 'Set'),
      h('span', { style: { color: 'var(--muted)' } }, 'End'),
      endIn,
      h('button', { type: 'button', class: 'btn', title: 'Set end to the playhead', onclick: fromHead('end') }, 'Set'),
      h('span', { class: 'spacer' }),
      len,
    ]),
  );

  window.addEventListener('keydown', (e) => {
    if (e.key === ' ' && !(e.target instanceof HTMLInputElement)) {
      e.preventDefault();
      playBtn.click();
    }
  });

  draw();

  return {
    params: () => ({ start: Math.round(start * 1000) / 1000, end: Math.round(end * 1000) / 1000 }),
    validate: () => (start <= 0.001 && end >= duration - 0.001 ? 'Move the handles to choose what to keep' : null),
    reset() {
      start = 0;
      end = duration;
      draw();
    },
    demo() {
      start = duration * 0.2;
      end = duration * 0.75;
      draw();
    },
  };
}
