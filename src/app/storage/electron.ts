import type { FileMap } from '../../core/models';
import type {
  BackupInfo,
  LoadedData,
  SaveResult,
  StorageAdapter,
  StorageCapabilities,
} from './types';

export interface VcaFileResult {
  ok: boolean;
  error?: string;
  canceled?: boolean;
  files?: FileMap;
  dataDir?: string;
  seeded?: boolean;
  recovery?: unknown;
  backupId?: string | null;
  backups?: BackupInfo[];
  name?: string;
  text?: string;
  targetDir?: string;
  restoredFrom?: string;
  safetyBackupId?: string | null;
  platform?: string;
  appVersion?: string;
  packaged?: boolean;
  seedDir?: string | null;
  id?: string;
  path?: string;
}

export interface VcaApi {
  isElectron: true;
  load(): Promise<VcaFileResult>;
  save(files: FileMap): Promise<VcaFileResult>;
  getInfo(): Promise<VcaFileResult>;
  chooseDataDir(): Promise<VcaFileResult>;
  openDataDir(): Promise<VcaFileResult>;
  listBackups(): Promise<VcaFileResult>;
  restoreBackup(backupId: string): Promise<VcaFileResult>;
  importFile(options?: {
    title?: string;
    filters?: Array<{ name: string; extensions: string[] }>;
  }): Promise<VcaFileResult>;
  exportFiles(files: FileMap): Promise<VcaFileResult>;
  saveLegacyOriginal(payload: { name: string; text: string }): Promise<VcaFileResult>;
}

export class ElectronStorageAdapter implements StorageAdapter {
  kind: StorageAdapter['kind'] = 'electron';

  private dataDir = '';

  capabilities(): StorageCapabilities {
    return {
      kind: 'electron',
      directFileAccess: true,
      autoSave: true,
      canChooseDirectory: true,
      canOpenFolder: true,
      canListBackups: true,
      label: this.dataDir ? `Saving directly to ${this.dataDir}` : 'Saving directly to local CSV files',
    };
  }

  private api(): VcaApi {
    if (!window.vca) throw new Error('The Electron preload bridge is unavailable.');
    return window.vca;
  }

  private loaded(result: VcaFileResult, sourceLabel?: string): LoadedData {
    if (result.dataDir) this.dataDir = result.dataDir;
    return {
      files: result.files ?? {},
      sourceLabel: sourceLabel ?? result.dataDir ?? this.dataDir,
      capabilities: this.capabilities(),
      seeded: result.seeded,
      recovery: result.recovery,
    };
  }

  async load(): Promise<LoadedData> {
    const result = await this.api().load();
    if (!result.ok) throw new Error(result.error ?? 'Could not load the data folder.');
    return this.loaded(result);
  }

  async save(files: FileMap): Promise<SaveResult> {
    const result = await this.api().save(files);
    if (!result.ok) throw new Error(result.error ?? 'The data files could not be saved.');
    return { backupId: result.backupId ?? null };
  }

  async chooseDirectory(): Promise<LoadedData | null> {
    const result = await this.api().chooseDataDir();
    if (result.canceled) return null;
    if (!result.ok) throw new Error(result.error ?? 'Could not open the selected folder.');
    return this.loaded(result);
  }

  async openFolder(): Promise<void> {
    const result = await this.api().openDataDir();
    if (!result.ok) throw new Error(result.error ?? 'Could not open the data folder.');
  }

  async listBackups(): Promise<BackupInfo[]> {
    const result = await this.api().listBackups();
    if (!result.ok) throw new Error(result.error ?? 'Could not list backups.');
    return result.backups ?? [];
  }

  async restoreBackup(backupId: string): Promise<LoadedData> {
    const result = await this.api().restoreBackup(backupId);
    if (!result.ok) throw new Error(result.error ?? 'Could not restore the backup.');
    return this.loaded(result, `Restored backup ${backupId}`);
  }

  async importFile(options?: {
    title?: string;
    filters?: Array<{ name: string; extensions: string[] }>;
  }): Promise<{ name: string; text: string } | null> {
    const result = await this.api().importFile(options);
    if (result.canceled) return null;
    if (!result.ok) throw new Error(result.error ?? 'Could not read the selected file.');
    return { name: result.name ?? 'file', text: result.text ?? '' };
  }

  async exportFiles(files: FileMap): Promise<void> {
    const result = await this.api().exportFiles(files);
    if (result.canceled) return;
    if (!result.ok) throw new Error(result.error ?? 'Could not export the CSV files.');
  }

  async saveLegacyOriginal(name: string, text: string): Promise<void> {
    const result = await this.api().saveLegacyOriginal({ name, text });
    if (!result.ok) throw new Error(result.error ?? 'Could not back up the original file.');
  }
}

export const electronStorage = new ElectronStorageAdapter();
