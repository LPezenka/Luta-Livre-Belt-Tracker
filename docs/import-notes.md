# Legacy import notes

Source: [`data/Luta Livre Belts - cropped.csv`](../data/Luta%20Livre%20Belts%20-%20cropped.csv)
(original backed up to `data/backups/original-Luta Livre Belts - cropped.csv`).

Generated normalized data: `public/seed/` (bundled) and `data/normalized/` (review copy).
Machine-readable report: `public/seed/import-report.json` and `data/normalized/import-report.json`.

## Recognized layout

The spreadsheet uses belt column groups:

| Belt | Start column | Width | Columns used |
|---|---:|---:|---|
| White | 2 | 3 | belt date, stripe 1, stripe 2 |
| Yellow | 5 | 3 | belt date, stripe 1, stripe 2 |
| Orange | 8 | 3 | belt date, stripe 1, stripe 2 |
| Blue | 11 | 4 | belt date, stripe 1–3 |
| Purple | 15 | 4 | belt date, stripe 1–3 |
| Brown | 19 | 4 | belt date, stripe 1–3 |
| Black | 23 | 4 | belt date, stripe 1–3 |

Column 0 of each group is the belt-award date; later columns are stripe dates. The importer
detects the group header by matching the configured belt names, so the column positions are not
hard-coded.

## Result

- **15 students** created (one stable `sNNN` record per person).
- **32 grading events** created.
- **0 rows skipped.**
- **6 names merged** across multiple belt rows.
- **13 warnings**, all preserved in the report and shown in the app's import preview.

## Ambiguities requiring manual review

### 1. Names appearing on multiple belt rows (assumed same person)

| Name | Rows | Belts |
|---|---|---:|
| Andreas M | 16, 25 | Orange → Blue |
| Feliks R | 18, 27 | Orange → Blue |
| Damir L | 21, 32 | Blue → Purple |
| Johannes G | 22, 29, 34 | Blue → Purple → Brown |
| Tina Z | 23, 30 | Blue → Purple |
| Anton B | 24, 31 | Blue → Purple |

The rows are consistent with one person progressing through belts, and they were merged. If any
pair is actually two different people with the same name, split them manually in the CSV files
using new stable student ids. The app reports the merge rather than hiding it.

### 2. Missing belt-award dates (provisional starts)

**David B (Yellow, row 9)** and **Anton B (Blue, row 24)** have stripe dates but no date in the
belt column.

Resolution: no belt event was invented. The earliest recorded stripe date is used only as a
provisional start by the eligibility engine:

- David B: provisional `06/26` (yellow stripe 1), no yellow belt event.
- Anton B: the blue provisional start is superseded by the actual Purple belt event `11/25` for
  his current belt; the blue stripe history remains.

Use **Record belt date** / **Correct belt date** on the student page to replace a provisional start
with the real belt-award date.

### 3. Stripe gaps (unknown intermediate dates)

The file contains a later stripe date but no date for an earlier stripe:

| Student | Belt | Known stripe | Assumption |
|---|---|---|---|
| Andreas M | Blue | stripe 2 on `06/26` | 2 stripes attributed to `06/26` |
| Feliks R | Orange | stripe 2 on `07/26` | 2 stripes attributed to `07/26` |
| Johannes G | Purple | stripe 2 on `09/25` | 2 stripes attributed to `09/25` |
| Anton B | Blue | stripe 2 on `10/25` | 2 stripes attributed to `10/25` |

No date was invented. The known date is used for the implied stripes because the student had at
least that many stripes by that date; this is the only interpretation that does not fabricate a
date. Verify whether the stripes were actually awarded together or whether an earlier date is
missing.

### 4. Future date

**Amira N (Orange)** has a belt date of `07/27`, which is in the future relative to the import
month (`11/26`). It was imported as-is and flagged. The app shows negative months at belt and
marks the date as a future anomaly; correct it when the real date is known.

### 5. No dates

None of the 15 people has a row with no belt date and no stripe dates. If a future file contains
such a row, the student is still created; tenure and eligibility are shown as unknown.

## What the importer never does

- It never creates a date that is not present in the source.
- It never inserts a provisional belt date as an actual belt event.
- It never drops a stripe event because an earlier stripe date is missing.
- It never silently discards an invalid date; invalid values are reported and excluded, while the
  original file is preserved.

## Review checklist

1. Confirm the six merged names are single people (or split them).
2. Correct the two missing belt dates if known (David B yellow, Anton B blue).
3. Verify the four stripe gaps / simultaneous-award assumptions.
4. Correct Amira N's future orange belt date.
5. Review the illustrative belt minimum times and maximum stripe counts in **Settings**; they were
   not supplied as official VCA requirements.
6. Add actual VCA checklist criteria in **Checklists**; the seed intentionally contains none.