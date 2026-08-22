import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  beginSpan,
  exportTimeline,
  mark,
  perfSnapshot,
  recordLateness,
  recordSpan,
  resetPerf,
  startWatchdog,
  timelineAroundWorstBlock,
} from './perf-probe';

afterEach(() => {
  resetPerf();
  vi.useRealTimers();
});

describe('perf-probe', () => {
  it('丢弃低于阈值的记录，避免用噪声淹没极值', () => {
    recordSpan('tiny', 3);
    recordSpan('real', 42);

    const { spans } = perfSnapshot();
    expect(spans.map((span) => span.name)).toEqual(['real']);
  });

  it('按耗时降序返回，最慢的排在最前', () => {
    recordSpan('a', 20);
    recordSpan('b', 300);
    recordSpan('c', 90);

    expect(perfSnapshot().spans.map((span) => span.name)).toEqual(['b', 'c', 'a']);
  });

  it('beginSpan 的结束函数重复调用只记一次', () => {
    // 必须显式接管 performance：探针用 performance.now() 计时，
    // 默认的假定时器只接管 setTimeout/Date，时钟不走则测出来恒为 0。
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'] });
    const end = beginSpan('once');
    vi.advanceTimersByTime(50);
    end();
    end();
    end();

    expect(perfSnapshot().spans.filter((span) => span.name === 'once')).toHaveLength(1);
  });

  it('定时器迟到超过阈值时记成主线程卡住', () => {
    // 预期 1000ms 触发，实际 2400ms 才触发 —— 主线程被占住 1400ms
    recordLateness(2_400, 1_000);

    const { blocks } = perfSnapshot();
    expect(blocks).toHaveLength(1);
    expect(blocks[0].ms).toBe(1_400);
  });

  it('准点触发不记为卡顿，避免正常运行也刷满面板', () => {
    recordLateness(1_002, 1_000);
    expect(perfSnapshot().blocks).toEqual([]);
  });

  it('看门狗可启动并返回可用的停止函数', () => {
    vi.useFakeTimers();
    const stop = startWatchdog();
    expect(() => { vi.advanceTimersByTime(600); stop(); }).not.toThrow();
  });

  it('清空后不残留旧数据', () => {
    recordSpan('gone', 500);
    resetPerf();
    expect(perfSnapshot()).toEqual({ blocks: [], spans: [] });
    expect(timelineAroundWorstBlock()).toEqual([]);
  });

  it('时间线不设耗时门槛：窗口内只有快事件本身就是证据', () => {
    recordSpan('fast', 1);
    recordLateness(1_000, 500);

    const labels = timelineAroundWorstBlock().map((event) => event.label);
    expect(labels).toContain('fast');
    expect(labels).toContain('⚠︎ 主线程卡住');
  });

  it('窗口从卡顿开始之前取起，占住主线程的活儿在它之前就开始了', () => {
    // 卡顿在 5000ms 被发现、持续 900ms，故起点应早于 4100ms
    mark('long-before');
    recordLateness(5_000, 4_100);
    const window = timelineAroundWorstBlock(2_500, 600);

    // mark 用的是真实时钟（约 0ms），落在 [4100-2500, 5600] 之外，应被排除
    expect(window.map((event) => event.label)).not.toContain('long-before');
    expect(window.some((event) => event.label.startsWith('⚠'))).toBe(true);
  });

  it('导出文本含卡顿摘要，便于整段贴出', () => {
    recordLateness(3_000, 2_000);
    const text = exportTimeline();

    expect(text).toContain('最严重卡顿');
    expect(text).toContain('1000ms');
  });

  it('未测到卡顿时导出不报错', () => {
    expect(exportTimeline()).toContain('未测到卡顿');
    expect(timelineAroundWorstBlock()).toEqual([]);
  });
});
