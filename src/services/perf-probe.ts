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

/**
 * 按键到画面更新的延迟 —— 用户真正感受到的「卡」。
 *
 * 看门狗那套（定时器迟到量）在 macOS 上不可用：实测迟到量精确落在 750ms 左右，
 * 换算下来定时器实际每 1000ms 才触发一次，是系统把定时器合并到 1Hz，
 * 而非主线程被占住。那些「最严重卡顿」全部发生在空闲期（窗口内没有 keydown），
 * 是假阳性。输入延迟由 DOM 事件与 rAF 驱动，不受这种节流影响。
 */
export interface PerfInput {
  key: string;
  ms: number;
  at: number;
}

const inputs: PerfInput[] = [];
/** 最近一次用户活动时刻，用于把空闲期的定时器节流从卡顿里剔除。 */
let lastActivityAt = -Infinity;
const ACTIVITY_WINDOW_MS = 2_000;
/** 是否正处于输入法组合中。回车在组合中是「确认候选」，与普通回车是两条路径。 */
let composing = false;

/**
 * 卡顿自动锁定。
 *
 * 时间线是环形缓冲、极值榜只留最慢的若干条，所以卡顿过后继续操作会把证据挤掉 ——
 * 上一轮就是这样：面板里只剩「打开面板」那次 45ms，真正的卡顿早被冲走了。
 * 这里一旦测到超过阈值的按键延迟，就把当时的时间线窗口整段冻结下来，
 * 后续操作不再覆盖，用户回头打开面板仍能看到现场。
 */
const CAPTURE_THRESHOLD_MS = 150;
let captured: { input: PerfInput; window: PerfEvent[] } | null = null;

export function capturedFreeze(): { input: PerfInput; window: PerfEvent[] } | null {
  return captured;
}

function append(event: PerfEvent): void {
  timeline.push(event);
  if (timeline.length > TIMELINE_CAPACITY) timeline.splice(0, timeline.length - TIMELINE_CAPACITY);
}

/** 记录一个瞬时事件（按键、Worker 新建之类），不带耗时。 */
export function mark(label: string): void {
  append({ label, at: now() - origin });
}

/**
 * 量一次按键到画面更新的延迟。在 keydown 里调用。
 *
 * 两层 rAF：第一层回调在绘制前执行，第二层意味着上一帧已经绘制完成 ——
 * 所以测出来的是「按下这个键，到屏幕真的变了」的整段时间，包含 JS、
 * 样式重算、布局、绘制，也包含进程被系统唤醒的等待。
 */
export function trackInputLatency(key: string): void {
  const start = now();
  lastActivityAt = start;
  append({ label: `keydown:${key}`, at: start - origin });
  if (typeof requestAnimationFrame === 'undefined') return;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      recordInputLatency(key, now() - start, start - origin);
    });
  });
}

/**
 * 落账一次交互延迟，超阈值则锁定现场。单独抽出是为了可测 ——
 * 假定时器会把嵌套的第二层 rAF 也在同一次推进里跑掉，凑不出「慢帧」。
 */
export function recordInputLatency(key: string, ms: number, at = now() - origin): void {
  append({ label: `⌨︎ 按键到画面 ${key}`, at: now() - origin, ms });
  const input: PerfInput = { key, ms, at };
  push(inputs, input);
  // 只锁第一次：卡顿现场越早越干净，后面的会被反复操作污染。
  if (ms >= CAPTURE_THRESHOLD_MS && !captured) {
    captured = { input, window: windowAround(at, ms, 3_000, 1_500) };
  }
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
  if (late < BLOCK_THRESHOLD_MS) return actual;

  // 空闲期的迟到不算卡顿：macOS 会把定时器合并到 1Hz，迟到量稳定在 750ms 左右
  // （250ms 间隔 → 实测 1000ms 触发）。
  //
  // 判定必须用「预期触发时刻」而非「实际触发时刻」：卡顿期间看门狗根本跑不了，
  // 是卡顿本身把 actual 推远的。若按 actual 判，按键后立刻卡 10 秒会算出
  // 10000 > 2000 而被丢成空闲 —— 越严重的卡顿越会被误判，这正是几十秒的卡顿
  // 一次都没抓到的原因。按 expected 判则是 250 ≤ 2000，正确归为活动期卡顿。
  const idle = expected - lastActivityAt > ACTIVITY_WINDOW_MS;
  if (idle) {
    append({ label: `⏱ 定时器被节流（空闲，实际间隔约 ${(late + 250).toFixed(0)}ms）`, at: actual - origin, ms: late });
    return actual;
  }
  push(blocks, { ms: late, at: actual - origin });
  append({ label: '⚠︎ 主线程卡住', at: actual - origin, ms: late });
  // 阻塞现场同样要锁。上一轮抓到了活动期 1036ms 的阻塞，却因为只按按键延迟锁定，
  // 现场被后续操作从环形缓冲里挤掉，面板显示「窗口内事件 0 条」——
  // 卡顿期间往往一次按键都没记到（键事件被系统攒着），只按按键锁等于抓到了不留证据。
  if (late >= CAPTURE_THRESHOLD_MS && !captured) {
    const at = expected - origin;
    captured = { input: { key: '主线程卡住', ms: late, at }, window: windowAround(at, late, 3_000, 1_500) };
  }
  return actual;
}

/**
 * 取最严重那次卡顿前后的事件。窗口起点往前多取一点：
 * 卡顿是「事后」才被发现的，占住主线程的活儿在它之前就开始了。
 */
/**
 * 取最值得看的那段现场：按键与主线程阻塞里谁更慢就取谁的窗口。
 *
 * 上一轮面板只看按键窗口，于是 1036ms 的阻塞抓到了、显示的却是 60ms 按键那一段，
 * 而那段早被环形缓冲滚掉 → 「0 条」。卡顿时按键常常根本没记到，必须两者都看。
 */
export function worstWindow(): PerfEvent[] {
  const input = worstInput();
  const block = [...blocks].sort((left, right) => right.ms - left.ms)[0];
  if (block && (!input || block.ms > input.ms)) return timelineAroundWorstBlock();
  return timelineAroundWorstInput();
}

export function timelineAroundWorstBlock(beforeMs = 2_500, afterMs = 600): PerfEvent[] {
  const worst = [...blocks].sort((left, right) => right.ms - left.ms)[0];
  if (!worst) return [];
  const from = worst.at - worst.ms - beforeMs;
  const to = worst.at + afterMs;
  return timeline.filter((event) => event.at >= from && event.at <= to);
}

/**
 * 取最慢那次按键前后的事件。这是定位的主视图 —— 上一版围绕看门狗取窗口，
 * 结果取到的是空闲期假阳性，白跑一轮。
 */
export function timelineAroundWorstInput(beforeMs = 400, afterMs = 2_500): PerfEvent[] {
  // 有锁定现场就优先给它 —— 那才是要定位的对象，而非事后操作里最慢的那次。
  if (captured) return captured.window;
  const worst = worstInput();
  if (!worst) return [];
  return windowAround(worst.at, worst.ms, beforeMs, afterMs);
}

function windowAround(at: number, ms: number, beforeMs: number, afterMs: number): PerfEvent[] {
  return timeline.filter((event) => event.at >= at - beforeMs && event.at <= at + ms + afterMs);
}

export function worstInput(): PerfInput | undefined {
  return [...inputs].sort((left, right) => right.ms - left.ms)[0];
}

export function perfInputs(): PerfInput[] {
  return [...inputs].sort((left, right) => right.ms - left.ms).slice(0, 12);
}

/** 导出为纯文本，便于整段贴出来 —— 密集数据截图容易看漏。 */
export function exportTimeline(): string {
  const input = captured?.input ?? worstInput();
  // 明确说清有没有抓到卡顿：上一轮导出只给了「最慢 45ms」，看不出那是健康还是卡顿，
  // 白跑一轮才发现是没复现。
  const head = !input
    ? '未测到按键（请在编辑器里打字后再导出）'
    : captured
      ? `✅ 已锁定卡顿现场：${captured.input.key} ${captured.input.ms.toFixed(0)}ms${captured.input.key === '主线程卡住' ? '' : ' 到画面'} @ ${(captured.input.at / 1000).toFixed(1)}s`
      : `⚠︎ 未测到 ≥${CAPTURE_THRESHOLD_MS}ms 的卡顿（这段时间是健康的）。最慢按键 ${input.key}：${input.ms.toFixed(0)}ms @ ${(input.at / 1000).toFixed(1)}s`;
  const throttled = timeline.filter((event) => event.label.startsWith('⏱')).length;
  const rows = worstWindow().map((event) => {
    const ms = event.ms === undefined ? '' : ` ${event.ms.toFixed(1)}ms`;
    return `${(event.at / 1000).toFixed(3)}s  ${event.label}${ms}`;
  });
  return [
    head,
    `输入延迟样本 ${inputs.length} 个，活动期卡顿 ${blocks.length} 次，空闲期定时器节流 ${throttled} 次`,
    `窗口内事件 ${rows.length} 条`,
    ...rows,
  ].join('\n');
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

/**
 * 回车键的阶段分解。
 *
 * 用户确认卡顿只由回车触发（打字、格式化、修复、去除换行都不卡）。回车与普通字符
 * 的区别是它走 insertNewlineAndIndent（要访问语法树算缩进）且会改变行数。
 * 本地在 jsdom 里实测：非法 JSON 下建树与命令执行都是亚毫秒，所以代价不在状态层，
 * 而在 jsdom 不做的那层。这里把回车拆成四段，直接问「时间花在哪一段」：
 *   cmd    命令执行（状态计算，含语法树访问）
 *   dom    view.update 的 DOM 写入
 *   layout 强制同步布局（读 offsetHeight 触发）
 *   paint  到下一帧真正绘制
 */
export function measureEnterPhases(runCommand: () => void, host: HTMLElement | null): void {
  const t0 = now();
  runCommand();
  const t1 = now();
  // 读一次布局属性强制 WebKit 同步完成布局，把这部分代价单独归出来。
  const height = host?.offsetHeight ?? 0;
  const t2 = now();
  if (typeof requestAnimationFrame === 'undefined') return;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const t3 = now();
      const parts = [
        `cmd ${(t1 - t0).toFixed(1)}`,
        `layout ${(t2 - t1).toFixed(1)}`,
        `paint ${(t3 - t2).toFixed(1)}`,
        `h=${height}`,
      ].join(' | ');
      append({ label: `⏎ 回车分解: ${parts}`, at: now() - origin, ms: t3 - t0 });
      recordInputLatency('Enter', t3 - t0, t0 - origin);
    });
  });
}

/**
 * 全局交互延迟监测。
 *
 * 上一轮只在编辑器 keydown 上插桩，于是「点工具栏按钮」「切标签」「格式化」
 * 之后的卡顿一律测不到 —— 而用户未必是在打字时卡的。这里在 document 上捕获
 * 所有交互，统一按同一口径量到画面更新。
 */
export function startInteractionProbe(): () => void {
  if (typeof document === 'undefined') return () => undefined;
  const onPointer = (event: Event) => {
    const target = event.target;
    const label = target instanceof Element
      ? target.closest('button,[role="menuitem"],[role="tab"],[data-tree-row]')?.textContent?.trim().slice(0, 18)
      : undefined;
    trackInputLatency(`点击${label ? `:${label}` : ''}`);
  };
  document.addEventListener('pointerdown', onPointer, true);
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('compositionstart', onComposition, true);
  document.addEventListener('compositionend', onComposition, true);
  document.addEventListener('beforeinput', onBeforeInput, true);
  return () => {
    document.removeEventListener('pointerdown', onPointer, true);
    document.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('compositionstart', onComposition, true);
    document.removeEventListener('compositionend', onComposition, true);
    document.removeEventListener('beforeinput', onBeforeInput, true);
  };
}

/**
 * 按键必须在原生捕获阶段量，不能挂在 CodeMirror 的 domEventHandlers 上。
 *
 * CodeMirror 的 handleEvent 先过 ignoreDuringComposition，被它拦下的事件
 * 一个 handler 都不会跑（domEventHandlers 和 keymap 一起被挡）。而它对
 * Safari 有专门分支：compositionend 后 100ms 内的键事件直接丢弃，因为
 * Safari 会把 compositionend 和 keydown 的顺序发颠倒。macOS 的 WKWebView
 * 正是 browser.safari 分支，中文输入法用回车确认候选就撞在这条路上 ——
 * 那是目前唯一还没被量到的回车路径，也是最可疑的一条。
 *
 * 因此判读时间线要看两条线是否成对：
 *   有 keydown:Enter 却没有「⏎ 回车分解」→ 这次回车被 CodeMirror 丢了，走的是输入法路径。
 *   两条都有 → 走的是普通 keymap 路径，阶段分解的数字可信。
 */
function onKeyDown(event: KeyboardEvent): void {
  const key = event.key.length === 1 ? 'char' : event.key;
  trackInputLatency(composing ? `${key}(组合中)` : key);
}

function onComposition(event: Event): void {
  composing = event.type !== 'compositionend';
  mark(`输入法:${event.type}`);
}

function onBeforeInput(event: Event): void {
  // 输入法确认、粘贴、换行都会先发 beforeinput。keydown 被丢掉时，
  // 这里的 inputType 是唯一能说明「实际插入了什么」的证据。
  mark(`beforeinput:${(event as InputEvent).inputType}`);
}

export function resetPerf(): void {
  blocks.length = 0;
  spans.length = 0;
  timeline.length = 0;
  inputs.length = 0;
  lastActivityAt = -Infinity;
  captured = null;
}
