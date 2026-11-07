'use strict';

const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const store = require('./dataStore.cjs');

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
let mainWindow = null;

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

async function readSettings() {
  try {
    return JSON.parse(await fsp.readFile(settingsPath(), 'utf8'));
  } catch {
    return {};
  }
}

async function writeSettings(settings) {
  const target = settingsPath();
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.writeFile(target, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
}

async function dataDir() {
  const settings = await readSettings();
  return settings.dataDir || path.join(app.getPath('userData'), 'data');
}

function seedDir() {
  const candidates = [];
  if (app.isPackaged) candidates.push(path.join(process.resourcesPath, 'seed'));
  candidates.push(path.join(app.getAppPath(), 'public', 'seed'));
  candidates.push(path.join(app.getAppPath(), 'dist', 'seed'));
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function assertSender(event) {
  if (!mainWindow || event.sender !== mainWindow.webContents) {
    throw new Error('Rejected IPC call from an unexpected renderer.');
  }
}

async function loadPayload() {
  const dir = await dataDir();
  const result = await store.loadFiles(dir, seedDir());
  return {
    ok: true,
    files: result.files,
    dataDir: dir,
    seeded: result.seeded,
    recovery: result.recovery,
  };
}

function registerHandlers() {
  ipcMain.handle('vca:load', async (event) => {
    try {
      assertSender(event);
      return await loadPayload();
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('vca:save', async (event, files) => {
    try {
      assertSender(event);
      const dir = await dataDir();
      const result = await store.commitFiles(dir, files);
      return { ok: true, backupId: result.backupId, dataDir: dir };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('vca:getInfo', async (event) => {
    try {
      assertSender(event);
      return {
        ok: true,
        dataDir: await dataDir(),
        platform: process.platform,
        appVersion: app.getVersion(),
        packaged: app.isPackaged,
        seedDir: seedDir(),
      };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('vca:chooseDataDir', async (event) => {
    try {
      assertSender(event);
      const current = await dataDir();
      const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Choose Luta Belt Tracker data folder',
        defaultPath: current,
        properties: ['openDirectory', 'createDirectory'],
      });
      if (result.canceled || result.filePaths.length === 0) {
        return { ok: false, canceled: true };
      }
      const chosen = result.filePaths[0];
      const settings = await readSettings();
      settings.dataDir = chosen;
      await writeSettings(settings);
      return await loadPayload();
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('vca:openDataDir', async (event) => {
    try {
      assertSender(event);
      const dir = await dataDir();
      await fsp.mkdir(dir, { recursive: true });
      const error = await shell.openPath(dir);
      return error ? { ok: false, error } : { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('vca:listBackups', async (event) => {
    try {
      assertSender(event);
      const backups = await store.listBackups(await dataDir());
      return { ok: true, backups };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('vca:restoreBackup', async (event, backupId) => {
    try {
      assertSender(event);
      const dir = await dataDir();
      const restored = await store.restoreBackup(dir, backupId);
      return {
        ok: true,
        restoredFrom: restored.restoredFrom,
        safetyBackupId: restored.safetyBackupId,
        files: restored.files,
      };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('vca:importFile', async (event, options = {}) => {
    try {
      assertSender(event);
      const filters = Array.isArray(options.filters)
        ? options.filters
        : [{ name: 'CSV or JSON', extensions: ['csv', 'json', 'txt'] }];
      const result = await dialog.showOpenDialog(mainWindow, {
        title: options.title || 'Open file',
        properties: ['openFile'],
        filters,
      });
      if (result.canceled || result.filePaths.length === 0) {
        return { ok: false, canceled: true };
      }
      const filePath = result.filePaths[0];
      const stat = await fsp.stat(filePath);
      if (stat.size > 20 * 1024 * 1024) {
        return { ok: false, error: 'File is larger than 20 MB.' };
      }
      const text = await fsp.readFile(filePath, 'utf8');
      return { ok: true, name: path.basename(filePath), path: filePath, text };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('vca:exportFiles', async (event, files) => {
    try {
      assertSender(event);
      const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Choose a folder for exported CSV files',
        properties: ['openDirectory', 'createDirectory'],
      });
      if (result.canceled || result.filePaths.length === 0) {
        return { ok: false, canceled: true };
      }
      const target = result.filePaths[0];
      const written = await store.exportFiles(target, files);
      return { ok: true, targetDir: written.targetDir, files: written.files };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('vca:saveLegacyOriginal', async (event, payload = {}) => {
    try {
      assertSender(event);
      const dir = await dataDir();
      const saved = await store.saveLegacyOriginal(
        dir,
        payload.name || 'legacy.csv',
        String(payload.text ?? ''),
      );
      return { ok: true, id: saved.id, path: saved.path };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 880,
    minWidth: 360,
    minHeight: 520,
    backgroundColor: '#ffffff',
    title: 'Luta Belt Tracker — VCA',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = isDev && url.startsWith(process.env.VITE_DEV_SERVER_URL || '');
    if (!allowed && !url.startsWith('file://')) event.preventDefault();
  });

  if (isDev) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  registerHandlers();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
