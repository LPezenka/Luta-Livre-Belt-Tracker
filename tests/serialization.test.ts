import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/core/config';
import { parseStateFiles, serializeState } from '../src/core/serialization';
import { makeChecklistItem, makeGrading, makeProgress, makeState, makeStudent } from './helpers';

function consistentState() {
  return makeState({
    students: [
      makeStudent({ id: 's001', name: 'Doe, Jane', currentBelt: 'orange', currentStripes: 1 }),
      makeStudent({ id: 's002', name: 'A "Quote"', currentBelt: 'white', currentStripes: 0 }),
    ],
    gradings: [
      makeGrading({ id: 'g001', studentId: 's001', date: '01/25', type: 'belt', belt: 'orange' }),
      makeGrading({
        id: 'g002',
        studentId: 's001',
        date: '06/26',
        type: 'stripe',
        belt: 'orange',
        stripesAwarded: 1,
      }),
    ],
    checklistItems: [
      makeChecklistItem({ id: 'c002', belt: 'blue', sortOrder: 1, description: 'First' }),
      makeChecklistItem({ id: 'c001', belt: 'blue', sortOrder: 2, description: 'Second' }),
      makeChecklistItem({ id: 'c003', belt: 'purple', sortOrder: 1, description: 'Archived', archived: true }),
    ],
    checklistProgress: [
      makeProgress({ studentId: 's001', checklistItemId: 'c001', completed: true }),
    ],
  });
}

describe('normalized CSV serialization', () => {
  it('round-trips the complete state', () => {
    const state = consistentState();
    const files = serializeState(state);
    expect(Object.keys(files).sort()).toEqual(
      ['checklist_progress.csv', 'checklists.csv', 'config.json', 'gradings.csv', 'students.csv'].sort(),
    );
    const parsed = parseStateFiles(files);
    expect(parsed.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
    expect(parsed.state.students).toEqual(state.students);
    expect(parsed.state.gradings).toEqual(state.gradings);
    expect(parsed.state.checklistItems).toEqual(state.checklistItems);
    expect(parsed.state.checklistProgress).toEqual(state.checklistProgress);
    expect(parsed.state.config).toEqual(state.config);
  });

  it('writes exactly one students.csv row per student', () => {
    const files = serializeState(consistentState());
    const lines = files['students.csv'].trim().split('\n');
    expect(lines).toHaveLength(3); // header + two students
  });

  it('quotes names containing commas, quotes and whitespace safely', () => {
    const files = serializeState(consistentState());
    expect(files['students.csv']).toContain('"Doe, Jane"');
    expect(files['students.csv']).toContain('"A ""Quote"""');
    const parsed = parseStateFiles(files);
    expect(parsed.state.students.map((student) => student.name)).toEqual([
      'Doe, Jane',
      'A "Quote"',
    ]);
  });

  it('preserves archived checklist items and completion data', () => {
    const parsed = parseStateFiles(serializeState(consistentState()));
    expect(parsed.state.checklistItems.find((item) => item.id === 'c003')?.archived).toBe(true);
    expect(parsed.state.checklistProgress).toHaveLength(1);
  });

  it('repairs cached current state from history and reports it', () => {
    const state = consistentState();
    state.students[0].currentStripes = 0;
    const parsed = parseStateFiles(serializeState(state));
    expect(parsed.state.students[0].currentStripes).toBe(1);
    expect(parsed.issues.some((issue) => issue.message.includes('corrected from grading history'))).toBe(
      true,
    );
  });

  it('falls back to default configuration when config.json is missing', () => {
    const files = serializeState(consistentState());
    delete files['config.json'];
    const parsed = parseStateFiles(files);
    expect(parsed.state.config).toEqual(defaultConfig());
    expect(parsed.issues.some((issue) => issue.message.includes('default belts'))).toBe(true);
  });

  it('reports invalid dates rather than silently dropping them', () => {
    const files = serializeState(consistentState());
    files['gradings.csv'] = files['gradings.csv'].replace('06/26', '13/26');
    const parsed = parseStateFiles(files);
    expect(parsed.issues.some((issue) => issue.message.includes('invalid date'))).toBe(true);
  });

  it('handles an empty data set', () => {
    const parsed = parseStateFiles(serializeState(makeState()));
    expect(parsed.state.students).toEqual([]);
    expect(parsed.state.gradings).toEqual([]);
    expect(parsed.state.checklistItems).toEqual([]);
    expect(parsed.state.checklistProgress).toEqual([]);
    expect(parsed.state.config.belts).toHaveLength(7);
  });
});
