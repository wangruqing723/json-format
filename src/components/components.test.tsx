import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandPalette } from './CommandPalette';
import { ConfirmDialog } from './ConfirmDialog';
import { buildDiffRows, DiffView } from './DiffView';
import { SettingsDialog } from './SettingsDialog';
import { StructurePanel } from './StructurePanel';
import { ICON_CODEPOINTS } from './Icon';
import { TreeView } from './TreeView';
import type { JsonDocument } from '../types';

afterEach(cleanup);

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
    view: 'text',
    language: 'json',
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('TreeView', () => {
  it('展开节点并复制 JSONPath', () => {
    const onCopy = vi.fn();
    render(<TreeView source={'{"user":{"name":"Ada"}}'} onCopy={onCopy} />);

    fireEvent.click(screen.getByRole('button', { name: 'user' }));
    expect(onCopy).toHaveBeenCalledWith('$.user', '路径');
    expect(screen.getByText('"Ada"')).toBeInTheDocument();
  });

  it('为非法 JSON 显示可访问的空状态', () => {
    render(<TreeView source="{" onCopy={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('树视图不可用');
  });

  it('保留大整数和重复键，不提供有歧义的路径复制', () => {
    const onCopy = vi.fn();
    render(<TreeView source={'{"id":90071992547409931234,"key":1,"key":2}'} onCopy={onCopy} />);

    expect(screen.getByText('90071992547409931234')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('检测到重复键');
    expect(screen.getAllByRole('button', { name: 'key' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'key' })[0]).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '复制 id 的值' }));
    expect(onCopy).toHaveBeenCalledWith('90071992547409931234', '值');
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

describe('StructurePanel', () => {
  it('长值保留完整 title 且不会挤压键区', () => {
    const value = 'x'.repeat(240);
    const { container } = render(<StructurePanel source={JSON.stringify({ token: value })} />);
    expect(screen.getByText('token')).toBeInTheDocument();
    expect([...container.querySelectorAll<HTMLElement>('.structure-summary')].find((element) => element.title.includes(value))).toBeTruthy();
  });

  it('深层嵌套将缩进封顶，避免结构面板横向扩张', () => {
    let source = '{"leaf":true}';
    for (let index = 7; index >= 0; index--) source = `{"level${index}":${source}}`;
    const { container } = render(<StructurePanel source={source} />);
    let collapsed = screen.queryAllByRole('button', { name: /展开/ });
    while (collapsed.length) {
      fireEvent.click(collapsed[0]);
      collapsed = screen.queryAllByRole('button', { name: /展开/ });
    }
    const rows = [...container.querySelectorAll<HTMLElement>('.structure-row')];
    expect(rows.at(-1)?.style.getPropertyValue('--structure-indent')).toBe('48px');
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
