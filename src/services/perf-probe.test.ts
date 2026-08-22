import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  beginSpan,
  capturedFreeze,
  exportTimeline,
  recordInputLatency,
  mark,
  perfSnapshot,
  recordLateness,
  recordSpan,
  resetPerf,
  startWatchdog,
  worstWindow,
  timelineAroundWorstBlock,
  timelineAroundWorstInput,
  trackInputLatency,
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

  it('空闲期的定时器迟到不算卡顿，只记为节流', () => {
    // 没有任何用户活动，迟到 1400ms —— macOS 把定时器合并到 1Hz 的典型表现
    recordLateness(2_400, 1_000);

    expect(perfSnapshot().blocks).toEqual([]);
    const labels = timelineAroundWorstInput().concat(timelineAroundWorstBlock()).map((event) => event.label);
    expect(labels.every((label) => !label.startsWith('⚠'))).toBe(true);
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
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'] });
    trackInputLatency('char');
    const at = performance.now();
    recordSpan('fast', 1);
    recordLateness(at + 800, at + 300);

    const labels = timelineAroundWorstBlock().map((event) => event.label);
    expect(labels).toContain('fast');
    expect(labels).toContain('⚠︎ 主线程卡住');
  });

  it('阻塞比按键更慢时，时间线取阻塞那一段，且现场被锁定', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'] });
    trackInputLatency('char');
    const at = performance.now();
    recordSpan('卡顿窗口内的活儿', 1);
    // 按键只慢 40ms，阻塞慢 1000ms —— 上一轮面板只看按键窗口，
    // 于是取到的是早被环形缓冲滚掉的那一段，显示「0 条」。
    recordInputLatency('char', 40);
    recordLateness(at + 1_250, at + 250);

    expect(worstWindow().map((event) => event.label)).toContain('卡顿窗口内的活儿');
    const frozen = capturedFreeze();
    expect(frozen).not.toBeNull();
    expect(frozen!.input.key).toBe('主线程卡住');
    expect(frozen!.input.ms).toBe(1_000);
    expect(exportTimeline()).toContain('已锁定卡顿现场');
  });

  it('按键后立刻卡很久仍记为卡顿：不能因卡顿本身把实际时刻推远就判成空闲', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'] });
    trackInputLatency('Enter');
    const at = performance.now();
    // 按键后主线程被占住 10 秒：看门狗预期 at+250 触发，实际拖到 at+10250 才跑。
    // 若按「实际时刻距上次活动」判定，会算出 10250 > 2000 而误判成空闲期节流 ——
    // 越严重的卡顿越容易被丢掉，正是几十秒卡顿一次都没抓到的原因。
    recordLateness(at + 10_250, at + 250);

    const { blocks } = perfSnapshot();
    expect(blocks).toHaveLength(1);
    expect(blocks[0].ms).toBe(10_000);
  });

  it('刚有按键时的迟到仍记为卡顿：那时候真的是主线程被占住', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'] });
    // 先制造一次用户活动，再让定时器迟到 —— 活动期内的迟到是真卡顿
    trackInputLatency('Enter');
    const activityAt = performance.now();
    recordLateness(activityAt + 900, activityAt + 200);

    expect(perfSnapshot().blocks).toHaveLength(1);
    expect(perfSnapshot().blocks[0].ms).toBe(700);
  });

  it('记录按键，且未打字时导出会明确提示', () => {
    expect(exportTimeline()).toContain('未测到按键');
  });

  it('窗口从卡顿开始之前取起，占住主线程的活儿在它之前就开始了', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'] });
    mark('long-before');
    // 把 long-before 推远，但活动必须紧挨着迟到 —— 否则迟到会被判成空闲期节流
    vi.advanceTimersByTime(3_000);
    trackInputLatency('char');
    const at = performance.now();
    // 卡顿在 at+1000 被发现、持续 800ms，故窗口起点应早于 at+200
    recordLateness(at + 1_000, at + 200);
    const window = timelineAroundWorstBlock(2_500, 600);

    // long-before 记在 at-3000，落在窗口 [at-2300, at+1600] 之外，应被排除
    expect(window.map((event) => event.label)).not.toContain('long-before');
    expect(window.some((event) => event.label.startsWith('⚠'))).toBe(true);
  });

  it('导出文本以最慢按键为标题，并给出各类计数', () => {
    // 必须连 requestAnimationFrame 一起接管：延迟是在两层 rAF 回调里落账的。
    vi.useFakeTimers({
      toFake: ['setTimeout', 'setInterval', 'clearInterval', 'Date', 'performance', 'requestAnimationFrame'],
    });
    trackInputLatency('Enter');
    // 让两层 rAF 的回调都跑完，延迟才落账
    vi.advanceTimersByTime(50);
    vi.advanceTimersByTime(50);
    const text = exportTimeline();

    expect(text).toContain('最慢按键 Enter');
    expect(text).toContain('输入延迟样本');
  });

  it('超阈值的交互会锁定现场，后续正常操作不再覆盖', () => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'setInterval', 'clearInterval', 'Date', 'performance', 'requestAnimationFrame'],
    });
    recordInputLatency('Enter', 900);
    const frozen = capturedFreeze();
    expect(frozen).not.toBeNull();
    expect(frozen!.input.ms).toBe(900);

    // 之后再来一次正常交互，锁定的现场必须保持不变
    recordInputLatency('char', 20);
    expect(capturedFreeze()!.input.key).toBe('Enter');
    expect(exportTimeline()).toContain('已锁定卡顿现场');
  });

  it('全程健康时导出明说没测到卡顿，不让人误以为已定位', () => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'setInterval', 'clearInterval', 'Date', 'performance', 'requestAnimationFrame'],
    });
    recordInputLatency('char', 30);

    expect(capturedFreeze()).toBeNull();
    expect(exportTimeline()).toContain('未测到');
    expect(exportTimeline()).toContain('这段时间是健康的');
  });

  it('未测到按键时导出不报错并给出下一步提示', () => {
    const text = exportTimeline();
    expect(text).toContain('未测到按键');
    expect(text).toContain('打字');
    expect(timelineAroundWorstInput()).toEqual([]);
  });
});
