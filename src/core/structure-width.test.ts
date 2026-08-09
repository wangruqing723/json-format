import { describe, expect, it } from 'vitest';
import {
  clampStructureWidth,
  stepStructureWidth,
  widthFromDrag,
  STRUCTURE_PANEL_DEFAULT_WIDTH,
  STRUCTURE_PANEL_MAX_WIDTH,
  STRUCTURE_PANEL_MIN_WIDTH,
} from './structure-width';

describe('结构面板宽度钳制', () => {
  it('区间内的值原样保留', () => {
    expect(clampStructureWidth(400)).toBe(400);
  });

  it('低于下界收敛到 240', () => {
    expect(clampStructureWidth(100)).toBe(STRUCTURE_PANEL_MIN_WIDTH);
    expect(clampStructureWidth(-999)).toBe(STRUCTURE_PANEL_MIN_WIDTH);
  });

  it('高于上界收敛到 720', () => {
    expect(clampStructureWidth(2000)).toBe(STRUCTURE_PANEL_MAX_WIDTH);
  });

  it('边界值本身合法，不被多收一格', () => {
    expect(clampStructureWidth(STRUCTURE_PANEL_MIN_WIDTH)).toBe(STRUCTURE_PANEL_MIN_WIDTH);
    expect(clampStructureWidth(STRUCTURE_PANEL_MAX_WIDTH)).toBe(STRUCTURE_PANEL_MAX_WIDTH);
  });

  it('小数取整，避免亚像素宽度', () => {
    expect(clampStructureWidth(300.6)).toBe(301);
  });

  // 持久化里可能存进脏值（手改 localStorage、旧版本字段类型变更），
  // NaN 流进 CSS 变量会让宽度变成 auto，面板直接塌掉，所以必须退回默认值。
  it('非有限数退回默认值而不是产出 NaN', () => {
    expect(clampStructureWidth(Number.NaN)).toBe(STRUCTURE_PANEL_DEFAULT_WIDTH);
    expect(clampStructureWidth(Number.POSITIVE_INFINITY)).toBe(STRUCTURE_PANEL_DEFAULT_WIDTH);
    expect(clampStructureWidth(undefined as unknown as number)).toBe(STRUCTURE_PANEL_DEFAULT_WIDTH);
  });
});

describe('键盘步进', () => {
  it('每次 16px', () => {
    expect(stepStructureWidth(400, 1)).toBe(416);
    expect(stepStructureWidth(400, -1)).toBe(384);
  });

  it('到边界后停住，不越界', () => {
    expect(stepStructureWidth(STRUCTURE_PANEL_MAX_WIDTH, 1)).toBe(STRUCTURE_PANEL_MAX_WIDTH);
    expect(stepStructureWidth(STRUCTURE_PANEL_MIN_WIDTH, -1)).toBe(STRUCTURE_PANEL_MIN_WIDTH);
  });

  it('接近边界时只走到边界，不回弹', () => {
    expect(stepStructureWidth(STRUCTURE_PANEL_MAX_WIDTH - 5, 1)).toBe(STRUCTURE_PANEL_MAX_WIDTH);
  });
});

describe('拖拽换算', () => {
  // 句柄在面板左缘：指针右移意味着左缘向右，面板变窄。
  it('指针右移使面板变窄', () => {
    expect(widthFromDrag(400, 50)).toBe(350);
  });

  it('指针左移使面板变宽', () => {
    expect(widthFromDrag(400, -50)).toBe(450);
  });

  it('拖过头也被钳制在区间内', () => {
    expect(widthFromDrag(400, 9999)).toBe(STRUCTURE_PANEL_MIN_WIDTH);
    expect(widthFromDrag(400, -9999)).toBe(STRUCTURE_PANEL_MAX_WIDTH);
  });
});
