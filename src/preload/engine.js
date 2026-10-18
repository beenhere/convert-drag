'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('engine', {
  onTask: (cb) => ipcRenderer.on('engine:task', (_e, task) => cb(task)),
  ready: () => ipcRenderer.send('engine:ready'),
  result: (msg) => ipcRenderer.send('engine:result', msg),
  progress: (id, value) => ipcRenderer.send('engine:progress', { id, value }),
});
