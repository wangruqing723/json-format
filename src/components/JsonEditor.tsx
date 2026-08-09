import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands';
import { json } from '@codemirror/lang-json';
import { bracketMatching, foldGutter, HighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language';
import { Diagnostic, lintGutter, setDiagnostics } from '@codemirror/lint';
import { openSearchPanel, search, searchKeymap } from '@codemirror/search';
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
  '&': { color: '#261d20', backgroundColor: '#ffffff' },
  '.cm-content': { caretColor: '#b80048' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#b80048' },
  '.cm-gutters': { backgroundColor: '#ffffff', color: '#5c3f43', border: 'none' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: '#fdf0f4' },
  '.cm-selectionBackground, ::selection': { backgroundColor: '#ffe9ef !important' },
  '.cm-matchingBracket': { backgroundColor: '#d9f3e2', outline: '1px solid #006970' },
});

const darkTheme = EditorView.theme(
  {
    '&': { color: '#e8e0f0', backgroundColor: '#0a0a12' },
    '.cm-content': { caretColor: '#00ffcc' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#00ffcc' },
    '.cm-gutters': { backgroundColor: '#0f0f1a', color: '#a098b0', border: 'none' },
    '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: '#141422' },
    // 选区底比原先压暗：键名用的 #ff2d78 亮度偏低，在 #3a2b4a 上只有 3.63:1。
    // #251c2f 下键名达 4.59:1，且与编辑器底仍有 1.21 反差，选中状态看得出来。
    // 键名是出现频率最高的 token，故以它作为选区底色的对比度基准。
    '.cm-selectionBackground, ::selection': { backgroundColor: '#251c2f !important' },
    '.cm-matchingBracket': { backgroundColor: '#1a4d47', outline: '1px solid #00ffcc' },
    '.cm-tooltip': { backgroundColor: '#1e1e30', borderColor: '#493b60' },
  },
  { dark: true },
);

// 亮色同样与树视图对齐：键名取亮色 --accent，标点取亮色 --text-muted。
const lightHighlight = HighlightStyle.define([
  { tag: tags.propertyName, color: '#b80048', fontWeight: '600' },
  { tag: tags.string, color: '#00736a' },
  { tag: tags.number, color: '#a94f00', fontWeight: '500' },
  { tag: tags.bool, color: '#7629c0', fontWeight: '700' },
  { tag: tags.null, color: '#c8102e', fontStyle: 'italic', fontWeight: '500' },
  { tag: [tags.brace, tags.squareBracket, tags.separator], color: '#5c3f43' },
]);

// 暗色配色与树视图逐项对齐（用户要求统一到树视图那套）：
// 键名取树视图 .tree-path 的 --accent 粉，布尔接手键名腾出的青 ——
// 树视图里键名与布尔原本共用同一个粉色，靠左右分栏才没暴露；
// 编辑器里 "homework": true 的键与值紧邻，同色就分不出来，故让布尔换成青色。
// null 与标点同色，靠斜体区分（树视图与参考项目均是此设计）。
const darkHighlight = HighlightStyle.define([
  { tag: tags.propertyName, color: '#ff2d78', fontWeight: '600' },
  { tag: tags.string, color: '#ffe04a' },
  { tag: tags.number, color: '#ff80aa', fontWeight: '500' },
  { tag: tags.bool, color: '#00ffcc', fontWeight: '700' },
  { tag: tags.null, color: '#a098b0', fontStyle: 'italic', fontWeight: '500' },
  { tag: [tags.brace, tags.squareBracket, tags.separator], color: '#a098b0' },
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
        search({ top: true }),
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
      // 内容与当前完全一致时不派发：CodeMirror 的全量替换不做内容比对，
      // 照样会报 docChanged 并触发 onChange，进而把上游刚写入的校验结果清掉。
      // 同时也避免无谓地重置光标与滚动位置。
      if (view.state.doc.toString() === content) {
        view.focus();
        return;
      }
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
      openSearchPanel(view);
    },
  }), [readOnly]);

  return <div className="editor-host" ref={hostRef} />;
});
