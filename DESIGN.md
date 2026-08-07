# JSON Forge 设计方案

## 1. 产品定位

JSON Forge 是面向开发者、测试人员和数据分析人员的本地 JSON 工作台。核心原则是：启动即用、数据不出本机、高频操作一步可达、错误能够精确定位、跨 macOS 与 Windows 保持一致体验。

参考产品中值得保留的模式：多标签、紧凑工具栏、文本/树/表格视图、错误定位、Diff、转义解析、主题设置。首版不复制在线分享、登录和占据主流程的 AI 面板，以降低体积、依赖与隐私成本。

## 2. 技术方案

| 层级 | 选择 | 原因 |
| --- | --- | --- |
| 桌面容器 | Tauri 2 | 使用系统 WebView，安装包和内存占用通常低于 Electron；官方支持 macOS/Windows |
| 前端 | React + TypeScript + Vite | 组件生态成熟，开发与测试链路清晰 |
| 编辑器 | CodeMirror 6 | 模块化、按需加载，比完整 Monaco 更适合轻量目标 |
| 图标 | Lucide React | 统一线性图标，避免自绘和字符图标 |
| 状态 | Zustand + 明确的领域函数 | 适合多标签和设置状态，避免大型状态框架 |
| 处理引擎 | TypeScript Web Worker；必要时下沉 Rust | 先消除主线程阻塞；文件 I/O 由 Tauri 负责，避免无依据的原生化 |
| JSON 修复 | `jsonrepair` | 成熟的确定性修复，不依赖云端 AI |
| 测试 | Vitest + Testing Library + Playwright CLI | 分别覆盖纯逻辑、组件交互和真实浏览器工作流 |
| 发布 | Tauri bundler + GitHub Actions matrix | 在对应系统生成签名前安装包 |

## 3. 信息架构

```text
应用窗口
├── 顶栏：品牌、当前文件、全局搜索、主题、设置
├── 标签栏：文档标签、新建、关闭、脏状态
├── 主工具栏：打开、保存、格式化、压缩、排序、修复、复制、更多
├── 工作区
│   ├── 文本视图：CodeMirror 编辑器
│   ├── 树形视图：可折叠节点、JSONPath、复制值/路径
│   └── Diff 视图：左右文档、同步滚动、差异摘要
└── 状态栏：有效性、行列、大小、节点数、缩进、编码、处理耗时
```

窗口宽度不足时，低频工具进入“更多”菜单；核心操作保持可见。窄窗口不尝试把完整桌面编辑器压缩成多栏，而是使用单栏视图和可横向滚动的标签条。

## 4. 视觉方向

- 工作台风格安静、紧凑、以内容为中心，不使用营销式 Hero、大面积插画或装饰性渐变。
- 圆角限制在 4-6px，边框表达层级，避免卡片嵌套。
- 主色采用中性石墨色；成功/有效状态使用绿色，选中与焦点使用蓝色，警告使用琥珀色，错误使用红色。语法颜色覆盖蓝、青、绿、橙，避免单一色相。
- UI 字体优先系统字体；代码区域使用 `JetBrains Mono` 的本地回退链，不强制联网下载字体。
- 工具按钮优先图标并提供 tooltip 与 `aria-label`；只有“格式化”等核心命令保留图标加文字。
- 动画仅用于 120-200ms 的颜色、透明度和面板切换，并尊重减少动态效果设置。

## 5. 核心领域模型

```ts
type DocumentId = string;

interface JsonDocument {
  id: DocumentId;
  title: string;
  filePath: string | null;
  content: string;
  savedContent: string;
  view: 'text' | 'tree';
  language: 'json';
  createdAt: number;
  updatedAt: number;
}

interface WorkspaceState {
  documents: JsonDocument[];
  activeDocumentId: DocumentId;
  diff: { leftId: DocumentId; rightId: DocumentId } | null;
  settings: AppSettings;
}

interface AppSettings {
  theme: 'system' | 'light' | 'dark';
  indent: 2 | 4 | 'tab';
  sortKeys: boolean;
  restoreSession: boolean;
}

type WorkerRequest = {
  requestId: string;
  operation: 'validate' | 'format' | 'minify' | 'sort' | 'repair' | 'escape' | 'unescape' | 'stats';
  source: string;
  options?: Record<string, unknown>;
};

type WorkerResponse =
  | { requestId: string; ok: true; result: string; meta: ProcessingMeta }
  | { requestId: string; ok: false; error: JsonDiagnostic };
```

`savedContent !== content` 是唯一脏状态判断依据。任何变换都通过 CodeMirror transaction 写回，因此保留原生撤销/重做语义。

## 6. 数据流与安全边界

```text
文件/粘贴/输入
      ↓
文档状态 ↔ CodeMirror
      ↓ debounce / command
Web Worker：解析、转换、统计
      ↓
诊断 / 新内容 / 树模型 / Diff
      ↓
状态栏、视图与保存操作
```

- 默认不发起任何业务网络请求，不包含遥测。
- 最近文件只存路径与展示名；会话恢复内容存本地应用数据目录，并设置总量上限。
- 打开和保存通过 Tauri 能力白名单；不开放任意 shell 执行。
- 修复失败、转换失败或 Worker 异常都不覆盖原文。

## 7. 性能策略

- 编辑器、树视图和 Diff 视图按需加载，降低首屏 bundle。
- 解析、格式化、排序和统计在 Web Worker 中执行；请求带 `requestId`，新任务可使旧响应失效。
- 输入校验使用 250-400ms debounce；显式命令立即执行。
- 大文档不在 React state 中保存解析后的完整对象，避免源字符串与对象树多份常驻。
- 树视图按展开节点增量渲染；Diff 超过阈值时先提示再计算。
- 目标基线：10 MB 合法 JSON 的常规转换不冻结 UI；实际耗时在验收机记录，不虚构固定毫秒承诺。

## 8. 错误与边界情况

- 空文档：显示编辑态空状态，不视为致命错误。
- 非法 JSON：显示首个语法错误的行、列和上下文；允许调用确定性修复。
- 重复键：标准 JSON 解析会覆盖键，因此在格式化前给出警告，不静默承诺保留语义。
- 大整数：文本格式化可保留原始数字 token；涉及对象化的树视图需提示 JavaScript 安全整数风险。
- 深层嵌套：树视图设置默认展开深度，避免一次性展开导致卡顿。
- 超大文件：超过建议阈值时关闭实时校验和树/Diff 自动计算，仅保留文本编辑与显式操作。
- 编码：首版支持 UTF-8，读取其他编码时给出明确错误，不猜测后静默转换。

## 9. 快捷键

| 操作 | macOS | Windows |
| --- | --- | --- |
| 新建 | `Cmd+N` | `Ctrl+N` |
| 打开 | `Cmd+O` | `Ctrl+O` |
| 保存 | `Cmd+S` | `Ctrl+S` |
| 格式化 | `Shift+Option+F` | `Shift+Alt+F` |
| 查找 | `Cmd+F` | `Ctrl+F` |
| 命令面板 | `Cmd+K` | `Ctrl+K` |
| 关闭标签 | `Cmd+W` | `Ctrl+W` |

快捷键仅出现在 tooltip、命令面板和设置页，不在主工作区堆叠说明文字。

## 10. 发布边界

- macOS 本机验证开发构建与未签名安装包。
- Windows 由 GitHub Actions 的 Windows runner 构建并上传产物；没有签名证书时明确标记为未签名测试包。
- 正式分发前另行配置 Apple Developer ID、公证和 Windows 代码签名证书，密钥不写入仓库。
