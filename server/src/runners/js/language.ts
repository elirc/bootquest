import esbuild from 'esbuild';

/**
 * Infer the language of a predict-output snippet. BootForge's build deletes
 * `language` from output exercises (generate.mjs), but some were authored as
 * TS (ts-basics / ts-apps / react-ts). Deterministic rule: a snippet that
 * parses as JavaScript is 'js'; otherwise one that transpiles as TypeScript is
 * 'ts'; otherwise null (the importer refuses it).
 */
export async function detectSnippetLanguage(code: string): Promise<'js' | 'ts' | null> {
  try {
    await esbuild.transform(code, { loader: 'js', format: 'esm', logLevel: 'silent' });
    return 'js';
  } catch {
    /* not plain JS */
  }
  try {
    await esbuild.transform(code, { loader: 'ts', format: 'esm', logLevel: 'silent' });
    return 'ts';
  } catch {
    return null;
  }
}
