import type { JsonShape } from '@bootquest/shared';

/**
 * The JSON-shape matcher (grammar: shared/src/check.ts JsonShape). Small on
 * purpose: types, literals, required object keys, homogeneous arrays. Returns
 * the FIRST mismatch (depth-first, keys in spec order) or null.
 */
export interface ShapeMismatch {
  /** JSONPath-ish location, e.g. $.items[0].id */
  path: string;
  /** what the shape wanted, human-readable (e.g. "integer", "present", "\"done\"") */
  expected: string;
  /** what the body had, human-readable (e.g. "\"7\" (string)", "missing") */
  actual: string;
}

export type JsonTypeName = 'string' | 'number' | 'boolean' | 'null' | 'object' | 'array';

export function jsonTypeOf(v: unknown): JsonTypeName {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  const t = typeof v;
  if (t === 'string' || t === 'number' || t === 'boolean') return t;
  return 'object';
}

const MAX_RENDER = 80;

/** `"x" (string)`, `[...] (array, 3 items)`, `{...} (object)` — never the whole body. */
export function renderValue(v: unknown): string {
  const t = jsonTypeOf(v);
  if (t === 'array') return `array of ${(v as unknown[]).length}`;
  if (t === 'object') return 'object';
  const s = JSON.stringify(v);
  const short = s.length > MAX_RENDER ? `${s.slice(0, MAX_RENDER - 3)}...` : s;
  return t === 'null' ? 'null' : `${short} (${t})`;
}

function keyPath(path: string, key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;
}

export function matchShape(shape: JsonShape, value: unknown, path = '$'): ShapeMismatch | null {
  if (typeof shape === 'string') {
    if (shape === 'any') return null;
    if (shape === 'integer') {
      return typeof value === 'number' && Number.isInteger(value) ? null : { path, expected: 'integer', actual: renderValue(value) };
    }
    return jsonTypeOf(value) === shape ? null : { path, expected: shape, actual: renderValue(value) };
  }
  if ('equals' in shape) {
    return value === shape.equals ? null : { path, expected: JSON.stringify(shape.equals), actual: renderValue(value) };
  }
  if ('object' in shape) {
    if (jsonTypeOf(value) !== 'object') return { path, expected: 'object', actual: renderValue(value) };
    const obj = value as Record<string, unknown>;
    for (const [key, sub] of Object.entries(shape.object)) {
      const p = keyPath(path, key);
      if (!Object.prototype.hasOwnProperty.call(obj, key)) return { path: p, expected: 'present', actual: 'missing' };
      const m = matchShape(sub, obj[key], p);
      if (m) return m;
    }
    return null;
  }
  // array
  if (!Array.isArray(value)) return { path, expected: 'array', actual: renderValue(value) };
  if (shape.minItems !== undefined && value.length < shape.minItems) {
    return { path, expected: `at least ${shape.minItems} item${shape.minItems === 1 ? '' : 's'}`, actual: `${value.length} item${value.length === 1 ? '' : 's'}` };
  }
  for (let i = 0; i < value.length; i++) {
    const m = matchShape(shape.array, value[i], `${path}[${i}]`);
    if (m) return m;
  }
  return null;
}
