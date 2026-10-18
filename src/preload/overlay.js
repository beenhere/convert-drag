'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

const on = (channel, cb) => ipcRenderer.on(channel, (_e, data) => cb(data));

contextBridge.exposeInMainWorld('cd', {
  platform: process.platform,
  pathForFile: (file) => webUtils.getPathForFile(file),
  onArm: (cb) => on('overlay:arm', cb),
  onReset: (cb) => on('overlay:reset', cb),
  onNextPage: (cb) => on('overlay:next-page', cb),
  onProgress: (cb) => on('overlay:progress', cb),
  onReleased: (cb) => on('overlay:released', cb),
  entered: () => ipcRenderer.send('overlay:entered'),
  menuForMimes: (mimes) => ipcRenderer.invoke('overlay:menu-for-mimes', mimes),
  inspect: (paths) => ipcRenderer.invoke('overlay:inspect', paths),
  run: (actionId, paths) => ipcRenderer.invoke('overlay:run', { actionId, paths }),
  pin: () => ipcRenderer.send('overlay:pin'),
  hide: () => ipcRenderer.send('overlay:hide'),
});
