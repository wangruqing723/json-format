import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SplitWorkspace } from './SplitWorkspace';

afterEach(() => cleanup());

function renderWorkspace(overrides: Partial<React.ComponentProps<typeof SplitWorkspace>> = {}) {
  const onRatioChange = vi.fn();
  const onRatioCommit = vi.fn();
  const onCollapsedPaneChange = vi.fn();
  const props: React.ComponentProps<typeof SplitWorkspace> = {
    orientation: 'row',
    ratio: 0.5,
    onRatioChange,
    onRatioCommit,
    collapsedPane: 'none',
    onCollapsedPaneChange,
    textPane: <div data-testid="text-pane">文本内容</div>,
    treePane: <div data-testid="tree-pane">树内容</div>,
    ...overrides,
  };
  return { ...render(<SplitWorkspace {...props} />), props, onRatioChange, onRatioCommit, onCollapsedPaneChange };
}

describe('SplitWorkspace 键盘交互', () => {
  it('左右方向键按步进调整，Home/End 跳到边界，双击复位', () => {
    const { onRatioChange, onRatioCommit } = renderWorkspace();
    const divider = screen.getByRole('separator');

    fireEvent.keyDown(divider, { key: 'ArrowRight' });
    expect(onRatioChange).toHaveBeenLastCalledWith(0.55);
    expect(onRatioCommit).toHaveBeenLastCalledWith(0.55);
    expect(divider).toHaveAttribute('aria-valuenow', '55');

    fireEvent.keyDown(divider, { key: 'ArrowLeft' });
    expect(divider).toHaveAttribute('aria-valuenow', '50');
    fireEvent.keyDown(divider, { key: 'Home' });
    expect(divider).toHaveAttribute('aria-valuenow', '20');
    fireEvent.keyDown(divider, { key: 'End' });
    expect(divider).toHaveAttribute('aria-valuenow', '80');
    fireEvent.doubleClick(divider);
    expect(divider).toHaveAttribute('aria-valuenow', '50');
    expect(onRatioCommit).toHaveBeenCalledTimes(5);
  });

  it('row 只响应左右键，column 只响应上下键', () => {
    const row = renderWorkspace();
    const rowDivider = screen.getByRole('separator');
    fireEvent.keyDown(rowDivider, { key: 'ArrowUp' });
    expect(row.onRatioChange).not.toHaveBeenCalled();
    cleanup();

    const column = renderWorkspace({ orientation: 'column' });
    const columnDivider = screen.getByRole('separator');
    expect(columnDivider).toHaveAttribute('aria-orientation', 'horizontal');
    fireEvent.keyDown(columnDivider, { key: 'ArrowDown' });
    expect(column.onRatioChange).toHaveBeenCalledWith(0.55);
    fireEvent.keyDown(columnDivider, { key: 'ArrowLeft' });
    expect(column.onRatioChange).toHaveBeenCalledTimes(1);
  });
});

describe('SplitWorkspace pointer 拖拽', () => {
  it('使用 pointer capture，拖动持续通知，pointerup 只提交一次', () => {
    const { container, onRatioChange, onRatioCommit } = renderWorkspace();
    const workspace = container.querySelector<HTMLElement>('[data-split-workspace]')!;
    const divider = screen.getByRole('separator');
    workspace.getBoundingClientRect = () => ({
      x: 10, y: 20, left: 10, top: 20, right: 810, bottom: 420, width: 800, height: 400,
      toJSON: () => ({}),
    });
    const setPointerCapture = vi.fn();
    const releasePointerCapture = vi.fn();
    Object.assign(divider, { setPointerCapture, releasePointerCapture });

    fireEvent.pointerDown(divider, { pointerId: 7, button: 0 });
    expect(setPointerCapture).toHaveBeenCalled();
    fireEvent.pointerMove(divider, { pointerId: 7, clientX: 410, clientY: 100 });
    fireEvent.pointerMove(divider, { pointerId: 7, clientX: 650, clientY: 100 });
    expect(onRatioChange).toHaveBeenNthCalledWith(1, 0.5);
    expect(onRatioChange).toHaveBeenCalledTimes(2);

    fireEvent.pointerUp(divider, { pointerId: 7 });
    expect(onRatioCommit).toHaveBeenCalledOnce();
    expect(onRatioCommit).toHaveBeenCalledWith(0.5);
    fireEvent.pointerCancel(divider, { pointerId: 7 });
    expect(onRatioCommit).toHaveBeenCalledOnce();
    expect(releasePointerCapture).toHaveBeenCalled();
  });

  it('column 拖拽按容器高度换算比例，pointercancel 也只提交一次', () => {
    const { container, onRatioChange, onRatioCommit } = renderWorkspace({ orientation: 'column' });
    const workspace = container.querySelector<HTMLElement>('[data-split-workspace]')!;
    const divider = screen.getByRole('separator');
    workspace.getBoundingClientRect = () => ({
      x: 0, y: 100, left: 0, top: 100, right: 800, bottom: 500, width: 800, height: 400,
      toJSON: () => ({}),
    });
    Object.assign(divider, { setPointerCapture: vi.fn(), releasePointerCapture: vi.fn() });

    fireEvent.pointerDown(divider, { pointerId: 8, button: 0 });
    fireEvent.pointerMove(divider, { pointerId: 8, clientX: 700, clientY: 300 });
    expect(onRatioChange).toHaveBeenCalledWith(0.5);
    fireEvent.pointerCancel(divider, { pointerId: 8 });
    expect(onRatioCommit).toHaveBeenCalledOnce();
    fireEvent.pointerUp(divider, { pointerId: 8 });
    expect(onRatioCommit).toHaveBeenCalledOnce();
  });
});

describe('SplitWorkspace 折叠交互', () => {
  it('折叠文本侧后移除分隔条，窄条可恢复且不会双侧折叠', () => {
    const onCollapsedPaneChange = vi.fn();
    const { rerender, props } = renderWorkspace({ onCollapsedPaneChange });
    fireEvent.click(screen.getByRole('button', { name: '折叠文本' }));
    expect(onCollapsedPaneChange).toHaveBeenCalledWith('text');

    rerender(
      <SplitWorkspace
        {...props}
        collapsedPane="text"
        onCollapsedPaneChange={onCollapsedPaneChange}
      />,
    );
    expect(screen.queryByRole('separator')).toBeNull();
    expect(screen.getByRole('button', { name: '展开文本' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '折叠树' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '展开文本' }));
    expect(onCollapsedPaneChange).toHaveBeenLastCalledWith('none');
  });

  it('折叠树侧时同样保留恢复窄条', () => {
    const onCollapsedPaneChange = vi.fn();
    const { rerender, props } = renderWorkspace({ onCollapsedPaneChange });
    fireEvent.click(screen.getByRole('button', { name: '折叠树' }));
    expect(onCollapsedPaneChange).toHaveBeenCalledWith('tree');
    rerender(<SplitWorkspace {...props} collapsedPane="tree" onCollapsedPaneChange={onCollapsedPaneChange} />);
    expect(screen.queryByRole('separator')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '展开树' }));
    expect(onCollapsedPaneChange).toHaveBeenLastCalledWith('none');
  });
});

describe('SplitWorkspace pane 布局', () => {
  it('row 和 column 都渲染文本、树两个 pane', () => {
    const { container } = renderWorkspace({ orientation: 'column' });
    expect(container.querySelector('.split-workspace')).toHaveClass('split-workspace--column');
    expect(screen.getByTestId('text-pane')).toBeInTheDocument();
    expect(screen.getByTestId('tree-pane')).toBeInTheDocument();
    expect(container.querySelector('[data-pane="text"]')).toBeTruthy();
    expect(container.querySelector('[data-pane="tree"]')).toBeTruthy();
  });

  it('在 pane 标题中渲染可选的额外操作', () => {
    const { container } = renderWorkspace({
      textHeaderExtra: <button type="button">文本操作</button>,
      treeHeaderExtra: <button type="button">树操作</button>,
    });

    expect(container.querySelector('[data-pane="text"] .split-workspace-pane-header-extra')).toHaveTextContent('文本操作');
    expect(container.querySelector('[data-pane="tree"] .split-workspace-pane-header-extra')).toHaveTextContent('树操作');
  });
});
