import type { JsonDocument, RecentFile } from '../types';
import { Icon } from './Icon';

export type SidebarTab =
  | 'explorer' | 'schema' | 'variables' | 'requests' | 'snippets'
  | 'docs' | 'status';

interface SidebarProps {
  activeTab: SidebarTab;
  onChangeTab: (tab: SidebarTab) => void;
  documents: JsonDocument[];
  activeDocumentId: string;
  recentFiles: RecentFile[];
  onSelectDocument: (id: string) => void;
  onOpenRecent: (path: string) => void;
  onNewDocument: () => void;
  documentCount: number;
  processingLabel: string | null;
  persistenceIssue: string | null;
  onOpenDocs: () => void;
}

const primaryTabs: Array<{ id: SidebarTab; label: string; icon: string }> = [
  { id: 'explorer', label: 'Explorer', icon: 'folder_open' },
  { id: 'schema', label: 'Schema', icon: 'account_tree' },
  { id: 'variables', label: 'Variables', icon: 'data_object' },
  { id: 'requests', label: 'Requests', icon: 'api' },
  { id: 'snippets', label: 'Snippets', icon: 'code' },
];

const footerTabs: Array<{ id: SidebarTab; label: string; icon: string }> = [
  { id: 'docs', label: 'Docs', icon: 'help' },
  { id: 'status', label: 'Status', icon: 'sensors' },
];

export function Sidebar({
  activeTab,
  onChangeTab,
  documents,
  activeDocumentId,
  recentFiles,
  onSelectDocument,
  onOpenRecent,
  onNewDocument,
  documentCount,
  processingLabel,
  persistenceIssue,
  onOpenDocs,
}: SidebarProps) {
  const renderTab = ({ id, label, icon }: { id: SidebarTab; label: string; icon: string }) => (
    <button
      key={id}
      type="button"
      role="tab"
      aria-selected={activeTab === id}
      className={activeTab === id ? 'sidebar-tab is-active' : 'sidebar-tab'}
      onClick={() => id === 'docs' ? onOpenDocs() : onChangeTab(id)}
    >
      <Icon name={icon} size={17} />
      <span>{label}</span>
    </button>
  );

  return (
    <aside className="sidebar" aria-label="主导航">
      <div className="sidebar-brand"><Icon name="data_object" size={18} /><span>Workspace</span></div>
      <button className="new-project-button" type="button" onClick={onNewDocument}>
        <Icon name="note_add" size={17} />新建文档
      </button>
      <nav className="sidebar-nav" role="tablist" aria-label="工作区导航">
        {primaryTabs.map(renderTab)}
      </nav>
      <div className="sidebar-content">
        {activeTab === 'explorer' && (
          <>
            <div className="sidebar-section-title">打开的文档</div>
            <div className="sidebar-document-list">
              {documents.map((document) => (
                <button key={document.id} className={document.id === activeDocumentId ? 'sidebar-document is-active' : 'sidebar-document'} type="button" onClick={() => onSelectDocument(document.id)} title={document.filePath ?? document.title}>
                  <span className={document.savedContent !== document.content ? 'dirty-dot is-dirty' : 'dirty-dot'} />
                  <span>{document.title}</span>
                </button>
              ))}
            </div>
            <div className="sidebar-section-title">最近文件</div>
            {recentFiles.length ? recentFiles.map((file) => (
              <button key={file.path} className="sidebar-document sidebar-document--recent" type="button" onClick={() => onOpenRecent(file.path)} title={file.path}>
                <Icon name="history" size={14} /><span>{file.name}</span>
              </button>
            )) : <span className="sidebar-empty">暂无最近文件</span>}
          </>
        )}
        {activeTab === 'schema' && <div className="sidebar-hint">结构面板已切换</div>}
        {(['variables', 'requests', 'snippets'] as SidebarTab[]).includes(activeTab) && (
          <div className="sidebar-placeholder" role="status">
            <Icon name="construction" size={25} />
            <strong>暂未实现</strong>
            <span>该工作区功能将在后续版本提供。</span>
          </div>
        )}
        {activeTab === 'status' && (
          <div className="sidebar-status-card">
            <div><span>文档</span><strong>{documentCount}</strong></div>
            <div><span>Worker</span><strong>{processingLabel ?? '空闲'}</strong></div>
            <div><span>持久化</span><strong>{persistenceIssue ? '有告警' : '正常'}</strong></div>
          </div>
        )}
        {activeTab === 'docs' && <div className="sidebar-hint">正在打开项目文档…</div>}
      </div>
      <nav className="sidebar-footer" role="tablist" aria-label="辅助导航">
        {footerTabs.map(renderTab)}
      </nav>
    </aside>
  );
}
