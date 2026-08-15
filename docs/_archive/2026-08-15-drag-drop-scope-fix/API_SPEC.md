# API_SPEC.md — 本次改动涉及的接口

## 1. 新增 Tauri 命令：`allow_dropped_paths`

落点：`src-tauri/src/lib.rs`（或新建 `src-tauri/src/drop_scope.rs` 并在 `lib.rs` 注册），
需 `use tauri_plugin_fs::FsExt;`。

```rust
// 语义伪码，不是实现
#[tauri::command]
fn allow_dropped_paths(app: tauri::AppHandle, paths: Vec<String>) -> Result<Vec<String>, String>
```

| 项 | 约定 |
|----|------|
| 入参 | `paths`：拖入的绝对路径；序列化为 camelCase 不影响单参数名，前端传 `{ paths }` |
| 上限 | 超过 64 条直接 `Err`（不静默截断） |
| 逐条校验 | `std::fs::metadata(path)` 成功且 `is_file()`；扩展名不区分大小写等于 `json` |
| 放行 | 校验通过则 `app.fs_scope().allow_file(&path)`（等价 dialog 插件对选中文件做的事，读写共用该 scope） |
| 返回 | 实际放行成功的路径数组，顺序与入参一致 |
| 跳过 | 校验不通过的路径静默跳过：不放行、不计入返回值、不报错 |
| 空入参 | 返回空数组，不报错 |
| 错误 | `allow_file` 返回 `Err` 时整体 `Err(String)`，错误信息带上失败路径 |
| 目录 | 一律不放行（不调 `allow_directory`） |
| ACL | 应用自有命令沿用 `session::load_workspace_session` 现状，无需在 `capabilities/default.json` 追加条目 |

单元测试（Rust）：`is_file` + 扩展名校验、超限报错、目录被拒。scope 放行本身依赖 `AppHandle`，可只覆盖纯校验函数
（把校验拆成不依赖 `AppHandle` 的 `fn filter_droppable(paths) -> Result<Vec<PathBuf>, String>`）。

## 2. 变更：`listenForJsonDrops`（`src/services/platform.ts`）

```ts
// 现状
export async function listenForJsonDrops(
  handler: (files: OpenedJsonFile[]) => void,
): Promise<() => void>

// 目标
export async function listenForJsonDrops(
  handler: (files: OpenedJsonFile[]) => void,
  onError?: (error: unknown) => void,
): Promise<() => void>
```

Tauri 分支流程（浏览器分支不变）：

1. `event.payload.type === 'drop'` 之外的类型直接返回。
2. 过滤 `.json`（不区分大小写），空则返回。
3. `await invoke<string[]>('allow_dropped_paths', { paths })`
   —— 沿用仓库既有写法 `const { invoke } = await import('@tauri-apps/api/core')`。
4. 对**放行成功**的路径逐个 `readTextFile`，组装 `OpenedJsonFile`（`filePath` 保留真实路径）。
5. 整段包 `try/catch`，失败调 `onError(error)`；`handler` 只在有文件时调用一次。
6. 放行结果为空但入参非空时，也走 `onError`（提示用户该文件无法读取），避免再次静默。

## 3. 调用侧：`src/App.tsx`

`listenForJsonDrops(acceptOpenedFiles)` → 追加第二参数，把错误转成现有 toast：
`(error) => showToast(error instanceof Error ? error.message : '无法读取拖入的文件', 'error')`。
`.catch(...)` 分支保持不变。

## 4. 不变的契约

- `AppHeader` props 签名不变，`onReorderDocument(id, targetIndex)` 的索引语义与现状一致
  （沿用 `docs/2026-08-11-tab-tree-hot-exit/API_SPEC.md`：组件只报告最终落点，拖动期间不改 store）。
- `OpenedJsonFile` / `openJsonFiles` / `readJsonPath` / `saveJsonFile` 签名不变。
- `tauri.conf.json` 的 `dragDropEnabled` 保持默认（不显式写入 `false`）。
