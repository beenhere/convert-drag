'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cd', {
  get: () => ipcRenderer.invoke('settings:get'),
  set: (patch) => ipcRenderer.invoke('settings:set', patch),
  chooseFolder: () => ipcRenderer.invoke('settings:choose-folder'),
  openPermissions: () => ipcRenderer.send('settings:open-permissions'),
  openUrl: (url) => ipcRenderer.send('settings:open-url', url),
  onChanged: (cb) => ipcRenderer.on('settings:changed', (_e, v) => cb(v)),
  onPermission: (cb) => ipcRenderer.on('settings:permission', (_e, v) => cb(v)),
});
