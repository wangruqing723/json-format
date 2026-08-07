import { describe, expect, it } from 'vitest';
import type { WorkerOperation, WorkerResponse } from '../types';
import { processWorkerRequest } from './processor';

function process(
  operation: WorkerOperation,
  source: string,
  options?: Record<string, unknown>,
): WorkerResponse {
  return processWorkerRequest({ requestId: 'request-1', operation, source, options });
}

function expectSuccess(response: WorkerResponse): Extract<WorkerResponse, { ok: true }> {
  expect(response.ok).toBe(true);
  if (!response.ok) throw new Error(response.error.message);
  return response;
}

describe('processWorkerRequest', () => {
  it('格式化时保留超出安全整数范围和指数形式的原始 token', () => {
    const response = expectSuccess(
      process('format', '{"id":900719925474099312345,"ratio":1.2300e+04}'),
    );

    expect(response.result).toBe(
      '{\n  "id": 900719925474099312345,\n  "ratio": 1.2300e+04\n}',
    );
  });

  it('压缩时只移除结构空白并保留字符串内容', () => {
    const response = expectSuccess(
      process('minify', '{\n  "text": "a b", "big": 99999999999999999999\n}'),
    );

    expect(response.result).toBe('{"text":"a b","big":99999999999999999999}');
  });

  it('递归排序对象键但保持数组顺序', () => {
    const response = expectSuccess(
      process('sort', '{"z":{"b":1,"a":2},"a":[{"d":3,"c":4},0]}', { compact: true }),
    );

    expect(response.result).toBe('{"a":[{"c":4,"d":3},0],"z":{"a":2,"b":1}}');
  });

  it('非法 JSON 返回首个错误的行列和上下文', () => {
    const response = process('validate', '{\n  "ok": true,\n  "bad" false\n}');

    expect(response.ok).toBe(false);
    if (response.ok) return;
    expect(response.error).toMatchObject({
      line: 3,
      column: 9,
      code: 'INVALID_JSON',
      severity: 'error',
      context: '  "bad" false',
    });
    expect(response.error.message).toContain('冒号');
  });

  it('重复键通过 warning 明确报告且不丢弃 token', () => {
    const response = expectSuccess(process('format', '{"a":1,"a":2}'));

    expect(response.result).toContain('"a": 1');
    expect(response.result).toContain('"a": 2');
    expect(response.meta.warnings).toHaveLength(1);
    expect(response.meta.warnings?.[0]).toMatchObject({
      code: 'DUPLICATE_KEY',
      severity: 'warning',
      line: 1,
    });
  });

  it('确定性修复常见的缺引号键和尾逗号', () => {
    const response = expectSuccess(process('repair', "{name: 'forge',}"));

    expect(response.result).toBe('{\n  "name": "forge"\n}');
  });

  it('转义和反转义可以往返', () => {
    const source = 'line 1\n"line 2"\\path';
    const escaped = expectSuccess(process('escape', source)).result;
    const unescaped = expectSuccess(process('unescape', escaped)).result;

    expect(unescaped).toBe(source);
  });

  it('统计节点、深度和 UTF-8 字节数', () => {
    const response = expectSuccess(process('stats', '{"名":[1,true,null,"值"]}'));
    const stats = JSON.parse(response.result) as Record<string, number>;

    expect(stats).toMatchObject({
      nodes: 6,
      objects: 1,
      arrays: 1,
      keys: 1,
      numbers: 1,
      booleans: 1,
      nulls: 1,
      strings: 1,
      maxDepth: 3,
    });
    expect(stats.bytes).toBeGreaterThan(stats.characters);
    expect(response.meta.stats).toEqual(stats);
  });

  it('空文档校验返回非致命编辑态', () => {
    const response = expectSuccess(process('validate', '  '));

    expect(response.result).toBe('  ');
    expect(response.meta).toMatchObject({ valid: false, empty: true });
  });

  it('转换失败给出错误且响应中不包含替换内容', () => {
    const response = process('format', '{broken}');

    expect(response.ok).toBe(false);
    expect(response).not.toHaveProperty('result');
  });
});
