# API_SPEC —— 新增模块接口契约

日期:2026-08-09。以下签名为**契约**,实现不得擅自改名或改形状;确有问题记入 `KNOWN_ISSUES.md`。

## 1. `src/core/tree-flatten.ts`

```ts
import type { JsonNode } from './json-parser';

export type FlatRowKind = 'value' | 'open' | 'close';

export interface FlatRow {
  /** JSONPath,如 $.data[3].email。根为 $ */
  path: string;
  /** 显示标签:对象键名,或数组下标形如 [3];根为 $ */
  label: string;
  node: JsonNode;
  depth: number;
  /** open/close 用于容器的起止行;value 为叶子或折叠态容器单行 */
  kind: FlatRowKind;
  hasChildren: boolean;
  /** 该键在同层重复出现,路径不唯一 */
  ambiguous: boolean;
}

export type ExpandBaseline = 'default' | 'all' | 'none';

export interface ExpandState {
  baseline: ExpandBaseline;
  /** 只存与 baseline 判定结果相反的路径 */
  overrides: ReadonlySet<string>;
  /** 子树批量操作:路径前缀 → 目标态。后写入的优先 */
  subtrees: ReadonlyArray<{ prefix: string; expanded: boolean }>;
}

export const DEFAULT_EXPAND_DEPTH = 2;

export function createExpandState(): ExpandState;

/** 判定某路径当前是否展开。优先级:overrides > subtrees(取最后匹配) > baseline */
export function isExpanded(state: ExpandState, path: string, depth: number): boolean;

export function toggleExpand(state: ExpandState, path: string, depth: number): ExpandState;
export function expandAll(state: ExpandState): ExpandState;
export function collapseAll(state: ExpandState): ExpandState;
export function expandSubtree(state: ExpandState, path: string): ExpandState;
export function collapseSubtree(state: ExpandState, path: string): ExpandState;

/** 确保 path 的所有祖先展开(搜索命中后定位用) */
export function revealPath(state: ExpandState, path: string): ExpandState;

/** 只产出可见行。折叠容器占一行(kind='value'),展开容器产出 open + 子行 + close */
export function flattenTree(root: JsonNode, state: ExpandState): FlatRow[];

/** 不构造数组,只数可见行数。用于展开前的阈值确认 */
export function countVisibleRows(root: JsonNode, state: ExpandState): number;
```

约束:

- `flattenTree` 必须**迭代实现**(显式栈),不得递归 —— 深层嵌套会爆调用栈。
- 重复键必须各自成行,`ambiguous: true`;路径沿用 `propertyPath`(重复键路径不唯一,由 UI 禁用复制)。
- `countVisibleRows` 不得先调 `flattenTree` 再取 `length`(那样就白省了内存)。

## 2. `src/core/json-query.ts`

```ts
import type { JsonNode } from './json-parser';

export type QueryMode = 'jsonpath' | 'substring';

export interface QueryHit {
  path: string;
  /** 命中原因:键名匹配 / 值匹配 / JSONPath 选中 */
  reason: 'key' | 'value' | 'path';
  /** 该节点在源文本中的偏移,用于文本视图跳转 */
  offset: number;
}

export interface QueryResult {
  mode: QueryMode;
  hits: QueryHit[];
  /** 语法错误或不支持的语法。非空时 hits 为空数组 */
  error: string | null;
  truncated: boolean;
}

export const QUERY_HIT_LIMIT = 5_000;

/** 以 $ 开头判定为 jsonpath,否则 substring */
export function detectQueryMode(input: string): QueryMode;

export function runQuery(root: JsonNode, input: string): QueryResult;
```

约束:

- 支持:`$`、`.key`、`["key"]`、`[3]`、`[*]`、`.*`、`..key`。
- **不支持的语法必须回明确 error 文案**(例如「暂不支持过滤表达式 ?()」),不得静默返回空 hits。
- 子串模式大小写不敏感,同时匹配键名与原始值文本。
- 命中数超 `QUERY_HIT_LIMIT` 时截断并置 `truncated: true`。

## 3. `src/core/json-diff.ts`

```ts
import type { JsonNode } from './json-parser';

export type DiffKind = 'added' | 'removed' | 'changed' | 'same';

export interface JsonDiffEntry {
  path: string;
  kind: DiffKind;
  /** 左右两侧的紧凑值文本;不存在的一侧为 null */
  left: string | null;
  right: string | null;
  depth: number;
}

export interface JsonDiffResult {
  entries: JsonDiffEntry[];
  summary: { added: number; removed: number; changed: number; same: number };
}

export function diffJsonNodes(left: JsonNode, right: JsonNode): JsonDiffResult;
```

约束:

- 按路径对齐,**结果不受键顺序与缩进影响**(同一数据 minify vs format 必须全 `same`)。
- 数组按下标对齐,不做 LCS。
- 对象键并集,顺序取左侧顺序、左侧缺失的键追加在后。
- 容器节点自身也产出 entry(便于折叠展示),`left`/`right` 填摘要如 `Object(5)`。

## 4. Worker 协议扩展(`src/types.ts`)

```ts
export type WorkerOperation =
  | 'validate' | 'format' | 'minify' | 'sort'
  | 'repair' | 'escape' | 'unescape' | 'stats'
  | 'query'   // options: { input: string }        → data: QueryResult
  | 'diff';   // options: { other: string, mode }  → data: JsonDiffResult | DiffRow[]

export type WorkerResponse =
  | { requestId: string; ok: true; result: string; meta: ProcessingMeta; data?: unknown }
  | { requestId: string; ok: false; error: JsonDiagnostic };
```

约束:

- `data` 为**新增可选字段**。现有 8 个操作不填,`result` 语义不变。
- `query` / `diff` 的 `result` 填人类可读摘要(如「命中 12 处」「+3 ~1 -0」)以满足必填约束。
- **不得**把 `result` 改成可选或联合类型 —— 会波及 `processor.test.ts`、`worker-client.test.ts`。

## 5. 组件接口变更

```ts
// TreeView:接收已解析节点(不再自己 parse),展开状态由外部持有
interface TreeViewProps {
  root: JsonNode | null;
  parseError: string | null;
  hasDuplicates: boolean;
  expandState: ExpandState;
  onExpandChange: (next: ExpandState) => void;
  highlightPaths: ReadonlySet<string>;
  onCopy: (value: string, label: string) => void;
  onRevealInText?: (offset: number) => void;
}

// StructurePanel:同样改为接收已解析节点,消除重复解析
interface StructurePanelProps {
  root: JsonNode | null;
  parseError: string | null;
  onSelectPath?: (path: string) => void;
}

// Sidebar:删除 documents / activeDocumentId / documentCount / processingLabel / persistenceIssue
//          新增折叠与搜索
interface SidebarProps {
  activeTab: SidebarTab;         // 'explorer' | 'search' | 'schema'
  onChangeTab: (tab: SidebarTab) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  recentFiles: RecentFile[];
  onOpenRecent: (path: string) => void;
  onNewDocument: () => void;
  onOpenDocs: () => void;
  search: {
    input: string;
    onChangeInput: (value: string) => void;
    result: QueryResult | null;
    onSelectHit: (hit: QueryHit) => void;
  };
}

// AppHeader:合并两行。删除 title / dirty(文档 tab 与状态栏已有)
interface AppHeaderProps {
  activeView: WorkspaceView;
  onChangeView: (view: WorkspaceView) => void;
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
```

## 6. 设置项新增(`AppSettings`)

```ts
sidebarCollapsed: boolean;   // 默认 false
diffMode: 'structural' | 'line';  // 默认 'structural'
```

随现有 workspace 持久化机制存储,不新建存储通道。
