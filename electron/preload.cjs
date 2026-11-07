'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * Secure preload bridge. The renderer only receives the specific operations
 * below; it never gets `require`, `process`, or unrestricted Node.js access.
 */
contextBridge.exposeInMainWorld('vca', {
  isElectron: true,
  load: () => ipcRenderer.invoke('vca:load'),
  save: (files) => ipcRenderer.invoke('vca:save', files),
  getInfo: () => ipcRenderer.invoke('vca:getInfo'),
  chooseDataDir: () => ipcRenderer.invoke('vca:chooseDataDir'),
  openDataDir: () => ipcRenderer.invoke('vca:openDataDir'),
  listBackups: () => ipcRenderer.invoke('vca:listBackups'),
  restoreBackup: (backupId) => ipcRenderer.invoke('vca:restoreBackup', backupId),
  importFile: (options) => ipcRenderer.invoke('vca:importFile', options),
  exportFiles: (files) => ipcRenderer.invoke('vca:exportFiles', files),
  saveLegacyOriginal: (payload) => ipcRenderer.invoke('vca:saveLegacyOriginal', payload),
});
