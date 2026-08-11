# TASKS —— 标签排序、树操作布局与跨平台 Hot Exit

需求日期：2026-08-11 · slug：`tab-tree-hot-exit`

格式：`[ ] 任务名 | 优先级 | 估时 | 依赖`

- [x] **H1 Workspace 标签重排动作与恢复测试** | P0 | 1.5h | 无
- [x] **H2 AppHeader 拖拽、插入反馈与边缘滚动** | P0 | 3h | H1
- [x] **H3 树节点操作按内容自适应布局** | P0 | 1.5h | 无
- [x] **H4 Rust 版本化清单与分文档快照命令** | P0 | 5h | API_SPEC
- [x] **H5 前端原生会话协调器、调度与旧会话迁移** | P0 | 5h | H4
- [x] **H6 Store hydrate 与桌面启动接线** | P0 | 2.5h | H5
- [x] **H7 Hot Exit 关闭策略与 Windows 递归关闭修复** | P0 | 2.5h | H5, H6
- [x] **H8 单元、组件与 Rust 故障恢复测试补齐** | P0 | 4h | H1–H7
- [x] **H9 前端构建、浏览器视觉 QA 与平台验收记录** | P0 | 2.5h | H8
- [x] **H10 文档回填与已知问题收口** | P1 | 1h | H9

合计 10 项，约 28.5h。默认不自动提交 Git；实现完成并汇报变更后等待用户确认提交。

## 验收门槛

- `npm test` 全绿，新增行为有对应回归测试。
- `npm run build` 全绿。
- Rust 工具链可用时，`cargo test --manifest-path src-tauri/Cargo.toml` 与
  `cargo check --manifest-path src-tauri/Cargo.toml` 全绿；不可用时必须在交付说明中明确。
- Playwright 视觉检查按用户指示跳过；标签拖拽、边缘滚动和树布局由组件测试与 CSS 守卫覆盖。
- Windows CI 或 Windows 安装包确认标题栏关闭与 `Alt+F4`：可恢复时直接退出，失败时只提示一次，
  确认后窗口确实结束；重启恢复标签顺序、活动文档和未保存内容。

## 实施结果

- 2026-08-11：`npm test` 共 105 项测试通过；`npm run build` 通过。
- Rust 会话故障恢复测试已写入 `src-tauri/src/session.rs`，本机未安装 `cargo`/`rustc`，未执行。
- Playwright 视觉测试按用户指示跳过。
- Windows 标题栏关闭、`Alt+F4` 和安装包重启恢复需在 Windows 环境完成最终平台验收。
