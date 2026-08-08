# KNOWN_ISSUES

## [2026-08-08] Material Symbols 未子集化,占包体 313KB

- 发现于:T2 / T12,`public/fonts/MaterialSymbolsOutlined-Variable.woff2`
- 问题描述:规划时估计约 400KB,实测全轴版(opsz/wght/FILL/GRAD)为 **3.8MB**。
  已改用仅 `wght` 单轴版压到 **313KB**,但仍是包体里最大的单项 —— 项目实际只用到约 22 个字形。
- 建议:按实际字形子集化可压到约 20KB(降幅 94%)。需要 `fontTools`(`pip install fonttools`),
  本机未安装且安装需联网,Codex 沙箱无网络权限,故本次未做。
- 影响:仅包体积,功能与显示不受影响。
- 状态:待决策(P2 优化项,非阻塞)

## [2026-08-08] T11 键盘走查未在真实浏览器中执行

- 发现于:T11
- 问题描述:Codex 沙箱不允许监听端口(`listen EPERM 127.0.0.1:1420`),无法启动 dev server
  做真实浏览器的键盘与焦点走查。
- 已做的替代验证(由架构师执行):
  - 静态核查 6 个快捷键处理器齐全(`Ctrl/⌘ K/N/O/S/W`、`Shift+Alt+F`)
  - `:focus-visible` 样式保留
  - 两个 `prefers-reduced-motion` 块存在,其中第二个专门降级霓虹发光的 `box-shadow`
  - dev server 冒烟通过:首页与 5 个字体文件均返回 200
  - 对比度脚本实读 `styles.css` token,46 组组合全部 ≥ 4.5:1(最低 4.70:1)
- 未覆盖的部分:实际 Tab 序、屏幕阅读器朗读结果、窄屏 700px / 430px 的真实渲染。
- 建议:人工在 `npm run dev` 下走查一遍,或安装 Playwright 做自动化校验。
- 状态:待人工验收
