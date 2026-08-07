import { X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { AppSettings } from '../types';

interface SettingsDialogProps {
  open: boolean;
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
  onClose: () => void;
}

export function SettingsDialog({ open, settings, onChange, onClose }: SettingsDialogProps) {
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
        className="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose();
          if (event.key === 'Tab') {
            const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), select, input'));
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <header className="dialog-title-row">
          <div>
            <span className="dialog-eyebrow">JSON Forge</span>
            <h2 id="settings-title">设置</h2>
          </div>
          <button ref={closeRef} className="icon-button" type="button" onClick={onClose} aria-label="关闭设置">
            <X size={17} />
          </button>
        </header>

        <div className="settings-form">
          <fieldset>
            <legend>外观</legend>
            <div className="segmented-control" aria-label="主题">
              {(['system', 'light', 'dark'] as const).map((theme) => (
                <button
                  key={theme}
                  type="button"
                  className={settings.theme === theme ? 'is-active' : ''}
                  aria-pressed={settings.theme === theme}
                  onClick={() => onChange({ theme })}
                >
                  {{ system: '跟随系统', light: '浅色', dark: '深色' }[theme]}
                </button>
              ))}
            </div>
          </fieldset>

          <label className="setting-row" htmlFor="indent-size">
            <span>
              <strong>格式化缩进</strong>
              <small>用于格式化和排序输出</small>
            </span>
            <select
              id="indent-size"
              value={String(settings.indent)}
              onChange={(event) => onChange({
                indent: event.target.value === 'tab' ? 'tab' : Number(event.target.value) as 2 | 4,
              })}
            >
              <option value="2">2 空格</option>
              <option value="4">4 空格</option>
              <option value="tab">Tab</option>
            </select>
          </label>

          <label className="setting-row" htmlFor="sort-after-format">
            <span>
              <strong>格式化时排序键</strong>
              <small>递归按 Unicode 顺序整理对象键</small>
            </span>
            <input
              id="sort-after-format"
              type="checkbox"
              role="switch"
              checked={settings.sortKeys}
              onChange={(event) => onChange({ sortKeys: event.target.checked })}
            />
          </label>

          <label className="setting-row" htmlFor="restore-session">
            <span>
              <strong>恢复上次会话</strong>
              <small>文档内容仅保存在本机</small>
            </span>
            <input
              id="restore-session"
              type="checkbox"
              role="switch"
              checked={settings.restoreSession}
              onChange={(event) => onChange({ restoreSession: event.target.checked })}
            />
          </label>
        </div>
      </section>
    </div>
  );
}
