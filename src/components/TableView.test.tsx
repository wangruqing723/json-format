import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseJson } from '../core/json-parser';
import { TableView } from './TableView';

afterEach(() => cleanup());

describe('TableView', () => {
  it('渲染记录表格并支持下钻与回退', () => {
    const onCopy = vi.fn();
    render(<TableView open root={parseJson('{"data":[{"id":1,"meta":{"ok":true}}]}')} sourcePath="$.data" onClose={vi.fn()} onCopy={onCopy} />);
    expect(screen.getByRole('columnheader', { name: 'id' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '{"ok":true}' }));
    expect(screen.getByText('对象字段 · 1 行')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '复制整表' }));
    expect(onCopy).toHaveBeenCalled();
  });

  it('以标量来源打开时显示说明', () => {
    render(<TableView open root={parseJson('{"items":[{"value":1}]}')} sourcePath="$.items[0].value" onClose={vi.fn()} onCopy={vi.fn()} />);
    expect(screen.getByText('当前节点无法表格化')).toBeInTheDocument();
  });

  it('Escape 和遮罩关闭弹窗', () => {
    const onClose = vi.fn();
    const { container } = render(<TableView open root={parseJson('{}')} sourcePath="$" onClose={onClose} onCopy={vi.fn()} />);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    fireEvent.mouseDown(container.querySelector('.dialog-backdrop')!);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
