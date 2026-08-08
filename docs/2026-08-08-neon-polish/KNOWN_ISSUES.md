## [2026-08-08] Material Symbols 子集化 —— 已完成
- 发现于: D11 → S4
- 结果: 架构师在本机(有网络 + fontTools 4.55.3)完成子集化。
  `MaterialSymbolsOutlined-subset.woff2` = **2.8KB**(原 316KB),`public/fonts/` 总计 468KB → **156KB**。
- 关键约束: 子集字体**已丢弃整个 GSUB 表**,连字名不再生效,图标必须按 codepoint 渲染
  (映射表在 `src/components/Icon.tsx`)。保留连字的话子集器需保留「所有能被 ASCII 拼出名字的图标」,
  闭包几乎等于全字体 —— 实测只能压到 244KB。
- 维护须知: **新增图标必须两步同时做** —— ① 在 `Icon.tsx` 映射表加 name → codepoint;
  ② 重新生成子集字体使其包含该码位。只做 ① 会让图标静默显示为空白。
  `components.test.tsx` 有一条测试扫描全部 `<Icon name>` 与 `icon:` 字段并断言映射存在,可挡住漏 ①,
  但**挡不住漏 ②**(jsdom 不加载字体)。
- 全量字体备份: `/tmp/MaterialSymbolsOutlined-full.woff2`(临时目录,重启会丢;
  需要时从 Google Fonts 重新取 `Material+Symbols+Outlined:wght@400`)
- 状态: 已完成

## [2026-08-08] 子集字体的完整性无自动化覆盖
- 发现于: S5 收尾
- 问题描述: 上面「维护须知」的第 ② 步没有自动化保障。jsdom 不加载字体文件,
  无法断言某 codepoint 在 woff2 的 cmap 中存在。S5 就实际发生过这个问题:
  代码改用 `settings_backup_restore`(`e8ba`)后,字体里没有该字形,图标渲染为空白,
  由架构师重新生成字体才修复。
- 建议: 加一个 Node 侧脚本(非 jsdom)用 fontTools 或 `opentype.js` 读取
  `public/fonts/MaterialSymbolsOutlined-subset.woff2` 的 cmap,
  与 `Icon.tsx` 映射表做交叉校验,挂到 CI 或 pre-commit。
- 状态: 待补

## [2026-08-08] CSS 解析丢弃缺陷暂无真实浏览器自动化覆盖
- 发现于: 收尾轮 D8 / `src/styles.css`
- 问题描述: jsdom 不执行 CSS 值语法校验，无法可靠捕获浏览器对非法函数式 CSS 声明的整条丢弃行为；当前沙箱也不允许启动本地监听端口。
- 建议: 后续在允许启动 Tauri/Vite 窗口或接入真实浏览器 CI 后，补一条真实渲染回归，覆盖 StructurePanel 深层嵌套与 Grid 轨道计算。
- 状态: 已通过合法 CSS 静态检查与组件结构回归，真实浏览器验证待环境支持

## [2026-08-08] 恢复图标 codepoint —— 已解决
- 发现于: S5 / `src/components/HistoryView.tsx`
- 背景: Material Symbols 里 `restore` 与 `history` 是**同一字形的别名**
  (官方 codepoints 清单两者都是 `e8b3`,字体中该码位指向 glyph `history`),
  导致顶栏「历史」导航与历史卡片的「恢复」按钮图标完全一样。这是 Google 上游设计,非本项目 bug。
- 处理: 恢复动作改用 `settings_backup_restore`(`e8ba`),架构师已重新生成子集字体纳入该码位。
  实测 `Icon.tsx` 的 35 项映射在字体 cmap 中 **35/35 全部可渲染**。
- 状态: 已解决
