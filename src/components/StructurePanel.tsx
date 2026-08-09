import { useState } from 'react';
import type { JsonNode } from '../core/json-parser';
import { propertyPath } from '../core/json-path';
import { Icon } from './Icon';

export interface StructurePanelProps {
  root: JsonNode | null;
  parseError: string | null;
  onSelectPath?: (path: string) => void;
}

function isContainer(node: JsonNode) {
  return node.type === 'object' || node.type === 'array';
}

function nodeSummary(node: JsonNode) {
  if (node.type === 'object') return `${node.entries.length} keys`;
  if (node.type === 'array') return `${node.items.length} items`;
  return node.raw;
}

function StructureNode({ node, label, path, depth, onSelectPath }: { node: JsonNode; label: string; path: string; depth: number; onSelectPath?: (path: string) => void }) {
  const [expanded, setExpanded] = useState(depth < 2);
  const container = isContainer(node);
  const summary = nodeSummary(node);
  const children = node.type === 'array'
    ? node.items.map((child, index) => ({ label: `[${index}]`, child, path: propertyPath(path, String(index), true) }))
    : node.type === 'object'
      ? node.entries.map((entry) => ({ label: entry.key, child: entry.value, path: propertyPath(path, entry.key, false) }))
      : [];

  return (
    <div className="structure-node">
      <div className="structure-row" style={{ '--structure-depth': depth, '--structure-indent': `${Math.min(depth, 3) * 16}px` } as React.CSSProperties}>
        {container ? (
          <button className="icon-button structure-toggle" type="button" onClick={() => setExpanded((current) => !current)} aria-expanded={expanded} aria-label={expanded ? `折叠 ${label}` : `展开 ${label}`}>
            <Icon name={expanded ? 'expand_more' : 'chevron_right'} size={15} />
          </button>
        ) : <span className="structure-spacer" />}
        <button className="structure-key" type="button" onClick={() => onSelectPath?.(path)}>
          <span className={`structure-type structure-type--${node.type}`}>{node.type}</span>
          <span>{label}</span>
        </button>
        <span className="structure-summary" title={summary}>{summary}</span>
      </div>
      {container && expanded && (
        <div>
          {children.map((child, index) => (
            <StructureNode key={`${child.path}-${index}`} node={child.child} label={child.label} path={child.path} depth={depth + 1} onSelectPath={onSelectPath} />
          ))}
        </div>
      )}
    </div>
  );
}

export function StructurePanel({ root, parseError, onSelectPath }: StructurePanelProps) {
  const [selectedPath, setSelectedPath] = useState('$');

  const selectPath = (path: string) => {
    setSelectedPath(path);
    onSelectPath?.(path);
  };

  return (
    <aside className="structure-panel" aria-label="结构总览">
      <header className="structure-header">
        <div><span className="structure-eyebrow">JSON MAP</span><h2>结构总览</h2></div>
        <Icon name="account_tree" size={19} />
      </header>
      {root ? (
        <div className="structure-tree" role="tree">
          <StructureNode node={root} label="$" path="$" depth={0} onSelectPath={selectPath} />
        </div>
      ) : (
        <div className="structure-empty" role="status"><Icon name="data_object" size={26} /><span>{parseError ?? '暂无可解析的 JSON 结构'}</span></div>
      )}
      <div className="structure-detected">
        <span>KEY DETECTED</span>
        <code>{selectedPath}</code>
      </div>
    </aside>
  );
}
