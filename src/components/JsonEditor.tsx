import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands';
import { json } from '@codemirror/lang-json';
import { bracketMatching, foldGutter, HighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language';
import { Diagnostic, lintGutter, setDiagnostics } from '@codemirror/lint';
import { searchKeymap } from '@codemirror/search';
import { Compartment, EditorState, Transaction } from '@codemirror/state';
import {
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

export interface EditorDiagnostic {
  message: string;
  position?: number;
  offset?: number;
  length?: number;
  severity?: 'error' | 'warning';
}

export interface JsonEditorHandle {
  applyEdit(content: string): void;
  focus(): void;
  openSearch(): void;
  revealPosition(position: number): void;
}

interface JsonEditorProps {
  value: string;
  onChange?: (value: string) => void;
  onCursorChange?: (line: number, column: number) => void;
  diagnostic?: EditorDiagnostic | null;
  theme: 'light' | 'dark';
  readOnly?: boolean;
  ariaLabel?: string;
}

const themeCompartment = new Compartment();
const readOnlyCompartment = new Compartment();

const lightTheme = EditorView.theme({
  '&': { color: '#20252d', backgroundColor: '#ffffff' },
  '.cm-content': { caretColor: '#1769e0' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#1769e0' },
  '.cm-gutters': { backgroundColor: '#f7f8fa', color: '#5f6670', border: 'none' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: '#eef5ff' },
  '.cm-selectionBackground, ::selection': { backgroundColor: '#cfe1ff !important' },
  '.cm-matchingBracket': { backgroundColor: '#d9f3e2', outline: '1px solid #2f855a' },
});

const darkTheme = EditorView.theme(
  {
    '&': { color: '#e6e9ee', backgroundColor: '#17191d' },
    '.cm-content': { caretColor: '#70a5ff' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#70a5ff' },
    '.cm-gutters': { backgroundColor: '#1c1f24', color: '#858c98', border: 'none' },
    '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: '#202a38' },
    '.cm-selectionBackground, ::selection': { backgroundColor: '#294f7e !important' },
    '.cm-matchingBracket': { backgroundColor: '#244c36', outline: '1px solid #61c58a' },
    '.cm-tooltip': { backgroundColor: '#252930', borderColor: '#3c424c' },
  },
  { dark: true },
);

const lightHighlight = HighlightStyle.define([
  { tag: tags.propertyName, color: '#075fb8' },
  { tag: tags.string, color: '#087b52' },
  { tag: tags.number, color: '#a14c00' },
  { tag: tags.bool, color: '#7b3fbb' },
  { tag: tags.null, color: '#b4232e' },
  { tag: [tags.brace, tags.squareBracket], color: '#555f6d' },
]);

const darkHighlight = HighlightStyle.define([
  { tag: tags.propertyName, color: '#79b7ff' },
  { tag: tags.string, color: '#79d3a7' },
  { tag: tags.number, color: '#f2ad6d' },
  { tag: tags.bool, color: '#d4a0ff' },
  { tag: tags.null, color: '#ff8b96' },
  { tag: [tags.brace, tags.squareBracket], color: '#aeb5c0' },
]);

function editorTheme(theme: JsonEditorProps['theme']) {
  return theme === 'dark'
    ? [darkTheme, syntaxHighlighting(darkHighlight)]
    : [lightTheme, syntaxHighlighting(lightHighlight)];
}

function diagnosticToCodeMirror(value: EditorDiagnostic | null | undefined, length: number): Diagnostic[] {
  if (!value) return [];
  const requested = value.position ?? value.offset ?? 0;
  const from = Math.max(0, Math.min(requested, length));
  const to = Math.min(length, Math.max(from + (value.length ?? 1), from));
  return [{
    from,
    to,
    severity: value.severity ?? 'error',
    message: value.message,
  }];
}

export const JsonEditor = forwardRef<JsonEditorHandle, JsonEditorProps>(function JsonEditor(
  {
    value,
    onChange,
    onCursorChange,
    diagnostic,
    theme,
    readOnly = false,
    ariaLabel = 'JSON 文本编辑器',
  },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onCursorChangeRef = useRef(onCursorChange);

  onChangeRef.current = onChange;
  onCursorChangeRef.current = onCursorChange;

  useEffect(() => {
    if (!hostRef.current) return;

    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        foldGutter(),
        drawSelection(),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        bracketMatching(),
        rectangularSelection(),
        highlightActiveLine(),
        lintGutter(),
        json(),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
        themeCompartment.of(editorTheme(theme)),
        readOnlyCompartment.of(EditorState.readOnly.of(readOnly)),
        EditorView.contentAttributes.of({ 'aria-label': ariaLabel, spellcheck: 'false' }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChangeRef.current?.(update.state.doc.toString());
          if (update.selectionSet || update.docChanged) {
            const head = update.state.selection.main.head;
            const line = update.state.doc.lineAt(head);
            onCursorChangeRef.current?.(line.number, head - line.from + 1);
          }
        }),
      ],
    });

    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // A document switch remounts the component with a new key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === value) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
      annotations: Transaction.addToHistory.of(false),
    });
  }, [value]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: themeCompartment.reconfigure(editorTheme(theme)),
    });
  }, [theme]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: readOnlyCompartment.reconfigure(EditorState.readOnly.of(readOnly)),
    });
  }, [readOnly]);

  useEffect(() => {
    const view = viewRef.current;
    if (view) view.dispatch(setDiagnostics(view.state, diagnosticToCodeMirror(diagnostic, view.state.doc.length)));
  }, [diagnostic]);

  useImperativeHandle(ref, () => ({
    applyEdit(content: string) {
      const view = viewRef.current;
      if (!view || readOnly) return;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: content },
        selection: { anchor: 0 },
        scrollIntoView: true,
      });
      view.focus();
    },
    focus() {
      viewRef.current?.focus();
    },
    revealPosition(position: number) {
      const view = viewRef.current;
      if (!view) return;
      const anchor = Math.max(0, Math.min(position, view.state.doc.length));
      view.dispatch({
        selection: { anchor },
        effects: EditorView.scrollIntoView(anchor, { y: 'center' }),
      });
      view.focus();
    },
    openSearch() {
      const view = viewRef.current;
      if (!view) return;
      view.focus();
      const shortcut = navigator.platform.toLowerCase().includes('mac') ? 'Meta-f' : 'Control-f';
      view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'f',
        code: 'KeyF',
        metaKey: shortcut.startsWith('Meta'),
        ctrlKey: shortcut.startsWith('Control'),
        bubbles: true,
      }));
    },
  }), [readOnly]);

  return <div className="editor-host" ref={hostRef} />;
});
