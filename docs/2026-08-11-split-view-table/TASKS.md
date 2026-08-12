# TASKS —— 分屏工作区 + 表格视图

> 状态：**已完成并归档**（2026-08-13）
> 发布版本：`v0.3.0` · 实现提交：`f1b8177` · 收口提交：`d0657a8`

格式：`[ ] 任务名 | 优先级 | 估时 | 依赖`

无阻塞项。图标方案已定（D10 纯文字按钮，`ICON_CODEPOINTS` 与字体子集**一个字节都不动**）。

> **全局禁令**：任何任务都不得新增 `ICON_CODEPOINTS` 条目。
> `icon-subset.test.ts` 断言 `cmap.size === Object.keys(ICON_CODEPOINTS).length`，
> 加一项就红，而重新生成子集需要本机不存在的完整源字体与 `pyftsubset`。
> 新按钮一律纯文字；确需图形时只能从现有映射里挑（空闲项见 `DESIGN.md` §12.1）。

---

## 第一阶段：拆除与地基（可并行）

- [x] **T1 删除 Schema 整条链路** | P0 | 1h | 无
  - 按 `API_SPEC.md` §7 清单删除。`structure-width.ts` 及其测试在 T2 迁移后再删，避免中间态编译不过。
  - 验收：`npm run build` 通过；全仓 grep 无 `structure`/`schema-panel`/`StructurePanel` 残留（`$schema` 的 JSON 配置除外）。

- [x] **T2 新增 `core/split-layout.ts` + 测试** | P0 | 1.5h | 无
  - 照 `API_SPEC.md` §5.1 实现。测试从 `structure-width.test.ts` 迁移改写：非有限数退默认、上下边界钳制、拖拽换算按方向取轴、步进不越界。
  - 验收：`split-layout.test.ts` 全绿，覆盖 NaN / Infinity / 越界 / 反序列化脏字符串四类输入。

- [x] **T4 `tree-flatten` 加闭合行与 `hiddenPaths`** | P0 | 3h | 无
  - 照 `API_SPEC.md` §4.1：`FlatRow` 加 `'close'` kind、`isLast`、`parentType`；`flattenTree` / `countVisibleRows` / `isSubtreeFullyExpanded` 接收可选 `hiddenPaths`。
  - **不加 `childCount`**（本条早期写法有误，已订正）：折叠态的 `{…} 3` 计数可由 `row.node` 直接算出
    （`entries.length` / `items.length`），存进 `FlatRow` 等于给每个可见行加一个冗余字段 ——
    5 万行就是 5 万个多余数字，且与 `node` 构成两个真值来源，可能不同步。
  - 现有 `tree-flatten.test.ts` 会因行数变化红掉，需同步更新预期。
  - 验收：闭合行与开启行成对出现且缩进相同；隐藏容器时整棵子树（含闭合行）都不出现；`hiddenPaths` 为空时行为与改造前一致（除新增闭合行）。

- [x] **T11 新增 `core/json-table.ts` + 测试** | P0 | 3h | 无
  - 照 `API_SPEC.md` §5.2 实现三种形态判定 + 单元格构建 + 5000 行上限 + 200 字符截断。
  - 验收：对象→字段/值两列；数组套对象→键并集为列且缺失键留空（`text`/`full` 为空串、`path`/`type` 为 `null`）；数组套标量→索引/值；标量返回 null；混合数组（对象+标量）按 `scalars` 处理，每个元素整体压成一格。

## 第二阶段：视图模型（串行）

- [x] **T3 视图模型迁移** | P0 | 2.5h | T1, T2
  - `types.ts`：`DocumentView` → `CollapsedPane`，`JsonDocument.view` → `collapsedPane`，`AppSettings` 删 `structureWidth` 加 `splitOrientation` / `splitRatio` / `allowRemoteImagePreview`；`WorkspaceView` 改 `'edit' | 'diff' | 'history'`。
  - `stores/workspace.ts`：`setView` → `setCollapsedPane`；`sanitizeDocuments` 做旧值迁移（`view: 'text'` → `collapsedPane: 'tree'`，`view: 'tree'` → `'text'`）；`sanitizeSettings` 加三个新字段校验。
  - **风险点**：迁移写错会让 `sanitizeDocuments` 丢弃全部旧文档。必须有专门用例。
  - 验收：`workspace.test.ts` 新增用例 —— 喂入含旧 `view` 字段的快照，文档数不减、`collapsedPane` 映射正确；喂入两字段都缺的脏文档，落到默认 `null` 而非被丢弃；`splitRatio` 传字符串/NaN 时退回默认。

- [x] **T5 `SplitWorkspace` 容器 + CSS** | P0 | 3h | T2, T3
  - 照 `API_SPEC.md` §6.1。分隔条 `role="separator"` + `aria-orientation` + 左右/上下键步进 + Home/End 跳极值，拖拽期间本地 state、松手才 commit（沿用 `App.tsx:164-171` 现有注释里那套理由）。
  - 每侧头部带标题（「文本」/「树」）与折叠按钮；单侧折叠时分隔条隐藏，折叠侧只留一条可点击的复原条。
  - 验收：拖拽后比例持久化；刷新后比例与方向保留；折叠状态跟文档走（切标签会变）；键盘可完成全部操作。

## 第三阶段：树侧重做（串行）

- [x] **T6 树行渲染重做** | P0 | 4h | T4
  - 照 `DESIGN.md` §6：`"key": value,` 同行、容器开闭行、缩进引导线、折叠态 `{…} 3`。
  - **必须保留** `.tree-value--{type}` 与 `.tree-path` 的取色类名，否则 `theme-parity.test.ts` 红。暗色下每个 `.tree-value--{type}` 规则只能出现一次。
  - **必须保留** 虚拟化与 `EXPAND_ALL_CONFIRM_ROWS = 50_000` 闸门。
  - 验收：`theme-parity.test.ts` 全绿；1 万节点 JSON 全部展开后滚动不掉帧；`components.test.tsx` 里 TreeView 现有用例（含 `scrollToPath`）更新后通过。

- [x] **T7 行内操作 + 隐藏/恢复** | P0 | 2.5h | T6
  - hover/focus 出「复制 | 复制路径 | 下载 | 删除」文字按钮组；`hiddenPaths` 提到 App 层，`content` 变化即清空；树头部「恢复隐藏 (N)」仅在非空时出现。
  - 重复键路径（`row.ambiguous`）禁用「复制路径」，与现状一致。
  - 验收：删除后该子树消失且行数统计同步；格式化 / 编辑 / 压缩后节点回来；「恢复隐藏」一次清空全部；表格视图不受 `hiddenPaths` 影响。

- [x] **T8 `selectedPath` + 状态栏当前节点** | P1 | 1.5h | T6
  - 点击行的键名区域选中，选中行有持久高亮（区别于搜索命中的 `is-highlighted`）；`InfoRow` 加「当前节点」段，preview 截断到 40 字符。
  - 验收：切文档时 `selectedPath` 重置为 `'$'`；选中节点被隐藏后退回 `'$'`；状态栏文案形如 `当前节点: $.city  string / city "北京"`。

## 第四阶段：外链与图片（串行，可与第五阶段并行）

- [x] **T9 外链点击打开** | P1 | 1.5h | T6
  - `core/json-url.ts` 的 `externalUrlFromNode`（只放行 http/https，拒 `javascript:`/`file:`/`data:`）+ `platform.ts` 的 `openExternalUrl`；`src-tauri/capabilities/default.json` 补 `opener:allow-open-url`。
  - 打开前 toast 提示目标域名。
  - 验收：`json-url.test.ts` 覆盖 `javascript:alert(1)`、`file:///etc/passwd`、`data:text/html,...`、大小写混写协议、前后空白、非字符串节点，全部返回 null；桌面端点击能唤起系统浏览器。

- [x] **T10 远程图片预览 + CSP + 设置开关** | P1 | 2.5h | T9
  - `tauri.conf.json` 的 `csp` 与 `devCsp` 的 `img-src` 加 `https:`；`AppSettings.allowRemoteImagePreview` 默认 `false`；设置面板加开关并标注隐私影响。
  - hover 400ms 后才发请求；失败 URL 记入 session 级 Set 不重试；`<img>` 挂 `referrerPolicy="no-referrer"`。
  - 验收：开关关闭时 DevTools Network 无任何外部图片请求；开启后加载失败回退为纯文本气泡不留空框；同一失败 URL 反复 hover 只请求一次。

## 第五阶段：表格视图（串行）

- [x] **T12 `TableView` 弹窗 + CSS** | P0 | 3h | T11, T8
  - 照 `API_SPEC.md` §6.3：居中弹窗、面包屑下钻栈、复制单元格 / 复制整表 TSV、不可表格化时给说明与回退入口。
  - 弹窗无障碍照 `ConfirmDialog` 现有做法（遮罩、Esc、焦点还原、Tab 循环）。
  - 验收：从 `$.data.forecast` 这类数组套对象打开时列为键并集；下钻到标量给说明而非空弹窗；复制整表粘进表格软件列对齐；Esc 关闭后焦点回到触发按钮。

- [x] **T13 ActionBar 按钮改造** | P0 | 1h | T5, T12
  - 删 Schema 按钮；加「表格」与分屏方向切换；`tableDisabledReason` 接线（解析失败 / 选中标量）。
  - 三个新按钮**纯文字无图标**（D10）：`表格`、`左右`、`上下`。不得新增 `ICON_CODEPOINTS` 条目。
  - 验收：解析失败时表格按钮 `aria-disabled` 且 tooltip 说明原因；方向按钮 `aria-pressed` 反映当前方向；`icon-subset.test.ts` 仍绿。

## 第六阶段：收口

- [x] **T14 窄屏适配** | P1 | 1.5h | T5
  - `< 700px` 强制上下分屏（不写回设置）；`< 480px` 强制只显示文本侧，分隔条与折叠按钮隐藏。
  - 验收：从宽屏拖到窄屏再拖回，用户原有的方向与比例设置未被覆盖。

- [x] **T15 `CONTEXT.md` 补词条** | P2 | 0.5h | 无
  - 加「分屏」「折叠侧」「表格视图」「隐藏节点」四条，格式照现有词条（含 `_Avoid_` 行）。

- [x] **T16 全量验证** | P0 | 1h | 以上全部
  - `npm run build`、`npm test` 全绿；手工过一遍 `DESIGN.md` §12 的风险清单。
  - 验收：无 TypeScript 错误；测试无跳过；`git status` 中无遗留临时文件。
