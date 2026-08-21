# JSON Forge

JSON Forge 是一款面向 macOS 和 Windows 的轻量 JSON 工作台。它使用 Tauri 2 与系统 WebView，核心解析和转换在本机完成，不需要登录，也不会把文档上传到远程服务。

## 功能

- 多标签 JSON 编辑，会话恢复与未保存状态提示
- JSON 校验、错误行列定位、格式化、压缩和递归键排序
- 确定性格式修复、字符串转义与反转义
- 去除字符串内的换行转义，接回被终端或日志硬折断的长行
- 文本、树形和双栏 Diff 视图
- 本地文件打开、拖放、保存、最近文件与剪贴板操作
- 明暗主题、命令面板和完整键盘工作流
- Web Worker 后台处理，避免大文档转换阻塞界面

## 开发

需要 Node.js 24+、npm、Rust stable 和 Tauri 2 对应的平台工具链。仓库提供 `.nvmrc`，使用 nvm 时可执行 `nvm use` 切换到项目版本。

- macOS：安装 Xcode Command Line Tools。
- Windows：安装 Microsoft C++ Build Tools 与 WebView2 Runtime，并使用 Rust MSVC 工具链。

安装依赖并启动桌面开发环境：

```bash
npm ci
npm run tauri dev
```

只启动浏览器开发环境：

```bash
npm run dev
```

运行测试和前端生产构建：

```bash
npm test
npm run build
```

## 构建安装包

在对应操作系统执行：

```bash
# macOS: Intel + Apple Silicon 通用 .app 与 .dmg
rustup target add aarch64-apple-darwin x86_64-apple-darwin
npm run tauri -- build --bundles app,dmg --target universal-apple-darwin

# Windows: .msi 与 NSIS .exe
npm run tauri -- build --bundles msi,nsis
```

GitHub Actions 的 `CI and desktop installers` 工作流会在普通推送和拉取请求中运行前端测试与构建。推送到 `main`、推送版本标签（`v*`）或手动触发时，前端校验通过后还会在每个平台再次运行测试，再并行构建 macOS 通用包与 Windows x64 产物并保留 14 天。macOS 的 `.app` 会封装成保留权限和资源分支的 `.app.zip` 后上传。

推送 `v*` 标签时会额外运行 `Publish GitHub release`：等两个平台都构建成功后，下载全部产物并创建同名 GitHub Release，把 `.dmg`、`.app.zip`、`.msi` 和 NSIS `.exe` 作为附件挂上。发布版本前需确保标签与 `package.json`、`src-tauri/tauri.conf.json` 及 `src-tauri/Cargo.toml` 中的版本号一致：

```bash
git tag v0.1.0
git push origin v0.1.0
```

## 快捷键

| 操作 | macOS | Windows |
| --- | --- | --- |
| 新建 | `Cmd+N` | `Ctrl+N` |
| 打开 | `Cmd+O` | `Ctrl+O` |
| 保存 | `Cmd+S` | `Ctrl+S` |
| 格式化 | `Shift+Option+F` | `Shift+Alt+F` |
| 查找 | `Cmd+F` | `Ctrl+F` |
| 命令面板 | `Cmd+K` | `Ctrl+K` |
| 关闭标签 | `Cmd+W` | `Ctrl+W` |

编辑器原生支持撤销、重做、选择和复制等系统快捷键。按钮的 tooltip 和命令面板会显示当前平台对应的快捷键。

## 离线与隐私

JSON 解析、格式化、修复、树形展示和 Diff 均在本机执行。应用不包含遥测、账号、云同步、在线 AI、自动更新器或业务网络请求。Tauri capability 只授予主窗口以下权限：

- 选择文件及保存位置
- 读取和写入用户明确选择的文本文件
- 写入文本剪贴板
- 在系统文件管理器中定位本地文件

应用未启用 shell，也未授予打开 URL 的权限。内容和会话数据可能按设置保存在本机 WebView 存储中；处理敏感数据前，可关闭会话恢复并清除本地应用数据。

为使“最近文件”在重启后仍可打开，应用只持久化系统文件对话框已授予的文件 scope，不会因此获得同目录或整个主目录的读取权限。清除本地应用数据也会移除这些已保存的 scope。

## 浏览器降级

`npm run dev` 和 `npm run preview` 可以在普通浏览器中运行核心编辑、校验与转换功能。浏览器环境没有 Tauri 原生能力，因此系统文件对话框和最近文件路径复用等能力会隐藏或使用浏览器可用的文件选择与下载方式；浏览器自身的安全策略仍然适用。

## 签名与分发

仓库和 CI 默认生成未签名测试包。macOS 可能显示 Gatekeeper 警告，Windows 可能显示 SmartScreen 警告；这些产物不应直接作为正式公开发行版本。

正式发布前需要分别配置 Apple Developer ID 签名与公证，以及 Windows Authenticode 代码签名。证书、私钥和密码必须放在 CI 的加密 Secret 或受控签名服务中，不能写入仓库。签名配置完成后，还应在干净的 macOS 和 Windows 环境验证安装、升级、卸载和签名状态。

## 已知构建验证项

当前仓库还没有 `src-tauri/Cargo.lock`，本机环境也没有可用的 Rust 工具链，因此尚未完成 Cargo 依赖锁定与 Rust 编译验证。安装 Rust stable 后应运行：

```bash
cargo generate-lockfile --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
```

详情见 [KNOWN_ISSUES.md](KNOWN_ISSUES.md)。
