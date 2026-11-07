'use strict';

/**
 * Headless-ish Electron smoke test:
 *  - starts a BrowserWindow with the real preload bridge and built renderer
 *  - serves the bundled seed through the real data store
 *  - verifies the Vue UI renders and the IPC save path writes canonical files
 *  - captures a screenshot for visual inspection
 *
 * Run after `npm run build`: npx electron scripts/electron-smoke.cjs
 */

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const store = require('../electron/dataStore.cjs');

const root = path.join(__dirname, '..');
const dataDir = path.join(app.getPath('temp'), 'vca-electron-smoke-data');
const seedDir = path.join(root, 'public', 'seed');

function registerHandlers() {
  ipcMain.handle('vca:load', async () => {
    const result = await store.loadFiles(dataDir, seedDir);
    return {
      ok: true,
      files: result.files,
      dataDir,
      seeded: result.seeded,
      recovery: result.recovery,
    };
  });
  ipcMain.handle('vca:getInfo', async () => ({
    ok: true,
    dataDir,
    platform: process.platform,
    appVersion: app.getVersion(),
    packaged: false,
    seedDir,
  }));
  ipcMain.handle('vca:save', async (_event, files) => {
    try {
      const result = await store.commitFiles(dataDir, files);
      return { ok: true, backupId: result.backupId, dataDir };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
  ipcMain.handle('vca:listBackups', async () => ({
    ok: true,
    backups: await store.listBackups(dataDir),
  }));
  ipcMain.handle('vca:openDataDir', async () => ({ ok: true }));
  ipcMain.handle('vca:chooseDataDir', async () => ({ ok: false, canceled: true }));
  ipcMain.handle('vca:importFile', async () => ({ ok: false, canceled: true }));
  ipcMain.handle('vca:exportFiles', async () => ({ ok: false, canceled: true }));
  ipcMain.handle('vca:restoreBackup', async () => ({ ok: false, error: 'not used' }));
  ipcMain.handle('vca:saveLegacyOriginal', async () => ({ ok: true }));
}

async function waitFor(check, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('Timed out waiting for renderer.');
}

app.whenReady().then(async () => {
  await fs.rm(dataDir, { recursive: true, force: true });
  registerHandlers();

  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    show: false,
    webPreferences: {
      preload: path.join(root, 'electron', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const consoleErrors = [];
  win.webContents.on('console-message', (...args) => {
    const message = typeof args[2] === 'string' ? args[2] : JSON.stringify(args[2]);
    if (String(message).toLowerCase().includes('error')) consoleErrors.push(message);
  });

  await win.loadFile(path.join(root, 'dist', 'index.html'));
  const heading = await waitFor(() =>
    win.webContents.executeJavaScript('document.querySelector("h1")?.innerText || ""'),
  );
  const rows = await win.webContents.executeJavaScript(
    'document.querySelectorAll("table.table tbody tr").length',
  );
  const bridge = await win.webContents.executeJavaScript(
    'window.vca && window.vca.isElectron ? true : false',
  );

  // Exercise the real IPC save path with the loaded canonical files.
  const saveResult = await win.webContents.executeJavaScript(`(async () => {
    const loaded = await window.vca.load();
    const files = { ...loaded.files };
    files['students.csv'] = files['students.csv'].replace('David B', 'David B (Electron smoke)');
    const saved = await window.vca.save(files);
    const after = await window.vca.load();
    return { saved, contains: after.files['students.csv'].includes('Electron smoke') };
  })()`);

  const image = await win.webContents.capturePage();
  const shotPath = path.join(root, 'electron-smoke.png');
  await fs.writeFile(shotPath, image.toPNG());

  console.log(
    JSON.stringify(
      {
        heading,
        rows,
        bridge,
        saveResult,
        consoleErrors,
        screenshot: shotPath,
        dataDir,
      },
      null,
      2,
    ),
  );

  app.quit();
}).catch((error) => {
  console.error('SMOKE TEST FAILED', error);
  app.exit(1);
});
