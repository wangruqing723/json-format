import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createRef } from 'react';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandPalette } from './CommandPalette';
import { AboutDialog } from './AboutDialog';
import { ActionBar } from './ActionBar';
import { AppHeader } from './AppHeader';
import { ConfirmDialog } from './ConfirmDialog';
import { buildDiffRows, DiffView } from './DiffView';
import { SettingsDialog } from './SettingsDialog';
import { ICON_CODEPOINTS } from './Icon';
import { SearchPanel } from './SearchPanel';
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
    onOpenCommandPalette: vi.fn(),
    onOpenSettings: vi.fn(),
    theme: 'light',
    onToggleTheme: vi.fn(),
    ...overrides,
  };
  return { ...render(<AppHeader {...props} />), props };
}

function firePointer(target: Element | Window, type: string, clientX = 0) {
  fireEvent(target, new MouseEvent(type, { clientX, button: 0, bubbles: true }));
}

describe('ActionBar', () => {
  it('右侧提示向内对齐，表格禁用提示不继承按钮透明度', () => {
    render(
      <ActionBar
        onOpen={vi.fn()}
        onSave={vi.fn()}
        onSaveAs={vi.fn()}
        onCopyAll={vi.fn()}
        onFormat={vi.fn()}
        onMinify={vi.fn()}
        onSort={vi.fn()}
        onRepair={vi.fn()}
        transformsDisabled={false}
        disabledReason={null}
        recentFiles={[]}
        onOpenRecent={vi.fn()}
        status={{ tone: 'success', text: 'JSON 有效' }}
        moreActions={[]}
        activePanel={null}
        onTogglePanel={vi.fn()}
        splitOrientation="row"
        onToggleSplitOrientation={vi.fn()}
        onOpenTable={vi.fn()}
        tableDisabledReason="当前节点是标量，无法提取为表格"
      />,
    );

    const tableButton = screen.getByRole('button', { name: '表格' });
    expect(tableButton).toHaveClass('tooltip-align-end', 'table-view-button', 'is-disabled');
    expect(tableButton).toHaveAttribute('data-tooltip', '当前节点是标量，无法提取为表格');
    expect(screen.getByRole('button', { name: '上下分屏' })).toHaveClass('tooltip-align-end', 'split-orientation-button');

    const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../styles.css'), 'utf8');
    expect(css).toMatch(/\[data-tooltip\]\.tooltip-align-end::after\s*\{[^}]*right:\s*0[^}]*left:\s*auto/s);
    expect(css).toMatch(/\.panel-actions \.table-view-button\.is-disabled\s*\{[^}]*opacity:\s*1/s);
    expect(css).toMatch(/\.actionbar\s*\{[^}]*container:\s*actionbar \/ inline-size/s);
    expect(css).toMatch(/@container actionbar \(max-width: 1080px\)[\s\S]*?\.panel-actions > \.tool-button:first-child > span:not\(\.material-symbols-outlined\)\s*\{ display: none; \}/s);
    // 收起时只藏文字标签、保留图标：裸 `> span` 会连图标 span 一起隐藏，按钮变全空白。
    expect(css).not.toMatch(/@container actionbar \(max-width: 1080px\)[\s\S]*?\.file-actions \.tool-button > span\s*\{ display: none; \}/s);
    expect(css).toMatch(/\.panel-actions \.table-view-button > span,[\s\S]*?\.panel-actions \.split-orientation-button > span\s*\{ display: inline; \}/s);
    expect(css).not.toMatch(/@media \(max-width: 1024px\)\s*\{\s*\.toolbar-secondary span\s*\{ display: none; \}/s);
  });
});

describe('AppHeader', () => {
  it('顶栏不再渲染重复的查找按钮', () => {
    renderHeader();
    expect(screen.queryByRole('button', { name: '查找' })).toBeNull();
  });

  it('按落点重排标签且不会切换活动文档', () => {
    const onReorderDocument = vi.fn();
    const onSelectDocument = vi.fn();
    renderHeader({ onReorderDocument, onSelectDocument });
    const source = screen.getByRole('button', { name: 'One' });
    const target = screen.getByRole('button', { name: 'Three' }).closest('.document-tab') as HTMLElement;
    target.getBoundingClientRect = () => ({
      x: 100, y: 0, left: 100, right: 200, top: 0, bottom: 48, width: 100, height: 48,
      toJSON: () => ({}),
    });
    firePointer(source, 'pointerdown', 10);
    firePointer(window, 'pointermove', 180);
    expect(target).toHaveClass('drop-after');
    firePointer(window, 'pointerup', 180);

    expect(onReorderDocument).toHaveBeenCalledOnce();
    expect(onReorderDocument).toHaveBeenCalledWith('one', 2);
    expect(onSelectDocument).not.toHaveBeenCalled();
    expect(target).not.toHaveClass('drop-after');
  });

  it('取消拖动会清理插入反馈', () => {
    const { container } = renderHeader();
    const source = screen.getByRole('button', { name: 'One' });
    const target = screen.getByRole('button', { name: 'Two' }).closest('.document-tab') as HTMLElement;
    target.getBoundingClientRect = () => ({
      x: 0, y: 0, left: 0, right: 100, top: 0, bottom: 48, width: 100, height: 48,
      toJSON: () => ({}),
    });
    firePointer(source, 'pointerdown', 50);
    firePointer(window, 'pointermove', 10);
    expect(target).toHaveClass('drop-before');
    firePointer(window, 'pointercancel', 10);
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
    firePointer(source, 'pointerdown', 10);
    firePointer(window, 'pointermove', 295);
    frameCallback?.(0);

    expect(requestFrame).toHaveBeenCalled();
    expect(tabs.scrollLeft).toBeGreaterThan(0);
    firePointer(window, 'pointerup', 295);
    expect(cancelFrame).toHaveBeenCalledWith(17);
  });

  it('拖到标签栏末尾空白区域时插入到最后', () => {
    const onReorderDocument = vi.fn();
    renderHeader({ onReorderDocument });
    const source = screen.getByRole('button', { name: 'One' });
    firePointer(source, 'pointerdown', 10);
    firePointer(window, 'pointermove', 500);
    firePointer(window, 'pointerup', 500);
    expect(onReorderDocument).toHaveBeenCalledWith('one', 2);
  });

  it('未超过阈值时仍按普通点击选择文档', () => {
    const onSelectDocument = vi.fn();
    const { getByRole } = renderHeader({ onSelectDocument });
    const source = getByRole('button', { name: 'One' });

    firePointer(source, 'pointerdown', 10);
    firePointer(window, 'pointermove', 14);
    firePointer(window, 'pointerup', 14);
    fireEvent.click(source);

    expect(onSelectDocument).toHaveBeenCalledWith('one');
  });

  it('拖动结束后的 click 不会切换活动文档', () => {
    const onReorderDocument = vi.fn();
    const onSelectDocument = vi.fn();
    const { getByRole } = renderHeader({ onReorderDocument, onSelectDocument });
    const source = getByRole('button', { name: 'One' });
    const target = getByRole('button', { name: 'Three' }).closest('.document-tab') as HTMLElement;
    target.getBoundingClientRect = () => ({
      x: 100, y: 0, left: 100, right: 200, top: 0, bottom: 48, width: 100, height: 48,
      toJSON: () => ({}),
    });

    firePointer(source, 'pointerdown', 10);
    firePointer(window, 'pointermove', 180);
    firePointer(window, 'pointerup', 180);
    fireEvent.click(source);

    expect(onReorderDocument).toHaveBeenCalledOnce();
    expect(onSelectDocument).not.toHaveBeenCalled();
  });

  it('按 Esc 取消拖动且不触发重排', () => {
    const onReorderDocument = vi.fn();
    const { container, getByRole } = renderHeader({ onReorderDocument });
    const source = getByRole('button', { name: 'One' });
    const target = getByRole('button', { name: 'Two' }).closest('.document-tab') as HTMLElement;
    target.getBoundingClientRect = () => ({
      x: 0, y: 0, left: 0, right: 100, top: 0, bottom: 48, width: 100, height: 48,
      toJSON: () => ({}),
    });

    firePointer(source, 'pointerdown', 50);
    firePointer(window, 'pointermove', 10);
    expect(target).toHaveClass('drop-before');
    fireEvent(window, new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    firePointer(window, 'pointerup', 10);

    expect(onReorderDocument).not.toHaveBeenCalled();
    expect(container.querySelector('.drop-before')).toBeNull();
    expect(container.querySelector('.is-dragging')).toBeNull();
  });

  it('树操作贴近内容，长值只收缩 value 而不挤压 key', () => {
    const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../styles.css'), 'utf8');
    expect(css).toMatch(/\.tree-subtree-button\s*\{[^}]*margin-left:\s*8px/s);
    expect(css).not.toMatch(/\.tree-subtree-button\s*\{[^}]*margin-left:\s*auto/s);
    expect(css).toMatch(/\.tree-path\s*\{[^}]*min-width:\s*max-content[^}]*flex:\s*0 0 auto/s);
    expect(css).not.toMatch(/\.tree-path\s*\{[^}]*text-overflow:\s*ellipsis/s);
    expect(css).toMatch(/\.tree-value\s*\{[^}]*min-width:\s*0[^}]*flex:\s*1 1 0[^}]*text-overflow:\s*ellipsis/s);
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

  it('超长 value 保留完整 key，并把完整值放在 title 中', () => {
    const value = 'token-'.repeat(120);
    render(
      <TreeView
        root={parseJson(JSON.stringify({ refresh_token: value }))}
        parseError={null}
        hasDuplicates={false}
        expandState={createExpandState()}
        onExpandChange={vi.fn()}
        highlightPaths={new Set()}
        onCopy={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: '"refresh_token"' })).toHaveTextContent('"refresh_token"');
    expect(screen.getByTitle(value)).toHaveTextContent(JSON.stringify(value));
  });

  it('整行可选择，箭头和行内操作不会附带选择', () => {
    const onSelectPath = vi.fn();
    const onExpandChange = vi.fn();
    const onCopy = vi.fn();
    const onHide = vi.fn();
    render(
      <TreeView
        root={parseJson('{"user":{"name":"Ada"}}')}
        parseError={null}
        hasDuplicates={false}
        expandState={createExpandState()}
        onExpandChange={onExpandChange}
        highlightPaths={new Set()}
        onCopy={onCopy}
        onHide={onHide}
        onSelectPath={onSelectPath}
      />,
    );

    const userPath = screen.getByRole('button', { name: '"user"' });
    const userRow = userPath.closest('[data-tree-row]')!;
    fireEvent.click(userRow.querySelector('.tree-row')!);
    expect(onSelectPath).toHaveBeenCalledWith('$.user');

    onSelectPath.mockClear();
    fireEvent.click(within(userRow).getByRole('button', { name: '折叠 user' }));
    expect(onSelectPath).not.toHaveBeenCalled();
    expect(onExpandChange).toHaveBeenCalled();

    onSelectPath.mockClear();
    fireEvent.click(within(userRow).getByRole('button', { name: '复制' }));
    expect(onSelectPath).not.toHaveBeenCalled();
    expect(onCopy).toHaveBeenCalledWith('{"name":"Ada"}', '值');
  });

  it('展开容器行不渲染逗号，闭合行仍按兄弟位置渲染', () => {
    render(
      <TreeView
        root={parseJson('{"tags":{},"count":1}')}
        parseError={null}
        hasDuplicates={false}
        expandState={createExpandState()}
        onExpandChange={vi.fn()}
        highlightPaths={new Set()}
        onCopy={vi.fn()}
      />,
    );

    const tagsRow = screen.getByRole('button', { name: '"tags"' }).closest('[data-tree-row]')!;
    expect(tagsRow).toHaveTextContent('"tags"{');
    expect(tagsRow).not.toHaveTextContent('"tags"{,');
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

describe('SearchPanel', () => {
  it('按 Escape 关闭搜索面板', () => {
    const onClose = vi.fn();
    render(
      <SearchPanel
        input=""
        onChangeInput={vi.fn()}
        result={null}
        onSelectHit={vi.fn()}
        onClose={onClose}
      />,
    );

    fireEvent.keyDown(screen.getByRole('complementary', { name: 'Search' }), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
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

  it('关于弹窗展示 package.json 的版本号', () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../package.json'), 'utf8'),
    ) as { version: string };
    render(<AboutDialog open onClose={vi.fn()} />);
    expect(screen.getByText(`JSON FORGE · ${packageJson.version}`)).toBeInTheDocument();
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
