import type { FileMap } from '../../core/models';

export type StorageKind = 'electron' | 'pwa-files' | 'pwa-draft';

export interface StorageCapabilities {
  kind: StorageKind;
  /** True when edits are written to the canonical CSV files. */
  directFileAccess: boolean;
  /** True when every mutation is written immediately. */
  autoSave: boolean;
  canChooseDirectory: boolean;
  canOpenFolder: boolean;
  canListBackups: boolean;
  /** Short human-readable description for the save status bar. */
  label: string;
}

export interface LoadedData {
  files: FileMap;
  sourceLabel: string;
  capabilities: StorageCapabilities;
  seeded?: boolean;
  recovery?: unknown;
  warnings?: string[];
}

export interface BackupInfo {
  id: string;
  type: 'snapshot' | 'legacy-original' | 'draft';
  createdAt: string | null;
  files: string[];
  restorable: boolean;
}

export interface SaveResult {
  backupId?: string | null;
}

export interface StorageAdapter {
  kind: StorageKind;
  capabilities(): StorageCapabilities;
  load(): Promise<LoadedData>;
  save(files: FileMap): Promise<SaveResult>;
  chooseDirectory?(currentFiles: FileMap): Promise<LoadedData | null>;
  openFolder?(): Promise<void>;
  listBackups?(): Promise<BackupInfo[]>;
  restoreBackup?(backupId: string): Promise<LoadedData>;
  importFile?(options?: {
    title?: string;
    filters?: Array<{ name: string; extensions: string[] }>;
  }): Promise<{ name: string; text: string } | null>;
  exportFiles?(files: FileMap): Promise<void>;
  saveLegacyOriginal?(name: string, text: string): Promise<void>;
}
