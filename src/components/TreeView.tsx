import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { JsonNode } from '../core/json-parser';
import { minifyJsonNode } from '../core/json-transform';
import {
  collapseAll,
  collapseSubtree,
  countVisibleRows,
  expandAll,
  expandSubtree,
  flattenTree,
  isExpanded,
  toggleExpand,
  type ExpandState,
  type FlatRow,
} from '../core/tree-flatten';
import { useConfirm } from './ConfirmDialog';
import { Icon } from './Icon';

export const EXPAND_ALL_CONFIRM_ROWS = 50_000;
const ROW_HEIGHT = 28;
const OVERSCAN = 8;

export interface TreeViewProps {
  root: JsonNode | null;
  parseError: string | null;
  hasDuplicates: boolean;
  expandState: ExpandState;
  onExpandChange: (next: ExpandState) => void;
  highlightPaths: ReadonlySet<string>;
  onCopy: (value: string, label: string) => void;
  onRevealInText?: (offset: number) => void;
}

export interface TreeViewHandle {
  scrollToPath: (path: string) => void;
  scrollToIndex: (index: number) => void;
}

function isContainer(node: JsonNode): boolean {
  return node.type === 'object' || node.type === 'array';
}

function summary(node: JsonNode): string {
  if (node.type === 'array') return `Array(${node.items.length})`;
  if (node.type === 'object') return `Object(${node.entries.length})`;
  return node.raw;
}

function copyValue(node: JsonNode): string {
  if (node.type === 'string') return node.value as string;
  return minifyJsonNode(node);
}

interface VirtualWindow {
  scrollRef: (element: HTMLDivElement | null) => void;
  scrollToIndex: (index: number) => void;
  rows: Array<{ row: FlatRow; index: number }>;
  totalSize: number;
}

function useVirtualWindow(rows: FlatRow[]): VirtualWindow {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const [windowState, setWindowState] = useState({ scrollTop: 0, height: 420 });

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    const update = () => {
      const rect = element.getBoundingClientRect();
      const height = element.clientHeight || rect.height || 420;
      setWindowState({ scrollTop: element.scrollTop, height });
    };
    update();
    element.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      element.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [rows.length]);

  const start = Math.max(0, Math.floor(windowState.scrollTop / ROW_HEIGHT) - OVERSCAN);
  const end = Math.min(
    rows.length,
    Math.ceil((windowState.scrollTop + windowState.height) / ROW_HEIGHT) + OVERSCAN,
  );
  const visible = rows.slice(start, end).map((row, offset) => ({ row, index: start + offset }));
  const scrollToIndex = useCallback((index: number) => {
    const element = elementRef.current;
    if (!element) return;
    const height = element.clientHeight || element.getBoundingClientRect().height || 420;
    const top = Math.max(0, Math.min(index * ROW_HEIGHT, rows.length * ROW_HEIGHT - height));
    element.scrollTop = top;
    setWindowState((current) => ({ ...current, scrollTop: top }));
  }, [rows.length]);

  return {
    scrollRef: (element) => { elementRef.current = element; },
    scrollToIndex,
    rows: visible.length > 0 ? visible : rows.slice(0, Math.min(rows.length, OVERSCAN * 2)).map((row, index) => ({ row, index })),
    totalSize: rows.length * ROW_HEIGHT,
  };
}

interface TreeRowProps {
  row: FlatRow;
  index: number;
  expandState: ExpandState;
  onExpandChange: (next: ExpandState) => void;
  highlightPaths: ReadonlySet<string>;
  onCopy: TreeViewProps['onCopy'];
}

const TreeRow = memo(function TreeRow({
  row,
  index,
  expandState,
  onExpandChange,
  highlightPaths,
  onCopy,
}: TreeRowProps) {
  const container = isContainer(row.node);
  const canOperate = container;
  const expanded = row.kind === 'open';
  const handleToggle = () => {
    if (!canOperate) return;
    onExpandChange(toggleExpand(expandState, row.path, row.depth));
  };
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      const visibleRows = Array.from(event.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[data-tree-row]') ?? []);
      const currentIndex = visibleRows.indexOf(event.currentTarget);
      const nextIndex = currentIndex + (event.key === 'ArrowUp' ? -1 : 1);
      visibleRows[nextIndex]?.focus();
      return;
    }
    if (!canOperate || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
    event.preventDefault();
    if (event.shiftKey) {
      onExpandChange(event.key === 'ArrowRight'
        ? expandSubtree(expandState, row.path)
        : collapseSubtree(expandState, row.path));
      return;
    }
    const shouldExpand = event.key === 'ArrowRight';
    if (expanded !== shouldExpand) onExpandChange(toggleExpand(expandState, row.path, row.depth));
  };

  return (
    <div
      className={`tree-flat-row${highlightPaths.has(row.path) ? ' is-highlighted' : ''}`}
      style={{ position: 'absolute', top: index * ROW_HEIGHT, width: '100%', height: ROW_HEIGHT }}
      data-tree-row
      data-row-index={index}
      role="listitem"
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <div className="tree-row" style={{ '--tree-depth': row.depth } as React.CSSProperties}>
        {canOperate ? (
          <button
            className="tree-toggle icon-button"
            type="button"
            onClick={handleToggle}
            aria-expanded={expanded}
            aria-label={expanded ? `折叠 ${row.label}` : `展开 ${row.label}`}
          >
            <Icon name={expanded ? 'expand_more' : 'chevron_right'} size={14} />
          </button>
        ) : <span className="tree-spacer" />}
        <button
          className="tree-path"
          type="button"
          data-tooltip={row.ambiguous ? '重复键路径不唯一' : `复制路径 ${row.path}`}
          disabled={row.ambiguous}
          onClick={() => onCopy(row.path, '路径')}
        >
          {row.label}
        </button>
        <span className={`tree-value tree-value--${row.node.type}`}>{summary(row.node)}</span>
        {canOperate && (
          <span className="tree-subtree-actions">
            <button
              className="icon-button tree-subtree-button"
              type="button"
              aria-label={`展开子树 ${row.label}`}
              data-tooltip="展开子树 (Shift →)"
              onClick={() => onExpandChange(expandSubtree(expandState, row.path))}
            >
              <Icon name="expand_more" size={13} />
            </button>
            <button
              className="icon-button tree-subtree-button"
              type="button"
              aria-label={`收起子树 ${row.label}`}
              data-tooltip="收起子树 (Shift ←)"
              onClick={() => onExpandChange(collapseSubtree(expandState, row.path))}
            >
              <Icon name="chevron_right" size={13} />
            </button>
          </span>
        )}
        <button
          type="button"
          className="tree-copy icon-button"
          data-tooltip="复制保真值"
          aria-label={`复制 ${row.label} 的值`}
          onClick={() => onCopy(copyValue(row.node), '值')}
        >
          <Icon name="content_copy" size={13} />
        </button>
      </div>
    </div>
  );
});

export const TreeView = forwardRef<TreeViewHandle, TreeViewProps>(function TreeView({
  root,
  parseError,
  hasDuplicates,
  expandState,
  onExpandChange,
  highlightPaths,
  onCopy,
}: TreeViewProps, ref) {
  const { confirm, dialog: confirmDialog } = useConfirm();
  const rows = useMemo(() => root ? flattenTree(root, expandState) : [], [expandState, root]);
  const virtual = useVirtualWindow(rows);

  useImperativeHandle(ref, () => ({
    scrollToIndex: virtual.scrollToIndex,
    scrollToPath: (path) => {
      const index = rows.findIndex((row) => row.path === path);
      if (index >= 0) virtual.scrollToIndex(index);
    },
  }), [rows, virtual.scrollToIndex]);

  const requestExpandAll = async () => {
    if (!root) return;
    const next = expandAll(expandState);
    const count = countVisibleRows(root, next);
    if (count > EXPAND_ALL_CONFIRM_ROWS) {
      const confirmed = await confirm({
        title: '展开全部节点',
        message: `全部展开后预计有 ${count.toLocaleString()} 行，可能占用较多内存。仍要继续吗？`,
        confirmLabel: '展开全部',
      });
      if (!confirmed) return;
    }
    onExpandChange(next);
  };

  if (parseError || !root) {
    return (
      <div className="view-empty" role="status">
        <Icon name="data_object" size={28} />
        <strong>树视图不可用</strong>
        <span>{parseError ?? '修正 JSON 错误后即可浏览节点。'}</span>
      </div>
    );
  }

  return (
    <div className="tree-view" aria-label="JSON 树">
      <div className="tree-toolbar" role="toolbar" aria-label="树视图操作">
        <span className="tree-toolbar-title">树视图</span>
        <button type="button" className="secondary-button tree-toolbar-button" onClick={() => void requestExpandAll()}>
          <Icon name="expand_more" size={14} />全部展开
        </button>
        <button type="button" className="secondary-button tree-toolbar-button" onClick={() => onExpandChange(collapseAll(expandState))}>
          <Icon name="chevron_right" size={14} />全部收起
        </button>
      </div>
      {hasDuplicates && (
        <div className="tree-warning" role="status">
          <Icon name="warning" size={14} />
          <span>检测到重复键：全部值均保留显示，重复键路径复制已禁用。</span>
        </div>
      )}
      <div ref={virtual.scrollRef} className="tree-virtual-scroll" role="list">
        <div className="tree-virtual-content" style={{ height: virtual.totalSize }}>
          {virtual.rows.map(({ row, index }) => (
            <TreeRow
              key={`${index}-${row.path}-${row.kind}`}
              row={row}
              index={index}
              expandState={expandState}
              onExpandChange={onExpandChange}
              highlightPaths={highlightPaths}
              onCopy={onCopy}
            />
          ))}
        </div>
      </div>
      {confirmDialog}
    </div>
  );
});

TreeView.displayName = 'TreeView';
