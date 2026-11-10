// U11: the CodeMirror 6 code editor. Loaded lazily by ./Editor.tsx (never in the main bundle, never
// in tests); same four props as the textarea it replaces, so Player.tsx and lib/draft.ts are unchanged.
import { useEffect, useRef } from 'react';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { HighlightStyle, bracketMatching, indentOnInput, indentUnit, syntaxHighlighting } from '@codemirror/language';
import { Annotation, Compartment, EditorState } from '@codemirror/state';
import { EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import { codeLangOf, indentUnitFor, loadCodeLang } from '../../lib/codelang';

/** Marks a transaction that mirrors the `value` prop into the doc: it must not echo back as onChange. */
const External = Annotation.define<boolean>();

/** Colours come from CSS variables (styles/player.css), so the editor follows the app theme. */
const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword, t.definitionKeyword, t.modifier], color: 'var(--code-keyword)' },
  { tag: [t.string, t.special(t.string), t.character, t.regexp], color: 'var(--code-string)' },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--code-number)' },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: 'var(--code-comment)', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.function(t.definition(t.variableName))], color: 'var(--code-function)' },
  { tag: [t.typeName, t.className, t.namespace, t.standard(t.variableName)], color: 'var(--code-type)' },
  { tag: [t.propertyName, t.attributeName], color: 'var(--code-property)' },
  { tag: [t.operator, t.punctuation, t.bracket], color: 'var(--code-punctuation)' },
  { tag: [t.meta, t.annotation, t.processingInstruction], color: 'var(--code-meta)' },
  { tag: t.invalid, color: 'var(--code-invalid)' },
]);

// The app owns Ctrl/Cmd+Enter (Run) and Ctrl/Cmd+Shift+Enter (Submit) as window-level shortcuts:
// CodeMirror's own bindings for them (insertBlankLine) must go, or the key never reaches the page.
const APP_KEYS = new Set(['Mod-Enter', 'Shift-Mod-Enter', 'Mod-Shift-Enter']);
const editingKeymap = defaultKeymap.filter((b) => !(b.key !== undefined && APP_KEYS.has(b.key)));

export default function CodeMirrorEditor({ value, onChange, language, describedBy }: { value: string; onChange: (v: string) => void; language: string; describedBy?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const valueRef = useRef(value);
  valueRef.current = value;

  // one editor per mount; the language (label, grammar, indent) is fixed for a unit, and the player
  // is keyed by unit, so a language change simply rebuilds the editor
  useEffect(() => {
    if (!host.current) return;
    const unit = indentUnitFor(language);
    const lang = new Compartment();
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: valueRef.current,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          history(),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          indentUnit.of(unit),
          EditorState.tabSize.of(unit.length),
          syntaxHighlighting(highlight),
          lang.of([]),
          // Tab indents; Escape then Tab leaves the editor (CodeMirror's own tab-focus escape)
          keymap.of([...closeBracketsKeymap, ...editingKeymap, ...historyKeymap, indentWithTab]),
          EditorView.contentAttributes.of({
            'aria-label': `Code editor (${language})`,
            ...(describedBy ? { 'aria-describedby': describedBy } : {}),
            spellcheck: 'false',
            autocapitalize: 'off',
            autocorrect: 'off',
          }),
          EditorView.theme({}, { dark: true }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged && !u.transactions.some((tr) => tr.annotation(External))) onChangeRef.current(u.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = v;
    let live = true;
    const id = codeLangOf(language);
    if (id) {
      loadCodeLang(id).then(
        (support) => live && v.dispatch({ effects: lang.reconfigure(support) }),
        () => undefined, // no grammar: a plain (still fully working) editor
      );
    }
    return () => {
      live = false;
      v.destroy();
      view.current = null;
    };
  }, [language, describedBy]);

  // The parent replaced the text (Reset to starter, Undo, "Load my last submitted code", a restored
  // draft): swap the whole doc, annotated so the update listener does not report it as an edit.
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const next = value.replace(/\r\n?/g, '\n');
    if (next === v.state.doc.toString()) return;
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: next }, annotations: External.of(true) });
  }, [value]);

  return <div className="editor editor-cm" ref={host} data-testid="cm-editor" />;
}
