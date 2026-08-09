import { useCallback, useEffect, useRef, useState } from 'react';
import {
  stepStructureWidth,
  widthFromDrag,
  STRUCTURE_PANEL_MAX_WIDTH,
  STRUCTURE_PANEL_MIN_WIDTH,
} from '../core/structure-width';

export interface StructureResizerProps {
  width: number;
  onWidthChange: (width: number) => void;
  /** 拖拽结束时回调，用于只在落点写一次持久化。 */
  onCommit?: (width: number) => void;
}

/**
 * 结构面板的拖拽句柄。
 *
 * 用 Pointer Events 而非 mousedown/mousemove：配合 setPointerCapture，
 * 指针移出句柄甚至移出窗口时仍能收到事件，不需要在 window 上挂全局监听再手动摘除。
 *
 * 语义上是 separator 而非 button —— 屏幕阅读器会播报当前宽度与可调范围。
 */
export function StructureResizer({ width, onWidthChange, onCommit }: StructureResizerProps) {
  const [dragging, setDragging] = useState(false);
  const dragState = useRef<{ startX: number; startWidth: number } | null>(null);
  const latestWidth = useRef(width);

  latestWidth.current = width;

  // 拖拽期间给 body 加类，禁掉文本选中；组件卸载或拖拽中断时务必清掉，
  // 否则整个应用会卡在 user-select: none 状态。
  useEffect(() => {
    if (!dragging) return;
    document.body.classList.add('is-resizing-structure');
    return () => document.body.classList.remove('is-resizing-structure');
  }, [dragging]);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    dragState.current = { startX: event.clientX, startWidth: latestWidth.current };
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const state = dragState.current;
    if (!state) return;
    onWidthChange(widthFromDrag(state.startWidth, event.clientX - state.startX));
  }, [onWidthChange]);

  const endDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragState.current) return;
    dragState.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    onCommit?.(latestWidth.current);
  }, [onCommit]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const direction = event.key === 'ArrowLeft' ? 1 : event.key === 'ArrowRight' ? -1 : 0;
    if (!direction) return;
    // 左键加宽（面板在右侧，左缘向左移动等于变宽），与拖拽方向一致。
    event.preventDefault();
    const next = stepStructureWidth(latestWidth.current, direction as -1 | 1);
    onWidthChange(next);
    onCommit?.(next);
  }, [onWidthChange, onCommit]);

  return (
    <div
      className={`structure-resizer${dragging ? ' is-dragging' : ''}`}
      role="separator"
      aria-orientation="vertical"
      aria-label="调整结构面板宽度"
      aria-valuenow={width}
      aria-valuemin={STRUCTURE_PANEL_MIN_WIDTH}
      aria-valuemax={STRUCTURE_PANEL_MAX_WIDTH}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={handleKeyDown}
    />
  );
}
