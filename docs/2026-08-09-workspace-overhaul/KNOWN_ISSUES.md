# KNOWN_ISSUES —— 工作区改造

## [2026-08-09] 手写虚拟列表替代 `@tanstack/react-virtual`

- 发现于：T3 / `src/components/TreeView.tsx`
- 问题描述：按设计文档应引入 `@tanstack/react-virtual`，本轮 Codex 沙箱无法安装 registry 依赖，保留了已通过规模验收的手写固定行高虚拟列表。
  **更正（架构师复核）**：registry 从项目环境可达（已用 `npm view @tanstack/react-virtual version` 只读验证，返回 `3.14.9`），
  受限的是 Codex 自身沙箱，不是项目环境。后续批次若需引入依赖，由架构师在本机安装后再委托，不要沿用「项目无法装依赖」的判断。
  手写实现经规模验收后决定保留（省去依赖且验收达标），该实现目前有两处已知弱点：
  1. `useVirtualWindow` 的测量 effect 依赖只有 `rows.length`，侧栏折叠等非 `window resize` 的容器尺寸变化可能使高度缓存变旧。
  2. `visible.length === 0` 时会回退渲染顶部 `OVERSCAN * 2` 行；在深处滚动后大量收起节点导致 `rows.length` 骤减时，`scrollTop` 仍可能指向旧位置并造成视觉错位。
- 建议：后续改用 `ResizeObserver` 监听容器尺寸，并在 rows 缩短时将 `scrollTop` 重置到有效范围。
- 状态：已接受的 P0 实现偏差，待后续性能批次处理。

## [2026-08-09] `json-diff` 已实现但尚未接入 DiffView

- 发现于：T10 / `src/core/json-diff.ts`
- 问题描述：`diffJsonNodes` 已实现并由 `processor.ts`、`core/index.ts` 导出/接入 worker 协议，但本轮未实现 T11/T12，`DiffView` 尚未消费结构化 diff 结果。
- 建议：后续 T11/T12 接入结构化默认模式、DiffView 虚拟化及 worker 计算。
- 状态：超出本轮 P0 委托范围，保留现状。
