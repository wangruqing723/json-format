import { useEffect, useMemo, useRef, useState } from 'react';
import { buildTableModel, nodeAtPath, tableToTsv, type TableCell } from '../core/json-table';
import type { JsonNode } from '../core/json-parser';

export interface TableViewProps {
  open: boolean;
  root: JsonNode | null;
  sourcePath: string;
  onClose: () => void;
  onCopy: (value: string, label: string) => void;
}

function pathLabel(path: string): string {
  if (path === '$') return '$';
  const match = path.match(/(?:\.([^.[\]]+)|\[\"((?:\\.|[^\"])*)\"\]|\[(\d+)\])$/);
  return match?.slice(1).find(Boolean) ?? path;
}

function cellButton(cell: TableCell, onDrill: (path: string) => void, onCopy: (value: string) => void) {
  if (!cell.full && !cell.path) return <span className="table-cell-empty" aria-label="缺失字段" />;
  return (
    <span className="table-cell-content">
      {cell.drillable && cell.path ? (
        <button type="button" className={`table-cell-value tree-value tree-value--${cell.type}`} onClick={() => onDrill(cell.path!)} title="下钻查看">
          {cell.text}
        </button>
      ) : (
        <span className={cell.type ? `tree-value tree-value--${cell.type}` : undefined} title={cell.truncated ? cell.full : undefined}>{cell.text}</span>
      )}
      <button type="button" className="table-cell-copy" onClick={() => onCopy(cell.full)} aria-label="复制单元格">复制</button>
    </span>
  );
}

export function TableView({ open, root, sourcePath, onClose, onCopy }: TableViewProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [pathStack, setPathStack] = useState<string[]>([sourcePath]);

  useEffect(() => {
    if (!open) return;
    setPathStack([sourcePath]);
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = requestAnimationFrame(() => closeRef.current?.focus());
    return () => {
      cancelAnimationFrame(frame);
      previousFocusRef.current?.focus();
    };
  }, [open, sourcePath]);

  const currentPath = pathStack.at(-1) ?? sourcePath;
  const currentNode = useMemo(() => root ? nodeAtPath(root, currentPath) : null, [currentPath, root]);
  const model = useMemo(() => currentNode ? buildTableModel(currentNode, currentPath) : null, [currentNode, currentPath]);
  const totalRowCount = currentNode?.type === 'array'
    ? currentNode.items.length
    : currentNode?.type === 'object'
      ? currentNode.entries.length
      : model?.rowCount ?? 0;

  if (!open) return null;

  const goBack = (index: number) => setPathStack((current) => current.slice(0, index + 1));
  const drill = (path: string) => setPathStack((current) => [...current, path]);
  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled])'));
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };

  return (
    <div className="dialog-backdrop table-backdrop" onMouseDown={onClose}>
      <section
        className="table-dialog glass-panel-heavy"
        role="dialog"
        aria-modal="true"
        aria-labelledby="table-view-title"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <header className="dialog-title-row table-dialog-header">
          <div>
            <span className="dialog-eyebrow">TABLE VIEW</span>
            <h2 id="table-view-title">表格视图</h2>
          </div>
          <button ref={closeRef} className="icon-button" type="button" onClick={onClose} aria-label="关闭表格视图">×</button>
        </header>
        <div className="table-breadcrumbs" aria-label="表格来源路径">
          {pathStack.map((path, index) => (
            <span key={`${path}-${index}`}>
              {index > 0 && <span aria-hidden="true"> / </span>}
              <button type="button" onClick={() => goBack(index)} disabled={index === pathStack.length - 1}>{pathLabel(path)}</button>
            </span>
          ))}
        </div>
        {model ? (
          <>
            <div className="table-toolbar">
              <span>{model.shape === 'records' ? '记录' : model.shape === 'scalars' ? '值列表' : '对象字段'} · {model.rowCount.toLocaleString()} 行</span>
              {model.truncated && <span className="table-truncated">已截断，共 {totalRowCount.toLocaleString()} 行</span>}
              <button type="button" className="secondary-button" onClick={() => onCopy(tableToTsv(model), '表格')}>复制整表</button>
            </div>
            <div className="table-scroll">
              <table>
                <thead><tr>{model.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
                <tbody>
                  {model.rows.map((row, rowIndex) => (
                    <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cellButton(cell, drill, (value) => onCopy(value, '单元格'))}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div className="table-empty" role="status">
            <strong>当前节点无法表格化</strong>
            <span>请选择对象或数组节点；标量值没有可展开的表格结构。</span>
            {pathStack.length > 1 && <button type="button" className="secondary-button" onClick={() => setPathStack((current) => current.slice(0, -1))}>回到上一层</button>}
          </div>
        )}
      </section>
    </div>
  );
}
