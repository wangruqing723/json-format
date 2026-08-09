# API_SPEC —— 布局修复与交互补齐

## §1 `src/services/platform.ts` 新增

```ts
/**
 * 强制弹出保存对话框，忽略文档已有路径。
 * Tauri：直接调 dialog.save。
 * 浏览器：优先 showSaveFilePicker；不可用时回退 <a download> 并把
 *         fellBackToDownload 置 true，供上层提示用户。
 */
export async function saveJsonFileAs(
  content: string,
  currentTitle: string,
): Promise<SavedJsonFileAs | null>;

export interface SavedJsonFileAs extends SavedJsonFile {
  /** true 表示浏览器不支持选位置，已降级为下载 */
  fellBackToDownload: boolean;
}
```

约束：

- `saveJsonFile` 现有签名与行为**不得修改** —— 它已被 App.tsx 两处调用且行为正确。
- 用户取消对话框返回 `null`，不得抛错。
- `ensureJsonExtension` / `basename` 复用现有实现，不要重写。

## §2 `scripts/build-icon-subset.mjs` 新增

```
用法：node scripts/build-icon-subset.mjs

行为：
  1. 解析 src/components/Icon.tsx 的 ICON_CODEPOINTS，取全部 codepoint
  2. 调 pyftsubset 从完整 Material Symbols 字体生成子集
  3. 输出到 public/fonts/MaterialSymbolsOutlined-subset.woff2
  4. 打印「字形数 N，映射表 M 项」，N !== M 时以非零码退出
```

约束：

- 脚本必须能查出 pyftsubset 缺失并给出明确中文提示（`pip install fonttools`），
  不得静默失败。
- 完整源字体不入库；脚本从本地缓存或按需下载，路径可用环境变量覆盖。
- `package.json` 加 `"icons:subset": "node scripts/build-icon-subset.mjs"`。

## §3 `src/components/Icon.tsx` 变更

`ICON_CODEPOINTS` 必须导出（当前是模块私有），供测试读取：

```ts
export const ICON_CODEPOINTS = { /* ... */ } as const;
```

新增图标按需补入，优先复用现有 35 项。本次预计需要：

- `chevron_left`（折叠柄反向）
- `save_as` 或复用 `save`（另存为）

## §4 `src/components/Sidebar.tsx` 接口变更

```ts
// 删除 SidebarTab，改用 WorkspaceView（来自 AppHeader.tsx）
export interface SidebarProps {
  activeView: WorkspaceView;
  onChangeView: (view: WorkspaceView) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onNewDocument: () => void;
  onOpenDocs: () => void;
}
```

移除的 props：`activeTab`、`onChangeTab`、`recentFiles`、`onOpenRecent`、`search`。
搜索面板从 Sidebar 移出，成为独立组件（见 §5）。

## §5 `src/components/SearchPanel.tsx` 新建

把 Sidebar 里的搜索 UI（`Sidebar.tsx:89-121`）原样搬出，不改行为：

```ts
export interface SearchPanelProps {
  input: string;
  onChangeInput: (value: string) => void;
  result: QueryResult | null;
  onSelectHit: (hit: QueryHit) => void;
  onClose: () => void;
}
```

约束：搬迁只挪位置，查询逻辑、命中渲染、错误文案一律不动。

## §6 `src/components/ActionBar.tsx` 变更

`ActionBarProps` 新增：

```ts
onSaveAs: () => void;
onCopyAll: () => void;
activePanel: 'search' | 'schema' | null;
onTogglePanel: (panel: 'search' | 'schema') => void;
```

`moreActions` 中 `id: 'copy'` 那项删除（提到工具栏后不再重复出现在菜单里）。

## §7 测试要求

新建 `src/components/icon-subset.test.ts`：

```
- 映射表每个 codepoint 都在子集字体 cmap 中（读 public/fonts/*.woff2）
- 映射表无重复 codepoint（restore 与 history 当前都是 e8b3，需确认是否有意）
```

第二条注意：`Icon.tsx:26,31` 里 `history` 和 `restore` 都映射到 `e8b3`。
若确为笔误应修正；若有意复用则在测试里显式允许该对，不要静默放过。

现有 71 个测试**一个都不许改**。本批次是布局与交互调整，
任何现有断言失败都说明改坏了行为，不是测试过时。
