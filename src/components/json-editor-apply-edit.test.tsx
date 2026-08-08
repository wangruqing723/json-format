import { render } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { JsonEditor, type JsonEditorHandle } from './JsonEditor';

// 回归背景:状态栏曾永久停在「正在校验」。
// 成因链:runOperation 用 applyEdit 写回结果 -> CodeMirror 全量替换不做内容比对，
// 即使内容相同也报 docChanged -> onChange 触发 -> App 清空 metadata ->
// 但 activeDocument.content 字符串未变，校验 effect 的依赖没变、不重跑 ->
// metadata 永远补不回来 -> 状态卡死。
// 最常见触发场景:对已经格式化过的 JSON 再点一次「格式化」。
describe('applyEdit 的空写入防护', () => {
  const SAME = '{\n  "a": 1\n}';

  it('写入相同内容时不触发 onChange', () => {
    const onChange = vi.fn();
    const ref = createRef<JsonEditorHandle>();
    render(<JsonEditor ref={ref} value={SAME} theme="light" onChange={onChange} />);

    onChange.mockClear();
    ref.current!.applyEdit(SAME);

    expect(onChange).not.toHaveBeenCalled();
  });

  it('写入不同内容时正常触发 onChange', () => {
    const onChange = vi.fn();
    const ref = createRef<JsonEditorHandle>();
    render(<JsonEditor ref={ref} value={SAME} theme="light" onChange={onChange} />);

    onChange.mockClear();
    ref.current!.applyEdit('{\n  "a": 2\n}');

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toBe('{\n  "a": 2\n}');
  });

  it('只读时不写入', () => {
    const onChange = vi.fn();
    const ref = createRef<JsonEditorHandle>();
    render(<JsonEditor ref={ref} value={SAME} theme="light" readOnly onChange={onChange} />);

    onChange.mockClear();
    ref.current!.applyEdit('{\n  "a": 3\n}');

    expect(onChange).not.toHaveBeenCalled();
  });
});
