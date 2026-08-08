import { diffLines } from 'diff';
import { useMemo } from 'react';
import type { JsonDocument } from '../types';
import { Icon } from './Icon';

type DiffRowKind = 'same' | 'changed' | 'added' | 'removed';

export interface DiffRow {
  kind: DiffRowKind;
  left: string | null;
  right: string | null;
  leftLine: number | null;
  rightLine: number | null;
}

interface DiffViewProps {
  documents: JsonDocument[];
  leftId: string;
  rightId: string;
  onChangeSide: (side: 'left' | 'right', id: string) => void;
  onSwap: () => void;
  onEdit?: (id: string, content: string) => void;
}

const STRUCTURED_VIEW_LIMIT = 5 * 1024 * 1024;

function byteLength(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

function changeLines(value: string) {
  const lines = value.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

export function buildDiffRows(left: string, right: string): DiffRow[] {
  const changes = diffLines(left, right);
  const rows: Array<Omit<DiffRow, 'leftLine' | 'rightLine'>> = [];

  for (let index = 0; index < changes.length; index++) {
    const change = changes[index];
    const next = changes[index + 1];
    if (change.removed && next?.added) {
      const removed = changeLines(change.value);
      const added = changeLines(next.value);
      const count = Math.max(removed.length, added.length);
      for (let line = 0; line < count; line++) {
        rows.push({
          kind: removed[line] === undefined ? 'added' : added[line] === undefined ? 'removed' : 'changed',
          left: removed[line] ?? null,
          right: added[line] ?? null,
        });
      }
      index++;
      continue;
    }

    for (const line of changeLines(change.value)) {
      rows.push({
        kind: change.added ? 'added' : change.removed ? 'removed' : 'same',
        left: change.added ? null : line,
        right: change.removed ? null : line,
      });
    }
  }

  let leftLine = 0;
  let rightLine = 0;
  return rows.map((row) => ({
    ...row,
    leftLine: row.left === null ? null : ++leftLine,
    rightLine: row.right === null ? null : ++rightLine,
  }));
}

function DiffPane({ side, title, content, rows, onEdit, readOnly }: { side: 'left' | 'right'; title: string; content: string; rows: DiffRow[]; onEdit?: (content: string) => void; readOnly: boolean }) {
  const isLeft = side === 'left';
  return (
    <section className={`diff-pane diff-pane--${side}`} aria-label={`${isLeft ? '左侧（窄屏上方）' : '右侧（窄屏下方）'}：${title}`}>
      <header className="diff-pane-title">
        <span className="diff-side-desktop">{isLeft ? '左侧' : '右侧'}</span>
        <span className="diff-side-mobile">{isLeft ? '上方' : '下方'}</span>
        <strong>{title}</strong>
      </header>
      <textarea
        className="diff-editor"
        value={content}
        onChange={(event) => onEdit?.(event.target.value)}
        readOnly={readOnly}
        aria-label={`${title} JSON 编辑器`}
        title={readOnly ? '文档超过 5 MB，Diff 编辑已禁用' : '编辑此侧 JSON'}
      />
      <div className="diff-code" role="list" aria-label={`${title} 差异行`}>
        {rows.map((row, index) => {
          const content = isLeft ? row.left : row.right;
          const line = isLeft ? row.leftLine : row.rightLine;
          const visibleKind = row.kind === 'changed'
            ? 'changed'
            : isLeft
              ? row.kind === 'removed' ? 'removed' : row.kind === 'added' ? 'placeholder' : 'same'
              : row.kind === 'added' ? 'added' : row.kind === 'removed' ? 'placeholder' : 'same';
          const marker = visibleKind === 'added' ? '+' : visibleKind === 'removed' ? '-' : visibleKind === 'changed' ? '~' : '';
          return (
            <div key={`${side}-${index}`} className={`diff-line diff-line--${visibleKind}`} role="listitem">
              <span className="diff-line-number" aria-hidden="true">{line ?? ''}</span>
              <span className="diff-line-marker" aria-hidden="true">{marker}</span>
              <code>{content ?? ' '}</code>
              {marker && <span className="sr-only">{marker === '+' ? '新增' : marker === '-' ? '删除' : '变化'}</span>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function DiffView({ documents, leftId, rightId, onChangeSide, onSwap, onEdit }: DiffViewProps) {
  const left = documents.find((document) => document.id === leftId) ?? documents[0];
  const right = documents.find((document) => document.id === rightId) ?? documents[1] ?? documents[0];
  const readOnly = Boolean(left && right && (byteLength(left.content) > STRUCTURED_VIEW_LIMIT || byteLength(right.content) > STRUCTURED_VIEW_LIMIT));
  const rows = useMemo(() => left && right ? buildDiffRows(left.content, right.content) : [], [left, right]);
  const stats = useMemo(() => rows.reduce((result, row) => {
    if (row.kind === 'added') result.additions++;
    else if (row.kind === 'removed') result.deletions++;
    else if (row.kind === 'changed') result.changes++;
    else result.unchanged++;
    return result;
  }, { additions: 0, deletions: 0, changes: 0, unchanged: 0 }), [rows]);

  if (!left || !right) {
    return (
      <div className="view-empty">
        <Icon name="compare" size={28} />
        <strong>至少需要两个标签</strong>
        <span>新建或打开另一个 JSON 文档后即可比较。</span>
      </div>
    );
  }

  return (
    <section className="diff-view" aria-label="JSON Diff">
      <header className="diff-header">
        <div className="diff-sources">
          <label>
            <span><span className="diff-side-desktop">左侧文档</span><span className="diff-side-mobile">上方文档</span></span>
            <select value={left.id} onChange={(event) => onChangeSide('left', event.target.value)}>
              {documents.map((document) => <option key={document.id} value={document.id} disabled={document.id === right.id}>{document.title}</option>)}
            </select>
          </label>
          <label>
            <span><span className="diff-side-desktop">右侧文档</span><span className="diff-side-mobile">下方文档</span></span>
            <select value={right.id} onChange={(event) => onChangeSide('right', event.target.value)}>
              {documents.map((document) => <option key={document.id} value={document.id} disabled={document.id === left.id}>{document.title}</option>)}
            </select>
          </label>
        </div>
        <div className="diff-summary" aria-live="polite">
          <span className="diff-added">+{stats.additions} 新增</span>
          <span className="diff-changed">~{stats.changes} 变化</span>
          <span className="diff-removed">-{stats.deletions} 删除</span>
          <span>{stats.unchanged} 未变</span>
          <button className="icon-button" type="button" onClick={onSwap} data-tooltip="交换左右文档" aria-label="交换左右文档">
            <Icon name="swap_horiz" size={15} />
          </button>
        </div>
      </header>
      <div className="diff-editors">
        <DiffPane side="left" title={left.title} content={left.content} rows={rows} readOnly={readOnly} onEdit={(content) => onEdit?.(left.id, content)} />
        <DiffPane side="right" title={right.title} content={right.content} rows={rows} readOnly={readOnly} onEdit={(content) => onEdit?.(right.id, content)} />
      </div>
    </section>
  );
}
