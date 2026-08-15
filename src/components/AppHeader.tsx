import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { DocumentId, JsonDocument } from '../types';
import { Icon } from './Icon';

export type WorkspaceView = 'edit' | 'diff' | 'history';

export interface AppHeaderProps {
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  documents: JsonDocument[];
  activeDocumentId: string;
  onSelectDocument: (id: string) => void;
  onCloseDocument: (id: string) => void;
  onReorderDocument: (id: DocumentId, targetIndex: number) => void;
  onNewDocument: () => void;
  onOpenCommandPalette: () => void;
  onOpenSettings: () => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
}

type DropTarget = { id: DocumentId; edge: 'before' | 'after' };
type PendingPointer = { id: DocumentId; startX: number };

export function AppHeader({
  sidebarCollapsed,
  onToggleSidebar,
  documents,
  activeDocumentId,
  onSelectDocument,
  onCloseDocument,
  onReorderDocument,
  onNewDocument,
  onOpenCommandPalette,
  onOpenSettings,
  theme,
  onToggleTheme,
}: AppHeaderProps) {
  const tabsRef = useRef<HTMLDivElement>(null);
  const pendingPointerRef = useRef<PendingPointer | null>(null);
  const draggedIdRef = useRef<DocumentId | null>(null);
  const dropTargetRef = useRef<DropTarget | null>(null);
  const pointerXRef = useRef<number | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const pointerListenersCleanupRef = useRef<(() => void) | null>(null);
  const suppressClickRef = useRef(false);
  const suppressClickTimerRef = useRef<number | null>(null);
  const [draggedId, setDraggedId] = useState<DocumentId | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);

  const stopAutoScroll = useCallback(() => {
    if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
    scrollFrameRef.current = null;
    pointerXRef.current = null;
  }, []);

  const runAutoScroll = useCallback(() => {
    const container = tabsRef.current;
    const pointerX = pointerXRef.current;
    if (!container || pointerX === null) {
      scrollFrameRef.current = null;
      return;
    }
    const rect = container.getBoundingClientRect();
    const edgeSize = Math.min(48, rect.width / 3);
    const leftDistance = pointerX - rect.left;
    const rightDistance = rect.right - pointerX;
    let speed = 0;
    if (leftDistance < edgeSize) speed = -Math.ceil((edgeSize - leftDistance) / 4);
    else if (rightDistance < edgeSize) speed = Math.ceil((edgeSize - rightDistance) / 4);
    if (speed !== 0) container.scrollLeft += Math.max(-12, Math.min(12, speed));
    scrollFrameRef.current = requestAnimationFrame(runAutoScroll);
  }, []);

  const updateAutoScroll = useCallback((clientX: number) => {
    pointerXRef.current = clientX;
    if (scrollFrameRef.current === null) {
      scrollFrameRef.current = requestAnimationFrame(runAutoScroll);
    }
  }, [runAutoScroll]);

  const updateDropTarget = useCallback((clientX: number, shouldScroll = true) => {
    const container = tabsRef.current;
    if (!container || !documents.length) return;

    const tabs = Array.from(container.querySelectorAll<HTMLElement>('.document-tab'));
    let targetIndex = tabs.findIndex((tab) => {
      const rect = tab.getBoundingClientRect();
      return clientX >= rect.left && clientX <= rect.right;
    });

    if (targetIndex < 0) {
      targetIndex = tabs.findIndex((tab) => clientX < tab.getBoundingClientRect().left);
      if (targetIndex < 0) targetIndex = documents.length - 1;
    }

    const targetTab = tabs[targetIndex];
    const targetDocument = documents[targetIndex];
    if (!targetTab || !targetDocument) return;

    const rect = targetTab.getBoundingClientRect();
    const target: DropTarget = {
      id: targetDocument.id,
      edge: clientX < rect.left + rect.width / 2 ? 'before' : 'after',
    };
    dropTargetRef.current = target;
    setDropTarget(target);
    if (shouldScroll) updateAutoScroll(clientX);
  }, [documents, updateAutoScroll]);

  const clearPointerListeners = useCallback(() => {
    const cleanup = pointerListenersCleanupRef.current;
    pointerListenersCleanupRef.current = null;
    cleanup?.();
  }, []);

  const clearDragState = useCallback(() => {
    pendingPointerRef.current = null;
    draggedIdRef.current = null;
    dropTargetRef.current = null;
    setDraggedId(null);
    setDropTarget(null);
    stopAutoScroll();
    clearPointerListeners();
  }, [clearPointerListeners, stopAutoScroll]);

  const suppressNextClick = useCallback(() => {
    suppressClickRef.current = true;
    if (suppressClickTimerRef.current !== null) {
      window.clearTimeout(suppressClickTimerRef.current);
    }
    suppressClickTimerRef.current = window.setTimeout(() => {
      suppressClickRef.current = false;
      suppressClickTimerRef.current = null;
    }, 0);
  }, []);

  const commitDrop = useCallback((sourceId: DocumentId, target: DropTarget | null) => {
    if (!target) return;
    const sourceIndex = documents.findIndex((document) => document.id === sourceId);
    const hoverIndex = documents.findIndex((document) => document.id === target.id);
    if (sourceIndex < 0 || hoverIndex < 0) return;

    const boundary = hoverIndex + (target.edge === 'after' ? 1 : 0);
    const targetIndex = boundary - (sourceIndex < boundary ? 1 : 0);
    onReorderDocument(sourceId, targetIndex);
  }, [documents, onReorderDocument]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>, id: DocumentId) => {
    if (event.button !== 0) return;
    clearDragState();
    pendingPointerRef.current = { id, startX: event.clientX };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const pending = pendingPointerRef.current;
      if (!pending) return;
      if (!draggedIdRef.current && Math.abs(moveEvent.clientX - pending.startX) <= 4) return;
      if (!draggedIdRef.current) {
        draggedIdRef.current = pending.id;
        setDraggedId(pending.id);
      }
      moveEvent.preventDefault();
      updateDropTarget(moveEvent.clientX);
    };

    const handlePointerUp = (upEvent: PointerEvent) => {
      const sourceId = draggedIdRef.current;
      if (sourceId) {
        upEvent.preventDefault();
        updateDropTarget(upEvent.clientX, false);
        suppressNextClick();
        commitDrop(sourceId, dropTargetRef.current);
      }
      clearDragState();
    };

    const handlePointerCancel = () => clearDragState();
    const handleKeyDown = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key !== 'Escape') return;
      keyEvent.preventDefault();
      clearDragState();
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);
    window.addEventListener('keydown', handleKeyDown);
    pointerListenersCleanupRef.current = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
      window.removeEventListener('keydown', handleKeyDown);
    };
  };

  const handleTabClick = (id: DocumentId) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      if (suppressClickTimerRef.current !== null) {
        window.clearTimeout(suppressClickTimerRef.current);
        suppressClickTimerRef.current = null;
      }
      return;
    }
    onSelectDocument(id);
  };

  useEffect(() => () => {
    clearDragState();
    if (suppressClickTimerRef.current !== null) window.clearTimeout(suppressClickTimerRef.current);
  }, [clearDragState]);

  return (
    <header className={`app-header${sidebarCollapsed ? ' is-sidebar-collapsed' : ''}`}>
      <div className="header-topline">
        <div className="header-sidebar-slot">
          <div className="header-brand" aria-label="JSON Forge">
            <span className="header-brand-mark"><Icon name="data_object" size={17} /></span>
            <span className="header-brand-text">JSON Forge</span>
          </div>
          <button
            className="icon-button header-sidebar-toggle"
            type="button"
            onClick={onToggleSidebar}
            aria-label={sidebarCollapsed ? '展开侧栏' : '折叠侧栏'}
            data-tooltip={sidebarCollapsed ? '展开侧栏' : '折叠侧栏'}
          >
            <Icon name={sidebarCollapsed ? 'chevron_right' : 'chevron_left'} size={16} />
          </button>
        </div>
        <div className="header-documents" aria-label="文档标签">
          <div ref={tabsRef} className="tabs-scroll">
            {documents.map((document) => (
              <div
                key={document.id}
                className={`document-tab${document.id === activeDocumentId ? ' is-active' : ''}${draggedId === document.id ? ' is-dragging' : ''}${dropTarget?.id === document.id ? ` drop-${dropTarget.edge}` : ''}`}
              >
                <button
                  type="button"
                  className="tab-select"
                  onPointerDown={(event) => handlePointerDown(event, document.id)}
                  onClick={() => handleTabClick(document.id)}
                  title={document.filePath ?? document.title}
                >
                  <span className={document.savedContent !== document.content ? 'dirty-dot is-dirty' : 'dirty-dot'} />
                  <span>{document.title}</span>
                </button>
                <button className="tab-close" type="button" onClick={() => onCloseDocument(document.id)} aria-label={`关闭 ${document.title}`}>
                  <Icon name="close" size={13} />
                </button>
              </div>
            ))}
          </div>
          <button className="new-tab-button icon-button" type="button" onClick={onNewDocument} data-tooltip="新建 (Ctrl/⌘ N)" aria-label="新建文档">
            <Icon name="note_add" size={15} />
          </button>
        </div>
        <div className="title-actions">
          <button className="icon-button" type="button" onClick={onOpenCommandPalette} data-tooltip="命令面板 (Ctrl/⌘ K)" aria-label="打开命令面板">
            <Icon name="bottom_panel_open" size={17} />
          </button>
          <button className="icon-button" type="button" onClick={onToggleTheme} data-tooltip={theme === 'dark' ? '切换浅色主题' : '切换深色主题'} aria-label={theme === 'dark' ? '切换浅色主题' : '切换深色主题'}>
            <Icon name={theme === 'dark' ? 'light_mode' : 'dark_mode'} size={17} />
          </button>
          <button className="icon-button" type="button" onClick={onOpenSettings} data-tooltip="设置" aria-label="打开设置">
            <Icon name="settings" size={17} />
          </button>
        </div>
      </div>
    </header>
  );
}
