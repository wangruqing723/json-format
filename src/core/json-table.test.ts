import { describe, expect, it } from 'vitest';
import { parseJson } from './json-parser';
import {
  buildTableModel,
  nodeAtPath,
  TABLE_CELL_MAX_CHARS,
  TABLE_ROW_LIMIT,
  tableToTsv,
} from './json-table';

describe('buildTableModel', () => {
  it('把对象转成字段和值两列', () => {
    const model = buildTableModel(parseJson('{"name":"Forge","count":2,"meta":{"ok":true}}'), '$');

    expect(model).toMatchObject({
      shape: 'object',
      sourcePath: '$',
      columns: ['字段', '值'],
      rowCount: 3,
      fieldCount: 3,
      truncated: false,
    });
    expect(model?.rows.map((row) => row.map((cell) => cell.text))).toEqual([
      ['name', 'Forge'],
      ['count', '2'],
      ['meta', '{"ok":true}'],
    ]);
    expect(model?.rows[0][1]).toMatchObject({
      full: 'Forge',
      path: '$.name',
      type: 'string',
      drillable: false,
      truncated: false,
    });
    expect(model?.rows[2][1]).toMatchObject({
      path: '$.meta',
      type: 'object',
      drillable: true,
    });
  });

  it('将全对象数组转为 records，按首次出现顺序合并键且缺失字段留空', () => {
    const model = buildTableModel(
      parseJson('[{"a":1,"b":2},{"b":3,"c":4},{"a":5}]'),
      '$.items',
    );

    expect(model).toMatchObject({
      shape: 'records',
      sourcePath: '$.items',
      columns: ['#', 'a', 'b', 'c'],
      rowCount: 3,
      fieldCount: 3,
      truncated: false,
    });
    expect(model?.rows.map((row) => row.map((cell) => cell.text))).toEqual([
      ['0', '1', '2', ''],
      ['1', '', '3', '4'],
      ['2', '5', '', ''],
    ]);
    expect(model?.rows[1][1]).toEqual({
      text: '',
      full: '',
      path: null,
      type: null,
      drillable: false,
      truncated: false,
    });
    expect(model?.rows[0][1]).toMatchObject({ path: '$.items[0].a', type: 'number' });
  });

  it('将标量数组和混合数组按元素整体转为 scalars', () => {
    const scalarModel = buildTableModel(parseJson('[1,"two",null]'), '$.values');
    const mixedModel = buildTableModel(parseJson('[{"id":1},false,[2,3]]'), '$');

    expect(scalarModel).toMatchObject({
      shape: 'scalars',
      columns: ['#', '值'],
      rowCount: 3,
      fieldCount: 3,
    });
    expect(scalarModel?.rows.map((row) => row.map((cell) => cell.text))).toEqual([
      ['0', '1'],
      ['1', 'two'],
      ['2', 'null'],
    ]);
    expect(mixedModel).toMatchObject({ shape: 'scalars', columns: ['#', '值'], rowCount: 3 });
    expect(mixedModel?.rows[0][1]).toMatchObject({ full: '{"id":1}', type: 'object', drillable: true });
    expect(mixedModel?.rows[2][1]).toMatchObject({ full: '[2,3]', type: 'array', drillable: true });
  });

  it('标量节点不可表格化', () => {
    expect(buildTableModel(parseJson('null'), '$')).toBeNull();
    expect(buildTableModel(parseJson('"value"'), '$')).toBeNull();
  });

  it('重复键取最后值并禁用不唯一的路径', () => {
    const model = buildTableModel(parseJson('[{"id":1,"id":2,"name":"ok"}]'), '$');

    expect(model?.columns).toEqual(['#', 'id', 'name']);
    expect(model?.rows[0][1]).toMatchObject({
      text: '2',
      full: '2',
      path: null,
      type: 'number',
      drillable: false,
    });
    expect(model?.rows[0][2]).toMatchObject({ path: '$[0].name', full: 'ok' });
  });

  it('限制表格行数并保留超长单元格的完整复制文本', () => {
    const many = Array.from({ length: TABLE_ROW_LIMIT + 1 }, (_, index) => ({
      value: index === 0 ? 'x'.repeat(TABLE_CELL_MAX_CHARS + 1) : index,
    }));
    const model = buildTableModel(parseJson(JSON.stringify(many)), '$');

    expect(model).toMatchObject({
      rowCount: TABLE_ROW_LIMIT,
      fieldCount: 1,
      truncated: true,
    });
    expect(model?.rows[0][1]).toMatchObject({
      text: 'x'.repeat(TABLE_CELL_MAX_CHARS),
      full: 'x'.repeat(TABLE_CELL_MAX_CHARS + 1),
      truncated: true,
    });
  });
});

describe('tableToTsv', () => {
  it('使用完整文本并把 tab、换行和回车替换为空格', () => {
    const model = buildTableModel(parseJson(JSON.stringify({ a: 'one\ttwo\nthree', b: 'ok' })), '$')!;

    expect(tableToTsv(model)).toBe('字段\t值\na\tone two three\nb\tok');
  });
});

describe('nodeAtPath', () => {
  const root = parseJson(
    '{"simple":{"with space":{"items":[{"value":1},2]},"a.b":"dot"},"list":["zero",{"name":"one"}]}',
  );

  it('支持根节点、点号属性、带空格键、数组下标及嵌套', () => {
    expect(nodeAtPath(root, '$')).toBe(root);
    expect(nodeAtPath(root, '$.simple')?.type).toBe('object');
    expect(nodeAtPath(root, '$.simple["with space"]["items"][0].value')?.raw).toBe('1');
    expect(nodeAtPath(root, '$.list[0]')?.value).toBe('zero');
    expect(nodeAtPath(root, '$.list[1].name')?.value).toBe('one');
    expect(nodeAtPath(root, '$["simple"]["a.b"]')?.value).toBe('dot');
  });

  it('路径非法或不存在时返回 null', () => {
    for (const path of [
      '',
      'simple',
      '$.',
      '$.simple.',
      '$.missing',
      '$.list[9]',
      '$.list[-1]',
      '$.list[01]',
      '$.list[not-index]',
      '$.list[0',
      '$["unterminated]',
      '$.list[0].value.extra',
    ]) {
      expect(nodeAtPath(root, path), path).toBeNull();
    }
  });

  it('按最后一个重复键取值', () => {
    const duplicate = parseJson('{"key":1,"key":2}');
    expect(nodeAtPath(duplicate, '$.key')?.raw).toBe('2');
  });
});
