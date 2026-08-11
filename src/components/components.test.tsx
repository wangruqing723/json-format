import { cleanup, createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createRef } from 'react';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandPalette } from './CommandPalette';
import { AppHeader } from './AppHeader';
import { ConfirmDialog } from './ConfirmDialog';
import { buildDiffRows, DiffView } from './DiffView';
import { SettingsDialog } from './SettingsDialog';
import { ICON_CODEPOINTS } from './Icon';
import { TreeView, type TreeViewHandle } from './TreeView';
import { parseJson } from '../core/json-parser';
import { createExpandState } from '../core/tree-flatten';
import type { JsonDocument } from '../types';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function collectSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? collectSourceFiles(path) : /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

function documentFixture(id: string, title: string, content: string): JsonDocument {
  return {
    id,
    title,
    content,
    savedContent: content,
    filePath: null,
    collapsedPane: 'none',
    language: 'json',
    createdAt: 1,
    updatedAt: 1,
  };
}

function renderHeader(overrides: Partial<React.ComponentProps<typeof AppHeader>> = {}) {
  const documents = [
    documentFixture('one', 'One', '{}'),
    documentFixture('two', 'Two', '[]'),
    documentFixture('three', 'Three', 'null'),
  ];
  const props: React.ComponentProps<typeof AppHeader> = {
    sidebarCollapsed: false,
    onToggleSidebar: vi.fn(),
    documents,
    activeDocumentId: 'two',
    onSelectDocument: vi.fn(),
    onCloseDocument: vi.fn(),
    onReorderDocument: vi.fn(),
    onNewDocument: vi.fn(),
    canSearch: true,
    onSearch: vi.fn(),
    onOpenCommandPalette: vi.fn(),
    onOpenSettings: vi.fn(),
    theme: 'light',
    onToggleTheme: vi.fn(),
    ...overrides,
  };
  return { ...render(<AppHeader {...props} />), props };
}

describe('AppHeader', () => {
  it('按落点重排标签且不会切换活动文档', () => {
    const onReorderDocument = vi.fn();
    const onSelectDocument = vi.fn();
    const { container } = renderHeader({ onReorderDocument, onSelectDocument });
    const source = screen.getByRole('button', { name: 'One' });
    const target = screen.getByRole('button', { name: 'Three' }).closest('.document-tab') as HTMLElement;
    target.getBoundingClientRect = () => ({
      x: 100, y: 0, left: 100, right: 200, top: 0, bottom: 48, width: 100, height: 48,
      toJSON: () => ({}),
    });
    const dataTransfer = {
      effectAllowed: 'none',
      dropEffect: 'none',
      setData: vi.fn(),
    };

    fireEvent.dragStart(source, { dataTransfer });
    const dragOver = createEvent.dragOver(target, { dataTransfer });
    Object.defineProperty(dragOver, 'clientX', { value: 180 });
    fireEvent(target, dragOver);
    expect(target).toHaveClass('drop-after');
    fireEvent.drop(container.querySelector('.tabs-scroll')!, { dataTransfer });

    expect(onReorderDocument).toHaveBeenCalledOnce();
    expect(onReorderDocument).toHaveBeenCalledWith('one', 2);
    expect(onSelectDocument).not.toHaveBeenCalled();
    expect(target).not.toHaveClass('drop-after');
  });

  it('关闭按钮不可拖动，取消拖动会清理插入反馈', () => {
    const { container } = renderHeader();
    const close = screen.getByRole('button', { name: '关闭 One' });
    expect(close).toHaveAttribute('draggable', 'false');

    const source = screen.getByRole('button', { name: 'One' });
    const target = screen.getByRole('button', { name: 'Two' }).closest('.document-tab') as HTMLElement;
    target.getBoundingClientRect = () => ({
      x: 0, y: 0, left: 0, right: 100, top: 0, bottom: 48, width: 100, height: 48,
      toJSON: () => ({}),
    });
    const dataTransfer = { effectAllowed: 'none', dropEffect: 'none', setData: vi.fn() };
    fireEvent.dragStart(source, { dataTransfer });
    const dragOver = createEvent.dragOver(target, { dataTransfer });
    Object.defineProperty(dragOver, 'clientX', { value: 10 });
    fireEvent(target, dragOver);
    expect(target).toHaveClass('drop-before');
    fireEvent.dragEnd(source, { dataTransfer });
    expect(container.querySelector('.drop-before')).toBeNull();
    expect(container.querySelector('.is-dragging')).toBeNull();
  });

  it('拖到标签栏边缘时自动滚动，并在拖动结束后取消动画帧', () => {
    let frameCallback: FrameRequestCallback | undefined;
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        frameCallback = callback;
        return 17;
      });
    const cancelFrame = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    const { container } = renderHeader();
    const tabs = container.querySelector<HTMLElement>('.tabs-scroll')!;
    const source = screen.getByRole('button', { name: 'One' });
    const target = screen.getByRole('button', { name: 'Three' }).closest('.document-tab') as HTMLElement;
    tabs.getBoundingClientRect = () => ({
      x: 0, y: 0, left: 0, right: 300, top: 0, bottom: 48, width: 300, height: 48,
      toJSON: () => ({}),
    });
    target.getBoundingClientRect = () => ({
      x: 200, y: 0, left: 200, right: 300, top: 0, bottom: 48, width: 100, height: 48,
      toJSON: () => ({}),
    });
    const dataTransfer = { effectAllowed: 'none', dropEffect: 'none', setData: vi.fn() };
    fireEvent.dragStart(source, { dataTransfer });
    const dragOver = createEvent.dragOver(target, { dataTransfer });
    Object.defineProperty(dragOver, 'clientX', { value: 295 });
    fireEvent(target, dragOver);
    frameCallback?.(0);

    expect(requestFrame).toHaveBeenCalled();
    expect(tabs.scrollLeft).toBeGreaterThan(0);
    fireEvent.dragEnd(source, { dataTransfer });
    expect(cancelFrame).toHaveBeenCalledWith(17);
  });

  it('拖到标签栏末尾空白区域时插入到最后', () => {
    const onReorderDocument = vi.fn();
    const { container } = renderHeader({ onReorderDocument });
    const tabs = container.querySelector<HTMLElement>('.tabs-scroll')!;
    const source = screen.getByRole('button', { name: 'One' });
    const dataTransfer = { effectAllowed: 'none', dropEffect: 'none', setData: vi.fn() };
    fireEvent.dragStart(source, { dataTransfer });
    const dragOver = createEvent.dragOver(tabs, { dataTransfer });
    Object.defineProperty(dragOver, 'clientX', { value: 500 });
    fireEvent(tabs, dragOver);
    fireEvent.drop(tabs, { dataTransfer });
    expect(onReorderDocument).toHaveBeenCalledWith('one', 2);
  });

  it('树操作布局不再使用自动左边距，内容和按钮均允许稳定收缩', () => {
    const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../styles.css'), 'utf8');
    expect(css).toMatch(/\.tree-subtree-button\s*\{[^}]*margin-left:\s*8px/s);
    expect(css).not.toMatch(/\.tree-subtree-button\s*\{[^}]*margin-left:\s*auto/s);
    expect(css).toMatch(/\.tree-value\s*\{[^}]*min-width:\s*0/s);
    expect(css).toMatch(/\.tree-virtual-content\s*\{[^}]*min-width:\s*100%/s);
  });
});

describe('TreeView', () => {
  it('展开节点并复制 JSONPath', () => {
    const onCopy = vi.fn();
    const onSelectPath = vi.fn();
    render(<TreeView root={parseJson('{"user":{"name":"Ada"}}')} parseError={null} hasDuplicates={false} expandState={createExpandState()} onExpandChange={vi.fn()} highlightPaths={new Set()} onCopy={onCopy} onSelectPath={onSelectPath} />);

    fireEvent.click(screen.getByRole('button', { name: '"user"' }));
    expect(onSelectPath).toHaveBeenCalledWith('$.user');
    expect(screen.getByText('"Ada"')).toBeInTheDocument();
  });

  it('用一个按钮根据完整子树状态切换展开和收起', () => {
    const source = '{"user":{"profile":{"name":"Ada"}}}';
    const onExpandChange = vi.fn();
    const props = {
      root: parseJson(source),
      parseError: null,
      hasDuplicates: false,
      expandState: createExpandState(),
      onExpandChange,
      highlightPaths: new Set<string>(),
      onCopy: vi.fn(),
      hiddenPaths: new Set<string>(),
      onHide: vi.fn(),
      onRestoreHidden: vi.fn(),
      selectedPath: null,
      onSelectPath: vi.fn(),
      onDownloadNode: vi.fn(),
      allowRemoteImages: false,
    };
    const { rerender } = render(<TreeView {...props} />);

    expect(screen.getByRole('button', { name: '展开子树 user' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '收起子树 user' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '展开子树 user' }));
    const expandedState = onExpandChange.mock.calls[0][0];
    rerender(<TreeView {...props} expandState={expandedState} />);

    expect(screen.getByRole('button', { name: '收起子树 user' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '展开子树 user' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '收起子树 user' }));
    expect(onExpandChange).toHaveBeenCalledTimes(2);
  });

  it('为非法 JSON 显示可访问的空状态', () => {
    render(<TreeView root={null} parseError="JSON 无效" hasDuplicates={false} expandState={createExpandState()} onExpandChange={vi.fn()} highlightPaths={new Set()} onCopy={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('树视图不可用');
  });

  it('保留大整数和重复键，不提供有歧义的路径复制', () => {
    const onCopy = vi.fn();
    render(<TreeView root={parseJson('{"id":90071992547409931234,"key":1,"key":2}')} parseError={null} hasDuplicates={true} expandState={createExpandState()} onExpandChange={vi.fn()} highlightPaths={new Set()} onCopy={onCopy} />);

    expect(screen.getByTitle('90071992547409931234')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('检测到重复键');
    const duplicateRows = screen.getAllByRole('button', { name: '"key"' }).map((button) => button.closest('[data-tree-row]')!);
    expect(duplicateRows).toHaveLength(2);
    for (const row of duplicateRows) {
      expect(within(row).getByRole('button', { name: '复制路径' })).toBeDisabled();
    }
    const idRow = screen.getByTitle('90071992547409931234').closest('[data-tree-row]')!;
    fireEvent.click(within(idRow).getByRole('button', { name: '复制' }));
    expect(onCopy).toHaveBeenCalledWith('90071992547409931234', '值');
  });

  it('把安全外链交给上层处理，而不是在树行内绕过提示打开', () => {
    const onOpenExternal = vi.fn();
    render(
      <TreeView
        root={parseJson('{"url":"https://example.com/path"}')}
        parseError={null}
        hasDuplicates={false}
        expandState={createExpandState()}
        onExpandChange={vi.fn()}
        highlightPaths={new Set()}
        onCopy={vi.fn()}
        onOpenExternal={onOpenExternal}
      />,
    );

    expect(screen.queryByRole('img')).toBeNull();
    fireEvent.click(screen.getByTitle('https://example.com/path'));
    expect(onOpenExternal).toHaveBeenCalledWith('https://example.com/path');
  });

  it('大数组首屏只挂载虚拟窗口行', () => {
    const item = 'x'.repeat(260);
    const source = `[${Array.from({ length: 18_500 }, () => JSON.stringify(item)).join(',')}]`;
    const { container } = render(
      <TreeView root={parseJson(source)} parseError={null} hasDuplicates={false} expandState={createExpandState()} onExpandChange={vi.fn()} highlightPaths={new Set()} onCopy={vi.fn()} />,
    );
    expect(container.querySelectorAll('[data-tree-row]').length).toBeLessThan(100);
  });

  it('暴露虚拟列表滚动句柄定位路径', () => {
    const ref = createRef<TreeViewHandle>();
    const source = `[${Array.from({ length: 100 }, (_, index) => String(index)).join(',')}]`;
    const { container } = render(
      <TreeView ref={ref} root={parseJson(source)} parseError={null} hasDuplicates={false} expandState={createExpandState()} onExpandChange={vi.fn()} highlightPaths={new Set()} onCopy={vi.fn()} />,
    );

    ref.current?.scrollToPath('$[80]');

    expect(container.querySelector<HTMLElement>('.tree-virtual-scroll')?.scrollTop).toBeGreaterThan(0);
  });
});

describe('DiffView', () => {
  it('将对应的删除和新增行配对为变化行', () => {
    const rows = buildDiffRows('same\nold\ntail', 'same\nnew\ntail');
    expect(rows).toEqual([
      expect.objectContaining({ kind: 'same', left: 'same', right: 'same' }),
      expect.objectContaining({ kind: 'changed', left: 'old', right: 'new' }),
      expect.objectContaining({ kind: 'same', left: 'tail', right: 'tail' }),
    ]);
  });

  it('显示可识别的文档标题与正文差异标记', () => {
    const documents = [
      documentFixture('left', '原始.json', '{\n  "value": 1\n}'),
      documentFixture('right', '修改.json', '{\n  "value": 2\n}'),
    ];
    const { container } = render(
      <DiffView documents={documents} leftId="left" rightId="right" onChangeSide={vi.fn()} onSwap={vi.fn()} />,
    );

    expect(screen.getByRole('region', { name: '左侧（窄屏上方）：原始.json' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '右侧（窄屏下方）：修改.json' })).toBeInTheDocument();
    expect(container.querySelectorAll('.diff-line--changed')).toHaveLength(2);
    expect(screen.getAllByText('变化').length).toBeGreaterThan(0);
  });
});

describe('dialogs', () => {
  it('自绘确认弹窗默认聚焦取消并支持 Esc 取消', async () => {
    const onResolve = vi.fn();
    render(<ConfirmDialog request={{ title: '确认操作', message: '请确认', tone: 'danger' }} onResolve={onResolve} />);
    const dialog = screen.getByRole('alertdialog', { name: '确认操作' });
    await waitFor(() => expect(screen.getByRole('button', { name: '取消' })).toHaveFocus());
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onResolve).toHaveBeenCalledWith(false);
  });

  it('自绘确认弹窗 Enter 确认且点击遮罩取消', () => {
    const onResolve = vi.fn();
    const { container } = render(<ConfirmDialog request={{ title: '确认操作', message: '请确认' }} onResolve={onResolve} />);
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Enter' });
    expect(onResolve).toHaveBeenCalledWith(true);
    fireEvent.mouseDown(container.querySelector('.confirm-backdrop')!);
    expect(onResolve).toHaveBeenCalledWith(false);
  });

  it('命令面板可筛选、公布活动选项并执行命令', () => {
    const action = vi.fn();
    const onClose = vi.fn();
    render(<CommandPalette open commands={[{ id: 'format', label: '格式化 JSON', action }]} onClose={onClose} />);

    const input = screen.getByRole('combobox', { name: '搜索命令' });
    fireEvent.change(input, { target: { value: '格式化' } });
    expect(input).toHaveAttribute('aria-controls', 'command-listbox');
    expect(input).toHaveAttribute('aria-activedescendant', 'command-option-format');
    fireEvent.click(screen.getByRole('option', { name: '格式化 JSON' }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(action).toHaveBeenCalledOnce();
  });

  it('命令面板关闭后恢复触发点焦点', async () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    const { rerender } = render(
      <CommandPalette open commands={[]} onClose={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveFocus());
    rerender(<CommandPalette open={false} commands={[]} onClose={vi.fn()} />);
    expect(trigger).toHaveFocus();
    trigger.remove();
  });

  it('设置面板发出主题和缩进变更', () => {
    const onChange = vi.fn();
    render(
      <SettingsDialog
        open
        settings={{ theme: 'system', indent: 2, sortKeys: false, restoreSession: true }}
        onChange={onChange}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '深色' }));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '4' } });
    expect(onChange).toHaveBeenCalledWith({ theme: 'dark' });
    expect(onChange).toHaveBeenCalledWith({ indent: 4 });
  });

  it('设置面板关闭后恢复触发点焦点', async () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    const settings = { theme: 'system', indent: 2, sortKeys: false, restoreSession: true } as const;
    const { rerender } = render(
      <SettingsDialog open settings={settings} onChange={vi.fn()} onClose={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByRole('button', { name: '关闭设置' })).toHaveFocus());
    rerender(<SettingsDialog open={false} settings={settings} onChange={vi.fn()} onClose={vi.fn()} />);
    expect(trigger).toHaveFocus();
    trigger.remove();
  });
});

describe('Icon 映射', () => {
  it('源码中的字面量图标名称都存在于 codepoint 映射表', () => {
    const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const names = collectSourceFiles(sourceRoot).flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      return [
        ...source.matchAll(/<Icon\s+name\s*=\s*["']([^"']+)["']/g),
        ...source.matchAll(/icon:\s*["']([^"']+)["']/g),
      ].map((match) => match[1]);
    });

    for (const name of names) {
      expect(ICON_CODEPOINTS[name as keyof typeof ICON_CODEPOINTS], name).toBeDefined();
    }
  });
});
