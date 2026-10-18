// Radial drop menu. In drag mode the menu is built from the MIME types the
// browser exposes during dragenter and the user picks a wedge by dropping on
// it. Dropping on the hub "pins" the menu so options can be clicked instead.
'use strict';

(function () {
  const C = 220; // menu center inside the 440px window
  const R_HUB = 56;
  const R_IN = 66;
  const R_OUT = 160;
  const R_LABEL = (R_IN + R_OUT) / 2;
  const STROKE = 10; // rounded-corner stroke on each wedge
  const GAP = 4; // px between wedges
  const POP = 5; // px a hot wedge moves outward
  const DWELL_FIRST = 480;
  const DWELL_REPEAT = 900;

  const stage = document.getElementById('stage');
  const pagesEl = document.getElementById('pages');
  const hub = document.getElementById('hub');
  const hubIcon = hub.querySelector('.hub-icon');
  const hubTitle = hub.querySelector('.hub-title');
  const hubSub = hub.querySelector('.hub-sub');
  const hubDots = hub.querySelector('.hub-dots');
  const dwellEl = document.getElementById('dwell');
  const progressEl = document.getElementById('progress');
  const progressBar = progressEl.querySelector('.bar');
  const PROGRESS_LEN = 2 * Math.PI * 52;

  const state = {
    mode: 'idle', // idle | drag | pinned | busy | done | error
    confirmed: false,
    menu: null,
    page: 0,
    hot: null, // wedge index, 'hub' or null
    paths: null,
    sub: '',
    dwellTimer: null,
    resultTimer: null,
    pageEl: null,
  };

  function setMode(mode) {
    state.mode = mode;
    stage.dataset.mode = mode;
  }

  // --- geometry -------------------------------------------------------------

  function polar(r, a) {
    return [C + r * Math.cos(a), C + r * Math.sin(a)];
  }

  function wedgePath(i, n) {
    const span = (2 * Math.PI) / n;
    const mid = -Math.PI / 2 + i * span;
    const ro = R_OUT - STROKE / 2;
    const ri = R_IN + STROKE / 2;
    const inset = STROKE / 2 + GAP / 2;
    const dOut = inset / ro;
    const dIn = inset / ri;
    const a0 = mid - span / 2;
    const a1 = mid + span / 2;
    const [x1, y1] = polar(ro, a0 + dOut);
    const [x2, y2] = polar(ro, a1 - dOut);
    const [x3, y3] = polar(ri, a1 - dIn);
    const [x4, y4] = polar(ri, a0 + dIn);
    const large = span - 2 * dOut > Math.PI ? 1 : 0;
    const largeIn = span - 2 * dIn > Math.PI ? 1 : 0;
    return `M${x1} ${y1} A${ro} ${ro} 0 ${large} 1 ${x2} ${y2} L${x3} ${y3} A${ri} ${ri} 0 ${largeIn} 0 ${x4} ${y4} Z`;
  }

  function ringPath() {
    const ro = R_OUT - STROKE / 2;
    const ri = R_IN + STROKE / 2;
    return `M${C - ro} ${C} a${ro} ${ro} 0 1 0 ${ro * 2} 0 a${ro} ${ro} 0 1 0 ${-ro * 2} 0 Z M${C - ri} ${C} a${ri} ${ri} 0 1 1 ${ri * 2} 0 a${ri} ${ri} 0 1 1 ${-ri * 2} 0 Z`;
  }

  function hitTest(x, y) {
    const dx = x - C;
    const dy = y - C;
    const r = Math.hypot(dx, dy);
    if (r <= R_HUB + 4) return 'hub';
    const items = currentItems();
    if (!items.length || r < R_IN - 4 || r > R_OUT + 14) return null;
    const n = items.length;
    const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
    const rel = (((deg + 90 + 180 / n) % 360) + 360) % 360;
    return Math.min(n - 1, Math.floor(rel / (360 / n)));
  }

  // --- rendering --------------------------------------------------------------

  function currentItems() {
    const page = state.menu && state.menu.pages[state.page];
    return page ? page.items : [];
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  }

  function buildPage(items) {
    const el = document.createElement('div');
    el.className = 'page';
    const n = items.length;
    const defs =
      '<defs>' +
      '<linearGradient id="wedge-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color: var(--wedge-a)"/><stop offset="1" style="stop-color: var(--wedge-b)"/></linearGradient>' +
      '<linearGradient id="wedge-hot" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color: var(--hot-a)"/><stop offset="1" style="stop-color: var(--hot-b)"/></linearGradient>' +
      '</defs>';
    const paths = items
      .map((_, i) => (n === 1 ? `<path class="wedge" data-i="${i}" fill-rule="evenodd" d="${ringPath()}"/>` : `<path class="wedge" data-i="${i}" d="${wedgePath(i, n)}"/>`))
      .join('');
    el.innerHTML = `<svg width="440" height="440" viewBox="0 0 440 440">${defs}${paths}</svg>`;
    items.forEach((item, i) => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
      const [x, y] = n === 1 ? [C, C - R_LABEL] : polar(R_LABEL, a);
      const label = document.createElement('div');
      label.className = `label${item.icon ? '' : ' format'}`;
      label.dataset.i = String(i);
      label.style.left = `${x}px`;
      label.style.top = `${y}px`;
      label.innerHTML = `${item.icon ? window.Icons.icon(item.icon, 18) : ''}<span>${escapeHtml(item.label)}</span>`;
      el.appendChild(label);
    });
    return el;
  }

  function renderPage(direction) {
    const items = currentItems();
    const next = buildPage(items);
    const prev = state.pageEl;
    if (prev && direction) {
      next.classList.add('enter-from-right');
      pagesEl.appendChild(next);
      requestAnimationFrame(() => {
        prev.classList.add('exit-to-left');
        next.classList.remove('enter-from-right');
      });
      setTimeout(() => prev.remove(), 280);
    } else {
      pagesEl.replaceChildren(next);
    }
    state.pageEl = next;
    state.hot = null;
    renderHub();
  }

  function setHot(hot) {
    if (hot === state.hot) return;
    state.hot = hot;
    const n = currentItems().length;
    if (state.pageEl) {
      state.pageEl.querySelectorAll('.wedge').forEach((w) => {
        const i = Number(w.dataset.i);
        const on = hot === i;
        w.classList.toggle('hot', on);
        if (on && n > 1) {
          const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
          w.style.transform = `translate(${Math.cos(a) * POP}px, ${Math.sin(a) * POP}px)`;
        } else {
          w.style.transform = '';
        }
      });
      state.pageEl.querySelectorAll('.label').forEach((l) => {
        const i = Number(l.dataset.i);
        const on = hot === i;
        l.classList.toggle('hot', on);
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
        l.style.transform = on && n > 1 ? `translate(calc(-50% + ${Math.cos(a) * POP}px), calc(-50% + ${Math.sin(a) * POP}px)) scale(1.06)` : '';
      });
    }
    hub.classList.toggle('hot', hot === 'hub');
    updateDwell();
    renderHub();
  }

  function renderHub() {
    if (state.mode === 'busy' || state.mode === 'done' || state.mode === 'error') return;
    const menu = state.menu;
    if (!menu) return;
    hubIcon.innerHTML = '';
    const items = currentItems();
    if (typeof state.hot === 'number' && items[state.hot]) {
      hubTitle.textContent = items[state.hot].label;
      hubSub.textContent = items[state.hot].hint || '';
    } else if (menu.kind === 'unknown' && state.mode === 'drag') {
      hubTitle.textContent = 'Drop here';
      hubSub.textContent = 'to see options';
    } else if (state.hot === 'hub' && menu.pages.length > 1) {
      hubTitle.textContent = menu.pages[(state.page + 1) % menu.pages.length].name;
      hubSub.textContent = state.mode === 'pinned' ? 'Click to switch' : 'Hold to switch';
    } else {
      hubTitle.textContent = menu.pages[state.page] ? menu.pages[state.page].name : '';
      hubSub.textContent = state.sub || menu.title || '';
    }
    hubDots.innerHTML = menu.pages.length > 1 ? menu.pages.map((_, i) => `<span class="${i === state.page ? 'on' : ''}"></span>`).join('') : '';
  }

  function nextPage() {
    if (!state.menu || state.menu.pages.length < 2) return;
    if (!['drag', 'pinned'].includes(state.mode)) return;
    state.page = (state.page + 1) % state.menu.pages.length;
    renderPage(1);
  }

  function updateDwell() {
    clearTimeout(state.dwellTimer);
    dwellEl.classList.remove('run');
    if (state.hot !== 'hub' || state.mode !== 'drag' || !state.menu || state.menu.pages.length < 2) return;
    const go = (ms) => {
      dwellEl.style.setProperty('--dwell', `${ms}ms`);
      dwellEl.classList.remove('run');
      void dwellEl.getBoundingClientRect();
      dwellEl.classList.add('run');
      state.dwellTimer = setTimeout(() => {
        nextPage();
        hub.classList.add('hot');
        state.hot = 'hub';
        renderHub();
        go(DWELL_REPEAT);
      }, ms);
    };
    go(DWELL_FIRST);
  }

  function show(menu) {
    state.menu = menu;
    state.page = 0;
    renderPage(0);
    stage.classList.remove('leaving');
    requestAnimationFrame(() => stage.classList.add('visible'));
  }

  function reset() {
    clearTimeout(state.dwellTimer);
    clearTimeout(state.resultTimer);
    dwellEl.classList.remove('run');
    stage.classList.remove('visible', 'leaving');
    progressEl.classList.remove('indeterminate');
    progressBar.style.strokeDashoffset = String(PROGRESS_LEN);
    Object.assign(state, { confirmed: false, menu: null, page: 0, hot: null, paths: null, sub: '' });
    setMode('idle');
    pagesEl.replaceChildren();
    state.pageEl = null;
    hubIcon.innerHTML = '';
    hubTitle.textContent = '';
    hubSub.textContent = '';
    hubDots.innerHTML = '';
  }

  function leave(after) {
    clearTimeout(state.resultTimer);
    state.resultTimer = setTimeout(() => {
      stage.classList.add('leaving');
      setTimeout(() => window.cd.hide(), 190);
    }, after);
  }

  // --- actions --------------------------------------------------------------

  async function runItem(item, paths) {
    setMode('busy');
    hubDots.innerHTML = '';
    hubIcon.innerHTML = '';
    hubTitle.textContent = item.label;
    hubSub.textContent = 'Working…';
    progressEl.classList.add('indeterminate');
    progressBar.style.strokeDashoffset = String(PROGRESS_LEN);
    state.pageEl?.querySelectorAll('.wedge, .label').forEach((el) => el.classList.toggle('dim', Number(el.dataset.i) !== state.hot));
    let res;
    try {
      res = await window.cd.run(item.id, paths);
    } catch (e) {
      res = { ok: false, error: e.message };
    }
    progressEl.classList.remove('indeterminate');
    if (res.editor) return; // main opened an editor window and hid us
    if (res.ok) {
      setMode('done');
      hubIcon.innerHTML = window.Icons.icon('check', 18);
      hubTitle.textContent = res.summary?.title || 'Done';
      hubSub.textContent = res.summary?.detail || '';
      leave(1100);
    } else {
      setMode('error');
      hubIcon.innerHTML = window.Icons.icon('x', 18);
      hubTitle.textContent = 'Failed';
      hubSub.textContent = res.error || 'Something went wrong';
      leave(2800);
    }
  }

  async function pinWith(paths) {
    state.paths = paths;
    setMode('pinned');
    window.cd.pin();
    const info = await window.cd.inspect(paths);
    if (!info) return;
    state.sub = info.sub;
    state.menu = info.menu;
    state.page = Math.min(state.page, info.menu.pages.length - 1);
    renderPage(0);
  }

  function choose(hit, paths) {
    if (typeof hit === 'number') {
      const item = currentItems()[hit];
      if (item) runItem(item, paths);
    } else if (hit === 'hub') {
      if (state.mode === 'pinned') nextPage();
      else pinWith(paths);
    }
  }

  // --- drag & drop ----------------------------------------------------------

  function hasFiles(e) {
    return Array.from(e.dataTransfer?.types || []).includes('Files');
  }

  stage.addEventListener('dragenter', async (e) => {
    e.preventDefault();
    if (state.mode !== 'drag' || state.confirmed || !hasFiles(e)) return;
    state.confirmed = true;
    window.cd.entered();
    const mimes = Array.from(e.dataTransfer.items || [])
      .filter((i) => i.kind === 'file')
      .map((i) => i.type || '');
    const menu = await window.cd.menuForMimes(mimes.length ? mimes : ['']);
    if (state.mode === 'drag' && menu) show(menu);
  });

  stage.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = state.mode === 'drag' && state.menu ? 'copy' : 'none';
    if (state.mode === 'drag' && state.menu) setHot(hitTest(e.clientX, e.clientY));
  });

  stage.addEventListener('dragleave', (e) => {
    if (e.relatedTarget == null && state.mode === 'drag') setHot(null);
  });

  stage.addEventListener('drop', (e) => {
    e.preventDefault();
    if (state.mode !== 'drag' || !state.menu) return;
    const paths = Array.from(e.dataTransfer.files || [])
      .map((f) => window.cd.pathForFile(f))
      .filter(Boolean);
    const hit = hitTest(e.clientX, e.clientY);
    if (!paths.length || hit == null) {
      leave(0);
      return;
    }
    choose(hit, paths);
  });

  // --- click mode -----------------------------------------------------------

  stage.addEventListener('mousemove', (e) => {
    if (state.mode === 'pinned') setHot(hitTest(e.clientX, e.clientY));
  });

  stage.addEventListener('mouseleave', () => {
    if (state.mode === 'pinned') setHot(null);
  });

  stage.addEventListener('click', (e) => {
    if (state.mode !== 'pinned') return;
    const hit = hitTest(e.clientX, e.clientY);
    if (hit == null) leave(0);
    else choose(hit, state.paths);
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') leave(0);
    if (state.mode !== 'pinned') return;
    if (e.key === 'Tab' || e.key === 'ArrowRight') {
      e.preventDefault();
      nextPage();
    }
  });

  // --- main process ---------------------------------------------------------

  window.cd.onArm((data) => {
    reset();
    if (data.mode === 'pinned') {
      state.paths = data.paths;
      state.sub = data.sub;
      setMode('pinned');
      show(data.menu);
    } else {
      setMode('drag');
    }
  });

  window.cd.onReset(() => reset());
  window.cd.onNextPage(() => nextPage());
  window.cd.onProgress((v) => {
    if (state.mode !== 'busy') return;
    progressEl.classList.remove('indeterminate');
    progressBar.style.strokeDashoffset = String(PROGRESS_LEN * (1 - Math.max(0, Math.min(1, v))));
    hubSub.textContent = `${Math.round(v * 100)}%`;
  });

  // For tests and screenshots.
  window.__overlay = { show, setHot, setMode, nextPage, state, runItem };
})();
