// 卡顿定位探针。
//
// 打包版在 1.1 KB 文档上也会卡几秒，而浏览器 dev 下同样操作流畅。这个体量下
// 解析、落盘的开销都是微秒级，说明真凶是与文档大小无关的固定开销，靠读代码
// 已经判断错过一次，所以改为实测：主线程被占住多久（看门狗），以及各条可疑
// 路径各自耗时（span）。两份数据都带时间戳，能对上就能定位。
//
// 探针常开：卡顿发生后再打开面板也能看到已录数据。单次开销是两次
// performance.now() 加一次数组写入，相对被测对象可忽略。

export interface PerfBlock {
  /** 主线程被占住的毫秒数 */
  ms: number;
  /** 相对探针启动的时刻，用于和 span 对时 */
  at: number;
}

export interface PerfSpan {
  name: string;
  ms: number;
  at: number;
}

const BLOCK_THRESHOLD_MS = 120;
const SPAN_THRESHOLD_MS = 8;
const WATCHDOG_INTERVAL_MS = 250;
const KEEP = 40;
/** 时间线容量。只看卡顿前后几秒，不需要留更多。 */
const TIMELINE_CAPACITY = 600;

const origin = now();
const blocks: PerfBlock[] = [];
const spans: PerfSpan[] = [];
let watchdogTimer: number | null = null;

/**
 * 事件时间线（环形缓冲）。
 *
 * 极值榜解决不了这次的问题：上一版实测显示卡顿在 286.8s，而所有极值都落在
 * 169s–276s，对不上时刻，等于没定位。所以这里把每个事件都记下来 ——
 * 卡顿发生后回看那个窗口，看里面到底跑了什么。若窗口内空无一物，
 * 说明主线程不是被 JS 占住的（GC、样式重算、布局、绘制都测不到函数耗时），
 * 那个「空」本身就是结论。
 */
export interface PerfEvent {
  label: string;
  at: number;
  ms?: number;
}

const timeline: PerfEvent[] = [];

function append(event: PerfEvent): void {
  timeline.push(event);
  if (timeline.length > TIMELINE_CAPACITY) timeline.splice(0, timeline.length - TIMELINE_CAPACITY);
}

/** 记录一个瞬时事件（按键、Worker 新建之类），不带耗时。 */
export function mark(label: string): void {
  append({ label, at: now() - origin });
}

function now(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}

function push<T extends { ms: number }>(list: T[], entry: T): void {
  list.push(entry);
  // 只留最慢的若干条：卡顿定位关心极值，不关心均值。
  if (list.length > KEEP * 2) {
    list.sort((left, right) => right.ms - left.ms);
    list.length = KEEP;
  }
}

/** 记录一段已知耗时。 */
export function recordSpan(name: string, ms: number): void {
  // 时间线不设门槛：定位卡顿要的是「窗口内跑过什么」，
  // 快的事件同样是证据（尤其当窗口内只有快事件时）。
  append({ label: name, at: now() - origin, ms });
  if (ms < SPAN_THRESHOLD_MS) return;
  push(spans, { name, ms, at: now() - origin });
}

/** 开始计时，返回结束函数。结束函数可安全重复调用。 */
export function beginSpan(name: string): () => void {
  const start = now();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    recordSpan(name, now() - start);
  };
}

/**
 * 记录一次定时器迟到：实际触发时刻减去预期触发时刻，就是主线程被占住的时间。
 * 单独抽出是为了可测 —— 假定时器总是准点触发，模拟不出迟到。
 * @returns 传入的实际时刻，便于调用方推进下一次预期时刻
 */
export function recordLateness(actual: number, expected: number): number {
  const late = actual - expected;
  if (late >= BLOCK_THRESHOLD_MS) {
    push(blocks, { ms: late, at: actual - origin });
    append({ label: '⚠︎ 主线程卡住', at: actual - origin, ms: late });
  }
  return actual;
}

/**
 * 取最严重那次卡顿前后的事件。窗口起点往前多取一点：
 * 卡顿是「事后」才被发现的，占住主线程的活儿在它之前就开始了。
 */
export function timelineAroundWorstBlock(beforeMs = 2_500, afterMs = 600): PerfEvent[] {
  const worst = [...blocks].sort((left, right) => right.ms - left.ms)[0];
  if (!worst) return [];
  const from = worst.at - worst.ms - beforeMs;
  const to = worst.at + afterMs;
  return timeline.filter((event) => event.at >= from && event.at <= to);
}

/** 导出为纯文本，便于整段贴出来 —— 密集数据截图容易看漏。 */
export function exportTimeline(): string {
  const worst = [...blocks].sort((left, right) => right.ms - left.ms)[0];
  const head = worst
    ? `最严重卡顿 ${worst.ms.toFixed(0)}ms @ ${(worst.at / 1000).toFixed(1)}s`
    : '未测到卡顿';
  const rows = timelineAroundWorstBlock().map((event) => {
    const ms = event.ms === undefined ? '' : ` ${event.ms.toFixed(1)}ms`;
    return `${(event.at / 1000).toFixed(3)}s  ${event.label}${ms}`;
  });
  return [head, `窗口内事件 ${rows.length} 条`, ...rows].join('\n');
}

/**
 * 主线程看门狗。定时器实际触发时刻减去预期时刻，差值就是主线程被占住的时间 ——
 * 这是「卡顿」最直接的度量，不依赖任何对成因的猜测。
 */
export function startWatchdog(): () => void {
  if (watchdogTimer !== null) return () => undefined;
  let expected = now() + WATCHDOG_INTERVAL_MS;
  watchdogTimer = window.setInterval(() => {
    const actual = now();
    expected = recordLateness(actual, expected) + WATCHDOG_INTERVAL_MS;
  }, WATCHDOG_INTERVAL_MS);
  return () => {
    if (watchdogTimer !== null) window.clearInterval(watchdogTimer);
    watchdogTimer = null;
  };
}

export function perfSnapshot(): { blocks: PerfBlock[]; spans: PerfSpan[] } {
  const bySlowest = <T extends { ms: number }>(list: T[]) =>
    [...list].sort((left, right) => right.ms - left.ms).slice(0, 12);
  return { blocks: bySlowest(blocks), spans: bySlowest(spans) };
}

/**
 * longtask 观察器。若 WebKit 支持，它能直接报出占住主线程 ≥50ms 的任务，
 * 连 GC 与布局这类非 JS 停顿也算在内 —— 那正是当前插桩测不到的部分。
 * 各家支持情况说法不一，故用 try 包住，不支持就静默跳过（时间线仍可用）。
 */
export function startLongTaskObserver(): () => void {
  if (typeof PerformanceObserver === 'undefined') {
    mark('longtask: 本环境不支持 PerformanceObserver');
    return () => undefined;
  }
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const attribution = (entry as PerformanceEntry & {
          attribution?: Array<{ name?: string; containerType?: string }>;
        }).attribution;
        const detail = attribution?.length
          ? `:${attribution.map((item) => item.containerType ?? item.name ?? '?').join(',')}`
          : '';
        append({ label: `longtask${detail}`, at: entry.startTime - origin, ms: entry.duration });
      }
    });
    observer.observe({ type: 'longtask', buffered: true });
    mark('longtask: 观察器已启动');
    return () => observer.disconnect();
  } catch {
    mark('longtask: 本环境不支持该类型');
    return () => undefined;
  }
}

export function resetPerf(): void {
  blocks.length = 0;
  spans.length = 0;
  timeline.length = 0;
}
