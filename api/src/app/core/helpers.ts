export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function average(values: number[]): number {
  if (!values.length) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function serializeJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return '{}';
  }
}

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function toSlug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

export function truncate(input: string | null | undefined, length: number): string {
  if (!input) {
    return '';
  }

  if (input.length <= length) {
    return input;
  }

  return `${input.slice(0, length - 1)}...`;
}

export function daysUntil(date: Date | null | undefined): number | null {
  if (!date) {
    return null;
  }

  return (date.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
}

export function dateKey(input: Date | number | string = new Date()): string {
  const d = input instanceof Date ? input : new Date(input);
  return d.toISOString().slice(0, 10);
}

export function standardDeviation(values: number[]): number {
  if (values.length <= 1) {
    return 0;
  }

  const mean = average(values);
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    (values.length - 1);

  return Math.sqrt(variance);
}
