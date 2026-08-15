## [2026-08-15] Rust 侧未在本机编译验证
- 发现于: T1 / `src-tauri/src/drop_scope.rs`
- 问题描述: 当前环境没有 `rustc` / `cargo`，因此无法执行 Rust 单元测试或 `cargo check`。
- 建议: 由 CI 的 `.github/workflows/release.yml` desktop job，或安装 Rust 后手动执行 `cargo check` 与测试。
- 状态: 待 CI 验证
