import type { DocumentId, WorkerOperation } from '../types';
import { formatBytes } from '../utils/format';
import { Icon } from './Icon';

export interface HistoryRecord {
  id: string;
  documentId: DocumentId;
  documentTitle: string;
  operation: WorkerOperation | 'restore';
  operationLabel: string;
  content: string | null;
  bytes: number;
  createdAt: number;
}

interface HistoryViewProps {
  history: HistoryRecord[];
  onRestore: (record: HistoryRecord) => void;
  onClear: () => void;
}

function formatTime(timestamp: number) {
  return new Date(timestamp).toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

export function HistoryView({ history, onRestore, onClear }: HistoryViewProps) {
  const records = [...history].sort((left, right) => right.createdAt - left.createdAt);
  return (
    <main className="history-view" aria-label="操作历史">
      <header className="history-header">
        <div><span className="history-eyebrow">SESSION LOG</span><h1>操作历史</h1><p>记录当前会话中的内容变换，可随时恢复操作前快照。</p></div>
        <button className="secondary-button" type="button" onClick={onClear} disabled={!records.length}><Icon name="delete_sweep" size={16} />清空历史</button>
      </header>
      {records.length === 0 ? (
        <div className="history-empty" role="status">
          <Icon name="history" size={32} />
          <strong>暂无历史快照。</strong>
          <span>执行格式化或修复等操作后会自动记录。</span>
        </div>
      ) : (
        <div className="history-list">
          {records.map((record) => {
            const unavailable = record.content === null;
            return (
              <article className="history-card" key={record.id}>
                <div className="history-card-icon"><Icon name={record.operation === 'restore' ? 'settings_backup_restore' : 'data_object'} size={18} /></div>
                <div className="history-card-main">
                  <div className="history-card-topline"><strong>{record.documentTitle}</strong><span className="history-badge">{record.operationLabel}</span></div>
                  <div className="history-card-meta"><span>{formatTime(record.createdAt)}</span><span>{formatBytes(record.bytes)}</span></div>
                </div>
                <button className="history-restore" type="button" onClick={() => onRestore(record)} disabled={unavailable} data-tooltip={unavailable ? '快照超过 256 KB 未保存内容,无法恢复' : '恢复此快照'}>
                  <Icon name="settings_backup_restore" size={15} />恢复
                </button>
              </article>
            );
          })}
        </div>
      )}
    </main>
  );
}
