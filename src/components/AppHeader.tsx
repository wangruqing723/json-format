import { Icon } from './Icon';

export type WorkspaceView = 'text' | 'tree' | 'diff' | 'history';

interface AppHeaderProps {
  activeView: WorkspaceView;
  onChangeView: (view: WorkspaceView) => void;
  title: string;
  dirty: boolean;
  canSearch: boolean;
  onSearch: () => void;
  onOpenCommandPalette: () => void;
  onOpenSettings: () => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
}

export function AppHeader({
  activeView,
  onChangeView,
  title,
  dirty,
  canSearch,
  onSearch,
  onOpenCommandPalette,
  onOpenSettings,
  theme,
  onToggleTheme,
}: AppHeaderProps) {
  return (
    <header className="app-header">
      <div className="header-topline">
        <div className="brand" aria-label="JSON Forge">
          <span className="brand-mark"><Icon name="data_object" size={19} /></span>
          <strong>JSON Forge</strong>
        </div>
        <div className="title-file" title={title}>
          {title}{dirty ? ' •' : ''}
        </div>
        <div className="title-actions">
          <button className={`icon-button${canSearch ? '' : ' is-disabled'}`} type="button" aria-disabled={!canSearch} onClick={onSearch} data-tooltip={canSearch ? '查找 (Ctrl/⌘ F)' : '仅文本视图可查找'} aria-label="在当前文档中查找">
            <Icon name="search" size={17} />
          </button>
          <button className="icon-button" type="button" onClick={onOpenCommandPalette} data-tooltip="命令面板 (Ctrl/⌘ K)" aria-label="打开命令面板">
            <Icon name="bottom_panel_open" size={17} />
          </button>
          <button className="icon-button" type="button" onClick={onToggleTheme} data-tooltip={theme === 'dark' ? '切换浅色主题' : '切换深色主题'} aria-label={theme === 'dark' ? '切换浅色主题' : '切换深色主题'}>
            <Icon name={theme === 'dark' ? 'light_mode' : 'dark_mode'} size={17} />
          </button>
          <button className="icon-button" type="button" onClick={onOpenSettings} data-tooltip="设置" aria-label="打开设置">
            <Icon name="settings" size={17} />
          </button>
        </div>
      </div>
      <nav className="view-nav" aria-label="视图模式">
        {([
          ['text', '文本'],
          ['tree', '树'],
          ['diff', 'Diff'],
          ['history', '历史'],
        ] as const).map(([view, label]) => (
          <button
            key={view}
            type="button"
            className={activeView === view ? 'is-active' : ''}
            aria-pressed={activeView === view}
            onClick={() => onChangeView(view)}
          >
            {label}
          </button>
        ))}
      </nav>
    </header>
  );
}
