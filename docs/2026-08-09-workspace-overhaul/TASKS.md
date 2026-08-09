# TASKS —— 工作区改造

日期:2026-08-09。格式:`[ ] 任务名 | 优先级 | 估时 | 依赖`

阅读顺序:先 `DESIGN.md` §2「从代码读出的关键约束」,再看本清单。§2 里的约束违反会引入回归。

## A. 基础设施(必须先做)

- [ ] T1 扩展 Worker 协议 | P0 | 0.5h | 无
  - `src/types.ts`:`WorkerOperation` 加 `'query' | 'diff'`;`WorkerResponse` ok 分支加**可选** `data?: unknown`
  - `src/workers/json.worker.ts` 接上两个新操作的分发
  - 验收:`npm test` 全绿(现有 59 个测试**一个都不能改**);`tsc -b` 干净

- [ ] T2 新增 `src/core/tree-flatten.ts` | P0 | 3h | T1
  - 按 `API_SPEC.md` §1 实现,**迭代实现不得递归**
  - `countVisibleRows` 不得先 flatten 再取 length
  - 验收:新增单测覆盖 —— 空对象 / 纯数组 / 深嵌套 20 层 / 重复键 / baseline 三态 / 子树前缀覆盖 /
    `revealPath` 后祖先全展开;10 万节点 `countVisibleRows` 不超时

- [ ] T3 树视图虚拟化 | P0 | 4h | T2
  - 装 `@tanstack/react-virtual`(**锁定精确版本,不用 `^`**)
  - `TreeView` 改为消费 `FlatRow[]`,行组件 `memo`
  - `TreeViewProps` 按 `API_SPEC.md` §5 改造:接收 `root` 不再自己 parse
  - 验收:5 MB / 18,500 条数组首屏 DOM 行数 < 100(而非 18,502);滚动不掉帧;
    jsdom 测试需注入容器高度(见 `DESIGN.md` §9)

## B. 展开收起(用户新需求)

- [ ] T4 展开状态提升到集中存储 | P0 | 2h | T3
  - 删掉 `TreeNode` 各自的 `useState(depth < 2)`,改由 App 层持有 `ExpandState`
  - 验收:单节点展开/折叠行为与改造前一致;`components.test.tsx` 相关断言同步更新

- [ ] T5 四个展开操作 + 快捷键 | P0 | 2.5h | T4
  - 工具栏:全部展开 / 全部收起;行内 hover/focus:展开子树 / 收起子树
  - 快捷键:`Ctrl/⌘ Shift E` / `Ctrl/⌘ Shift W`;聚焦行 `Shift →` / `Shift ←`
  - 键盘可达:行可 focus,`↑↓` 移动,`←→` 收起/展开当前节点
  - 超 50,000 行先弹确认(复用 `useConfirm`),**不静默拒绝**
  - 复用已有图标,如需新图标必须同时改 `Icon.tsx` **并重新生成子集字体**
  - 验收:四个操作在 18,500 条数组上均 < 200 ms 响应;全部展开后滚动流畅

- [ ] T6 删除树视图的 5 MB 字节阈值 | P1 | 0.5h | T3 T5
  - **T3 未验证虚拟化真实生效前不要做本项**,否则等于撤掉护栏
  - 改为按可见行数保护;`App.tsx:530-531` 的提示文案一并调整

## C. 搜索(补最大功能缺口)

- [ ] T7 新增 `src/core/json-query.ts` | P0 | 3h | T1
  - 按 `API_SPEC.md` §2 实现 JSONPath 子集 + 子串过滤
  - **不支持的语法回明确 error 文案**,不得静默返回空
  - 验收:单测覆盖全部支持语法各至少一例;`?()` / `[1:5]` / `[0,2]` 三种不支持语法各有明确报错;
    命中超 5,000 截断并置 `truncated`

- [ ] T8 搜索 UI + 树视图联动 | P0 | 3h | T7 T4
  - 侧栏 Search tab;命中高亮 + 祖先自动展开(走 `revealPath`)
  - 结果列表可点击跳转;文本视图用 `JsonNode.offset` 调 `revealPosition`
  - `Ctrl/⌘ F` 在树视图下聚焦搜索框,文本视图仍走 CodeMirror 查找
  - 验收:`$.tokens.id_token` 能定位;`$..email` 能列出全部命中;子串过滤命中键名与值

- [ ] T9 大文档搜索移进 worker | P1 | 1.5h | T7 T1
  - 新增 `query` 操作;按节点数(非字节数)决定主线程还是 worker
  - 验收:大文档搜索时输入框不卡顿

## D. Diff 重做

- [ ] T10 新增 `src/core/json-diff.ts` | P1 | 3h | T1
  - 按 `API_SPEC.md` §3 实现结构化 diff
  - 验收:**同一数据 minify vs format 必须全 `same`**(这是本项的核心价值);
    键顺序不同不产生差异;数组下标对齐正确

- [ ] T11 DiffView 双模式 + 虚拟化 | P1 | 4h | T10 T3
  - 结构化为默认,行级保留为可切换;任一侧语法错误自动回退行级并提示原因
  - 两种模式都虚拟化,左右共享虚拟窗口且滚动同步
  - 验收:277,504 行文档首屏 DOM 行数 < 200;模式切换不丢滚动位置

- [ ] T12 Diff 计算移进 worker | P1 | 1.5h | T10 T1
  - 现在 `diffLines` 跑在 `useMemo` 主线程(`DiffView.tsx:122`)
  - 验收:大文档 diff 期间界面可交互

- [ ] T13 Diff 面板换 CodeMirror | P2 | 2h | T11
  - `<textarea>`(`DiffView.tsx:86-93`)换 `JsonEditor` readOnly
  - 验收:高亮与行号与主编辑器一致

## E. 布局重构

- [ ] T14 顶栏压到 2 行 | P0 | 3h | 无
  - 行 1 = 文档 tab + 视图 tab + 图标按钮;行 2 = 现有 ActionBar 不动
  - 删顶栏品牌与居中文档名(`AppHeader.tsx:33-39`)
  - `AppHeaderProps` 按 `API_SPEC.md` §5 改造
  - 验收:编辑区起始位置从约 26% 提到约 13%;窄屏 700px / 430px 不溢出

- [ ] T15 侧栏精简 + 可折叠 | P0 | 2.5h | T14
  - 删 `Variables`/`Requests`/`Snippets` 占位 tab、`Status` tab、「打开的文档」区块
  - 最终 tab:`Explorer` / `Search` / `Schema`;`Docs` 改底部按钮
  - 新增折叠(折叠后留 28px 把手),状态存 `settings.sidebarCollapsed`
  - 验收:折叠后编辑区横向 +280px;折叠态重启后保持

## F. 性能清理(零风险,可并行)

- [ ] T16 统一并缓存 `byteLength` | P1 | 1h | 无
  - `App.tsx:97` 与 `DiffView.tsx:27` 两份重复实现,提到 `src/utils/format.ts`
  - 按 document id + 内容长度缓存,避免每次渲染全量编码(实测 5 MB × 20 次 = 18 ms / 分配 100 MB)
  - 验收:大文档渲染期间无重复编码;`formatBytes` 现有行为不变

- [ ] T17 解析结果复用 | P1 | 1.5h | T3
  - `TreeView` 与 `StructurePanel` 现在各自 `parseJson` 同一 source
  - 提升到 App 层解析一次以 props 下发;重复键信息在解析阶段一次算完
  - 验收:同一文档切换树/结构视图不重复解析

- [ ] T18 评估 worker 复用 | P2 | 1h | 无
  - 现在每请求新建 Worker 再 terminate(`worker-client.ts:92-126`),校验是 320 ms 防抖
  - **先测量再决定**;`cancel` 依赖 terminate,改动会破坏取消语义
  - 验收:产出测量数据;若收益 < 5 ms 则记入 KNOWN_ISSUES 不改

- [ ] T19 暗色选区对比度 | P2 | 0.5h | 无
  - `#251c2f` 与编辑器底 `#0a0a12` 仅 1.21 对比,选区难辨
  - 需**同时**满足:选区底 vs 编辑器底 ≥ 1.5,粉色键名 `#ff2d78` 在选区上 ≥ 4.5:1
  - 验收:写脚本验证两个约束;`theme-parity.test.ts` 8 项保持全绿

- [ ] T20 字体 preload 与精简 | P2 | 1h | 无
  - 186 KB / 6 文件全在首屏,`index.html` 无 preload
  - 首屏必需字体加 `preload`;评估能否从 6 个字族精简
  - 验收:首屏字体闪动消失;若精简需确认视觉无回归

## 汇总

P0 共 9 项(T1-T5、T7、T8、T14、T15),约 23.5h —— 建议先交付这批。
P1 共 7 项,约 13h。P2 共 4 项,约 4.5h。合计 20 项、约 41h。

## 全局验收

1. `npm test` 全绿。现有 59 个测试中,**只有树视图相关断言允许因虚拟化调整**,其余不得改动
2. `npm run build`(含 `tsc -b`)干净
3. 5 MB / 18,500 条数组:树视图首屏 DOM 行数 < 100,展开全部后仍可滚动
4. 同一数据 minify vs format 的结构化 diff 结果全 `same`
5. 编辑区起始位置从约 26% 提到约 13%
6. 新增能力都有单测:`tree-flatten` / `json-query` / `json-diff` 三个核心模块覆盖率优先
