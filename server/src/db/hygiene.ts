/**
 * Row hygiene for node:sqlite (spec §13, opusboot2 recon gotchas 1-2):
 *  - rows come back with a NULL prototype -> spread into plain objects;
 *  - lastInsertRowid / changes (and any readBigInts value) may be BigInt -> Number;
 *  - booleans are stored as 0/1 -> real booleans for known boolean columns;
 *  - node:sqlite rejects JS booleans / undefined as bind params -> 1/0 / null.
 */

/** Column names that hold 0/1 booleans anywhere in the schema. */
export const BOOLEAN_COLUMNS: ReadonlySet<string> = new Set([
  'locked',
  'slate_drills',
  'read_only',
  'inverted',
  'assisted',
  'verified',
  'core',
  'family_pick',
]);

export type SqlParam = string | number | bigint | null | Uint8Array;
export type SqlInput = SqlParam | boolean | undefined;

/** BigInt -> number, refusing values that would lose precision. */
export function toNumber(value: number | bigint): number {
  if (typeof value === 'number') return value;
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError(`integer ${value} exceeds Number.MAX_SAFE_INTEGER`);
  }
  return Number(value);
}

/** Convert a raw node:sqlite row (null prototype, maybe BigInt) into a plain object. */
export function cleanRow<T = Record<string, unknown>>(row: unknown): T {
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(row as Record<string, unknown>)) {
    let value = raw;
    if (typeof value === 'bigint') value = toNumber(value);
    if (BOOLEAN_COLUMNS.has(key) && (value === 0 || value === 1)) value = value === 1;
    out[key] = value;
  }
  return out as T;
}

/** Bind-parameter hygiene: booleans -> 1/0, undefined -> null. */
export function toParam(value: SqlInput): SqlParam {
  if (value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
}
