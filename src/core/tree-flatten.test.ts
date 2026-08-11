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
    const emptyObjectRows = flattenTree(parseJson('{}'), state);
    expect(emptyObjectRows.map((row) => row.kind)).toEqual(['open', 'close']);
    expect(emptyObjectRows[1]).toMatchObject({
      path: '$',
      label: '',
      depth: 0,
      kind: 'close',
      ambiguous: false,
      isLast: true,
      parentType: null,
    });

    expect(flattenTree(parseJson('[1,2]'), state).map((row) => row.path)).toEqual([
      '$', '$[0]', '$[1]', '$',
    ]);
  });

  it('展开容器会产出与开启行配对的闭合行', () => {
    const rows = flattenTree(parseJson('{"a":{"b":1}}'), expandAll(createExpandState()));
    expect(rows.map((row) => [row.kind, row.path, row.depth])).toEqual([
      ['open', '$', 0],
      ['open', '$.a', 1],
      ['value', '$.a.b', 2],
      ['close', '$.a', 1],
      ['close', '$', 0],
    ]);

    const opens = rows.filter((row) => row.kind === 'open');
    const closes = rows.filter((row) => row.kind === 'close');
    expect(closes).toHaveLength(opens.length);
    for (const open of opens) {
      const close = closes.find((row) => row.path === open.path);
      expect(close).toMatchObject({
        label: '',
        depth: open.depth,
        ambiguous: false,
        isLast: open.isLast,
      });
      expect(close?.parentType).toBe(open.path === '$' ? null : open.node.type);
    }
  });

  it('闭合行携带正在闭合的数组类型', () => {
    const rows = flattenTree(parseJson('{"items":[1]}'), expandAll(createExpandState()));
    expect(rows.filter((row) => row.kind === 'close').map((row) => [row.path, row.parentType])).toEqual([
      ['$.items', 'array'],
      ['$', null],
    ]);
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

  it('隐藏路径会移除整棵子树，并重新计算兄弟的 isLast', () => {
    const root = parseJson('{"first":1,"hidden":{"deep":{"value":2}},"last":3}');
    const hiddenPaths = new Set(['$.hidden']);
    const rows = flattenTree(root, expandAll(createExpandState()), hiddenPaths);

    expect(rows.map((row) => row.path)).toEqual(['$', '$.first', '$.last', '$']);
    expect(rows.some((row) => row.path.startsWith('$.hidden'))).toBe(false);
    expect(rows.find((row) => row.path === '$.first')).toMatchObject({ isLast: false });
    expect(rows.find((row) => row.path === '$.last')).toMatchObject({ isLast: true });
    expect(countVisibleRows(root, expandAll(createExpandState()), hiddenPaths)).toBe(rows.length);
  });

  it('isSubtreeFullyExpanded 会忽略隐藏的容器后代', () => {
    const root = parseJson('{"a":{"visible":{"value":1},"hidden":{"value":2}}}');
    const a = root.type === 'object' ? root.entries[0].value : root;
    const hiddenPaths = new Set(['$.a.hidden']);
    const expanded = expandSubtree(createExpandState(), '$.a');

    expect(isSubtreeFullyExpanded(expanded, a, '$.a', 1, hiddenPaths)).toBe(true);
    expect(isSubtreeFullyExpanded(expanded, a, '$.a', 1, new Set(['$.a.visible']))).toBe(true);
    expect(isSubtreeFullyExpanded(expanded, a, '$.a', 1, new Set(['$.a']))).toBe(false);
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
