# API_SPEC —— 标签排序与原生会话

本文件固定实现方必须遵守的接口形状。字段命名通过 Serde `camelCase` 与 TypeScript 对齐。

## 1. Workspace store

```ts
interface WorkspaceStore {
  reorderDocument(id: DocumentId, targetIndex: number): boolean;
  hydrateWorkspace(snapshot: PersistedWorkspaceSnapshot): void;
}

interface PersistedWorkspaceSnapshot {
  documents: JsonDocument[];
  activeDocumentId: DocumentId;
  diff: WorkspaceState['diff'];
  settings: AppSettings;
  recentFiles: RecentFile[];
}
```

`reorderDocument` 的 `targetIndex` 表示源文档已经移除后的插入下标，范围归一化到
`0..documents.length - 1`。无有效变化返回 `false`。

`hydrateWorkspace` 必须经过既有 sanitize 规则；空/坏文档列表回退为一个空白文档，非法活动 id 和 Diff 引用回退。

## 2. AppHeader

```ts
interface AppHeaderProps {
  // existing props omitted
  onReorderDocument: (id: DocumentId, targetIndex: number) => void;
}
```

组件只报告最终 drop，不在 dragover 期间修改 store。

## 3. 原生持久化数据

```ts
interface NativeSessionManifestInput {
  version: 1;
  documents: NativeSessionDocumentEntry[];
  activeDocumentId: DocumentId | null;
  diff: WorkspaceState['diff'];
  settings: AppSettings;
  recentFiles: RecentFile[];
}

interface NativeSessionDocumentEntry {
  id: DocumentId;
  title: string;
  filePath: string | null;
  view: DocumentView;
  language: 'json';
  createdAt: number;
  updatedAt: number;
  snapshotId: string;
}

interface NativeSessionDocumentSnapshot {
  documentId: DocumentId;
  snapshotId: string;
  content: string;
  savedContent: string;
}

interface CommitWorkspaceSessionRequest {
  manifest: NativeSessionManifestInput;
  changedDocuments: NativeSessionDocumentSnapshot[];
}

interface NativeSessionLoadResult {
  generation: number;
  workspace: PersistedWorkspaceSnapshot;
  snapshotIds: Record<DocumentId, string>;
}

interface CommitWorkspaceSessionResult {
  generation: number;
}
```

当 `settings.restoreSession === false` 时，提交清单的 `documents` 必须为空、
`activeDocumentId` 与 `diff` 必须为 `null`；设置和最近文件仍可保存。

## 4. Tauri commands

```ts
import { invoke } from '@tauri-apps/api/core';

invoke<NativeSessionLoadResult | null>('load_workspace_session');

invoke<CommitWorkspaceSessionResult>('commit_workspace_session', {
  request: CommitWorkspaceSessionRequest,
});
```

错误通过 rejected Promise 返回稳定、可展示但不包含绝对应用数据路径的中文消息。

### `load_workspace_session`

- 从高到低扫描 generation。
- 只返回第一份可解析、版本受支持且全部文档快照存在的清单。
- 没有任何清单返回 `null`，不是错误。
- 存在文件但没有完整清单时返回错误，前端不得把它误判为“首次启动”并覆盖旧数据。

### `commit_workspace_session`

- 命令串行执行。
- `changedDocuments` 中每项必须被 manifest 以相同 `(documentId, snapshotId)` 引用。
- manifest 的每个引用必须由本请求写入或已经存在。
- 发布清单成功才算提交成功；孤儿清理失败只记录后端日志。
- 返回实际发布的 generation，由后端生成，前端不得自行猜测。

## 5. 会话协调器

```ts
interface SessionFlushResult {
  ok: boolean;
  recoverable: boolean;
  error?: string;
}

interface NativeSessionController {
  restore(): Promise<NativeSessionLoadResult | null>;
  schedule(snapshot: PersistedWorkspaceSnapshot): void;
  flush(snapshot: PersistedWorkspaceSnapshot): Promise<SessionFlushResult>;
  dispose(): void;
}
```

- `recoverable` 只有在 `settings.restoreSession === true` 且最新 snapshot 已完整提交时为 `true`。
- 多次 `flush` 必须复用或串行等待同一个 in-flight 提交，不能并发发布 generation。
- `dispose` 只清理计时器和监听器，不丢弃已经开始的 Promise；正常退出必须先 await `flush`。

## 6. 标识符约束

Rust 后端只接受 ASCII 字母、数字、`-`、`_`，长度 1–128 的 document id 与 snapshot id。
前端 snapshot id 使用 `crypto.randomUUID()`；旧 document id 不满足规则时，迁移阶段重新映射 id，
并同步修正活动文档与 Diff 引用。
