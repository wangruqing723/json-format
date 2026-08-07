import {
  AlignJustify,
  Braces,
  Check,
  ChevronDown,
  CircleAlert,
  Clipboard,
  FilePlus2,
  FolderSearch2,
  FolderOpen,
  MoreHorizontal,
  PanelTopOpen,
  Save,
  Search,
  Settings,
  Sparkles,
  WandSparkles,
  X,
  Zap,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CommandPalette, type AppCommand } from './components/CommandPalette';
import { DiffView } from './components/DiffView';
import { JsonEditor, type JsonEditorHandle } from './components/JsonEditor';
import { SettingsDialog } from './components/SettingsDialog';
import { TreeView } from './components/TreeView';
import { isCurrentDocumentSnapshot } from './core/document-snapshot';
import { JsonWorkerClient, WorkerCancelledError } from './services/worker-client';
import {
  listenForJsonDrops,
  openJsonFiles,
  readJsonPath,
  revealFileInFolder,
  saveJsonFile,
  writeClipboardText,
  type OpenedJsonFile,
} from './services/platform';
import { isDocumentDirty, useWorkspaceStore } from './stores/workspace';
import type { JsonDiagnostic, ProcessingMeta, WorkerOperation } from './types';

const AUTO_VALIDATE_LIMIT = 10 * 1024 * 1024;
const STRUCTURED_VIEW_LIMIT = 5 * 1024 * 1024;

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

const operationLabels: Record<WorkerOperation, string> = {
  validate: '校验',
  format: '格式化',
  minify: '压缩',
  sort: '键排序',
  repair: '修复',
  escape: '转义',
  unescape: '反转义',
  stats: '统计',
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

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function App() {
  const {
    documents,
    activeDocumentId,
    diff,
    settings,
    recentFiles,
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
    flushPersistence,
  } = useWorkspaceStore();
  const activeDocument = documents.find((document) => document.id === activeDocumentId) ?? documents[0];
  const resolvedTheme = useResolvedTheme(settings.theme);
  const editorRef = useRef<JsonEditorHandle>(null);
  const recentMenuRef = useRef<HTMLDivElement>(null);
  const recentTriggerRef = useRef<HTMLButtonElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const moreTriggerRef = useRef<HTMLButtonElement>(null);
  const actionWorkerRef = useRef<JsonWorkerClient | null>(null);
  const validationWorkerRef = useRef<JsonWorkerClient | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const [diagnostics, setDiagnostics] = useState<Record<string, JsonDiagnostic | null>>({});
  const [metadata, setMetadata] = useState<Record<string, ProcessingMeta | undefined>>({});
  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  const [processing, setProcessing] = useState<ProcessingState | null>(null);
  const [pendingEdit, setPendingEdit] = useState<PendingEdit | null>(null);
  const [pendingReveal, setPendingReveal] = useState<{ documentId: string; offset: number } | null>(null);
  const [commandOpen, setCommandOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [openMenu, setOpenMenu] = useState<'recent' | 'more' | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);

  if (!actionWorkerRef.current) actionWorkerRef.current = new JsonWorkerClient();
  if (!validationWorkerRef.current) validationWorkerRef.current = new JsonWorkerClient();

  const showToast = useCallback((message: string, tone: ToastState['tone'] = 'neutral') => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    setToast({ id: Date.now(), message, tone });
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2600);
  }, []);

  const openCommandPanel = useCallback(() => {
    setOpenMenu(null);
    setSettingsOpen(false);
    setCommandOpen(true);
  }, []);

  const openSettingsPanel = useCallback(() => {
    setOpenMenu(null);
    setCommandOpen(false);
    setSettingsOpen(true);
  }, []);

  useEffect(() => {
    if (!openMenu) return;
    const menu = openMenu === 'recent' ? recentMenuRef.current : moreMenuRef.current;
    const trigger = openMenu === 'recent' ? recentTriggerRef.current : moreTriggerRef.current;
    const frame = window.requestAnimationFrame(() => menu?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus());
    const closeFromOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!recentMenuRef.current?.parentElement?.contains(target) && !moreMenuRef.current?.parentElement?.contains(target)) {
        setOpenMenu(null);
      }
    };
    const closeFromKeyboard = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpenMenu(null);
      trigger?.focus();
    };
    window.addEventListener('pointerdown', closeFromOutside);
    window.addEventListener('keydown', closeFromKeyboard);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('pointerdown', closeFromOutside);
      window.removeEventListener('keydown', closeFromKeyboard);
    };
  }, [openMenu]);

  useEffect(() => {
    if (persistenceIssue) showToast(persistenceIssue.message, 'error');
  }, [persistenceIssue, showToast]);

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.style.colorScheme = resolvedTheme;
    const themeMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    themeMeta?.setAttribute('content', resolvedTheme === 'dark' ? '#17191d' : '#f4f5f7');
  }, [resolvedTheme]);

  useEffect(() => {
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
  }, [flushPersistence]);

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

    const timer = window.setTimeout(() => {
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
      });
    }, 320);

    return () => {
      window.clearTimeout(timer);
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

  const handleOpenRecent = useCallback(async (path: string) => {
    setOpenMenu(null);
    try {
      openDocument(await readJsonPath(path));
    } catch (error) {
      removeRecentFile(path);
      showToast(error instanceof Error ? error.message : '最近文件已不可用', 'error');
    }
  }, [openDocument, removeRecentFile, showToast]);

  const handleSave = useCallback(async () => {
    const current = useWorkspaceStore.getState().documents.find(
      (document) => document.id === useWorkspaceStore.getState().activeDocumentId,
    );
    if (!current) return;
    const savedContent = current.content;
    try {
      const saved = await saveJsonFile(savedContent, current.filePath, current.title);
      if (!saved) return;
      markSaved(current.id, saved.filePath, saved.title, savedContent);
      const latest = useWorkspaceStore.getState().documents.find((document) => document.id === current.id);
      showToast(latest?.content === savedContent ? '文件已保存' : '已保存写盘快照，当前编辑仍未保存', latest?.content === savedContent ? 'success' : 'neutral');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '保存文件失败', 'error');
    }
  }, [markSaved, showToast]);

  const requestClose = useCallback((id: string) => {
    const document = useWorkspaceStore.getState().documents.find((item) => item.id === id);
    if (!document) return;
    if (isDocumentDirty(document) && !window.confirm(`“${document.title}”有未保存更改，仍要关闭吗？`)) return;
    if (processing?.documentId === id) actionWorkerRef.current?.cancel(processing.requestId);
    closeDocument(id);
  }, [closeDocument, processing]);

  const runOperation = useCallback(async (operation: WorkerOperation, output: OutputMode = 'replace') => {
    const state = useWorkspaceStore.getState();
    if (state.diff) {
      showToast('Diff 模式下已禁用内容变换，请先切换到文本视图', 'neutral');
      return;
    }
    const document = state.documents.find((item) => item.id === state.activeDocumentId);
    if (!document || processing) return;
    const source = document.content;

    const options = {
      indent: state.settings.indent,
      ...(operation === 'repair' ? { format: true } : {}),
    };
    const task = actionWorkerRef.current!.process(operation, source, options);
    setProcessing({ requestId: task.requestId, operation, documentId: document.id });
    setOpenMenu(null);

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
      setMetadata((current) => ({ ...current, [document.id]: response.meta }));
      setDiagnostics((current) => ({ ...current, [document.id]: response.meta.warnings?.[0] ?? null }));
      if (operation === 'validate' || operation === 'stats') {
        showToast(response.meta.valid ? 'JSON 有效' : '文档为空', response.meta.valid ? 'success' : 'neutral');
        return;
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
  }, [newDocument, processing, setDiff, setView, showToast, updateContent]);

  const handleFormat = useCallback(() => {
    void runOperation(useWorkspaceStore.getState().settings.sortKeys ? 'sort' : 'format');
  }, [runOperation]);

  const copyCurrent = useCallback(async () => {
    const current = useWorkspaceStore.getState().documents.find(
      (document) => document.id === useWorkspaceStore.getState().activeDocumentId,
    );
    if (!current) return;
    setOpenMenu(null);
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
    setOpenMenu(null);
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
    if (byteLength(state.documents.find((document) => document.id === state.activeDocumentId)?.content ?? '') > STRUCTURED_VIEW_LIMIT) {
      showToast('大文档暂不启用 Diff，请先压缩数据范围', 'error');
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
    const current = useWorkspaceStore.getState();
    const document = current.documents.find((item) => item.id === current.activeDocumentId);
    if (!document) return;
    if (view === 'tree' && byteLength(document.content) > STRUCTURED_VIEW_LIMIT) {
      showToast('大文档暂不启用树视图', 'error');
      return;
    }
    current.setDiff(null);
    current.setView(document.id, view);
  }, [showToast]);

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
    ...(!diff ? [
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
  ], [diff, enterDiff, handleFormat, handleOpen, handleSave, newDocument, openSettingsPanel, runOperation, setTextOrTreeView]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        openCommandPanel();
      } else if (mod && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        newDocument();
      } else if (mod && event.key.toLowerCase() === 'o') {
        event.preventDefault();
        void handleOpen();
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
  }, [handleFormat, handleOpen, handleSave, newDocument, openCommandPanel, requestClose]);

  if (!activeDocument) return null;
  const activeDiagnostic = diagnostics[activeDocument.id];
  const activeMeta = metadata[activeDocument.id];
  const activeBytes = byteLength(activeDocument.content);
  const activeDirty = isDocumentDirty(activeDocument);
  const diffLeft = diff ? documents.find((document) => document.id === diff.leftId) : null;
  const diffRight = diff ? documents.find((document) => document.id === diff.rightId) : null;
  const displayTitle = diffLeft && diffRight ? `${diffLeft.title} ↔ ${diffRight.title}` : activeDocument.title;
  const canSearch = !diff && activeDocument.view === 'text';
  const transformsDisabled = Boolean(processing) || Boolean(diff);

  return (
    <div className="app-shell">
      <header className="titlebar">
        <div className="brand" aria-label="JSON Forge">
          <span className="brand-mark"><Braces size={17} /></span>
          <strong>JSON Forge</strong>
        </div>
        <div className="title-file" title={diff ? displayTitle : activeDocument.filePath ?? activeDocument.title}>
          {displayTitle}{!diff && activeDirty ? ' •' : ''}
        </div>
        <div className="title-actions">
          <button className={`icon-button${canSearch ? '' : ' is-disabled'}`} type="button" aria-disabled={!canSearch} onClick={() => canSearch && editorRef.current?.openSearch()} data-tooltip={canSearch ? '查找 (Ctrl/⌘ F)' : '仅文本视图可查找'} aria-label="在当前文档中查找">
            <Search size={16} />
          </button>
          <button className="icon-button" type="button" onClick={openCommandPanel} data-tooltip="命令面板 (Ctrl/⌘ K)" aria-label="打开命令面板">
            <PanelTopOpen size={16} />
          </button>
          <button className="icon-button" type="button" onClick={openSettingsPanel} data-tooltip="设置" aria-label="打开设置">
            <Settings size={16} />
          </button>
        </div>
      </header>

      <nav className="tabs-row" aria-label="文档标签">
        <div className="tabs-scroll">
          {documents.map((document) => (
            <div key={document.id} className={document.id === activeDocument.id ? 'document-tab is-active' : 'document-tab'}>
              <button type="button" className="tab-select" onClick={() => setActive(document.id)} title={document.filePath ?? document.title}>
                <span className={isDocumentDirty(document) ? 'dirty-dot is-dirty' : 'dirty-dot'} />
                <span>{document.title}</span>
              </button>
              <button className="tab-close" type="button" onClick={() => requestClose(document.id)} aria-label={`关闭 ${document.title}`}>
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
        <button className="new-tab-button icon-button" type="button" onClick={() => newDocument()} data-tooltip="新建 (Ctrl/⌘ N)" aria-label="新建文档">
          <FilePlus2 size={15} />
        </button>
      </nav>

      <div className="toolbar" role="toolbar" aria-label="JSON 工具">
        <div className="toolbar-group file-actions">
          <div className="split-button-wrap">
            <button className="tool-button tool-button--compact" type="button" onClick={() => void handleOpen()} data-tooltip="打开 (Ctrl/⌘ O)" aria-label="打开 (Ctrl/⌘ O)">
              <FolderOpen size={16} /><span>打开</span>
            </button>
            <button ref={recentTriggerRef} className="split-trigger icon-button" type="button" onClick={() => setOpenMenu((open) => open === 'recent' ? null : 'recent')} data-tooltip="最近文件" aria-label="最近文件" aria-haspopup="menu" aria-expanded={openMenu === 'recent'}>
              <ChevronDown size={13} />
            </button>
            {openMenu === 'recent' && (
              <div ref={recentMenuRef} className="popover recent-menu" role="menu" aria-label="最近文件">
                <div className="popover-label">最近文件</div>
                {recentFiles.length ? recentFiles.map((file) => (
                  <button key={file.path} type="button" role="menuitem" onClick={() => void handleOpenRecent(file.path)} title={file.path}>{file.name}</button>
                )) : <span className="popover-empty" role="status">暂无最近文件</span>}
              </div>
            )}
          </div>
          <button className="tool-button tool-button--compact" type="button" onClick={() => void handleSave()} data-tooltip="保存 (Ctrl/⌘ S)" aria-label="保存 (Ctrl/⌘ S)">
            <Save size={16} /><span>保存</span>
          </button>
        </div>
        <span className="toolbar-divider" />
        <div className="toolbar-group transform-actions">
          <button className={`tool-button tool-button--primary${transformsDisabled ? ' is-disabled' : ''}`} type="button" aria-disabled={transformsDisabled} onClick={handleFormat} data-tooltip={diff ? 'Diff 模式下不可变换' : '格式化 (Shift+Alt+F)'} aria-label="格式化 (Shift+Alt+F)">
            <Sparkles size={16} /><span>格式化</span>
          </button>
          <button className={`tool-button${transformsDisabled ? ' is-disabled' : ''}`} type="button" aria-disabled={transformsDisabled} onClick={() => void runOperation('minify')} data-tooltip={diff ? 'Diff 模式下不可变换' : '移除无关空白'} aria-label="压缩 JSON">
            <AlignJustify size={16} /><span>压缩</span>
          </button>
          <button className={`tool-button toolbar-secondary${transformsDisabled ? ' is-disabled' : ''}`} type="button" aria-disabled={transformsDisabled} onClick={() => void runOperation('sort')} data-tooltip={diff ? 'Diff 模式下不可变换' : '递归排序对象键'} aria-label="递归排序对象键">
            <Braces size={16} /><span>键排序</span>
          </button>
          <button className={`tool-button toolbar-secondary${transformsDisabled ? ' is-disabled' : ''}`} type="button" aria-disabled={transformsDisabled} onClick={() => void runOperation('repair')} data-tooltip={diff ? 'Diff 模式下不可变换' : '使用确定性规则修复'} aria-label="使用确定性规则修复">
            <WandSparkles size={16} /><span>修复</span>
          </button>
        </div>
        <div className="toolbar-spacer" />
        <div className="segmented-control view-switch" aria-label="视图模式">
          <button type="button" className={!diff && activeDocument.view === 'text' ? 'is-active' : ''} aria-pressed={!diff && activeDocument.view === 'text'} onClick={() => setTextOrTreeView('text')}>文本</button>
          <button type="button" className={!diff && activeDocument.view === 'tree' ? 'is-active' : ''} aria-pressed={!diff && activeDocument.view === 'tree'} onClick={() => setTextOrTreeView('tree')}>树</button>
          <button type="button" className={diff ? 'is-active' : ''} aria-pressed={Boolean(diff)} onClick={enterDiff}>Diff</button>
        </div>
        <div className="more-wrap">
          <button ref={moreTriggerRef} className="icon-button" type="button" onClick={() => setOpenMenu((open) => open === 'more' ? null : 'more')} data-tooltip="更多操作" aria-label="更多操作" aria-haspopup="menu" aria-expanded={openMenu === 'more'}>
            <MoreHorizontal size={18} />
          </button>
          {openMenu === 'more' && (
            <div ref={moreMenuRef} className="popover more-menu" role="menu" aria-label="更多操作">
              <button type="button" role="menuitem" disabled={Boolean(diff)} onClick={() => void runOperation('escape')}><Zap size={14} />转义字符串</button>
              <button type="button" role="menuitem" disabled={Boolean(diff)} onClick={() => void runOperation('unescape')}><Zap size={14} />反转义字符串</button>
              <button type="button" role="menuitem" onClick={() => void copyCurrent()}><Clipboard size={14} />复制活动标签全文</button>
              {activeDocument.filePath && <button type="button" role="menuitem" onClick={() => void revealCurrentFile()}><FolderSearch2 size={14} />在文件管理器中显示</button>}
              <span className="menu-divider" />
              <button type="button" role="menuitem" disabled={Boolean(diff)} onClick={() => void runOperation('format', 'new-tab')}><FilePlus2 size={14} />格式化到新标签</button>
              <button type="button" role="menuitem" disabled={Boolean(diff)} onClick={() => void runOperation('minify', 'new-tab')}><FilePlus2 size={14} />压缩到新标签</button>
            </div>
          )}
        </div>
      </div>

      <main className="workspace">
        {diff ? (
          <DiffView
            documents={documents}
            leftId={diff.leftId}
            rightId={diff.rightId}
            onChangeSide={(side, id) => {
              setActive(id);
              setDiff({ ...diff, [side === 'left' ? 'leftId' : 'rightId']: id });
            }}
            onSwap={() => setDiff({ leftId: diff.rightId, rightId: diff.leftId })}
          />
        ) : activeDocument.view === 'tree' ? (
          <TreeView source={activeDocument.content} onCopy={handleTreeCopy} />
        ) : (
          <JsonEditor
            key={activeDocument.id}
            ref={editorRef}
            value={activeDocument.content}
            theme={resolvedTheme}
            diagnostic={activeDiagnostic}
            onChange={(content) => {
              setMetadata((current) => ({ ...current, [activeDocument.id]: undefined }));
              updateContent(activeDocument.id, content);
            }}
            onCursorChange={(line, column) => setCursor({ line, column })}
          />
        )}
      </main>

      <footer className="statusbar">
        <div className={activeDiagnostic?.severity === 'error' ? 'status-validity is-error' : activeDiagnostic?.severity === 'warning' ? 'status-validity is-warning' : 'status-validity is-valid'} aria-live="polite">
          {activeDiagnostic?.severity === 'error' ? <CircleAlert size={13} /> : <Check size={13} />}
          <span>{activeDiagnostic
            ? activeDiagnostic.message
            : activeDocument.content.trim()
              ? activeBytes > AUTO_VALIDATE_LIMIT
                ? '等待显式校验'
                : activeMeta?.valid
                  ? 'JSON 有效'
                  : '正在校验'
              : '等待输入'}</span>
          {activeDiagnostic && <button type="button" onClick={() => revealDiagnostic(activeDiagnostic)}>行 {activeDiagnostic.line}:{activeDiagnostic.column}</button>}
        </div>
        <div className="status-spacer" />
        {persistenceIssue && <span className="status-warning" title={persistenceIssue.message}>会话内容未持久化</span>}
        {activeBytes > AUTO_VALIDATE_LIMIT && <span className="status-warning">受限模式</span>}
        {activeMeta?.stats && <span>{activeMeta.stats.nodes.toLocaleString()} 节点</span>}
        <span>行 {cursor.line}，列 {cursor.column}</span>
        <span>{formatBytes(activeBytes)}</span>
        <span>{settings.indent === 'tab' ? 'Tab' : `${settings.indent} 空格`}</span>
        <span>UTF-8</span>
        {activeMeta && <span>{activeMeta.durationMs.toFixed(1)} ms</span>}
      </footer>

      {processing && (
        <div className="processing-banner" role="status" aria-live="polite">
          <span className="spinner" />
          <span>正在{operationLabels[processing.operation]}…</span>
          <button type="button" onClick={() => actionWorkerRef.current?.cancel(processing.requestId)}>取消</button>
        </div>
      )}
      {toast && <div key={toast.id} className={`toast toast--${toast.tone}`} role="status" aria-live="polite">{toast.message}</div>}

      <CommandPalette open={commandOpen} commands={commands} onClose={() => setCommandOpen(false)} />
      <SettingsDialog open={settingsOpen} settings={settings} onChange={updateSettings} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
