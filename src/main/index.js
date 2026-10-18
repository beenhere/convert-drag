'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app, Tray, Menu, nativeImage, BrowserWindow, ipcMain, dialog, shell, systemPreferences, screen, nativeTheme } = require('electron');
const protocol = require('./protocol');
const { Settings } = require('./settings');
const { DragTrigger } = require('./trigger');
const { Overlay } = require('./overlay');
const { Editors } = require('./editors');
const { JobRunner } = require('./jobs');
const { ChromiumBridge } = require('./bridge');
const { debug } = require('./log');

const isMac = process.platform === 'darwin';
const ASSETS = path.join(__dirname, '..', '..', 'assets');
const REPO_URL = 'https://github.com/beenhere/convert-drag';
const MOD_LABEL = { shift: 'Shift', alt: isMac ? 'Option' : 'Alt', ctrl: isMac ? 'Control' : 'Ctrl', meta: isMac ? 'Command' : 'Win' };

protocol.registerSchemes();

let settings;
let trigger;
let overlay;
let tray;
let settingsWin = null;
let permissionTimer = null;
const pendingOpen = [];

function filesFromArgv(argv) {
  const appPath = app.getAppPath();
  return argv
    .slice(1)
    .filter((a) => a && !a.startsWith('-'))
    .map((a) => path.resolve(a))
    .filter((p) => p !== appPath && p !== process.execPath && fs.existsSync(p) && p !== path.resolve('.'));
}

// Explorer's context menu starts one process per selected file; collect the
// paths that arrive close together and open them as one selection.
let openTimer = null;
function openFiles(paths) {
  pendingOpen.push(...paths);
  if (!pendingOpen.length) return;
  if (!overlay) return;
  clearTimeout(openTimer);
  openTimer = setTimeout(() => {
    const files = [...new Set(pendingOpen.splice(0))];
    if (files.length) overlay.open(files, screen.getCursorScreenPoint());
  }, 250);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    debug('second instance', argv);
    openFiles(filesFromArgv(argv));
  });

  // macOS "Open With" / dropping on the Dock icon.
  app.on('open-file', (e, file) => {
    e.preventDefault();
    openFiles([file]);
  });

  app.whenReady().then(start);
  app.on('window-all-closed', () => {
    // A tray app keeps running with no windows.
  });
  app.on('will-quit', () => trigger?.stop());
}

function start() {
  if (process.platform === 'win32') app.setAppUserModelId('com.convertdrag.app');
  if (isMac) app.dock?.hide();
  protocol.handle();

  settings = new Settings(path.join(app.getPath('userData'), 'settings.json'));
  const bridge = new ChromiumBridge();
  const jobs = new JobRunner({ settings, bridge });
  const editors = new Editors({ jobs });
  overlay = new Overlay({ jobs, openEditor: (tool, file) => editors.open(tool, file) });
  overlay.create();

  trigger = new DragTrigger({ modifier: settings.get('modifier') });
  trigger.on('trigger', () => settings.get('enabled') && overlay.arm());
  trigger.on('move', () => overlay.onMove());
  trigger.on('release', () => overlay.onRelease());
  trigger.on('tap', () => overlay.onTap());
  trigger.on('error', (e) => console.error('Input hook error:', e));
  trigger.on('trigger', () => debug('trigger fired'));
  startHook();

  settings.on('change', (all, changed) => {
    if ('modifier' in changed) trigger.setModifier(all.modifier);
    if ('openAtLogin' in changed && (isMac || process.platform === 'win32')) app.setLoginItemSettings({ openAtLogin: all.openAtLogin });
    if ('enabled' in changed && !all.enabled) overlay.hide();
    buildTray();
    settingsWin?.webContents.send('settings:changed', all);
  });

  registerSettingsIpc();
  buildTray();

  const initial = filesFromArgv(process.argv);
  if (initial.length || pendingOpen.length) openFiles(initial);
  else if (!fs.existsSync(path.join(app.getPath('userData'), 'settings.json')) || !hookAllowed()) {
    settings.update({});
    showSettings();
  }
}

function hookAllowed() {
  return !isMac || systemPreferences.isTrustedAccessibilityClient(false);
}

function startHook() {
  clearInterval(permissionTimer);
  if (!hookAllowed()) {
    // Ask once; then wait for the user to flip the switch in System Settings.
    systemPreferences.isTrustedAccessibilityClient(true);
    permissionTimer = setInterval(() => {
      if (hookAllowed()) {
        clearInterval(permissionTimer);
        trigger.start();
        settingsWin?.webContents.send('settings:permission', true);
        buildTray();
      }
    }, 2000);
    return;
  }
  trigger.start();
}

function trayImage() {
  if (isMac) {
    const img = nativeImage.createFromPath(path.join(ASSETS, 'tray', 'trayTemplate.png'));
    img.setTemplateImage(true);
    return img;
  }
  return nativeImage.createFromPath(path.join(ASSETS, 'tray', 'tray.png'));
}

function buildTray() {
  if (!tray) {
    tray = new Tray(trayImage());
    tray.setToolTip('ConvertDrag');
    if (!isMac) tray.on('click', () => showSettings());
  }
  const mod = MOD_LABEL[settings.get('modifier')];
  const allowed = hookAllowed();
  const template = [
    { label: allowed ? `Hold ${mod} while dragging a file` : 'Needs Accessibility permission…', enabled: !allowed, click: () => showSettings() },
    { type: 'separator' },
    { label: 'Enabled', type: 'checkbox', checked: settings.get('enabled'), click: (item) => settings.update({ enabled: item.checked }) },
    {
      label: 'Open Files…',
      click: async () => {
        const res = await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'] });
        if (!res.canceled) openFiles(res.filePaths);
      },
    },
    { label: isMac ? 'Settings…' : 'Settings', accelerator: isMac ? 'Command+,' : undefined, click: () => showSettings() },
    { type: 'separator' },
    { label: 'Source code on GitHub', click: () => shell.openExternal(REPO_URL) },
    { label: `Quit ConvertDrag`, accelerator: isMac ? 'Command+Q' : undefined, click: () => app.quit() },
  ];
  tray.setContextMenu(Menu.buildFromTemplate(template));
}

function showSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show();
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 560,
    height: 760,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    title: 'ConvertDrag',
    autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1c1c1e' : '#f5f5f7',
    webPreferences: { preload: path.join(__dirname, '..', 'preload', 'settings.js'), sandbox: true, contextIsolation: true },
  });
  settingsWin.once('ready-to-show', () => {
    settingsWin.show();
    if (isMac) app.focus({ steal: true });
  });
  settingsWin.on('closed', () => (settingsWin = null));
  settingsWin.loadURL(protocol.appUrl('settings/index.html'));
}

function registerSettingsIpc() {
  const fromSettings = (e) => settingsWin && !settingsWin.isDestroyed() && e.sender === settingsWin.webContents;
  ipcMain.handle('settings:get', (e) => {
    if (!fromSettings(e)) return null;
    return { values: settings.all(), platform: process.platform, version: app.getVersion(), permission: hookAllowed(), hookRunning: trigger.running, conversions: require('./catalog').countConversions() };
  });
  ipcMain.handle('settings:set', (e, patch) => (fromSettings(e) ? settings.update(patch) : null));
  ipcMain.handle('settings:choose-folder', async (e) => {
    if (!fromSettings(e)) return null;
    const res = await dialog.showOpenDialog(settingsWin, { properties: ['openDirectory', 'createDirectory'] });
    if (res.canceled || !res.filePaths[0]) return null;
    return settings.update({ outputFolder: res.filePaths[0], outputMode: 'folder' });
  });
  ipcMain.on('settings:open-permissions', (e) => {
    if (!fromSettings(e)) return;
    systemPreferences.isTrustedAccessibilityClient(true);
    shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
  });
  ipcMain.on('settings:open-url', (e, url) => {
    if (fromSettings(e) && url === REPO_URL) shell.openExternal(url);
  });
}
