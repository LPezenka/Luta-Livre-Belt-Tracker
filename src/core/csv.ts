/**
 * Minimal, dependency-free RFC 4180-style CSV parser/serializer.
 * Handles quoted fields, escaped quotes, CRLF/LF, and a UTF-8 BOM.
 */

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let started = false;
  let i = 0;

  if (text.charCodeAt(0) === 0xfeff) i = 1;

  for (; i < text.length; i += 1) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      started = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
      started = true;
    } else if (ch === '\n') {
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
      started = false;
    } else if (ch === '\r') {
      if (text[i + 1] === '\n') i += 1;
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
      started = false;
    } else {
      field += ch;
      started = true;
    }
  }

  if (started || field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

export function csvEscape(value: unknown): string {
  const text = value == null ? '' : String(value);
  const mustQuote =
    text.includes('"') ||
    text.includes(',') ||
    text.includes('\n') ||
    text.includes('\r') ||
    text !== text.trim();
  if (!mustQuote) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

export function serializeCsv(rows: Array<Array<unknown>>): string {
  if (rows.length === 0) return '';
  return `${rows.map((row) => row.map(csvEscape).join(',')).join('\n')}\n`;
}

export interface CsvTable {
  headers: string[];
  rows: string[][];
}

/** Parse a CSV that is expected to have a header row. */
export function parseCsvTable(text: string): CsvTable {
  const rows = parseCsv(text);
  if (rows.length === 0) return { headers: [], rows: [] };
  const headers = rows[0].map((h) => h.trim());
  return { headers, rows: rows.slice(1) };
}

/** Read a column by header name (case-insensitive), with positional fallback. */
export function columnReader(table: CsvTable) {
  const lookup = new Map<string, number>();
  table.headers.forEach((header, index) => {
    lookup.set(header.trim().toLowerCase(), index);
  });
  return (row: string[], name: string, fallbackIndex?: number): string => {
    const index = lookup.get(name.toLowerCase()) ?? fallbackIndex;
    if (index == null) return '';
    return (row[index] ?? '').trim();
  };
}

export function booleanFromCsv(value: string): boolean {
  return ['true', '1', 'yes', 'y'].includes(value.trim().toLowerCase());
}

export function booleanToCsv(value: boolean): string {
  return value ? 'true' : 'false';
}
