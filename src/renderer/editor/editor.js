// Editor window shell: loads the tool module named in ?tool= and wires up the
// Reset / Cancel / Save buttons. Tools only preview; the main process renders
// the saved file from tool.params().

const TOOLS = {
  crop: './tools/crop.js',
  background: './tools/background.js',
  edit: './tools/adjust.js',
  annotate: './tools/markup.js',
  redact: './tools/markup.js',
  trim: './tools/trim.js',
};

const SAVE_LABELS = {
  crop: 'Save Cropped',
  background: 'Save with Background',
  edit: 'Save Changes',
  annotate: 'Save Annotated',
  redact: 'Save Redacted',
  trim: 'Save Trimmed',
};

window.__errors = [];
window.addEventListener('error', (e) => window.__errors.push(String(e.message)));
window.addEventListener('unhandledrejection', (e) => window.__errors.push(String(e.reason?.message || e.reason)));

const tool = new URLSearchParams(location.search).get('tool');
const stage = document.getElementById('stage');
const controls = document.getElementById('controls');
const status = document.getElementById('status');
const saveBtn = document.getElementById('save');

function setStatus(text, error = false) {
  status.textContent = text;
  status.classList.toggle('error', error);
}

async function boot() {
  const info = await window.cd.init();
  document.getElementById('title').textContent = info.title;
  document.getElementById('file').textContent = [info.name, info.size, info.width ? `${info.width}×${info.height}` : null].filter(Boolean).join(' · ');
  document.title = `${info.title} — ${info.name}`;
  saveBtn.textContent = SAVE_LABELS[tool] || 'Save';

  const mod = await import(TOOLS[tool]);
  const api = mod.mount({ info, tool, stage, controls, setStatus });
  window.__params = () => api.params();
  window.__demo = api.demo;

  document.getElementById('reset').addEventListener('click', () => {
    api.reset();
    setStatus('');
  });
  document.getElementById('cancel').addEventListener('click', () => window.cd.close());

  let saving = false;
  async function save() {
    if (saving) return;
    const problem = api.validate?.();
    if (problem) return setStatus(problem, true);
    saving = true;
    saveBtn.disabled = true;
    setStatus('Saving…');
    const res = await window.cd.save(api.params());
    saving = false;
    saveBtn.disabled = false;
    if (res.ok) setStatus(`Saved ${res.summary?.name || ''}`);
    else setStatus(res.error || 'Could not save', true);
  }
  saveBtn.addEventListener('click', save);
  window.cd.onProgress((v) => saving && setStatus(`Saving… ${Math.round(v * 100)}%`));

  window.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === 'Escape' && !e.defaultPrevented) window.cd.close();
    else if (mod && e.key.toLowerCase() === 's') {
      e.preventDefault();
      save();
    } else if (e.key === 'Enter' && !(e.target instanceof HTMLInputElement) && !e.target.isContentEditable) save();
  });
  return true;
}

window.__ready = boot().catch((e) => {
  window.__errors.push(String(e.message || e));
  setStatus(e.message || String(e), true);
  return false;
});
