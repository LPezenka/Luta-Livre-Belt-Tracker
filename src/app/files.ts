import { electronStorage } from './storage/electron';

export interface PickedFile {
  name: string;
  text: string;
}

/**
 * Uses the native Electron dialog when available, otherwise a browser file
 * input. Both are local-only; nothing is uploaded.
 */
export async function pickTextFile(options: {
  title?: string;
  accept?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
} = {}): Promise<PickedFile | null> {
  if (window.vca?.isElectron) {
    return electronStorage.importFile({
      title: options.title,
      filters: options.filters,
    });
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = options.accept ?? '.csv,.json,text/csv,application/json';
    input.style.display = 'none';
    document.body.appendChild(input);
    let settled = false;
    let focusHandler: (() => void) | null = null;
    const finish = (value: PickedFile | null) => {
      if (settled) return;
      settled = true;
      if (focusHandler) window.removeEventListener('focus', focusHandler);
      input.remove();
      resolve(value);
    };
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        finish(null);
        return;
      }
      finish({ name: file.name, text: await file.text() });
    };
    input.oncancel = () => finish(null);
    focusHandler = () => {
      window.setTimeout(() => {
        if (!settled && (!input.files || input.files.length === 0)) finish(null);
      }, 400);
    };
    window.addEventListener('focus', focusHandler, { once: true });
    input.click();
  });
}

export async function pickMultipleTextFiles(
  accept = '.csv,.json,text/csv,application/json',
): Promise<PickedFile[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = accept;
    input.style.display = 'none';
    document.body.appendChild(input);
    let settled = false;
    let focusHandler: (() => void) | null = null;
    const finish = (value: PickedFile[]) => {
      if (settled) return;
      settled = true;
      if (focusHandler) window.removeEventListener('focus', focusHandler);
      input.remove();
      resolve(value);
    };
    input.onchange = async () => {
      const files = Array.from(input.files ?? []);
      if (files.length === 0) {
        finish([]);
        return;
      }
      const picked: PickedFile[] = [];
      for (const file of files) {
        picked.push({ name: file.name, text: await file.text() });
      }
      finish(picked);
    };
    input.oncancel = () => finish([]);
    focusHandler = () => {
      window.setTimeout(() => {
        if (!settled && (!input.files || input.files.length === 0)) finish([]);
      }, 400);
    };
    window.addEventListener('focus', focusHandler, { once: true });
    input.click();
  });
}

export function downloadTextFile(name: string, text: string, mime = 'text/plain'): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
