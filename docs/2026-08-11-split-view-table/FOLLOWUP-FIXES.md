# FOLLOWUP-FIXES — 分屏/树视图第二轮修复

> 承接 f1b8177。用户实测反馈 6 处问题，决策已定，逐条给精确落点。
> 硬约束沿用 DESIGN.md §12：不动 ICON_CODEPOINTS、保 theme-parity 取色类名、保虚拟化与 50k 闸门。

## F1 展开容器行多渲染了逗号（bug）

- 现象：展开的对象/数组行渲染成 `"tags": {,`（图6），开括号后多了个逗号。
- 落点：`src/components/TreeView.tsx:227` `const comma = row.isLast ? '' : ','`。
  展开行（`row.kind === 'open'`，token 为 `{`/`[`）不应带逗号——逗号只属于闭合行（`:217` 已正确渲染 `},`）。
- 决策：**保留大括号代码化样式**（图2 目标形态），仅修逗号。
- 改法：`const comma = (row.kind === 'open' || row.isLast) ? '' : ','`。
  折叠容器行（kind='value'，token `{…}N`）仍照常带逗号，不受影响。
- 验收：展开的非末项容器显示 `"key": {`（无逗号），其闭合行显示 `},`；折叠容器仍是 `"key": {…}3,`。

## F2 整行可点选中（当前必须点键名）

- 落点：现仅 `.tree-path` 按钮 `onClick` 触发 `onSelectPath`（`TreeView.tsx:256`）。
- 改法：在外层 `.tree-flat-row`（`:230`，仅非 close 行）加 `onClick` → `onSelectPath(row.path)`；
  对以下子控件的 onClick 调 `event.stopPropagation()`，避免其行为附带触发选中：
  展开箭头按钮（`:242`）、子树按钮（`:288`）、URL 值按钮（`:261`）、四个行内操作按钮（`:301/303/305/307`）。
  `.tree-path` 可保留（点它冒泡到行→选中，等价）。
- 注意：不要破坏现有键盘导航（↑↓/←→/Shift）与 `data-tree-row`/`tabIndex` 焦点逻辑。
- 验收：点整行任意空白处都能选中该节点（状态栏「当前节点」更新、行高亮）；点箭头只展开不误选；
  点复制/下载/删除只执行该操作；`components.test.tsx:184` 点 `"user"` 仍应命中 `onSelectPath('$.user')`。

## F3 行内操作按钮被右缘裁掉 + 窄栏时像“缺了一块”

- 现象：图4 窄栏时「复制|复制路径|下载|删除」被面板右缘裁掉；图5 拖到最左时按钮悬在空白里像缺块。
- 落点：`src/styles.css:2061` `.tree-row-actions { margin-left:auto; opacity:0; }`。
  行 `.tree-flat-row` 为 `position:absolute; width:100%`（内联样式），`.tree-row` 是其 flex 子元素。
  操作组走 `margin-left:auto` 排在内容流末尾，内容超过面板宽时被 `.tree-view`/pane 的 `overflow:hidden` 裁掉。
- 改法：把 `.tree-row-actions` 改为 `position:absolute; right:0; top:0; bottom:0`（定位到 `.tree-flat-row`），
  加与行悬停一致的背景（`var(--panel-hover)`）+ 左侧留白或渐隐，使其恒定贴右、悬停即完整可见、不再被裁；
  未悬停时 `opacity:0` 且 `pointer-events:none`。操作组移出 flex 流后，`.tree-value` 可占满行宽并按面板边界省略。
- 验收：面板拖到最窄（splitRatio 0.2）时操作组仍完整可见、贴右、有背景不悬空；值文本按面板右缘省略号截断。

## F4 两条标题栏合并为一条

- 现象：图8 上为 SplitWorkspace 的 pane 头（「树」+ 折叠柄），下为 TreeView 自带工具条（「树视图」+ 全部展开/全部收起）。两条重复占位。
- 改法：
  1. `SplitWorkspace.tsx`：`SplitWorkspaceProps` 增 `textHeaderExtra?: ReactNode`、`treeHeaderExtra?: ReactNode`；
     在 `.split-workspace-pane-header`（`:141`）里 pane 标题之后、折叠按钮之前渲染对应 extra（右对齐）。
  2. `TreeView.tsx`：**删除** `.tree-toolbar` 整块（`:370-383`）连同 `requestExpandAll`、`useConfirm`/`confirmDialog`
     及随之不再使用的 import（`expandAll`/`collapseAll`/`countVisibleRows`/`useConfirm`）。
     **保留** `export const EXPAND_ALL_CONFIRM_ROWS`（App 从 TreeView 引它，`App.tsx:17`）。
  3. `App.tsx`：构造 `treeHeaderExtra` = 「全部展开」(调已有 `expandAllRows`)、「全部收起」(`collapseAllRows`)、
     以及 `hiddenPaths.size>0` 时的「恢复隐藏 (N)」按钮，传给 `SplitWorkspace`。这些 App 已具备（`:285/:300`+hiddenPaths）。
- 验收：树侧只剩一条标题栏，含 标题 + 全部展开/全部收起/恢复隐藏 + 折叠柄；展开全部的 50k 确认弹窗仍生效
  （走 App 的 confirm）；build 与 `components.test.tsx` 全绿（TreeView 单测不再依赖内置工具条）。

## F5 顶栏放大镜与 ActionBar 的 Search 重复

- 决策：**留 ActionBar 的 Search**（JSONPath 路径查询浮层），**删顶栏放大镜**。编辑器内文本查找仍走 CodeMirror 的 Ctrl/⌘ F。
- 落点：`AppHeader.tsx:199-201` 顶栏 search icon-button；`App.tsx:1018-1019` 传入的 `canSearch`/`onSearch`。
- 改法：删掉顶栏放大镜按钮；`AppHeader` 若 `onSearch`/`canSearch` prop 因此不再使用则一并移除（同步改 `AppHeaderProps` 与 App 传参）。
  顺带清理 `onSearch` 里 `collapsedPane === 'text' ? editor.openSearch() : focusSearch()` 这段（text 折叠时反而开编辑器查找）的反逻辑——整块删除即可。
- 验收：顶栏不再有放大镜；ActionBar「Search」仍能开关 JSONPath 面板；编辑器聚焦时 Ctrl/⌘ F 仍可唤起 CodeMirror 查找。

## F6 ESC 退出搜索

- 现状：`SearchPanel` 仅有关闭按钮（`onClose`）。
- 改法：`SearchPanel.tsx` 给根 `aside` 或输入框加 `onKeyDown`：`Escape` → `onClose()`；
  并在 `App.tsx` 全局 keydown 里补：当 `activePanel === 'search'` 且按下 `Escape` → `setActivePanel(null)`
  （覆盖焦点不在面板内的情况）。注意别和编辑器/命令面板已有的 Esc 处理冲突。
- 验收：搜索面板打开时按 Esc 即关闭，无论焦点在输入框还是别处；不影响其它 Esc 行为。

## 通用验收
- `npm run build` 与 `npm test` 全绿，无跳过；受影响测试同步更新，不放宽原有断言。
- `ICON_CODEPOINTS` 零改动（不新增/不删除），`icon-subset` 与 `theme-parity` 仍绿。
- 不自动 git commit，改动留工作区待评审。发现新设计问题写入本目录 `KNOWN_ISSUES.md`。
