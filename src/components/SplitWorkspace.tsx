import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import {
  clampSplitRatio,
  ratioFromDrag,
  SPLIT_RATIO_DEFAULT,
  SPLIT_RATIO_MAX,
  SPLIT_RATIO_MIN,
  stepSplitRatio,
} from '../core/split-layout';
import type { CollapsedPane, SplitOrientation } from '../types';
import { Icon } from './Icon';

export interface SplitWorkspaceProps {
  orientation: SplitOrientation;
  ratio: number;
  onRatioChange: (ratio: number) => void;
  onRatioCommit: (ratio: number) => void;
  collapsedPane: CollapsedPane;
  onCollapsedPaneChange: (pane: CollapsedPane) => void;
  textPane: ReactNode;
  treePane: ReactNode;
}

type PaneName = 'text' | 'tree';

function paneTitle(pane: PaneName) {
  return pane === 'text' ? '文本' : '树';
}

function paneIcon(pane: PaneName, orientation: SplitOrientation) {
  if (orientation === 'column') return pane === 'text' ? 'expand_more' : 'expand_more';
  return pane === 'text' ? 'chevron_left' : 'chevron_right';
}

export function SplitWorkspace({
  orientation,
  ratio,
  onRatioChange,
  onRatioCommit,
  collapsedPane,
  onCollapsedPaneChange,
  textPane,
  treePane,
}: SplitWorkspaceProps) {
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window === 'undefined' ? Number.POSITIVE_INFINITY : window.innerWidth,
  );
  useEffect(() => {
    const update = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  // 窄屏只影响本次渲染，不写回用户的方向/比例/折叠设置；恢复宽屏后继续使用原设置。
  const effectiveOrientation: SplitOrientation = viewportWidth < 700 ? 'column' : orientation;
  const effectiveCollapsedPane: CollapsedPane = viewportWidth < 480 ? 'none' : collapsedPane;
  const initialRatio = clampSplitRatio(ratio);
  const [localRatio, setLocalRatio] = useState(initialRatio);
  const ratioRef = useRef(initialRatio);
  const draggingRef = useRef(false);
  const activePointerIdRef = useRef<number | null>(null);
  const pointerCommittedRef = useRef(false);

  useEffect(() => {
    if (draggingRef.current) return;
    const next = clampSplitRatio(ratio);
    ratioRef.current = next;
    setLocalRatio(next);
  }, [ratio]);

  const changeRatio = useCallback((nextRatio: number, commit: boolean) => {
    const next = clampSplitRatio(nextRatio);
    ratioRef.current = next;
    setLocalRatio(next);
    onRatioChange(next);
    if (commit) onRatioCommit(next);
  }, [onRatioChange, onRatioCommit]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    let nextRatio: number | null = null;
    if (event.key === 'Home') nextRatio = SPLIT_RATIO_MIN;
    else if (event.key === 'End') nextRatio = SPLIT_RATIO_MAX;
    else if (effectiveOrientation === 'row' && event.key === 'ArrowLeft') nextRatio = stepSplitRatio(ratioRef.current, -1);
    else if (effectiveOrientation === 'row' && event.key === 'ArrowRight') nextRatio = stepSplitRatio(ratioRef.current, 1);
    else if (effectiveOrientation === 'column' && event.key === 'ArrowUp') nextRatio = stepSplitRatio(ratioRef.current, -1);
    else if (effectiveOrientation === 'column' && event.key === 'ArrowDown') nextRatio = stepSplitRatio(ratioRef.current, 1);

    if (nextRatio === null) return;
    event.preventDefault();
    changeRatio(nextRatio, true);
  }, [changeRatio, effectiveOrientation]);

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== undefined && event.button !== 0) return;
    draggingRef.current = true;
    activePointerIdRef.current = event.pointerId;
    pointerCommittedRef.current = false;
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, []);

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current || activePointerIdRef.current !== event.pointerId) return;
    const rect = workspaceRef.current?.getBoundingClientRect();
    if (!rect) return;

    const position = effectiveOrientation === 'row'
      ? event.clientX - rect.left
      : event.clientY - rect.top;
    const total = effectiveOrientation === 'row' ? rect.width : rect.height;
    changeRatio(ratioFromDrag(position, total), false);
  }, [changeRatio, effectiveOrientation]);

  const finishPointer = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current || activePointerIdRef.current !== event.pointerId) return;

    draggingRef.current = false;
    activePointerIdRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (pointerCommittedRef.current) return;

    pointerCommittedRef.current = true;
    onRatioCommit(ratioRef.current);
  }, [onRatioCommit]);

  const handleDoubleClick = useCallback(() => {
    changeRatio(SPLIT_RATIO_DEFAULT, true);
  }, [changeRatio]);

  const renderPane = (pane: PaneName, content: ReactNode, collapsed: boolean) => (
    <section
      className={`split-workspace-pane split-workspace-pane--${pane}`}
      data-pane={pane}
      aria-label={paneTitle(pane)}
      style={collapsed ? undefined : {
        flex: effectiveCollapsedPane === 'none' ? `0 0 ${localRatio * 100}%` : '1 1 auto',
        minWidth: 0,
        minHeight: 0,
      }}
    >
      <header className="split-workspace-pane-header">
        <span>{paneTitle(pane)}</span>
        <button
          className="split-workspace-collapse-button"
          type="button"
          aria-label={`折叠${paneTitle(pane)}`}
          title={`折叠${paneTitle(pane)}`}
          disabled={effectiveCollapsedPane !== 'none'}
          onClick={() => {
            if (effectiveCollapsedPane === 'none') onCollapsedPaneChange(pane);
          }}
        >
        <Icon name={paneIcon(pane, effectiveOrientation)} size={16} />
        </button>
      </header>
      <div className="split-workspace-pane-content">{content}</div>
    </section>
  );

  const renderCollapsedPane = (pane: PaneName) => (
    <div
      className={`split-workspace-collapsed split-workspace-collapsed--${pane}`}
      data-pane={pane}
      style={{
        flex: '0 0 34px',
        minWidth: effectiveOrientation === 'row' ? 34 : 0,
        minHeight: effectiveOrientation === 'column' ? 34 : 0,
      }}
    >
      <button
        className="split-workspace-restore-button"
        type="button"
        aria-label={`展开${paneTitle(pane)}`}
        title={`展开${paneTitle(pane)}`}
        onClick={() => onCollapsedPaneChange('none')}
      >
        <Icon name={pane === 'text' ? 'chevron_right' : 'chevron_left'} size={16} />
        <span>{paneTitle(pane)}</span>
      </button>
    </div>
  );

  const text = effectiveCollapsedPane === 'text'
    ? renderCollapsedPane('text')
    : renderPane('text', textPane, false);
  const tree = effectiveCollapsedPane === 'tree'
    ? renderCollapsedPane('tree')
    : renderPane('tree', treePane, false);

  return (
    <div
      ref={workspaceRef}
      className={`split-workspace split-workspace--${effectiveOrientation}`}
      data-split-workspace="true"
      style={{ display: 'flex', minWidth: 0, minHeight: 0 }}
    >
      {text}
      {effectiveCollapsedPane === 'none' && (
        <div
          className="split-workspace-divider"
          role="separator"
          aria-label="调整文本与树的分栏比例"
          aria-orientation={effectiveOrientation === 'row' ? 'vertical' : 'horizontal'}
          aria-valuemin={20}
          aria-valuemax={80}
          aria-valuenow={Math.round(clampSplitRatio(localRatio) * 100)}
          tabIndex={0}
          onKeyDown={handleKeyDown}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishPointer}
          onPointerCancel={finishPointer}
          onDoubleClick={handleDoubleClick}
        />
      )}
      {tree}
    </div>
  );
}
