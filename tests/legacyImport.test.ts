import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/core/config';
import { importLegacyCsv } from '../src/core/legacyImport';

const legacyPath = path.resolve('data', 'Luta Livre Belts - cropped.csv');
const legacyText = fs.readFileSync(legacyPath, 'utf8');

describe('legacy CSV import', () => {
  it('imports one record per person and preserves grading history', () => {
    const { state, report } = importLegacyCsv(legacyText, defaultConfig(), {
      sourceName: 'Luta Livre Belts - cropped.csv',
      now: new Date(2026, 10, 7),
    });
    expect(state.students).toHaveLength(15);
    expect(report.studentCount).toBe(15);
    expect(report.gradingEventCount).toBe(state.gradings.length);
    expect(report.gradingEventCount).toBe(32);
    expect(new Set(state.students.map((student) => student.id)).size).toBe(15);
    expect(new Set(state.students.map((student) => student.name)).size).toBe(15);
    expect(report.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
  });

  it('merges repeated names across belt rows', () => {
    const { state, report } = importLegacyCsv(legacyText, defaultConfig(), {
      now: new Date(2026, 10, 7),
    });
    expect(report.mergedNames.map((entry) => entry.name).sort()).toEqual(
      ['Andreas M', 'Anton B', 'Damir L', 'Feliks R', 'Johannes G', 'Tina Z'].sort(),
    );
    const johannes = state.students.find((student) => student.name === 'Johannes G');
    expect(johannes?.currentBelt).toBe('brown');
    expect(johannes?.currentStripes).toBe(1);
    expect(
      state.gradings.filter((grading) => grading.studentId === johannes?.id).length,
    ).toBeGreaterThan(3);
  });

  it('converts belt-group columns into normalized belt and stripe events', () => {
    const { state } = importLegacyCsv(legacyText, defaultConfig(), {
      now: new Date(2026, 10, 7),
    });
    const mathias = state.students.find((student) => student.name === 'Mathias K');
    const events = state.gradings.filter((grading) => grading.studentId === mathias?.id);
    expect(events).toEqual([
      expect.objectContaining({ date: '01/25', type: 'belt', belt: 'orange', stripesAwarded: 0 }),
      expect.objectContaining({ date: '11/25', type: 'stripe', belt: 'orange', stripesAwarded: 1 }),
    ]);
  });

  it('does not invent a belt-award event when only a stripe date exists', () => {
    const { state, report } = importLegacyCsv(legacyText, defaultConfig(), {
      now: new Date(2026, 10, 7),
    });
    const david = state.students.find((student) => student.name === 'David B');
    const events = state.gradings.filter((grading) => grading.studentId === david?.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(
      expect.objectContaining({ date: '06/26', type: 'stripe', belt: 'yellow' }),
    );
    expect(report.issues.some((issue) => issue.code === 'missing-belt-date')).toBe(true);
  });

  it('attributes implied stripes to the known date and reports the gap', () => {
    const { state, report } = importLegacyCsv(legacyText, defaultConfig(), {
      now: new Date(2026, 10, 7),
    });
    const feliks = state.students.find((student) => student.name === 'Feliks R');
    const orangeStripe = state.gradings.find(
      (grading) =>
        grading.studentId === feliks?.id && grading.type === 'stripe' && grading.belt === 'orange',
    );
    expect(orangeStripe).toEqual(
      expect.objectContaining({ date: '07/26', stripesAwarded: 2 }),
    );
    expect(report.issues.some((issue) => issue.code === 'stripe-gap')).toBe(true);
  });

  it('never invents a date that is not in the source file', () => {
    const sourceDates = new Set(
      (legacyText.match(/\b\d{1,2}\/\d{2}\b/g) ?? []).map((value) => {
        const [month, year] = value.split('/');
        return `${month.padStart(2, '0')}/${year}`;
      }),
    );
    const { state } = importLegacyCsv(legacyText, defaultConfig(), {
      now: new Date(2026, 10, 7),
    });
    for (const grading of state.gradings) {
      expect(sourceDates.has(grading.date)).toBe(true);
    }
  });

  it('reports future dates and invalid/unknown data without losing the import', () => {
    const { state, report } = importLegacyCsv(legacyText, defaultConfig(), {
      now: new Date(2026, 10, 7),
    });
    expect(report.issues.some((issue) => issue.code === 'future-belt-date')).toBe(true);
    const amira = state.students.find((student) => student.name === 'Amira N');
    expect(amira?.currentBelt).toBe('orange');
    expect(
      state.gradings.find((grading) => grading.studentId === amira?.id)?.date,
    ).toBe('07/27');
  });

  it('skips unknown belts and invalid dates while reporting them', () => {
    const synthetic = [
      ',,White ,,,Yellow,,,',
      ',,0,1,2,0,1,2,',
      'Name,Gurt,,,,,,',
      'Valid,yellow,,,,01/26,',
      'Unknown,mystery,,,,,',
      'BadDate,yellow,,,,,13/26',
    ].join('\n');
    const { state, report } = importLegacyCsv(synthetic, defaultConfig(), {
      now: new Date(2026, 10, 7),
    });
    expect(state.students.map((student) => student.name)).toEqual(['Valid', 'BadDate']);
    expect(report.issues.some((issue) => issue.code === 'unknown-belt')).toBe(true);
    expect(report.issues.some((issue) => issue.code === 'invalid-stripe-date')).toBe(true);
    expect(report.skippedRows).toBe(1);
    const badDateEvents = state.gradings.filter(
      (grading) => grading.studentId === state.students[1].id,
    );
    expect(badDateEvents).toEqual([]);
  });

  it('reports when the file cannot be recognized', () => {
    const { state, report } = importLegacyCsv('not,a,spreadsheet\n1,2,3', defaultConfig());
    expect(state.students).toEqual([]);
    expect(report.issues.some((issue) => issue.severity === 'error')).toBe(true);
  });
});
