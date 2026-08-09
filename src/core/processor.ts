import { jsonrepair } from 'jsonrepair';
import type {
  AppSettings,
  ProcessingMeta,
  WorkerOperation,
  WorkerRequest,
  WorkerResponse,
} from '../types';
import { diagnosticFromError, parseJson } from './json-parser';
import { diffJsonNodes } from './json-diff';
import { runQuery, type QueryResult } from './json-query';
import {
  byteLength,
  calculateStats,
  collectDuplicateKeyWarnings,
  formatJsonNode,
  minifyJsonNode,
  sortJsonNode,
} from './json-transform';

export function processWorkerRequest(request: WorkerRequest): WorkerResponse {
  const startedAt = now();
  try {
    const output = processOperation(request.operation, request.source, request.options);
    const meta: ProcessingMeta = {
      operation: request.operation,
      durationMs: Math.max(0, now() - startedAt),
      inputBytes: byteLength(request.source),
      outputBytes: byteLength(output.result),
      valid: output.valid,
      ...(output.empty ? { empty: true } : {}),
      ...(output.stats ? { stats: output.stats } : {}),
      ...(output.warnings.length > 0 ? { warnings: output.warnings } : {}),
    };
    return {
      requestId: request.requestId,
      ok: true,
      result: output.result,
      meta,
      ...(output.data === undefined ? {} : { data: output.data }),
    };
  } catch (error) {
    return {
      requestId: request.requestId,
      ok: false,
      error: diagnosticFromError(request.source, error),
    };
  }
}

interface OperationResult {
  result: string;
  valid: boolean;
  empty?: boolean;
  stats?: ReturnType<typeof calculateStats>;
  warnings: ReturnType<typeof collectDuplicateKeyWarnings>;
  data?: unknown;
}

function processOperation(
  operation: WorkerOperation,
  source: string,
  options: Record<string, unknown> | undefined,
): OperationResult {
  if (operation === 'escape') {
    return { result: escapeString(source), valid: true, warnings: [] };
  }
  if (operation === 'unescape') {
    return { result: unescapeString(source), valid: true, warnings: [] };
  }
  if (operation === 'repair') {
    const repaired = jsonrepair(source);
    const root = parseJson(repaired);
    const result = options?.format === false ? repaired : formatJsonNode(root, readIndent(options));
    return {
      result,
      valid: true,
      stats: calculateStats(result, root),
      warnings: collectDuplicateKeyWarnings(repaired, root),
    };
  }

  if (source.trim() === '' && (operation === 'validate' || operation === 'stats')) {
    const stats = calculateStats(source, null);
    return {
      result: operation === 'stats' ? JSON.stringify(stats) : source,
      valid: false,
      empty: true,
      ...(operation === 'stats' ? { stats } : {}),
      warnings: [],
    };
  }

  const root = parseJson(source);
  const warnings = collectDuplicateKeyWarnings(source, root);
  const stats = calculateStats(source, root);

  switch (operation) {
    case 'validate':
      return { result: source, valid: true, stats, warnings };
    case 'format':
      return { result: formatJsonNode(root, readIndent(options)), valid: true, stats, warnings };
    case 'minify':
      return { result: minifyJsonNode(root), valid: true, stats, warnings };
    case 'sort': {
      const sorted = sortJsonNode(root);
      const result = options?.compact
        ? minifyJsonNode(sorted)
        : formatJsonNode(sorted, readIndent(options));
      return { result, valid: true, stats: calculateStats(result, sorted), warnings };
    }
    case 'stats':
      return { result: JSON.stringify(stats), valid: true, stats, warnings };
    case 'query': {
      const query = typeof options?.input === 'string' ? options.input : '';
      const data: QueryResult = runQuery(root, query);
      return {
        result: data.error ? `查询失败：${data.error}` : `命中 ${data.hits.length} 处${data.truncated ? '（已截断）' : ''}`,
        valid: true,
        stats,
        warnings,
        data,
      };
    }
    case 'diff': {
      const other = typeof options?.other === 'string' ? options.other : '';
      const right = parseJson(other);
      const data = diffJsonNodes(root, right);
      return {
        result: `+${data.summary.added} ~${data.summary.changed} -${data.summary.removed}`,
        valid: true,
        stats,
        warnings,
        data,
      };
    }
    default:
      return assertNever(operation);
  }
}

function escapeString(source: string): string {
  const encoded = JSON.stringify(source);
  return encoded.slice(1, -1);
}

function unescapeString(source: string): string {
  const trimmed = source.trim();
  const wrapped = trimmed.startsWith('"') && trimmed.endsWith('"') ? trimmed : `"${source}"`;
  const parsed = JSON.parse(wrapped) as unknown;
  if (typeof parsed !== 'string') {
    throw new TypeError('反转义内容必须是 JSON 字符串');
  }
  return parsed;
}

function readIndent(options: Record<string, unknown> | undefined): AppSettings['indent'] {
  const indent = options?.indent;
  return indent === 4 || indent === 'tab' ? indent : 2;
}

function now(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}

function assertNever(value: never): never {
  throw new Error(`不支持的操作：${String(value)}`);
}
