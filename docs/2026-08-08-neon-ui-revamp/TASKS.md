# TASKS:霓虹风格 UI 改造

格式:`[ ] 任务名 | 优先级 | 估时 | 依赖`

配套文档:`DESIGN.md`(配色/布局/映射表)、`API_SPEC.md`(组件接口契约)。
两份文档是实现依据,遇到冲突以 DESIGN.md 为准,发现设计问题记入 `KNOWN_ISSUES.md` 待 Claude 决策。

## P0 — 基础设施

- [ ] T1 接入 Tailwind v4 | P0 | 0.5h | —
  - 装 `tailwindcss` + `@tailwindcss/vite`(pin 确切版本,不用 `^`)
  - `vite.config.ts` 加插件;**同时删掉 `manualChunks` 里的 `lucide-react` 分包规则**(T3 后成死规则)
  - `src/styles.css` 改为 `@import "tailwindcss"` + `@theme` 定义 DESIGN.md §3 全部 token
  - 主题:`@custom-variant dark` 走 `.dark` class;App.tsx 里**同时保留** `data-theme` 属性写入
  - 验收:`npm run build` 通过,现有界面不白屏(此时样式可能错乱,属预期)

- [ ] T2 本地捆绑字体 | P0 | 0.5h | —
  - **字体已由架构师预先下载到 `public/fonts/`(共 468KB),不要重新下载**(沙箱无网络):
    `Sora-Variable-latin.woff2` 33K、`Inter-Variable-latin.woff2` 47K、
    `SpaceGrotesk-Variable-latin.woff2` 22K、`JetBrainsMono-Variable-latin.woff2` 42K、
    `MaterialSymbolsOutlined-Variable.woff2` 313K
  - 只需在 `styles.css` 写 `@font-face` 引用它们,`font-display: swap`,保留系统字体兜底
  - 前四个是可变字重字体,`font-weight` 写区间(如 `100 900`);Symbols 是 `wght` 单轴
  - 验收:**断网**启动 dev,四种字体族与图标字体全部生效

- [ ] T3 lucide-react → Material Symbols | P0 | 1.5h | T2
  - 按 DESIGN.md §7 映射表替换全部 22 个图标,移除 `lucide-react` 依赖
  - 建薄封装组件承载 `aria-hidden="true"` + 字号,避免每处重复写
  - **所有图标 span 必须 `aria-hidden="true"`**,可访问名留在父按钮 `aria-label`
  - 验收:`grep -r "lucide-react" src` 无结果;屏幕阅读器不念 `format_paint` 之类字面文本

## P0 — 布局骨架

- [ ] T4 抽出 AppHeader + ActionBar + InfoRow | P0 | 2h | T1,T3
  - 按 `API_SPEC.md` §3/§4/§5 的 props 契约实现,从 App.tsx 平移逻辑
  - InfoRow = 面包屑 + 状态栏合并(DESIGN.md §4①),状态药丸进 ActionBar(§4②)
  - 顶栏导航 = `文本/树/Diff` 视图切换(§4③);「历史」项在 T8 加,本任务先把四态结构留出来(§4④)
  - 删除旧 `.titlebar` / `.toolbar` / `.statusbar` CSS 与对应 JSX
  - 验收:34 个测试全绿;快捷键与「更多」菜单行为不变

- [ ] T5 三栏布局 + Sidebar | P0 | 2.5h | T4
  - App 根改 flex 列布局:Header 在上,下方 flex 行(Sidebar / 主区 / StructurePanel)
  - 按 `API_SPEC.md` §1 实现 Sidebar,7 项导航行为见 DESIGN.md §5
  - Explorer 与 Status 是真实功能;Variables/Requests/Snippets 出「暂未实现」占位卡
  - Docs 用 `@tauri-apps/plugin-opener` 打开 README.md
  - 断点:左栏 `hidden md:flex`,窄屏隐藏时标签栏仍可切换文档
  - 验收:窄屏 700px / 430px 无横向溢出

- [ ] T6 StructurePanel | P0 | 2h | T5
  - 按 `API_SPEC.md` §2 实现,**复用 `parseJson`,禁止另写解析器**
  - 先把 `TreeView` 的 `propertyPath` 提到 `src/core/json-path.ts`,两处共用
  - 仅文本视图显示;树视图隐藏;超 5MB 显示占位不解析
  - 验收:路径拼接结果与 TreeView 逐字一致(建议补一条单测锁定)

## P0 — History(操作历史)

- [ ] T7 workspace store 接入 history | P0 | 1h | —
  - 按 `API_SPEC.md` §7 加 `history` 字段 + `addHistoryRecord` / `clearHistory`
  - 常量 `MAX_HISTORY_RECORDS = 20`、`MAX_HISTORY_SNAPSHOT_BYTES = 256 * 1024`
  - **`history` 绝不加进 `persistWorkspace()` 的序列化字段**;不改 `PersistedWorkspace` /
    `version` / `readPersistedWorkspace` —— 改了会清空老用户会话(详见 API_SPEC.md §7)
  - 超 256 KB 的内容 `content` 置 `null`,其余字段照常记录
  - 验收:补单测覆盖「20 条上限截断」「超阈值置 null」「history 不进 localStorage」三条;
    现有 11 个 workspace 测试保持全绿

- [ ] T8 HistoryView + 接线 | P0 | 2h | T3,T4,T7
  - 按 `API_SPEC.md` §6 实现,样式对齐参考项目 `HistoryView` 卡片列表
  - `App.tsx` 的 `runOperation` 里接入记录:**只记 6 个改内容的操作**
    (format/minify/sort/repair/escape/unescape),validate/stats 不记;
    `output === 'new-tab'` 不记;记录的是**变换前**的 `source`(时机见 DESIGN.md §9)
  - 顶栏导航加「历史」项,`history` 视图下禁用操作栏变换按钮(比照现有 diff 模式)
  - `content === null` 的记录恢复按钮 disabled + tooltip 说明,不隐藏
  - 恢复语义(DESIGN.md §9):**回原文档,已关闭则开新标签**;脏文档先 `window.confirm`;
    恢复前自动存一条 `'restore'` 记录(存恢复前内容,让误恢复可逆);收尾 `setDiff(null)` +
    切回文本视图,否则用户停在 history 屏看不到结果
  - 验收:执行格式化后 History 出现记录且能恢复到操作前内容;清空需二次确认;
    关掉源文档后恢复会开新标签;脏文档恢复弹确认;恢复后 History 多一条「恢复」记录

## P1 — 视觉落地

- [ ] T9 组件样式霓虹化 | P1 | 3h | T5,T6
  - `TreeView` / `DiffView` / `CommandPalette` / `SettingsDialog` / `HistoryView` 换配色圆角发光
  - 玻璃拟态与滚动条工具类照搬参考项目 `index.css`
  - **`DiffView` 必须保留 `.diff-line--changed` 类名**(测试依赖,见 DESIGN.md §8)
  - **所有 `aria-label` / `role` / 可访问名文案逐字保留**
  - 验收:34 个测试全绿且未改断言

- [ ] T10 CodeMirror 主题霓虹化 | P1 | 1h | T1
  - `JsonEditor.tsx` 的 chrome 部分(底色/行号槽/光标/选区/活动行/tooltip)对齐新配色
  - 语法高亮保持多色相,不要改成参考项目的粉/青/黄三色(可读性会退化)
  - 验收:选区与正文对比度 ≥ 4.5:1

- [ ] T11 对比度实测 + 无障碍回归 | P1 | 1h | T9,T10
  - 写脚本实测亮暗两套全部前景背景组合,输出比值表,**全部 ≥ 4.5:1**
  - 暗色主色/辅色按钮必须用深色前景(DESIGN.md §3 已说明)
  - 键盘走查:Tab 序、焦点可见、`Ctrl/⌘ K/N/O/S/W`、`Shift+Alt+F`
  - `prefers-reduced-motion` 下发光与过渡降级(现有 media query 要保留)
  - 验收:附脚本输出;脚本属临时产物,验收后删除不入库

## P2 — 优化

- [ ] T12 Material Symbols 子集化 | P2 | 0.5h | T11
  - 按实际用到的字形子集化,400KB → 约 20KB
  - 验收:图标全部正常,`dist` 体积下降

## 不在本次范围

- History 的跨会话持久化(用户已定:仅会话内,关闭即清空)
- 用户头像与账号体系(参考项目那个是硬编码假头像 + 外链,违反离线可用性)
- Variables / Requests / Snippets 的实际功能(本次只出占位)
- 修改仓库根 `DESIGN.md`(冲突已记录在本目录 DESIGN.md §2,待用户定夺)

## 全局约束

1. **不改测试断言来迁就实现**。唯一例外是 `.diff-line--changed`,且优先保留类名而非改断言
2. **`src/core/` 与 `src/stores/` 的既有领域逻辑零改动**。解析/变换/持久化的现有行为一律不动。
   本次只允许两处新增:T6 把 `propertyPath` 提取到新文件 `src/core/json-path.ts`(纯移动,逻辑不变)、
   T7 在 store 上新增 `history` 字段与两个 action(不触碰任何既有字段与持久化路径)
3. 新增依赖 pin 确切版本
4. **不自动提交**。改完汇报,由用户拍板 `git commit`
5. 每个任务完成后跑 `npm run build && npm test`,不要攒到最后
