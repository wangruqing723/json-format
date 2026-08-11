# DESIGN — 分屏视图 + 表格提取（删除 Schema 面板）

> 需求日期 2026-08-11 · slug `split-view-table`
> 用户已拍板的决策见「决策记录」，实现不得偏离；发现设计问题写 `KNOWN_ISSUES.md`。

## 1. 背景

当前「树模式」与「Schema 面板」功能冲突：两者数据源同为 `App.tsx` 的 `parseResult.root`，
渲染的是同一棵 JSON 树，且能同屏（浮层 `position: absolute; z-index: 8`，
渲染条件只看 `activePanel` 不看 `activeDocument.view`）。

成因：`docs/2026-08-08-neon-ui-revamp/DESIGN.md:127` 时期面板是唯一的树，
`docs/2026-08-09-ui-polish/DESIGN.md:70-72` 把侧栏改成 `text|tree|diff|history` 后
树视图升为主区一等公民，Schema 浮层未跟着收口。

重复的那份还是弱化版：无虚拟化（`StructureNode` 直接递归，默认展开 `depth < 2`）、
无 50k 行闸门、无搜索高亮、无复制、`onSelectPath` 在 `App.tsx:1074` 未接线（点击是死路）、
展开态与树视图各自一套不同步。

## 2. 目标

1. 删除 Schema 整条链路。
2. 文本与树同屏分栏展示，可切左右/上下，可折叠单侧退化为纯文本或纯树。
3. 树行渲染改为 `"key": value` 同行形态，带类型着色、缩进引导线、hover 行内操作。
4. 新增表格视图浮窗，把选中节点提取成表格。

## 3. 决策记录（用户已拍板，不得改动）

| 编号 | 决策 |
|---|---|
| D1 | 侧栏 3 个 tab：编辑 / Diff / 历史。分屏是唯一编辑形态，靠折叠单侧退化 |
| D2 | 旧快照 `view: 'text'` → 折叠树侧；`view: 'tree'` → 折叠文本侧 |
| D3 | 树行照参考图重做渲染 |
| D4 | 「删除」只隐藏树的显示，不改原始 JSON 文本；内容一变节点回来 |
| D5 | URL 值可点击打开外部浏览器；hover 可预览图片 |
| D6 | 右上按钮只做「表格」；「提取」即现有搜索（JSONPath 查询），不新增 |
| D7 | 表格：以选中节点为源、支持三形态、嵌套值截断+下钻、复制单元格/整表 TSV |
| D8 | 补 `opener:allow-open-url` 权限；前端只放行 http/https，打开前 toast 提示域名 |
| D9 | CSP `img-src` 放开 `https:`，设置项「允许加载远程图片预览」**默认关** |
| D10 | 本次**不新增任何图标**。缺图标的位置（表格、分屏方向）用纯文字按钮。`ICON_CODEPOINTS` 一个字都不加 |

## 4. 视图模型改造

### 4.1 类型语义

`DocumentView = 'text' | 'tree'` 语义作废，改为「哪一侧被折叠」：

```
CollapsedPane = 'none' | 'text' | 'tree'   // 值 = 被折叠的那一侧
JsonDocument.collapsedPane: CollapsedPane  // 替换 JsonDocument.view
WorkspaceView = 'edit' | 'diff' | 'history'  // 替换 'text'|'tree'|'diff'|'history'
```

`collapsedPane` 保持 per-document（与旧 `view` 一致，用户对不同文档的偏好不互相污染）。

**「不折叠」用 `'none'` 而非 `null`**（2026-08-11 修正，此前 `API_SPEC.md` 误写成 `null`）：
旧快照里该字段是 `undefined`（字段不存在），若用 `null` 表示「不折叠」，
`null` 与 `undefined` 在迁移分支里极易混淆 —— 前者是合法值该保留，后者要走 §4.2 的迁移。
纯字符串联合还能让 `sanitizeDocuments` 的校验保持单一 `includes` 判断，与旧 `DocumentView` 同构。

### 4.2 旧快照迁移（关键风险点）

`src/stores/workspace.ts:441-455` 的 `isJsonDocument` 校验 `view === 'text' || view === 'tree'`。
若只改类型不做迁移，`sanitizeDocuments` 会把**所有旧文档判为非法全部丢弃**，用户会话内容全丢。

要求 `sanitizeDocuments` 从「过滤器」升级为「过滤 + 迁移」：

- 有合法 `collapsedPane` → 原样保留。
- 无 `collapsedPane` 但有旧 `view`：`'text'` → `collapsedPane: 'tree'`，`'tree'` → `collapsedPane: 'text'`（D2）。
- 两者都无/都非法 → `collapsedPane: 'none'`，其余字段合法就保留文档，不因这一个字段丢文档。

同一套迁移必须同时覆盖 localStorage 路径（`readPersistedWorkspace`）和
原生会话路径（`hydrateWorkspace`，`src/services/native-session.ts` 恢复的快照）。

`WORKSPACE_STORAGE_KEY` 保持 `json-forge.workspace.v1` 不变、`PersistedWorkspace.version` 保持 `1`：
迁移是字段级向后兼容，不是破坏性变更，抬版本会让旧数据走不到迁移分支。

### 4.3 视图路由

`App.tsx` 的 `activeView` 由 `historyOpen ? 'history' : diff ? 'diff' : 'edit'` 得出。
`changeView('edit')` 时清 diff、关 history，不再改 `collapsedPane`（折叠由分屏自己的控件管）。

Diff / 历史仍全宽独占，分屏只作用于 `'edit'`。

## 5. 分屏布局

### 5.1 新模块 `src/core/split-layout.ts`

沿用 `structure-width.ts` 的纯计算模块模式（钳制/步进/拖拽换算三条路径共用一套规则）。
`structure-width.ts` 随 Schema 删除，其模式在此复用，`structureWidth` 旧值不迁移（px 与比例语义不同）。

```
SPLIT_MIN_RATIO = 0.2 / SPLIT_MAX_RATIO = 0.8 / SPLIT_DEFAULT_RATIO = 0.5
SPLIT_RATIO_STEP = 0.05                      // 键盘步进
clampSplitRatio(value): number               // 非有限数退回默认值，防 NaN 进 CSS 变量
stepSplitRatio(current, direction): number
ratioFromDrag(startRatio, deltaPx, totalPx): number
```

### 5.2 设置项

`AppSettings` 删 `structureWidth`，加：

```
splitOrientation: 'row' | 'column'   // row = 左右，column = 上下
splitRatio: number                   // 第一侧占比，clampSplitRatio 收敛
allowRemoteImagePreview: boolean      // 默认 false，见 §8
```

全局（非 per-document）。`sanitizeSettings` 要为三个新字段加校验，并忽略残留的 `structureWidth`。

### 5.3 交互

- 分隔条可拖拽调比例，键盘 ←→/↑↓ 按 `SPLIT_RATIO_STEP` 步进（参考 `StructureResizer` 的实现模式）。
- 拖拽期间走 App 本地 state，松手才 `updateSettings` —— 每帧写 store 会连带触发持久化（`App.tsx:164-171` 已有此先例）。
- 方向切换按钮放 ActionBar 原 Schema 按钮位置。
- 每侧标题栏各有一个折叠按钮；折叠后该侧收成一条窄栏，点击展开。两侧不可同时折叠。
- 两侧标题用「文本」「树」，与 `CONTEXT.md` 术语一致。

### 5.4 窄屏

- `< 700px`：强制 `column`（不写回设置，只在渲染时覆盖）。
- `< 480px`：只显示文本侧，树侧不渲染（同样不写回设置）。

## 6. 树行渲染重做（照图 2）

### 6.1 目标形态

现状一行是「[路径按钮] [值摘要]」，`summary()` 把对象渲染成 `Object(3)`。
目标是代码化形态：

```
▾ {
    "date": "20180322",
    "status": 200,
  ▾ "data": {
      "shidu": "34%"
    },
  }
```

要点：`"键": 值` 同行；容器行只显示 `{` / `[`，**子项结束后另起一行显示 `}` / `]`**；
非末项尾随逗号；折叠态显示 `{…}` + 灰色计数。

### 6.2 `FlatRow` 增加 close 行

`FlatRowKind` 从 `'value' | 'open'` 扩为 `'value' | 'open' | 'close'`。
`appendVisibleRows` 在展开容器的子项全部入栈后，追加一条 `kind: 'close'` 行。
栈式遍历要为此引入哨兵条目（当前 `StackEntry` 只有 `'node'` 一种）。

新增字段 `isLast: boolean`（是否父容器末项），供渲染决定尾随逗号。

连带影响：`countVisibleRows` 数值变大（close 行计入），`EXPAND_ALL_CONFIRM_ROWS = 50_000`
的语义随之变化 —— 阈值不改，但确认文案的行数是含 close 行的行数。
`tree-flatten.test.ts` 现有断言需相应更新。

### 6.3 行内操作

hover / focus 时在行右侧浮出「复制 | 复制路径 | 下载 | 删除」。
用文字按钮 + `|` 分隔（图 2 形态），不引图标，规避 §12 的字体子集门槛。

- 复制：现有 `copyValue` 逻辑（字符串取原值，其余 `minifyJsonNode`）。
- 复制路径：现有 `onCopy(row.path, '路径')`；`ambiguous`（重复键）时禁用，保留现状。
- 下载：把该节点子树格式化后另存为文件，复用 `platform.ts` 的 `saveJsonFileAs`。
- 删除：见 §7。

close 行不挂操作、不参与 highlight、不可 focus。

### 6.4 必须保住的东西

- 虚拟化（`useVirtualWindow`）、`ROW_HEIGHT` 定高假设、`scrollToPath` / `scrollToIndex`。
- `EXPAND_ALL_CONFIRM_ROWS` 确认闸门。
- 重复键警告条与 `ambiguous` 禁用逻辑。
- 键盘导航（↑↓ 移动、←→ 折叠展开、Shift+←→ 整棵子树）。
- `.tree-value--{type}` 类名与 `.tree-path` 的 `var(--accent)` 键名色 —— `theme-parity.test.ts` 强校验，见 §12。

## 7. 节点隐藏（「删除」的真实语义）

只影响树的显示，不改文本、不改 `document.content`。

- App 层持 `hiddenPaths: ReadonlySet<string>`，**不进持久化**（localStorage 与原生快照都不写）。
- `activeDocument.content` 一变就清空 —— 格式化 / 压缩 / 修复 / 手改文本后节点自动回来，
  与用户确认的「点击格式化之后又会出来」一致。切文档时同样清空（与 `expandState` 同节奏）。
- 隐藏容器 = 连子树一起隐藏。`flattenTree` 跳过命中前缀的子树，`countVisibleRows` 同步。
- 树侧标题栏在 `hiddenPaths.size > 0` 时显示「恢复隐藏 (N)」按钮，一键清空。免得误删只能靠格式化找回。
- 表格视图不受 `hiddenPaths` 影响：隐藏是浏览降噪，表格是数据提取。

`hiddenPaths` 作为 `TreeView` 的 props 传入（与 `expandState` 同模式），不下沉到 `core`；
但 `flattenTree` / `countVisibleRows` 需新增可选参数接收它。

## 8. 外链与图片预览

### 8.1 点击打开外链（用户已同意加 Tauri 权限）

字符串值形如 `http://…` / `https://…` 时，值文本加下划线并可点击。

- `src-tauri/capabilities/default.json` 补 `"opener:allow-open-url"`。
  当前只有 `opener:allow-reveal-item-in-dir`，不补则桌面端调用直接被拒。
- `platform.ts` 新增 `openExternalUrl(url)`：Tauri 走 `@tauri-apps/plugin-opener` 的 `openUrl`，
  浏览器走 `window.open(url, '_blank', 'noopener,noreferrer')`。
- **协议白名单在前端做**：只放行 `http:` / `https:`，其余（`javascript:`、`file:`、`data:`、`vbscript:`）
  一律拒绝并 toast 说明。用 `new URL()` 解析，解析失败即视为非链接、不渲染成可点。
- 打开前 toast 提示目标 host（`已在浏览器打开 example.com`），用户能看见自己点开了什么。

### 8.2 hover 预览图片（方案 a：放宽 CSP + 默认关的开关）

用户已同意方案 a。

- `src-tauri/tauri.conf.json` 的 `csp` 与 `devCsp` 中 `img-src` 追加 `https:`。
  **不加 `http:`** —— 明文图片既不安全，webview 运行在 `tauri://` / `http://localhost`
  下混合内容也可能被拦，加了也不一定生效，不如不给假承诺。
- `AppSettings` 新增 `allowRemoteImagePreview: boolean`，**默认 `false`**。
  设置面板加开关，文案说明「悬停时会向该图片所在服务器发起请求，暴露本机 IP」。
- 开关关闭时：hover 只显示**完整值文本**的 tooltip（长 URL 在树里被截断，显示全值本身有用）。
- 开关开启时：hover 400ms 后才发请求（防手划过就打一串请求），用 `<img>` 直接加载，
  `onError` 退回纯文本 tooltip。失败过的 URL 记入会话内 `Set` 不再重试。
- **CSP 是构建期静态配置，运行时改不了。** 所以 `img-src https:` 一旦放开就是永久放开，
  开关只能控制前端要不要真发请求。这一点必须在 DESIGN 里留痕，避免后人误以为开关能收回 CSP。
- 浏览器模式（dev / GitHub Pages）无 CSP 约束，行为与桌面端不同 —— 已知差异，不修。

## 9. 表格视图

### 9.1 `core/json-table.ts`（新建）

纯函数，不依赖 React。输入 `JsonNode`，输出表格模型。

三种形态（`shape`）：

| 输入 | shape | 列 |
|---|---|---|
| 对象 | `'object'` | 字段 / 值（图 3） |
| 数组，元素全是对象 | `'records'` | 所有元素键的**并集**，按首次出现顺序 |
| 数组，元素含标量 | `'scalars'` | 索引 / 值 |
| 标量 | —— | 返回 `null`，按钮禁用 + tooltip 说明 |

`'records'` 下缺失字段**留空**，不填 `—`（空更干净，也不与真实值 `"—"` 混淆）。

单元格值：容器压缩成一行 JSON 并截断到 `CELL_TEXT_LIMIT = 200` 字符，
但保留完整文本供复制。**不做图 3 那种整段展开** —— 真实数据会把行高顶爆。

行数上限 `TABLE_ROW_LIMIT = 5_000`，超出截断并在浮窗内标注「已截断，共 N 行」。
表格是一次性全量渲染，不做虚拟化；靠这个上限兜住。

### 9.2 下钻与面包屑

单元格值是容器时可点击下钻，进入该子节点的表格。
浮窗内维护 `pathStack: string[]`，顶部面包屑可逐级回退，
与图 3 顶部的「来源: $」是同一处 UI。

### 9.3 `TableView` 浮窗

照图 3：居中弹窗 + 遮罩 + Esc 关闭。
沿用 `ConfirmDialog` 的模态惯例（`role="dialog"`、`aria-modal`、焦点进入与归还、Tab 环内循环、
遮罩 mousedown 关闭），不要新造一套。

操作：复制单元格（点击值区域外的复制按钮）、复制整表为 TSV（可直接粘进 Excel）。
本次**不做 CSV 下载**。

## 10. 选中节点与状态栏

树视图此前没有「选中节点」概念，只有 `highlightPaths`（搜索命中）和 DOM 焦点。
表格视图需要一个数据源，图 2 底部也有「当前节点: $.city  string / city 北京」。
两个需求指向同一个新状态。

- App 层新增 `selectedPath: string | null`，点击树行的键名即选中（原本点键名是复制路径，
  复制路径移进 hover 操作组，不冲突）。
- `activeDocument.id` 变化时清空。
- `InfoRow` 新增可选字段展示当前节点：路径、类型、值预览（截断）。
- 表格数据源 = `selectedPath ?? '$'`。未选中就对根节点建表，与图 3 的「来源: $」一致。

## 11. 搜索

用户确认图 2 的「提取」就是现有搜索（按路径查询节点），不新增功能。

分屏后需要调整的是命中跳转：`selectQueryHit` 现在按 `activeDocument.view` 二选一
（树就展开滚动，文本就 reveal offset）。分屏下两侧同时可见，改为**两侧都做**：
展开并滚动树侧 + reveal 文本侧 offset。被折叠的一侧跳过。

SearchPanel 仍是右侧浮层，本次不动。

## 12. 硬约束（实现时必须满足，否则测试红）

### 12.1 图标字体 —— 本次的最大门槛

`src/components/icon-subset.test.ts` 断言字体子集的 cmap **严格等于** `ICON_CODEPOINTS`：

```
expect(cmap.size).toBe(Object.keys(ICON_CODEPOINTS).length);
```

即：往 `ICON_CODEPOINTS` 加任何一项，不重新生成 `src/assets/fonts/MaterialSymbolsOutlined-subset.woff2`
就会失败。而重新生成（`npm run icons:subset`）需要两个本机不存在的前置：

- 完整 Material Symbols 源字体（`MATERIAL_SYMBOLS_FONT` 环境变量或 `public/fonts/…-full.woff2`，
  完整源字体不入库）；
- `pyftsubset`（`pip install fonttools`）。

已核实：本机两者都没有。

**所以 D10 定为：本次不动 `ICON_CODEPOINTS`，一项都不加。** 缺图标的位置改用纯文字按钮：

| UI 位置 | 做法 |
|---|---|
| ActionBar「表格」 | 纯文字 `表格`，无图标 |
| ActionBar 分屏方向 | 纯文字 `左右` / `上下`，按当前方向显示目标方向 |
| 每侧标题栏折叠柄 | 复用 `chevron_left` / `expand_more`（已在映射内） |
| 行内「复制/复制路径/下载/删除」 | 纯文字按钮组 + `\|` 分隔（图 2 本身就是文字形态） |
| 树侧「恢复隐藏 (N)」 | 纯文字，无图标 |

ActionBar 现有按钮是「图标 + 文字」，新增的两个是纯文字，存在视觉不一致 —— 这是明确接受的取舍，
换来零字体门槛。**实现时不得为了统一观感而擅自往 `ICON_CODEPOINTS` 加项**，
加了 `icon-subset.test.ts` 必红且本机无法修复。

顺带记录：删 Schema 后 `account_tree` 变为空闲（Sidebar 的树 tab 一并去掉）。
`construction`、`content_paste`、`api`、`sensors`、`chevron_left` 本来就没有任何引用。
**空闲不等于要删** —— 从 `ICON_CODEPOINTS` 删项同样会让子集失配、测试变红，本次一律不动。

### 12.2 配色一致性

`src/theme-parity.test.ts` 要求：

- `.tree-value--{string,number,boolean,null}` 的取色与 `JsonEditor` 的 `lightHighlight` /
  `darkHighlight` **逐项相同**；
- 每个类型的暗色规则在 `styles.css` 里**只能出现一次**（历史上出现过两组互相矛盾的规则，
  靠书写顺序侥幸生效）；
- 树视图键名颜色 = 编辑器 `propertyName` 颜色 = 对应主题的 `--accent`。

重做行渲染时 `.tree-value--{type}` 与 `.tree-path` 两个类名**必须保留**，选择器结构不能变。
这是本次改动最容易踩的回归点：键值同行后很容易顺手把类名合并或改名。

### 12.3 其他

- `src/app-guards.test.ts` 依赖 `transformBlockedReason(diff, historyOpen, processing)` 的
  三参签名与三种互不相同的文案。分屏不改这个函数。
- `src/components/components.test.tsx` 中两个 StructurePanel 测试随组件一并删除。
  TreeView 的现有测试要按新行结构（含 `close` 行）调整。
- `src/core/tree-flatten.test.ts` 需补 `close` 行与 `hiddenPaths` 的用例。

### 12.4 文档路径易踩的两个坑

- 项目约定在 **`.claude/CLAUDE.md`**（已入库，提交 `e15b2b6`），不在仓库根。
  `rg` 默认跳过隐藏目录，`rg --files -g 'CLAUDE.md'` 搜不到它，需 `--hidden` 或直接给路径。
- 仓库根另有一套**首版遗留**的 `DESIGN.md` / `TASKS.md` / `KNOWN_ISSUES.md`（写于 2026-08-07 前后，
  内容是整个产品的初版规划）。本次需求的三份文档在 `docs/2026-08-11-split-view-table/` 下。
  两套同名，读写时必须带完整路径 —— 尤其 `KNOWN_ISSUES.md`，本次要写的是需求目录里那份。

## 13. 风险与待决

| 项 | 状态 |
|---|---|
| 图标缺口（表格 / 上下分屏） | **已决**：D10 纯文字按钮，`ICON_CODEPOINTS` 不动 |
| `close` 行改动波及虚拟化与全部行号计算 | 已知，靠 `tree-flatten` 单测兜 |
| 表格不做虚拟化 | 靠 5000 行上限兜住 |
| CSP 放开 `img-src https:` 不可运行时收回 | 已记录，开关默认关 |
| 旧快照迁移 | `sanitizeDocuments` 改成迁移而非丢弃，必须有单测 |
| ActionBar 图标+文字 与 纯文字 混排 | 明确接受，见 §12.1 |

无待决项，可以进入实现。




