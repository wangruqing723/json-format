import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, WORKSPACE_STORAGE_KEY, type PersistedWorkspaceSnapshot } from '../stores/workspace';
import type { JsonDocument } from '../types';
import {
  createNativeSessionController,
  SESSION_DEBOUNCE_MS,
  SESSION_MAX_WAIT_MS,
  type CommitWorkspaceSessionRequest,
} from './native-session';

function documentFixture(content = '{}', id = 'doc-1'): JsonDocument {
  return {
    id,
    title: 'data.json',
    filePath: null,
    content,
    savedContent: '',
    collapsedPane: 'none',
    language: 'json',
    createdAt: 1,
    updatedAt: 2,
  };
}

function snapshot(content = '{}'): PersistedWorkspaceSnapshot {
  return {
    documents: [documentFixture(content)],
    activeDocumentId: 'doc-1',
    diff: null,
    settings: { ...DEFAULT_SETTINGS },
    recentFiles: [],
  };
}

describe('native session controller', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('停止变化 750ms 后提交，持续变化最长 5s 提交', async () => {
    const requests: CommitWorkspaceSessionRequest[] = [];
    const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      if (command === 'load_workspace_session') return null;
      requests.push(args?.request as CommitWorkspaceSessionRequest);
      return { generation: requests.length };
    });
    const controller = createNativeSessionController({ invoke, legacyStorage: null, createSnapshotId: () => `snap-${requests.length + 1}` });
    await controller.restore();
    controller.schedule(snapshot('one'));
    await vi.advanceTimersByTimeAsync(SESSION_DEBOUNCE_MS - 1);
    expect(requests).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(requests).toHaveLength(1);

    for (let elapsed = 0; elapsed < SESSION_MAX_WAIT_MS; elapsed += 500) {
      controller.schedule(snapshot(`edit-${elapsed}`));
      await vi.advanceTimersByTimeAsync(500);
    }
    expect(requests).toHaveLength(2);
    controller.dispose();
  });

  it('元数据变化复用文档快照，内容变化只发送变化文档', async () => {
    const requests: CommitWorkspaceSessionRequest[] = [];
    let generation = 0;
    const controller = createNativeSessionController({
      legacyStorage: null,
      createSnapshotId: () => `snap-${generation + 1}`,
      invoke: async (command, args) => {
        if (command === 'load_workspace_session') return null as never;
        requests.push(args?.request as CommitWorkspaceSessionRequest);
        return { generation: ++generation } as never;
      },
    });
    await controller.restore();
    const first = snapshot('one');
    await controller.flush(first);
    await controller.flush({ ...first, settings: { ...first.settings, theme: 'dark' } });
    await controller.flush({ ...first, documents: [documentFixture('two')] });

    expect(requests[0].changedDocuments).toHaveLength(1);
    expect(requests[1].changedDocuments).toHaveLength(0);
    expect(requests[1].manifest.documents[0].snapshotId).toBe('snap-1');
    expect(requests[2].changedDocuments).toHaveLength(1);
  });

  it('写入期间合并新变化并严格串行 flush', async () => {
    let resolveFirst!: (value: { generation: number }) => void;
    const firstCommit = new Promise<{ generation: number }>((resolve) => { resolveFirst = resolve; });
    const requests: CommitWorkspaceSessionRequest[] = [];
    const controller = createNativeSessionController({
      legacyStorage: null,
      createSnapshotId: (() => { let id = 0; return () => `snap-${++id}`; })(),
      invoke: (command, args) => {
        if (command === 'load_workspace_session') return Promise.resolve(null) as never;
        requests.push(args?.request as CommitWorkspaceSessionRequest);
        return (requests.length === 1 ? firstCommit : Promise.resolve({ generation: 2 })) as never;
      },
    });
    await controller.restore();
    const firstFlush = controller.flush(snapshot('one'));
    controller.schedule(snapshot('two'));
    const latestFlush = controller.flush(snapshot('two'));
    expect(requests).toHaveLength(1);
    resolveFirst({ generation: 1 });
    await firstFlush;
    await latestFlush;

    expect(requests).toHaveLength(2);
    expect(requests[1].changedDocuments[0].content).toBe('two');
  });

  it('原生目录为空时迁移旧会话并修正非法 id，旧 key 保持不变', async () => {
    const raw = JSON.stringify({
      version: 1,
      documents: [documentFixture('{}', '../legacy')],
      activeDocumentId: '../legacy',
      diff: null,
      settings: DEFAULT_SETTINGS,
      recentFiles: [],
    });
    const storage = { getItem: vi.fn((key: string) => key === WORKSPACE_STORAGE_KEY ? raw : null) };
    let committed: CommitWorkspaceSessionRequest | undefined;
    const controller = createNativeSessionController({
      legacyStorage: storage,
      createSnapshotId: (() => { let id = 0; return () => `generated-${++id}`; })(),
      invoke: async (command, args) => {
        if (command === 'load_workspace_session') return null as never;
        committed = args?.request as CommitWorkspaceSessionRequest;
        return { generation: 1 } as never;
      },
    });

    const restored = await controller.restore();
    expect(restored?.workspace.documents[0].id).toBe('generated-1');
    expect(committed?.manifest.documents[0].id).toBe('generated-1');
    expect(storage.getItem).toHaveBeenCalledWith(WORKSPACE_STORAGE_KEY);
  });

  it('写入失败时报告不可恢复，关闭会话恢复时提交空文档清单', async () => {
    const onIssue = vi.fn();
    const failed = createNativeSessionController({
      legacyStorage: null,
      onIssue,
      invoke: async (command) => {
        if (command === 'load_workspace_session') return null as never;
        throw new Error('磁盘已满');
      },
    });
    await failed.restore();
    await expect(failed.flush(snapshot())).resolves.toEqual({
      ok: false,
      recoverable: false,
      error: '磁盘已满',
    });
    expect(onIssue).toHaveBeenCalledWith('磁盘已满');

    let committed: CommitWorkspaceSessionRequest | undefined;
    const disabled = createNativeSessionController({
      legacyStorage: null,
      invoke: async (command, args) => {
        if (command === 'load_workspace_session') return null as never;
        committed = args?.request as CommitWorkspaceSessionRequest;
        return { generation: 1 } as never;
      },
    });
    await disabled.restore();
    const noRestore = snapshot();
    noRestore.settings = { ...noRestore.settings, restoreSession: false };
    const result = await disabled.flush(noRestore);
    expect(result).toEqual({ ok: true, recoverable: false });
    expect(committed?.manifest).toMatchObject({ documents: [], activeDocumentId: null, diff: null });
    expect(committed?.changedDocuments).toEqual([]);
  });
});
