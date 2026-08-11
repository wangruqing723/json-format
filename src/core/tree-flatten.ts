import type { JsonNode } from './json-parser';
import { propertyPath } from './json-path';

export type FlatRowKind = 'value' | 'open' | 'close';

type ParentType = 'object' | 'array' | null;

export interface FlatRow {
  path: string;
  label: string;
  node: JsonNode;
  depth: number;
  kind: FlatRowKind;
  hasChildren: boolean;
  ambiguous: boolean;
  isLast: boolean;
  parentType: ParentType;
}

export type ExpandBaseline = 'default' | 'all' | 'none';

export interface ExpandState {
  baseline: ExpandBaseline;
  overrides: ReadonlySet<string>;
  subtrees: ReadonlyArray<{ prefix: string; expanded: boolean }>;
}

export const DEFAULT_EXPAND_DEPTH = 2;

export function createExpandState(): ExpandState {
  return { baseline: 'default', overrides: new Set(), subtrees: [] };
}

function baselineExpanded(state: ExpandState, depth: number): boolean {
  if (state.baseline === 'all') return true;
  if (state.baseline === 'none') return false;
  return depth < DEFAULT_EXPAND_DEPTH;
}

export function isExpanded(state: ExpandState, path: string, depth: number): boolean {
  if (state.overrides.has(path)) return !baselineExpanded(state, depth);
  for (let index = state.subtrees.length - 1; index >= 0; index--) {
    const subtree = state.subtrees[index];
    if (isPathPrefix(subtree.prefix, path)) return subtree.expanded;
  }
  return baselineExpanded(state, depth);
}

function isPathPrefix(prefix: string, path: string): boolean {
  if (prefix === '$') return path.startsWith('$');
  return path === prefix || path.startsWith(prefix + '.') || path.startsWith(prefix + '[');
}

function updateOverride(state: ExpandState, path: string, depth: number, expanded: boolean): ExpandState {
  const overrides = new Set(state.overrides);
  if (expanded === baselineExpanded(state, depth)) overrides.delete(path);
  else overrides.add(path);
  return { ...state, overrides };
}

export function toggleExpand(state: ExpandState, path: string, depth: number): ExpandState {
  const expanded = !isExpanded(state, path, depth);
  const next = updateOverride(state, path, depth, expanded);
  if (isExpanded(next, path, depth) === expanded) return next;
  // 仅用 Set 的 overrides 无法表达被子树规则遮蔽的 baseline 侧，
  // 因此用精确路径前缀记录最小范围的例外。
  return { ...next, subtrees: [...next.subtrees, { prefix: path, expanded }] };
}

export function expandAll(state: ExpandState): ExpandState {
  return { baseline: 'all', overrides: new Set(), subtrees: [] };
}

export function collapseAll(state: ExpandState): ExpandState {
  return { baseline: 'none', overrides: new Set(), subtrees: [] };
}

function addSubtree(state: ExpandState, path: string, expanded: boolean): ExpandState {
  return { ...state, subtrees: [...state.subtrees, { prefix: path, expanded }] };
}

export function expandSubtree(state: ExpandState, path: string): ExpandState {
  return addSubtree(state, path, true);
}

export function collapseSubtree(state: ExpandState, path: string): ExpandState {
  return addSubtree(state, path, false);
}

export function revealPath(state: ExpandState, path: string): ExpandState {
  const ancestors = pathAncestors(path);
  let next = state;
  for (const ancestor of ancestors) {
    const depth = pathDepth(ancestor);
    if (!isExpanded(next, ancestor, depth)) {
      const overridden = updateOverride(next, ancestor, depth, true);
      next = isExpanded(overridden, ancestor, depth)
        ? overridden
        : { ...overridden, subtrees: [...overridden.subtrees, { prefix: ancestor, expanded: true }] };
    }
  }
  return next;
}

function pathAncestors(path: string): string[] {
  if (path === '$') return [];
  const ancestors: string[] = ['$'];
  let cursor = 1;
  let quote = false;
  let escaped = false;
  for (let index = 1; index < path.length; index++) {
    const character = path[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quote = false;
      continue;
    }
    if (character === '"') {
      quote = true;
      continue;
    }
    if (character === '.') {
      if (index > cursor) ancestors.push(path.slice(0, index));
      cursor = index;
    } else if (character === '[') {
      if (index > cursor) ancestors.push(path.slice(0, index));
      cursor = index;
    }
  }
  return ancestors.filter((ancestor, index) => index === 0 || ancestor !== path);
}

function pathDepth(path: string): number {
  let depth = 0;
  let quote = false;
  let escaped = false;
  for (let index = 1; index < path.length; index++) {
    const character = path[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quote = false;
    } else if (character === '"') quote = true;
    else if (character === '.' || character === '[') depth++;
  }
  return depth;
}

interface ChildEntry {
  node: JsonNode;
  path: string;
  label: string;
  ambiguous: boolean;
}

interface StackNode extends ChildEntry {
  kind: 'node';
  depth: number;
  isLast: boolean;
  parentType: ParentType;
}

interface CloseNode {
  kind: 'close';
  node: JsonNode;
  path: string;
  depth: number;
  isLast: boolean;
  parentType: ParentType;
}

type StackEntry = StackNode | CloseNode;

function isContainer(node: JsonNode): node is Extract<JsonNode, { type: 'object' | 'array' }> {
  return node.type === 'object' || node.type === 'array';
}

function childEntries(node: JsonNode): ChildEntry[] {
  if (node.type === 'array') {
    return node.items.map((child, index) => ({
      node: child,
      path: propertyPath('', String(index), true),
      label: `[${index}]`,
      ambiguous: false,
    }));
  }
  if (node.type !== 'object') return [];
  const counts = new Map<string, number>();
  for (const entry of node.entries) counts.set(entry.key, (counts.get(entry.key) ?? 0) + 1);
  return node.entries.map((entry) => ({
    node: entry.value,
    path: propertyPath('', entry.key, false),
    label: entry.key,
    ambiguous: (counts.get(entry.key) ?? 0) > 1,
  }));
}

function hasChildren(node: JsonNode): boolean {
  return node.type === 'array'
    ? node.items.length > 0
    : node.type === 'object' && node.entries.length > 0;
}

function isHiddenPath(path: string, hiddenPaths?: ReadonlySet<string>): boolean {
  if (!hiddenPaths || hiddenPaths.size === 0) return false;
  for (const hiddenPath of hiddenPaths) {
    if (isPathPrefix(hiddenPath, path)) return true;
  }
  return false;
}

function visibleChildren(
  node: JsonNode,
  parentPath: string,
  hiddenPaths?: ReadonlySet<string>,
): ChildEntry[] {
  return childEntries(node).filter((child) => !isHiddenPath(parentPath + child.path, hiddenPaths));
}

export function isSubtreeFullyExpanded(
  state: ExpandState,
  root: JsonNode,
  rootPath: string,
  rootDepth: number,
  hiddenPaths?: ReadonlySet<string>,
): boolean {
  if (!isContainer(root)) return false;
  if (isHiddenPath(rootPath, hiddenPaths)) return false;
  const stack = [{ node: root, path: rootPath, depth: rootDepth }];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (!isExpanded(state, current.path, current.depth)) return false;
    for (const child of childEntries(current.node)) {
      const childPath = current.path + child.path;
      if (isHiddenPath(childPath, hiddenPaths)) continue;
      if (!isContainer(child.node)) continue;
      stack.push({
        node: child.node,
        path: childPath,
        depth: current.depth + 1,
      });
    }
  }
  return true;
}

function appendVisibleRows(
  root: JsonNode,
  state: ExpandState,
  onRow: (row: FlatRow) => void,
  hiddenPaths?: ReadonlySet<string>,
): void {
  if (isHiddenPath('$', hiddenPaths)) return;

  const stack: StackEntry[] = [{
    kind: 'node',
    node: root,
    path: '$',
    label: '$',
    depth: 0,
    ambiguous: false,
    isLast: true,
    parentType: null,
  }];
  while (stack.length > 0) {
    const current = stack.pop()!;

    if (current.kind === 'close') {
      onRow({
        path: current.path,
        label: '',
        node: current.node,
        depth: current.depth,
        kind: 'close',
        hasChildren: false,
        ambiguous: false,
        isLast: current.isLast,
        parentType: current.parentType,
      });
      continue;
    }

    const currentHasChildren = hasChildren(current.node);
    if (!isContainer(current.node) || !isExpanded(state, current.path, current.depth)) {
      onRow({
        ...current,
        kind: 'value',
        hasChildren: currentHasChildren,
      });
      continue;
    }

    onRow({
      path: current.path,
      label: current.label,
      node: current.node,
      depth: current.depth,
      kind: 'open',
      hasChildren: currentHasChildren,
      ambiguous: current.ambiguous,
      isLast: current.isLast,
      parentType: current.parentType,
    });

    stack.push({
      kind: 'close',
      node: current.node,
      path: current.path,
      depth: current.depth,
      isLast: current.isLast,
      // 根节点没有父容器；其余 close 行需要携带正在闭合的容器类型。
      parentType: current.path === '$' ? null : current.node.type,
    });

    const children = visibleChildren(current.node, current.path, hiddenPaths);
    for (let index = children.length - 1; index >= 0; index--) {
      const child = children[index];
      stack.push({
        ...child,
        kind: 'node',
        path: current.path + child.path,
        depth: current.depth + 1,
        isLast: index === children.length - 1,
        parentType: current.node.type,
      });
    }
  }
}

export function flattenTree(
  root: JsonNode,
  state: ExpandState,
  hiddenPaths?: ReadonlySet<string>,
): FlatRow[] {
  const rows: FlatRow[] = [];
  appendVisibleRows(root, state, (row) => rows.push(row), hiddenPaths);
  return rows;
}

export function countVisibleRows(
  root: JsonNode,
  state: ExpandState,
  hiddenPaths?: ReadonlySet<string>,
): number {
  let count = 0;
  appendVisibleRows(root, state, () => { count++; }, hiddenPaths);
  return count;
}

export function containsDuplicateKeys(root: JsonNode): boolean {
  const stack: JsonNode[] = [root];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.type === 'array') {
      stack.push(...node.items);
      continue;
    }
    if (node.type !== 'object') continue;
    const keys = new Set<string>();
    for (const entry of node.entries) {
      if (keys.has(entry.key)) return true;
      keys.add(entry.key);
      stack.push(entry.value);
    }
  }
  return false;
}
