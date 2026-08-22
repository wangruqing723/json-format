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

const origin = now();
const blocks: PerfBlock[] = [];
const spans: PerfSpan[] = [];
let watchdogTimer: number | null = null;

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
  if (late >= BLOCK_THRESHOLD_MS) push(blocks, { ms: late, at: actual - origin });
  return actual;
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

export function resetPerf(): void {
  blocks.length = 0;
  spans.length = 0;
}
