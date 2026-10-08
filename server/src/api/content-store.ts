import { readFileSync } from 'node:fs';
import { UnitContentFile, type UnitContentEntry } from '@bootquest/shared/api';

/**
 * Unit content that lives in content/ (seed output), never in the DB:
 * public starter code + PRIVATE reference solution. Only the reveal flow
 * reads `solution`.
 */
export interface UnitContentStore {
  get(unitKey: string): UnitContentEntry | undefined;
}

export const emptyContentStore: UnitContentStore = { get: () => undefined };

export function mapContentStore(entries: unknown): UnitContentStore {
  const parsed = UnitContentFile.parse(entries);
  const map = new Map(Object.entries(parsed));
  return { get: (key) => map.get(key) };
}

/** Load a JSON content file ({ "<unit key>": {starter?, solution?} }), Zod-validated. */
export function fileContentStore(path: string): UnitContentStore {
  return mapContentStore(JSON.parse(readFileSync(path, 'utf8')) as unknown);
}
