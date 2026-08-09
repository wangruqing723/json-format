# DESIGN —— 面板可调宽与顶栏收口

## 1. 根因分析（已核实，勿重新诊断）

### E1/E2 Schema 面板宽度固定 + 键名截断

面板宽度写死在 CSS，没有拖拽句柄，也没有持久化。面板内是「类型徽标 + 键名 + 值」三列，
键名列宽固定，所以 `assetPackName` 被截成 `assetPac…`、`attr_academic_year` 截成 `attr_a…`。

拉宽面板**不会**自动解决截断：多出的宽度全被值列吃掉，键名列宽度不变。
所以 E2 必须与 E1 一起做，否则用户拉宽后发现键名照旧截断。

### E3 左上角空白

`AppHeader.tsx:40` 的 `.header-sidebar-slot` 占满侧栏宽度（240px），
里面只有一个折叠按钮，且按钮靠右对齐（`AppHeader.tsx:41-49`）。
按钮左侧那 200 余 px 就是用户框出的空白。

同时侧栏顶部有一行「Workspace」（`Sidebar.tsx:41-42`，`data_object` 图标 + 文字），
它与应用品牌语义重复 —— 顶栏槽位放了品牌之后，这行就是第二个品牌。

**用户已拍板**：品牌（图标 + `JSON Forge`）移入顶栏槽位，折叠按钮留在槽位右端；
侧栏「Workspace」整行删除，腾出的 48px 高度给导航。

### E4 字体缓存

`chevron_left`（`e5cb`）是上一批新增的字形。已核实：
- 旧字体（HEAD，34 字形）**缺** `e5cb`
- 新字体（工作区，35 字形）**有** `e5cb`

但用户运行中的应用仍显示方框，因为组件走 HMR 热更新了，而 `public/fonts/*.woff2`
是静态资源、URL 未变，webview 继续用缓存的旧字体。

`data_object`（`ead3`）两个版本都有，其方框由同一个缓存副本导致（缓存的可能是更早的构建产物）。

这不是代码 bug，重启应用即恢复。但**产品上需要根治**：字体内容变了 URL 却不变，
用户升级应用后可能继续看到方框。

---

## 2. 实现要点

### E1 拖拽改宽

- 面板左缘加拖拽句柄，范围 **240–720px**
- 宽度存入 settings 随会话持久化（复用现有 workspace 持久化通道）
- 键盘可达：句柄可聚焦，`←/→` 以 16px 步进调整，`Home/End` 跳到最小/最大
- 句柄需有 `role="separator"` + `aria-valuenow/valuemin/valuemax` + `aria-label`
- 拖拽中禁用文本选中，避免选到面板内容

### E2 列宽自适应

键名列改为随面板宽度伸缩，而不是固定值。多出的宽度**优先给键名列**，
因为键名是定位数据的主要依据，值可以悬停查看。

值列保留 `text-overflow: ellipsis` 兜底 —— 长 URL 类值不可能全放下。
键名列在面板拉到 720px 时，常见键名（≤24 字符）应能完整显示。

### E3 品牌移位

- 品牌组件（图标 + `JSON Forge`）从侧栏移入 `.header-sidebar-slot`，靠左
- 折叠按钮 `margin-left: auto` 保持靠右（上一批 A1 的修复不要回退）
- 侧栏折叠时槽位宽度随之收窄，品牌文字隐藏只留图标
- 删除 `Sidebar.tsx` 的 Workspace 行及其专属样式；`.sidebar-brand` 相关 CSS 一并清理
- 上一批为修复 A1 加的 `.sidebar-brand > span` / `.sidebar-collapse-button` 规则，
  若随 Workspace 行一起删除，**需确认折叠按钮在新位置仍不被裁切**

### E4 缓存失效

在构建期给字体 URL 加内容哈希（Vite 对 `public/` 不做处理，需改为经 `src/assets` 引入，
或在 `@font-face` 的 `src` 上加基于文件内容的查询串）。

选型交由实现方判断，但必须满足：字体内容变化 → URL 变化 → 缓存自然失效。
不接受手工改版本号的方案（与 A3 同一类流程缺陷，人会忘）。

---

## 3. 不在本批次范围

- DiffView 接入 `json-diff`（P1，属 workspace-overhaul 需求目录）
- worker 生命周期（已记入上游 KNOWN_ISSUES）
- 侧栏宽度可拖拽（用户只要求 Schema 面板；如需要另开需求）
