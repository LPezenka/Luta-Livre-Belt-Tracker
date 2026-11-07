import { FILE_NAMES, type FileMap } from '../../core/models';
import { emptyFileSet } from '../../core/serialization';
import {
  getDirectoryHandle,
  putDirectoryHandle,
} from './idb';
import type {
  BackupInfo,
  LoadedData,
  SaveResult,
  StorageAdapter,
  StorageCapabilities,
} from './types';

const DRAFT_KEY = 'vca-luta:draft:v1';
const DRAFT_BACKUPS_KEY = 'vca-luta:draft-backups:v1';
const LEGACY_ORIGINAL_KEY = 'vca-luta:legacy-original:v1';

interface DraftBackup {
  id: string;
  createdAt: string;
  files: FileMap;
}

function canUseLocalStorage(): boolean {
  try {
    const key = '__vca_test__';
    localStorage.setItem(key, '1');
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

function readDraft(): FileMap | null {
  if (!canUseLocalStorage()) return null;
  const raw = localStorage.getItem(DRAFT_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as FileMap;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function writeDraft(files: FileMap): void {
  if (!canUseLocalStorage()) {
    throw new Error(
      'Browser storage is unavailable. Use "Export CSV files" to keep your changes.',
    );
  }
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(files));
  } catch (error) {
    throw new Error(
      `The browser working copy could not be saved (${(error as Error).message}). Export the CSV files now to avoid losing changes.`,
    );
  }
}

function readDraftBackups(): DraftBackup[] {
  if (!canUseLocalStorage()) return [];
  try {
    const raw = localStorage.getItem(DRAFT_BACKUPS_KEY);
    const parsed = raw ? (JSON.parse(raw) as DraftBackup[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function pushDraftBackup(files: FileMap): void {
  if (!canUseLocalStorage()) return;
  try {
    const backups = readDraftBackups();
    backups.unshift({
      id: `draft-${new Date().toISOString().replace(/[:.]/g, '-')}`,
      createdAt: new Date().toISOString(),
      files,
    });
    localStorage.setItem(DRAFT_BACKUPS_KEY, JSON.stringify(backups.slice(0, 10)));
  } catch {
    // Backups are best-effort in draft mode.
  }
}

function writeDraftBackup(files: FileMap): string | null {
  const previous = readDraft();
  if (!previous) return null;
  const id = `draft-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  pushDraftBackup(previous);
  void files;
  return id;
}

async function fetchSeed(): Promise<FileMap> {
  const files: FileMap = {};
  try {
    for (const name of FILE_NAMES) {
      const url = new URL(`seed/${name}`, document.baseURI);
      const response = await fetch(url, { cache: 'no-cache' });
      if (!response.ok) throw new Error(`Could not load seed/${name}`);
      files[name] = await response.text();
    }
    return files;
  } catch {
    return emptyFileSet();
  }
}

function timestampId(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function browserSupportsFolderAccess(): boolean {
  return typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';
}

export class BrowserStorageAdapter implements StorageAdapter {
  kind: StorageAdapter['kind'] = 'pwa-draft';

  private directory: any = null;

  capabilities(): StorageCapabilities {
    if (this.kind === 'pwa-files') {
      return {
        kind: 'pwa-files',
        directFileAccess: true,
        autoSave: true,
        canChooseDirectory: true,
        canOpenFolder: false,
        canListBackups: true,
        label: `Saving directly to folder "${this.directory?.name ?? 'data'}"`,
      };
    }
    return {
      kind: 'pwa-draft',
      directFileAccess: false,
      autoSave: false,
      canChooseDirectory: browserSupportsFolderAccess(),
      canOpenFolder: false,
      canListBackups: true,
      label: 'Browser working copy — not yet saved to CSV files',
    };
  }

  async load(): Promise<LoadedData> {
    const handle = await getDirectoryHandle();
    if (handle) {
      try {
        const permission = await (handle as any).queryPermission({ mode: 'readwrite' });
        if (permission === 'granted') {
          this.directory = handle;
          this.kind = 'pwa-files';
          const files = await this.readDirectory();
          if (Object.keys(files).length === 0) {
            const seed = await fetchSeed();
            await this.writeDirectory(seed, false);
            return {
              files: seed,
              sourceLabel: `Folder "${handle.name}" (seeded with bundled data)`,
              capabilities: this.capabilities(),
              seeded: true,
            };
          }
          return {
            files,
            sourceLabel: `Folder "${handle.name}"`,
            capabilities: this.capabilities(),
          };
        }
      } catch {
        // Fall through to the working copy; the coach can reconnect the folder.
      }
    }

    const draft = readDraft();
    if (draft) {
      return {
        files: draft,
        sourceLabel: 'Browser working copy (not saved to CSV files)',
        capabilities: this.capabilities(),
        warnings: [
          'Changes are kept in this browser only. Use "Open data folder" for direct CSV saving, or export the CSV files regularly.',
        ],
      };
    }

    const seed = await fetchSeed();
    return {
      files: seed,
      sourceLabel: 'Bundled seed data (not yet saved to CSV files)',
      capabilities: this.capabilities(),
      seeded: true,
      warnings: [
        'This is a browser working copy. Choose a data folder for automatic CSV saving, or export the files after making changes.',
      ],
    };
  }

  async save(files: FileMap): Promise<SaveResult> {
    this.assertComplete(files);
    if (this.directory) {
      const backupId = await this.writeDirectory(files, true);
      return { backupId };
    }
    const backupId = writeDraftBackup(files);
    writeDraft(files);
    return { backupId };
  }

  async chooseDirectory(currentFiles: FileMap): Promise<LoadedData | null> {
    const picker = (window as unknown as {
      showDirectoryPicker?: (options?: unknown) => Promise<any>;
    }).showDirectoryPicker;
    if (!picker) {
      throw new Error(
        'This browser does not support direct folder access. Use export/import instead.',
      );
    }
    let handle: any;
    try {
      handle = await picker({ mode: 'readwrite', id: 'vca-luta-data' });
    } catch (error) {
      if ((error as Error).name === 'AbortError') return null;
      throw error;
    }
    const permission = await (handle as any).requestPermission({ mode: 'readwrite' });
    if (permission !== 'granted') {
      throw new Error('Folder permission was not granted.');
    }

    const previous = this.directory;
    this.directory = handle;
    this.kind = 'pwa-files';
    try {
      const files = await this.readDirectory();
      if (Object.keys(files).length === 0) {
        this.assertComplete(currentFiles);
        await this.writeDirectory(currentFiles, false);
        await putDirectoryHandle(handle);
        return {
          files: currentFiles,
          sourceLabel: `Folder "${handle.name}" (seeded with the current working copy)`,
          capabilities: this.capabilities(),
          seeded: true,
        };
      }
      await putDirectoryHandle(handle);
      return {
        files,
        sourceLabel: `Folder "${handle.name}"`,
        capabilities: this.capabilities(),
      };
    } catch (error) {
      this.directory = previous;
      this.kind = previous ? 'pwa-files' : 'pwa-draft';
      throw error;
    }
  }

  async listBackups(): Promise<BackupInfo[]> {
    if (!this.directory) {
      return readDraftBackups().map((backup) => ({
        id: backup.id,
        type: 'draft' as const,
        createdAt: backup.createdAt,
        files: FILE_NAMES.filter((name) => backup.files[name] != null),
        restorable: true,
      }));
    }

    const backups: BackupInfo[] = [];
    try {
      const root = await this.directory.getDirectoryHandle('backups', { create: false });
      for await (const entry of root.values()) {
        if (entry.kind !== 'directory') continue;
        const dir = entry as any;
        let createdAt: string | null = null;
        try {
          const metadataHandle = await dir.getFileHandle('metadata.json');
          const metadata = JSON.parse(await (await metadataHandle.getFile()).text());
          createdAt = metadata.createdAt ?? null;
        } catch {
          createdAt = null;
        }
        const files: string[] = [];
        for (const name of FILE_NAMES) {
          try {
            await dir.getFileHandle(name);
            files.push(name);
          } catch {
            // Missing in this backup.
          }
        }
        backups.push({
          id: dir.name,
          type: 'snapshot',
          createdAt,
          files,
          restorable: files.length > 0,
        });
      }
    } catch {
      return [];
    }
    return backups.sort((a, b) => b.id.localeCompare(a.id));
  }

  async restoreBackup(backupId: string): Promise<LoadedData> {
    if (!this.directory) {
      const backup = readDraftBackups().find((entry) => entry.id === backupId);
      if (!backup) throw new Error('Working-copy backup not found.');
      pushDraftBackup(readDraft() ?? {});
      writeDraft(backup.files);
      return {
        files: backup.files,
        sourceLabel: 'Browser working copy (restored snapshot)',
        capabilities: this.capabilities(),
      };
    }

    if (!/^[A-Za-z0-9._-]+$/.test(backupId) || backupId.includes('..')) {
      throw new Error('Invalid backup id.');
    }
    const root = await this.directory.getDirectoryHandle('backups', { create: false });
    const dir = await root.getDirectoryHandle(backupId, { create: false });
    const files = await this.readDirectoryFrom(dir);
    if (Object.keys(files).length === 0) throw new Error('Backup contains no data files.');

    const current = await this.readDirectory();
    if (Object.keys(current).length > 0) {
      await this.writeBackup(current);
    }
    await this.writeDirectory(files, false);
    return {
      files,
      sourceLabel: `Folder "${this.directory.name}" (restored ${backupId})`,
      capabilities: this.capabilities(),
    };
  }

  async exportFiles(files: FileMap): Promise<void> {
    this.assertComplete(files);
    if (browserSupportsFolderAccess()) {
      const picker = (window as unknown as {
        showDirectoryPicker?: (options?: unknown) => Promise<any>;
      }).showDirectoryPicker!;
      let handle: any;
      try {
        handle = await picker({ mode: 'readwrite', id: 'vca-luta-export' });
      } catch (error) {
        if ((error as Error).name === 'AbortError') return;
        throw error;
      }
      await (handle as any).requestPermission({ mode: 'readwrite' });
      await this.writeDirectoryTo(handle, files);
      return;
    }

    for (const [name, content] of Object.entries(files)) {
      const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = name;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
  }

  async saveLegacyOriginal(name: string, text: string): Promise<void> {
    if (this.directory) {
      const backups = await this.directory.getDirectoryHandle('backups', { create: true });
      const safeName = String(name || 'legacy.csv').replace(/[^A-Za-z0-9._ -]/g, '_');
      const fileHandle = await backups.getFileHandle(
        `original-${timestampId()}-${safeName}`,
        { create: true },
      );
      const writable = await fileHandle.createWritable();
      await writable.write(text);
      await writable.close();
      return;
    }
    if (!canUseLocalStorage()) return;
    try {
      localStorage.setItem(
        LEGACY_ORIGINAL_KEY,
        JSON.stringify({ name, text, savedAt: new Date().toISOString() }),
      );
    } catch {
      // Best effort; the coach can still keep the source file.
    }
  }

  private assertComplete(files: FileMap): void {
    for (const name of FILE_NAMES) {
      if (typeof files[name] !== 'string') {
        throw new Error(`The data set is missing ${name}; nothing was written.`);
      }
    }
  }

  private async readDirectory(): Promise<FileMap> {
    return this.readDirectoryFrom(this.directory);
  }

  private async readDirectoryFrom(dir: any): Promise<FileMap> {
    const files: FileMap = {};
    for (const name of FILE_NAMES) {
      try {
        const handle = await dir.getFileHandle(name);
        files[name] = await (await handle.getFile()).text();
      } catch {
        // Missing file.
      }
    }
    return files;
  }

  private async writeDirectory(files: FileMap, backup: boolean): Promise<string | null> {
    if (!this.directory) throw new Error('No data folder is connected.');
    if (backup) {
      const current = await this.readDirectory();
      if (Object.keys(current).length > 0) {
        return this.writeBackup(current);
      }
    }
    await this.writeDirectoryTo(this.directory, files);
    return null;
  }

  private async writeBackup(files: FileMap): Promise<string> {
    const root = await this.directory.getDirectoryHandle('backups', { create: true });
    const id = timestampId();
    const dir = await root.getDirectoryHandle(id, { create: true });
    // Record every canonical file so a restore always produces a complete set.
    for (const name of FILE_NAMES) {
      const handle = await dir.getFileHandle(name, { create: true });
      const writable = await handle.createWritable();
      await writable.write(files[name] ?? '');
      await writable.close();
    }
    const metadata = await dir.getFileHandle('metadata.json', { create: true });
    const writable = await metadata.createWritable();
    await writable.write(
      `${JSON.stringify(
        { id, createdAt: new Date().toISOString(), files: Object.keys(files) },
        null,
        2,
      )}\n`,
    );
    await writable.close();
    return id;
  }

  private async writeDirectoryTo(dir: any, files: FileMap): Promise<void> {
    this.assertComplete(files);
    for (const name of FILE_NAMES) {
      const handle = await dir.getFileHandle(name, { create: true });
      const writable = await handle.createWritable();
      await writable.write(files[name]);
      await writable.close();
    }
  }
}

export const browserStorage = new BrowserStorageAdapter();
