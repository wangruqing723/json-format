import type { AppSettings, JsonDiagnostic, JsonStats } from '../types';
import type { JsonNode, JsonObjectEntry } from './json-parser';

export type IndentOption = AppSettings['indent'];

export function formatJsonNode(node: JsonNode, indentOption: IndentOption = 2): string {
  const indentUnit = indentOption === 'tab' ? '\t' : ' '.repeat(indentOption);
  return printNode(node, false, indentUnit, 0);
}

export function minifyJsonNode(node: JsonNode): string {
  return printNode(node, true, '', 0);
}

export function sortJsonNode(node: JsonNode): JsonNode {
  if (node.type === 'array') {
    return { ...node, items: node.items.map(sortJsonNode) };
  }
  if (node.type !== 'object') return node;

  const entries = node.entries
    .map((entry) => ({ ...entry, value: sortJsonNode(entry.value) }))
    .sort(compareEntries);
  return { ...node, entries };
}

export function collectDuplicateKeyWarnings(source: string, node: JsonNode): JsonDiagnostic[] {
  const warnings: JsonDiagnostic[] = [];
  visit(node, (current) => {
    if (current.type !== 'object') return;
    const seen = new Set<string>();
    for (const entry of current.entries) {
      if (seen.has(entry.key)) {
        warnings.push(createWarning(source, entry.keyOffset, `对象包含重复键“${entry.key}”`, 'DUPLICATE_KEY'));
      }
      seen.add(entry.key);
    }
  });
  return warnings;
}

export function calculateStats(source: string, root: JsonNode | null): JsonStats {
  const stats: JsonStats = {
    bytes: byteLength(source),
    characters: source.length,
    lines: source.length === 0 ? 0 : source.split(/\r?\n/).length,
    nodes: 0,
    objects: 0,
    arrays: 0,
    keys: 0,
    strings: 0,
    numbers: 0,
    booleans: 0,
    nulls: 0,
    maxDepth: 0,
  };
  if (!root) return stats;

  const walk = (node: JsonNode, depth: number): void => {
    stats.nodes++;
    stats.maxDepth = Math.max(stats.maxDepth, depth);
    switch (node.type) {
      case 'object':
        stats.objects++;
        stats.keys += node.entries.length;
        node.entries.forEach((entry) => walk(entry.value, depth + 1));
        break;
      case 'array':
        stats.arrays++;
        node.items.forEach((item) => walk(item, depth + 1));
        break;
      case 'string':
        stats.strings++;
        break;
      case 'number':
        stats.numbers++;
        break;
      case 'boolean':
        stats.booleans++;
        break;
      case 'null':
        stats.nulls++;
        break;
    }
  };
  walk(root, 1);
  return stats;
}

export function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function printNode(node: JsonNode, compact: boolean, indentUnit: string, depth: number): string {
  if (node.type !== 'object' && node.type !== 'array') return node.raw;

  const open = node.type === 'object' ? '{' : '[';
  const close = node.type === 'object' ? '}' : ']';
  const values =
    node.type === 'object'
      ? node.entries.map(
          (entry) =>
            `${entry.keyRaw}${compact ? ':' : ': '}${printNode(entry.value, compact, indentUnit, depth + 1)}`,
        )
      : node.items.map((item) => printNode(item, compact, indentUnit, depth + 1));
  if (values.length === 0) return `${open}${close}`;
  if (compact) return `${open}${values.join(',')}${close}`;

  const itemIndent = indentUnit.repeat(depth + 1);
  const closingIndent = indentUnit.repeat(depth);
  return `${open}\n${itemIndent}${values.join(`,\n${itemIndent}`)}\n${closingIndent}${close}`;
}

function compareEntries(left: JsonObjectEntry, right: JsonObjectEntry): number {
  if (left.key < right.key) return -1;
  if (left.key > right.key) return 1;
  return left.index - right.index;
}

function visit(node: JsonNode, callback: (node: JsonNode) => void): void {
  callback(node);
  if (node.type === 'array') node.items.forEach((item) => visit(item, callback));
  if (node.type === 'object') node.entries.forEach((entry) => visit(entry.value, callback));
}

function createWarning(
  source: string,
  offset: number,
  message: string,
  code: string,
): JsonDiagnostic {
  const before = source.slice(0, offset);
  const line = before.split('\n').length;
  const column = offset - before.lastIndexOf('\n');
  return {
    message,
    line,
    column,
    offset,
    code,
    severity: 'warning',
    context: source.split(/\r?\n/)[line - 1] ?? '',
  };
}
