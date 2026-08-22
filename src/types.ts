export type DocumentId = string;

/** 分屏中被折叠的那一侧；'none' 表示两侧都显示。 */
export type CollapsedPane = 'none' | 'text' | 'tree';

/** 分屏方向：row = 左右，column = 上下。 */
export type SplitOrientation = 'row' | 'column';

export interface JsonDocument {
  id: DocumentId;
  title: string;
  filePath: string | null;
  content: string;
  savedContent: string;
  collapsedPane: CollapsedPane;
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
  splitOrientation: SplitOrientation;
  splitRatio: number;
  allowRemoteImagePreview: boolean;
  /**
   * 输入法兼容模式：编辑器只用颜色区分语法，不用字重和斜体。
   *
   * 第三方输入法（实测豆包）会在每次编辑后调 macOS 的
   * AttributedSubstringForCharacterRangeAsync 索要光标附近的富文本属性，
   * WebKit 为此逐属性段转换字体，字重和斜体各是独立 NSFont，把转换次数翻倍。
   * 实测开启后主线程忙碌占比从 53~56% 降到 32%。默认关闭以保留完整配色。
   */
  imeCompatMode: boolean;
}

export interface RecentFile {
  path: string;
  name: string;
  openedAt: number;
}

export interface WorkspaceState {
  documents: JsonDocument[];
  activeDocumentId: DocumentId;
  diff: { leftId: DocumentId; rightId: DocumentId } | null;
  settings: AppSettings;
}

export type WorkerOperation =
  | 'validate'
  | 'format'
  | 'minify'
  | 'sort'
  | 'repair'
  | 'strip-newlines'
  | 'repair-strip-newlines'
  | 'escape'
  | 'unescape'
  | 'stats'
  | 'query'
  | 'diff';

export type DiagnosticSeverity = 'error' | 'warning';

export interface JsonDiagnostic {
  message: string;
  line: number;
  column: number;
  offset: number;
  code: string;
  severity: DiagnosticSeverity;
  context?: string;
}

export interface JsonStats {
  bytes: number;
  characters: number;
  lines: number;
  nodes: number;
  objects: number;
  arrays: number;
  keys: number;
  strings: number;
  numbers: number;
  booleans: number;
  nulls: number;
  maxDepth: number;
}

export interface ProcessingMeta {
  operation: WorkerOperation;
  durationMs: number;
  inputBytes: number;
  outputBytes: number;
  valid: boolean;
  empty?: boolean;
  stats?: JsonStats;
  warnings?: JsonDiagnostic[];
}

export type WorkerRequest = {
  requestId: string;
  operation: WorkerOperation;
  source: string;
  options?: Record<string, unknown>;
};

export type WorkerResponse =
  | { requestId: string; ok: true; result: string; meta: ProcessingMeta; data?: unknown }
  | { requestId: string; ok: false; error: JsonDiagnostic };
