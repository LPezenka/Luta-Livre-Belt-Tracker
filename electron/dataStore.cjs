'use strict';

/**
 * Electron filesystem data store.
 *
 * Canonical files live in a user-selected data directory:
 *   students.csv, gradings.csv, checklists.csv, checklist_progress.csv, config.json
 *
 * Every commit:
 *   1. copies the previous valid files into backups/<timestamp>/
 *   2. writes a .transaction.json journal containing the complete next state
 *   3. writes each file via a temporary file + rename (atomic on the platform)
 *   4. removes the journal
 *
 * If the process crashes between steps 2 and 4, the next load replays the
 * journal. If a write throws, the previous backup is restored immediately.
 */

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const FILE_NAMES = [
  'students.csv',
  'gradings.csv',
  'checklists.csv',
  'checklist_progress.csv',
  'config.json',
];

const JOURNAL_NAME = '.transaction.json';
const BACKUPS_DIR = 'backups';
const MAX_FILE_BYTES = 20 * 1024 * 1024;

function sanitizeFiles(files) {
  if (!files || typeof files !== 'object' || Array.isArray(files)) {
    throw new Error('No data files were supplied.');
  }
  const output = {};
  for (const [name, content] of Object.entries(files)) {
    if (!FILE_NAMES.includes(name)) {
      throw new Error(`Unknown data file: ${name}`);
    }
    if (typeof content !== 'string') {
      throw new Error(`Invalid content for ${name}.`);
    }
    if (content.length > MAX_FILE_BYTES) {
      throw new Error(`${name} is too large.`);
    }
    output[name] = content;
  }
  return output;
}

function assertCompleteFileSet(files) {
  for (const name of FILE_NAMES) {
    if (!(name in files)) {
      throw new Error(`The transaction is missing ${name}; no files were written.`);
    }
  }
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

function timestampId() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function sanitizeBackupId(id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9._-]+$/.test(id) || id.includes('..')) {
    throw new Error('Invalid backup id.');
  }
  return id;
}

async function uniqueBackupId(dataDir) {
  const base = timestampId();
  let candidate = base;
  let counter = 1;
  while (await exists(path.join(dataDir, BACKUPS_DIR, candidate))) {
    candidate = `${base}-${counter}`;
    counter += 1;
  }
  return candidate;
}

async function writeAtomic(filePath, content) {
  const tempPath = `${filePath}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  await fs.writeFile(tempPath, content, 'utf8');
  try {
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.rm(tempPath, { force: true });
    throw error;
  }
}

async function readFiles(dir) {
  const files = {};
  for (const name of FILE_NAMES) {
    try {
      files[name] = await fs.readFile(path.join(dir, name), 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return files;
}

async function backupCurrent(dataDir, files) {
  const names = FILE_NAMES.filter((name) => files[name] != null);
  if (names.length === 0) return null;

  const id = await uniqueBackupId(dataDir);
  const backupDir = path.join(dataDir, BACKUPS_DIR, id);
  await ensureDir(backupDir);
  // Store every canonical file so a restore always produces a complete set.
  // Files that did not exist yet are recorded as empty strings.
  for (const name of FILE_NAMES) {
    await fs.writeFile(path.join(backupDir, name), files[name] ?? '', 'utf8');
  }
  await fs.writeFile(
    path.join(backupDir, 'metadata.json'),
    `${JSON.stringify(
      {
        id,
        createdAt: new Date().toISOString(),
        files: names,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  return id;
}

async function restoreFromBackupDir(dataDir, backupId) {
  const safeId = sanitizeBackupId(backupId);
  const backupDir = path.join(dataDir, BACKUPS_DIR, safeId);
  const files = await readFiles(backupDir);
  if (Object.keys(files).length === 0) {
    throw new Error(`Backup ${safeId} contains no data files.`);
  }
  for (const [name, content] of Object.entries(files)) {
    await writeAtomic(path.join(dataDir, name), content);
  }
  return files;
}

async function writeTransaction(dataDir, files, rollbackBackupId) {
  const journalPath = path.join(dataDir, JOURNAL_NAME);
  await writeAtomic(
    journalPath,
    `${JSON.stringify(
      {
        startedAt: new Date().toISOString(),
        files,
      },
      null,
      2,
    )}\n`,
  );

  try {
    for (const name of FILE_NAMES) {
      if (files[name] != null) {
        await writeAtomic(path.join(dataDir, name), files[name]);
      }
    }
    await fs.rm(journalPath, { force: true });
  } catch (error) {
    if (rollbackBackupId) {
      try {
        await restoreFromBackupDir(dataDir, rollbackBackupId);
      } catch (rollbackError) {
        error.message = `${error.message} (rollback also failed: ${rollbackError.message})`;
      }
    }
    await fs.rm(journalPath, { force: true });
    throw error;
  }
}

async function seedIfEmpty(dataDir, seedDir) {
  await ensureDir(dataDir);
  const existing = await readFiles(dataDir);
  if (Object.keys(existing).length > 0) {
    return { seeded: false, files: existing };
  }
  if (!seedDir) return { seeded: false, files: {} };

  const seed = await readFiles(seedDir);
  if (Object.keys(seed).length === 0) return { seeded: false, files: {} };

  for (const [name, content] of Object.entries(seed)) {
    await writeAtomic(path.join(dataDir, name), content);
  }
  try {
    await fs.copyFile(
      path.join(seedDir, 'import-report.json'),
      path.join(dataDir, 'import-report.json'),
    );
  } catch {
    // Optional report only.
  }
  return { seeded: true, files: seed };
}

async function recoverJournal(dataDir) {
  const journalPath = path.join(dataDir, JOURNAL_NAME);
  if (!(await exists(journalPath))) return null;

  try {
    const raw = await fs.readFile(journalPath, 'utf8');
    const journal = JSON.parse(raw);
    const files = sanitizeFiles(journal.files);
    for (const [name, content] of Object.entries(files)) {
      await writeAtomic(path.join(dataDir, name), content);
    }
    await fs.rm(journalPath, { force: true });
    return {
      recovered: true,
      files: Object.keys(files),
      startedAt: journal.startedAt ?? null,
    };
  } catch (error) {
    const corruptPath = `${journalPath}.corrupt-${Date.now()}`;
    try {
      await fs.rename(journalPath, corruptPath);
    } catch {
      // Ignore; the original error is more useful.
    }
    return { recovered: false, error: error.message, corruptPath };
  }
}

async function loadFiles(dataDir, seedDir) {
  await ensureDir(dataDir);
  const seeded = await seedIfEmpty(dataDir, seedDir);
  const recovery = await recoverJournal(dataDir);
  const files = await readFiles(dataDir);
  return {
    files,
    seeded: seeded.seeded,
    recovery,
    dataDir,
  };
}

async function commitFiles(dataDir, inputFiles) {
  const files = sanitizeFiles(inputFiles);
  assertCompleteFileSet(files);
  await ensureDir(dataDir);
  const current = await readFiles(dataDir);
  const backupId = await backupCurrent(dataDir, current);
  await writeTransaction(dataDir, files, backupId);
  return { backupId, files: Object.keys(files) };
}

async function listBackups(dataDir) {
  const root = path.join(dataDir, BACKUPS_DIR);
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  const backups = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const dir = path.join(root, entry.name);
      let metadata = null;
      try {
        metadata = JSON.parse(await fs.readFile(path.join(dir, 'metadata.json'), 'utf8'));
      } catch {
        metadata = null;
      }
      const present = [];
      for (const name of FILE_NAMES) {
        if (await exists(path.join(dir, name))) present.push(name);
      }
      backups.push({
        id: entry.name,
        type: 'snapshot',
        createdAt: metadata?.createdAt ?? null,
        files: present,
        restorable: present.length > 0,
      });
    } else if (entry.isFile() && entry.name.startsWith('original-')) {
      const stat = await fs.stat(path.join(root, entry.name));
      backups.push({
        id: entry.name,
        type: 'legacy-original',
        createdAt: stat.mtime.toISOString(),
        files: [entry.name],
        restorable: false,
      });
    }
  }

  return backups.sort((a, b) => b.id.localeCompare(a.id));
}

async function restoreBackup(dataDir, backupId) {
  const safeId = sanitizeBackupId(backupId);
  const backupDir = path.join(dataDir, BACKUPS_DIR, safeId);
  if (!(await exists(backupDir))) {
    throw new Error(`Backup ${safeId} was not found.`);
  }
  const backupFiles = await readFiles(backupDir);
  if (Object.keys(backupFiles).length === 0) {
    throw new Error(`Backup ${safeId} contains no data files.`);
  }
  assertCompleteFileSet(backupFiles);

  await ensureDir(dataDir);
  const current = await readFiles(dataDir);
  const safetyBackupId = await backupCurrent(dataDir, current);
  await writeTransaction(dataDir, backupFiles, safetyBackupId);
  return { restoredFrom: safeId, safetyBackupId, files: backupFiles };
}

async function saveLegacyOriginal(dataDir, fileName, content) {
  await ensureDir(path.join(dataDir, BACKUPS_DIR));
  const safeName = String(fileName || 'legacy.csv').replace(/[^A-Za-z0-9._ -]/g, '_');
  const id = `original-${timestampId()}-${safeName}`;
  const target = path.join(dataDir, BACKUPS_DIR, id);
  await writeAtomic(target, content);
  return { id, path: target };
}

async function exportFiles(targetDir, inputFiles) {
  const files = sanitizeFiles(inputFiles);
  await ensureDir(targetDir);
  for (const [name, content] of Object.entries(files)) {
    await writeAtomic(path.join(targetDir, name), content);
  }
  return { targetDir, files: Object.keys(files) };
}

module.exports = {
  FILE_NAMES,
  JOURNAL_NAME,
  sanitizeFiles,
  assertCompleteFileSet,
  loadFiles,
  commitFiles,
  listBackups,
  restoreBackup,
  saveLegacyOriginal,
  exportFiles,
  writeAtomic,
  readFiles,
};
