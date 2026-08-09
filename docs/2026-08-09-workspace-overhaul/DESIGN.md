# DESIGN —— 工作区改造(布局压缩 / 虚拟化 / 搜索 / 结构化 Diff / 展开收起)

日期:2026-08-09
slug:`workspace-overhaul`

## 1. 背景与目标

当前版本「轻量」达标,「高性能」不成立。实测(5.00 MB / 18,500 条数组,**不触发现有 5 MB 降级阈值**):

| 场景 | 挂载组件 | DOM 节点 |
| --- | --- | --- |
| TreeView 首屏(默认 `depth < 2` 展开) | 18,502 | ~111,000 |
| TreeView 展开全部 | 222,002 | ~1,332,000 |
| DiffView(277,504 行,左右各渲一份) | —— | ~2,220,000 |

同时存在四类信息重复:文档名出现 3 次(顶栏 / 文档 tab / 状态栏)、文档列表 2 次(侧栏 / 文档 tab)、
品牌 2 次(顶栏 `JSON Forge` / 侧栏 `Workspace`,图标同为 `data_object`)、最近文件 2 次(侧栏 / 打开按钮下拉)。
顶栏 4 行占掉约 26% 垂直空间。

本轮目标:

1. 顶栏压到 2 行,侧栏可折叠,消除上述重复
2. 树视图虚拟化,并新增「全部展开 / 全部收起 / 展开子树 / 收起子树」
3. 新增搜索:JSONPath 查询 + 子串过滤,让「复制路径」形成闭环
4. Diff 改双模式(结构化为默认),移进 worker 并虚拟化
5. 清理重复计算(`byteLength`、重复解析、缺失 memo)

## 2. 从代码读出的关键约束

实现时必须遵守,违反会引入回归:

- **`WorkerResponse` 的 ok 分支只有 `result: string`**(`src/types.ts:92-94`)。搜索与 diff 要返回结构化数据,
  必须扩展协议;扩展方式**只能新增可选字段**,不得改动现有 8 个操作的形状,否则 `processor.test.ts`、
  `worker-client.test.ts` 全数受影响。
- **`JsonWorkerClient.createWorker` 每个请求新建 Worker 并在响应后 `terminate`**(`src/services/worker-client.ts:92-126`)。
  `cancel` 依赖 terminate 实现,改成 worker 池会破坏取消语义。本轮**不重构这套机制**,仅在 T18 单独评估。
- **`parseJson` 是手写递归下降解析器**(`src/core/json-parser.ts`),产出的 `JsonNode` 带 `offset`。
  offset 是「文本视图跳转」的基础,新增能力必须沿用,不要另造解析器。
- **`JsonObjectNode.entries` 保留重复键**(同一 key 可出现多次,各自带 `index`)。
  树视图靠 `duplicateKeys` 标注歧义。扁平化与搜索必须保持这个语义,不能用 `Record` 收敛。
- **子集字体已丢弃 GSUB 表**,图标必须走 codepoint。新增图标要同时改 `Icon.tsx` 映射表**并重新生成子集字体**,
  只做前者会静默显示空白(见 `docs/2026-08-08-neon-polish/KNOWN_ISSUES.md`)。**本轮尽量复用已有 35 个图标。**
- 生产环境屏蔽了默认右键菜单(`src/App.tsx:233-242`),所以展开操作**不走右键菜单**。

## 3. 布局重构

### 目标形态(2 行)

```
┌──────────────────────────────────────────────────────────┐
│ ●未命名1 × ●未命名2 +   │ 文本 树 Diff 历史 │  🔍 ☾ ⚙   │  行1
├──────────────────────────────────────────────────────────┤
│ 📂打开▾ 💾保存 │ ✨格式化 压缩 键排序 修复 │  ✓JSON有效 ⋯│  行2
├────────────┬─────────────────────────────────────────────┤
│ 侧栏 ◀折叠 │ 编辑区                                      │
└────────────┴─────────────────────────────────────────────┘
```

- **行 1** = 文档 tab(左,可横向滚动) + 视图 tab(右) + 图标按钮(最右)。
  `AppHeader` 的 `header-topline` 与 `view-nav` 两行合并到此行右侧;文档 tab 从原独立行移入左侧。
- **行 2** = 现有 `ActionBar`,不改结构。
- 品牌**只留侧栏**,顶栏不再出现 `JSON Forge` 字样(窗口标题栏已有)。
- 顶栏居中的文档名删除 —— 文档 tab 已经显示,状态栏也有。

### 去重清单

| 重复项 | 处理 |
| --- | --- |
| 文档名 3 处 | 删顶栏居中那处,保留文档 tab + 状态栏 |
| 文档列表 2 处 | 删侧栏「打开的文档」区块,保留文档 tab |
| 品牌 2 处 | 删顶栏品牌,保留侧栏 |
| 最近文件 2 处 | 保留侧栏(可看全量),「打开」下拉保留(快速取用);二者共用同一份 `recentFiles`,不算冗余展示,**保留** |
| 侧栏 Status tab | 删除,信息与底部状态栏重叠 |

### 侧栏调整

- 删除 `Variables` / `Requests` / `Snippets` 三个占位 tab(`Sidebar.tsx:94-100`)。
  这套 Explorer/Schema/Variables/Requests/Snippets 是 API 客户端的信息架构,与 JSON 编辑器定位不符。
- 新增 `Search` tab(承载 JSONPath 查询与过滤,见 §5)。
- `Docs` 改为侧栏底部单个按钮(打开 AboutDialog),不再占 tab 位。
- 最终 tab:`Explorer`(最近文件)、`Search`、`Schema`。
- **新增折叠能力**:折叠后侧栏收成 0 宽(仅留一条 28px 的展开把手),编辑区横向 +280px。
  折叠状态存 `settings`,随会话持久化。

## 4. 树视图:虚拟化 + 集中展开状态

### 4.1 扁平化

新增 `src/core/tree-flatten.ts`,把 `JsonNode` 按当前展开状态压成一维可见行数组:

```
FlatRow = { path, label, node, depth, kind: 'value'|'open'|'close', hasChildren, ambiguous }
```

只产出**可见**行(折叠节点的子树不进数组)。虚拟化列表对这个数组切窗口渲染。

### 4.2 展开状态:baseline + overrides

现在展开状态是每个 `TreeNode` 各自的 `useState(depth < 2)`(`TreeView.tsx:52`),
做「全部展开」必须提升为集中状态。直接存「所有展开路径的 Set」在 20 万节点下会占几 MB 字符串,故用:

```
ExpandState = {
  baseline: 'default' | 'all' | 'none',   // default = depth < 2
  overrides: Set<string>                   // 只存与 baseline 不同的路径
}
```

- 「全部展开」= `{ baseline: 'all', overrides: 空 }` —— O(1),不占内存
- 「全部收起」= `{ baseline: 'none', overrides: 空 }`
- 单节点 toggle = 往 `overrides` 增删该路径
- 「展开子树 / 收起子树」= 以该路径为前缀批量操作。**注意**:不能遍历全树求所有后代路径
  (数量可能几十万),而是记录「子树根 + 目标态」,判定时按前缀匹配。若实现复杂度过高,
  允许退化为「遍历该子树实际节点写入 overrides」,但必须有节点数上限保护(见 4.4)。

判定单个路径是否展开:`overrides.has(path) ? !baselineOf(path) : baselineOf(path)`。

### 4.3 四个操作的落点

| 操作 | 位置 | 快捷键 |
| --- | --- | --- |
| 全部展开 | 树视图工具栏 | `Ctrl/⌘ Shift E` |
| 全部收起 | 树视图工具栏 | `Ctrl/⌘ Shift W` |
| 展开子树 | 行内按钮(hover / focus 显示) | 聚焦行时 `Shift →` |
| 收起子树 | 行内按钮(hover / focus 显示) | 聚焦行时 `Shift ←` |

行内按钮只在 hover 或 focus 时出现,避免每行常驻两个额外按钮(会把行高和 DOM 量推上去)。
键盘可达:行本身可 focus,`↑↓` 移动、`←→` 收起/展开当前节点、`Shift ←→` 作用于子树。

### 4.4 安全阈值

「全部展开」后可见行数可能达数十万。虚拟化能扛渲染,但扁平化数组本身要占内存。
设 `EXPAND_ALL_CONFIRM_ROWS = 50_000`:超过则先弹确认(复用 `useConfirm`),
告知预计行数,由用户决定。**不静默拒绝。**

### 4.5 删除字节阈值

虚拟化后 `STRUCTURED_VIEW_LIMIT`(5 MB)对树视图的限制**删除**。
理由:决定卡顿的是节点数不是字节数,同为 5 MB 的扁平大数组与深嵌套小对象节点数差一个数量级,
按字节设阈值必然一边误杀一边漏放。改为按可见行数保护(4.4)。
Diff 侧的同名阈值在 T10 一并处理。

## 5. 搜索:JSONPath + 子串过滤

新增 `src/core/json-query.ts`。输入框单一,按内容判定模式:

- 以 `$` 开头 → **JSONPath 查询**
- 否则 → **子串过滤**(同时匹配键名与值,大小写不敏感)

### JSONPath 支持子集

手写求值器,不引依赖。支持:

| 语法 | 示例 |
| --- | --- |
| 根 | `$` |
| 子属性 | `$.tokens.id_token` |
| 括号属性 | `$["odd key"]` |
| 数组下标 | `$.data[3]` |
| 通配 | `$.data[*].email`、`$.*` |
| 递归下降 | `$..email` |

**不支持**(超出本轮范围,输入时给明确提示而非静默返回空):过滤表达式 `?()`、切片 `[1:5]`、
并集 `[0,2]`、函数。

### 输出与交互

查询/过滤产出命中路径列表。树视图行为:

- 命中行高亮,**祖先链自动展开**(往 `overrides` 写入祖先路径)
- 非命中行按设置可隐藏或保留(默认保留,只高亮 —— 隐藏会让上下文丢失)
- 结果列表可点击跳转;文本视图下利用 `JsonNode.offset` 调 `editorRef.revealPosition`

大文档在 worker 里跑(新增 `query` 操作),小文档主线程直接算。分界沿用节点数而非字节数。

`Ctrl/⌘ F` 在树视图下聚焦搜索框(文本视图仍走 CodeMirror 自带查找)。

## 6. Diff:双模式 + worker + 虚拟化

新增 `src/core/json-diff.ts`,产出:

```
JsonDiffEntry = { path, kind: 'added'|'removed'|'changed'|'same', left?, right? }
```

递归比对两棵 `JsonNode`,按路径对齐,**不受键顺序与缩进影响**。数组按下标对齐(不做 LCS,
避免复杂度失控;插入元素会显示为后续整段变化,这是已知取舍,记入 KNOWN_ISSUES)。

- **结构化模式为默认**。任一侧 JSON 语法错误时自动回退行级模式并提示原因。
- **行级模式保留**为可切换项,`buildDiffRows` 逻辑不动,仅移进 worker 并虚拟化。
- 两种模式都虚拟化;左右两栏共享同一虚拟窗口,滚动同步。
- `<textarea>` 换成 `JsonEditor`(CodeMirror,readOnly),拿到高亮与行号,和主编辑器一致。

## 7. Worker 协议扩展

`WorkerOperation` 增加 `'query' | 'diff'`。`WorkerRequest` 不变(`options` 承载查询串 / 对侧文本)。

`WorkerResponse` ok 分支**新增可选 `data` 字段**:

```
| { requestId, ok: true, result: string, meta: ProcessingMeta, data?: unknown }
```

现有 8 个操作不填 `data`,形状不变,已有测试不受影响。`query` / `diff` 把结构化结果放 `data`,
`result` 填人类可读摘要(如「命中 12 处」)以满足类型。

## 8. 性能清理

| 项 | 现状 | 处理 |
| --- | --- | --- |
| `byteLength` | 每次 `TextEncoder().encode()` 全量编码。5 MB 调 20 次 = 18 ms / 分配 100 MB;`.length` 为 0.00 ms。`App.tsx` 与 `DiffView.tsx` 各一份 | 提到 `src/utils/format.ts` 统一;按 document id + content 长度缓存 |
| 重复解析 | `TreeView` 与 `StructurePanel` 各自 `parseJson` 同一 source | 提升到 App 层解析一次,以 props 下发 |
| `TreeNode` 无 memo | `duplicateKeys` 每次渲染重算,`containsDuplicateKeys` 全树遍历 | 扁平化后行组件 `memo`;重复键在解析阶段一次算完 |
| 暗色选区 | `#251c2f` 与编辑器底 `#0a0a12` 仅 1.21 对比,选区难辨 | 重新取值:选区底与编辑器底 ≥ 1.5,且粉色键名在选区上 ≥ 4.5:1。**两个约束都要满足**,用脚本验证 |
| 字体 | 186 KB / 6 文件全在首屏,`index.html` 无 preload | 首屏必需字体加 `preload`;评估能否从 6 个字族精简 |

## 9. 风险与回归面

- **展开状态提升**是本轮最大结构改动,`components.test.tsx` 里树视图相关断言会受影响,需同步更新。
- **虚拟化后 DOM 里只有可见行**,依赖「全量渲染」的测试断言(如按文本查找深层节点)会失败,
  必须改为先展开/滚动再断言,或直接断言扁平化函数的输出。
- **jsdom 无布局**,`getBoundingClientRect` 恒为 0,虚拟化列表在 jsdom 中可能只渲染 0 行。
  测试需给容器注入固定高度或 mock 测量;这是 `@tanstack/react-virtual` 在 jsdom 下的已知行为。
- 删除 `STRUCTURED_VIEW_LIMIT` 对树视图的限制后,**必须**先确认虚拟化真实生效,否则等于撤掉护栏。
  T3 完成前不要做 T6。

## 10. 依赖决策

新增 `@tanstack/react-virtual`(约 4.6 KB gzip,headless,无样式)。

理由:手写定高虚拟化约 60 行,但滚动恢复、overscan、`scrollToIndex`(搜索跳转要用)这些边界
自己写容易出错。相对 CodeMirror 已占 124 KB gzip,4.6 KB 可接受。**锁定精确版本,不用 `^`。**
