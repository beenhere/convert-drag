'use strict';

(async function () {
  const $ = (id) => document.getElementById(id);
  const data = await window.cd.get();
  let values = data.values;
  const mac = data.platform === 'darwin';
  const win = data.platform === 'win32';
  const MODS = [
    ['shift', 'Shift'],
    ['alt', mac ? 'Option' : 'Alt'],
    ['ctrl', mac ? 'Control' : 'Ctrl'],
    ['meta', mac ? 'Command' : 'Win'],
  ];

  $('version').textContent = `v${data.version}`;
  $('reveal-text').textContent = mac ? 'Show the new file in Finder' : win ? 'Show the new file in File Explorer' : 'Show the new file in the file manager';
  $('login-row').hidden = !(mac || win);

  const modSeg = $('modifier');
  for (const [v, label] of MODS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.v = v;
    b.textContent = label;
    modSeg.append(b);
  }

  function render() {
    const modLabel = MODS.find(([v]) => v === values.modifier)[1];
    $('mod-key').textContent = modLabel;
    document.querySelectorAll('.mod-name').forEach((el) => (el.textContent = modLabel));
    $('enabled').checked = values.enabled;
    modSeg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === values.modifier)));
    $('output').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === values.outputMode)));
    $('folder-row').hidden = values.outputMode !== 'folder';
    $('folder').textContent = values.outputFolder || 'No folder chosen';
    $('folder').title = values.outputFolder || '';
    $('quality').value = String(values.jpegQuality);
    $('quality-value').textContent = String(values.jpegQuality);
    $('quality').style.setProperty('--fill', `${((values.jpegQuality - 50) / 50) * 100}%`);
    $('notifications').checked = values.notifications;
    $('reveal').checked = values.revealAfter;
    $('login').checked = values.openAtLogin;
  }

  function permission(ok) {
    $('permission').hidden = !mac || ok;
    const c = data.conversions;
    $('status-line').textContent = ok ? `Ready · ${c.conversions} conversions · ${c.tools} tools` : 'Waiting for permission…';
  }

  async function set(patch) {
    values = (await window.cd.set(patch)) || values;
    render();
  }

  $('enabled').addEventListener('change', (e) => set({ enabled: e.target.checked }));
  modSeg.addEventListener('click', (e) => e.target.dataset.v && set({ modifier: e.target.dataset.v }));
  $('output').addEventListener('click', async (e) => {
    const v = e.target.dataset.v;
    if (!v) return;
    if (v === 'folder' && !values.outputFolder) {
      values = (await window.cd.chooseFolder()) || values;
      render();
      return;
    }
    set({ outputMode: v });
  });
  $('choose').addEventListener('click', async () => {
    values = (await window.cd.chooseFolder()) || values;
    render();
  });
  $('quality').addEventListener('input', (e) => {
    $('quality-value').textContent = e.target.value;
    e.target.style.setProperty('--fill', `${((Number(e.target.value) - 50) / 50) * 100}%`);
  });
  $('quality').addEventListener('change', (e) => set({ jpegQuality: Number(e.target.value) }));
  $('notifications').addEventListener('change', (e) => set({ notifications: e.target.checked }));
  $('reveal').addEventListener('change', (e) => set({ revealAfter: e.target.checked }));
  $('login').addEventListener('change', (e) => set({ openAtLogin: e.target.checked }));
  $('open-permissions').addEventListener('click', () => window.cd.openPermissions());
  $('github').addEventListener('click', (e) => {
    e.preventDefault();
    window.cd.openUrl('https://github.com/beenhere/convert-drag');
  });

  window.cd.onChanged((v) => {
    values = v;
    render();
  });
  window.cd.onPermission((ok) => permission(ok));

  render();
  permission(data.permission);
})();
