import { beforeEach, describe, expect, it } from 'vitest';
import type { JsonDocument } from '../types';
import {
  createWorkspaceStore,
  isDocumentDirty,
  MAX_HISTORY_RECORDS,
  MAX_HISTORY_SNAPSHOT_BYTES,
  MAX_WORKSPACE_STORAGE_BYTES,
  WORKSPACE_STORAGE_KEY,
} from './workspace';

class MemoryStorage implements Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  private values = new Map<string, string>();
  setItemCalls = 0;
  removeItemCalls = 0;

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.setItemCalls++;
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.removeItemCalls++;
    this.values.delete(key);
  }

  seed(key: string, value: string): void {
    this.values.set(key, value);
  }
}

function rawDocument(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'restored-doc',
    title: 'restored.json',
    filePath: null,
    content: '{}',
    savedContent: '{}',
    language: 'json',
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

interface ScheduledTask {
  task: () => void;
  cancelled: boolean;
}

describe('workspace store', () => {
  let storage: MemoryStorage;
  let scheduledTasks: ScheduledTask[];
  let id = 0;
  let time = 100;

  beforeEach(() => {
    storage = new MemoryStorage();
    scheduledTasks = [];
    id = 0;
    time = 100;
  });

  const createStore = (targetStorage: MemoryStorage = storage) =>
    createWorkspaceStore({
      storage: targetStorage,
      createId: () => `doc-${++id}`,
      now: () => ++time,
      schedulePersistence: (task) => {
        const scheduled = { task, cancelled: false };
        scheduledTasks.push(scheduled);
        return () => {
          scheduled.cancelled = true;
        };
      },
    });

  it('以 savedContent !== content 作为唯一脏状态判断', () => {
    const store = createStore();
    const documentId = store.getState().activeDocumentId;
    expect(isDocumentDirty(store.getState().documents[0])).toBe(false);

    store.getState().updateContent(documentId, '{"ok":true}');
    expect(isDocumentDirty(store.getState().documents[0])).toBe(true);

    store.getState().markSaved(documentId, '/tmp/example.json', 'example.json');
    expect(isDocumentDirty(store.getState().documents[0])).toBe(false);
    expect(store.getState().documents[0]).toMatchObject({
      filePath: '/tmp/example.json',
      title: 'example.json',
      savedContent: '{"ok":true}',
    });
  });

  it('保存完成时可记录实际落盘快照，保留并发产生的新编辑', () => {
    const store = createStore();
    const documentId = store.getState().activeDocumentId;
    store.getState().updateContent(documentId, '{"version":"older"}');
    store.getState().updateContent(documentId, '{"version":"newer"}');

    store
      .getState()
      .markSaved(documentId, '/tmp/race.json', 'race.json', '{"version":"older"}');

    const document = store.getState().documents[0];
    expect(document.content).toBe('{"version":"newer"}');
    expect(document.savedContent).toBe('{"version":"older"}');
    expect(isDocumentDirty(document)).toBe(true);
  });

  it('创建、切换和关闭多个标签，并在最后一个关闭后补空标签', () => {
    const store = createStore();
    const firstId = store.getState().activeDocumentId;
    const secondId = store.getState().newDocument('[]');

    expect(store.getState().activeDocumentId).toBe(secondId);
    store.getState().setActive(firstId);
    expect(store.getState().activeDocumentId).toBe(firstId);
    expect(store.getState().closeDocument(firstId)).toBe(true);
    expect(store.getState().activeDocumentId).toBe(secondId);
    expect(store.getState().closeDocument(secondId)).toBe(true);
    expect(store.getState().documents).toHaveLength(1);
    expect(store.getState().documents[0].content).toBe('');
  });

  it('重排标签只改变文档顺序，并持久化恢复该顺序', () => {
    const store = createStore();
    const firstId = store.getState().activeDocumentId;
    const secondId = store.getState().newDocument('{}', 'second.json');
    const thirdId = store.getState().newDocument('[]', 'third.json');
    store.getState().setDiff({ leftId: firstId, rightId: secondId });
    const activeBefore = store.getState().activeDocumentId;
    const diffBefore = store.getState().diff;

    expect(store.getState().reorderDocument(thirdId, 0)).toBe(true);
    expect(store.getState().documents.map((document) => document.id)).toEqual([
      thirdId,
      firstId,
      secondId,
    ]);
    expect(store.getState().activeDocumentId).toBe(activeBefore);
    expect(store.getState().diff).toBe(diffBefore);

    store.getState().flushPersistence();
    expect(createStore().getState().documents.map((document) => document.id)).toEqual([
      thirdId,
      firstId,
      secondId,
    ]);
  });

  it('重排标签会归一化下标，同位或非法输入不触发持久化', () => {
    const store = createStore();
    const firstId = store.getState().activeDocumentId;
    const secondId = store.getState().newDocument('{}');
    const thirdId = store.getState().newDocument('[]');
    store.getState().flushPersistence();
    const callsBefore = storage.setItemCalls;

    expect(store.getState().reorderDocument(secondId, 1)).toBe(false);
    expect(store.getState().reorderDocument('missing', 0)).toBe(false);
    expect(store.getState().reorderDocument(secondId, Number.NaN)).toBe(false);
    expect(store.getState().reorderDocument(firstId, 99)).toBe(true);
    store.getState().flushPersistence();

    expect(store.getState().documents.map((document) => document.id)).toEqual([
      secondId,
      thirdId,
      firstId,
    ]);
    expect(storage.setItemCalls).toBe(callsBefore + 1);
  });

  it('hydrate 会校验活动标签和 Diff，并在坏文档列表下回退为空白文档', () => {
    const store = createStore();
    const existing = store.getState().documents[0];
    store.getState().hydrateWorkspace({
      documents: [{ ...existing, id: 'restored', title: 'restored.json' }],
      activeDocumentId: 'missing',
      diff: { leftId: 'restored', rightId: 'missing' },
      settings: { ...store.getState().settings, indent: 4 },
      recentFiles: [{ path: '/tmp/a.json', name: 'a.json', openedAt: 10 }],
    });

    expect(store.getState()).toMatchObject({
      activeDocumentId: 'restored',
      diff: null,
      settings: { indent: 4 },
      recentFiles: [{ path: '/tmp/a.json' }],
    });

    store.getState().hydrateWorkspace({
      documents: [] as JsonDocument[],
      activeDocumentId: 'restored',
      diff: null,
      settings: store.getState().settings,
      recentFiles: [],
    });
    expect(store.getState().documents).toHaveLength(1);
    expect(store.getState().documents[0].content).toBe('');
    expect(store.getState().activeDocumentId).toBe(store.getState().documents[0].id);
  });

  it('避免重复打开同一路径且保留当前未保存编辑', () => {
    const store = createStore();
    const openedId = store.getState().openDocument({
      title: 'data.json',
      filePath: '/data/data.json',
      content: '{"version":1}',
    });
    store.getState().updateContent(openedId, '{"version":2}');
    const reopenedId = store.getState().openDocument({
      title: 'data.json',
      filePath: '/data/data.json',
      content: '{"version":3}',
    });

    expect(reopenedId).toBe(openedId);
    expect(store.getState().documents.filter((document) => document.filePath)).toHaveLength(1);
    expect(store.getState().documents.find((document) => document.id === openedId)?.content).toBe(
      '{"version":2}',
    );
  });

  it('恢复文档、活动标签、Diff、设置和最近文件', () => {
    const original = createStore();
    const leftId = original.getState().activeDocumentId;
    original.getState().updateContent(leftId, '{"left":true}');
    const rightId = original.getState().newDocument('{"right":true}', 'right.json');
    original.getState().setDiff({ leftId, rightId });
    original.getState().updateSettings({ theme: 'dark', indent: 4 });
    original.getState().addRecentFile('C:\\data\\right.json', 'right.json');
    original.getState().flushPersistence();

    const restored = createStore().getState();
    expect(restored.documents).toHaveLength(2);
    expect(restored.activeDocumentId).toBe(rightId);
    expect(restored.diff).toEqual({ leftId, rightId });
    expect(restored.settings).toMatchObject({ theme: 'dark', indent: 4 });
    expect(restored.recentFiles[0]).toMatchObject({
      path: 'C:\\data\\right.json',
      name: 'right.json',
    });
  });

  it('迁移旧 view 且持久化只输出 collapsedPane 新字段', () => {
    storage.seed(
      WORKSPACE_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        documents: [
          rawDocument({ id: 'text-doc', view: 'text' }),
          rawDocument({ id: 'tree-doc', view: 'tree' }),
          rawDocument({ id: 'new-doc', collapsedPane: 'tree', view: 'text' }),
          rawDocument({ id: 'missing-doc' }),
          rawDocument({ id: 'invalid-doc', collapsedPane: 'invalid', view: 'text' }),
        ],
        activeDocumentId: 'text-doc',
        diff: null,
        settings: { structureWidth: 640, splitRatio: '0.7' },
        recentFiles: [],
      }),
    );

    const store = createStore();
    expect(store.getState().documents).toHaveLength(5);
    expect(store.getState().documents.map((document) => [document.id, document.collapsedPane])).toEqual([
      ['text-doc', 'tree'],
      ['tree-doc', 'text'],
      ['new-doc', 'tree'],
      ['missing-doc', 'none'],
      ['invalid-doc', 'none'],
    ]);
    expect(store.getState().settings.splitRatio).toBe(0.5);
    expect(store.getState().settings).not.toHaveProperty('structureWidth');

    store.getState().flushPersistence();
    const persisted = JSON.parse(storage.getItem(WORKSPACE_STORAGE_KEY) ?? '{}') as {
      documents: Array<Record<string, unknown>>;
      settings: Record<string, unknown>;
    };
    expect(persisted.documents).toHaveLength(5);
    expect(persisted.documents.every((document) => !('view' in document))).toBe(true);
    expect(persisted.documents.every((document) => 'collapsedPane' in document)).toBe(true);
    expect(persisted.settings).not.toHaveProperty('structureWidth');
  });

  it('hydrate 对缺失或非法折叠字段保留文档并落到 none', () => {
    const store = createStore();
    store.getState().hydrateWorkspace({
      documents: [
        rawDocument({ id: 'missing-both' }),
        rawDocument({ id: 'invalid-new', collapsedPane: 'sideways', view: 'tree' }),
      ],
      activeDocumentId: 'missing-both',
      diff: null,
      settings: store.getState().settings,
      recentFiles: [],
    } as never);

    expect(store.getState().documents).toHaveLength(2);
    expect(store.getState().documents.map((document) => document.collapsedPane)).toEqual([
      'none',
      'none',
    ]);
  });

  it('脏 splitRatio 被拒绝并回到默认值，合法越界值仍会钳制', () => {
    const store = createStore();
    store.getState().updateSettings({ splitRatio: '0.7' as never });
    expect(store.getState().settings.splitRatio).toBe(0.5);

    store.getState().updateSettings({ splitRatio: Number.NaN });
    expect(store.getState().settings.splitRatio).toBe(0.5);

    store.getState().updateSettings({ splitRatio: 1 });
    expect(store.getState().settings.splitRatio).toBe(0.8);
  });

  it('输入法兼容模式默认关闭，可切换，脏值被拒绝', () => {
    const store = createStore();
    expect(store.getState().settings.imeCompatMode).toBe(false);

    store.getState().updateSettings({ imeCompatMode: true });
    expect(store.getState().settings.imeCompatMode).toBe(true);

    // 非布尔值不能把这个开关改成脏状态：它决定编辑器高亮配置
    store.getState().updateSettings({ imeCompatMode: 'yes' as never });
    expect(store.getState().settings.imeCompatMode).toBe(true);
  });

  it('关闭会话恢复后不把文档内容写入 localStorage', () => {
    const store = createStore();
    const activeId = store.getState().activeDocumentId;
    store.getState().updateContent(activeId, 'private content');
    store.getState().updateSettings({ restoreSession: false });
    store.getState().flushPersistence();

    const persisted = JSON.parse(storage.getItem(WORKSPACE_STORAGE_KEY) ?? '{}') as Record<
      string,
      unknown
    >;
    expect(persisted).not.toHaveProperty('documents');

    const restored = createStore().getState();
    expect(restored.documents).toHaveLength(1);
    expect(restored.documents[0].content).toBe('');
    expect(restored.settings.restoreSession).toBe(false);
  });

  it('最近文件去重并限制为十项', () => {
    const store = createStore();
    for (let index = 0; index < 12; index++) {
      store.getState().addRecentFile(`/tmp/${index}.json`, `${index}.json`);
    }
    store.getState().addRecentFile('/tmp/5.json', 'renamed.json');

    expect(store.getState().recentFiles).toHaveLength(10);
    expect(store.getState().recentFiles[0]).toMatchObject({
      path: '/tmp/5.json',
      name: 'renamed.json',
    });
    expect(store.getState().recentFiles.filter((file) => file.path === '/tmp/5.json')).toHaveLength(
      1,
    );
  });

  it('合并高频变更并仅在调度任务或 flush 时序列化写入', () => {
    const store = createStore();
    const activeId = store.getState().activeDocumentId;

    store.getState().updateContent(activeId, '{"step":1}');
    store.getState().updateContent(activeId, '{"step":2}');
    store.getState().updateContent(activeId, '{"step":3}');

    expect(storage.setItemCalls).toBe(0);
    expect(scheduledTasks.filter((scheduled) => !scheduled.cancelled)).toHaveLength(1);

    scheduledTasks[0].task();

    expect(storage.setItemCalls).toBe(1);
    const persisted = JSON.parse(storage.getItem(WORKSPACE_STORAGE_KEY) ?? '{}') as {
      documents: Array<{ content: string }>;
    };
    expect(persisted.documents[0].content).toBe('{"step":3}');
  });

  it('会话超过 4 MiB 时写入不含文档的最新元数据并暴露状态', () => {
    const store = createStore();
    const activeId = store.getState().activeDocumentId;
    store.getState().updateSettings({ theme: 'dark' });
    store.getState().addRecentFile('/tmp/large.json', 'large.json');
    store
      .getState()
      .updateContent(activeId, 'x'.repeat(MAX_WORKSPACE_STORAGE_BYTES / 2));
    store.getState().flushPersistence();

    const persisted = JSON.parse(storage.getItem(WORKSPACE_STORAGE_KEY) ?? '{}') as Record<
      string,
      unknown
    >;
    expect(persisted).not.toHaveProperty('documents');
    expect(persisted.documentsOmitted).toBe(true);
    expect(store.getState().persistenceIssue).toMatchObject({
      code: 'size-limit',
      documentsOmitted: true,
      metadataPersisted: true,
    });

    const restored = createStore().getState();
    expect(restored.documents[0].content).toBe('');
    expect(restored.settings.theme).toBe('dark');
    expect(restored.recentFiles[0]).toMatchObject({ path: '/tmp/large.json' });
    expect(restored.persistenceIssue?.code).toBe('size-limit');
  });

  it('存储配额拒绝文档快照时用无文档 fallback 覆盖旧快照', () => {
    class QuotaStorage extends MemoryStorage {
      override setItem(key: string, value: string): void {
        const parsed = JSON.parse(value) as { documents?: unknown };
        if (parsed.documents) throw new DOMException('Quota exceeded', 'QuotaExceededError');
        super.setItem(key, value);
      }
    }

    const quotaStorage = new QuotaStorage();
    quotaStorage.seed(
      WORKSPACE_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        documents: [{ content: 'stale snapshot' }],
        settings: {},
        recentFiles: [],
      }),
    );
    const store = createStore(quotaStorage);
    store.getState().updateSettings({ indent: 4 });
    store.getState().flushPersistence();

    const persisted = JSON.parse(quotaStorage.getItem(WORKSPACE_STORAGE_KEY) ?? '{}') as Record<
      string,
      unknown
    >;
    expect(persisted).not.toHaveProperty('documents');
    expect(persisted.documentsOmitted).toBe(true);
    expect(store.getState().persistenceIssue).toMatchObject({
      code: 'storage-error',
      metadataPersisted: true,
    });
  });

  it('完整快照和 fallback 都写入失败时删除旧快照并报告元数据未保存', () => {
    class FailingStorage extends MemoryStorage {
      override setItem(): void {
        throw new DOMException('Quota exceeded', 'QuotaExceededError');
      }
    }

    const failingStorage = new FailingStorage();
    failingStorage.seed(WORKSPACE_STORAGE_KEY, '{"version":1,"stale":true}');
    const store = createStore(failingStorage);
    store.getState().updateSettings({ theme: 'light' });
    store.getState().flushPersistence();

    expect(failingStorage.getItem(WORKSPACE_STORAGE_KEY)).toBeNull();
    expect(failingStorage.removeItemCalls).toBe(1);
    expect(store.getState().persistenceIssue).toMatchObject({
      code: 'storage-error',
      documentsOmitted: true,
      metadataPersisted: false,
    });
  });

  it('history 最多保留二十条并按最新记录在前', () => {
    const store = createStore();
    for (let index = 0; index < MAX_HISTORY_RECORDS + 3; index++) {
      store.getState().addHistoryRecord({
        documentId: 'doc',
        documentTitle: 'data.json',
        operation: 'format',
        operationLabel: '格式化',
        content: '{}',
        bytes: 2,
      });
    }
    expect(store.getState().history).toHaveLength(MAX_HISTORY_RECORDS);
    expect(store.getState().history[0].createdAt).toBeGreaterThan(store.getState().history.at(-1)!.createdAt);
  });

  it('超出 history 快照阈值时保留元数据但不保存内容', () => {
    const store = createStore();
    const content = 'x'.repeat(MAX_HISTORY_SNAPSHOT_BYTES + 1);
    store.getState().addHistoryRecord({
      documentId: 'doc',
      documentTitle: 'large.json',
      operation: 'repair',
      operationLabel: '修复',
      content,
      bytes: content.length,
    });
    expect(store.getState().history[0]).toMatchObject({ content: null, bytes: content.length });
  });

  it('history 不写入 localStorage 持久化白名单', () => {
    const store = createStore();
    store.getState().addHistoryRecord({
      documentId: 'doc',
      documentTitle: 'data.json',
      operation: 'format',
      operationLabel: '格式化',
      content: '{}',
      bytes: 2,
    });
    store.getState().flushPersistence();
    const persisted = JSON.parse(storage.getItem(WORKSPACE_STORAGE_KEY) ?? '{}') as Record<string, unknown>;
    expect(persisted).not.toHaveProperty('history');
  });
});
