import { readFileSync } from 'node:fs';
import { UnitContentFile, type UnitContentEntry } from '@bootquest/shared/api';

/**
 * Unit content that lives in content/ (seed output, imported packs), never in
 * the DB. Field visibility is documented on UnitContentEntry: instructions,
 * starter, snippet and rubric are public; solution, explanation and hints are
 * PRIVATE (only the reveal flow reads `solution`).
 */
export interface UnitContentStore {
  get(unitKey: string): UnitContentEntry | undefined;
  /** number of entries (loaded === built assertions) */
  size(): number;
}

export const emptyContentStore: UnitContentStore = { get: () => undefined, size: () => 0 };

export function mapContentStore(entries: unknown): UnitContentStore {
  const parsed = UnitContentFile.parse(entries);
  return entriesContentStore(new Map(Object.entries(parsed)));
}

/** Store over an already-validated map (pack loader output). */
export function entriesContentStore(map: ReadonlyMap<string, UnitContentEntry>): UnitContentStore {
  return { get: (key) => map.get(key), size: () => map.size };
}

/** Load a JSON content file ({ "<unit key>": UnitContentEntry }), Zod-validated. */
export function fileContentStore(path: string): UnitContentStore {
  return mapContentStore(JSON.parse(readFileSync(path, 'utf8')) as unknown);
}

/** Merge stores; a key present in two stores is a configuration error, never a silent override. */
export function combineContentStores(stores: readonly ReadonlyMap<string, UnitContentEntry>[]): UnitContentStore {
  const merged = new Map<string, UnitContentEntry>();
  for (const s of stores) {
    for (const [k, v] of s) {
      if (merged.has(k)) throw new Error(`unit content key ${k} is provided by more than one content source`);
      merged.set(k, v);
    }
  }
  return entriesContentStore(merged);
}

export function fileContentEntries(path: string): Map<string, UnitContentEntry> {
  return new Map(Object.entries(UnitContentFile.parse(JSON.parse(readFileSync(path, 'utf8')) as unknown)));
}
