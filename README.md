# Luta Belt Tracker — Vienna Combat Academy

Local-first belt and stripe grading tracker for Luta Livre at Vienna Combat Academy (VCA).

The app tracks progression, highlights students who have reached advisory minimum-time
requirements, and supports the coach with belt-specific checklists. It is a decision-support
tool, **not** an automated grading system: the coach has complete authority and no promotion
is ever blocked by time, stripe count or checklist completion.

## Stack

- Vue 3 + TypeScript + Vite
- Installable PWA with offline caching (Workbox)
- Electron desktop app (Windows/Linux) with a secure preload bridge
- CSV/JSON files as the only canonical storage — no backend, database, accounts or cloud
- Vitest coverage for grading, eligibility, checklists, CSV, legacy import and backup/recovery

## Quick start

```bash
npm install
npm run seed      # regenerate normalized seed data from the legacy spreadsheet
npm run dev       # PWA in the browser at http://localhost:5173
npm test          # 98 automated tests
npm run build     # type-check + production PWA build in dist/
```

### Electron

```bash
npm run electron:dev     # Vite + Electron with the preload bridge
npm run electron:start   # build, then run the desktop app
npm run electron:dist    # package for the current platform
npm run electron:dist:win
npm run electron:dist:linux
```

On first run, Electron seeds its data folder from `public/seed` into the per-user data directory.
The folder can be changed in **Settings → Data, storage & backups**.

### PWA

The production build is installable and works offline after the first load. The service worker
precaches the app shell, icons and the normalized seed files. Changes made in browser working-copy
mode are kept in the browser and are clearly marked as **not yet written to CSV files**. Connect a
data folder (File System Access API) for automatic CSV writes, or export/import the CSV files.

## Data files

The canonical file set is:

| File | Purpose |
|---|---|
| `students.csv` | Exactly one row per student: `id,name,current_belt,current_stripes` |
| `gradings.csv` | Append-oriented history: `id,student_id,date,type,belt,stripes_awarded` |
| `checklists.csv` | Belt-specific criteria: `id,belt,sort_order,description,archived` |
| `checklist_progress.csv` | Per-student completion: `student_id,checklist_item_id,completed` |
| `config.json` | Belt sequence, stripe maximums, minimum months and upcoming window |

`students.csv` is a cached view of `gradings.csv`; the app recalculates it after every grading
change. Grading events are never rewritten or discarded by a promotion.

Dates use **month/year precision only** (`MM/YY`). Two-digit years are interpreted as **2000–2099**.
Eligibility is calculated with calendar months, never fixed 30-day durations.

## Legacy import

The supplied spreadsheet is at `data/Luta Livre Belts - cropped.csv`. The import:

- finds the belt group header and each belt's date columns (column 0 = belt-award date, later
  columns = stripe dates);
- merges rows for the same normalized name (people appear on multiple belt rows);
- creates one `students.csv` row per person and normalizes all dates into `gradings.csv`;
- never invents a date: a missing stripe date is reported, and implied stripes are attributed to
  the only known date with a warning;
- uses the earliest stripe date only as a **provisional** belt start when the belt-award date is
  missing (no belt event is inserted);
- preserves the original file under `data/backups/` / the app backups folder;
- produces a detailed import report, shown in Settings and downloadable as JSON.

Importing is also available in the app from **Settings → Import**. Checklist definitions are
intentionally seeded empty: no official VCA criteria were supplied, so the app does not invent them.

The generated seed lives in `public/seed/` (bundled with the PWA/Electron app) and a readable copy
in `data/normalized/`.

## Safety and backups

- Every save is preceded by a timestamped backup in `backups/`.
- Electron writes via temporary files + rename and keeps a transaction journal. If a save is
  interrupted, the journal is replayed on the next load; if a write fails, the previous backup is
  restored immediately.
- Failures are reported explicitly. The UI never claims a change was saved when persistence failed.
- The PWA working-copy mode uses browser storage only as a temporary working copy; CSV export is the
  canonical escape hatch. File System Access folder mode writes and backs up directly.

## Project layout

```
src/core/            shared data models, dates, CSV, eligibility, grading, checklists, import
src/app/             store, storage adapters (Electron / PWA), file pickers, belt colours
src/components/      shared Vue components
src/views/           Dashboard, student detail, checklist management, settings
src/styles/          VCA-inspired design system
electron/            main process, preload bridge, atomic data store
scripts/             seed generation and Electron smoke test
tests/               Vitest suites
docs/                architecture, import notes and canonical handoff
```

## Documentation

- [docs/handoff.md](docs/handoff.md) — cross-agent handoff, current status and next tasks
- [docs/architecture.md](docs/architecture.md) — data model, decisions, persistence and security
- [docs/import-notes.md](docs/import-notes.md) — legacy import ambiguities and manual-review items

## Explicitly out of scope

Automatic promotions, attendance, payments/membership, student self-service, multi-user
authentication, cloud sync, reminders, mandatory prerequisites and automatic skill evaluation.