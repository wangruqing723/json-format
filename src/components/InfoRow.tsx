import { formatBytes } from '../utils/format';

interface InfoRowProps {
  path: string;
  cursor: { line: number; column: number };
  bytes: number;
  nodeCount: number | null;
  indent: number | 'tab';
  durationMs: number | null;
  restricted: boolean;
  persistenceIssue: string | null;
}

export function InfoRow({
  path,
  cursor,
  bytes,
  nodeCount,
  indent,
  durationMs,
  restricted,
  persistenceIssue,
}: InfoRowProps) {
  return (
    <div className="info-row" aria-label="文档信息">
      <span className="info-path" title={path}>{path}</span>
      <span className="info-spacer" />
      {persistenceIssue && <span className="status-warning" title={persistenceIssue}>会话内容未持久化</span>}
      {restricted && <span className="status-warning">受限模式</span>}
      {nodeCount !== null && <span>{nodeCount.toLocaleString()} 节点</span>}
      <span>行 {cursor.line}，列 {cursor.column}</span>
      <span>{formatBytes(bytes)}</span>
      <span>{indent === 'tab' ? 'Tab' : `${indent} 空格`}</span>
      <span>UTF-8</span>
      {durationMs !== null && <span>{durationMs.toFixed(1)} ms</span>}
    </div>
  );
}
