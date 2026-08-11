import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { HistoryRecord } from '../components/HistoryView';
import { clampStructureWidth, STRUCTURE_PANEL_DEFAULT_WIDTH } from '../core/structure-width';
import type {
  AppSettings,
  DocumentId,
  DocumentView,
  JsonDocument,
  RecentFile,
  WorkspaceState,
} from '../types';

export const WORKSPACE_STORAGE_KEY = 'json-forge.workspace.v1';
export const MAX_RECENT_FILES = 10;
export const MAX_WORKSPACE_STORAGE_BYTES = 4 * 1024 * 1024;
export const MAX_HISTORY_RECORDS = 20;
export const MAX_HISTORY_SNAPSHOT_BYTES = 256 * 1024;

export type WorkspacePersistenceIssueCode =
  | 'size-limit'
  | 'storage-error'
  | 'read-error';

export interface WorkspacePersistenceIssue {
  code: WorkspacePersistenceIssueCode;
  message: string;
  documentsOmitted: boolean;
  metadataPersisted: boolean;
}

export type PersistenceScheduler = (task: () => void) => () => void;

interface WorkspaceStorage {
  getItem: Storage['getItem'];
  setItem: Storage['setItem'];
  removeItem?: Storage['removeItem'];
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  indent: 2,
  sortKeys: false,
  restoreSession: true,
  sidebarCollapsed: false,
  diffMode: 'structural',
  structureWidth: STRUCTURE_PANEL_DEFAULT_WIDTH,
};

export interface OpenDocumentInput {
  title: string;
  filePath: string | null;
  content: string;
}

export interface WorkspaceStore extends WorkspaceState {
  recentFiles: RecentFile[];
  history: HistoryRecord[];
  persistenceIssue: WorkspacePersistenceIssue | null;
  newDocument: (content?: string, title?: string) => DocumentId;
  openDocument: (input: OpenDocumentInput) => DocumentId;
  updateContent: (id: DocumentId, content: string) => void;
  markSaved: (
    id: DocumentId,
    filePath?: string | null,
    title?: string,
    savedContent?: string,
  ) => void;
  closeDocument: (id: DocumentId) => boolean;
  reorderDocument: (id: DocumentId, targetIndex: number) => boolean;
  hydrateWorkspace: (snapshot: PersistedWorkspaceSnapshot) => void;
  setActive: (id: DocumentId) => void;
  setView: (id: DocumentId, view: DocumentView) => void;
  setDiff: (diff: WorkspaceState['diff']) => void;
  updateSettings: (patch: Partial<AppSettings>) => void;
  addRecentFile: (path: string, name: string) => void;
  removeRecentFile: (path: string) => void;
  addHistoryRecord: (input: Omit<HistoryRecord, 'id' | 'createdAt'>) => void;
  clearHistory: () => void;
  flushPersistence: () => void;
}

export interface WorkspaceStoreOptions {
  storage?: WorkspaceStorage | null;
  now?: () => number;
  createId?: () => string;
  schedulePersistence?: PersistenceScheduler;
}

export interface PersistedWorkspaceSnapshot {
  documents: JsonDocument[];
  activeDocumentId: DocumentId;
  diff: WorkspaceState['diff'];
  settings: AppSettings;
  recentFiles: RecentFile[];
}

interface PersistedWorkspace {
  version: 1;
  documents?: JsonDocument[];
  activeDocumentId?: DocumentId;
  diff?: WorkspaceState['diff'];
  settings: AppSettings;
  recentFiles: RecentFile[];
  documentsOmitted?: true;
  persistenceIssue?: WorkspacePersistenceIssue;
}

export function createWorkspaceStore(
  options: WorkspaceStoreOptions = {},
): StoreApi<WorkspaceStore> {
  const storage = options.storage === undefined ? getDefaultStorage() : options.storage;
  const now = options.now ?? Date.now;
  const createId = options.createId ?? defaultCreateId;
  const schedulePersistence = options.schedulePersistence ?? defaultPersistenceScheduler;
  const { workspace: restored, issue: restorationIssue } = readPersistedWorkspace(storage);
  const settings = { ...DEFAULT_SETTINGS, ...restored?.settings };
  const restoredDocuments = settings.restoreSession
    ? sanitizeDocuments(restored?.documents)
    : [];
  const initialDocuments =
    restoredDocuments.length > 0
      ? restoredDocuments
      : [createDocument(createId(), now(), '', '未命名 1', null)];
  const initialActiveId = initialDocuments.some(
    (document) => document.id === restored?.activeDocumentId,
  )
    ? (restored?.activeDocumentId as DocumentId)
    : initialDocuments[0].id;
  const initialDiff = sanitizeDiff(restored?.diff, initialDocuments);
  const initialRecentFiles = sanitizeRecentFiles(restored?.recentFiles);

  return createStore<WorkspaceStore>((set, get) => {
    let persistenceScheduled = false;
    let cancelScheduledPersistence: (() => void) | null = null;

    const persistCurrentState = (): void => {
      const issue = persistWorkspace(storage, get());
      if (!samePersistenceIssue(get().persistenceIssue, issue)) {
        set({ persistenceIssue: issue });
      }
    };

    const flushPersistence = (): void => {
      cancelScheduledPersistence?.();
      cancelScheduledPersistence = null;
      persistenceScheduled = false;
      persistCurrentState();
    };

    const schedulePersistenceFlush = (): void => {
      if (!storage || persistenceScheduled) return;
      persistenceScheduled = true;
      let executedSynchronously = false;
      const cancel = schedulePersistence(() => {
        executedSynchronously = true;
        persistenceScheduled = false;
        cancelScheduledPersistence = null;
        persistCurrentState();
      });
      if (!executedSynchronously) cancelScheduledPersistence = cancel;
    };

    const commit = (
      updater: (state: WorkspaceStore) => Partial<WorkspaceStore>,
    ): void => {
      set((state) => updater(state));
      schedulePersistenceFlush();
    };

    return {
      documents: initialDocuments,
      activeDocumentId: initialActiveId,
      diff: initialDiff,
      settings,
      recentFiles: initialRecentFiles,
      history: [],
      persistenceIssue: restored?.persistenceIssue ?? restorationIssue,

      newDocument: (content = '', title) => {
        const id = createId();
        commit((state) => {
          const document = createDocument(
            id,
            now(),
            content,
            title ?? nextUntitledTitle(state.documents),
            null,
          );
          return {
            documents: [...state.documents, document],
            activeDocumentId: id,
          };
        });
        return id;
      },

      openDocument: (input) => {
        const existing = input.filePath
          ? get().documents.find((document) => document.filePath === input.filePath)
          : undefined;
        if (existing) {
          commit(() => ({ activeDocumentId: existing.id }));
          return existing.id;
        }

        const id = createId();
        commit((state) => ({
          documents: [
            ...state.documents,
            createDocument(id, now(), input.content, input.title, input.filePath),
          ],
          activeDocumentId: id,
        }));
        if (input.filePath) get().addRecentFile(input.filePath, input.title);
        return id;
      },

      updateContent: (id, content) => {
        commit((state) => ({
          documents: state.documents.map((document) =>
            document.id === id ? { ...document, content, updatedAt: now() } : document,
          ),
        }));
      },

      markSaved: (id, filePath, title, savedContent) => {
        commit((state) => ({
          documents: state.documents.map((document) => {
            if (document.id !== id) return document;
            const nextFilePath = filePath === undefined ? document.filePath : filePath;
            const nextTitle = title ?? document.title;
            return {
              ...document,
              filePath: nextFilePath,
              title: nextTitle,
              savedContent: savedContent === undefined ? document.content : savedContent,
              updatedAt: now(),
            };
          }),
        }));
        const savedDocument = get().documents.find((document) => document.id === id);
        if (savedDocument?.filePath) {
          get().addRecentFile(savedDocument.filePath, savedDocument.title);
        }
      },

      closeDocument: (id) => {
        if (!get().documents.some((document) => document.id === id)) return false;
        commit((state) => {
          const closingIndex = state.documents.findIndex((document) => document.id === id);
          let documents = state.documents.filter((document) => document.id !== id);
          if (documents.length === 0) {
            documents = [
              createDocument(createId(), now(), '', '未命名 1', null),
            ];
          }
          const activeDocumentId =
            state.activeDocumentId === id
              ? documents[Math.min(closingIndex, documents.length - 1)].id
              : state.activeDocumentId;
          const diff =
            state.diff?.leftId === id || state.diff?.rightId === id ? null : state.diff;
          return { documents, activeDocumentId, diff };
        });
        return true;
      },

      reorderDocument: (id, targetIndex) => {
        const current = get();
        const sourceIndex = current.documents.findIndex((document) => document.id === id);
        if (sourceIndex < 0 || current.documents.length < 2 || !Number.isFinite(targetIndex)) {
          return false;
        }
        const normalizedTarget = Math.max(
          0,
          Math.min(Math.trunc(targetIndex), current.documents.length - 1),
        );
        if (sourceIndex === normalizedTarget) return false;

        commit((state) => {
          const documents = [...state.documents];
          const [document] = documents.splice(sourceIndex, 1);
          documents.splice(normalizedTarget, 0, document);
          return { documents };
        });
        return true;
      },

      hydrateWorkspace: (snapshot) => {
        const nextSettings = {
          ...DEFAULT_SETTINGS,
          ...sanitizeSettings(snapshot.settings ?? {}),
        };
        const sanitizedDocuments = nextSettings.restoreSession
          ? sanitizeDocuments(snapshot.documents)
          : [];
        const documents = sanitizedDocuments.length > 0
          ? sanitizedDocuments
          : [createDocument(createId(), now(), '', '未命名 1', null)];
        const activeDocumentId = documents.some(
          (document) => document.id === snapshot.activeDocumentId,
        )
          ? snapshot.activeDocumentId
          : documents[0].id;
        set({
          documents,
          activeDocumentId,
          diff: sanitizeDiff(snapshot.diff, documents),
          settings: nextSettings,
          recentFiles: sanitizeRecentFiles(snapshot.recentFiles),
          persistenceIssue: null,
        });
      },

      setActive: (id) => {
        if (!get().documents.some((document) => document.id === id)) return;
        commit(() => ({ activeDocumentId: id }));
      },

      setView: (id, view) => {
        commit((state) => ({
          documents: state.documents.map((document) =>
            document.id === id ? { ...document, view, updatedAt: now() } : document,
          ),
        }));
      },

      setDiff: (diff) => {
        commit((state) => ({ diff: sanitizeDiff(diff, state.documents) }));
      },

      updateSettings: (patch) => {
        commit((state) => ({ settings: { ...state.settings, ...sanitizeSettings(patch) } }));
      },

      addRecentFile: (path, name) => {
        if (!path) return;
        commit((state) => ({
          recentFiles: [
            { path, name: name || fileNameFromPath(path), openedAt: now() },
            ...state.recentFiles.filter((file) => file.path !== path),
          ].slice(0, MAX_RECENT_FILES),
        }));
      },

      removeRecentFile: (path) => {
        commit((state) => ({
          recentFiles: state.recentFiles.filter((file) => file.path !== path),
        }));
      },

      addHistoryRecord: (input) => {
        const content = input.content !== null && utf8ByteLength(input.content) > MAX_HISTORY_SNAPSHOT_BYTES
          ? null
          : input.content;
        const record: HistoryRecord = { ...input, content, id: createId(), createdAt: now() };
        commit((state) => ({ history: [record, ...state.history].slice(0, MAX_HISTORY_RECORDS) }));
      },

      clearHistory: () => {
        commit(() => ({ history: [] }));
      },

      flushPersistence,
    };
  });
}

export function isDocumentDirty(document: JsonDocument): boolean {
  return document.savedContent !== document.content;
}

export function readLegacyWorkspaceSnapshot(
  storage: Pick<Storage, 'getItem'>,
): PersistedWorkspaceSnapshot | null {
  const { workspace } = readPersistedWorkspace(storage);
  if (!workspace) return null;
  const settings = { ...DEFAULT_SETTINGS, ...sanitizeSettings(workspace.settings) };
  const documents = settings.restoreSession ? sanitizeDocuments(workspace.documents) : [];
  const activeDocumentId = documents.some(
    (document) => document.id === workspace.activeDocumentId,
  )
    ? (workspace.activeDocumentId as DocumentId)
    : documents[0]?.id ?? '';
  return {
    documents,
    activeDocumentId,
    diff: sanitizeDiff(workspace.diff, documents),
    settings,
    recentFiles: sanitizeRecentFiles(workspace.recentFiles),
  };
}

export interface BoundWorkspaceStore extends StoreApi<WorkspaceStore> {
  (): WorkspaceStore;
  <T>(selector: (state: WorkspaceStore) => T): T;
}

const defaultWorkspaceStore = createWorkspaceStore();
const useWorkspaceStoreHook = <T = WorkspaceStore>(
  selector: (state: WorkspaceStore) => T = (state) => state as T,
): T => useStore(defaultWorkspaceStore, selector);
export const useWorkspaceStore = Object.assign(
  useWorkspaceStoreHook,
  defaultWorkspaceStore,
) as BoundWorkspaceStore;

function createDocument(
  id: string,
  timestamp: number,
  content: string,
  title: string,
  filePath: string | null,
): JsonDocument {
  return {
    id,
    title,
    filePath,
    content,
    savedContent: content,
    view: 'text',
    language: 'json',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function nextUntitledTitle(documents: JsonDocument[]): string {
  const used = new Set(documents.map((document) => document.title));
  let index = 1;
  while (used.has(`未命名 ${index}`)) index++;
  return `未命名 ${index}`;
}

function sanitizeDocuments(value: unknown): JsonDocument[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isJsonDocument).map((document) => ({ ...document }));
}

function isJsonDocument(value: unknown): value is JsonDocument {
  if (!value || typeof value !== 'object') return false;
  const document = value as Partial<JsonDocument>;
  return (
    typeof document.id === 'string' &&
    typeof document.title === 'string' &&
    (typeof document.filePath === 'string' || document.filePath === null) &&
    typeof document.content === 'string' &&
    typeof document.savedContent === 'string' &&
    (document.view === 'text' || document.view === 'tree') &&
    document.language === 'json' &&
    typeof document.createdAt === 'number' &&
    typeof document.updatedAt === 'number'
  );
}

function sanitizeDiff(
  value: WorkspaceState['diff'] | undefined,
  documents: JsonDocument[],
): WorkspaceState['diff'] {
  if (!value) return null;
  const ids = new Set(documents.map((document) => document.id));
  return ids.has(value.leftId) && ids.has(value.rightId) && value.leftId !== value.rightId
    ? value
    : null;
}

function sanitizeRecentFiles(value: unknown): RecentFile[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((file): file is RecentFile => {
      if (!file || typeof file !== 'object') return false;
      const candidate = file as Partial<RecentFile>;
      return (
        typeof candidate.path === 'string' &&
        typeof candidate.name === 'string' &&
        typeof candidate.openedAt === 'number'
      );
    })
    .slice(0, MAX_RECENT_FILES);
}

function sanitizeSettings(settings: Partial<AppSettings>): Partial<AppSettings> {
  const result: Partial<AppSettings> = {};
  if (settings.theme === 'system' || settings.theme === 'light' || settings.theme === 'dark') {
    result.theme = settings.theme;
  }
  if (settings.indent === 2 || settings.indent === 4 || settings.indent === 'tab') {
    result.indent = settings.indent;
  }
  if (typeof settings.sortKeys === 'boolean') result.sortKeys = settings.sortKeys;
  if (typeof settings.restoreSession === 'boolean') {
    result.restoreSession = settings.restoreSession;
  }
  if (typeof settings.sidebarCollapsed === 'boolean') {
    result.sidebarCollapsed = settings.sidebarCollapsed;
  }
  if (settings.diffMode === 'structural' || settings.diffMode === 'line') {
    result.diffMode = settings.diffMode;
  }
  // 宽度必须钳制而非直接采信：手改 localStorage 或旧版本遗留的越界值
  // 会让面板宽到挤掉编辑区；NaN 更会把 CSS 变量变成 auto，面板直接塌掉。
  if (typeof settings.structureWidth === 'number') {
    result.structureWidth = clampStructureWidth(settings.structureWidth);
  }
  return result;
}

interface PersistedWorkspaceReadResult {
  workspace: PersistedWorkspace | null;
  issue: WorkspacePersistenceIssue | null;
}

function readPersistedWorkspace(
  storage: Pick<Storage, 'getItem'> | null | undefined,
): PersistedWorkspaceReadResult {
  if (!storage) return { workspace: null, issue: null };
  try {
    const raw = storage.getItem(WORKSPACE_STORAGE_KEY);
    if (!raw) return { workspace: null, issue: null };
    const parsed = JSON.parse(raw) as Partial<PersistedWorkspace>;
    if (!parsed || parsed.version !== 1) return { workspace: null, issue: null };
    return {
      workspace: {
        version: 1,
        documents: parsed.documents,
        activeDocumentId: parsed.activeDocumentId,
        diff: parsed.diff,
        settings: { ...DEFAULT_SETTINGS, ...sanitizeSettings(parsed.settings ?? {}) },
        recentFiles: sanitizeRecentFiles(parsed.recentFiles),
        ...(parsed.documentsOmitted ? { documentsOmitted: true } : {}),
        ...(isPersistenceIssue(parsed.persistenceIssue)
          ? { persistenceIssue: parsed.persistenceIssue }
          : {}),
      },
      issue: null,
    };
  } catch {
    return {
      workspace: null,
      issue: {
        code: 'read-error',
        message: '无法读取已保存的工作区，会话将从空白文档开始。',
        documentsOmitted: true,
        metadataPersisted: false,
      },
    };
  }
}

function persistWorkspace(
  storage: WorkspaceStoreOptions['storage'],
  state: WorkspaceStore,
): WorkspacePersistenceIssue | null {
  if (!storage) return null;
  const value: PersistedWorkspace = {
    version: 1,
    ...(state.settings.restoreSession
      ? {
          documents: state.documents,
          activeDocumentId: state.activeDocumentId,
          diff: state.diff,
        }
      : {}),
    settings: state.settings,
    recentFiles: state.recentFiles,
  };

  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return persistMetadataFallback(storage, state, 'storage-error');
  }

  if (estimateUtf16Bytes(serialized) > MAX_WORKSPACE_STORAGE_BYTES) {
    return persistMetadataFallback(storage, state, 'size-limit');
  }

  try {
    storage.setItem(WORKSPACE_STORAGE_KEY, serialized);
    return null;
  } catch {
    return persistMetadataFallback(storage, state, 'storage-error');
  }
}

function persistMetadataFallback(
  storage: WorkspaceStorage,
  state: WorkspaceStore,
  code: Extract<WorkspacePersistenceIssueCode, 'size-limit' | 'storage-error'>,
): WorkspacePersistenceIssue {
  const persistedIssue = createPersistenceIssue(code, true);
  const fallback: PersistedWorkspace = {
    version: 1,
    settings: state.settings,
    recentFiles: state.recentFiles,
    documentsOmitted: true,
    persistenceIssue: persistedIssue,
  };

  try {
    storage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(fallback));
    return persistedIssue;
  } catch {
    try {
      storage.removeItem?.(WORKSPACE_STORAGE_KEY);
    } catch {
      // 状态会明确告知用户元数据也未保存，内存中的编辑不受影响。
    }
    return createPersistenceIssue(code, false);
  }
}

function createPersistenceIssue(
  code: Extract<WorkspacePersistenceIssueCode, 'size-limit' | 'storage-error'>,
  metadataPersisted: boolean,
): WorkspacePersistenceIssue {
  const reason =
    code === 'size-limit'
      ? '会话文档超过 4 MiB 持久化上限，文档内容未保存。'
      : '浏览器存储写入失败，会话文档未保存。';
  return {
    code,
    message: metadataPersisted
      ? `${reason}设置和最近文件已保存。`
      : `${reason}设置和最近文件也未能保存。`,
    documentsOmitted: true,
    metadataPersisted,
  };
}

function estimateUtf16Bytes(value: string): number {
  return value.length * 2;
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function isPersistenceIssue(value: unknown): value is WorkspacePersistenceIssue {
  if (!value || typeof value !== 'object') return false;
  const issue = value as Partial<WorkspacePersistenceIssue>;
  return (
    (issue.code === 'size-limit' ||
      issue.code === 'storage-error' ||
      issue.code === 'read-error') &&
    typeof issue.message === 'string' &&
    typeof issue.documentsOmitted === 'boolean' &&
    typeof issue.metadataPersisted === 'boolean'
  );
}

function samePersistenceIssue(
  left: WorkspacePersistenceIssue | null,
  right: WorkspacePersistenceIssue | null,
): boolean {
  if (left === right) return true;
  return (
    left?.code === right?.code &&
    left?.message === right?.message &&
    left?.documentsOmitted === right?.documentsOmitted &&
    left?.metadataPersisted === right?.metadataPersisted
  );
}

function defaultPersistenceScheduler(task: () => void): () => void {
  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    const handle = window.requestIdleCallback(task, { timeout: 500 });
    return () => window.cancelIdleCallback(handle);
  }
  const handle = setTimeout(task, 200);
  return () => clearTimeout(handle);
}

function getDefaultStorage(): Storage | null {
  try {
    return typeof window === 'undefined' || window.__TAURI_INTERNALS__
      ? null
      : window.localStorage;
  } catch {
    return null;
  }
}

function defaultCreateId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `document-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function fileNameFromPath(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}
