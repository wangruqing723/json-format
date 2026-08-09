import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ActionBar, type MoreAction } from './components/ActionBar';
import { AboutDialog } from './components/AboutDialog';
import { AppHeader, type WorkspaceView } from './components/AppHeader';
import { CommandPalette, type AppCommand } from './components/CommandPalette';
import { useConfirm } from './components/ConfirmDialog';
import { DiffView } from './components/DiffView';
import { Icon } from './components/Icon';
import { InfoRow } from './components/InfoRow';
import { JsonEditor, type JsonEditorHandle } from './components/JsonEditor';
import { HistoryView, type HistoryRecord } from './components/HistoryView';
import { SearchPanel } from './components/SearchPanel';
import { Sidebar } from './components/Sidebar';
import { SettingsDialog } from './components/SettingsDialog';
import { StructurePanel } from './components/StructurePanel';
import { StructureResizer } from './components/StructureResizer';
import { EXPAND_ALL_CONFIRM_ROWS, TreeView, type TreeViewHandle } from './components/TreeView';
import { isCurrentDocumentSnapshot } from './core/document-snapshot';
import { parseJson, type JsonNode } from './core/json-parser';
import { runQuery, type QueryHit, type QueryResult } from './core/json-query';
import {
  collapseAll,
  containsDuplicateKeys,
  countVisibleRows,
  createExpandState,
  expandAll,
  revealPath,
  type ExpandState,
} from './core/tree-flatten';
import { JsonWorkerClient, WorkerCancelledError } from './services/worker-client';
import {
  listenForJsonDrops,
  openJsonFiles,
  readJsonPath,
  revealFileInFolder,
  saveJsonFile,
  saveJsonFileAs,
  writeClipboardText,
  isTauriRuntime,
  type OpenedJsonFile,
} from './services/platform';
import { isDocumentDirty, useWorkspaceStore } from './stores/workspace';
import type { JsonDiagnostic, ProcessingMeta, WorkerOperation } from './types';
import { formatBytes } from './utils/format';

const AUTO_VALIDATE_LIMIT = 10 * 1024 * 1024;
const DIFF_VIEW_LIMIT = 5 * 1024 * 1024;

type OutputMode = 'replace' | 'new-tab';

interface ProcessingState {
  requestId: string;
  operation: WorkerOperation;
  documentId: string;
}

interface PendingEdit {
  documentId: string;
  content: string;
  source: string;
}

interface ToastState {
  id: number;
  message: string;
  tone: 'neutral' | 'success' | 'error';
}

/**
 * 变换类操作被禁用的原因，null 表示当前可执行。
 * 工具栏 tooltip、「更多」菜单禁用态、以及点击后的 toast 共用这一处判断，
 * 避免三处各写一遍导致文案与实际状态不一致。
 */
export function transformBlockedReason(
  diff: unknown,
  historyOpen: boolean,
  processing: boolean,
): string | null {
  if (historyOpen) return '历史视图下不可变换内容，请先切换到文本或树视图';
  if (diff) return 'Diff 模式下不可变换内容，请先切换到文本或树视图';
  if (processing) return '正在处理，请稍候';
  return null;
}

const operationLabels: Record<WorkerOperation, string> = {
  validate: '校验',
  format: '格式化',
  minify: '压缩',
  sort: '键排序',
  repair: '修复',
  escape: '转义',
  unescape: '反转义',
  stats: '统计',
  query: '查询',
  diff: '比较',
};

function useResolvedTheme(preference: 'system' | 'light' | 'dark') {
  const [systemDark, setSystemDark] = useState(() =>
    window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false,
  );

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setSystemDark(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;
}

function byteLength(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

export function App() {
  const {
    documents,
    activeDocumentId,
    diff,
    settings,
    recentFiles,
    history,
    persistenceIssue,
    newDocument,
    openDocument,
    updateContent,
    markSaved,
    closeDocument,
    setActive,
    setView,
    setDiff,
    updateSettings,
    removeRecentFile,
    addHistoryRecord,
    clearHistory,
    flushPersistence,
  } = useWorkspaceStore();
  const activeDocument = documents.find((document) => document.id === activeDocumentId) ?? documents[0];
  const resolvedTheme = useResolvedTheme(settings.theme);
  // 拖拽期间走本地 state：每帧都写 store 会连带触发 localStorage 持久化，
  // 松手时才 commit 一次。settings 侧的值变化（如设置面板重置）由下面的 effect 同步回来。
  const [structureWidth, setStructureWidth] = useState(settings.structureWidth);
  useEffect(() => setStructureWidth(settings.structureWidth), [settings.structureWidth]);
  const commitStructureWidth = useCallback(
    (width: number) => updateSettings({ structureWidth: width }),
    [updateSettings],
  );
  const editorRef = useRef<JsonEditorHandle>(null);
  const treeViewRef = useRef<TreeViewHandle>(null);
  const actionWorkerRef = useRef<JsonWorkerClient | null>(null);
  const validationWorkerRef = useRef<JsonWorkerClient | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const tauriCloseApprovedRef = useRef(false);
  const [diagnostics, setDiagnostics] = useState<Record<string, JsonDiagnostic | null>>({});
  const [metadata, setMetadata] = useState<Record<string, ProcessingMeta | undefined>>({});
  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  const [processing, setProcessing] = useState<ProcessingState | null>(null);
  // 正在后台校验的文档 id。状态栏据此区分「真的在校验」与「校验结果缺失」，
  // 避免把「没有 metadata」一律说成「正在校验」。
  const [validatingIds, setValidatingIds] = useState<ReadonlySet<string>>(() => new Set());
  const [pendingEdit, setPendingEdit] = useState<PendingEdit | null>(null);
  const [pendingReveal, setPendingReveal] = useState<{ documentId: string; offset: number } | null>(null);
  const [commandOpen, setCommandOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [activePanel, setActivePanel] = useState<'search' | 'schema' | null>(null);
  const [expandState, setExpandState] = useState<ExpandState>(createExpandState);
  const [searchInput, setSearchInput] = useState('');
  const [pendingTreeScrollPath, setPendingTreeScrollPath] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const { confirm, dialog: confirmDialog } = useConfirm();

  if (!actionWorkerRef.current) actionWorkerRef.current = new JsonWorkerClient();
  if (!validationWorkerRef.current) validationWorkerRef.current = new JsonWorkerClient();

  const parseResult = useMemo<{ root: JsonNode | null; parseError: string | null; hasDuplicates: boolean }>(() => {
    if (!activeDocument?.content.trim()) return { root: null, parseError: 'JSON 内容为空', hasDuplicates: false };
    try {
      const root = parseJson(activeDocument.content);
      return { root, parseError: null, hasDuplicates: containsDuplicateKeys(root) };
    } catch (error) {
      return {
        root: null,
        parseError: error instanceof Error ? error.message : '无法解析 JSON',
        hasDuplicates: false,
      };
    }
  }, [activeDocument?.content]);

  const queryResult = useMemo<QueryResult | null>(() => {
    if (!parseResult.root || !searchInput.trim()) return null;
    return runQuery(parseResult.root, searchInput);
  }, [parseResult.root, searchInput]);

  const highlightPaths = useMemo<ReadonlySet<string>>(
    () => new Set(queryResult?.hits.map((hit) => hit.path) ?? []),
    [queryResult],
  );

  useEffect(() => {
    setExpandState(createExpandState());
  }, [activeDocument?.id]);

  useEffect(() => {
    if (!queryResult || activeDocument?.view !== 'tree') return;
    setExpandState((current) => queryResult.hits.reduce((state, hit) => revealPath(state, hit.path), current));
  }, [activeDocument?.view, queryResult]);

  useEffect(() => {
    if (!pendingTreeScrollPath || activeDocument?.view !== 'tree') return;
    const frame = window.requestAnimationFrame(() => {
      treeViewRef.current?.scrollToPath(pendingTreeScrollPath);
      setPendingTreeScrollPath(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeDocument?.view, expandState, pendingTreeScrollPath]);

  const showToast = useCallback((message: string, tone: ToastState['tone'] = 'neutral') => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    setToast({ id: Date.now(), message, tone });
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2600);
  }, []);

  const openCommandPanel = useCallback(() => {
    setSettingsOpen(false);
    setCommandOpen(true);
  }, []);

  const openSettingsPanel = useCallback(() => {
    setCommandOpen(false);
    setSettingsOpen(true);
  }, []);

  const handleOpenDocs = useCallback(() => {
    setAboutOpen(true);
  }, []);

  const focusSearch = useCallback(() => {
    setActivePanel('search');
    window.requestAnimationFrame(() => document.getElementById('workspace-search')?.focus());
  }, []);

  const togglePanel = useCallback((panel: 'search' | 'schema') => {
    setActivePanel((current) => current === panel ? null : panel);
  }, []);

  const expandAllRows = useCallback(async () => {
    if (!parseResult.root) return;
    const next = expandAll(expandState);
    const count = countVisibleRows(parseResult.root, next);
    if (count > EXPAND_ALL_CONFIRM_ROWS) {
      const confirmed = await confirm({
        title: '展开全部节点',
        message: `全部展开后预计有 ${count.toLocaleString()} 行，可能占用较多内存。仍要继续吗？`,
        confirmLabel: '展开全部',
      });
      if (!confirmed) return;
    }
    setExpandState(next);
  }, [confirm, expandState, parseResult.root]);

  const collapseAllRows = useCallback(() => {
    setExpandState((current) => collapseAll(current));
  }, []);

  const selectQueryHit = useCallback((hit: QueryHit) => {
    if (!activeDocument) return;
    if (activeDocument.view === 'tree') {
      setExpandState((current) => revealPath(current, hit.path));
      setPendingTreeScrollPath(hit.path);
      return;
    }
    setPendingReveal({ documentId: activeDocument.id, offset: hit.offset });
  }, [activeDocument]);

  useEffect(() => {
    if (persistenceIssue) showToast(persistenceIssue.message, 'error');
  }, [persistenceIssue, showToast]);

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.classList.toggle('dark', resolvedTheme === 'dark');
    document.documentElement.classList.toggle('light', resolvedTheme === 'light');
    document.documentElement.style.colorScheme = resolvedTheme;
    const themeMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    themeMeta?.setAttribute('content', resolvedTheme === 'dark' ? '#0a0a12' : '#f8f9fd');
  }, [resolvedTheme]);

  useEffect(() => {
    if (isTauriRuntime()) {
      let disposed = false;
      let unlisten: (() => void) | undefined;
      void import('@tauri-apps/api/window').then(async ({ getCurrentWindow }) => {
        if (disposed) return;
        const appWindow = getCurrentWindow();
        unlisten = await appWindow.onCloseRequested(async (event) => {
          flushPersistence();
          if (tauriCloseApprovedRef.current) {
            tauriCloseApprovedRef.current = false;
            return;
          }
          const dirtyDocument = useWorkspaceStore.getState().documents.find(isDocumentDirty);
          if (!dirtyDocument) return;
          event.preventDefault();
          const confirmed = await confirm({
            title: '退出前保存提醒',
            message: `“${dirtyDocument.title}”有未保存更改，仍要退出吗？`,
            confirmLabel: '仍要退出',
            tone: 'danger',
          });
          if (!confirmed) return;
          tauriCloseApprovedRef.current = true;
          flushPersistence();
          await appWindow.close();
        });
      }).catch((error) => showToast(error instanceof Error ? error.message : '无法注册窗口关闭处理', 'error'));
      return () => {
        disposed = true;
        unlisten?.();
      };
    }

    const beforeUnload = (event: BeforeUnloadEvent) => {
      flushPersistence();
      if (!useWorkspaceStore.getState().documents.some(isDocumentDirty)) return;
      event.preventDefault();
      event.returnValue = '';
    };
    const pageHide = () => flushPersistence();
    window.addEventListener('beforeunload', beforeUnload);
    window.addEventListener('pagehide', pageHide);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      window.removeEventListener('pagehide', pageHide);
    };
  }, [confirm, flushPersistence, showToast]);

  useEffect(() => {
    if (import.meta.env.DEV) return;
    const allowNativeMenu = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest('input, textarea, select, [contenteditable="true"], .cm-editor, .cm-content')) return;
      event.preventDefault();
    };
    document.addEventListener('contextmenu', allowNativeMenu);
    return () => document.removeEventListener('contextmenu', allowNativeMenu);
  }, []);

  const acceptOpenedFiles = useCallback((files: OpenedJsonFile[]) => {
    for (const file of files) openDocument(file);
    if (files.length) showToast(`已打开 ${files.length} 个文件`, 'success');
  }, [openDocument, showToast]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listenForJsonDrops(acceptOpenedFiles)
      .then((cleanup) => { unlisten = cleanup; })
      .catch((error) => showToast(error instanceof Error ? error.message : '无法读取拖入的文件', 'error'));
    return () => unlisten?.();
  }, [acceptOpenedFiles, showToast]);

  useEffect(() => {
    if (!activeDocument) return;
    const source = activeDocument.content;
    const documentId = activeDocument.id;
    if (byteLength(source) > AUTO_VALIDATE_LIMIT) {
      setDiagnostics((current) => ({ ...current, [documentId]: null }));
      return;
    }

    const markValidating = (active: boolean) => {
      setValidatingIds((current) => {
        if (active === current.has(documentId)) return current;
        const next = new Set(current);
        if (active) next.add(documentId);
        else next.delete(documentId);
        return next;
      });
    };

    const timer = window.setTimeout(() => {
      markValidating(true);
      const task = validationWorkerRef.current!.process('validate', source);
      void task.response.then((response) => {
        if (!isCurrentDocumentSnapshot(useWorkspaceStore.getState().documents, documentId, source)) return;
        if (response.ok) {
          setDiagnostics((current) => ({
            ...current,
            [documentId]: response.meta.warnings?.[0] ?? null,
          }));
          setMetadata((current) => ({ ...current, [documentId]: response.meta }));
        } else {
          setDiagnostics((current) => ({ ...current, [documentId]: response.error }));
        }
      }).catch((error) => {
        if (!(error instanceof WorkerCancelledError)) showToast('后台校验失败', 'error');
      }).finally(() => markValidating(false));
    }, 320);

    return () => {
      window.clearTimeout(timer);
      markValidating(false);
      validationWorkerRef.current?.cancelAll();
    };
  }, [activeDocument?.content, activeDocument?.id, showToast]);

  useEffect(() => {
    if (!pendingEdit || !activeDocument || pendingEdit.documentId !== activeDocument.id) return;
    if (diff || activeDocument.view !== 'text' || !editorRef.current) return;
    const edit = pendingEdit;
    setPendingEdit(null);
    window.requestAnimationFrame(() => {
      if (!isCurrentDocumentSnapshot(useWorkspaceStore.getState().documents, edit.documentId, edit.source)) {
        showToast('内容已更改，已丢弃过期的处理结果', 'neutral');
        return;
      }
      editorRef.current?.applyEdit(edit.content);
    });
  }, [activeDocument, diff, pendingEdit, showToast]);

  useEffect(() => {
    if (!pendingReveal || !activeDocument || pendingReveal.documentId !== activeDocument.id) return;
    if (diff || activeDocument.view !== 'text' || !editorRef.current) return;
    const reveal = pendingReveal;
    setPendingReveal(null);
    window.requestAnimationFrame(() => editorRef.current?.revealPosition(reveal.offset));
  }, [activeDocument, diff, pendingReveal]);

  const handleOpen = useCallback(async () => {
    try {
      acceptOpenedFiles(await openJsonFiles());
    } catch (error) {
      showToast(error instanceof Error ? error.message : '打开文件失败', 'error');
    }
  }, [acceptOpenedFiles, showToast]);

  const selectDocument = useCallback((id: string) => {
    setActive(id);
    setDiff(null);
    setHistoryOpen(false);
  }, [setActive, setDiff]);

  const handleOpenRecent = useCallback(async (path: string) => {
    try {
      selectDocument(openDocument(await readJsonPath(path)));
    } catch (error) {
      removeRecentFile(path);
      showToast(error instanceof Error ? error.message : '最近文件已不可用', 'error');
    }
  }, [openDocument, removeRecentFile, selectDocument, showToast]);

  const handleSave = useCallback(async () => {
    const current = useWorkspaceStore.getState().documents.find(
      (document) => document.id === useWorkspaceStore.getState().activeDocumentId,
    );
    if (!current) return;
    const savedContent = current.content;
    if (!savedContent.trim()) {
      showToast('文档为空，无内容可保存', 'neutral');
      return;
    }
    const diagnostic = diagnostics[current.id];
    if (byteLength(savedContent) <= AUTO_VALIDATE_LIMIT && diagnostic?.severity === 'error') {
      const confirmed = await confirm({
        title: '保存存在语法错误的 JSON',
        message: '当前 JSON 存在语法错误,仍要保存吗?',
        confirmLabel: '仍要保存',
        tone: 'danger',
      });
      if (!confirmed) return;
    }
    try {
      const saved = await saveJsonFile(savedContent, current.filePath, current.title);
      if (!saved) return;
      markSaved(current.id, saved.filePath, saved.title, savedContent);
      const latest = useWorkspaceStore.getState().documents.find((document) => document.id === current.id);
      showToast(latest?.content === savedContent ? '文件已保存' : '已保存写盘快照，当前编辑仍未保存', latest?.content === savedContent ? 'success' : 'neutral');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '保存文件失败', 'error');
    }
  }, [confirm, diagnostics, markSaved, showToast]);

  const handleSaveAs = useCallback(async () => {
    const current = useWorkspaceStore.getState().documents.find(
      (document) => document.id === useWorkspaceStore.getState().activeDocumentId,
    );
    if (!current) return;
    const savedContent = current.content;
    if (!savedContent.trim()) {
      showToast('文档为空，无内容可保存', 'neutral');
      return;
    }
    const diagnostic = diagnostics[current.id];
    if (byteLength(savedContent) <= AUTO_VALIDATE_LIMIT && diagnostic?.severity === 'error') {
      const confirmed = await confirm({
        title: '保存存在语法错误的 JSON',
        message: '当前 JSON 存在语法错误,仍要保存吗?',
        confirmLabel: '仍要保存',
        tone: 'danger',
      });
      if (!confirmed) return;
    }
    try {
      const saved = await saveJsonFileAs(savedContent, current.title);
      if (!saved) return;
      markSaved(current.id, saved.filePath, saved.title, savedContent);
      showToast(
        saved.fellBackToDownload ? '浏览器不支持选择保存位置，已下载文件' : '文件已另存为',
        saved.fellBackToDownload ? 'neutral' : 'success',
      );
    } catch (error) {
      showToast(error instanceof Error ? error.message : '另存文件失败', 'error');
    }
  }, [confirm, diagnostics, markSaved, showToast]);

  const requestClose = useCallback(async (id: string) => {
    const document = useWorkspaceStore.getState().documents.find((item) => item.id === id);
    if (!document) return;
    if (isDocumentDirty(document)) {
      const confirmed = await confirm({
        title: '关闭未保存文档',
        message: `“${document.title}”有未保存更改，仍要关闭吗？`,
        confirmLabel: '仍要关闭',
        tone: 'danger',
      });
      if (!confirmed) return;
    }
    if (processing?.documentId === id) actionWorkerRef.current?.cancel(processing.requestId);
    closeDocument(id);
  }, [closeDocument, confirm, processing]);

  const runOperation = useCallback(async (operation: WorkerOperation, output: OutputMode = 'replace') => {
    const state = useWorkspaceStore.getState();
    const blocked = transformBlockedReason(state.diff, historyOpen, Boolean(processing));
    if (blocked) {
      showToast(blocked, 'neutral');
      return;
    }
    const document = state.documents.find((item) => item.id === state.activeDocumentId);
    if (!document) return;
    const source = document.content;

    const options = {
      indent: state.settings.indent,
      ...(operation === 'repair' ? { format: true } : {}),
    };
    const task = actionWorkerRef.current!.process(operation, source, options);
    setProcessing({ requestId: task.requestId, operation, documentId: document.id });
    try {
      const response = await task.response;
      if (!isCurrentDocumentSnapshot(useWorkspaceStore.getState().documents, document.id, source)) {
        showToast(`内容已更改，已丢弃过期的${operationLabels[operation]}结果`, 'neutral');
        return;
      }
      if (!response.ok) {
        setDiagnostics((current) => ({ ...current, [document.id]: response.error }));
        showToast(`${operationLabels[operation]}失败：${response.error.message}`, 'error');
        return;
      }
      // 转义/反转义的产物是裸字符串片段而非 JSON 文档，processor 对它们返回的
      // valid: true 只表示「操作本身成功」，不代表结果是合法 JSON。
      // 若照写进 metadata，状态栏会谎称「JSON 有效」，所以这两个操作交给后台校验去定性。
      const describesJsonValidity = operation !== 'escape' && operation !== 'unescape';
      if (describesJsonValidity) {
        setMetadata((current) => ({ ...current, [document.id]: response.meta }));
        setDiagnostics((current) => ({ ...current, [document.id]: response.meta.warnings?.[0] ?? null }));
      } else {
        setMetadata((current) => ({ ...current, [document.id]: undefined }));
        setDiagnostics((current) => ({ ...current, [document.id]: null }));
      }
      if (operation === 'validate' || operation === 'stats') {
        // 用 meta.empty 直接判空，而非从 valid 反推：
        // 二者当前等价，但语义独立，将来若出现「合法但有警告」之类的状态不会误报为空
        showToast(
          response.meta.valid ? 'JSON 有效' : response.meta.empty ? '文档为空' : 'JSON 无效',
          response.meta.valid ? 'success' : 'neutral',
        );
        return;
      }

      if (output !== 'new-tab') {
        addHistoryRecord({
          documentId: document.id,
          documentTitle: document.title,
          operation,
          operationLabel: operationLabels[operation],
          content: source,
          bytes: byteLength(source),
        });
      }

      if (output === 'new-tab') {
        const id = newDocument('', `${document.title} · ${operationLabels[operation]}`);
        updateContent(id, response.result);
      } else {
        setDiff(null);
        setView(document.id, 'text');
        setPendingEdit({ documentId: document.id, content: response.result, source });
      }
      showToast(`${operationLabels[operation]}完成 · ${response.meta.durationMs.toFixed(1)} ms`, 'success');
    } catch (error) {
      if (!(error instanceof WorkerCancelledError)) {
        showToast(`${operationLabels[operation]}任务异常`, 'error');
      }
    } finally {
      setProcessing((current) => current?.requestId === task.requestId ? null : current);
    }
  }, [addHistoryRecord, historyOpen, newDocument, processing, setDiff, setView, showToast, updateContent]);

  const handleFormat = useCallback(() => {
    void runOperation(useWorkspaceStore.getState().settings.sortKeys ? 'sort' : 'format');
  }, [runOperation]);

  const copyCurrent = useCallback(async () => {
    const current = useWorkspaceStore.getState().documents.find(
      (document) => document.id === useWorkspaceStore.getState().activeDocumentId,
    );
    if (!current) return;
    try {
      await writeClipboardText(current.content);
      showToast('已复制到剪贴板', 'success');
    } catch {
      showToast('剪贴板不可用', 'error');
    }
  }, [showToast]);

  const revealCurrentFile = useCallback(async () => {
    const current = useWorkspaceStore.getState().documents.find(
      (document) => document.id === useWorkspaceStore.getState().activeDocumentId,
    );
    if (!current?.filePath) return;
    try {
      await revealFileInFolder(current.filePath);
    } catch (error) {
      showToast(error instanceof Error ? error.message : '无法定位文件', 'error');
    }
  }, [showToast]);

  const handleTreeCopy = useCallback(async (value: string, label: string) => {
    try {
      await writeClipboardText(value);
      showToast(`${label}已复制`, 'success');
    } catch {
      showToast('剪贴板不可用', 'error');
    }
  }, [showToast]);

  const enterDiff = useCallback(() => {
    const state = useWorkspaceStore.getState();
    if (byteLength(state.documents.find((document) => document.id === state.activeDocumentId)?.content ?? '') > DIFF_VIEW_LIMIT) {
      showToast(`文档超过 ${formatBytes(DIFF_VIEW_LIMIT)}，已停用 Diff。可先用「压缩」缩减体积或拆分后再比较`, 'neutral');
      return;
    }
    if (state.documents.length < 2) {
      const rightId = state.newDocument('', '比较目标');
      state.setDiff({ leftId: state.activeDocumentId, rightId });
      return;
    }
    const right = state.documents.find((document) => document.id !== state.activeDocumentId)!;
    state.setDiff({ leftId: state.activeDocumentId, rightId: right.id });
  }, [showToast]);

  const setTextOrTreeView = useCallback((view: 'text' | 'tree') => {
    setHistoryOpen(false);
    const current = useWorkspaceStore.getState();
    const document = current.documents.find((item) => item.id === current.activeDocumentId);
    if (!document) return;
    current.setDiff(null);
    current.setView(document.id, view);
  }, [showToast]);

  const changeView = useCallback((view: WorkspaceView) => {
    if (view === 'history') {
      setHistoryOpen(true);
      return;
    }
    setHistoryOpen(false);
    if (view === 'diff') enterDiff();
    else setTextOrTreeView(view);
  }, [enterDiff, setTextOrTreeView]);

  const restoreHistory = useCallback(async (record: HistoryRecord) => {
    if (record.content === null) return;
    const state = useWorkspaceStore.getState();
    const target = state.documents.find((document) => document.id === record.documentId);
    let targetId = record.documentId;
    if (target) {
      if (isDocumentDirty(target) && target.content !== record.content) {
        const confirmed = await confirm({
          title: '覆盖未保存内容',
          message: `“${target.title}”有未保存更改，恢复将覆盖当前内容，仍要继续吗？`,
          confirmLabel: '仍要恢复',
          tone: 'danger',
        });
        if (!confirmed) return;
      }
      state.addHistoryRecord({
        documentId: target.id,
        documentTitle: target.title,
        operation: 'restore',
        operationLabel: '恢复',
        content: target.content,
        bytes: byteLength(target.content),
      });
      state.updateContent(target.id, record.content);
      state.setActive(target.id);
    } else {
      targetId = state.newDocument(record.content, `${record.documentTitle} · 恢复`);
    }
    state.setDiff(null);
    state.setView(targetId, 'text');
    setHistoryOpen(false);
    showToast('已恢复历史快照', 'success');
  }, [confirm, showToast]);

  const handleClearHistory = useCallback(async () => {
    const confirmed = await confirm({
      title: '清空操作历史',
      message: '确定要清空全部操作历史吗？',
      confirmLabel: '清空历史',
      tone: 'danger',
    });
    if (confirmed) clearHistory();
  }, [clearHistory, confirm]);

  const revealDiagnostic = useCallback((diagnostic: JsonDiagnostic) => {
    const state = useWorkspaceStore.getState();
    state.setDiff(null);
    state.setView(state.activeDocumentId, 'text');
    setPendingReveal({ documentId: state.activeDocumentId, offset: diagnostic.offset });
  }, []);

  const commands = useMemo<AppCommand[]>(() => [
    { id: 'new', label: '新建文档', keywords: 'new', shortcut: 'Ctrl/⌘ N', action: () => newDocument() },
    { id: 'open', label: '打开文件', keywords: 'open', shortcut: 'Ctrl/⌘ O', action: () => void handleOpen() },
    { id: 'save', label: '保存当前文档', keywords: 'save', shortcut: 'Ctrl/⌘ S', action: () => void handleSave() },
    ...(!diff && !historyOpen ? [
      { id: 'format', label: '格式化 JSON', keywords: 'format beautify', shortcut: 'Shift Alt F', action: handleFormat },
      { id: 'minify', label: '压缩 JSON', keywords: 'minify', action: () => void runOperation('minify') },
      { id: 'sort', label: '递归排序键', keywords: 'sort key', action: () => void runOperation('sort') },
      { id: 'repair', label: '确定性修复', keywords: 'repair fix', action: () => void runOperation('repair') },
      { id: 'escape', label: '转义字符串', keywords: 'escape', action: () => void runOperation('escape') },
      { id: 'unescape', label: '反转义字符串', keywords: 'unescape', action: () => void runOperation('unescape') },
    ] satisfies AppCommand[] : []),
    { id: 'tree', label: '切换到树视图', keywords: 'tree', action: () => setTextOrTreeView('tree') },
    { id: 'diff', label: '打开 JSON Diff', keywords: 'compare', action: enterDiff },
    { id: 'settings', label: '打开设置', keywords: 'preferences theme', action: openSettingsPanel },
  ], [diff, enterDiff, handleFormat, handleOpen, handleSave, historyOpen, newDocument, openSettingsPanel, runOperation, setTextOrTreeView]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        openCommandPanel();
      } else if (mod && event.shiftKey && event.key.toLowerCase() === 'e' && activeDocument?.view === 'tree' && !diff && !historyOpen) {
        event.preventDefault();
        void expandAllRows();
      } else if (mod && event.shiftKey && event.key.toLowerCase() === 'w' && activeDocument?.view === 'tree' && !diff && !historyOpen) {
        event.preventDefault();
        collapseAllRows();
      } else if (mod && event.key.toLowerCase() === 'f' && !diff && !historyOpen) {
        event.preventDefault();
        if (activeDocument?.view === 'tree') focusSearch();
        else editorRef.current?.openSearch();
      } else if (mod && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        newDocument();
      } else if (mod && event.key.toLowerCase() === 'o') {
        event.preventDefault();
        void handleOpen();
      } else if (mod && event.shiftKey && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void handleSaveAs();
      } else if (mod && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void handleSave();
      } else if (mod && event.key.toLowerCase() === 'w') {
        event.preventDefault();
        requestClose(useWorkspaceStore.getState().activeDocumentId);
      } else if (event.shiftKey && event.altKey && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        handleFormat();
      }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [activeDocument?.view, collapseAllRows, diff, expandAllRows, focusSearch, handleFormat, handleOpen, handleSave, handleSaveAs, historyOpen, newDocument, openCommandPanel, requestClose]);

  if (!activeDocument) return null;
  const activeDiagnostic = diagnostics[activeDocument.id];
  const activeMeta = metadata[activeDocument.id];
  const activeBytes = byteLength(activeDocument.content);
  const canSearch = !diff && !historyOpen;
  const transformsDisabled = Boolean(processing) || Boolean(diff) || historyOpen;
  const activeView: WorkspaceView = historyOpen ? 'history' : diff ? 'diff' : activeDocument.view;
  const activeStatus = {
    tone: activeDiagnostic?.severity === 'error'
      ? 'error' as const
      : activeDiagnostic?.severity === 'warning'
        ? 'warning' as const
        : activeDocument.content.trim() && activeMeta?.valid
          ? 'success' as const
          : 'info' as const,
    text: activeDiagnostic
      ? activeDiagnostic.message
      : activeDocument.content.trim()
        ? activeBytes > AUTO_VALIDATE_LIMIT
          ? '等待显式校验'
          : activeMeta?.valid
            ? 'JSON 有效'
            // 只在确有后台任务在跑时才说「正在校验」；否则说明校验结果尚未产生
            // （被取消、或上游未触发），说「等待校验」才不误导。
            : validatingIds.has(activeDocument.id)
              ? '正在校验'
              : '等待校验'
        : '等待输入',
    ...(activeDiagnostic ? { line: activeDiagnostic.line, column: activeDiagnostic.column } : {}),
  };
  const moreActions: MoreAction[] = [
    { id: 'escape', label: '转义字符串', icon: 'bolt', disabled: transformsDisabled, onSelect: () => void runOperation('escape') },
    { id: 'unescape', label: '反转义字符串', icon: 'bolt', disabled: transformsDisabled, onSelect: () => void runOperation('unescape') },
    ...(activeDocument.filePath ? [{ id: 'reveal', label: '在文件管理器中显示', icon: 'folder_open', onSelect: () => void revealCurrentFile() }] : []),
    { id: 'format-new-tab', label: '格式化到新标签', icon: 'note_add', disabled: transformsDisabled, onSelect: () => void runOperation('format', 'new-tab') },
    { id: 'minify-new-tab', label: '压缩到新标签', icon: 'note_add', disabled: transformsDisabled, onSelect: () => void runOperation('minify', 'new-tab') },
  ];

  return (
    <div className="app-shell">
      <AppHeader
        sidebarCollapsed={settings.sidebarCollapsed}
        onToggleSidebar={() => updateSettings({ sidebarCollapsed: !settings.sidebarCollapsed })}
        documents={documents}
        activeDocumentId={activeDocument.id}
        onSelectDocument={selectDocument}
        onCloseDocument={requestClose}
        onNewDocument={() => newDocument()}
        canSearch={canSearch}
        onSearch={() => canSearch && (activeDocument.view === 'tree' ? focusSearch() : editorRef.current?.openSearch())}
        onOpenCommandPalette={openCommandPanel}
        onOpenSettings={openSettingsPanel}
        theme={resolvedTheme}
        onToggleTheme={() => updateSettings({ theme: resolvedTheme === 'dark' ? 'light' : 'dark' })}
      />

      <div className="app-main-row">
        <Sidebar
          activeView={activeView}
          onChangeView={changeView}
          collapsed={settings.sidebarCollapsed}
          onNewDocument={() => newDocument()}
          onOpenDocs={handleOpenDocs}
        />
        <section className="center-workspace">
          <ActionBar
            onOpen={() => void handleOpen()}
            onSave={() => void handleSave()}
            onSaveAs={() => void handleSaveAs()}
            onCopyAll={() => void copyCurrent()}
            onFormat={handleFormat}
            onMinify={() => void runOperation('minify')}
            onSort={() => void runOperation('sort')}
            onRepair={() => void runOperation('repair')}
            transformsDisabled={transformsDisabled}
            disabledReason={transformBlockedReason(diff, historyOpen, Boolean(processing))}
            recentFiles={recentFiles}
            onOpenRecent={(path) => void handleOpenRecent(path)}
            status={activeStatus}
            onRevealDiagnostic={activeDiagnostic ? () => revealDiagnostic(activeDiagnostic) : undefined}
            moreActions={moreActions}
            activePanel={activePanel}
            onTogglePanel={togglePanel}
          />

          <main className="workspace">
        {historyOpen ? (
          <HistoryView history={history} onRestore={restoreHistory} onClear={() => void handleClearHistory()} />
        ) : diff ? (
          <DiffView
            documents={documents}
            leftId={diff.leftId}
            rightId={diff.rightId}
            onChangeSide={(side, id) => {
              setActive(id);
              setDiff({ ...diff, [side === 'left' ? 'leftId' : 'rightId']: id });
            }}
            onSwap={() => setDiff({ leftId: diff.rightId, rightId: diff.leftId })}
            onEdit={(id, content) => updateContent(id, content)}
          />
        ) : activeDocument.view === 'tree' ? (
          <TreeView
            ref={treeViewRef}
            root={parseResult.root}
            parseError={parseResult.parseError}
            hasDuplicates={parseResult.hasDuplicates}
            expandState={expandState}
            onExpandChange={setExpandState}
            highlightPaths={highlightPaths}
            onCopy={handleTreeCopy}
            onRevealInText={(offset) => setPendingReveal({ documentId: activeDocument.id, offset })}
          />
        ) : (
          <JsonEditor
            key={activeDocument.id}
            ref={editorRef}
            value={activeDocument.content}
            theme={resolvedTheme}
            diagnostic={activeDiagnostic}
            onChange={(content) => {
              // 内容未实际变化时直接跳过：清掉 metadata 却不触发重新校验，
              // 会让状态永久停在「正在校验」（校验 effect 依赖 content，值相同不会重跑）。
              if (content === activeDocument.content) return;
              setMetadata((current) => ({ ...current, [activeDocument.id]: undefined }));
              updateContent(activeDocument.id, content);
            }}
            onCursorChange={(line, column) => setCursor({ line, column })}
          />
        )}
          </main>

          {!historyOpen && <InfoRow
        path={activeDocument.filePath ?? activeDocument.title}
        cursor={cursor}
        bytes={activeBytes}
        nodeCount={activeMeta?.stats?.nodes ?? null}
        indent={settings.indent}
        durationMs={activeMeta?.durationMs ?? null}
        restricted={activeBytes > AUTO_VALIDATE_LIMIT}
        persistenceIssue={persistenceIssue?.message ?? null}
          />}
        </section>
        <div className="workspace-panel-layer">
          {activePanel === 'search' && (
            <SearchPanel
              input={searchInput}
              onChangeInput={setSearchInput}
              result={queryResult}
              onSelectHit={selectQueryHit}
              onClose={() => setActivePanel(null)}
            />
          )}
          {activePanel === 'schema' && (
            <div
              className="workspace-float-panel schema-panel"
              style={{ '--structure-width': `${structureWidth}px` } as CSSProperties}
            >
              <StructureResizer
                width={structureWidth}
                onWidthChange={setStructureWidth}
                onCommit={commitStructureWidth}
              />
              <StructurePanel root={parseResult.root} parseError={parseResult.parseError} />
            </div>
          )}
        </div>
      </div>

      {processing && (
        <div className="processing-banner" role="status" aria-live="polite">
          <span className="spinner" />
          <span>正在{operationLabels[processing.operation]}…</span>
          <button type="button" onClick={() => actionWorkerRef.current?.cancel(processing.requestId)}>取消</button>
        </div>
      )}
      {toast && (
        <div key={toast.id} className={`toast toast--${toast.tone}`} role="status" aria-live="polite">
          <Icon name={toast.tone === 'success' ? 'check_circle' : toast.tone === 'error' ? 'error' : 'info'} size={16} className="toast-icon" />
          <span>{toast.message}</span>
        </div>
      )}

      <CommandPalette open={commandOpen} commands={commands} onClose={() => setCommandOpen(false)} />
      <SettingsDialog open={settingsOpen} settings={settings} onChange={updateSettings} onClose={() => setSettingsOpen(false)} />
      <AboutDialog open={aboutOpen} onClose={() => setAboutOpen(false)} />
      {confirmDialog}
    </div>
  );
}
