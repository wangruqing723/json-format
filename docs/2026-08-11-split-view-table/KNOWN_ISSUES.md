# 已知问题 —— 分屏视图 + 表格提取

> 归档状态：本文记录的问题均已解决或澄清，无遗留阻塞项。归档结论见 `ARCHIVE.md`。

> Codex 首轮委托（task-msorjsih-emuu98）读文档阶段发现以下契约不一致，随后因
> 429 限流中断、未写代码。以下问题已由架构师（Claude）在权威文档中裁定，重派前生效。

## [2026-08-11] CollapsedPane 空值表示不一致 —— 已解决
- 发现于: T3 / `DESIGN.md`、`API_SPEC.md`
- 问题: `DESIGN.md` 用 `'none' | 'text' | 'tree'`，`API_SPEC.md` 误写成 `null | 'text' | 'tree'`。
- 裁定: 统一为 **`'none' | 'text' | 'tree'`**。`API_SPEC.md` §1 已改，`DESIGN.md` §4.1 补了理由
  （旧快照缺字段是 `undefined`，用 `null` 表「不折叠」会与之混淆；纯字符串联合让 sanitize 保持单一 includes 判断）。
- 状态: **已解决**（文档已一致）

## [2026-08-11] 远程图片设置字段名不一致 —— 已解决
- 发现于: T3/T10 / `DESIGN.md` §8.2
- 问题: `DESIGN.md` §8.2 用 `remoteImagePreview`，其余处用 `allowRemoteImagePreview`。
- 裁定: 统一为 **`allowRemoteImagePreview`**（`AppSettings` 字段名）；`TreeView` 的 prop 仍叫 `allowRemoteImages`（见 `API_SPEC.md` §6.2）。`DESIGN.md` §8.2 已改。
- 状态: **已解决**

## [2026-08-11] FlatRow childCount 契约缺失 —— 已解决
- 发现于: T4 / `TASKS.md`、`API_SPEC.md`
- 问题: 早期 `TASKS.md` 要求 `FlatRow` 加 `childCount`，`API_SPEC.md` 只列 `isLast` + `parentType`。
- 裁定: **不加 `childCount`**。折叠态 `{…} 3` 的计数由 `row.node`（`entries.length`/`items.length`）现算，
  存进 FlatRow 是冗余字段 + 第二真值来源。以 `API_SPEC.md` §4.1 为准（`isLast` + `parentType`）。`TASKS.md` T4 已改。
- 状态: **已解决**

## [2026-08-11] 表格混合数组形态冲突 —— 已解决
- 发现于: T11 / `TASKS.md`、`API_SPEC.md`
- 问题: `DESIGN.md`/`API_SPEC.md` 规定含标量的混合数组归 `scalars`，`TASKS.md` 验收却说按 `records` 且标量落首列。
- 裁定: **归 `scalars`**，每个元素整体压成一格。以 `API_SPEC.md` §3 为准。`TASKS.md` T11 验收已改。
- 状态: **已解决**

## [2026-08-11] 项目约定文件路径 —— 已澄清
- 发现于: 实现前置检查
- 问题: Codex 用 `rg --files -g 'CLAUDE.md'` 搜不到，误判文件缺失。
- 澄清: 文件在 **`.claude/CLAUDE.md`**（已入库，提交 `e15b2b6`），`rg` 默认跳过隐藏目录。
  用 `rg --hidden` 或直接读该路径。`DESIGN.md` §12.4 已补此坑及「仓库根另有一套首版遗留同名文档」的提醒。
- 状态: **已澄清**
