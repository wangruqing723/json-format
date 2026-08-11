import type { JsonNode, JsonObjectEntry, JsonObjectNode } from './json-parser';
import { propertyPath } from './json-path';
import { minifyJsonNode } from './json-transform';

export type TableShape = 'object' | 'records' | 'scalars';

export interface TableCell {
  /** 渲染用文本，已按 TABLE_CELL_MAX_CHARS 截断 */
  text: string;
  /** 复制用的完整文本（字符串取原值，其余取 minifyJsonNode） */
  full: string;
  /** 该单元格对应节点的 JSONPath；缺失字段为 null */
  path: string | null;
  /** 值类型，用于套用 .tree-value--{type} 配色；缺失字段为 null */
  type: JsonNode['type'] | null;
  /** 值是对象/数组时为 true，渲染成可点击下钻 */
  drillable: boolean;
  /** 因超长被截断 */
  truncated: boolean;
}

export interface TableModel {
  shape: TableShape;
  /** 数据源路径，用于面包屑 */
  sourcePath: string;
  /** 列名。object → ['字段','值']；records → ['#', ...键并集]；scalars → ['#','值'] */
  columns: string[];
  rows: TableCell[][];
  /** 行数（= rows.length），records 形态下等于数组元素数 */
  rowCount: number;
  /** 字段数：object 取 entries 数，records 取键并集大小，scalars 取元素数 */
  fieldCount: number;
  /** 因 TABLE_ROW_LIMIT 截断 */
  truncated: boolean;
}

export const TABLE_ROW_LIMIT = 5_000;
export const TABLE_CELL_MAX_CHARS = 200;

const EMPTY_CELL: TableCell = {
  text: '',
  full: '',
  path: null,
  type: null,
  drillable: false,
  truncated: false,
};

/**
 * 把节点转成表格模型。标量节点返回 null（调用方据此禁用入口）。
 * - object              → shape 'object'
 * - 全部元素为对象的数组 → shape 'records'
 * - 其他数组            → shape 'scalars'（含混合类型数组，元素整体压缩成一格）
 *
 * records 形态下列取所有元素键的并集，顺序 = 首次出现顺序；缺失字段的 cell
 * 为 { text: '', full: '', path: null, type: null, drillable: false, truncated: false }。
 * 重复键：同一对象内重复键取最后一个，与 JSON.parse 语义一致；path 标记为 null
 * （路径不唯一，禁用下钻和复制路径）。
 */
export function buildTableModel(node: JsonNode, sourcePath: string): TableModel | null {
  if (node.type === 'object') return buildObjectTable(node, sourcePath);
  if (node.type !== 'array') return null;

  if (node.items.every((item) => item.type === 'object')) {
    return buildRecordsTable(node.items, sourcePath);
  }
  return buildScalarsTable(node.items, sourcePath);
}

/** 整表转 TSV；复制时使用单元格的完整文本，而非截断后的显示文本。 */
export function tableToTsv(model: TableModel): string {
  const header = model.columns.map(escapeTsv).join('\t');
  const rows = model.rows.map((row) => row.map((cell) => escapeTsv(cell.full)).join('\t'));
  return [header, ...rows].join('\n');
}

/** 按 propertyPath 生成的路径语法取子节点；路径非法或不存在时返回 null。 */
export function nodeAtPath(root: JsonNode, path: string): JsonNode | null {
  if (typeof path !== 'string' || path === '' || path[0] !== '$') return null;
  if (path === '$') return root;

  let current: JsonNode = root;
  let position = 1;
  while (position < path.length) {
    if (path[position] === '.') {
      const step = readDotProperty(path, position);
      if (!step) return null;
      const next = objectValue(current, step.key);
      if (!next) return null;
      current = next;
      position = step.end;
      continue;
    }

    if (path[position] === '[') {
      const step = readBracketStep(path, position);
      if (!step) return null;
      const next = step.kind === 'property'
        ? objectValue(current, step.key)
        : arrayValue(current, step.index);
      if (!next) return null;
      current = next;
      position = step.end;
      continue;
    }

    return null;
  }
  return current;
}

function buildObjectTable(node: JsonObjectNode, sourcePath: string): TableModel {
  const lastEntries = lastEntriesByKey(node.entries);
  const duplicateKeys = duplicateKeySet(node.entries);
  const rows = node.entries.map((entry) => {
    const valueEntry = lastEntries.get(entry.key)!;
    const path = duplicateKeys.has(entry.key)
      ? null
      : propertyPath(sourcePath, entry.key, false);
    return [textCell(entry.key), nodeCell(valueEntry.value, path)];
  });

  return makeModel(
    'object',
    sourcePath,
    ['字段', '值'],
    rows,
    node.entries.length,
  );
}

function buildRecordsTable(items: JsonNode[], sourcePath: string): TableModel {
  const records = items as JsonObjectNode[];
  const columns: string[] = [];
  const columnSet = new Set<string>();
  for (const record of records) {
    for (const entry of record.entries) {
      if (columnSet.has(entry.key)) continue;
      columnSet.add(entry.key);
      columns.push(entry.key);
    }
  }

  const rows = records.slice(0, TABLE_ROW_LIMIT).map((record, index) => {
    const itemPath = propertyPath(sourcePath, String(index), true);
    const lastEntries = lastEntriesByKey(record.entries);
    const duplicateKeys = duplicateKeySet(record.entries);
    return [textCell(String(index)), ...columns.map((key) => {
      const entry = lastEntries.get(key);
      if (!entry) return { ...EMPTY_CELL };
      const path = duplicateKeys.has(key) ? null : propertyPath(itemPath, key, false);
      return nodeCell(entry.value, path);
    })];
  });

  return makeModel(
    'records',
    sourcePath,
    ['#', ...columns],
    rows,
    columns.length,
    items.length > TABLE_ROW_LIMIT,
  );
}

function buildScalarsTable(items: JsonNode[], sourcePath: string): TableModel {
  const rows = items.slice(0, TABLE_ROW_LIMIT).map((item, index) => [
    textCell(String(index)),
    nodeCell(item, propertyPath(sourcePath, String(index), true)),
  ]);

  return makeModel(
    'scalars',
    sourcePath,
    ['#', '值'],
    rows,
    items.length,
    items.length > TABLE_ROW_LIMIT,
  );
}

function makeModel(
  shape: TableShape,
  sourcePath: string,
  columns: string[],
  rows: TableCell[][],
  fieldCount: number,
  truncated = rows.length > TABLE_ROW_LIMIT,
): TableModel {
  const limitedRows = rows.slice(0, TABLE_ROW_LIMIT);
  return {
    shape,
    sourcePath,
    columns,
    rows: limitedRows,
    rowCount: limitedRows.length,
    fieldCount,
    truncated,
  };
}

function textCell(value: string): TableCell {
  return makeCell(value, null, null, false);
}

function nodeCell(node: JsonNode, path: string | null): TableCell {
  const full = node.type === 'string' && typeof node.value === 'string'
    ? node.value
    : minifyJsonNode(node);
  const drillable = path !== null && isContainer(node);
  return makeCell(full, path, node.type, drillable);
}

function makeCell(
  full: string,
  path: string | null,
  type: JsonNode['type'] | null,
  drillable: boolean,
): TableCell {
  const truncated = full.length > TABLE_CELL_MAX_CHARS;
  return {
    text: truncated ? full.slice(0, TABLE_CELL_MAX_CHARS) : full,
    full,
    path,
    type,
    drillable,
    truncated,
  };
}

function lastEntriesByKey(entries: JsonObjectEntry[]): Map<string, JsonObjectEntry> {
  const result = new Map<string, JsonObjectEntry>();
  for (const entry of entries) result.set(entry.key, entry);
  return result;
}

function duplicateKeySet(entries: JsonObjectEntry[]): Set<string> {
  const counts = new Map<string, number>();
  for (const entry of entries) counts.set(entry.key, (counts.get(entry.key) ?? 0) + 1);
  return new Set([...counts].filter(([, count]) => count > 1).map(([key]) => key));
}

function isContainer(node: JsonNode): boolean {
  return node.type === 'object' || node.type === 'array';
}

function escapeTsv(value: string): string {
  return value.replace(/[\t\r\n]/g, ' ');
}

function objectValue(node: JsonNode, key: string): JsonNode | null {
  if (node.type !== 'object') return null;
  let result: JsonNode | null = null;
  for (const entry of node.entries) {
    if (entry.key === key) result = entry.value;
  }
  return result;
}

function arrayValue(node: JsonNode, index: number): JsonNode | null {
  return node.type === 'array' && index >= 0 && index < node.items.length
    ? node.items[index]
    : null;
}

interface DotPropertyStep {
  key: string;
  end: number;
}

function readDotProperty(path: string, start: number): DotPropertyStep | null {
  const first = path[start + 1];
  if (!first || !/[A-Za-z_$]/.test(first)) return null;
  let end = start + 2;
  while (end < path.length && /[A-Za-z0-9_$]/.test(path[end])) end++;
  return { key: path.slice(start + 1, end), end };
}

type BracketStep =
  | { kind: 'property'; key: string; end: number }
  | { kind: 'index'; index: number; end: number };

function readBracketStep(path: string, start: number): BracketStep | null {
  const first = path[start + 1];
  if (first === '"') {
    const quoteEnd = readJsonStringEnd(path, start + 1);
    if (quoteEnd < 0 || path[quoteEnd + 1] !== ']') return null;
    try {
      const key = JSON.parse(path.slice(start + 1, quoteEnd + 1)) as unknown;
      return typeof key === 'string' ? { kind: 'property', key, end: quoteEnd + 2 } : null;
    } catch {
      return null;
    }
  }

  const close = path.indexOf(']', start + 1);
  if (close < 0) return null;
  const content = path.slice(start + 1, close);
  if (!/^\d+$/.test(content) || (content.length > 1 && content[0] === '0')) return null;
  const index = Number(content);
  return Number.isSafeInteger(index) ? { kind: 'index', index, end: close + 1 } : null;
}

function readJsonStringEnd(value: string, start: number): number {
  let escaped = false;
  for (let index = start + 1; index < value.length; index++) {
    const character = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '\\') {
      escaped = true;
      continue;
    }
    if (character === '"') return index;
  }
  return -1;
}
