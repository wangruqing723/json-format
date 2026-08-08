import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Icon';

export interface AppCommand {
  id: string;
  label: string;
  keywords?: string;
  shortcut?: string;
  action: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  commands: AppCommand[];
  onClose: () => void;
}

export function CommandPalette({ open, commands, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return commands;
    return commands.filter((command) =>
      `${command.label} ${command.keywords ?? ''}`.toLowerCase().includes(needle),
    );
  }, [commands, query]);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setQuery('');
    setActiveIndex(0);
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      cancelAnimationFrame(frame);
      previousFocusRef.current?.focus();
    };
  }, [open]);

  if (!open) return null;

  const run = (command: AppCommand | undefined) => {
    if (!command) return;
    onClose();
    command.action();
  };
  const activeCommand = filtered[activeIndex];

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <section
        className="command-palette glass-panel-heavy"
        role="dialog"
        aria-modal="true"
        aria-label="命令面板"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose();
          if (event.key === 'Tab') {
            const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('input, button:not([disabled])'));
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
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActiveIndex((index) => Math.min(filtered.length - 1, index + 1));
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActiveIndex((index) => Math.max(0, index - 1));
          }
          if (event.key === 'Enter') {
            event.preventDefault();
            run(filtered[activeIndex]);
          }
        }}
      >
        <div className="command-input-row">
          <Icon name="search" size={18} />
          <label className="sr-only" htmlFor="command-query">搜索命令</label>
          <input
            id="command-query"
            ref={inputRef}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls="command-listbox"
            aria-activedescendant={activeCommand ? `command-option-${activeCommand.id}` : undefined}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            placeholder="输入命令名称"
            autoComplete="off"
          />
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭命令面板">
            <Icon name="close" size={16} />
          </button>
        </div>
        <div id="command-listbox" className="command-list" role="listbox" aria-label="可用命令">
          {filtered.map((command, index) => (
            <button
              key={command.id}
              id={`command-option-${command.id}`}
              type="button"
              role="option"
              tabIndex={-1}
              aria-selected={index === activeIndex}
              className={index === activeIndex ? 'command-item is-active' : 'command-item'}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => run(command)}
            >
              <span>{command.label}</span>
              {command.shortcut && <kbd>{command.shortcut}</kbd>}
            </button>
          ))}
          {filtered.length === 0 && <div className="command-empty">没有匹配的命令</div>}
        </div>
      </section>
    </div>
  );
}
