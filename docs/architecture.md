# Architecture

## Overview

The PWA and Electron apps share the same Vue frontend and the same pure TypeScript core.

```
┌──────────────────────────────┐
│ Vue 3 views + components     │
│ (PWA and Electron renderer)  │
└──────────────┬───────────────┘
               │ shared app store (src/app/store.ts)
┌──────────────▼───────────────┐
│ Pure core (src/core/*)       │
│ models, dates, CSV,          │
│ eligibility, grading,        │
│ checklists, import, config   │
└──────────────┬───────────────┘
               │ canonical FileMap (5 files)
┌──────────────▼───────────────┐
│ StorageAdapter               │
│ ├─ Electron IPC bridge       │
│ │  └─ atomic dataStore.cjs   │
│ └─ Browser adapter           │
│    ├─ File System Access     │
│    └─ localStorage working   │
│       copy (non-canonical)   │
└──────────────────────────────┘
```

No business rule lives in a view. Views call store actions; store actions call pure core
functions, serialize the next state, persist it, and only then replace the in-memory state.
This guarantees that a failed save never looks successful in the UI.

## Canonical data model

```ts
type MonthYear = string; // "MM/YY", 2000–2099

interface Belt {
  id: string;                 // stable identifier
  name: string;
  maxStripes: number;
  minMonthsToNextBelt: number; // advisory
}

interface AppConfig {
  belts: Belt[];               // order = promotion sequence
  upcomingEligibilityMonths: number; // default 3
}

interface Student {
  id: string;                 // s001, never derived from name
  name: string;
  currentBelt: string;        // cached from history
  currentStripes: number;     // cached from history
}

interface Grading {
  id: string;                 // g001, stable/correctable
  studentId: string;
  date: MonthYear;
  type: 'belt' | 'stripe';
  belt: string;               // belt being awarded / stripe belt
  stripesAwarded: number;     // belt = 0; stripe = 1..n
}

interface ChecklistItem {
  id: string;                 // c001
  belt: string;               // belt being awarded
  sortOrder: number;
  description: string;
  archived: boolean;
}

interface ChecklistProgress {
  studentId: string;
  checklistItemId: string;
  completed: boolean;
}
```

`AppState` is exactly `{ config, students, gradings, checklistItems, checklistProgress }`.

### File mapping

| File | Header |
|---|---|
| `students.csv` | `id,name,current_belt,current_stripes` |
| `gradings.csv` | `id,student_id,date,type,belt,stripes_awarded` |
| `checklists.csv` | `id,belt,sort_order,description,archived` |
| `checklist_progress.csv` | `student_id,checklist_item_id,completed` |
| `config.json` | Pretty-printed JSON |

The CSV parser is dependency-free and handles quotes, escaped quotes, commas, embedded
newlines, CRLF/LF and a UTF-8 BOM. Serialization quotes only when necessary.

`checklists.csv` adds an `archived` column to the suggested format. Missing values are treated
as `false`, so files produced before archiving existed still load.

## Dates

- All grading dates are normalized to `MM/YY`.
- Two-digit years map to **2000–2099**. Four-digit years outside that range are rejected rather
  than silently truncated.
- `monthIndex = year * 12 + (month - 1)` makes comparisons and arithmetic reliable across year
  boundaries.
- Eligibility uses `monthsBetween` (calendar months), never 30-day approximations.
- `nowMonthYear()` uses the local calendar month.

## Cached state and recomputation

`students.current_belt` and `current_stripes` are caches. `recomputeStudent` derives them from
`gradings`:

1. Valid, chronologically sorted events only (invalid dates are retained in the file for
   correction but excluded from calculation).
2. The latest belt event normally determines the current belt.
3. **Legacy gap rule:** if there are no belt events at all, the cached belt is preserved (the
   spreadsheet may omit the belt date). If the cached belt is ahead of the latest belt event and
   has any events of its own, it is also preserved rather than demoting the student.
4. Stripe events count only for the current belt and only on/after the latest belt event of that
   belt; a promotion resets the count.
5. Stripe events are summed as `stripesAwarded`, so one event may represent several stripes.

Validation warns when a cached stripe count exceeds the configured maximum (possible after a
configuration change) but never deletes historical stripes.

## Eligibility

`computeEligibility(state, student, now)` returns:

- current belt and next belt (or highest);
- belt start date and whether it is provisional;
- months at belt, configured minimum, earliest eligibility month, months remaining;
- status: `eligible | upcoming | not-eligible | unknown | highest`;
- warnings (provisional start, future date, missing dates, over-maximum stripes).

Belt start resolution:

1. Latest actual belt-award event for the student's current belt.
2. Otherwise, the earliest stripe date for that belt, marked **provisional** and explicitly
   reported. No belt event is inserted.
3. Otherwise unknown.

Status:

| Condition | Status |
|---|---|
| No next belt | `highest` |
| No start date or missing config | `unknown` |
| `monthsBetween(now, earliest) <= 0` | `eligible` |
| remaining <= `upcomingEligibilityMonths` | `upcoming` |
| otherwise | `not-eligible` |

Future belt dates produce negative months at belt and are flagged; the status is still computed
so the anomalous record is visible rather than crashing.

**Eligibility is never consulted by promotion mutations.** It is display-only.

## Grading actions

All actions clone the state, validate only data integrity, append events, recompute the affected
student, and return a `MutationResult`.

### Award stripe(s)

- `count` must be a positive integer.
- `currentStripes + count <= belt.maxStripes` (the only hard limit).
- Date must be valid and not before the current belt start.
- Appends one `stripe` event with `stripesAwarded = count`.
- Multiple simultaneous stripes are supported.

### Promote to next belt

- Next belt must exist in the configured sequence.
- Date must be valid and not before the current belt start.
- Appends one `belt` event (stripes 0); recomputation resets the cached stripe count to 0.
- Previous stripe and belt events are preserved.
- Time and checklists are **not** checked.

### Historical corrections

- `updateGradingDate` changes one event date and recomputes. If a stripe event moves before the
  belt award, it remains in history but no longer counts.
- `deleteGrading` removes an event and recomputes. If the latest belt event is removed, the
  previous belt is restored; if no belt/stripe events remain, the student returns to the starting
  belt.
- `recordBeltAwardDate` inserts/updates an actual belt event for the current belt when the legacy
  date was missing; a provisional start is replaced. It warns if stripes now fall before the new
  date instead of deleting them.

The normal promotion action does not support skipping entire belt levels. That is deliberate:
the requested scope says not to add arbitrary level skipping unless explicitly requested.

## Checklists

- Definitions belong to the **belt being awarded**, not the student's current belt.
- The student detail shows `nextBeltChecklist(student)`. For the highest belt it is empty.
- Progress is keyed by `(student_id, checklist_item_id)`, so one student's completion never affects
  another.
- Editing a description does not touch progress.
- Archive hides an item from active checklists but keeps its progress and definition.
- Delete is blocked if any progress row references the item; archive is offered instead.
- Reordering reassigns `sort_order` for active items only.
- Promotion does not clear progress for the belt that was awarded; historical completion data is
  retained in `checklist_progress.csv`.

Checklists are shown even when a student is not time-eligible, because early promotions are
permitted.

## Configuration changes

- Editing name, maximum stripes or minimum months validates values and writes immediately.
- Reducing `maxStripes` does not delete existing stripes; it warns and blocks future awards beyond
  the new maximum.
- Renaming a belt id rewrites references in `students`, `gradings` and `checklistItems` (progress
  references item ids, so it is unaffected).
- Removing a belt is blocked if any student, grading or checklist item references it, and at least
  one belt must remain.
- Reordering changes the next-belt target automatically. Saving may leave a student at a belt whose
  sequence position changed; that is a deliberate configuration action.
- The highest configured belt has no next belt.

## Persistence

### Electron (`electron/dataStore.cjs`)

Every `commitFiles`:

1. Sanitizes/validates the complete five-file set.
2. Copies the previous files into `backups/<timestamp>/` (all five, missing ones as empty strings).
3. Writes `.transaction.json` containing the complete next state.
4. Writes each file through a temporary file + rename.
5. Deletes the journal.

On load, a leftover journal is replayed (crash recovery). If a write throws, the pre-commit backup
is restored and the journal removed. Restores create a safety backup of the current state first.
Filesystem access stays in the main process; the renderer only sees the narrow preload API.

The data directory is `userData/data` by default and can be changed with a native dialog (saved in
`userData/settings.json`).

### PWA (`src/app/storage/browser.ts`)

- If the File System Access API is available, the coach can connect a folder. The directory handle
  is stored in IndexedDB **only to remember the folder**, never as canonical data.
- Saves read the previous files into `backups/<timestamp>/`, then write all five canonical files.
  Browser writes are not atomic across files; the timestamped backup is the recovery mechanism.
- If a folder is unavailable (unsupported browser, permission not granted, or no directory chosen),
  the app uses a localStorage working copy plus up to 10 working-copy snapshots. This mode is
  non-canonical and the UI always shows **"Working copy — not saved to CSV files"**.
- Export writes the files to a chosen folder (Chromium) or downloads them. Import accepts the
  normalized five-file set.
- Directory permission may require a user gesture after reload; the coach reconnects via Settings.

### Save status

`status` is `loading | saved | saving | unsaved | error`. A failed save keeps the previous in-memory
state and displays the error with a retry action.

## Legacy import

See [import-notes.md](import-notes.md). Key rules:

- Read the belt-group header from the spreadsheet-style layout.
- Group columns: first column = belt date, following columns = stripe dates.
- Merge rows by whitespace-collapsed, case-insensitive name; report merged identities.
- Never invent a date.
- Missing stripe columns are attributed to the next known stripe date and reported.
- Missing belt dates create no belt event; the earliest stripe date is a provisional start only.
- Future and invalid dates are reported; invalid dates are not imported.
- The original file is preserved in the backups folder before/with the import.
- The report counts students/events/skips and lists every ambiguity.

## Security (Electron)

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- A narrow `contextBridge` API exposes only load/save/dialog/backup/export operations.
- Main-process IPC handlers verify the sender and validate file names, content types and sizes.
- Navigation and new-window creation are blocked.
- A CSP meta tag restricts scripts/styles/connections to the app and the local dev server.
- No remote code, backend, authentication or cloud storage.

## Testing

- `tests/dates.test.ts` — parsing, century convention, month arithmetic.
- `tests/eligibility.test.ts` — every status, provisional, future, missing, config changes.
- `tests/grading.test.ts` — early promotion, incomplete checklist, zero/fewer stripes, simultaneous
  stripes, maximum enforcement, reset, history preservation, corrections/recompute.
- `tests/checklists.test.ts` — per-belt/per-student, persistence, edit, reorder, archive, delete
  safety, viewing before eligibility.
- `tests/csv.test.ts`, `tests/serialization.test.ts` — quoting, round-trips, cached-state repair.
- `tests/configActions.test.ts` — referential integrity, add/remove/reorder, warnings.
- `tests/legacyImport.test.ts` — real spreadsheet, merging, gaps, missing dates, no invented dates,
  invalid/unknown rows.
- `tests/electronDataStore.test.ts` — seeding, backups, restore, journal recovery, failed-write
  rollback, original preservation, export, transaction validation.
- `scripts/electron-smoke.cjs` — real Electron renderer + preload bridge + IPC save.

## Known architectural limitations

- Browser File System Access writes are sequential, not a single atomic transaction; backups exist
  but a crash between files can leave a partial set. Electron is fully journaled.
- Legacy identity is inferred from names. Duplicate names across belts are assumed to be one
  student and are reported for manual verification.
- The app does not delete students (avoids orphaning history). A future merge/delete workflow would
  need explicit history handling.
- Backups are never pruned automatically; they accumulate in the backups folder.