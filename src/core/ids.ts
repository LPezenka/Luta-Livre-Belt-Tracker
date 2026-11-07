/**
 * Stable, human-readable identifier generation (s001, g001, c001, ...).
 * IDs are never derived from names and are never reused while the existing
 * maximum numeric suffix is present.
 */

export function nextId(prefix: string, existing: Iterable<string>): string {
  let max = 0;
  for (const id of existing) {
    const match = new RegExp(`^${escapeRegExp(prefix)}(\\d+)$`, 'i').exec(id);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `${prefix}${String(max + 1).padStart(3, '0')}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function normalizeNameKey(value: string): string {
  return collapseWhitespace(value).toLocaleLowerCase();
}
