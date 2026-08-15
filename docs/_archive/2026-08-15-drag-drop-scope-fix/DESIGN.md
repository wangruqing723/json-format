# DESIGN.md — 打包版拖拽失效修复

## 1. 现象

- 安装版（macOS / Windows）里标签拖不动、拖入 `.json` 文件也没反应；`npm run dev` 的浏览器里两者都正常。
- 关于弹窗版本号写死 `0.1.0`（已单独修完并验证，不在本次委托范围）。

## 2. 根因（已逐条核对上游源码）

### 2.1 页面内 HTML5 拖放被 wry 吞掉 → 标签重排失效

- `src-tauri/tauri.conf.json` 未设 `dragDropEnabled`，默认为 `true`
  （`tauri-utils/src/config.rs`：`#[serde(default = "default_true")] pub drag_drop_enabled`，
  注释原文 "Disabling it is required to use HTML5 drag and drop on the frontend on Windows
  since we replace the drag drop handler of WebView2"）。
- macOS：wry `src/wkwebview/drag_drop.rs` 覆写 `dragging_entered` / `dragging_updated` /
  `perform_drag_operation`，只有 handler 返回 `false` 时才 `msg_send![super(this), ...]` 把拖放交还 WebKit。
- Windows：wry `src/webview2/mod.rs` 创建 `DragDropController` 时调 `SetAllowExternalDrop(false)`
  并注册自己的 IDropTarget。
- `tauri-runtime-wry/src/lib.rs` 的 `with_drag_drop_handler` 闭包**恒返回 `true`**，
  内部拖动（`paths` 为空）也一样被消费 → 页面永远收不到 `dragover` / `drop`。
- 上游对应 issue：tauri#14373（macOS 同样被屏蔽，文档只写 Windows 属描述不准）、
  tauri#15138（Windows 内部拖动出现禁止光标）。
- 结论：`AppHeader` 现有 `draggable` + `dragstart/dragover/drop` 方案在任何打包平台都不可能生效，
  浏览器 dev 下没有 wry 这一层，所以能拖。

### 2.2 拖入路径不在 fs scope → 拖入打开静默失败

- `src-tauri/capabilities/default.json` 只给了 `fs:allow-read-text-file` / `fs:allow-write-text-file`，
  **没有任何 scope 条目**。
- fs 插件 `commands.rs` 的 `resolve_path` 把 global scope 与 command scope 合并后校验，未命中即 `PathForbidden`。
- dialog 插件在用户选中文件后会调 `window.try_fs_scope()` → `allow_file(&path)`，
  所以「打开文件」正常；拖入的路径没有任何环节放行。
- 失败点在 `src/services/platform.ts:217` 的 async 回调里，异常无人 catch → 界面零提示。
- 读、写共用同一套 scope 校验，所以即便读通了，对拖入文件按 Ctrl/⌘ S 原地保存也会被拒。

## 3. 方案

保留 `dragDropEnabled: true`（拖入必须拿到真实路径：原地保存、最近文件、persisted-scope 复用），两条线并行：

- **标签重排改 Pointer Events**：不再依赖 HTML5 DnD，绕开 wry 拦截，观感与现状一致（阈值、插入线、边缘滚动）。
- **拖入路径显式放行**：新增 Rust 命令，把拖入的 `.json` 路径加入 fs scope（与 dialog 插件同样的动作），
  前端读文件前先 `await`；失败要弹 toast，不再静默。

不做：改 `dragDropEnabled`；键盘重排（沿用旧 KNOWN_ISSUES 记录）；引入拖拽库；动 tree / table / diff 视图。

## 4. 标签重排交互契约（Pointer Events）

沿用 `docs/2026-08-11-tab-tree-hot-exit/DESIGN.md` 定下的观感，只换底层事件：

| 环节 | 约定 |
|------|------|
| 起手 | `pointerdown` 落在 `.tab-select` 且 `event.button === 0` 才记录起点；关闭按钮上按下不进入拖动 |
| 阈值 | 水平位移 `> 4px` 才进入拖动；未超阈值的 `pointerup` 仍是普通点击（切换文档） |
| 拖动中 | 被拖标签 `.document-tab.is-dragging`；落点标签 `.drop-before` / `.drop-after`（CSS 类名与样式不变） |
| 命中测试 | 遍历 `.tabs-scroll` 内各 `.document-tab` 的 rect 做**水平**命中；指针在最后一个标签右侧空白 → 末尾 `after` |
| 边缘滚动 | 复用现有 `runAutoScroll`（边缘 `min(48, rect.width/3)`、速度上限 ±12、`requestAnimationFrame` 驱动） |
| 落定 | 只在 `pointerup` 调一次 `onReorderDocument(id, targetIndex)`；拖动期间不动 store（沿用旧 API_SPEC 约定） |
| 取消 | `Esc` 或 `pointercancel` → 清理状态且不回调 |
| 点击抑制 | 发生过拖动后要抑制紧随的 `click`，避免顺带切换活动文档 |
| 监听方式 | `pointerdown` 用 React prop；`pointermove` / `pointerup` / `pointercancel` / `keydown` 用 window 级监听（进入拖动时挂载、结束卸载） |
| 禁用项 | 移除 `.tab-select` 的 `draggable` 与 `dragstart/dragend/dragover/drop` 分支；`.tab-select` 加 `touch-action: none`，拖动中禁用文本选中 |

**不要用 `setPointerCapture`**：jsdom 未实现（见 §5），浏览器侧用 window 监听已足够。

## 5. 已实测的环境约束

- jsdom 25.0.1 **无 `PointerEvent`、无 `Element.prototype.setPointerCapture`**。
  实测 `fireEvent.pointerDown(el, { clientX: 12 })` 进到 React 回调后 `clientX` 为 `undefined`
  （testing-library 回退到 `window.Event`）。
- 可行写法（实测通过，`clientX` 正确传递）：
  `fireEvent(el, new MouseEvent('pointerdown', { clientX: 12, button: 0, bubbles: true }))`，
  window 上的 `pointermove` / `pointerup` 同法；`pointerId` 拿不到，实现不得依赖它。
- rect 一律靠覆写 `getBoundingClientRect` 注入（沿用 `components.test.tsx` 现有写法）。
- 本机无 `rustc` / `cargo`（`KNOWN_ISSUES.md` 已记录）→ Rust 改动只能靠
  `.github/workflows/release.yml` 的 desktop job（`workflow_dispatch`）或用户装 Rust 后 `cargo check` 验证。

## 6. 风险

- Pointer Events 重写会碰到标签栏所有交互路径：点击选中、关闭按钮、边缘滚动都要回归到位。
- `allow_dropped_paths` 是**可从前端调用的 scope 放大原语**，必须在 Rust 侧校验（存在 + 是文件 + `.json` +
  条数上限），只放行具体文件、不放目录。
- 放行结果会被 `tauri-plugin-persisted-scope` 持久化：这是预期收益（重启后最近文件可读），
  但意味着 scope 会随使用累积增长。

