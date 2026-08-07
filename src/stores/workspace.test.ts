import { beforeEach, describe, expect, it } from 'vitest';
import {
  createWorkspaceStore,
  isDocumentDirty,
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
});
