# TASKS(第二轮):搜索栏位置 / 提示可见性 / 亮色高亮 / 图标子集化接线

承接同目录 `TASKS.md`(D1-D11 已完成并验收)。本轮修用户实测的三项,加上架构师已完成的
图标子集化的代码接线。

格式:`[ ] 任务名 | 优先级 | 估时 | 依赖`

## 用户已拍板

| 决策项 | 选择 |
|---|---|
| 图标字体 | **用 codepoint + Icon 组件内维护映射表**(字体 316KB → 2.8KB) |
| toast 提示 | **移到顶部 + 给 neutral 档加区分色** |

---

- [ ] S1 搜索面板移到编辑器顶部 | P0 | 0.5h | —
  - 现状:`src/components/JsonEditor.tsx` **只加了 `searchKeymap`,没有配置 `search()` 扩展**,
    所以面板用默认位置(底部)
  - 装的 `@codemirror/search` 支持 `top` 选项(`dist/index.d.ts:186` 有 `top?: boolean`),
    加 `search({ top: true })` 到扩展列表即可
  - **顺带修一个既有实现问题**:`JsonEditor.tsx:230` 的 `openSearch()` 是靠
    `contentDOM.dispatchEvent(new KeyboardEvent('keydown', ...))` 合成按键来触发搜索的,
    还要判断 `navigator.platform` 拼 `Meta-f`/`Control-f`。
    `@codemirror/search` 导出了 `openSearchPanel(view)` 正规 API,直接调它,
    删掉合成按键与平台判断 —— 合成事件依赖 keymap 未被改动,很脆
  - 验收:`Ctrl/⌘ F` 与顶栏放大镜按钮都能唤出搜索面板,且面板出现在编辑器**上方**

- [ ] S2 toast 移到顶部并加区分色 | P0 | 1h | —
  - 现状 `src/styles.css:971` `.toast` 是 `bottom: 38px`,而 `neutral` 档**没有任何区分色**
    (只有 `--panel` 底 + `--border-strong` 灰边),用户实测反馈"不显眼"
  - 要做:
    - 位置从底部改到**顶部**(工具栏下方居中),`z-index` 保持在弹窗之下、工具栏之上
    - 三档都要有明确视觉身份:`neutral` / `success` / `error` 各自的边框色 + 左侧色条或图标
      (`info` / `check_circle` / `error`),不要只靠边框颜色区分
    - 沿用霓虹语言:暗色下可用现有的 `box-shadow: 0 0 12px rgba(...)` 发光,亮色下用常规投影
    - 保持 `role="status"` + `aria-live="polite"` 不变
  - 注意别遮挡 ActionBar 的状态药丸和「更多」菜单弹层 —— 检查一下这几个的层叠与位置
  - 验收:三档提示在亮暗两套下都一眼可辨;不遮挡工具栏交互元素

- [ ] S3 亮色语法高亮重做 | P0 | 1h | —
  - 用户反馈亮色"不太醒目,相当于没有一样",暗色"显眼程度还可以"
  - **真因(架构师已量化定位)**:亮色现状六个语法色的 CIELAB **L\* 跨度只有 5**(35~40),
    全挤在同一明度带,而默认正文色也是深色,眼睛分辨深色之间的色相差异远弱于分辨亮色。
    暗色 L\* 跨度 18 且色更亮压在深底上,所以一眼可分。
    两两感知距离(ΔE)方面:亮色现状最小 **17.7**(`string` ↔ `null` 几乎难分),暗色是 20.4
  - 注意:**不是彩度问题** —— 实测亮色现状平均彩度 C\*=48.5,反而略高于暗色的 45.7。
    不要靠"再调饱和"解决
  - **暗色保持不动**(用户认可),只改亮色。新配色已算好并验过,直接采用(见本文档末)
  - 亮色选区底必须同步从 `#ffd9e2` 提淡到 `#ffe9ef` —— 原值过深,会把语法色的对比度
    压到 4.5 以下(实测 `#ffd9e2` 下有 2 项不达标)。**两者配套,不要只改一个**
  - `styles.css` 里树视图的 `.tree-value--number` / `--boolean` 等取色要同步,
    避免编辑器与树视图对同一类型显示不同颜色
  - 验收:亮色 6 类 token 在「白底 / 活动行 / 选区」三种背景下全部 ≥ 4.5:1(脚本实测),
    并报告新的最小 ΔE 与 L\* 跨度

- [ ] S4 图标改用 codepoint,接入子集字体 | P0 | 1.5h | —
  - **子集化架构师已做完**(Codex 沙箱无网络,由架构师在本机用 fontTools 完成):
    - 新字体:`public/fonts/MaterialSymbolsOutlined-subset.woff2`,**2.8KB**(原 316KB)
    - 旧的 `MaterialSymbolsOutlined-Variable.woff2` 已删除
    - `public/fonts/` 总计从 468KB 降到 **156KB**
  - 为什么必须改成 codepoint:保留连字机制的话,子集器要保留「所有能被 ASCII 拼出名字的图标」,
    闭包几乎等于全字体 —— 实测保留连字只能压到 244KB,而按 codepoint 取是 2.8KB。
    所以子集字体里**已丢弃整个 GSUB 表,连字不再生效**,必须按 codepoint 渲染
  - 要做:
    - `src/styles.css` 的 `@font-face` 指向新文件名
    - `src/components/Icon.tsx` 内维护 `name → codepoint` 映射表(见本文档末 34 项),
      **对外 API 不变**,调用处继续写 `<Icon name="search" />`,组件内部把 name 转成
      `String.fromCodePoint(0x...)` 渲染
    - 保留 `aria-hidden="true"`
    - 映射表里查不到的 name:开发模式下 `console.warn` 提示,生产不崩溃(渲染空白即可)
    - **补一条单测**:遍历 `src/` 里所有 `<Icon name="..." />` 的字面量与 `icon: '...'` 字段,
      断言每个都在映射表里 —— 防止以后新增图标忘了加映射(那样图标会静默消失)
  - 验收:界面所有图标正常显示,无方框、无字面文本;新增未映射图标时单测会失败

- [ ] S5 区分「历史」与「恢复」图标 | P2 | 0.2h | S4
  - 架构师查证:Material Symbols 里 `restore` 与 `history` 是**同一字形的别名**
    (官方 codepoints 清单里两者都是 `e8b3`,字体中该码位指向 glyph `history`),
    这是 Google 上游设计而非本项目 bug
  - 后果:顶栏「历史」导航项与 HistoryView 卡片里的「恢复」按钮图标完全一样
  - 建议把恢复动作换成 `settings_backup_restore`(`e8ba`)之类的区分图标。
    若采纳,记得同步 S4 的映射表并重跑子集化 —— **子集化脚本在架构师那边,
    你只需在 KNOWN_ISSUES.md 记录需要新增的 codepoint,架构师会重新生成字体**

---

## 亮色语法高亮配色(S3 直接采用,已验证)

编辑器底 `#ffffff`,活动行 `#fdf0f4`,**选区底改为 `#ffe9ef`**。

| Token | 色值 | L\* | 底 / 活动行 / 选区 |
|---|---|---|---|
| `propertyName` | `#0a5fd0` | 42 | 5.90 / 5.32 / 5.10 |
| `string` | `#00736a` | 43 | 5.74 / 5.18 / 4.96 |
| `number` | `#a94f00` | 44 | 5.52 / 4.98 / 4.77 |
| `bool` | `#7629c0` | 36 | 7.37 / 6.65 / 6.37 |
| `null` | `#c8102e` | 43 | 5.88 / 5.31 / 5.09 |
| `brace` / `squareBracket` | `#5d6470` | 42 | 5.96 / 5.38 / 5.15 |

chrome:`caretColor` `#b80048`、`selectionBackground` `#ffe9ef`、
`matchingBracket` 底 `#d9f3e2` + `outline #006970`。

改进量(实测):
- 最小 ΔE:**17.7 → 30.1**(提升 70%)
- 与默认正文色 `#261d20` 的最小 ΔE:25.9 → **31.5**
- 对比度不达标项:**0**
- 选区可见度(选区 vs 白底):1.16(仍能看出选中)

暗色保持现状不动:`#5ce6d5` / `#ff8fb4` / `#ffc76b` / `#c79bff` / `#ff7b85` / `#a49ac1`,
选区 `#3a2b4a`,caret `#00ffcc`。

## 图标 name → codepoint 映射(S4 直接采用)

来自 Google 官方 `MaterialSymbolsOutlined[...].codepoints` 清单,
并已逐个在子集字体的 cmap 中验证存在(34/34 可渲染)。

```ts
const ICON_CODEPOINTS = {
  account_tree: 'e97a',          api: 'f1b7',
  auto_awesome: 'e65f',          auto_fix_high: 'e663',
  bolt: 'ea0b',                  bottom_panel_open: 'f729',
  check_circle: 'f0be',          chevron_right: 'e5cc',
  close: 'e5cd',                 code: 'e86f',
  compare: 'e3b9',               construction: 'ea3c',
  content_copy: 'e14d',          content_paste: 'e14f',
  dark_mode: 'e51c',             data_object: 'ead3',
  delete_sweep: 'e16c',          error: 'f8b6',
  expand_more: 'e5cf',           folder_open: 'e2c8',
  format_align_justify: 'e235',  help: 'e8fd',
  history: 'e8b3',               info: 'e88e',
  light_mode: 'e518',            more_horiz: 'e5d3',
  note_add: 'e89c',              restore: 'e8b3',
  save: 'e161',                  search: 'ef7a',
  sensors: 'e51e',               settings: 'e8b8',
  swap_horiz: 'e8d4',            warning: 'f083',
} as const;
```

> 提醒:不要自行用「从字体 cmap 反查字形名」的方式生成映射。架构师试过,
> Material Symbols 有大量 legacy Material Icons 别名码位指向同一字形,
> 反查会取到别名而非规范码位(实测 34 项里有 8 项对不上)。以上表为准。

## 全局约束

1. **41 个现有测试必须全绿**,不许改断言;`.diff-line--changed` 类名保留
2. 所有现有 `aria-label` / `role` / 可访问名文案**逐字保留**
3. 不动 `src/core/` 与 `src/stores/` 的既有领域逻辑
4. `history` 不进 `persistWorkspace()` 白名单,`PersistedWorkspace.version` 保持 `1`
5. **不要重新下载字体、不要跑 npm install、不要尝试联网** —— 都已就绪
6. **不自动 git commit**
7. 每个任务完成后跑 `npm run build && npm test`
8. 临时脚本写在**项目根目录内**,验收后删除
9. 不要为了让 jsdom 断言变绿而调整实现。jsdom 不做 CSS 校验也不做布局计算,
   测不了的就在 `KNOWN_ISSUES.md` 里说明,不要用假断言充数
10. 遇沙箱拒绝立刻停下贴完整错误原文,不要重试
