import type { JsonNode } from './json-parser';
import { minifyJsonNode } from './json-transform';
import { propertyPath } from './json-path';

export type DiffKind = 'added' | 'removed' | 'changed' | 'same';

export interface JsonDiffEntry {
  path: string;
  kind: DiffKind;
  left: string | null;
  right: string | null;
  depth: number;
}

export interface JsonDiffResult {
  entries: JsonDiffEntry[];
  summary: { added: number; removed: number; changed: number; same: number };
}

interface DiffPair {
  left: JsonNode | null;
  right: JsonNode | null;
  path: string;
  depth: number;
}

export function diffJsonNodes(left: JsonNode, right: JsonNode): JsonDiffResult {
  const entries: JsonDiffEntry[] = [];
  const summary = { added: 0, removed: 0, changed: 0, same: 0 };
  const stack: DiffPair[] = [{ left, right, path: '$', depth: 0 }];

  while (stack.length) {
    const pair = stack.pop()!;
    const kind = classify(pair.left, pair.right);
    entries.push({
      path: pair.path,
      kind,
      left: pair.left ? minifyJsonNode(pair.left) : null,
      right: pair.right ? minifyJsonNode(pair.right) : null,
      depth: pair.depth,
    });
    summary[kind]++;
    if (kind === 'same' && pair.left && pair.right && pair.left.type === pair.right.type) {
      pushChildren(stack, pair);
    } else if (pair.left && pair.right && pair.left.type === pair.right.type && isContainer(pair.left)) {
      pushChildren(stack, pair);
    }
  }
  return { entries, summary };
}

function classify(left: JsonNode | null, right: JsonNode | null): DiffKind {
  if (!left) return 'added';
  if (!right) return 'removed';
  return semanticallyEqual(left, right) ? 'same' : 'changed';
}

function semanticallyEqual(left: JsonNode, right: JsonNode): boolean {
  if (left.type !== right.type) return false;
  if (left.type === 'array' && right.type === 'array') return left.items.length === right.items.length;
  if (left.type === 'object' && right.type === 'object') return left.entries.length === right.entries.length;
  if (left.type === 'string' && right.type === 'string') return left.value === right.value;
  if (left.type === 'number' && right.type === 'number') return left.raw === right.raw;
  if (left.type === 'boolean' && right.type === 'boolean') return left.value === right.value;
  return left.type === 'null' && right.type === 'null';
}

function isContainer(node: JsonNode): boolean {
  return node.type === 'array' || node.type === 'object';
}

function pushChildren(stack: DiffPair[], pair: DiffPair): void {
  const left = pair.left!;
  const right = pair.right!;
  if (left.type === 'array' && right.type === 'array') {
    const length = Math.max(left.items.length, right.items.length);
    for (let index = length - 1; index >= 0; index--) {
      stack.push({
        left: left.items[index] ?? null,
        right: right.items[index] ?? null,
        path: propertyPath(pair.path, String(index), true),
        depth: pair.depth + 1,
      });
    }
    return;
  }
  if (left.type !== 'object' || right.type !== 'object') return;
  const leftKeys = left.entries.map((entry) => entry.key);
  const rightKeys = right.entries.map((entry) => entry.key);
  const keys = [...leftKeys, ...rightKeys.filter((key) => !leftKeys.includes(key))];
  for (let index = keys.length - 1; index >= 0; index--) {
    const key = keys[index];
    stack.push({
      left: left.entries.find((entry) => entry.key === key)?.value ?? null,
      right: right.entries.find((entry) => entry.key === key)?.value ?? null,
      path: propertyPath(pair.path, key, false),
      depth: pair.depth + 1,
    });
  }
}
