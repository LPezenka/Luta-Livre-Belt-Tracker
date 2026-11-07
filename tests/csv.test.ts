import { describe, expect, it } from 'vitest';
import { parseCsv, serializeCsv } from '../src/core/csv';

describe('CSV parser', () => {
  it('parses plain rows and trims nothing implicitly', () => {
    expect(parseCsv('a,b\nc,d\n')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('handles CRLF and a UTF-8 BOM', () => {
    expect(parseCsv('\uFEFFa,b\r\nc,d\r\n')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('handles quoted fields, commas, newlines and escaped quotes', () => {
    expect(parseCsv('id,name\ns1,"Doe, Jane"\ns2,"A ""quote"""\n')).toEqual([
      ['id', 'name'],
      ['s1', 'Doe, Jane'],
      ['s2', 'A "quote"'],
    ]);
    expect(parseCsv('a,"line\nbreak"\n')).toEqual([['a', 'line\nbreak']]);
  });

  it('handles empty fields and trailing empty values', () => {
    expect(parseCsv('a,,c,\n')).toEqual([['a', '', 'c', '']]);
    expect(parseCsv('')).toEqual([]);
  });

  it('round-trips through serialization', () => {
    const rows = [
      ['id', 'name', 'note'],
      ['s1', 'Doe, Jane', 'A "quote"'],
      ['s2', 'Line\nBreak', ' trailing '],
    ];
    expect(parseCsv(serializeCsv(rows))).toEqual(rows);
  });
});
