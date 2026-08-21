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

/**
 * 递归清掉字符串（含对象键）里表示换行/回车/制表的转义序列，直接删除不补空格。
 * 只动 \n \r \t 与等价的 Unicode 写法，其余转义（\" \\ \/ \b \f、其他 \uXXXX）
 * 按原样保留 —— 这样输出仍是原 token 的最小改动版本，不会因为重新序列化而改写无关转义。
 */
export function stripEscapedNewlines(node: JsonNode): JsonNode {
  if (node.type === 'array') {
    return { ...node, items: node.items.map(stripEscapedNewlines) };
  }
  if (node.type === 'object') {
    return {
      ...node,
      entries: node.entries.map((entry) => {
        const keyRaw = stripWhitespaceEscapes(entry.keyRaw);
        return {
          ...entry,
          keyRaw,
          key: JSON.parse(keyRaw) as string,
          value: stripEscapedNewlines(entry.value),
        };
      }),
    };
  }
  if (node.type !== 'string') return node;

  const raw = stripWhitespaceEscapes(node.raw);
  if (raw === node.raw) return node;
  return { ...node, raw, value: JSON.parse(raw) as string };
}

/**
 * 逐字符扫描 JSON 字符串 token（含首尾引号），只丢弃空白类转义。
 *
 * 换行/回车后紧跟的缩进也一并吃掉：这类内容多半是终端或日志把长行硬折断留下的
 * 「换行 + 下一行缩进」，只删换行会让 "resource\n  Category" 变成 "resource  Category"，
 * 断点仍然没接上。代价是真多行文本的行首缩进会丢，但那种文本按下本按钮本就是要压平。
 */
function stripWhitespaceEscapes(raw: string): string {
  if (!raw.includes('\\')) return raw;

  let result = '';
  let index = 0;
  while (index < raw.length) {
    if (raw[index] !== '\\') {
      result += raw[index];
      index++;
      continue;
    }

    const escape = readWhitespaceEscape(raw, index);
    if (!escape) {
      // \\ 必须整对搬走，否则后面的字面 n 会被误当成转义序列。
      const width = raw[index + 1] === 'u' ? 6 : 2;
      result += raw.slice(index, index + width);
      index += width;
      continue;
    }

    index += escape.width;
    if (escape.kind !== 'break') continue;
    // 折行处的缩进：字面空格，以及被转义写法表示的空白，连续吃到非空白为止。
    while (index < raw.length) {
      if (raw[index] === ' ') {
        index++;
        continue;
      }
      const following = readWhitespaceEscape(raw, index);
      if (!following) break;
      index += following.width;
    }
  }
  return result;
}

/**
 * 识别 index 处是否为空白类转义，返回它占的字符宽度。
 * break 表示换行/回车（会触发吃缩进），indent 表示制表符。
 */
function readWhitespaceEscape(
  raw: string,
  index: number,
): { kind: 'break' | 'indent'; width: number } | null {
  if (raw[index] !== '\\') return null;
  const escaped = raw[index + 1];
  if (escaped === 'n' || escaped === 'r') return { kind: 'break', width: 2 };
  if (escaped === 't') return { kind: 'indent', width: 2 };
  if (escaped !== 'u') return null;

  const code = Number.parseInt(raw.slice(index + 2, index + 6), 16);
  if (code === 0x0a || code === 0x0d) return { kind: 'break', width: 6 };
  if (code === 0x09) return { kind: 'indent', width: 6 };
  return null;
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
