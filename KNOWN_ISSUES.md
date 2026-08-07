# 已知问题

## [2026-08-07] Cargo.lock 尚未生成
- 发现于:桌面构建 / `src-tauri/Cargo.toml`
- 问题描述:仓库当前缺少 `src-tauri/Cargo.lock`；本机未安装 `rustc` 和 `cargo`，无法解析并锁定 Cargo 依赖版本，也未执行 Rust 编译验证。
- 建议:安装 Rust stable 后运行 `cargo generate-lockfile --manifest-path src-tauri/Cargo.toml`，检查生成结果并纳入版本控制；随后运行 `cargo check --manifest-path src-tauri/Cargo.toml` 验证原生依赖和 capability。
- 状态:待 Codex 决策
