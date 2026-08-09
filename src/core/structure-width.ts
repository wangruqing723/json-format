/**
 * 结构面板宽度的取值规则。
 *
 * 单独成模块而非内联在组件里，是因为钳制与步进是纯计算：
 * 拖拽、键盘调整、以及从持久化读回的脏数据三条路径都要走同一套规则，
 * 分散写三遍必然出现边界不一致。
 */

export const STRUCTURE_PANEL_MIN_WIDTH = 240;
export const STRUCTURE_PANEL_MAX_WIDTH = 720;
export const STRUCTURE_PANEL_DEFAULT_WIDTH = 288;
/** 键盘左右键的调整步进 */
export const STRUCTURE_PANEL_STEP = 16;

/**
 * 把任意输入收敛到合法宽度。
 * 非有限数（NaN / Infinity / 反序列化出来的字符串）一律退回默认值，
 * 而不是让 NaN 流进 CSS 变量把面板宽度变成 auto。
 */
export function clampStructureWidth(value: number): number {
  if (!Number.isFinite(value)) return STRUCTURE_PANEL_DEFAULT_WIDTH;
  return Math.min(STRUCTURE_PANEL_MAX_WIDTH, Math.max(STRUCTURE_PANEL_MIN_WIDTH, Math.round(value)));
}

/** 键盘调整：delta 为正表示加宽。 */
export function stepStructureWidth(current: number, direction: -1 | 1): number {
  return clampStructureWidth(clampStructureWidth(current) + direction * STRUCTURE_PANEL_STEP);
}

/**
 * 拖拽换算：句柄在面板左缘，所以指针右移 = 面板变窄。
 * @param startWidth 按下时的面板宽度
 * @param deltaX 指针相对按下点的水平位移
 */
export function widthFromDrag(startWidth: number, deltaX: number): number {
  return clampStructureWidth(startWidth - deltaX);
}
