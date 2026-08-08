import { useEffect, useRef } from 'react';
import { Icon } from './Icon';

interface AboutDialogProps {
  open: boolean;
  onClose: () => void;
}

export function AboutDialog({ open, onClose }: AboutDialogProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = requestAnimationFrame(() => closeRef.current?.focus());
    return () => {
      cancelAnimationFrame(frame);
      previousFocusRef.current?.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <section
        className="about-dialog glass-panel-heavy"
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-title"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose();
          if (event.key !== 'Tab') return;
          const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled])'));
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
      >
        <header className="dialog-title-row">
          <div>
            <span className="dialog-eyebrow">JSON FORGE · 0.1.0</span>
            <h2 id="about-title">关于与帮助</h2>
          </div>
          <button ref={closeRef} className="icon-button" type="button" onClick={onClose} aria-label="关闭关于 JSON Forge">
            <Icon name="close" size={17} />
          </button>
        </header>
        <div className="about-content">
          <p>JSON Forge 是一个离线优先的桌面 JSON 工作台，支持格式化、修复、树视图、Diff 与会话内操作历史。</p>
          <h3>快捷键</h3>
          <dl className="shortcut-list">
            <div><dt>Ctrl/⌘ K</dt><dd>打开命令面板</dd></div>
            <div><dt>Ctrl/⌘ N</dt><dd>新建文档</dd></div>
            <div><dt>Ctrl/⌘ O</dt><dd>打开文件</dd></div>
            <div><dt>Ctrl/⌘ S</dt><dd>保存当前文档</dd></div>
            <div><dt>Ctrl/⌘ W</dt><dd>关闭当前文档</dd></div>
            <div><dt>Shift+Alt+F</dt><dd>格式化 JSON</dd></div>
          </dl>
          <p className="about-note">文档内容与会话设置保存在本机，操作历史仅保留在当前会话。</p>
        </div>
      </section>
    </div>
  );
}
