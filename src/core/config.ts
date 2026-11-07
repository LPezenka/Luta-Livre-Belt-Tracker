import type { AppConfig, Belt } from './models';
import { WHITE_BELT_ID } from './models';

/**
 * Default belt definitions. These values are illustrative and can be changed
 * in the Settings screen. They are NOT official VCA grading requirements.
 */
export function defaultConfig(): AppConfig {
  return {
    belts: [
      { id: 'white', name: 'White', maxStripes: 4, minMonthsToNextBelt: 12 },
      { id: 'yellow', name: 'Yellow', maxStripes: 4, minMonthsToNextBelt: 18 },
      { id: 'orange', name: 'Orange', maxStripes: 4, minMonthsToNextBelt: 18 },
      { id: 'blue', name: 'Blue', maxStripes: 4, minMonthsToNextBelt: 18 },
      { id: 'purple', name: 'Purple', maxStripes: 4, minMonthsToNextBelt: 18 },
      { id: 'brown', name: 'Brown', maxStripes: 4, minMonthsToNextBelt: 18 },
      { id: 'black', name: 'Black', maxStripes: 4, minMonthsToNextBelt: 0 },
    ],
    upcomingEligibilityMonths: 3,
  };
}

export function beltIndex(config: AppConfig, beltId: string): number {
  return config.belts.findIndex((belt) => belt.id === beltId);
}

export function findBelt(config: AppConfig, beltId: string | null | undefined): Belt | null {
  if (!beltId) return null;
  return config.belts.find((belt) => belt.id === beltId) ?? null;
}

export function nextBelt(config: AppConfig, beltId: string): Belt | null {
  const index = beltIndex(config, beltId);
  if (index < 0 || index >= config.belts.length - 1) return null;
  return config.belts[index + 1];
}

export function previousBelt(config: AppConfig, beltId: string): Belt | null {
  const index = beltIndex(config, beltId);
  if (index <= 0) return null;
  return config.belts[index - 1];
}

export function startingBeltId(config: AppConfig): string {
  return findBelt(config, WHITE_BELT_ID)?.id ?? config.belts[0]?.id ?? WHITE_BELT_ID;
}

export function beltName(config: AppConfig, beltId: string | null | undefined): string {
  return findBelt(config, beltId)?.name ?? beltId ?? '—';
}

export function sortBelts(config: AppConfig): Belt[] {
  return [...config.belts];
}

export interface ConfigParseResult {
  config: AppConfig;
  errors: string[];
}

export function parseConfigJson(text: string): ConfigParseResult {
  const errors: string[] = [];
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return {
      config: defaultConfig(),
      errors: [`config.json is not valid JSON: ${(error as Error).message}`],
    };
  }

  if (!raw || typeof raw !== 'object') {
    return { config: defaultConfig(), errors: ['config.json must contain an object.'] };
  }

  const obj = raw as Record<string, unknown>;
  const beltsRaw = obj.belts;
  if (!Array.isArray(beltsRaw) || beltsRaw.length === 0) {
    errors.push('config.json must contain a non-empty "belts" array.');
    return { config: defaultConfig(), errors };
  }

  const belts: Belt[] = [];
  const seen = new Set<string>();
  beltsRaw.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      errors.push(`Belt #${index + 1} is not an object.`);
      return;
    }
    const belt = entry as Record<string, unknown>;
    const id = typeof belt.id === 'string' ? belt.id.trim() : '';
    const name = typeof belt.name === 'string' ? belt.name.trim() : '';
    const maxStripes = Number(belt.maxStripes);
    const minMonths = Number(belt.minMonthsToNextBelt);

    if (!id) errors.push(`Belt #${index + 1} is missing an id.`);
    if (!name) errors.push(`Belt #${index + 1} is missing a name.`);
    if (id && seen.has(id)) errors.push(`Duplicate belt id "${id}".`);
    if (!Number.isInteger(maxStripes) || maxStripes < 0) {
      errors.push(`Belt "${id || index + 1}" has an invalid maxStripes value.`);
    }
    if (!Number.isInteger(minMonths) || minMonths < 0) {
      errors.push(`Belt "${id || index + 1}" has an invalid minMonthsToNextBelt value.`);
    }

    if (!id || !name) return;
    seen.add(id);
    belts.push({
      id,
      name,
      maxStripes: Number.isInteger(maxStripes) && maxStripes >= 0 ? maxStripes : 4,
      minMonthsToNextBelt:
        Number.isInteger(minMonths) && minMonths >= 0 ? minMonths : 18,
    });
  });

  if (belts.length === 0) {
    errors.push('No valid belts were found in config.json.');
    return { config: defaultConfig(), errors };
  }

  const upcomingRaw = obj.upcomingEligibilityMonths;
  const upcoming = upcomingRaw == null ? 3 : Number(upcomingRaw);
  if (!Number.isInteger(upcoming) || upcoming < 0) {
    errors.push('upcomingEligibilityMonths must be a non-negative integer.');
  }

  return {
    config: {
      belts,
      upcomingEligibilityMonths:
        Number.isInteger(upcoming) && upcoming >= 0 ? upcoming : 3,
    },
    errors,
  };
}

export function serializeConfig(config: AppConfig): string {
  return `${JSON.stringify(
    {
      belts: config.belts.map((belt) => ({
        id: belt.id,
        name: belt.name,
        maxStripes: belt.maxStripes,
        minMonthsToNextBelt: belt.minMonthsToNextBelt,
      })),
      upcomingEligibilityMonths: config.upcomingEligibilityMonths,
    },
    null,
    2,
  )}\n`;
}

export function validateBeltId(id: string): string | null {
  if (!id.trim()) return 'Belt id must not be empty.';
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(id.trim())) {
    return 'Belt id may only contain letters, digits, hyphens and underscores.';
  }
  return null;
}
