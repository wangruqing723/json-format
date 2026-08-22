import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { JsonNode } from '../core/json-parser';
import { externalUrlFromNode } from '../core/json-url';
import { minifyJsonNode } from '../core/json-transform';
import {
  collapseSubtree,
  expandSubtree,
  flattenTree,
  isExpanded,
  isSubtreeFullyExpanded,
  toggleExpand,
  type ExpandState,
  type FlatRow,
} from '../core/tree-flatten';
import { beginSpan } from '../services/perf-probe';
import { openExternalUrl } from '../services/platform';
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
  hiddenPaths: ReadonlySet<string>;
  onHide: (path: string) => void;
  onRestoreHidden: () => void;
  selectedPath: string | null;
  onSelectPath: (path: string) => void;
  onDownloadNode: (path: string, node: JsonNode) => void;
  allowRemoteImages: boolean;
  onOpenExternal?: (url: string) => void;
}

export interface TreeViewHandle {
  scrollToPath: (path: string) => void;
  scrollToIndex: (index: number) => void;
}

function isContainer(node: JsonNode): boolean {
  return node.type === 'object' || node.type === 'array';
}

function containerCount(node: JsonNode): number {
  return node.type === 'array' ? node.items.length : node.type === 'object' ? node.entries.length : 0;
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
    // 树现在活在可拖拽的分栏里：拖分隔条改变本栏高度时不会触发 window.resize，
    // 只靠 window.resize 会让虚拟窗口沿用旧高度，只渲染旧高度内的行，
    // 下方留出一片没有行的空白（看起来像被遮罩盖住）。用 ResizeObserver 直接盯滚动容器本身。
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    observer?.observe(element);
    return () => {
      element.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      observer?.disconnect();
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
  onHide: TreeViewProps['onHide'];
  onSelectPath: TreeViewProps['onSelectPath'];
  onDownloadNode: TreeViewProps['onDownloadNode'];
  allowRemoteImages: boolean;
  onOpenExternal?: TreeViewProps['onOpenExternal'];
  selectedPath: string | null;
  hiddenPaths: ReadonlySet<string>;
}

const failedImageUrls = new Set<string>();

function rowKeyLabel(row: FlatRow): string {
  if (row.path === '$') return '$';
  return row.label.startsWith('[') ? row.label : JSON.stringify(row.label);
}

function valueText(node: JsonNode): string {
  if (node.type === 'string') return JSON.stringify(node.value);
  if (node.type === 'number' || node.type === 'boolean' || node.type === 'null') return node.raw;
  return '';
}

const TreeRow = memo(function TreeRow({
  row,
  index,
  expandState,
  onExpandChange,
  highlightPaths,
  onCopy,
  onHide,
  onSelectPath,
  onDownloadNode,
  allowRemoteImages,
  onOpenExternal,
  selectedPath,
  hiddenPaths,
}: TreeRowProps) {
  const imageTimerRef = useRef<number | null>(null);
  const [showImage, setShowImage] = useState(false);
  const container = isContainer(row.node);
  const close = row.kind === 'close';
  const canOperate = container;
  const expanded = row.kind === 'open';
  const subtreeExpanded = canOperate
    && isSubtreeFullyExpanded(expandState, row.node, row.path, row.depth, hiddenPaths);
  const handleToggle = () => {
    if (!canOperate) return;
    onExpandChange(toggleExpand(expandState, row.path, row.depth));
  };
  const fullValue = close ? '' : copyValue(row.node);
  const imageUrl = !close && allowRemoteImages ? externalUrlFromNode(row.node) : null;
  const startImagePreview = () => {
    if (!imageUrl || failedImageUrls.has(imageUrl)) return;
    if (imageTimerRef.current !== null) window.clearTimeout(imageTimerRef.current);
    imageTimerRef.current = window.setTimeout(() => setShowImage(true), 400);
  };
  const stopImagePreview = () => {
    if (imageTimerRef.current !== null) window.clearTimeout(imageTimerRef.current);
    imageTimerRef.current = null;
    setShowImage(false);
  };
  useEffect(() => () => {
    if (imageTimerRef.current !== null) window.clearTimeout(imageTimerRef.current);
  }, []);
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

  if (close) {
    const closeToken = row.parentType === 'array' ? ']' : '}';
    return (
      <div
        className="tree-flat-row tree-flat-row--close"
        style={{ position: 'absolute', top: index * ROW_HEIGHT, width: '100%', height: ROW_HEIGHT }}
        data-row-index={index}
        role="listitem"
      >
        <div className="tree-row" style={{ '--tree-depth': row.depth } as React.CSSProperties}>
          <span className="tree-indent-guides" aria-hidden="true">{Array.from({ length: row.depth }, (_, depth) => <i key={depth} />)}</span>
          <span className="tree-close-token">{closeToken}{row.isLast ? '' : ','}</span>
        </div>
      </div>
    );
  }

  const label = rowKeyLabel(row);
  const token = container
    ? expanded ? (row.node.type === 'array' ? '[' : '{') : `${row.node.type === 'array' ? '[' : '{'}…${containerCount(row.node)}${row.node.type === 'array' ? ']' : '}'}`
    : valueText(row.node);
  const comma = row.kind === 'open' || row.isLast ? '' : ',';

  return (
    <div
      className={`tree-flat-row${highlightPaths.has(row.path) ? ' is-highlighted' : ''}${row.path === selectedPath ? ' is-selected' : ''}`}
      style={{ position: 'absolute', top: index * ROW_HEIGHT, width: '100%', height: ROW_HEIGHT }}
      data-tree-row
      data-row-index={index}
      role="listitem"
      tabIndex={0}
      onClick={() => onSelectPath(row.path)}
      onKeyDown={handleKeyDown}
    >
      <div className="tree-row" style={{ '--tree-depth': row.depth } as React.CSSProperties}>
        <span className="tree-indent-guides" aria-hidden="true">{Array.from({ length: row.depth }, (_, depth) => <i key={depth} />)}</span>
        {canOperate ? (
          <button
            className="tree-toggle icon-button"
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              handleToggle();
            }}
            aria-expanded={expanded}
            aria-label={expanded ? `折叠 ${row.label}` : `展开 ${row.label}`}
          >
            <Icon name={expanded ? 'expand_more' : 'chevron_right'} size={14} />
          </button>
        ) : <span className="tree-spacer" />}
        <button
          className="tree-path"
          type="button"
          data-tooltip={row.ambiguous ? '重复键路径不唯一' : `选择 ${row.path}`}
        >
          {label}
        </button>
        {externalUrlFromNode(row.node) ? (
          <button
            type="button"
            className={`tree-value tree-value--${row.node.type} tree-url-value`}
            // 用自定义 tooltip 而非原生 title：原生提示由系统画在光标处，正好压住
            // 紧贴行下沿的图片预览，且位置无法用 CSS 调整。图片预览出现后不再挂提示，
            // 避免自家 tooltip 二次遮挡预览。
            {...(showImage ? {} : { 'data-tooltip': fullValue })}
            onClick={(event) => {
              event.stopPropagation();
              const url = externalUrlFromNode(row.node);
              if (!url) return;
              if (onOpenExternal) onOpenExternal(url);
              else void openExternalUrl(url).catch(() => undefined);
            }}
            onMouseEnter={startImagePreview}
            onMouseLeave={stopImagePreview}
          >{token}{comma}</button>
        ) : (
          <span
            className={`tree-value tree-value--${row.node.type}`}
            {...(showImage ? {} : { 'data-tooltip': fullValue })}
            onMouseEnter={startImagePreview}
            onMouseLeave={stopImagePreview}
          >{token}{comma}</span>
        )}
        {showImage && imageUrl && (
          <span className="tree-image-preview" role="tooltip">
            <img src={imageUrl} alt="远程图片预览" referrerPolicy="no-referrer" onError={() => { failedImageUrls.add(imageUrl); setShowImage(false); }} />
          </span>
        )}
        {canOperate && (
          <button
            className="icon-button tree-subtree-button"
            type="button"
            aria-label={`${subtreeExpanded ? '收起' : '展开'}子树 ${row.label}`}
            data-tooltip={subtreeExpanded ? '收起子树 (Shift ←)' : '展开子树 (Shift →)'}
            onClick={(event) => {
              event.stopPropagation();
              onExpandChange(subtreeExpanded
                ? collapseSubtree(expandState, row.path)
                : expandSubtree(expandState, row.path));
            }}
          >
            <Icon name={subtreeExpanded ? 'chevron_right' : 'expand_more'} size={13} />
          </button>
        )}
        <span className="tree-row-actions" aria-label="节点操作">
          <button type="button" onClick={(event) => { event.stopPropagation(); onCopy(fullValue, '值'); }}>复制</button>
          <span aria-hidden="true">|</span>
          <button type="button" disabled={row.ambiguous} onClick={(event) => { event.stopPropagation(); onCopy(row.path, '路径'); }}>复制路径</button>
          <span aria-hidden="true">|</span>
          <button type="button" onClick={(event) => { event.stopPropagation(); onDownloadNode(row.path, row.node); }}>下载</button>
          <span aria-hidden="true">|</span>
          <button type="button" onClick={(event) => { event.stopPropagation(); onHide(row.path); }}>删除</button>
        </span>
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
  hiddenPaths = new Set<string>(),
  onHide = () => undefined,
  onRestoreHidden = () => undefined,
  selectedPath = null,
  onSelectPath = () => undefined,
  onDownloadNode = () => undefined,
  allowRemoteImages = false,
  onOpenExternal,
}: TreeViewProps, ref) {
  const rows = useMemo(() => {
    if (!root) return [];
    const endFlatten = beginSpan('tree-flatten');
    try {
      return flattenTree(root, expandState, hiddenPaths);
    } finally {
      endFlatten();
    }
  }, [expandState, hiddenPaths, root]);
  const virtual = useVirtualWindow(rows);

  useImperativeHandle(ref, () => ({
    scrollToIndex: virtual.scrollToIndex,
    scrollToPath: (path) => {
      const index = rows.findIndex((row) => row.path === path);
      if (index >= 0) virtual.scrollToIndex(index);
    },
  }), [rows, virtual.scrollToIndex]);

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
              onHide={onHide}
              onSelectPath={onSelectPath}
              onDownloadNode={onDownloadNode}
              allowRemoteImages={allowRemoteImages}
              onOpenExternal={onOpenExternal}
              selectedPath={selectedPath}
              hiddenPaths={hiddenPaths}
            />
          ))}
        </div>
      </div>
    </div>
  );
});

TreeView.displayName = 'TreeView';
