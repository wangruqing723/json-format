import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  insertNewlineAndIndent,
} from '@codemirror/commands';
import { json } from '@codemirror/lang-json';
import { bracketMatching, foldGutter, HighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language';
import { Diagnostic, lintGutter, setDiagnostics } from '@codemirror/lint';
import { openSearchPanel, search, SearchCursor, searchKeymap } from '@codemirror/search';
import { Compartment, EditorState, Prec, Transaction } from '@codemirror/state';
import {
  Decoration,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
  ViewPlugin,
} from '@codemirror/view';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { beginSpan, measureEnterPhases } from '../services/perf-probe';

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
  // 当前行底 #ffd0e0（vs 白 1.37）+ 4px 实心竖条标示光标行。选区关键在于「叠在当前行底上仍要看得出」——
  // 之前 #ffc2d6 与当前行仅差 1.1，选中当前行内文字等于没高亮，故加深到 #ff8bb8（vs 当前行 1.59、vs 白 2.18）。
  // 键名此时 3.08:1：选中是临时态且键名加粗，符合大文本 AA 3:1。
  '.cm-activeLine': { backgroundColor: '#ffd0e0', boxShadow: 'inset 4px 0 0 #b80048' },
  '.cm-activeLineGutter': { backgroundColor: '#ffd0e0', color: '#b80048' },
  // 选中/停留的词与其它相同词都套青框（.cm-occurrence，含当前这处），构成「同一组相同词」；
  // 选中的那处还叠一层选区底色（#ff8bb8）以突出。青框底用半透明，好让选区色透出来。
  '.cm-selectionBackground': { backgroundColor: '#ff8bb8 !important' },
  '&.cm-focused .cm-selectionBackground': { backgroundColor: '#ff8bb8 !important' },
  '::selection': { backgroundColor: '#ff8bb8' },
  '.cm-occurrence': { backgroundColor: 'rgba(0, 145, 138, .16)', outline: '1px solid #00918a', borderRadius: '2px' },
  '.cm-matchingBracket': { backgroundColor: '#d9f3e2', outline: '1px solid #006970' },
});

const darkTheme = EditorView.theme(
  {
    '&': { color: '#e8e0f0', backgroundColor: '#0a0a12' },
    '.cm-content': { caretColor: '#00ffcc' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#00ffcc' },
    '.cm-gutters': { backgroundColor: '#0f0f1a', color: '#a098b0', border: 'none' },
    // 当前行底 #1c1c33 + 4px 实心青竖条 + 行号染青标示光标行（竖条不碰文字对比，键名仍 4.67:1）。
    // 选区关键在于「叠在当前行底上仍要看得出」——之前 #2a2140 与当前行仅差 1.1，选中当前行内文字等于没高亮，
    // 故提亮到 #4a2f66（vs 当前行 1.5、vs 底 1.77）。键名此时 3.12:1：选中是临时态且键名加粗，符合大文本 AA 3:1。
    '.cm-activeLine': { backgroundColor: '#1c1c33', boxShadow: 'inset 4px 0 0 #00ffcc' },
    '.cm-activeLineGutter': { backgroundColor: '#1c1c33', color: '#00ffcc' },
    '.cm-selectionBackground': { backgroundColor: '#4a2f66 !important' },
    '&.cm-focused .cm-selectionBackground': { backgroundColor: '#4a2f66 !important' },
    '::selection': { backgroundColor: '#4a2f66' },
    '.cm-occurrence': { backgroundColor: 'rgba(0, 255, 204, .16)', outline: '1px solid rgba(0, 255, 204, .55)', borderRadius: '2px' },
    '.cm-matchingBracket': { backgroundColor: '#1a4d47', outline: '1px solid #00ffcc' },
    '.cm-tooltip': { backgroundColor: '#1e1e30', borderColor: '#493b60' },
  },
  { dark: true },
);

const occurrenceMark = Decoration.mark({ class: 'cm-occurrence' });

// 把「光标所在的词 / 已选中的文本」连同全文所有相同出现——包括当前这一处——统一高亮。
// CodeMirror 自带的 highlightSelectionMatches 偏偏不高亮你正选中/停留的那一处，
// 而用户要的恰恰是当前这处也高亮，且把光标放进单词任意位置就触发，故自实现。
function buildOccurrences(view: EditorView): DecorationSet {
  const { state } = view;
  const sel = state.selection.main;
  let from: number;
  let to: number;
  if (sel.empty) {
    const word = state.wordAt(sel.head);
    if (!word) return Decoration.none;
    from = word.from;
    to = word.to;
  } else {
    from = sel.from;
    to = sel.to;
  }
  const query = state.sliceDoc(from, to);
  // 太短或含空白/换行的选区不参与，避免整屏乱糊。
  if (query.length < 2 || /\s/.test(query)) return Decoration.none;
  const ranges: ReturnType<typeof occurrenceMark.range>[] = [];
  for (const part of view.visibleRanges) {
    const cursor = new SearchCursor(state.doc, query, part.from, part.to);
    while (!cursor.next().done) {
      ranges.push(occurrenceMark.range(cursor.value.from, cursor.value.to));
      if (ranges.length > 200) return Decoration.set(ranges, true);
    }
  }
  return Decoration.set(ranges, true);
}

const occurrenceHighlighter = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildOccurrences(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = buildOccurrences(update.view);
      }
    }
  },
  { decorations: (value) => value.decorations },
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
        // 选中/停在一个词上时，全文相同片段（含当前这处）统一高亮——用户要的「高亮相同项」。
        occurrenceHighlighter,
        // 回车单独接管以做阶段分解：用户确认卡顿只由回车触发。这里仍执行原命令
        // insertNewlineAndIndent，只是在它前后取时刻，行为与默认一致。
        // Prec.high 保证排在 defaultKeymap 的 Enter 之前。
        Prec.high(keymap.of([{
          key: 'Enter',
          run: (view) => {
            let handled = false;
            measureEnterPhases(() => { handled = insertNewlineAndIndent(view); }, view.dom);
            return handled;
          },
        }])),
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

    // 包住 dispatch 计时：CodeMirror 内部的文档更新、装饰重算、DOM 写入都在这里面，
    // 之前完全没插桩。上一版实测显示卡顿窗口内没有任何已插桩事件，这是首要盲区。
    const view = new EditorView({
      state,
      parent: hostRef.current,
      dispatchTransactions: (transactions, editorView) => {
        const endDispatch = beginSpan('cm-dispatch');
        editorView.update(transactions);
        endDispatch();
      },
    });
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
