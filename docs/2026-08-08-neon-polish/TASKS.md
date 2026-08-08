# TASKS:霓虹改造收尾 + 桌面化适配

承接 `docs/2026-08-08-neon-ui-revamp/`(T1-T11 已完成并验收)。本轮修用户实测发现的问题,
以及架构师审出的桌面打包适配缺陷。

格式:`[ ] 任务名 | 优先级 | 估时 | 依赖`

**前提认知(贯穿全部任务)**:本项目**不是网页,是要打包成 Windows 与 macOS 安装包的 Tauri 桌面应用**。
任何"在浏览器里能跑就行"的实现都要按桌面场景重新审视:无浏览器地址栏、无浏览器菜单、
CWD 不是仓库根、关窗走 Tauri 生命周期而非 `beforeunload`、权限受 `capabilities` 白名单约束。

## 用户已拍板的三个方案

| 决策项 | 选择 |
|---|---|
| 弹窗 | **自绘应用内弹窗**(不用 Tauri 原生 `dialog.ask`,系统弹窗会破坏霓虹视觉语言) |
| 语法高亮 | **保持多色相,换成与新 chrome 同色系**;亮暗**两套**独立配色 |
| Diff 编辑 | **左右两侧都可编辑** |

---

## P0 — 桌面化适配(打包后会实际出问题)

- [ ] D1 自绘确认弹窗组件 | P0 | 2h | —
  - 替换全部 3 处原生 `window.confirm`:
    - `src/App.tsx:280` 关闭脏文档
    - `src/App.tsx:430` 恢复快照覆盖未保存内容
    - `src/components/HistoryView.tsx:41` 清空操作历史
  - 原生 `confirm` 在打包后会显示 WebView 窗口标识(用户实测截图为 `localhost:1420 显示`),
    且无法定制样式、阻塞 JS 线程、macOS 与 Windows 外观不一致
  - 新建 `src/components/ConfirmDialog.tsx`,契约见本文档末「ConfirmDialog 接口」
  - 因为原生 `confirm` 是同步阻塞、自绘弹窗是异步的,**三处调用点的控制流都要改成 async/promise 或状态机**,
    不要用 `await` 假装同步后忘了处理"用户直接关窗"的分支
  - 无障碍要求:`role="alertdialog"`、`aria-modal="true"`、`aria-labelledby` + `aria-describedby`、
    焦点陷阱、Esc 关闭 = 取消、Enter 触发默认按钮、**初始焦点落在安全按钮(取消)而非危险按钮**、
    关闭后焦点还原到触发元素(参考 `CommandPalette` / `SettingsDialog` 已有的焦点还原实现)
  - 危险操作(关闭脏文档、覆盖、清空历史)确认按钮用 `--danger` 色系
  - 验收:三处确认流程都能走通(确认/取消/Esc/点遮罩/Enter);键盘全程可操作;补组件单测

- [ ] D2 修 Docs 侧栏项在打包后必然失效 | P0 | 0.5h | —
  - `src/services/platform.ts:116` `openProjectDocs()` 有三个叠加问题:
    1. `openPath('README.md')` 是**相对路径**,打包后 CWD 不是仓库根,解析不到
    2. `src-tauri/capabilities/default.json` 只有 `opener:allow-reveal-item-in-dir`,
       **没有 `opener:allow-open-path`**,运行时会被权限拒绝
    3. README.md 没进 bundle resources,**装好的应用里根本没这个文件**
  - 三个选项择一(倾向 C,最省事且无新权限):
    - A. README.md 加进 `tauri.conf.json` 的 `bundle.resources`,用 `resolveResource()` 取绝对路径,
      并补 `opener:allow-open-path` 权限
    - B. 用 `opener` 打开线上仓库 URL(需补 `opener:allow-open-url`,且离线不可用)
    - C. **改成应用内「关于/帮助」弹窗**,内容内嵌(版本号、快捷键表、项目简介),零新权限、离线可用
  - 若选 C,顺带把快捷键表放进去 —— 桌面应用没有浏览器地址栏可提示,快捷键需要有处可查
  - 验收:说明选了哪个方案及理由;若涉及新权限,`capabilities/default.json` 同步更新

- [ ] D3 关窗未保存拦截改走 Tauri 生命周期 | P0 | 1h | D1
  - `src/App.tsx:167` 用 `beforeunload` 拦未保存关闭。**Tauri 关窗走 `onCloseRequested`,
    `beforeunload` 不保证触发 —— 这是真实的数据丢失风险**
  - Tauri 运行时改用 `getCurrentWindow().onCloseRequested(async (event) => { ... })`,
    有脏文档时 `event.preventDefault()` 并弹 D1 的确认弹窗
  - **浏览器运行时保留 `beforeunload`**(项目支持 `npm run dev` 网页调试,`isTauriRuntime()` 已有此分支惯例)
  - `flushPersistence()` 在两条路径下都要调用
  - 验收:Tauri 下有脏文档点关窗弹自绘确认、取消能真的阻止关闭;浏览器下 `beforeunload` 行为不变

- [ ] D4 屏蔽 WebView 默认右键菜单 | P1 | 0.5h | —
  - 桌面应用里右键弹出「重新加载 / 检查元素」这类浏览器菜单会明显出戏
  - 生产构建屏蔽默认 `contextmenu`;**开发模式保留**(否则丢失调试能力),用 `import.meta.env.DEV` 区分
  - **输入框、文本域、CodeMirror 编辑区必须放行**,否则用户失去剪切/复制/粘贴/拼写检查等系统菜单 ——
    这是功能回退,不是风格问题
  - 验收:生产构建下非输入区右键无浏览器菜单;编辑器与输入框内右键菜单正常

## P0 — 用户实测发现的问题

- [ ] D5 空内容 / 非法 JSON 不应静默保存 | P0 | 1h | D1
  - `src/App.tsx:260` `handleSave` 只判了 `if (!current) return`,**空文档和非法 JSON 都会直接写盘**
  - 期望:
    - 内容为空或纯空白 → 阻止保存,toast 提示「文档为空,无内容可保存」
    - 内容非法 JSON → 不直接拦死,弹 D1 确认弹窗问「当前 JSON 存在语法错误,仍要保存吗?」
      (用户可能就是想存一份待修的草稿,硬拦是家长式设计)
  - 复用 `diagnostics` 里已有的校验结果,**不要新起一次解析**
  - 大文档受限模式(超 `AUTO_VALIDATE_LIMIT` 无 diagnostics)时不拦,直接保存
  - 验收:空文档保存被拦并提示;非法 JSON 保存弹确认且可选择继续;合法 JSON 保存无额外打扰

- [ ] D6 命令面板 + 设置面板霓虹化 | P0 | 2h | —
  - 上一轮 T9 点名了这两个组件,但实际只做了 `lucide` → `Icon` 的图标替换,**零样式改动**
    (`CommandPalette.tsx` 改 6 行、`SettingsDialog.tsx` 改 4 行,全是 import 和图标)
  - 按 `docs/2026-08-08-neon-ui-revamp/DESIGN.md` §3 的 token 与 §8 的玻璃拟态工具类补齐:
    圆角 6-12px、`glass-panel-heavy` 遮罩、活动项用 `--accent-soft` + accent 左边框、
    `kbd` 快捷键胶囊霓虹化、字体按 §7 用 `--font-headline` / `--font-label`
  - **`role` / `aria-*` / 可访问名一律不动**(`combobox`、`listbox`、`option`、
    `aria-activedescendant`、`搜索命令`、`关闭设置`、`深色`/`浅色`/`跟随系统`)
  - 验收:37 个测试全绿;两个面板视觉与 Sidebar / ActionBar 同调

- [ ] D7 语法高亮换同色系(亮暗两套) | P0 | 1h | —
  - 现状:`JsonEditor.tsx` 的高亮是**改造前的旧配色原封未动**(冷蓝 `#075fb8` / 绿 `#087b52` 等),
    与霓虹 chrome 脱节,用户反馈「太单一」。保持多色相不变,但整体拉到新色系
  - 配色已由架构师算好并验过对比度,**直接采用**(见本文档末「语法高亮配色」)
  - 暗色选区同时要改成 `#3a2b4a`,标点色 `#a49ac1` 是为在该选区上达标而定的,两者配套不要拆开
  - 验收:亮暗两套下 6 类 token 在「编辑器底 / 活动行 / 选区」三种背景上全部 ≥ 4.5:1(脚本实测)

- [ ] D8 StructurePanel 长 value 溢出与徽章可读性 | P0 | 1.5h | —
  - 用户实测:JWT 那种长字符串会顶满整行把 key 挤掉(`styles.css:1456` `.structure-summary`
    有 ellipsis,但 `margin-left: auto` 在长内容下失效)
  - 且 `.structure-type--string`(`styles.css:1460`)用霓虹粉 `--accent` 当徽章底、
    紧邻斜体小字 value,用户反馈「文字都看不清」
  - 要做:
    - key 区与 value 区给确定的宽度分配(如 key `min-width` + value `max-width` + `flex-shrink`),
      保证**长 value 绝不挤压 key**,超出以 ellipsis 截断
    - value 完整内容通过 `title` 或 tooltip 可查
    - 类型徽章改用「低饱和底 + 同色系文字」而非高饱和霓虹实底
      (参考项目亮色模式就是这个思路:`bg-[#7af1fc]/20` 配 `text-[#006970]`),
      并确保徽章文字与徽章底 ≥ 4.5:1
  - 验收:贴一个含 200+ 字符 value 的截图或 DOM 断言证明 key 未被挤压;徽章对比度实测达标

- [ ] D9 Diff 左右双向可编辑 | P1 | 2h | —
  - 现状 DiffView 纯只读。参考项目右侧可编辑且有 Merge;用户要求**左右都可编辑**
  - 两侧都接 `updateContent(documentId, content)`,编辑后 diff 结果实时重算
  - 大文档沿用现有 `STRUCTURED_VIEW_LIMIT`(5MB)阈值,超限保持只读并提示原因
  - `buildDiffRows` 的导出与逻辑**不要改**(`components.test.tsx` 直接测它),
    `.diff-line--changed` 类名继续保留
  - 现有 `aria-label`「左侧（窄屏上方）：X」「右侧（窄屏下方）：X」逐字保留
  - 编辑时注意别让实时重算把光标位置冲掉(参考 `JsonEditor` 的 `applyEdit` 处理方式)
  - 验收:两侧均可编辑且 diff 实时更新;37 个测试全绿;大文档下正确降级为只读

- [ ] D10 切换文档时退出 Diff / 历史视图 | P1 | 0.5h | —
  - 用户实测:在 Diff 或历史视图下点文档标签「没有其他变化」。确认是 bug ——
    `src/App.tsx:562` `onSelectDocument={setActive}` 只切了 `activeDocumentId`,
    **没清 `diff` 也没关 `historyOpen`**,主区仍停在原视图上,看起来像点了没反应
  - 期望:点标签 = 切到该文档的文本/树视图,即 `setActive` + `setDiff(null)` + 关闭历史视图
  - 侧栏 Explorer 里选文档、以及标签栏点标签,**两条入口都要修**
  - 验收:Diff 与历史视图下点任一文档入口,都能回到该文档的编辑视图

## P2 — 非阻塞

- [ ] D11 Material Symbols 子集化 | P2 | 0.5h | —
  - 承接上一轮 T12(未做)。当前 313KB,按实际用到的约 22 个字形可压到 ~20KB
  - 需要 `fontTools`,**装它要联网而 Codex 沙箱无网络** —— 若仍不可用就跳过,
    在 `KNOWN_ISSUES.md` 保留记录即可,不要为此卡住其他任务

---

## 语法高亮配色(D7 直接采用,已验对比度)

架构师已用脚本实测:两套 6 类 token 在「编辑器底 / 活动行 / 选区」三种背景下全部 ≥ 4.5:1。

### 暗色(编辑器底 `#0a0a12`,活动行 `#141422`,选区 `#3a2b4a`)

| Token | 色值 | 最差对比度 | 说明 |
|---|---|---|---|
| `propertyName` | `#5ce6d5` | 11.91:1 | 青绿,呼应 `--secondary #00ffcc` 但压暗以免刺眼 |
| `string` | `#ff8fb4` | 8.53:1 | 暖粉,呼应 `--accent #ff2d78` |
| `number` | `#ffc76b` | 11.83:1 | 琥珀,呼应 `--warning #ffe04a` |
| `bool` | `#c79bff` | 8.29:1 | 紫,与青/粉/琥珀明确区分 |
| `null` | `#ff7b85` | 7.31:1 | 红,呼应 `--danger #ff4444` |
| `brace` / `squareBracket` | `#a49ac1` | 4.91:1 | 灰紫,标点不抢眼但仍比正文淡一档 |

chrome:`caretColor` `#00ffcc`、`selectionBackground` `#3a2b4a`、
`matchingBracket` 底 `#1a4d47` + `outline #00ffcc`。

> 标点 `#a49ac1` 与选区 `#3a2b4a` 是配套解出来的:选区若压暗到能容纳更暗的标点色,
> 就会与编辑器底反差不足(< 1.3)导致选中状态看不出来;所以改为提亮标点。**两者不要单独改动。**

### 亮色(编辑器底 `#ffffff`,活动行 `#fdf0f4`,选区 `#ffd9e2`)

| Token | 色值 | 最差对比度 | 说明 |
|---|---|---|---|
| `propertyName` | `#006970` | 5.00:1 | 青,与亮色 `--secondary` 同值 |
| `string` | `#a8003f` | 5.95:1 | 深玫红,呼应 `--accent #b80048` |
| `number` | `#8a4b00` | 5.27:1 | 棕橙 |
| `bool` | `#6b2fb0` | 6.12:1 | 紫 |
| `null` | `#b4232e` | 5.05:1 | 红,与亮色 `--danger` 同值 |
| `brace` / `squareBracket` | `#5f5560` | 5.51:1 | 灰 |

chrome:`caretColor` `#b80048`、`selectionBackground` `#ffd9e2`、
`matchingBracket` 底 `#d9f3e2` + `outline #006970`。

> `.tree-value--number` / `--boolean`(`styles.css:694,696`)与树视图的取色应同步到上表,
> 避免编辑器与树视图对同一类型显示不同颜色。

## ConfirmDialog 接口(D1)

`src/components/ConfirmDialog.tsx`

```ts
export interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel?: string;        // 默认「确定」
  cancelLabel?: string;         // 默认「取消」
  tone?: 'default' | 'danger';  // danger 时确认按钮用 --danger 色系
}

interface ConfirmDialogProps {
  request: ConfirmRequest | null;   // null = 关闭
  onResolve: (confirmed: boolean) => void;
}
```

建议同时提供一个 `useConfirm()` hook 返回 `(request) => Promise<boolean>`,
让三处调用点写起来接近原来的 `confirm` 手感,避免散落的 open/resolve 状态管理。

约束:
- 不要在组件内直接读 store,状态由父级持有
- 同一时刻只允许一个确认弹窗;与 `CommandPalette` / `SettingsDialog` 的 Esc 处理不要互相抢
- `tone: 'danger'` 时初始焦点**仍落在取消按钮**

## 全局约束

1. **37 个现有测试必须全绿**,不许改断言迁就实现。`.diff-line--changed` 类名继续保留
2. 所有现有 `aria-label` / `role` / 可访问名文案**逐字保留**
3. 不动 `src/core/` 与 `src/stores/` 的既有领域逻辑(D5 复用现成 diagnostics,不新起解析)
4. `history` 仍不得进 `persistWorkspace()` 序列化白名单,`PersistedWorkspace.version` 保持 `1`
5. 新增依赖 pin 确切版本;**能不加依赖就不加**(自绘弹窗不要引入 UI 库)
6. **不自动 git commit**
7. 每个任务完成后跑 `npm run build && npm test`,不要攒到最后
8. 临时脚本写在**项目根目录内**(沙箱只拦项目外写入),验收后删除
9. 若遇沙箱拒绝(网络/写入/端口),立刻停下贴完整错误原文,不要重试 —— 架构师会处理
10. 发现设计问题写 `docs/2026-08-08-neon-polish/KNOWN_ISSUES.md`,不要自行改架构
