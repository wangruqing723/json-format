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

  it('去除换行删掉字符串值内的 \\n \\r \\t 且不补空格', () => {
    const response = expectSuccess(
      process('strip-newlines', '{"msg":"第一行\\n第二行","win":"a\\r\\nb","tab":"x\\ty"}', { compact: true }),
    );

    expect(response.result).toBe('{"msg":"第一行第二行","win":"ab","tab":"xy"}');
  });

  it('去除换行把折行处的缩进一并吃掉，断点真正接上', () => {
    // 终端硬折断长行 → 修复转成 \n + 下一行缩进；只删 \n 会残留空格，断点接不上。
    const response = expectSuccess(
      process('strip-newlines', '{"resource\\n  Category":"oss/asset/\\n    2026/06/a.pdf"}', { compact: true }),
    );

    expect(response.result).toBe('{"resourceCategory":"oss/asset/2026/06/a.pdf"}');
  });

  it('去除换行只吃换行后的缩进，换行前的空格照旧保留', () => {
    const response = expectSuccess(
      process('strip-newlines', '{"text":"句子一 \\n  句子二"}', { compact: true }),
    );

    expect(response.result).toBe('{"text":"句子一 句子二"}');
  });

  it('去除换行同时处理 Unicode 等价写法和对象键', () => {
    const response = expectSuccess(
      process('strip-newlines', '{"k\\u000Aey":"v\\u000D\\u0009w"}', { compact: true }),
    );

    expect(response.result).toBe('{"key":"vw"}');
  });

  it('去除换行保留其他转义，不误伤字面反斜杠后的 n', () => {
    const response = expectSuccess(
      process('strip-newlines', '{"path":"C:\\\\new\\\\tmp","quote":"say \\"hi\\"","uni":"\\u00e9"}', { compact: true }),
    );

    // "C:\\new\\tmp" 里的 \\ 是字面反斜杠，后面的 n/t 是普通字母，必须原样留下。
    expect(response.result).toBe('{"path":"C:\\\\new\\\\tmp","quote":"say \\"hi\\"","uni":"\\u00e9"}');
  });

  it('去除换行让键撞成重复时按输出位置报告警告', () => {
    const response = expectSuccess(process('strip-newlines', '{"a\\nb":1,"ab":2}', { compact: true }));

    expect(response.result).toBe('{"ab":1,"ab":2}');
    expect(response.meta.warnings).toHaveLength(1);
    expect(response.meta.warnings?.[0]).toMatchObject({ code: 'DUPLICATE_KEY', severity: 'warning' });
  });

  it('去除换行默认按缩进重排，物理换行属于排版不受影响', () => {
    const response = expectSuccess(process('strip-newlines', '{"msg":"a\\nb"}'));

    expect(response.result).toBe('{\n  "msg": "ab"\n}');
  });

  it('修复并去除换行一步接回被终端硬折断的长行', () => {
    // 字符串中间是真实换行 + 下一行缩进：终端/日志折断长行的典型产物。
    const source = [
      '{',
      '  "assetPackUrl": "oss/eduzhiyuan/asset/',
      '  2026/06/16/1781597774065_9c1e544b579ae20f.pdf",',
      '  "resource',
      '  Category": "prepare",',
      '  "treeNodes": { "chapter": ["013_',
      '      001"] }',
      '}',
    ].join('\n');

    // 组合操作和单独修复一样按缩进重排，不接受 compact。
    const response = expectSuccess(process('repair-strip-newlines', source));

    expect(response.result).toBe([
      '{',
      '  "assetPackUrl": "oss/eduzhiyuan/asset/2026/06/16/1781597774065_9c1e544b579ae20f.pdf",',
      '  "resourceCategory": "prepare",',
      '  "treeNodes": {',
      '    "chapter": [',
      '      "013_001"',
      '    ]',
      '  }',
      '}',
    ].join('\n'));
  });

  it('单独修复保持原语义，只把字面换行转成转义而不接回折行', () => {
    const response = expectSuccess(process('repair', '{"a":"x\ny"}'));

    expect(response.result).toBe('{\n  "a": "x\\ny"\n}');
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
