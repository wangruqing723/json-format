import type { JsonDocument } from '../types';
import { Icon } from './Icon';

export type WorkspaceView = 'text' | 'tree' | 'diff' | 'history';

export interface AppHeaderProps {
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  documents: JsonDocument[];
  activeDocumentId: string;
  onSelectDocument: (id: string) => void;
  onCloseDocument: (id: string) => void;
  onNewDocument: () => void;
  canSearch: boolean;
  onSearch: () => void;
  onOpenCommandPalette: () => void;
  onOpenSettings: () => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
}

export function AppHeader({
  sidebarCollapsed,
  onToggleSidebar,
  documents,
  activeDocumentId,
  onSelectDocument,
  onCloseDocument,
  onNewDocument,
  canSearch,
  onSearch,
  onOpenCommandPalette,
  onOpenSettings,
  theme,
  onToggleTheme,
}: AppHeaderProps) {
  return (
    <header className={`app-header${sidebarCollapsed ? ' is-sidebar-collapsed' : ''}`}>
      <div className="header-topline">
        <div className="header-sidebar-slot">
          <div className="header-brand" aria-label="JSON Forge">
            <span className="header-brand-mark"><Icon name="data_object" size={17} /></span>
            <span className="header-brand-text">JSON Forge</span>
          </div>
          <button
            className="icon-button header-sidebar-toggle"
            type="button"
            onClick={onToggleSidebar}
            aria-label={sidebarCollapsed ? '展开侧栏' : '折叠侧栏'}
            data-tooltip={sidebarCollapsed ? '展开侧栏' : '折叠侧栏'}
          >
            <Icon name={sidebarCollapsed ? 'chevron_right' : 'chevron_left'} size={16} />
          </button>
        </div>
        <div className="header-documents" aria-label="文档标签">
          <div className="tabs-scroll">
            {documents.map((document) => (
              <div key={document.id} className={document.id === activeDocumentId ? 'document-tab is-active' : 'document-tab'}>
                <button type="button" className="tab-select" onClick={() => onSelectDocument(document.id)} title={document.filePath ?? document.title}>
                  <span className={document.savedContent !== document.content ? 'dirty-dot is-dirty' : 'dirty-dot'} />
                  <span>{document.title}</span>
                </button>
                <button className="tab-close" type="button" onClick={() => onCloseDocument(document.id)} aria-label={`关闭 ${document.title}`}>
                  <Icon name="close" size={13} />
                </button>
              </div>
            ))}
          </div>
          <button className="new-tab-button icon-button" type="button" onClick={onNewDocument} data-tooltip="新建 (Ctrl/⌘ N)" aria-label="新建文档">
            <Icon name="note_add" size={15} />
          </button>
        </div>
        <div className="title-actions">
          <button className={`icon-button${canSearch ? '' : ' is-disabled'}`} type="button" aria-disabled={!canSearch} onClick={onSearch} data-tooltip={canSearch ? '查找 (Ctrl/⌘ F)' : '当前视图不可查找'} aria-label="查找">
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
    </header>
  );
}
