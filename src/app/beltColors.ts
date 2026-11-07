export interface BeltColors {
  bg: string;
  fg: string;
  border: string;
}

const palette: Record<string, BeltColors> = {
  white: { bg: '#ffffff', fg: '#1f2328', border: '#b9c0c8' },
  yellow: { bg: '#f2c200', fg: '#2b2200', border: '#c39b00' },
  orange: { bg: '#ef7d16', fg: '#2b1400', border: '#c9650a' },
  blue: { bg: '#1d5fbf', fg: '#ffffff', border: '#164a96' },
  purple: { bg: '#6b3fa0', fg: '#ffffff', border: '#54317e' },
  brown: { bg: '#6b4423', fg: '#ffffff', border: '#523318' },
  black: { bg: '#151719', fg: '#ffffff', border: '#000000' },
};

function hashHue(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) % 360;
  }
  return hash;
}

/** Colors for known belts, with a deterministic fallback for custom belts. */
export function beltColors(id: string, name = ''): BeltColors {
  const key = (id || name).trim().toLowerCase();
  if (palette[key]) return palette[key];
  const hue = hashHue(key || 'belt');
  return {
    bg: `hsl(${hue} 45% 42%)`,
    fg: '#ffffff',
    border: `hsl(${hue} 45% 32%)`,
  };
}
