import { describe, expect, it } from 'vitest';
import { parseJson } from './json-parser';
import { detectQueryMode, runQuery } from './json-query';

const root = parseJson('{"tokens":{"id_token":"abc","odd key":true},"data":[{"email":"a@example.com"},{"email":"b@example.com"}]}');

describe('json-query', () => {
  it('支持全部 JSONPath 子集语法', () => {
    expect(runQuery(root, '$').hits.map((hit) => hit.path)).toEqual(['$']);
    expect(runQuery(root, '$.tokens.id_token').hits.map((hit) => hit.path)).toEqual(['$.tokens.id_token']);
    expect(runQuery(root, '$["tokens"]["odd key"]').hits.map((hit) => hit.path)).toEqual(['$.tokens["odd key"]']);
    expect(runQuery(root, '$.data[1]').hits.map((hit) => hit.path)).toEqual(['$.data[1]']);
    expect(runQuery(root, '$.data[*].email').hits.map((hit) => hit.path)).toEqual(['$.data[0].email', '$.data[1].email']);
    expect(runQuery(root, '$.*').hits.map((hit) => hit.path)).toEqual(['$.tokens', '$.data']);
    expect(runQuery(root, '$..email').hits.map((hit) => hit.path)).toEqual(['$.data[0].email', '$.data[1].email']);
  });

  it('区分 JSONPath 与大小写不敏感的子串过滤', () => {
    expect(detectQueryMode('email')).toBe('substring');
    const result = runQuery(root, 'ABC');
    expect(result.hits).toEqual([expect.objectContaining({ path: '$.tokens.id_token', reason: 'value' })]);
    expect(runQuery(root, 'ID_TOKEN').hits).toEqual([expect.objectContaining({ path: '$.tokens.id_token', reason: 'key' })]);
  });

  it('对不支持语法给出明确中文错误', () => {
    expect(runQuery(root, '$.data[?(@.email)]').error).toContain('过滤表达式');
    expect(runQuery(root, '$.data[1:5]').error).toContain('数组切片');
    expect(runQuery(root, '$.data[0,2]').error).toContain('数组并集');
    expect(runQuery(root, '$.data[1:5]').hits).toEqual([]);
  });

  it('超过命中上限时截断', () => {
    const many = parseJson(JSON.stringify(Array.from({ length: 5_100 }, (_, index) => `value-${index}`)));
    const result = runQuery(many, 'value');
    expect(result.hits).toHaveLength(5_000);
    expect(result.truncated).toBe(true);
  });
});
