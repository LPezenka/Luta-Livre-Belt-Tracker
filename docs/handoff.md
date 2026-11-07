# Handoff — Luta Belt Tracker

Last updated: 2026-11-07 (initial implementation)

## Status

**Functional scope complete (M1–M9 implemented).** The PWA and Electron apps share the same Vue
frontend and pure TypeScript core. The normalized seed was generated from the supplied legacy CSV.
Automated tests, production build, Electron packaging (`--dir`) and an Electron renderer/IPC smoke
test pass.

Remaining work is acceptance testing on real Windows/Linux installations and decisions about
official VCA criteria/times. See **Next actionable task**.

## Last completed work

- Project scaffold: Vue 3 + TypeScript + Vite + PWA + Electron + Vitest.
- Shared data model and CSV/JSON serialization for the five canonical files.
- Calendar-month date engine (`MM/YY`, 2000–2099 convention).
- Eligibility engine with eligible/upcoming/not-eligible/unknown/highest statuses, provisional
  starts, future-date handling and configuration changes.
- Grading actions: early promotion, promotion without stripes, promotion with incomplete checklist,
  single/multiple stripe awards, maximum enforcement, stripe reset, history preservation.
- Historical date editing/deletion with cached-state recomputation.
- Checklist definitions per belt, per-student progress, add/edit/reorder/archive/delete safety.
- Configuration UI for belt sequence, names, IDs, max stripes, minimum months and upcoming window,
  with referential-integrity handling.
- Dashboard: summary cards, belt distribution, recent activity, search/filter/sortable student table,
  provisional and eligibility indicators.
- Student detail: eligibility breakdown, next-belt checklist, grading history, promotion dialogs.
- Legacy import: column-group parsing, name merging, gap attribution, provisional starts, ambiguity
  report, original-file backup.
- Electron main/preload/data store: secure bridge, native dialogs, immediate saves, timestamped
  backups, journal crash recovery, rollback on failed writes.
- PWA: installable manifest, offline precache, File System Access folder mode with backups, and a
  clearly marked localStorage working-copy mode with export/import.
- Documentation: README, architecture, import notes, this handoff.

## Important files and modules

### Core (shared)

| Path | Responsibility |
|---|---|
| `src/core/models.ts` | Types, file names, eligibility statuses, result types |
| `src/core/dates.ts` | `MM/YY` parsing/formatting, calendar-month arithmetic, century convention |
| `src/core/csv.ts` | RFC4180-style parser/serializer, quoted fields, CRLF, BOM |
| `src/core/config.ts` | Default belts, config validation/JSON serialization, belt navigation |
| `src/core/configActions.ts` | Belt edit/rename/add/remove/reorder, upcoming window |
| `src/core/eligibility.ts` | Belt start resolution, statuses, summaries, distribution |
| `src/core/grading.ts` | Student creation/rename, stripe/belt mutations, recomputation, history |
| `src/core/checklists.ts` | Per-belt definitions, per-student progress, archive/delete/reorder |
| `src/core/serialization.ts` | Canonical file parse/serialize, cached-state repair |
| `src/core/state.ts` | Empty state, clone, validation, sorting |
| `src/core/legacyImport.ts` | Spreadsheet-style import and ambiguity report |
| `src/core/ids.ts` | Stable `sNNN`/`gNNN`/`cNNN` identifiers, name normalization |

### App (shared frontend)

| Path | Responsibility |
|---|---|
| `src/app/store.ts` | Reactive state, save status, mutations, imports/exports/backups |
| `src/app/storage/types.ts` | Storage adapter/capability contracts |
| `src/app/storage/electron.ts` | Renderer adapter over the preload bridge |
| `src/app/storage/browser.ts` | PWA File System Access + localStorage working copy |
| `src/app/storage/idb.ts` | Stores only the directory handle (not data) |
| `src/app/files.ts` | Native/browser file pickers, downloads |
| `src/app/beltColors.ts` | Belt color palette with deterministic custom-belt fallback |
| `src/views/DashboardView.vue` | Overview, filters, sorting, add student |
| `src/views/StudentDetailView.vue` | Eligibility, checklist, history corrections, grading UI |
| `src/views/ChecklistsView.vue` | Checklist editor |
| `src/views/SettingsView.vue` | Belt config, storage, imports, backups, data notes |
| `src/components/*` | Badges, stripe meter, stat cards, modals, checklist panel, promotion dialog |

### Electron

| Path | Responsibility |
|---|---|
| `electron/main.cjs` | Window, IPC handlers, native dialogs, data folder settings |
| `electron/preload.cjs` | Narrow contextBridge API (`window.vca`) |
| `electron/dataStore.cjs` | Atomic writes, backups, journal recovery, restore, export, seed |
| `scripts/electron-smoke.cjs` | Real Electron renderer + preload + IPC save smoke test |

### Data and scripts

| Path | Notes |
|---|---|
| `data/Luta Livre Belts - cropped.csv` | Supplied source; do not edit |
| `data/backups/original-...` | Immutable backup of the supplied source |
| `public/seed/*` | Normalized seed bundled with PWA/Electron |
| `data/normalized/*` | Review copy of the normalized files + import report |
| `scripts/generate-seed.ts` | Regenerates `public/seed` and `data/normalized` (`npm run seed`) |
| `tests/*` | 9 Vitest files, 97 tests |

## Implementation decisions

1. **No backend/database.** CSV/JSON are canonical. The PWA's localStorage copy is explicitly
   temporary/non-canonical. IndexedDB stores only the folder handle.
2. **Month/year only.** `MM/YY` is stored; two-digit years mean 2000–2099; four-digit years outside
   that range are rejected. Eligibility uses calendar-month indices, not 30-day durations.
3. **Students are cached from history.** `current_belt`/`current_stripes` are recomputed after every
   grading/correction. Legacy records with no belt event keep their cached belt; a provisional start
   is derived from the earliest stripe date and is never inserted as a belt event.
4. **Advisory rules.** Promotion mutations never consult elapsed time or checklist completion. The
   only hard limits are: valid date, stripe maximum, date not before the current belt start, and next
   belt existing.
5. **No level skipping.** The promotion action always advances one configured belt. Directly setting
   a belt bypasses history and is not exposed in the UI.
6. **Checklists belong to the awarded belt.** Progress is per student/item. Archive preserves
   progress; delete is blocked when progress rows reference the item.
7. **Referential integrity on belt edits.** Renaming an id rewrites students/gradings/checklist
   items. Removing a referenced belt is blocked. Reordering changes next-belt targets.
8. **Seed checklists are empty.** No official VCA criteria were provided; the app does not invent
   them. Default belt times/stripe maximums are illustrative and editable.
9. **Legacy import merges by normalized name.** This is reported as an assumption. Missing stripe
   dates are attributed to the next known stripe date; no date is invented. The original file is
   preserved.
10. **Save-before-commit.** The UI only updates after persistence succeeds. A failure keeps the prior
    state and shows an error with retry.
11. **Electron security.** Context isolation, sandbox, no Node in the renderer, narrow preload API,
    sender checks, navigation/window blocking, CSP.
12. **Electron transactional recovery.** Backup → journal → atomic file writes → journal removal.
    A leftover journal is replayed on load; a thrown write restores the backup.
13. **PWA limitations are explicit.** No folder handle/permission → working-copy banner, export
    prompt, and the save chip says "Working copy", never "Saved to CSV". File System Access writes
    are sequential; backups are the recovery mechanism.
14. **Stable IDs.** `sNNN`, `gNNN`, `cNNN`; IDs are never derived from names and are not reused.

## Known issues / limitations

- **Identity merge needs verification.** Six names appear on multiple belt rows and were merged.
  See `docs/import-notes.md`.
- **Legacy ambiguities need review:** two missing belt dates (David B yellow, Anton B blue), four
  stripe gaps, and Amira N's future `07/27` orange date.
- **PWA working-copy mode is not canonical.** The coach must connect a folder or export. Directory
  permission can require a new user gesture after reload.
- **PWA multi-file writes are not atomic.** Timestamped backups exist, but a crash between file
  writes can leave a partial set. Electron is journaled.
- **Future grading dates are imported as-is** and flagged; eligibility displays negative months.
- **No student deletion/merge UI.** Deliberately avoided to protect history; splitting a merged name
  currently requires CSV editing.
- **Backups are never pruned.** They accumulate under the data folder's `backups/`.
- **Reducing `maxStripes` does not delete existing stripes.** A warning is shown; future awards are
  limited.
- **Linux packaging was not executed here.** Config exists (`electron:dist:linux`), but build on
  Linux (or a suitable container) for the AppImage/deb.
- **Electron binary download** may be slow on first launch in a fresh environment.

## Tests executed

Commands and results (2026-11-07):

| Command | Result |
|---|---|
| `npx vitest run` | **9 files, 98 tests passed** |
| `npx vue-tsc --noEmit` | **Pass**, no type errors |
| `npm run build` | **Pass**; PWA precached 21 entries (app shell, icons, seed files) |
| `npx electron scripts/electron-smoke.cjs` | **Pass**: heading `Grading overview`, 15 table rows, bridge `true`, `vca.save` returned ok with timestamped backup, saved content re-read and verified, no console errors |
| `npx electron-builder --dir` | **Pass**: `release/win-unpacked` created; `resources/seed` contains all seed files; no signing certificate configured |
| Browser manual E2E (dev + production preview) | Dashboard renders; search/filter table; add student; promotion (early, with warnings); 3-stripe simultaneous award; checklist add/edit/reorder/archive/restore; per-student checklist completion; config min-months change; belt add/remove; history date edit; grading deletion; legacy import preview + replace; normalized preview; reload persistence; PWA manifest/service worker present; precache includes seed |

Not yet executed:

- Installing the packaged Windows app and testing native dialogs/backups on a real user account.
- Building/installing the Linux AppImage/deb.
- Airplane-mode PWA install test with the network fully disabled (precache contents were verified).
- Multi-week/large-roster performance testing.

## Next actionable task

1. **Build and install on Windows and Linux** (`npm run electron:dist:win`, `npm run electron:dist:linux`)
   and verify: first-run seeding, native folder/file dialogs, automatic save, backup folder,
   restore, and the secure preload bridge in the packaged app.
2. **Acceptance review of imported data** with the coach using `docs/import-notes.md`.
3. **Collect official VCA requirements/checklists** and enter them via Settings/Checklists. The
   current default times and empty checklists are not official.
4. Optional follow-ups: backup pruning, student merge/split tooling, CSV column documentation for
   coaches, PWA install prompt UI, i18n.

## Blockers / unresolved questions

- **Official VCA grading requirements** (minimum months, stripe maximums, checklist criteria) were
  not supplied. Defaults are illustrative; do not present them as official.
- **Name collisions:** confirm the six merged names are single people.
- **Stripe gap interpretation:** confirm whether the four implied simultaneous stripe awards are
  correct or whether earlier dates are missing.
- **Amira N's future date** needs a real date or explicit confirmation that it is scheduled.

## How to continue

```bash
npm install
npm run seed          # only if regenerating normalized data from the legacy CSV
npm test
npm run build
npm run dev           # PWA dev server
npm run electron:dev  # Electron + Vite
npx electron scripts/electron-smoke.cjs   # after build
```

Read `docs/architecture.md` first for the data model and persistence decisions, then
`docs/import-notes.md` before touching the seed or imported history. Update this handoff in the same
commit as any future change.