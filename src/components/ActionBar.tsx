import { useEffect, useRef, useState } from 'react';
import type { RecentFile } from '../types';
import { Icon } from './Icon';

export type StatusTone = 'success' | 'error' | 'warning' | 'info';

export interface MoreAction {
  id: string;
  label: string;
  icon: string;
  disabled?: boolean;
  onSelect: () => void;
}

interface ActionBarProps {
  onOpen: () => void;
  onSave: () => void;
  onFormat: () => void;
  onMinify: () => void;
  onSort: () => void;
  onRepair: () => void;
  transformsDisabled: boolean;
  disabledReason: string | null;
  recentFiles: RecentFile[];
  onOpenRecent: (path: string) => void;
  status: { tone: StatusTone; text: string; line?: number; column?: number };
  onRevealDiagnostic?: () => void;
  moreActions: MoreAction[];
}

export function ActionBar({
  onOpen,
  onSave,
  onFormat,
  onMinify,
  onSort,
  onRepair,
  transformsDisabled,
  disabledReason,
  recentFiles,
  onOpenRecent,
  status,
  onRevealDiagnostic,
  moreActions,
}: ActionBarProps) {
  const [openMenu, setOpenMenu] = useState<'recent' | 'more' | null>(null);
  const recentMenuRef = useRef<HTMLDivElement>(null);
  const recentTriggerRef = useRef<HTMLButtonElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const moreTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!openMenu) return;
    const menu = openMenu === 'recent' ? recentMenuRef.current : moreMenuRef.current;
    const trigger = openMenu === 'recent' ? recentTriggerRef.current : moreTriggerRef.current;
    const frame = window.requestAnimationFrame(() => menu?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus());
    const closeFromOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!recentMenuRef.current?.parentElement?.contains(target) && !moreMenuRef.current?.parentElement?.contains(target)) setOpenMenu(null);
    };
    const closeFromKeyboard = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpenMenu(null);
      trigger?.focus();
    };
    window.addEventListener('pointerdown', closeFromOutside);
    window.addEventListener('keydown', closeFromKeyboard);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('pointerdown', closeFromOutside);
      window.removeEventListener('keydown', closeFromKeyboard);
    };
  }, [openMenu]);

  const actionButtonProps = disabledReason ? { 'data-tooltip': disabledReason } : {};

  return (
    <div className="actionbar" role="toolbar" aria-label="JSON 工具">
      <div className="toolbar-group file-actions">
        <div className="split-button-wrap">
          <button className="tool-button tool-button--compact" type="button" onClick={onOpen} data-tooltip="打开 (Ctrl/⌘ O)" aria-label="打开 (Ctrl/⌘ O)">
            <Icon name="folder_open" size={16} /><span>打开</span>
          </button>
          <button ref={recentTriggerRef} className="split-trigger icon-button" type="button" onClick={() => setOpenMenu((open) => open === 'recent' ? null : 'recent')} data-tooltip="最近文件" aria-label="最近文件" aria-haspopup="menu" aria-expanded={openMenu === 'recent'}>
            <Icon name="expand_more" size={13} />
          </button>
          {openMenu === 'recent' && (
            <div ref={recentMenuRef} className="popover recent-menu" role="menu" aria-label="最近文件">
              <div className="popover-label">最近文件</div>
              {recentFiles.length ? recentFiles.map((file) => (
                <button key={file.path} type="button" role="menuitem" onClick={() => { setOpenMenu(null); onOpenRecent(file.path); }} title={file.path}>{file.name}</button>
              )) : <span className="popover-empty" role="status">暂无最近文件</span>}
            </div>
          )}
        </div>
        <button className="tool-button tool-button--compact" type="button" onClick={onSave} data-tooltip="保存 (Ctrl/⌘ S)" aria-label="保存 (Ctrl/⌘ S)">
          <Icon name="save" size={16} /><span>保存</span>
        </button>
      </div>
      <span className="toolbar-divider" />
      <div className="toolbar-group transform-actions">
        <button className={`tool-button tool-button--primary${transformsDisabled ? ' is-disabled' : ''}`} type="button" aria-disabled={transformsDisabled} onClick={onFormat} {...actionButtonProps} data-tooltip={disabledReason ?? '格式化 (Shift+Alt+F)'} aria-label="格式化 (Shift+Alt+F)">
          <Icon name="auto_awesome" size={16} /><span>格式化</span>
        </button>
        <button className={`tool-button${transformsDisabled ? ' is-disabled' : ''}`} type="button" aria-disabled={transformsDisabled} onClick={onMinify} data-tooltip={disabledReason ?? '移除无关空白'} aria-label="压缩 JSON">
          <Icon name="format_align_justify" size={16} /><span>压缩</span>
        </button>
        <button className={`tool-button toolbar-secondary${transformsDisabled ? ' is-disabled' : ''}`} type="button" aria-disabled={transformsDisabled} onClick={onSort} data-tooltip={disabledReason ?? '递归排序对象键'} aria-label="递归排序对象键">
          <Icon name="data_object" size={16} /><span>键排序</span>
        </button>
        <button className={`tool-button toolbar-secondary${transformsDisabled ? ' is-disabled' : ''}`} type="button" aria-disabled={transformsDisabled} onClick={onRepair} data-tooltip={disabledReason ?? '使用确定性规则修复'} aria-label="使用确定性规则修复">
          <Icon name="auto_fix_high" size={16} /><span>修复</span>
        </button>
      </div>
      <div className="toolbar-spacer" />
      <div className={`status-pill status-pill--${status.tone}`} aria-live="polite">
        <Icon name={status.tone === 'success' ? 'check_circle' : status.tone === 'error' ? 'error' : status.tone === 'warning' ? 'warning' : 'info'} size={14} />
        <span>{status.text}</span>
        {status.line !== undefined && status.column !== undefined && onRevealDiagnostic && (
          <button type="button" onClick={onRevealDiagnostic}>行 {status.line}:{status.column}</button>
        )}
      </div>
      <div className="more-wrap">
        <button ref={moreTriggerRef} className="icon-button" type="button" onClick={() => setOpenMenu((open) => open === 'more' ? null : 'more')} data-tooltip="更多操作" aria-label="更多操作" aria-haspopup="menu" aria-expanded={openMenu === 'more'}>
          <Icon name="more_horiz" size={18} />
        </button>
        {openMenu === 'more' && (
          <div ref={moreMenuRef} className="popover more-menu" role="menu" aria-label="更多操作">
            {moreActions.map((action) => (
              <button key={action.id} type="button" role="menuitem" disabled={action.disabled} onClick={() => { setOpenMenu(null); action.onSelect(); }}>
                <Icon name={action.icon} size={14} />{action.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
