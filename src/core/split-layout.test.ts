import { describe, expect, it } from 'vitest';
import {
  clampSplitRatio,
  ratioFromDrag,
  SPLIT_RATIO_DEFAULT,
  SPLIT_RATIO_MAX,
  SPLIT_RATIO_MIN,
  SPLIT_RATIO_STEP,
  stepSplitRatio,
} from './split-layout';

describe('分屏比例常量', () => {
  it('使用契约规定的范围、默认值和步进', () => {
    expect(SPLIT_RATIO_MIN).toBe(0.2);
    expect(SPLIT_RATIO_MAX).toBe(0.8);
    expect(SPLIT_RATIO_DEFAULT).toBe(0.5);
    expect(SPLIT_RATIO_STEP).toBe(0.05);
  });
});

describe('分屏比例钳制', () => {
  it('区间内的值原样保留', () => {
    expect(clampSplitRatio(0.35)).toBe(0.35);
    expect(clampSplitRatio(SPLIT_RATIO_DEFAULT)).toBe(SPLIT_RATIO_DEFAULT);
  });

  it('低于下界时收敛到最小比例', () => {
    expect(clampSplitRatio(0)).toBe(SPLIT_RATIO_MIN);
    expect(clampSplitRatio(-999)).toBe(SPLIT_RATIO_MIN);
  });

  it('高于上界时收敛到最大比例', () => {
    expect(clampSplitRatio(1)).toBe(SPLIT_RATIO_MAX);
    expect(clampSplitRatio(999)).toBe(SPLIT_RATIO_MAX);
  });

  it('边界值本身合法，不被多收一格', () => {
    expect(clampSplitRatio(SPLIT_RATIO_MIN)).toBe(SPLIT_RATIO_MIN);
    expect(clampSplitRatio(SPLIT_RATIO_MAX)).toBe(SPLIT_RATIO_MAX);
  });

  it('NaN 和 Infinity 退回默认值', () => {
    expect(clampSplitRatio(Number.NaN)).toBe(SPLIT_RATIO_DEFAULT);
    expect(clampSplitRatio(Number.POSITIVE_INFINITY)).toBe(SPLIT_RATIO_DEFAULT);
    expect(clampSplitRatio(Number.NEGATIVE_INFINITY)).toBe(SPLIT_RATIO_DEFAULT);
  });

  it('反序列化得到的字符串等脏输入退回默认值', () => {
    expect(clampSplitRatio('0.6' as unknown as number)).toBe(SPLIT_RATIO_DEFAULT);
    expect(clampSplitRatio('not-a-ratio' as unknown as number)).toBe(SPLIT_RATIO_DEFAULT);
    expect(clampSplitRatio(undefined as unknown as number)).toBe(SPLIT_RATIO_DEFAULT);
  });
});

describe('键盘步进', () => {
  it('按方向移动一个步进', () => {
    expect(stepSplitRatio(0.4, 1)).toBe(0.45);
    expect(stepSplitRatio(0.6, -1)).toBeCloseTo(0.55);
  });

  it('撞到边界后停住，不越界', () => {
    expect(stepSplitRatio(SPLIT_RATIO_MAX, 1)).toBe(SPLIT_RATIO_MAX);
    expect(stepSplitRatio(SPLIT_RATIO_MIN, -1)).toBe(SPLIT_RATIO_MIN);
  });

  it('接近边界时只走到边界，不回弹', () => {
    expect(stepSplitRatio(SPLIT_RATIO_MAX - 0.01, 1)).toBe(SPLIT_RATIO_MAX);
    expect(stepSplitRatio(SPLIT_RATIO_MIN + 0.01, -1)).toBe(SPLIT_RATIO_MIN);
  });

  it('当前值为脏输入时先使用默认比例再步进', () => {
    expect(stepSplitRatio(Number.NaN, 1)).toBe(SPLIT_RATIO_DEFAULT + SPLIT_RATIO_STEP);
    expect(stepSplitRatio('0.4' as unknown as number, -1)).toBe(SPLIT_RATIO_DEFAULT - SPLIT_RATIO_STEP);
  });
});

describe('拖拽换算', () => {
  it('按指针位置换算第一侧比例', () => {
    expect(ratioFromDrag(250, 1000)).toBe(0.25);
    expect(ratioFromDrag(500, 1000)).toBe(SPLIT_RATIO_DEFAULT);
  });

  it('拖过两端时钳制在合法区间内', () => {
    expect(ratioFromDrag(-100, 1000)).toBe(SPLIT_RATIO_MIN);
    expect(ratioFromDrag(2000, 1000)).toBe(SPLIT_RATIO_MAX);
  });

  it('total 为 0 或负数时返回默认值，避免除零', () => {
    expect(ratioFromDrag(250, 0)).toBe(SPLIT_RATIO_DEFAULT);
    expect(ratioFromDrag(250, -100)).toBe(SPLIT_RATIO_DEFAULT);
  });

  it('拖拽输入为非有限数或字符串时返回默认值', () => {
    expect(ratioFromDrag(Number.NaN, 1000)).toBe(SPLIT_RATIO_DEFAULT);
    expect(ratioFromDrag(Number.POSITIVE_INFINITY, 1000)).toBe(SPLIT_RATIO_DEFAULT);
    expect(ratioFromDrag(250, Number.NaN)).toBe(SPLIT_RATIO_DEFAULT);
    expect(ratioFromDrag('250' as unknown as number, 1000)).toBe(SPLIT_RATIO_DEFAULT);
    expect(ratioFromDrag(250, '1000' as unknown as number)).toBe(SPLIT_RATIO_DEFAULT);
  });
});
