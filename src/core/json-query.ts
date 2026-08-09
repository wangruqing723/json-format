import type { JsonNode } from './json-parser';
import { propertyPath } from './json-path';

export type QueryMode = 'jsonpath' | 'substring';

export interface QueryHit {
  path: string;
  reason: 'key' | 'value' | 'path';
  offset: number;
}

export interface QueryResult {
  mode: QueryMode;
  hits: QueryHit[];
  error: string | null;
  truncated: boolean;
}

export const QUERY_HIT_LIMIT = 5_000;

export function detectQueryMode(input: string): QueryMode {
  return input.trimStart().startsWith('$') ? 'jsonpath' : 'substring';
}

interface QueryStep {
  type: 'property' | 'index' | 'wildcard' | 'recursive';
  key?: string;
  index?: number;
}

interface Candidate {
  node: JsonNode;
  path: string;
}

export function runQuery(root: JsonNode, input: string): QueryResult {
  const query = input.trim();
  const mode = detectQueryMode(query);
  if (mode === 'substring') return runSubstringQuery(root, query);

  const parsed = parseJsonPath(query);
  if (typeof parsed === 'string') return { mode, hits: [], error: parsed, truncated: false };
  if (parsed.length === 0) return { mode, hits: [{ path: '$', reason: 'path', offset: root.offset }], error: null, truncated: false };

  let candidates: Candidate[] = [{ node: root, path: '$' }];
  for (const step of parsed) {
    candidates = applyStep(candidates, step);
    if (candidates.length === 0) break;
  }
  const hits = candidates.slice(0, QUERY_HIT_LIMIT).map((candidate) => ({
    path: candidate.path,
    reason: 'path' as const,
    offset: candidate.node.offset,
  }));
  return { mode, hits, error: null, truncated: candidates.length > QUERY_HIT_LIMIT };
}

function runSubstringQuery(root: JsonNode, query: string): QueryResult {
  if (query === '') return { mode: 'substring', hits: [], error: null, truncated: false };
  const needle = query.toLocaleLowerCase();
  const hits: QueryHit[] = [];
  let truncated = false;
  const stack: Array<{ node: JsonNode; path: string; key?: string }> = [{ node: root, path: '$' }];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current.key !== undefined && current.key.toLocaleLowerCase().includes(needle)) {
      if (hits.length >= QUERY_HIT_LIMIT) { truncated = true; break; }
      hits.push({ path: current.path, reason: 'key', offset: current.node.offset });
    }
    if (primitiveText(current.node).toLocaleLowerCase().includes(needle)) {
      if (hits.length >= QUERY_HIT_LIMIT) { truncated = true; break; }
      hits.push({ path: current.path, reason: 'value', offset: current.node.offset });
    }

    if (current.node.type === 'array') {
      for (let index = current.node.items.length - 1; index >= 0; index--) {
        stack.push({ node: current.node.items[index], path: propertyPath(current.path, String(index), true) });
      }
    } else if (current.node.type === 'object') {
      for (let index = current.node.entries.length - 1; index >= 0; index--) {
        const entry = current.node.entries[index];
        stack.push({
          node: entry.value,
          path: propertyPath(current.path, entry.key, false),
          key: entry.key,
        });
      }
    }
  }
  return { mode: 'substring', hits, error: null, truncated };
}

function primitiveText(node: JsonNode): string {
  if (node.type === 'string') return node.value as string;
  if (node.type === 'number' || node.type === 'boolean' || node.type === 'null') return node.raw;
  return '';
}

function applyStep(candidates: Candidate[], step: QueryStep): Candidate[] {
  if (step.type === 'recursive') {
    const result: Candidate[] = [];
    for (const candidate of candidates) collectRecursive(candidate.node, candidate.path, step.key!, result);
    return result;
  }
  const result: Candidate[] = [];
  for (const candidate of candidates) {
    if (candidate.node.type === 'array') {
      if (step.type === 'index' && step.index! >= 0 && step.index! < candidate.node.items.length) {
        result.push({
          node: candidate.node.items[step.index!],
          path: propertyPath(candidate.path, String(step.index!), true),
        });
      } else if (step.type === 'wildcard') {
        candidate.node.items.forEach((node, index) => result.push({
          node,
          path: propertyPath(candidate.path, String(index), true),
        }));
      }
      continue;
    }
    if (candidate.node.type !== 'object') continue;
    for (const entry of candidate.node.entries) {
      const matches = step.type === 'property' ? entry.key === step.key : step.type === 'wildcard';
      if (matches) result.push({ node: entry.value, path: propertyPath(candidate.path, entry.key, false) });
    }
  }
  return result;
}

function collectRecursive(node: JsonNode, path: string, key: string, result: Candidate[]): void {
  const stack: Candidate[] = [{ node, path }];
  while (stack.length) {
    const current = stack.pop()!;
    if (current.node.type === 'array') {
      for (let index = current.node.items.length - 1; index >= 0; index--) {
        stack.push({ node: current.node.items[index], path: propertyPath(current.path, String(index), true) });
      }
    } else if (current.node.type === 'object') {
      for (let index = current.node.entries.length - 1; index >= 0; index--) {
        const entry = current.node.entries[index];
        const childPath = propertyPath(current.path, entry.key, false);
        if (entry.key === key) result.push({ node: entry.value, path: childPath });
        stack.push({ node: entry.value, path: childPath });
      }
    }
  }
}

function parseJsonPath(query: string): QueryStep[] | string {
  if (query === '$') return [];
  if (!query.startsWith('$')) return 'JSONPath 必须以 $ 开头';
  if (query.includes('?(') || /\?\s*\(/.test(query)) return '暂不支持过滤表达式 ?()';
  const steps: QueryStep[] = [];
  let index = 1;
  while (index < query.length) {
    if (query[index] === '.') {
      if (query[index + 1] === '.') {
        index += 2;
        const start = index;
        while (index < query.length && /[A-Za-z0-9_$]/.test(query[index])) index++;
        if (start === index) return '递归下降后必须指定属性名';
        steps.push({ type: 'recursive', key: query.slice(start, index) });
        continue;
      }
      index++;
      if (query[index] === '*') {
        steps.push({ type: 'wildcard' });
        index++;
        continue;
      }
      const start = index;
      while (index < query.length && /[A-Za-z0-9_$]/.test(query[index])) index++;
      if (start === index || !/^[A-Za-z_$]/.test(query[start])) return 'JSONPath 属性名无效';
      steps.push({ type: 'property', key: query.slice(start, index) });
      continue;
    }
    if (query[index] === '[') {
      const end = findClosingBracket(query, index);
      if (end < 0) return 'JSONPath 缺少右方括号';
      const content = query.slice(index + 1, end).trim();
      if (content.includes(':')) return '暂不支持数组切片 [1:5]';
      if (content.includes(',')) return '暂不支持数组并集 [0,2]';
      if (content === '*') steps.push({ type: 'wildcard' });
      else if (/^\d+$/.test(content)) steps.push({ type: 'index', index: Number(content) });
      else if (content.startsWith('"') && content.endsWith('"')) {
        try {
          const key = JSON.parse(content) as unknown;
          if (typeof key !== 'string') return 'JSONPath 括号属性必须是字符串';
          steps.push({ type: 'property', key });
        } catch {
          return 'JSONPath 括号属性字符串无效';
        }
      } else return 'JSONPath 方括号语法无效';
      index = end + 1;
      continue;
    }
    if (query[index] === '(') return '暂不支持函数语法';
    return `JSONPath 语法无效：${query[index]}`;
  }
  return steps;
}

function findClosingBracket(query: string, start: number): number {
  let quote = false;
  let escaped = false;
  for (let index = start + 1; index < query.length; index++) {
    const character = query[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quote = false;
    } else if (character === '"') quote = true;
    else if (character === ']') return index;
  }
  return -1;
}
