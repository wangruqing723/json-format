# DESIGN —— 布局修复与交互补齐

## 1. 从代码读出的根因（不是猜测，逐条给了行号）

### A1 折叠按钮被裁切

`.sidebar-brand`（`styles.css:1285`）是 `display: flex; gap: 8px; padding: 0 16px`，
三个子元素（图标 / `Workspace` 文字 / 折叠按钮）依次平铺。折叠按钮**没有 `margin-left: auto`**，
所以它紧跟文字而非靠右；`.sidebar` 固定 `width: 240px` 且 `overflow: hidden`（`styles.css:1273-1283`），
按钮超出部分被裁 —— 截图里只露出一半正是这个。

**修法**：折叠按钮加 `margin-left: auto; flex: 0 0 auto`，
`Workspace` 文字加 `min-width: 0; overflow: hidden; text-overflow: ellipsis`，
保证宽度不足时先截文字而不是挤按钮。

### A2 文档标签栏压住侧栏顶部

侧栏与文档标签栏是相邻布局块，标签栏未为侧栏让出宽度，尾部覆盖到侧栏首行。
本轮 B3 会把顶栏重构成明确的三段栅格，A2 随之消解 —— 但仍需独立验收，
因为 B3 若延后，A2 必须能单独修好。

### A3 图标字形缺失

`Icon.tsx` 映射表有 35 项，但 `public/fonts/MaterialSymbolsOutlined-subset.woff2` 只有一份手工子集，
**仓库里没有生成脚本**（已确认 `scripts/` 不存在、`package.json` 无 subset 相关脚本）。
截图中 `data_object`（codepoint `ead3`）渲染成方框占位符，说明该字形不在子集内。

这正是上游 KNOWN_ISSUES 警告过的「改映射表但漏做重新生成子集」。
根因是**流程缺失**而非单个字形写错，所以本任务要求：

1. 写 `scripts/build-icon-subset.mjs`，从映射表自动抽取全部 codepoint 生成子集，
   杜绝手工遗漏；
2. 加一个测试，断言映射表里每个 codepoint 都存在于子集字体的 cmap 中 ——
   下次再漏，测试直接失败而不是等用户截图。

> 备注：我尝试用 fontTools 直接校验缺失清单时 Bash 分类器连续不可用，
> 未能取得完整缺失列表。但这不影响方案：脚本按映射表全量重生成，
> 无论当前缺哪几个都会被覆盖；测试则负责持续保证。

### D1 选中态不明显

搜索命中行样式在 `styles.css:1969`：
`.tree-flat-row.is-highlighted .tree-row { background: var(--accent-soft); box-shadow: inset 2px 0 var(--accent); }`

`.tree-row:hover`（`styles.css:669`、`1757`）同样靠背景色变化表达状态，两者视觉权重接近；
`--accent-soft` 是低透明度粉，压在暗底上本就很淡。结果是命中行与随手悬停的行难以区分。

**修法**：命中态改为多通道表达，不只靠背景亮度：

- 左侧竖条从 2px 加到 3px 并提高不透明度
- 背景换用比 `--accent-soft` 更实的一档
- 命中行的键名（`.tree-path`）加粗一级

三个通道叠加后即使背景对比有限也能一眼定位。悬停态保持原样不动 ——
改悬停会波及所有树行，超出本次范围。

---

## 2. 导航重排（用户已拍板方案二）

**最终形态**

- **侧栏**：顶部折叠柄 + 新建文档 + 视图导航（文本 / 树 / Diff / 历史）
- **工具栏**：打开▾ / 保存 / 另存为 / 复制全文 / 格式化 / 压缩 / 键排序 / 修复 / … / Search / Schema
- **顶栏**：折叠柄 + 文档标签 + 图标组（查找 / 命令面板 / 主题 / 设置）

**Explorer tab 删除。** 它只承载「最近文件」，而工具栏「打开▾」下拉已经提供同一份列表 ——
这是上一轮就存在的重复，本轮一并消掉。

**`SidebarTab` 类型变更**：`'explorer' | 'search' | 'schema'` → `'text' | 'tree' | 'diff' | 'history'`。
Search / Schema 不再是 sidebar tab，改为工具栏按钮触发的浮层面板，
状态由 App 层单独持有（`activePanel: 'search' | 'schema' | null`），与视图切换解耦 ——
两者语义不同：视图是「主区域显示什么」，面板是「附加工具开着没」。

**风险**：`WorkspaceView` 与 `SidebarTab` 会出现语义重叠。
要求二者合并为单一类型 `WorkspaceView`，`SidebarTab` 删除，避免两套真值来源。

---

## 3. 保存行为（用户已拍板：首次弹框 + 另存为）

`platform.ts:70-99` 现状：

- Tauri 运行时：`currentPath ?? await save({...})` —— 已有路径直接覆盖，无路径才弹框。**行为已符合要求，不改。**
- 浏览器运行时：走 `<a download>` 直接下载 —— 这是用户看到「直接下载」的来源。

**新增**：`saveJsonFileAs(content, currentTitle)`，忽略 `currentPath` 强制弹框。
浏览器模式下优先用 File System Access API（`showSaveFilePicker`）真正让用户选位置，
不可用时回退到现有下载分支并提示「浏览器不支持选择保存位置」。

**接线**：工具栏「保存」旁加「另存为」按钮，快捷键 `Ctrl/⌘ Shift S`。

---

## 4. 不做什么

- 不改悬停态样式（波及面过大）
- 不动 `worker-client` 的 worker 生命周期（上游 KNOWN_ISSUES 已记录，非本批次）
- 不接 DiffView 的 `json-diff`（P1，属上游需求目录）
- 不引入新 npm 依赖
