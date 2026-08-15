# TASKS.md — 打包版拖拽失效修复

格式：`[ ] 任务名 | 优先级 | 估时 | 依赖`

## 任务

- [x] **T1 新增 Rust 命令 `allow_dropped_paths` 并注册** | P0 | 1h | —
  - 落点：`src-tauri/src/lib.rs`（校验逻辑可拆到 `src-tauri/src/drop_scope.rs`）
  - 契约见 `API_SPEC.md` §1：条数上限 64、`is_file` + `.json` 校验、`app.fs_scope().allow_file()`、返回放行成功路径
  - 附 Rust 单测覆盖纯校验函数（扩展名、目录、超限）

- [x] **T2 `platform.ts` 拖入分支接入放行与错误出口** | P0 | 1h | T1
  - `listenForJsonDrops` 增加 `onError?` 参数（`API_SPEC.md` §2）
  - Tauri 分支：过滤 `.json` → `invoke('allow_dropped_paths')` → 只读放行成功的路径 → try/catch 走 `onError`
  - 浏览器分支行为不变

- [x] **T3 `App.tsx` 把拖入错误接到 toast** | P0 | 0.5h | T2
  - `listenForJsonDrops(acceptOpenedFiles, (error) => showToast(...))`，现有 `.catch` 保留

- [x] **T4 `AppHeader` 标签重排改 Pointer Events** | P0 | 3h | —
  - 按 `DESIGN.md` §4 全表实现：4px 阈值、window 级 move/up/cancel/Esc 监听、rect 水平命中、
    末尾空白落到最后、`.is-dragging` / `.drop-before` / `.drop-after` 不变、拖后抑制 click
  - 删除 `draggable` 与 `dragstart/dragend/dragover/drop` 分支；**不要用 `setPointerCapture`**
  - 复用现有 `runAutoScroll` / `stopAutoScroll` 逻辑与阈值

- [x] **T5 改写并补齐测试** | P0 | 2h | T2, T4
  - `src/components/components.test.tsx` 的 4 个 AppHeader 拖拽用例改用
    `fireEvent(el, new MouseEvent('pointerdown'/'pointermove'/'pointerup', { clientX, button: 0, bubbles: true }))`
    （`DESIGN.md` §5 已实测；`pointerId` 不可用）
  - 新增用例：未超阈值时 `pointerup` 仍触发 `onSelectDocument`；拖动后 click 被抑制；Esc 取消
  - `src/services/platform.test.ts` 新增：拖入分支调用 `allow_dropped_paths`、只读放行路径、放行为空时走 `onError`
    （用注入/mock 的 `invoke` 与 `readTextFile`，不要真连 Tauri）

- [x] **T6 `styles.css` 配套** | P1 | 0.5h | T4
  - `.tab-select` 加 `touch-action: none`；拖动态禁用文本选中；确认 `.drop-before/.drop-after/.is-dragging` 样式无需改动

- [x] **T7 收尾文档** | P1 | 0.5h | T1–T6
  - 本目录 `KNOWN_ISSUES.md` 记录：Rust 侧本机无 cargo 未编译验证，需 CI desktop job 或用户 `cargo check`
  - 若实现中发现设计问题，同样记入 `KNOWN_ISSUES.md`，不擅自改架构

## 验收标准

1. `npm test` 全绿（含改写后的 AppHeader 拖拽用例与新增 platform 用例）。
2. `npm run build` 通过（`tsc -b` 无类型错误）。
3. 代码层面可核对：`AppHeader` 内不再有 HTML5 DnD 事件；`platform.ts` 读文件前必定 `await` 放行命令；
   `tauri.conf.json` 未新增 `dragDropEnabled`。
4. Rust 侧：本机无 cargo，**不要求**编译通过；但不得留下明显编译错误（借用、`?` 与返回类型、`use` 完整），
   并在 `KNOWN_ISSUES.md` 注明待 CI 验证。
5. 不自动 `git commit`，改动留在工作区等用户拍板。

## 范围外（本次不做）

- 关于弹窗版本号（已修完并验证：`vite.config.ts` 注入 `__APP_VERSION__`，`AboutDialog` 读取，附回归测试）。
- `dragDropEnabled: false` 路线、键盘重排、拖拽库、tree/table/diff 视图的拖拽。
