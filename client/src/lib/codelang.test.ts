import { describe, expect, it } from 'vitest';
import { codeLangOf, highlightCode, indentUnitFor } from './codelang';

describe('codeLangOf / indentUnitFor', () => {
  it('maps editor labels and fence tags to the known languages', () => {
    expect(codeLangOf('JavaScript')).toBe('javascript');
    expect(codeLangOf('js')).toBe('javascript');
    expect(codeLangOf('jsx')).toBe('javascript');
    expect(codeLangOf('TypeScript')).toBe('typescript');
    expect(codeLangOf('ts')).toBe('typescript');
    expect(codeLangOf('Java')).toBe('java');
    expect(codeLangOf('C#')).toBe('csharp');
    expect(codeLangOf('csharp')).toBe('csharp');
    for (const other of ['SQL', 'json', 'code', '', null, undefined]) expect(codeLangOf(other)).toBeNull();
  });

  it('indents C# and Java by four spaces, everything else by two', () => {
    expect(indentUnitFor('C#')).toBe('    ');
    expect(indentUnitFor('Java')).toBe('    ');
    expect(indentUnitFor('JavaScript')).toBe('  ');
    expect(indentUnitFor('SQL')).toBe('  ');
  });
});

describe('highlightCode (U17)', () => {
  it.each([
    ['javascript', "const a = 'x'; // note\nreturn a === 1;", 'tok-keyword', 'const'],
    ['java', 'public class A { int n = 1; } // c', 'tok-keyword', 'class'],
    ['csharp', 'static int Count(string text) => 0; // c', 'tok-keyword', 'static'],
  ] as const)('%s: tokens carry tok-* classes and add up to the exact source text', async (lang, code, cls, word) => {
    const tokens = await highlightCode(code, lang);
    expect(tokens.map((t) => t.text).join('')).toBe(code);
    expect(tokens.some((t) => t.text === word && (t.cls ?? '').split(' ').includes(cls))).toBe(true);
    expect(tokens.some((t) => (t.cls ?? '').includes('tok-comment'))).toBe(true);
  });
});
