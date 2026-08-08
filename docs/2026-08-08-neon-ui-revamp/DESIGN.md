# DESIGN:霓虹风格 UI 改造

改造目标:把 JSON Forge 桌面端的视觉与布局对齐参考项目
[wangruqing723/json-forge](https://github.com/wangruqing723/json-forge)(AI Studio 生成的 Web Demo,
内部代号 NEON_PARSE),保留现有全部真实功能。

## 1. 用户已拍板的决策

| 决策项 | 选择 |
|---|---|
| 布局 | 三栏(左导航栏 + 中工作区 + 右结构面板),5 项导航全照搬 |
| 字体图标 | Sora / Inter / Space Grotesk / JetBrains Mono / Material Symbols **全部本地捆绑** |
| 样式方案 | 引入 Tailwind v4(`@tailwindcss/vite`) |
| 配色 | 全量霓虹(下表) |

## 2. 与项目既有 DESIGN.md 的冲突(已获用户授权覆盖)

仓库根 `DESIGN.md` 第 4 节「视觉方向」有三条与本次改造直接冲突,本次**以用户决策为准**,
但不修改根 `DESIGN.md`(留待用户决定是否同步):

| 原约束 | 本次做法 |
|---|---|
| 「圆角限制在 4-6px」 | 改为 6-12px(`rounded-lg` / `rounded-xl`) |
| 「主色采用中性石墨色」 | 改为霓虹粉 `#ff2d78` 主色 + 青 `#00ffcc` 辅色 |
| 「图标统一线性图标,避免字符图标」 | 改用 Material Symbols(连字字符图标),移除 lucide-react |
| 「UI 字体优先系统字体,不强制联网下载字体」 | 字体本地捆绑,不联网 —— **离线可用性这条仍然满足** |

## 3. 配色

参考项目的 `isDarkMode ? ... : ...` 三元表达式散落在每个组件里(单文件多达 40+ 处)。
本项目**不照搬这种写法**,统一收敛为 CSS 变量 + Tailwind `@theme`,组件里只写语义 token。
理由:现有 6 个组件已有主题切换,三元散落会让后续改色需要逐组件翻找。

### 暗色(cyber_dark,默认)

| Token | 值 | 用途 |
|---|---|---|
| `bg-base` | `#0a0a12` | 应用底色、编辑器底色 |
| `bg-panel` | `#0f0f1a` | 左导航栏、右结构面板 |
| `bg-elevated` | `#141422` | 操作栏、面包屑行 |
| `bg-raised` | `#1e1e30` | 按钮静态底、hover 底 |
| `bg-tab` | `#28283e` | 标签栏底色、卡片 |
| `border-base` | `#302840` | 常规分隔线 |
| `text-primary` | `#e8e0f0` | 正文 |
| `text-muted` | `#a098b0` | 次要文字 |
| `accent` | `#ff2d78` | 主色(品牌、活动态、脏标记) |
| `accent-fg` | `#1a0010` | 主色底上的前景色 |
| `secondary` | `#00ffcc` | 辅色(成功、有效、Array/Boolean) |
| `warning` | `#ffe04a` | 警告、Object/Number |
| `danger` | `#ff4444` | 错误 |

发光效果:`shadow-[0_0_12px_rgba(255,45,120,0.5)]`(主色按钮)、
`text-shadow: 0 0 12px rgba(...)`(`.text-glow-*` 工具类),仅用于活动态与品牌,不铺满界面。

### 亮色(frosted_light)

沿用参考项目亮色模式的暖调玫瑰灰:`#f8f9fd` 底 / `#ffffff` 面板 / `#b80048` 主色 /
`#006970` 辅色 / `#5c3f43` 次要文字 / `#e1e2e6` 边框。亮色模式**不加发光**,改用
`shadow-[0_2px_8px_rgba(184,0,72,0.25)]` 常规投影 —— 与参考项目一致。

### 对比度要求(硬性)

所有前景/背景组合必须 ≥ WCAG AA 4.5:1。已知需注意:
- 暗色 `accent #ff2d78` 上放白字仅 3.1:1 **不达标** —— 主按钮文字必须用 `accent-fg #1a0010`(参考项目即如此)
- 暗色 `secondary #00ffcc` 上同理,用深色前景
- 交付前必须用脚本实测全部组合,不能只靠目测

## 4. 布局

### 现状 → 目标

```
现状(5 行 grid,chrome 共 147px)      目标(三栏,chrome 共 ~185px)
┌──────────────────────┐            ┌────────────────────────────────┐
│ titlebar        42px │            │ Header                    64px │
│ tabs-row        35px │            ├──────┬──────────────────┬──────┤
│ toolbar         45px │            │ Side │ ActionBar   48px │ Str  │
│ workspace       1fr  │            │ bar  ├──────────────────┤ uct  │
│ statusbar       25px │            │ 256  │ Tabs        40px │ ure  │
└──────────────────────┘            │  px  ├──────────────────┤ 288  │
                                    │      │ InfoRow     33px │  px  │
                                    │      ├──────────────────┤      │
                                    │      │ Workspace   1fr  │      │
                                    └──────┴──────────────────┴──────┘
```

### 关键设计决定

**① 合并面包屑与状态栏为单一 InfoRow(节省 25px)**

参考项目有面包屑行(左侧路径 + 右侧 `UTF-8 / 缩进 / 大小`)但**没有状态栏**。
本项目状态栏承载着光标行列、节点数、处理耗时、持久化告警等真实信息,直接删掉是功能回退。

做法:两者合并成一行 —— 左侧文件路径(参考项目的面包屑),右侧堆放现状态栏全部指标。
视觉上就是参考项目的面包屑行,只是右侧条目更多。chrome 总高 185px,与参考项目 184px 基本持平,零功能损失。

**② 有效性提示改为操作栏右侧的状态药丸**

参考项目在操作栏右侧放圆角药丸显示校验状态(`check_circle` / `error` / `info` 三态配色)。
现状态栏的「JSON 有效 / 错误 + 行列跳转」迁移到这里,保留点击跳转到错误位置的能力。

**③ 顶栏导航 = 视图切换,操作栏 = 变换操作**

参考项目把 Format/Fix/Validate(操作)和 Diff/History(视图)混在顶栏导航,
且操作栏又重复了一遍 Format/Fix/Validate —— 这是 Demo 的冗余设计,不照搬。

诚实映射:
- **顶栏导航**:`文本 / 树 / Diff / 历史` —— 前三项即现有 `view-switch`,套参考项目顶栏导航的样式(下划线 + 发光)
- **操作栏**:`格式化 / 压缩 / 键排序 / 修复` + 右侧状态药丸

**④ History 视图纳入本次范围**

用户已确认实现,详细设计见 §9。视图切换扩展为四态:`text / tree / diff / history`。
`history` 是应用级视图(不属于某个文档),切换到它时主区整屏渲染 HistoryView,
操作栏的变换按钮与 InfoRow 的文档指标一并禁用/隐藏 —— 与现有 `diff` 模式下禁用变换的处理方式一致。

## 5. 左导航栏:5 项导航的落地

参考项目的左栏是**纯装饰导航**:7 个按钮点击只切 `sidebarTab` 状态,侧栏内没有内容区,
点了界面无任何变化(Demo 性质)。本项目做成有真实行为,避免空壳。

结构:品牌区 + `New Project` CTA + 导航区(flex-1) + 页脚导航(mt-auto),下方接内容区。

| 导航项 | 图标 | 行为 |
|---|---|---|
| Explorer | `folder_open` | **真实**:侧栏内容区列出已打开文档 + 最近文件,点击切换/打开 |
| Schema | `account_tree` | **真实**:切换右侧结构面板的显示/隐藏(不重复渲染树) |
| Variables | `data_object` | 占位:「暂未实现」说明卡 |
| Requests | `api` | 占位:「暂未实现」说明卡 |
| Snippets | `code` | 占位:「暂未实现」说明卡 |
| Docs(页脚) | `help` | **真实**:用系统默认程序打开仓库 README.md |
| Status(页脚) | `sensors` | **真实**:显示 Worker 状态、持久化状态、文档数 |

`New Project` CTA 映射到现有 `newDocument()`(即「新建文档」),文案改为中文「新建文档」。

窄屏(`< 768px`)左栏隐藏,与参考项目 `hidden md:flex` 一致;窄屏(`< 1024px`)右结构面板隐藏,
与参考项目 `hidden lg:flex` 一致。隐藏时 Explorer 的文档列表退回现有标签栏,不丢功能。

## 6. 右结构面板(StructurePanel)

对齐参考项目 `StructureOverview`:标题行 + 可折叠树 + 底部「KEY DETECTED」路径卡。

- **复用 `core/json-parser` 的 `parseJson` / `JsonNode`**,不写新解析逻辑
- 类型徽章配色:Object/Number → `warning`,Array/Boolean → `secondary`,String → `accent`,其余 → `text-muted`
- 点击节点更新底部路径卡(显示 JSONPath),复用 `TreeView` 现有的 `propertyPath` 路径拼接规则
- 仅在文本视图显示;树视图下隐藏(避免与主区树重复)
- 大文档沿用现有 `STRUCTURED_VIEW_LIMIT`(5MB)阈值,超限显示占位提示不解析

## 7. 字体与图标本地化

字体文件放 `public/fonts/`,用 `@font-face` 引用,**一律使用可变字体的 woff2**以控制体积:

| 字体 | 用途 | 预估 |
|---|---|---|
| Sora | `--font-headline` 标题、品牌、顶栏导航 | ~40KB |
| Inter | `--font-body` 正文 | ~45KB(latin 子集) |
| Space Grotesk | `--font-label` 标签、按钮、标签页 | ~35KB |
| JetBrains Mono | `--font-mono` 代码区、树、Diff | ~90KB |
| Material Symbols Outlined | 全部图标 | 313KB(仅 `wght` 单轴) |

字体已由架构师预先下载到 `public/fonts/`(Codex 沙箱无网络,无法自行下载),实测总计 **468KB**。
文件名见该目录,`@font-face` 直接引用即可,不要重新下载。

**关于 Material Symbols 的体积**:全轴版(opsz/wght/FILL/GRAD)实测 **3.8MB**,
远超原先 400KB 的估计。已改用仅 `wght` 单轴版 = 313KB(设计上图标只用一个字重,单轴足够)。

313KB 仍是包体里最大的单项。按实际用到的约 22 个字形子集化可压到 ~20KB,
但需要 `fontTools`(本机未装,且需联网安装),故列为 P2(TASKS.md T12)、非阻塞项。

`font-display: swap`,并在 `@font-face` 里保留系统字体兜底,字体文件缺失时不至于渲染崩坏。

### lucide-react → Material Symbols 图标映射

移除 `lucide-react` 依赖(同时删掉 `vite.config.ts` 里的 `icons` 分包规则,否则成为死规则)。

| lucide | Material Symbols | 出现位置 |
|---|---|---|
| `Braces` | `data_object` | 品牌标记、键排序 |
| `Search` | `search` | 顶栏查找 |
| `PanelTopOpen` | `bottom_panel_open` | 命令面板触发 |
| `Settings` | `settings` | 设置 |
| `X` | `close` | 关闭标签/对话框 |
| `FilePlus2` | `note_add` | 新建标签 |
| `FolderOpen` | `folder_open` | 打开文件 |
| `ChevronDown` | `expand_more` | 下拉、树折叠 |
| `ChevronRight` | `chevron_right` | 树展开 |
| `Save` | `save` | 保存 |
| `Sparkles` | `auto_awesome` | 格式化 |
| `AlignJustify` | `format_align_justify` | 压缩 |
| `WandSparkles` | `auto_fix_high` | 修复 |
| `MoreHorizontal` | `more_horiz` | 更多操作 |
| `Zap` | `bolt` | 转义/反转义 |
| `Clipboard` | `content_paste` | 复制全文 |
| `FolderSearch2` | `folder_open` | 文件管理器中显示 |
| `Check` | `check_circle` | 有效状态 |
| `CircleAlert` | `error` | 错误状态 |
| `Copy` | `content_copy` | 树复制值 |
| `FileJson2` | `data_object` | 空状态 |
| `TriangleAlert` | `warning` | 重复键告警 |

**无障碍要求**:Material Symbols 是连字字符图标,屏幕阅读器会念出 `format_paint` 之类的字面文本。
所有图标 span 必须加 `aria-hidden="true"`,可访问名由父按钮的 `aria-label` 提供。
这一点参考项目没做,不要照搬它的写法。

## 8. Tailwind v4 接入

- 装 `tailwindcss` + `@tailwindcss/vite`,`vite.config.ts` 加插件
- `src/styles.css` 改为 `@import "tailwindcss"` + `@theme` 定义上表 token + `@layer base`
- 主题切换:现状是 `documentElement.dataset.theme`(`data-theme`),参考项目用 `.dark` / `.light` class。
  **改为 class 方式**(Tailwind v4 `@custom-variant dark`),同时**保留 `data-theme` 属性写入**
  —— `SettingsDialog` 与 `colorScheme` 逻辑依赖它,且属性写入成本为零
- 玻璃拟态工具类(`.glass-panel` / `.glass-panel-heavy` / `.glass-input`)照搬参考项目 `index.css`
- 滚动条样式照搬参考项目(6px、accent hover)

### 测试兼容(唯一硬约束)

`src/components/components.test.tsx:74` 断言 `container.querySelectorAll('.diff-line--changed')`。
DiffView 改造后**必须保留 `.diff-line--changed` 这个类名**(可与 Tailwind 工具类并存),
或同步修改该断言。其余 33 个测试全部走 `role` / `aria-label` / 文本查询,不受 class 变更影响。

**所有现有 `aria-label`、`role`、可访问名文案必须逐字保留**,否则测试挂。
特别注意 `TreeView` 的 `折叠 X` / `展开 X` / `复制 X 的值` / `复制路径 X`,
`DiffView` 的 `左侧（窄屏上方）：X` / `右侧（窄屏下方）：X`。

## 9. History 视图(操作历史)

对齐参考项目 `HistoryView`:标题区 + `Clear History` 按钮 + 记录卡片列表(文件名、操作徽章、
时间戳、大小、`Restore Snapshot` 按钮) + 空状态卡片。文案改中文。

### 关键约束:不能照搬参考项目的存储做法

参考项目每条 `HistoryItem` 存一份全量 `content` 快照,且 history 只放在 `useState` 里、
**从不持久化**,所以它不会有存储问题。本项目 `stores/workspace.ts:14` 有
`MAX_WORKSPACE_STORAGE_BYTES = 4 MiB`,整个工作区(含全部文档内容)序列化进同一个
localStorage key,超限即走 `persistMetadataFallback` —— **连已打开文档的内容一起丢弃**,
只保留设置与最近文件。若把全量快照写进持久化,几次操作就能撑爆上限并连带丢失用户文档。

### 用户已拍板的策略

| 决策项 | 选择 |
|---|---|
| 持久化 | **仅会话内,不持久化**。关闭应用即清空 |
| 保留策略 | **最多 20 条**;单条内容 **> 256 KB 时只记元数据**,不存快照 |
| 恢复语义 | **回快照所属文档;该文档已关闭则开新标签** |

### 实现约定

**存储位置**:history 放进 `stores/workspace.ts` 的 store(新增 `history` 字段 +
`addHistoryRecord` / `clearHistory` action),但**绝不加入 `persistWorkspace()` 的序列化字段列表**。

理由:store 里 Sidebar 与 HistoryView 都能取到,且未来若要联动 `closeDocument` 也有位置;
而 `persistWorkspace()` 是白名单式挑字段序列化(只取 `documents` / `activeDocumentId` /
`diff` / `settings` / `recentFiles`),不加进去天然就不持久化。
**不需要**动 `PersistedWorkspace` 类型、`version` 号或新增 `sanitizeHistory` —— 零持久化风险,
也不会让老用户的会话因版本号变化被清空。

**上限执行**:`addHistoryRecord` 里 `.slice(0, 20)`,与现有 `addRecentFile` 的
`.slice(0, MAX_RECENT_FILES)` 同一套写法。常量命名 `MAX_HISTORY_RECORDS = 20`、
`MAX_HISTORY_SNAPSHOT_BYTES = 256 * 1024`,与既有 `MAX_RECENT_FILES` 并列导出。

**超阈值处理**:内容 > 256 KB 时 `content` 存 `null`,记录仍入列表(保留操作日志价值),
但卡片上的「恢复」按钮 `disabled` 并给 tooltip 说明「快照超过 256 KB 未保存内容,无法恢复」。
不要静默隐藏按钮 —— 用户需要知道为什么不能恢复。

**记录哪些操作**:只记录**改变内容**的操作 —— `format` / `minify` / `sort` / `repair` /
`escape` / `unescape`。`validate` 与 `stats` 不改内容,记录它们对「恢复快照」毫无意义
(参考项目记了 VALIDATE,是 Demo 的不严谨,不照搬)。

操作名直接复用 App.tsx 现有的 `operationLabels`(`格式化` / `压缩` / `键排序` / `修复` /
`转义` / `反转义`),不要新造一套 `FORMAT` / `FIX_ESCAPES` 式的英文枚举。

**记录时机**:在 `runOperation` 成功且通过 `isCurrentDocumentSnapshot` 新鲜度校验之后、
应用结果之前记录**变换前的原内容**(即 `source`)。这样「恢复」是回到操作前的状态,
符合「撤销」直觉。若记录变换后的内容,恢复等于重做一次,没有价值。

**输出到新标签的情况**:`runOperation(op, 'new-tab')` 不改动原文档,因此**不记录 history**。

### 恢复语义(已确认)

**回快照所属文档,该文档已关闭则开新标签。** 不用参考项目「写进当前活动文档」的做法 ——
本项目是多标签,在 A 文档做的快照会被恢复进当前停留的 B 文档,误覆盖正在编辑的内容。

流程:

```
按 record.documentId 查 documents
├── 找到
│   ├── 目标文档 isDocumentDirty 且内容与快照不同
│   │   └── window.confirm 二次确认(沿用关闭脏文档的措辞风格)
│   ├── 先记一条 operation='restore' 的历史(存**恢复前**的内容)
│   ├── updateContent(documentId, record.content)
│   └── setActive(documentId)
└── 未找到(已关闭)
    └── newDocument(record.content, `${record.documentTitle} · 恢复`)

收尾(两条路径都要做):
├── setDiff(null)
├── setView(目标文档, 'text')
└── 视图切回 'text'(否则用户停在 history 屏上看不到结果)
```

要点:

- **恢复前先记一条历史**(`operation: 'restore'`,内容为恢复前的现状)。这样「恢复错了」还能再恢复回去,
  把覆盖式恢复的数据丢失口子彻底堵上。代价只是多调一次 `addHistoryRecord`
- **目标文档有未保存改动时二次确认**。恢复是覆盖操作,脏文档直接覆盖会丢用户未存的编辑;
  项目已有 `closeDocument` 的 `window.confirm` 先例,措辞对齐
- **恢复完必须切回文本视图**,否则点完按钮界面停在 history 屏,用户以为没生效
- `record.content === null`(超 256 KB 未存快照)时按钮本就 disabled,恢复函数入口再做一次
  防御性判空直接 return,不依赖 UI 层拦截

## 10. 验收标准

1. `npm run build` 通过,`npx tsc --noEmit` 无错
2. `npm test` 34 个测试全绿(不允许改断言来迁就实现,`.diff-line--changed` 除外且需说明)
3. 断网启动 `npm run dev`,字体与图标正常渲染(无方框、无 `format_paint` 字面文本)
4. 亮/暗两套主题所有前景背景组合实测 ≥ 4.5:1,附脚本输出
5. 键盘可达性不回退:Tab 序合理,`Ctrl/⌘ K/N/O/S/W`、`Shift+Alt+F` 全部仍生效
6. 窄屏 700px / 430px 下无横向溢出,左栏与右栏按断点正确隐藏
7. `prefers-reduced-motion` 下发光与过渡动画降级(现有 media query 要保留)
