/**
 * 分屏比例的取值规则。
 *
 * 钳制、键盘步进和拖拽换算都集中在这个纯计算模块中，避免不同输入路径
 * 对边界和脏数据产生不一致的处理结果。
 */

export const SPLIT_RATIO_MIN = 0.2;
export const SPLIT_RATIO_MAX = 0.8;
export const SPLIT_RATIO_DEFAULT = 0.5;
/** 键盘左右/上下键的调整步进 */
export const SPLIT_RATIO_STEP = 0.05;

/**
 * 把任意输入收敛到合法比例。
 * 非有限数（NaN / Infinity / 反序列化出来的字符串）一律退回默认值，
 * 避免 NaN 流进 CSS 变量把分屏比例变成 auto。
 */
export function clampSplitRatio(value: number): number {
  if (!Number.isFinite(value)) return SPLIT_RATIO_DEFAULT;
  return Math.min(SPLIT_RATIO_MAX, Math.max(SPLIT_RATIO_MIN, value));
}

/** 键盘调整：direction 为 1 表示放大文本侧。 */
export function stepSplitRatio(current: number, direction: -1 | 1): number {
  return clampSplitRatio(clampSplitRatio(current) + direction * SPLIT_RATIO_STEP);
}

/**
 * 拖拽换算。
 * @param position 指针在容器内的坐标（row 用 clientX - rect.left，column 用 clientY - rect.top）
 * @param total 容器在该轴上的尺寸（row 用 rect.width，column 用 rect.height）
 */
export function ratioFromDrag(position: number, total: number): number {
  if (!Number.isFinite(position) || !Number.isFinite(total) || total <= 0) {
    return SPLIT_RATIO_DEFAULT;
  }
  return clampSplitRatio(position / total);
}
