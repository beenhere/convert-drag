'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cd', {
  platform: process.platform,
  init: () => ipcRenderer.invoke('editor:init'),
  frame: (at) => ipcRenderer.invoke('editor:frame', at),
  save: (params) => ipcRenderer.invoke('editor:save', params),
  close: () => ipcRenderer.send('editor:close'),
  onProgress: (cb) => ipcRenderer.on('editor:progress', (_e, v) => cb(v)),
});
