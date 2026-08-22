import type { AppSettings, DocumentId, JsonDocument, RecentFile, WorkspaceState } from '../types';
import {
  readLegacyWorkspaceSnapshot,
  WORKSPACE_STORAGE_KEY,
  type PersistedWorkspaceSnapshot,
  type WorkspaceStore,
} from '../stores/workspace';
import { beginSpan } from './perf-probe';

export const SESSION_DEBOUNCE_MS = 750;
export const SESSION_MAX_WAIT_MS = 5_000;

export interface NativeSessionDocumentEntry {
  id: DocumentId;
  title: string;
  filePath: string | null;
  collapsedPane: JsonDocument['collapsedPane'];
  language: 'json';
  createdAt: number;
  updatedAt: number;
  snapshotId: string;
}

export interface NativeSessionDocumentSnapshot {
  documentId: DocumentId;
  snapshotId: string;
  content: string;
  savedContent: string;
}

export interface NativeSessionManifestInput {
  version: 1;
  documents: NativeSessionDocumentEntry[];
  activeDocumentId: DocumentId | null;
  diff: WorkspaceState['diff'];
  settings: AppSettings;
  recentFiles: RecentFile[];
}

export interface CommitWorkspaceSessionRequest {
  manifest: NativeSessionManifestInput;
  changedDocuments: NativeSessionDocumentSnapshot[];
}

export interface NativeSessionLoadResult {
  generation: number;
  workspace: PersistedWorkspaceSnapshot;
  snapshotIds: Record<DocumentId, string>;
}

export interface CommitWorkspaceSessionResult {
  generation: number;
}

export interface SessionFlushResult {
  ok: boolean;
  recoverable: boolean;
  error?: string;
}

export interface NativeSessionController {
  restore(): Promise<NativeSessionLoadResult | null>;
  schedule(snapshot: PersistedWorkspaceSnapshot): void;
  flush(snapshot: PersistedWorkspaceSnapshot): Promise<SessionFlushResult>;
  dispose(): void;
}

type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

interface NativeSessionControllerOptions {
  invoke?: Invoke;
  legacyStorage?: Pick<Storage, 'getItem'> | null;
  createSnapshotId?: () => string;
  onIssue?: (message: string | null) => void;
}

interface CommittedDocument {
  content: string;
  savedContent: string;
  snapshotId: string;
}

export function workspaceSnapshotFromState(
  state: Pick<
    WorkspaceStore,
    'documents' | 'activeDocumentId' | 'diff' | 'settings' | 'recentFiles'
  >,
): PersistedWorkspaceSnapshot {
  return {
    documents: state.documents,
    activeDocumentId: state.activeDocumentId,
    diff: state.diff,
    settings: state.settings,
    recentFiles: state.recentFiles,
  };
}

export function createNativeSessionController(
  options: NativeSessionControllerOptions = {},
): NativeSessionController {
  return new NativeSessionControllerImpl(options);
}

class NativeSessionControllerImpl implements NativeSessionController {
  private readonly invoke: Invoke;
  private readonly legacyStorage: Pick<Storage, 'getItem'> | null;
  private readonly createSnapshotId: () => string;
  private readonly onIssue: (message: string | null) => void;
  private readonly committedDocuments = new Map<DocumentId, CommittedDocument>();
  private pendingSnapshot: PersistedWorkspaceSnapshot | null = null;
  private lastObservedSnapshot: PersistedWorkspaceSnapshot | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private maxWaitTimer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<SessionFlushResult> | null = null;
  private revision = 0;
  private committedRevision = 0;
  private lastGeneration = 0;
  private lastCommittedRestore = false;
  private disposed = false;

  constructor(options: NativeSessionControllerOptions) {
    this.invoke = options.invoke ?? invokeTauri;
    this.legacyStorage = options.legacyStorage === undefined
      ? getLegacyStorage()
      : options.legacyStorage;
    this.createSnapshotId = options.createSnapshotId ?? defaultSnapshotId;
    this.onIssue = options.onIssue ?? (() => undefined);
  }

  async restore(): Promise<NativeSessionLoadResult | null> {
    const loaded = await this.invoke<NativeSessionLoadResult | null>('load_workspace_session');
    if (this.disposed) return null;
    if (loaded) {
      this.adoptLoadedSession(loaded);
      return loaded;
    }

    const legacy = this.legacyStorage
      ? readLegacyWorkspaceSnapshot(this.legacyStorage)
      : null;
    if (!legacy) return null;

    const migrated = normalizeLegacyIdentifiers(legacy, this.createSnapshotId);
    this.observe(migrated);
    const result = await this.commitLatest();
    if (!result.ok) throw new Error(result.error ?? '旧工作区迁移失败。');
    return {
      generation: this.lastGeneration,
      workspace: migrated,
      snapshotIds: Object.fromEntries(
        [...this.committedDocuments].map(([id, document]) => [id, document.snapshotId]),
      ),
    };
  }

  schedule(snapshot: PersistedWorkspaceSnapshot): void {
    if (this.disposed || !this.observe(snapshot)) return;
    this.scheduleTimers();
  }

  async flush(snapshot: PersistedWorkspaceSnapshot): Promise<SessionFlushResult> {
    if (this.disposed) {
      return { ok: false, recoverable: false, error: '会话协调器已停止。' };
    }
    this.observe(snapshot);
    this.clearTimers();

    while (this.committedRevision < this.revision) {
      const result = this.inFlight ? await this.inFlight : await this.commitLatest();
      if (!result.ok) return result;
    }
    return {
      ok: true,
      recoverable: this.lastCommittedRestore && this.committedRevision === this.revision,
    };
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimers();
  }

  private observe(snapshot: PersistedWorkspaceSnapshot): boolean {
    if (sameSnapshotReferences(this.lastObservedSnapshot, snapshot)) return false;
    this.lastObservedSnapshot = snapshot;
    this.pendingSnapshot = snapshot;
    this.revision++;
    return true;
  }

  private scheduleTimers(): void {
    if (this.disposed) return;
    if (this.debounceTimer !== null) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.commitLatest();
    }, SESSION_DEBOUNCE_MS);
    if (this.maxWaitTimer === null) {
      this.maxWaitTimer = setTimeout(() => {
        this.maxWaitTimer = null;
        if (this.debounceTimer !== null) clearTimeout(this.debounceTimer);
        this.debounceTimer = null;
        void this.commitLatest();
      }, SESSION_MAX_WAIT_MS);
    }
  }

  private clearTimers(): void {
    if (this.debounceTimer !== null) clearTimeout(this.debounceTimer);
    if (this.maxWaitTimer !== null) clearTimeout(this.maxWaitTimer);
    this.debounceTimer = null;
    this.maxWaitTimer = null;
  }

  private commitLatest(): Promise<SessionFlushResult> {
    if (this.inFlight) return this.inFlight;
    const snapshot = this.pendingSnapshot;
    const revision = this.revision;
    if (!snapshot || revision <= this.committedRevision) {
      return Promise.resolve({
        ok: true,
        recoverable: this.lastCommittedRestore && revision === this.committedRevision,
      });
    }
    this.clearTimers();

    this.inFlight = this.commitSnapshot(snapshot, revision)
      .then((result) => {
        this.inFlight = null;
        if (this.revision > revision) this.scheduleTimers();
        return result;
      });
    return this.inFlight;
  }

  private async commitSnapshot(
    snapshot: PersistedWorkspaceSnapshot,
    revision: number,
  ): Promise<SessionFlushResult> {
    const preparedDocuments = new Map<DocumentId, CommittedDocument>();
    const changedDocuments: NativeSessionDocumentSnapshot[] = [];
    const manifestDocuments: NativeSessionDocumentEntry[] = [];

    if (snapshot.settings.restoreSession) {
      for (const document of snapshot.documents) {
        const previous = this.committedDocuments.get(document.id);
        const changed = !previous
          || previous.content !== document.content
          || previous.savedContent !== document.savedContent;
        const snapshotId = changed ? this.createSnapshotId() : previous.snapshotId;
        preparedDocuments.set(document.id, {
          content: document.content,
          savedContent: document.savedContent,
          snapshotId,
        });
        manifestDocuments.push({
          id: document.id,
          title: document.title,
          filePath: document.filePath,
          collapsedPane: document.collapsedPane,
          language: document.language,
          createdAt: document.createdAt,
          updatedAt: document.updatedAt,
          snapshotId,
        });
        if (changed) {
          changedDocuments.push({
            documentId: document.id,
            snapshotId,
            content: document.content,
            savedContent: document.savedContent,
          });
        }
      }
    }

    const request: CommitWorkspaceSessionRequest = {
      manifest: {
        version: 1,
        documents: manifestDocuments,
        activeDocumentId: manifestDocuments.length > 0 ? snapshot.activeDocumentId : null,
        diff: manifestDocuments.length > 0 ? snapshot.diff : null,
        settings: snapshot.settings,
        recentFiles: snapshot.recentFiles,
      },
      changedDocuments,
    };

    try {
      const result = await this.invoke<CommitWorkspaceSessionResult>(
        'commit_workspace_session',
        { request },
      );
      this.lastGeneration = result.generation;
      this.committedRevision = revision;
      this.lastCommittedRestore = snapshot.settings.restoreSession;
      this.committedDocuments.clear();
      for (const [id, document] of preparedDocuments) {
        this.committedDocuments.set(id, document);
      }
      this.onIssue(null);
      return { ok: true, recoverable: this.lastCommittedRestore };
    } catch (error) {
      const message = errorMessage(error);
      this.onIssue(message);
      return { ok: false, recoverable: false, error: message };
    }
  }

  private adoptLoadedSession(loaded: NativeSessionLoadResult): void {
    this.lastGeneration = loaded.generation;
    this.lastCommittedRestore = loaded.workspace.settings.restoreSession;
    this.committedDocuments.clear();
    for (const document of loaded.workspace.documents) {
      const snapshotId = loaded.snapshotIds[document.id];
      if (!snapshotId) continue;
      this.committedDocuments.set(document.id, {
        content: document.content,
        savedContent: document.savedContent,
        snapshotId,
      });
    }
  }
}

function sameSnapshotReferences(
  left: PersistedWorkspaceSnapshot | null,
  right: PersistedWorkspaceSnapshot,
): boolean {
  return Boolean(
    left
    && left.documents === right.documents
    && left.activeDocumentId === right.activeDocumentId
    && left.diff === right.diff
    && left.settings === right.settings
    && left.recentFiles === right.recentFiles,
  );
}

function normalizeLegacyIdentifiers(
  snapshot: PersistedWorkspaceSnapshot,
  createId: () => string,
): PersistedWorkspaceSnapshot {
  const used = new Set<string>();
  const idMap = new Map<string, string>();
  const documents = snapshot.documents.map((document) => {
    let id = document.id;
    while (!isValidNativeIdentifier(id) || used.has(id)) id = createId();
    used.add(id);
    if (!idMap.has(document.id)) idMap.set(document.id, id);
    return { ...document, id };
  });
  const activeDocumentId = idMap.get(snapshot.activeDocumentId) ?? documents[0]?.id ?? '';
  const leftId = snapshot.diff ? idMap.get(snapshot.diff.leftId) : undefined;
  const rightId = snapshot.diff ? idMap.get(snapshot.diff.rightId) : undefined;
  return {
    ...snapshot,
    documents,
    activeDocumentId,
    diff: leftId && rightId && leftId !== rightId ? { leftId, rightId } : null,
  };
}

function isValidNativeIdentifier(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

// 落盘 IPC 单独计时：0.3.6 已把 Rust 侧命令挪出主线程，但 JS 侧序列化整份内容、
// 等待响应仍在主线程上，需要实测确认这条路还剩多少代价。
async function invokeTauri<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  const endInvoke = beginSpan(`ipc:${command}`);
  try {
    return await invoke<T>(command, args);
  } finally {
    endInvoke();
  }
}

function getLegacyStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
    return window.localStorage;
  } catch {
    return null;
  }
}

function defaultSnapshotId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `snapshot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function errorMessage(error: unknown): string {
  return typeof error === 'string'
    ? error
    : error instanceof Error
      ? error.message
      : '工作区恢复快照写入失败。';
}
