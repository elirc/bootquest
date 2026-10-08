import { readFileSync } from 'node:fs';
import { CheckSpecTable, CurriculumConfig, type SourceEntry } from '@bootquest/shared/sync';
import { parseYamlSubset } from './yaml.ts';

/** Parse + Zod-validate curriculum.yaml text (the source registry). */
export function parseCurriculumConfig(text: string): CurriculumConfig {
  return CurriculumConfig.parse(parseYamlSubset(text));
}

export function loadCurriculumConfig(path: string): CurriculumConfig {
  return parseCurriculumConfig(readFileSync(path, 'utf8'));
}

/** Load + validate the recorded node-test-file spec table (content/sync/check-specs.json). */
export function loadCheckSpecTable(path: string): CheckSpecTable {
  return CheckSpecTable.parse(JSON.parse(readFileSync(path, 'utf8')) as unknown);
}

/** Is this repo-relative path one the source registers markdown from? */
export function pathSelected(entry: Pick<SourceEntry, 'include' | 'exclude'>, path: string): boolean {
  const under = (prefix: string) => {
    const p = prefix.endsWith('/') ? prefix : `${prefix}/`;
    return path === prefix || path.startsWith(p);
  };
  if (entry.exclude?.some(under)) return false;
  if (entry.include && entry.include.length > 0) return entry.include.some(under);
  return true;
}
