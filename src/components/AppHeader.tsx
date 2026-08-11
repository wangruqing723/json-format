import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import type { DocumentId, JsonDocument } from '../types';
import { Icon } from './Icon';

export type WorkspaceView = 'text' | 'tree' | 'diff' | 'history';

export interface AppHeaderProps {
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  documents: JsonDocument[];
  activeDocumentId: string;
  onSelectDocument: (id: string) => void;
  onCloseDocument: (id: string) => void;
  onReorderDocument: (id: DocumentId, targetIndex: number) => void;
  onNewDocument: () => void;
  canSearch: boolean;
  onSearch: () => void;
  onOpenCommandPalette: () => void;
  onOpenSettings: () => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
}

export function AppHeader({
  sidebarCollapsed,
  onToggleSidebar,
  documents,
  activeDocumentId,
  onSelectDocument,
  onCloseDocument,
  onReorderDocument,
  onNewDocument,
  canSearch,
  onSearch,
  onOpenCommandPalette,
  onOpenSettings,
  theme,
  onToggleTheme,
}: AppHeaderProps) {
  const tabsRef = useRef<HTMLDivElement>(null);
  const draggedIdRef = useRef<DocumentId | null>(null);
  const dropTargetRef = useRef<{ id: DocumentId; edge: 'before' | 'after' } | null>(null);
  const pointerXRef = useRef<number | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const [draggedId, setDraggedId] = useState<DocumentId | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    id: DocumentId;
    edge: 'before' | 'after';
  } | null>(null);

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

  const clearDragState = useCallback(() => {
    draggedIdRef.current = null;
    dropTargetRef.current = null;
    setDraggedId(null);
    setDropTarget(null);
    stopAutoScroll();
  }, [stopAutoScroll]);

  useEffect(() => stopAutoScroll, [stopAutoScroll]);

  const handleDragStart = (event: DragEvent<HTMLButtonElement>, id: DocumentId) => {
    draggedIdRef.current = id;
    setDraggedId(id);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-json-forge-tab', id);
    event.dataTransfer.setData('text/plain', id);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>, id: DocumentId) => {
    if (!draggedIdRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    const rect = event.currentTarget.getBoundingClientRect();
    const target = {
      id,
      edge: event.clientX < rect.left + rect.width / 2 ? 'before' as const : 'after' as const,
    };
    dropTargetRef.current = target;
    setDropTarget(target);
    updateAutoScroll(event.clientX);
  };

  const handleTabsDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!draggedIdRef.current || event.target !== event.currentTarget) return;
    const lastDocument = documents.at(-1);
    if (!lastDocument) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    const target = { id: lastDocument.id, edge: 'after' as const };
    dropTargetRef.current = target;
    setDropTarget(target);
    updateAutoScroll(event.clientX);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    const sourceId = draggedIdRef.current;
    event.preventDefault();
    event.stopPropagation();
    const target = dropTargetRef.current;
    if (sourceId && target) {
      const sourceIndex = documents.findIndex((document) => document.id === sourceId);
      const hoverIndex = documents.findIndex((document) => document.id === target.id);
      if (sourceIndex >= 0 && hoverIndex >= 0) {
        const boundary = hoverIndex + (target.edge === 'after' ? 1 : 0);
        const targetIndex = boundary - (sourceIndex < boundary ? 1 : 0);
        onReorderDocument(sourceId, targetIndex);
      }
    }
    clearDragState();
  };

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
          <div
            ref={tabsRef}
            className="tabs-scroll"
            onDragOver={handleTabsDragOver}
            onDrop={handleDrop}
          >
            {documents.map((document) => (
              <div
                key={document.id}
                className={`document-tab${document.id === activeDocumentId ? ' is-active' : ''}${draggedId === document.id ? ' is-dragging' : ''}${dropTarget?.id === document.id ? ` drop-${dropTarget.edge}` : ''}`}
                onDragOver={(event) => handleDragOver(event, document.id)}
              >
                <button
                  type="button"
                  className="tab-select"
                  draggable
                  onDragStart={(event) => handleDragStart(event, document.id)}
                  onDragEnd={clearDragState}
                  onClick={() => onSelectDocument(document.id)}
                  title={document.filePath ?? document.title}
                >
                  <span className={document.savedContent !== document.content ? 'dirty-dot is-dirty' : 'dirty-dot'} />
                  <span>{document.title}</span>
                </button>
                <button className="tab-close" type="button" draggable={false} onDragStart={(event) => event.preventDefault()} onClick={() => onCloseDocument(document.id)} aria-label={`关闭 ${document.title}`}>
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
          <button className={`icon-button${canSearch ? '' : ' is-disabled'}`} type="button" aria-disabled={!canSearch} onClick={onSearch} data-tooltip={canSearch ? '查找 (Ctrl/⌘ F)' : '当前视图不可查找'} aria-label="查找">
            <Icon name="search" size={17} />
          </button>
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
