import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const store = require('../electron/dataStore.cjs') as {
  FILE_NAMES: string[];
  JOURNAL_NAME: string;
  loadFiles: (dataDir: string, seedDir: string | null) => Promise<{
    files: Record<string, string>;
    seeded: boolean;
    recovery: null | { recovered: boolean; files?: string[]; error?: string };
  }>;
  commitFiles: (dataDir: string, files: Record<string, string>) => Promise<{ backupId: string | null }>;
  listBackups: (dataDir: string) => Promise<
    Array<{ id: string; type: string; files: string[]; restorable: boolean }>
  >;
  restoreBackup: (dataDir: string, backupId: string) => Promise<{
    restoredFrom: string;
    safetyBackupId: string | null;
    files: Record<string, string>;
  }>;
  saveLegacyOriginal: (
    dataDir: string,
    name: string,
    text: string,
  ) => Promise<{ id: string; path: string }>;
  exportFiles: (targetDir: string, files: Record<string, string>) => Promise<{ targetDir: string }>;
};

function fileSet(marker: string): Record<string, string> {
  return {
    'students.csv': `id,name,current_belt,current_stripes\ns001,${marker},white,0\n`,
    'gradings.csv': 'id,student_id,date,type,belt,stripes_awarded\n',
    'checklists.csv': 'id,belt,sort_order,description,archived\n',
    'checklist_progress.csv': 'student_id,checklist_item_id,completed\n',
    'config.json': `${JSON.stringify({ belts: [{ id: 'white', name: 'White', maxStripes: 4, minMonthsToNextBelt: 12 }], upcomingEligibilityMonths: 3 }, null, 2)}\n`,
  };
}

let root: string;
let dataDir: string;
let seedDir: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'vca-store-'));
  dataDir = path.join(root, 'data');
  seedDir = path.join(root, 'seed');
  await fs.mkdir(seedDir, { recursive: true });
  for (const [name, content] of Object.entries(fileSet('Seed Student'))) {
    await fs.writeFile(path.join(seedDir, name), content, 'utf8');
  }
  await fs.writeFile(
    path.join(seedDir, 'import-report.json'),
    '{"studentCount":1}\n',
    'utf8',
  );
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('Electron data store', () => {
  it('seeds a new data directory from the bundled normalized files', async () => {
    const result = await store.loadFiles(dataDir, seedDir);
    expect(result.seeded).toBe(true);
    expect(result.files['students.csv']).toContain('Seed Student');
    expect(await fs.readFile(path.join(dataDir, 'import-report.json'), 'utf8')).toContain(
      'studentCount',
    );
  });

  it('does not overwrite an existing data directory', async () => {
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(path.join(dataDir, 'students.csv'), fileSet('Existing')['students.csv']);
    const result = await store.loadFiles(dataDir, seedDir);
    expect(result.seeded).toBe(false);
    expect(result.files['students.csv']).toContain('Existing');
  });

  it('creates a timestamped backup before writing new files', async () => {
    await store.loadFiles(dataDir, seedDir);
    const committed = await store.commitFiles(dataDir, fileSet('New Student'));
    expect(committed.backupId).toBeTruthy();
    expect(await fs.readFile(path.join(dataDir, 'students.csv'), 'utf8')).toContain('New Student');

    const backups = await store.listBackups(dataDir);
    expect(backups).toHaveLength(1);
    expect(backups[0].type).toBe('snapshot');
    expect(backups[0].restorable).toBe(true);
    const backupText = await fs.readFile(
      path.join(dataDir, 'backups', backups[0].id, 'students.csv'),
      'utf8',
    );
    expect(backupText).toContain('Seed Student');
  });

  it('restores a backup and creates a safety backup of the current state', async () => {
    await store.loadFiles(dataDir, seedDir);
    const first = await store.commitFiles(dataDir, fileSet('First Change'));
    expect(first.backupId).toBeTruthy();
    await store.commitFiles(dataDir, fileSet('Second Change'));

    const backups = await store.listBackups(dataDir);
    const seedBackup = backups.find((backup) => backup.id === first.backupId);
    expect(seedBackup).toBeTruthy();
    const restored = await store.restoreBackup(dataDir, first.backupId!);
    expect(restored.restoredFrom).toBe(first.backupId);
    expect(restored.safetyBackupId).toBeTruthy();
    expect(await fs.readFile(path.join(dataDir, 'students.csv'), 'utf8')).toContain(
      'Seed Student',
    );
  });

  it('replays a journal left behind by a crash', async () => {
    await store.loadFiles(dataDir, seedDir);
    const pending = fileSet('Recovered Student');
    await fs.writeFile(
      path.join(dataDir, store.JOURNAL_NAME),
      `${JSON.stringify({ startedAt: new Date().toISOString(), files: pending }, null, 2)}\n`,
      'utf8',
    );
    await fs.rm(path.join(dataDir, 'gradings.csv'), { force: true });

    const result = await store.loadFiles(dataDir, seedDir);
    expect(result.recovery?.recovered).toBe(true);
    expect(result.files['students.csv']).toContain('Recovered Student');
    expect(result.files['gradings.csv']).toBe(pending['gradings.csv']);
    await expect(fs.access(path.join(dataDir, store.JOURNAL_NAME))).rejects.toThrow();
  });

  it('rolls back to the previous backup when a write fails mid-transaction', async () => {
    await store.loadFiles(dataDir, seedDir);
    await store.commitFiles(dataDir, fileSet('First Change'));

    const originalRename = fs.rename.bind(fs);
    let calls = 0;
    const spy = vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      calls += 1;
      // Journal rename is #1; the first canonical file write is #2; fail on #3.
      if (calls === 3) throw new Error('simulated disk failure');
      return originalRename(from, to);
    });

    await expect(store.commitFiles(dataDir, fileSet('Second Change'))).rejects.toThrow(
      'simulated disk failure',
    );
    spy.mockRestore();

    const after = await fs.readFile(path.join(dataDir, 'students.csv'), 'utf8');
    expect(after).toContain('First Change');
    await expect(fs.access(path.join(dataDir, store.JOURNAL_NAME))).rejects.toThrow();
    const backups = await store.listBackups(dataDir);
    expect(backups.length).toBeGreaterThanOrEqual(1);
  });

  it('preserves the original legacy file as a non-restorable backup', async () => {
    await store.loadFiles(dataDir, seedDir);
    const saved = await store.saveLegacyOriginal(dataDir, 'Luta Livre Belts.csv', 'raw,data\n');
    expect(saved.id).toContain('original-');
    expect(await fs.readFile(saved.path, 'utf8')).toBe('raw,data\n');
    const backups = await store.listBackups(dataDir);
    expect(backups.some((backup) => backup.type === 'legacy-original')).toBe(true);
  });

  it('exports all CSV files to a chosen folder', async () => {
    const target = path.join(root, 'export');
    const files = fileSet('Exported');
    await store.exportFiles(target, files);
    expect(await fs.readFile(path.join(target, 'students.csv'), 'utf8')).toContain('Exported');
    expect(await fs.readFile(path.join(target, 'config.json'), 'utf8')).toContain('belts');
  });

  it('rejects unknown files and incomplete transactions', async () => {
    await store.loadFiles(dataDir, seedDir);
    await expect(
      store.commitFiles(dataDir, { ...fileSet('X'), 'evil.txt': 'nope' }),
    ).rejects.toThrow(/Unknown data file/);
    const incomplete = fileSet('X');
    delete incomplete['gradings.csv'];
    await expect(store.commitFiles(dataDir, incomplete)).rejects.toThrow(/missing gradings.csv/);
  });
});
