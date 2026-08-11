# API_SPEC — 分屏视图 + 表格提取

本文件定义本次改动的**接口契约**。Codex 按此实现，签名不得擅自变更；
如认为签名有问题，记入 `KNOWN_ISSUES.md` 待 Claude 决策。

---

## 1. `src/types.ts`

```ts
/** 分屏中被折叠的那一侧；'none' 表示两侧都显示 */
export type CollapsedPane = 'none' | 'text' | 'tree';

/** 分屏方向：row = 左右，column = 上下 */
export type SplitOrientation = 'row' | 'column';

export interface JsonDocument {
  id: DocumentId;
  title: string;
  filePath: string | null;
  content: string;
  savedContent: string;
  collapsedPane: CollapsedPane;   // ← 取代原 view: DocumentView
  language: 'json';
  createdAt: number;
  updatedAt: number;
}

export interface AppSettings {
  theme: 'system' | 'light' | 'dark';
  indent: 2 | 4 | 'tab';
  sortKeys: boolean;
  restoreSession: boolean;
  sidebarCollapsed: boolean;
  diffMode: 'structural' | 'line';
  splitOrientation: SplitOrientation;   // 新增，默认 'row'
  splitRatio: number;                   // 新增，默认 0.5，取值 0.2–0.8
  allowRemoteImagePreview: boolean;     // 新增，默认 false
  // structureWidth 删除
}
```

`DocumentView` 类型删除。`WorkspaceView`（在 `AppHeader.tsx`）改为：

```ts
export type WorkspaceView = 'edit' | 'diff' | 'history';
```

---

## 2. `src/core/split-layout.ts`（新建）

沿用 `structure-width.ts` 的纯计算 + 钳制模式。**该文件建好后删除 `structure-width.ts` 及其测试。**

```ts
export const SPLIT_RATIO_MIN = 0.2;
export const SPLIT_RATIO_MAX = 0.8;
export const SPLIT_RATIO_DEFAULT = 0.5;
/** 键盘左右/上下键的调整步进 */
export const SPLIT_RATIO_STEP = 0.05;

/**
 * 把任意输入收敛到合法比例。
 * 非有限数（NaN / Infinity / 反序列化出来的字符串）一律退回默认值，
 * 避免 NaN 流进 CSS 变量把分屏比例变成 auto。
 */
export function clampSplitRatio(value: number): number;

/** 键盘调整：direction 为 1 表示放大文本侧。 */
export function stepSplitRatio(current: number, direction: -1 | 1): number;

/**
 * 拖拽换算。
 * @param position 指针在容器内的坐标（row 用 clientX - rect.left，column 用 clientY - rect.top）
 * @param total    容器在该轴上的尺寸（row 用 rect.width，column 用 rect.height）
 */
export function ratioFromDrag(position: number, total: number): number;
```

`ratioFromDrag` 在 `total <= 0` 时返回 `SPLIT_RATIO_DEFAULT`（防除零）。

必须有单测覆盖：NaN / Infinity / 字符串 / 越界值 / total 为 0 / 步进撞边界不越界。

---

## 3. `src/core/json-table.ts`（新建）

纯函数，不依赖 React。表格的全部形态判定和取值都在这里，组件只负责渲染。

```ts
import type { JsonNode } from './json-parser';

export type TableShape = 'object' | 'records' | 'scalars';

export interface TableCell {
  /** 渲染用文本，已按 TABLE_CELL_MAX_CHARS 截断 */
  text: string;
  /** 复制用的完整文本（字符串取原值，其余取 minifyJsonNode） */
  full: string;
  /** 该单元格对应节点的 JSONPath；缺失字段为 null */
  path: string | null;
  /** 值类型，用于套用 .tree-value--{type} 配色；缺失字段为 null */
  type: JsonNode['type'] | null;
  /** 值是对象/数组时为 true，渲染成可点击下钻 */
  drillable: boolean;
  /** 因超长被截断 */
  truncated: boolean;
}

export interface TableModel {
  shape: TableShape;
  /** 数据源路径，用于面包屑 */
  sourcePath: string;
  /** 列名。object → ['字段','值']；records → ['#', ...键并集]；scalars → ['#','值'] */
  columns: string[];
  rows: TableCell[][];
  /** 行数（= rows.length），records 形态下等于数组元素数 */
  rowCount: number;
  /** 字段数：object 取 entries 数，records 取键并集大小，scalars 取元素数 */
  fieldCount: number;
  /** 因 TABLE_ROW_LIMIT 截断 */
  truncated: boolean;
}

export const TABLE_ROW_LIMIT = 5_000;
export const TABLE_CELL_MAX_CHARS = 200;

/**
 * 把节点转成表格模型。标量节点返回 null（调用方据此禁用入口）。
 * - object              → shape 'object'
 * - 全部元素为对象的数组 → shape 'records'
 * - 其他数组            → shape 'scalars'（含混合类型数组，元素整体压缩成一格）
 *
 * records 形态下列取所有元素键的并集，顺序 = 首次出现顺序；缺失字段的 cell
 * 为 { text: '', full: '', path: null, type: null, drillable: false, truncated: false }。
 * 重复键：同一对象内重复键取最后一个，与 JSON.parse 语义一致；path 标记为 null
 * （路径不唯一，禁用下钻和复制路径）。
 */
export function buildTableModel(node: JsonNode, sourcePath: string): TableModel | null;

/** 整表转 TSV。制表符和换行符在单元格内替换成空格，避免破坏列结构。用 full 而非 text。 */
export function tableToTsv(model: TableModel): string;

/** 按路径取子节点，用于下钻。路径非法或不存在时返回 null。 */
export function nodeAtPath(root: JsonNode, path: string): JsonNode | null;
```

`nodeAtPath` 必须能解析 `propertyPath` 生成的全部形态：`$`、`$.key`、`$["含 空格"]`、`$[0]`、以及嵌套组合。这是 `json-path.ts` 目前只有正向生成、没有反向解析的补齐，实现放 `json-path.ts` 或 `json-table.ts` 均可，导出位置以本 SPEC 为准。

必须有单测覆盖：三种形态、键并集顺序、缺失字段、重复键、行数截断、单元格截断、TSV 制表符转义、`nodeAtPath` 各种路径形态 + 非法路径。

---

## 4. `src/core/tree-flatten.ts`（改造）

### 4.1 `FlatRow` 扩展

```ts
export type FlatRowKind = 'value' | 'open' | 'close';   // 新增 'close'

export interface FlatRow {
  path: string;
  label: string;
  node: JsonNode;
  depth: number;
  kind: FlatRowKind;
  hasChildren: boolean;
  ambiguous: boolean;
  /** 新增：该行在父容器中是否为最后一项，决定要不要渲染尾随逗号 */
  isLast: boolean;
  /** 新增：父容器类型，close 行据此渲染 } 或 ]。根行为 null */
  parentType: 'object' | 'array' | null;
}
```

`kind` 语义：

| kind | 何时产生 | 渲染成 |
|---|---|---|
| `value` | 标量节点，或折叠状态的容器 | `"key": 值` / `"key": {…} 3` |
| `open` | 展开状态的容器 | `"key": {` |
| `close` | 每个 `open` 行对应一个 | `}` 或 `]`，`isLast` 为 false 时加 `,` |

`close` 行的 `path` 与其 `open` 行相同（用于折叠时定位），`ambiguous` 恒为 false，`label` 为空串。虚拟化按 index 定位，路径重复不影响 —— 但 `TreeViewHandle.scrollToPath` 必须取 **第一个** 匹配（`findIndex`，现有实现即是），不能取到 close 行。

### 4.2 隐藏节点

```ts
/** flattenTree / countVisibleRows 新增可选参数 */
export function flattenTree(
  root: JsonNode,
  state: ExpandState,
  hiddenPaths?: ReadonlySet<string>,
): FlatRow[];

export function countVisibleRows(
  root: JsonNode,
  state: ExpandState,
  hiddenPaths?: ReadonlySet<string>,
): number;
```

命中 `hiddenPaths` 的节点：自身与整个子树都不产出任何行（含 close 行）。被隐藏节点若是父容器的最后一项，其前一个兄弟的 `isLast` 必须相应变成 true —— 否则会渲染出多余的尾随逗号。这条要有单测。

参数缺省时行为与现状完全一致，便于分步迁移。

### 4.3 现有导出不变

`createExpandState` / `isExpanded` / `toggleExpand` / `expandAll` / `collapseAll` / `expandSubtree` / `collapseSubtree` / `revealPath` / `isSubtreeFullyExpanded` / `containsDuplicateKeys` 签名与语义均不动。

`tree-flatten.test.ts` 现有断言会因 close 行改变行数而失败，需同步更新，但**不得放宽**原有对展开语义的断言。

---

## 5. `src/services/platform.ts`（新增两个导出）

```ts
/**
 * 用系统默认浏览器打开外链。
 * 协议白名单：仅 http: / https:，其余一律抛错，不打开。
 * Tauri 走 @tauri-apps/plugin-opener 的 openUrl；浏览器走
 * window.open(url, '_blank', 'noopener,noreferrer')。
 */
export async function openExternalUrl(url: string): Promise<void>;

/** 判断字符串是否是可打开的外链（协议白名单 + URL 可解析） */
export function isExternalUrl(value: string): boolean;
```

`isExternalUrl` 是纯函数，必须单测覆盖这些拒绝用例：

- `javascript:alert(1)` → false
- `file:///etc/passwd` → false
- `data:text/html,<script>` → false
- `vbscript:`、`about:`、`blob:` → false
- 大小写与前后空白变体：`  JavaScript:alert(1)  ` → false
- 协议相对 `//evil.com` → false（无法确定协议）
- `http://a.com` / `https://a.com/x?y=1#z` → true

实现用 `new URL()` 解析后判 `protocol`，不要用字符串前缀匹配 —— 前缀匹配挡不住 `java\nscript:` 这类变体。

同时需要在 `src-tauri/capabilities/default.json` 的 `permissions` 数组追加 `"opener:allow-open-url"`。

---

## 6. 组件接口

### 6.1 `src/components/SplitWorkspace.tsx`（新增）

```ts
export interface SplitWorkspaceProps {
  orientation: SplitOrientation;
  ratio: number;
  onRatioChange: (ratio: number) => void;      // 拖拽中，每帧调用（本地 state）
  onRatioCommit: (ratio: number) => void;      // 松手时调用一次（写 store）
  collapsedPane: CollapsedPane;
  onCollapsedPaneChange: (pane: CollapsedPane) => void;
  textPane: ReactNode;
  treePane: ReactNode;
}
```

分隔条要求：`role="separator"`、`aria-orientation`、`tabIndex={0}`、`aria-valuenow`（比例的百分比整数）。键盘 ←/→（row）或 ↑/↓（column）按 `stepSplitRatio` 调整；Home/End 跳到 0.2 / 0.8；双击复位到 0.5。指针交互用 pointer events + `setPointerCapture`，不要用 mousemove（触屏和笔失效）。

某一侧折叠时分隔条不渲染，折叠侧只留一条可点的窄条用于展开。

### 6.2 `src/components/TreeView.tsx`（改造 props）

```ts
export interface TreeViewProps {
  root: JsonNode | null;
  parseError: string | null;
  hasDuplicates: boolean;
  expandState: ExpandState;
  onExpandChange: (next: ExpandState) => void;
  highlightPaths: ReadonlySet<string>;
  onCopy: (value: string, label: string) => void;
  onRevealInText?: (offset: number) => void;

  // 新增
  hiddenPaths: ReadonlySet<string>;
  onHide: (path: string) => void;
  onRestoreHidden: () => void;
  selectedPath: string | null;
  onSelectPath: (path: string) => void;
  onDownloadNode: (path: string, node: JsonNode) => void;
  allowRemoteImages: boolean;
}
```

`TreeViewHandle` 不变（`scrollToPath` / `scrollToIndex`）。

`EXPAND_ALL_CONFIRM_ROWS = 50_000` 保留，`countVisibleRows` 调用要带上 `hiddenPaths`。

### 6.3 `src/components/TableView.tsx`（新增）

```ts
export interface TableViewProps {
  open: boolean;
  root: JsonNode | null;
  /** 初始来源路径，来自树的 selectedPath，未选中时为 '$' */
  sourcePath: string;
  onClose: () => void;
  onCopy: (value: string, label: string) => void;
}
```

内部自持下钻栈 `string[]`（初始 `[sourcePath]`），面包屑点击回退到任意层。`open` 由 false → true 时重置栈。

弹窗契约照 `ConfirmDialog` 现有做法：`.dialog-backdrop` 遮罩 + `role="dialog"` + `aria-modal="true"` + `aria-labelledby`，Esc 关闭，backdrop mousedown 关闭，内容区 `stopPropagation`，打开时记住 `document.activeElement` 并在关闭时还原，Tab 在弹窗内循环。

不可表格化时（`buildTableModel` 返回 null）渲染说明文案而非空白，并给出「回到上一层」入口 —— 否则下钻到标量后会卡死在空弹窗里。

### 6.4 `src/components/ActionBar.tsx`（改 props）

```ts
// 删除
activePanel: 'search' | 'schema' | null;
onTogglePanel: (panel: 'search' | 'schema') => void;

// 新增
activePanel: 'search' | null;
onTogglePanel: (panel: 'search') => void;
splitOrientation: SplitOrientation;
onToggleSplitOrientation: () => void;
onOpenTable: () => void;
tableDisabledReason: string | null;   // null 表示可用
```

`tableDisabledReason` 非 null 时按钮 `aria-disabled` + tooltip 显示原因。产生原因的情形：JSON 解析失败、当前选中节点是标量。

### 6.5 `src/components/Sidebar.tsx`

`viewTabs` 改为三项：

```ts
[
  { id: 'edit',    label: '编辑', icon: 'code' },
  { id: 'diff',    label: 'Diff', icon: 'compare' },
  { id: 'history', label: '历史', icon: 'history' },
]
```

`account_tree` 从这里移除，改到 3.2 待定的图标方案里处理。

### 6.6 `src/components/InfoRow.tsx`（新增一个可选字段）

```ts
interface InfoRowProps {
  // ...现有字段不变
  /** 当前选中的树节点，未选中时不渲染该段 */
  selectedNode: { path: string; type: JsonNode['type']; label: string; preview: string } | null;
}
```

渲染在 `info-path` 之后：`当前节点: $.city  string / city "北京"`，`preview` 由调用方截断到 40 字符以内。

---

## 7. 需要删除的导出

| 位置 | 导出 |
|---|---|
| `src/components/StructurePanel.tsx` | 整文件 |
| `src/components/StructureResizer.tsx` | 整文件 |
| `src/core/structure-width.ts` | 整文件（逻辑迁到 `split-layout.ts`） |
| `src/core/structure-width.test.ts` | 整文件（用例迁到 `split-layout.test.ts`） |
| `src/types.ts` | `AppSettings.structureWidth` |
| `src/stores/workspace.ts` | `DEFAULT_SETTINGS.structureWidth`、`sanitizeSettings` 里对应分支 |
| `src/components/components.test.tsx` | `describe('StructurePanel')` 整块（两个用例） |
| `src/styles.css` | `.structure-*`、`.schema-panel`、`.workspace-float-panel .structure-panel` 相关规则 |

