# API_SPEC:新增组件接口契约

仅约定**新增组件**与**变更的既有接口**。所有类型放各组件文件内导出,不新建全局类型文件
(现有 `src/types.ts` 只放领域类型,不放组件 props)。

## 1. Sidebar

`src/components/Sidebar.tsx`

```ts
export type SidebarTab =
  | 'explorer' | 'schema' | 'variables' | 'requests' | 'snippets'
  | 'docs' | 'status';

interface SidebarProps {
  activeTab: SidebarTab;
  onChangeTab: (tab: SidebarTab) => void;

  // Explorer 内容区数据(真实功能)
  documents: JsonDocument[];          // 复用 src/types.ts 既有类型
  activeDocumentId: string;
  recentFiles: RecentFile[];          // 复用 stores/workspace 既有类型
  onSelectDocument: (id: string) => void;
  onOpenRecent: (path: string) => void;

  // CTA
  onNewDocument: () => void;

  // Status 内容区数据(真实功能)
  documentCount: number;
  processingLabel: string | null;      // 有后台任务时的操作名,否则 null
  persistenceIssue: string | null;     // 持久化告警文案,否则 null

  // Docs
  onOpenDocs: () => void;
}
```

约束:
- 组件内**不直接访问** `useWorkspaceStore`,全部数据由 props 注入,便于单测
- `schema` tab 的切换效果由父级消费(控制右面板显隐),Sidebar 只负责上报
- 根元素 `<aside>`,`aria-label="主导航"`;导航区用 `role="tablist"` + `role="tab"`
- 窄屏 `hidden md:flex`

## 2. StructurePanel

`src/components/StructurePanel.tsx`

```ts
interface StructurePanelProps {
  source: string;                     // 当前文档原文
  onSelectPath?: (path: string) => void;
  oversized?: boolean;                // true 时不解析,显示占位
}
```

约束:
- 内部用 `parseJson`(来自 `../core/json-parser`)构建树,**禁止另写解析器**
- 解析失败时显示空状态,文案「暂无可解析的 JSON 结构」,`role="status"`
- 路径拼接规则必须与 `TreeView` 一致(`$.a.b` / `$["a-b"]` / `$[0]`);
  建议把 `TreeView` 内的 `propertyPath` 提到 `src/core/json-path.ts` 供两处共用,避免规则漂移
- 根元素 `<aside>`,`aria-label="结构总览"`,窄屏 `hidden lg:flex`
- 用 `useMemo` 按 `source` 缓存解析结果

## 3. AppHeader

`src/components/AppHeader.tsx`(从 App.tsx 的 `.titlebar` 抽出)

```ts
// 'history' 是应用级视图,不属于某个文档;前三态对应现有 document.view + diff 状态
type WorkspaceView = 'text' | 'tree' | 'diff' | 'history';

interface AppHeaderProps {
  activeView: WorkspaceView;
  onChangeView: (view: WorkspaceView) => void;
  title: string;                      // 当前文档名或 "左 ↔ 右"
  dirty: boolean;
  canSearch: boolean;
  onSearch: () => void;
  onOpenCommandPalette: () => void;
  onOpenSettings: () => void;
  theme: 'light' | 'dark';            // 已解析的实际主题
  onToggleTheme: () => void;
}
```

约束:
- **不放用户头像** —— 参考项目那个是 Demo 的假头像(硬编码 googleusercontent 链接),
  本项目无账号体系,且外链头像违反离线可用性
- `onToggleTheme` 在 `settings.theme` 的 `light`/`dark` 间切换;
  当前值为 `system` 时,按已解析主题取反后写入具体值
- 品牌文案保持 `JSON Forge`,不用参考项目的 `NEON_PARSE`

## 4. ActionBar

`src/components/ActionBar.tsx`(从 App.tsx 的 `.toolbar` 抽出)

```ts
type StatusTone = 'success' | 'error' | 'warning' | 'info';

interface ActionBarProps {
  onOpen: () => void;
  onSave: () => void;
  onFormat: () => void;
  onMinify: () => void;
  onSort: () => void;
  onRepair: () => void;
  transformsDisabled: boolean;
  disabledReason: string | null;       // 禁用时的 tooltip 文案

  recentFiles: RecentFile[];
  onOpenRecent: (path: string) => void;

  status: { tone: StatusTone; text: string; line?: number; column?: number };
  onRevealDiagnostic?: () => void;     // 状态药丸上行列号的点击回调

  moreActions: MoreAction[];
}

interface MoreAction {
  id: string;
  label: string;
  icon: string;                        // Material Symbols 连字名
  disabled?: boolean;
  onSelect: () => void;
}
```

约束:
- `role="toolbar"`,`aria-label="JSON 工具"`(保持现值)
- 状态药丸 `aria-live="polite"`
- 「更多」菜单保持现有 `role="menu"` / `role="menuitem"` 结构与外点/Esc 关闭行为

## 5. InfoRow

`src/components/InfoRow.tsx`(面包屑 + 状态栏合并,见 DESIGN.md §4①)

```ts
interface InfoRowProps {
  path: string;                        // 文件完整路径,无文件时显示文档名
  cursor: { line: number; column: number };
  bytes: number;
  nodeCount: number | null;
  indent: number | 'tab';
  durationMs: number | null;
  restricted: boolean;                 // 超过 AUTO_VALIDATE_LIMIT 的受限模式
  persistenceIssue: string | null;
}
```

约束:字节数/耗时格式化沿用 App.tsx 现有 `formatBytes` 与 `toFixed(1)`,不改口径。

## 6. HistoryView

`src/components/HistoryView.tsx`。设计约束见 `DESIGN.md` §9。

```ts
export interface HistoryRecord {
  id: string;
  documentId: DocumentId;             // 快照来源文档
  documentTitle: string;              // 记录时的文档名(文档可能已关闭或改名)
  operation: WorkerOperation | 'restore';  // 'restore' 用于「恢复前」的自动存档
  operationLabel: string;             // 中文操作名,复用 App.tsx 的 operationLabels;'restore' → '恢复'
  content: string | null;             // null = 超过 256 KB 未存快照
  bytes: number;                      // 原内容字节数,即使未存快照也记录
  createdAt: number;
}

interface HistoryViewProps {
  history: HistoryRecord[];
  onRestore: (record: HistoryRecord) => void;
  onClear: () => void;
}
```

约束:
- 根元素 `<main>`,`aria-label="操作历史"`
- 空状态 `role="status"`,文案「暂无历史快照。执行格式化或修复等操作后会自动记录。」
- `content === null` 的记录:恢复按钮 `disabled` + `data-tooltip` 说明超限原因,**不要隐藏按钮**
- `onClear` 前需二次确认(沿用现有 `window.confirm` 风格,与关闭脏文档一致)
- `onRestore` 的完整语义见 `DESIGN.md` §9「恢复语义」:回原文档 / 已关闭则开新标签、
  脏文档二次确认、恢复前自动存一条 `'restore'` 记录、收尾切回文本视图
- 时间戳按本地时区格式化到秒;字节数复用 App.tsx 的 `formatBytes` 口径
- 列表按 `createdAt` 倒序(最新在上)

## 7. workspace store 变更

`src/stores/workspace.ts`

```ts
export const MAX_HISTORY_RECORDS = 20;
export const MAX_HISTORY_SNAPSHOT_BYTES = 256 * 1024;

interface WorkspaceStore extends WorkspaceState {
  // ... 既有成员不变
  history: HistoryRecord[];
  addHistoryRecord: (input: Omit<HistoryRecord, 'id' | 'createdAt'>) => void;
  clearHistory: () => void;
}
```

约束(**这几条是硬要求,搞错会导致用户文档丢失**):
- `history` **绝不能**加进 `persistWorkspace()` 的序列化字段。该函数是白名单式挑字段,
  只取 `documents` / `activeDocumentId` / `diff` / `settings` / `recentFiles` —— 保持原样即可
- **不要**修改 `PersistedWorkspace` 类型、`version: 1` 常量或 `readPersistedWorkspace`。
  改版本号会让老用户已保存的会话被判定失效而清空
- **不需要** `sanitizeHistory`(不持久化就不存在反序列化不可信数据的问题)
- `addHistoryRecord` 内部生成 `id`(复用 `createId`)与 `createdAt`(复用 `now`),
  并 `.slice(0, MAX_HISTORY_RECORDS)`,写法对齐既有 `addRecentFile`
- 内容字节数 > `MAX_HISTORY_SNAPSHOT_BYTES` 时把 `content` 置 `null`,其余字段照常记录
- 这两个 action 走 `commit()` 触发持久化调度是无害的(history 不在序列化字段里),
  但更省事的做法是直接用 `set()` 跳过持久化调度 —— 二者皆可,择一即可

## 8. 既有组件的变更点

| 组件 | 变更 |
|---|---|
| `JsonEditor` | CodeMirror 主题色改霓虹(chrome 部分);语法高亮保持多色相不改单一色系;`theme` prop 签名不变 |
| `TreeView` | 仅换样式与图标;**props、`aria-label`、路径规则一律不变**;`propertyPath` 提取到 `core/json-path.ts` |
| `DiffView` | 仅换样式与图标;**必须保留 `.diff-line--changed` 类名**;`buildDiffRows` 导出与逻辑不变 |
| `CommandPalette` | 仅换样式;`role="combobox"` / `option` / `aria-activedescendant` 结构不变 |
| `SettingsDialog` | 仅换样式;`onChange` 契约不变;主题按钮可访问名保持 `深色` / `浅色` / `跟随系统` |
| `App.tsx` | 抽出上述组件后只保留状态编排与布局骨架,不再直接写 chrome 结构;`runOperation` 内接入 `addHistoryRecord`(时机见 DESIGN.md §9) |
