export type DocumentId = string;

export type DocumentView = 'text' | 'tree';

export interface JsonDocument {
  id: DocumentId;
  title: string;
  filePath: string | null;
  content: string;
  savedContent: string;
  view: DocumentView;
  language: 'json';
  createdAt: number;
  updatedAt: number;
}

export interface AppSettings {
  theme: 'system' | 'light' | 'dark';
  indent: 2 | 4 | 'tab';
  sortKeys: boolean;
  restoreSession: boolean;
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
  | 'escape'
  | 'unescape'
  | 'stats';

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
  | { requestId: string; ok: true; result: string; meta: ProcessingMeta }
  | { requestId: string; ok: false; error: JsonDiagnostic };
