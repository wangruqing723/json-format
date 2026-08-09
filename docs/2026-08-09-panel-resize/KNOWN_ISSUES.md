# KNOWN_ISSUES —— 面板可调宽与顶栏收口

## [2026-08-09] E4 字体改为 base64 内联，而非独立哈希文件

- 发现于：E4 / `src/styles.css` @font-face
- 情况：把图标字体从 `public/fonts/` 移到 `src/assets/fonts/` 走 Vite 资源管线后，
  子集字体仅 3160B，低于 Vite 默认 4KB 内联阈值，被 base64 直接内联进 CSS bundle。
- 结论：**这满足甚至优于原目标**。缓存失效链路变为「字体内容变 → CSS 内容变 →
  CSS 文件名哈希变（实测 `index-<hash>.css`）→ 缓存自然失效」，且省掉一次字体请求。
  不是缺陷，记录以免后人误以为 @font-face 没生效。
- 若将来字体增大越过 4KB：会自动改为独立哈希文件，同样破缓存，无需改动。
- 状态：按预期工作，无需处理。

## [2026-08-09] 图标子集脚本依赖不入库的外部前提

- 发现于：E4 顺带 / `scripts/build-icon-subset.mjs`
- 问题：脚本依赖完整源字体（`/private/tmp/` 或 `~/Library/Caches/`）与 `pyftsubset`
  （`/private/tmp/fonttools-venv/`），二者都不在仓库内。换机器或清理 `/tmp` 后
  `npm run icons:subset` 会失败。本批次未新增图标，故未实际运行该脚本，仅把输出路径
  从 `public/fonts/` 改到 `src/assets/fonts/`。
- 建议：后续把源字体获取（下载到缓存目录）与 fontTools 安装写进脚本自举，或在
  README 记录前置步骤。属上一批 A3 遗留，非本批次引入。
- 状态：待后续处理，本批次不阻塞。

## [2026-08-09] 本批次由架构师直接实现（流程说明）

- 背景：本批次（E1–E4）原计划委托 Codex，但委托通道连续报
  `claude-opus-5[1M] temporarily unavailable`，在用户多次「继续」指示下改由架构师直接落地。
- 影响：仅流程偏离，产物与验收标准不变（85 测试全绿、`tsc -b` + `vite build` 干净）。
- 状态：已如实告知用户，由用户决定是否接受。
