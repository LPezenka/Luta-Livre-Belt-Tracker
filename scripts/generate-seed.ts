/**
 * Generate the normalized seed data from the legacy spreadsheet CSV.
 *
 * Run with: npm run seed
 *
 * Outputs:
 *  - public/seed/*.csv, config.json, import-report.json (used by PWA/Electron first run)
 *  - data/normalized/* (human-readable copy for review)
 *  - data/backups/original-... (immutable backup of the legacy source)
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultConfig } from '../src/core/config';
import { importLegacyCsv } from '../src/core/legacyImport';
import { serializeState } from '../src/core/serialization';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const legacyPath = path.join(root, 'data', 'Luta Livre Belts - cropped.csv');

async function main() {
  const text = await fs.readFile(legacyPath, 'utf8');
  const sourceName = path.basename(legacyPath);
  const { state, report } = importLegacyCsv(text, defaultConfig(), { sourceName });
  const files = serializeState(state);

  const seedDir = path.join(root, 'public', 'seed');
  const normalizedDir = path.join(root, 'data', 'normalized');
  const backupDir = path.join(root, 'data', 'backups');
  await Promise.all([
    fs.mkdir(seedDir, { recursive: true }),
    fs.mkdir(normalizedDir, { recursive: true }),
    fs.mkdir(backupDir, { recursive: true }),
  ]);

  const reportText = `${JSON.stringify(report, null, 2)}\n`;
  for (const [name, content] of Object.entries(files)) {
    await fs.writeFile(path.join(seedDir, name), content, 'utf8');
    await fs.writeFile(path.join(normalizedDir, name), content, 'utf8');
  }
  await fs.writeFile(path.join(seedDir, 'import-report.json'), reportText, 'utf8');
  await fs.writeFile(path.join(normalizedDir, 'import-report.json'), reportText, 'utf8');

  const backupPath = path.join(backupDir, `original-${sourceName}`);
  try {
    await fs.copyFile(legacyPath, backupPath, fs.constants.COPYFILE_EXCL);
    console.log(`Original legacy file backed up to ${path.relative(root, backupPath)}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      console.log(`Original legacy backup already exists at ${path.relative(root, backupPath)}`);
    } else {
      throw error;
    }
  }

  const errors = report.issues.filter((issue) => issue.severity === 'error');
  const warnings = report.issues.filter((issue) => issue.severity === 'warning');
  console.log(`Imported ${report.studentCount} students and ${report.gradingEventCount} grading events.`);
  console.log(`Merged names: ${report.mergedNames.map((entry) => entry.name).join(', ') || 'none'}`);
  console.log(`Issues: ${errors.length} error(s), ${warnings.length} warning(s).`);
  for (const issue of report.issues) {
    console.log(`  [${issue.severity}] ${issue.code}: ${issue.message}`);
  }
  if (errors.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
