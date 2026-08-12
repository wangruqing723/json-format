import type { QueryHit, QueryResult } from '../core/json-query';
import { Icon } from './Icon';

export interface SearchPanelProps {
  input: string;
  onChangeInput: (value: string) => void;
  result: QueryResult | null;
  onSelectHit: (hit: QueryHit) => void;
  onClose: () => void;
}

export function SearchPanel({ input, onChangeInput, result, onSelectHit, onClose }: SearchPanelProps) {
  return (
    <aside
      className="workspace-float-panel search-panel"
      aria-label="Search"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <header className="workspace-float-panel-header">
        <strong>Search</strong>
        <button className="icon-button" type="button" onClick={onClose} aria-label="关闭 Search" data-tooltip="关闭 Search">
          <Icon name="close" size={15} />
        </button>
      </header>
      <div className="sidebar-search">
        <label className="sidebar-section-title" htmlFor="workspace-search">查询 JSON</label>
        <input
          id="workspace-search"
          className="sidebar-search-input glass-input"
          type="search"
          value={input}
          onChange={(event) => onChangeInput(event.target.value)}
          placeholder="$.data[*].email 或关键字"
          aria-label="搜索 JSON"
          autoComplete="off"
        />
        {result && (
          <div className="sidebar-search-results" aria-live="polite">
            {result.error ? (
              <p className="sidebar-search-error">{result.error}</p>
            ) : (
              <>
                <div className="sidebar-search-summary">命中 {result.hits.length} 处{result.truncated ? '（已截断）' : ''}</div>
                {result.hits.map((hit, index) => (
                  <button key={`${hit.path}-${hit.reason}-${index}`} className="sidebar-search-hit" type="button" onClick={() => onSelectHit(hit)}>
                    <code>{hit.path}</code>
                    <span>{hit.reason === 'key' ? '键名' : hit.reason === 'value' ? '值' : 'JSONPath'}</span>
                  </button>
                ))}
                {!result.hits.length && <span className="sidebar-empty">没有匹配项</span>}
              </>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
