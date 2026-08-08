import { useMemo, useState } from 'react';
import { parseJson, type JsonNode } from '../core/json-parser';
import { minifyJsonNode } from '../core/json-transform';
import { propertyPath } from '../core/json-path';
import { Icon } from './Icon';

interface TreeViewProps {
  source: string;
  onCopy: (value: string, label: string) => void;
}

interface TreeNodeProps {
  label: string;
  node: JsonNode;
  path: string;
  depth: number;
  ambiguousPath?: boolean;
  onCopy: TreeViewProps['onCopy'];
}

function isContainer(node: JsonNode) {
  return node.type === 'object' || node.type === 'array';
}

function summary(node: JsonNode) {
  if (node.type === 'array') return `Array(${node.items.length})`;
  if (node.type === 'object') return `Object(${node.entries.length})`;
  return node.raw;
}

function copyValue(node: JsonNode) {
  if (node.type === 'string') return node.value as string;
  return minifyJsonNode(node);
}

function duplicateKeys(node: JsonNode): Set<string> {
  if (node.type !== 'object') return new Set();
  const counts = new Map<string, number>();
  for (const entry of node.entries) counts.set(entry.key, (counts.get(entry.key) ?? 0) + 1);
  return new Set([...counts].filter(([, count]) => count > 1).map(([key]) => key));
}

function containsDuplicateKeys(node: JsonNode): boolean {
  if (node.type === 'array') return node.items.some(containsDuplicateKeys);
  if (node.type !== 'object') return false;
  if (duplicateKeys(node).size) return true;
  return node.entries.some((entry) => containsDuplicateKeys(entry.value));
}

function TreeNode({ label, node, path, depth, ambiguousPath = false, onCopy }: TreeNodeProps) {
  const container = isContainer(node);
  const [expanded, setExpanded] = useState(depth < 2);
  const duplicates = duplicateKeys(node);
  const children = node.type === 'array'
    ? node.items.map((child, index) => ({ key: String(index), label: `[${index}]`, child, ambiguous: false }))
    : node.type === 'object'
      ? node.entries.map((entry, index) => ({ key: `${entry.key}-${index}`, label: entry.key, child: entry.value, ambiguous: duplicates.has(entry.key) }))
      : [];

  return (
    <div className="tree-node" role="listitem">
      <div className="tree-row" style={{ '--tree-depth': depth } as React.CSSProperties}>
        {container ? (
          <button
            className="tree-toggle icon-button"
            type="button"
            onClick={() => setExpanded((current) => !current)}
            aria-expanded={expanded}
            aria-label={expanded ? `折叠 ${label}` : `展开 ${label}`}
          >
            <Icon name={expanded ? 'expand_more' : 'chevron_right'} size={14} />
          </button>
        ) : <span className="tree-spacer" />}
        <button
          className="tree-path"
          type="button"
          data-tooltip={ambiguousPath ? '重复键路径不唯一' : `复制路径 ${path}`}
          disabled={ambiguousPath}
          onClick={() => onCopy(path, '路径')}
        >
          {label}
        </button>
        <span className={`tree-value tree-value--${node.type}`}>{summary(node)}</span>
        <button
          type="button"
          className="tree-copy icon-button"
          data-tooltip="复制保真值"
          aria-label={`复制 ${label} 的值`}
          onClick={() => onCopy(copyValue(node), '值')}
        >
          <Icon name="content_copy" size={13} />
        </button>
      </div>
      {container && expanded && (
        <div role="list">
          {children.map(({ key, label: childLabel, child, ambiguous }) => (
            <TreeNode
              key={key}
              label={childLabel}
              node={child}
              path={propertyPath(path, node.type === 'array' ? childLabel.slice(1, -1) : childLabel, node.type === 'array')}
              depth={depth + 1}
              ambiguousPath={ambiguous}
              onCopy={onCopy}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function TreeView({ source, onCopy }: TreeViewProps) {
  const parsed = useMemo(() => {
    try {
      const node = parseJson(source);
      return { node, hasDuplicates: containsDuplicateKeys(node), error: null };
    } catch (error) {
      return { node: null, hasDuplicates: false, error: error instanceof Error ? error.message : '无法解析 JSON' };
    }
  }, [source]);

  if (parsed.error || !parsed.node) {
    return (
      <div className="view-empty" role="status">
        <Icon name="data_object" size={28} />
        <strong>树视图不可用</strong>
        <span>修正 JSON 错误后即可浏览节点。</span>
      </div>
    );
  }

  return (
    <div className="tree-view" aria-label="JSON 树">
      {parsed.hasDuplicates && (
        <div className="tree-warning" role="status">
          <Icon name="warning" size={14} />
          <span>检测到重复键：全部值均保留显示，重复键路径复制已禁用。</span>
        </div>
      )}
      <div role="list">
        <TreeNode label="$" node={parsed.node} path="$" depth={0} onCopy={onCopy} />
      </div>
    </div>
  );
}
