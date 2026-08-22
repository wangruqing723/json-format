import { useEffect, useState } from 'react';
import { perfSnapshot, resetPerf, type PerfBlock, type PerfSpan } from '../services/perf-probe';

export interface PerfPanelProps {
  open: boolean;
  onClose: () => void;
}

/**
 * 卡顿实测面板（Ctrl/⌘ Shift P 开关）。
 *
 * 「主线程卡住」是看门狗测到的定时器迟到量 —— 卡顿的直接度量。
 * 「各路径耗时」是插桩记录的极值。两边的「时刻」对得上，就说明那条路径是成因。
 */
export function PerfPanel({ open, onClose }: PerfPanelProps) {
  const [data, setData] = useState<{ blocks: PerfBlock[]; spans: PerfSpan[] }>({ blocks: [], spans: [] });

  useEffect(() => {
    if (!open) return;
    const refresh = () => setData(perfSnapshot());
    refresh();
    const timer = window.setInterval(refresh, 600);
    return () => window.clearInterval(timer);
  }, [open]);

  if (!open) return null;

  const seconds = (at: number) => `${(at / 1000).toFixed(1)}s`;

  return (
    <div className="perf-panel" role="dialog" aria-label="卡顿实测">
      <div className="perf-panel-head">
        <strong>卡顿实测</strong>
        <button type="button" onClick={() => { resetPerf(); setData({ blocks: [], spans: [] }); }}>清空</button>
        <button type="button" onClick={onClose}>关闭</button>
      </div>
      <div className="perf-panel-body">
        <section>
          <h4>主线程卡住（最慢 {data.blocks.length} 次）</h4>
          {data.blocks.length === 0 ? <p>暂未测到 ≥120ms 的卡顿</p> : (
            <ul>
              {data.blocks.map((block, index) => (
                <li key={index}><b>{block.ms.toFixed(0)} ms</b><span>{seconds(block.at)}</span></li>
              ))}
            </ul>
          )}
        </section>
        <section>
          <h4>各路径耗时（最慢 {data.spans.length} 笔）</h4>
          {data.spans.length === 0 ? <p>暂未测到 ≥8ms 的操作</p> : (
            <ul>
              {data.spans.map((span, index) => (
                <li key={index}><b>{span.ms.toFixed(0)} ms</b><code>{span.name}</code><span>{seconds(span.at)}</span></li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <p className="perf-panel-hint">复现卡顿后把这两栏截图发出来即可定位。</p>
    </div>
  );
}
