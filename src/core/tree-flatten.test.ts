import { describe, expect, it } from 'vitest';
import { parseJson } from './json-parser';
import {
  collapseAll,
  collapseSubtree,
  createExpandState,
  expandAll,
  expandSubtree,
  flattenTree,
  isExpanded,
  isSubtreeFullyExpanded,
  countVisibleRows,
  revealPath,
  type ExpandState,
} from './tree-flatten';

describe('tree-flatten', () => {
  it('处理空对象和纯数组', () => {
    const state = createExpandState();
    // 容器不再产出闭合行（}/]）：展开的空对象只有自身一行。
    expect(flattenTree(parseJson('{}'), state).map((row) => row.kind)).toEqual(['open']);
    expect(flattenTree(parseJson('[1,2]'), state).map((row) => row.path)).toEqual(['$', '$[0]', '$[1]']);
  });

  it('展开的容器不产出闭合括号行', () => {
    const rows = flattenTree(parseJson('{"a":{"b":1}}'), expandAll(createExpandState()));
    // 树视图靠缩进表达层级，不需要 }/] 收尾行；确保没有任何行的标签是闭合括号。
    expect(rows.some((row) => row.label === '}' || row.label === ']')).toBe(false);
    expect(rows.every((row) => row.kind === 'open' || row.kind === 'value')).toBe(true);
  });

  it('迭代处理 20 层嵌套', () => {
    let source = '0';
    for (let index = 0; index < 20; index++) source = `{"level${index}":${source}}`;
    const rows = flattenTree(parseJson(source), expandAll(createExpandState()));
    expect(rows.some((row) => row.path === '$.level19.level18.level17')).toBe(true);
  });

  it('保留重复键并标注歧义', () => {
    const rows = flattenTree(parseJson('{"key":1,"key":2}'), createExpandState());
    expect(rows.filter((row) => row.label === 'key')).toHaveLength(2);
    expect(rows.filter((row) => row.label === 'key').every((row) => row.ambiguous)).toBe(true);
  });

  it('支持 default/all/none 三种 baseline', () => {
    const root = parseJson('{"a":{"b":{"c":1}}}');
    expect(flattenTree(root, createExpandState()).map((row) => row.path)).toContain('$.a.b');
    expect(flattenTree(root, expandAll(createExpandState())).map((row) => row.path)).toContain('$.a.b.c');
    expect(flattenTree(root, collapseAll(createExpandState())).map((row) => row.path)).toEqual(['$']);
  });

  it('按路径前缀记录子树操作，并能 revealPath', () => {
    const root = parseJson('{"a":{"b":{"c":1}},"other":{"d":2}}');
    const collapsed: ExpandState = collapseSubtree(createExpandState(), '$.a');
    expect(isExpanded(collapsed, '$.a.b', 2)).toBe(false);
    const expanded = expandSubtree(collapsed, '$.a');
    expect(isExpanded(expanded, '$.a.b', 2)).toBe(true);
    const revealed = revealPath(collapseAll(createExpandState()), '$.a.b.c');
    expect(isExpanded(revealed, '$', 0)).toBe(true);
    expect(isExpanded(revealed, '$.a', 1)).toBe(true);
    expect(isExpanded(revealed, '$.a.b', 2)).toBe(true);
    expect(countVisibleRows(root, revealed)).toBe(flattenTree(root, revealed).length);
  });

  it('只有所有容器后代都展开时才判定完整子树已展开', () => {
    const root = parseJson('{"a":{"b":{"c":1}}}');
    const a = root.type === 'object' ? root.entries[0].value : root;
    const initial = createExpandState();
    expect(isSubtreeFullyExpanded(initial, a, '$.a', 1)).toBe(false);

    const expanded = expandSubtree(initial, '$.a');
    expect(isSubtreeFullyExpanded(expanded, a, '$.a', 1)).toBe(true);

    const collapsed = collapseSubtree(expanded, '$.a.b');
    expect(isSubtreeFullyExpanded(collapsed, a, '$.a', 1)).toBe(false);
  });

  it('收起子树后 revealPath 能重新展开祖先链', () => {
    const root = parseJson(JSON.stringify({ outer: { middle: { inner: { target: 1 } } } }));
    let state = collapseSubtree(createExpandState(), '$.outer');
    expect(isExpanded(state, '$.outer', 1)).toBe(false);

    state = revealPath(state, '$.outer.middle.inner.target');

    expect(isExpanded(state, '$.outer', 1)).toBe(true);
    expect(isExpanded(state, '$.outer.middle', 2)).toBe(true);
    expect(flattenTree(root, state).map((row) => row.path)).toContain('$.outer.middle.inner.target');
  });
});
