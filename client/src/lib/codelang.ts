// U11 / U17: the code languages the player knows, loaded on demand.
//
// Every CodeMirror language pack is its own dynamic import, so a JS drill never downloads the Java
// grammar. This module is itself only ever reached through a dynamic import (the lazy CodeMirror
// editor and the lazy lesson-code highlighter): nothing here is in the main bundle.
import type { Language, LanguageSupport } from '@codemirror/language';
import { classHighlighter, highlightTree } from '@lezer/highlight';

export type CodeLang = 'javascript' | 'typescript' | 'java' | 'csharp';

/** The editor's language label ("JavaScript", "C#", ...) or a fence tag ("js", "cs", ...) → a known language. */
export function codeLangOf(label: string | null | undefined): CodeLang | null {
  const l = (label ?? '').trim().toLowerCase();
  if (/^(js|jsx|javascript|node|mjs|cjs)$/.test(l)) return 'javascript';
  if (/^(ts|tsx|typescript)$/.test(l)) return 'typescript';
  if (l === 'java') return 'java';
  if (/^(c#|cs|csharp|dotnet)$/.test(l)) return 'csharp';
  return null;
}

/** Indent unit per language: 4 spaces for C# / Java (their conventions), 2 for JS / TS and the rest. */
export const indentUnitFor = (label: string): string => {
  const lang = codeLangOf(label);
  return lang === 'java' || lang === 'csharp' ? '    ' : '  ';
};

const cache = new Map<CodeLang, Promise<Language | LanguageSupport>>();

/** The language (grammar + its editor support), fetched once per language. */
export function loadCodeLang(lang: CodeLang): Promise<Language | LanguageSupport> {
  let p = cache.get(lang);
  if (!p) {
    p = (async (): Promise<Language | LanguageSupport> => {
      if (lang === 'javascript' || lang === 'typescript') {
        const { javascript } = await import('@codemirror/lang-javascript');
        return javascript({ typescript: lang === 'typescript', jsx: true });
      }
      if (lang === 'java') {
        const { java } = await import('@codemirror/lang-java');
        return java();
      }
      const [{ StreamLanguage }, { csharp }] = await Promise.all([import('@codemirror/language'), import('@codemirror/legacy-modes/mode/clike')]);
      return StreamLanguage.define(csharp);
    })();
    cache.set(lang, p);
    // a failed fetch (offline chunk) must not be cached forever
    p.catch(() => cache.delete(lang));
  }
  return p;
}

export interface CodeToken {
  text: string;
  /** `tok-*` classes (player.css), or null for plain text */
  cls: string | null;
}

/** Static highlight: source text → tokens with `tok-*` classes (no editor, no DOM). */
export async function highlightCode(code: string, lang: CodeLang): Promise<CodeToken[]> {
  const loaded = await loadCodeLang(lang);
  const language = 'language' in loaded ? loaded.language : loaded;
  const tree = language.parser.parse(code);
  const out: CodeToken[] = [];
  let pos = 0;
  highlightTree(tree, classHighlighter, (from, to, cls) => {
    if (from > pos) out.push({ text: code.slice(pos, from), cls: null });
    out.push({ text: code.slice(from, to), cls });
    pos = to;
  });
  if (pos < code.length) out.push({ text: code.slice(pos), cls: null });
  return out;
}
