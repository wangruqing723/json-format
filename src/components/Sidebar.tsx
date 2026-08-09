import type { WorkspaceView } from './AppHeader';
import { Icon } from './Icon';

export interface SidebarProps {
  activeView: WorkspaceView;
  onChangeView: (view: WorkspaceView) => void;
  collapsed: boolean;
  onNewDocument: () => void;
  onOpenDocs: () => void;
}

const viewTabs: Array<{ id: WorkspaceView; label: string; icon: string }> = [
  { id: 'text', label: '文本', icon: 'code' },
  { id: 'tree', label: '树', icon: 'account_tree' },
  { id: 'diff', label: 'Diff', icon: 'compare' },
  { id: 'history', label: '历史', icon: 'history' },
];

export function Sidebar({
  activeView,
  onChangeView,
  collapsed,
  onNewDocument,
  onOpenDocs,
}: SidebarProps) {
  // 折叠时整条侧栏让位给编辑区；展开/折叠由顶栏的按钮统一控制，
  // 侧栏不再自带折叠句柄，避免两个控件做同一件事。
  if (collapsed) return null;

  return (
    <aside className="sidebar" aria-label="主导航">
      <button className="new-project-button" type="button" onClick={onNewDocument}>
        <Icon name="note_add" size={17} />新建文档
      </button>
      <nav className="sidebar-nav" role="tablist" aria-label="工作区视图">
        {viewTabs.map(({ id, label, icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={activeView === id}
            className={activeView === id ? 'sidebar-tab is-active' : 'sidebar-tab'}
            onClick={() => onChangeView(id)}
          >
            <Icon name={icon} size={17} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <div className="sidebar-content" aria-hidden="true" />
      <div className="sidebar-footer">
        <button className="sidebar-tab sidebar-docs-button" type="button" onClick={onOpenDocs}>
          <Icon name="help" size={17} /><span>Docs</span>
        </button>
      </div>
    </aside>
  );
}
