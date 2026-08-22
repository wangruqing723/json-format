import type { WorkerOperation, WorkerRequest, WorkerResponse } from '../types';
import { beginSpan, mark } from './perf-probe';

export type WorkerFactory = () => Worker;

export class WorkerCancelledError extends Error {
  readonly requestId: string;

  constructor(requestId: string) {
    super('JSON 处理任务已取消');
    this.name = 'WorkerCancelledError';
    this.requestId = requestId;
  }
}

export class WorkerExecutionError extends Error {
  constructor(message = 'JSON Worker 运行失败') {
    super(message);
    this.name = 'WorkerExecutionError';
  }
}

interface PendingRequest {
  resolve: (response: WorkerResponse) => void;
  reject: (error: Error) => void;
  worker: Worker;
}

export class JsonWorkerClient {
  private readonly pending = new Map<string, PendingRequest>();
  private sequence = 0;
  private disposed = false;

  constructor(private readonly workerFactory: WorkerFactory = createDefaultWorker) {}

  process(
    operation: WorkerOperation,
    source: string,
    options?: Record<string, unknown>,
  ): { requestId: string; response: Promise<WorkerResponse> } {
    const requestId = this.createRequestId();
    const request: WorkerRequest = {
      requestId,
      operation,
      source,
      ...(options ? { options } : {}),
    };
    // new Worker() 立即返回，模块加载与首次执行是异步的，所以真正的代价要看往返。
    const endTrip = beginSpan(`worker-trip:${operation}`);
    const response = new Promise<WorkerResponse>((resolve, reject) => {
      if (this.disposed) {
        reject(new WorkerExecutionError('JSON Worker 客户端已释放'));
        return;
      }

      let worker: Worker;
      try {
        worker = this.createWorker(requestId);
      } catch (error) {
        reject(
          new WorkerExecutionError(error instanceof Error ? error.message : undefined),
        );
        return;
      }

      this.pending.set(requestId, { resolve, reject, worker });
      try {
        worker.postMessage(request);
      } catch (error) {
        this.rejectRequest(
          requestId,
          new WorkerExecutionError(error instanceof Error ? error.message : undefined),
        );
      }
    });
    return { requestId, response: response.finally(endTrip) };
  }

  cancel(requestId: string): boolean {
    return this.rejectRequest(requestId, new WorkerCancelledError(requestId));
  }

  cancelAll(): void {
    for (const requestId of [...this.pending.keys()]) {
      this.rejectRequest(requestId, new WorkerCancelledError(requestId));
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelAll();
  }

  private createWorker(requestId: string): Worker {
    // 每次请求都新建 Worker：打包版下这一步要经 tauri:// 自定义协议取模块再编译，
    // 是与文档大小无关的固定开销，也是当前卡顿的首要嫌疑，故单独计时。
    const endSpawn = beginSpan('worker-spawn');
    const worker = this.workerFactory();
    endSpawn();
    // 打点计数，用于判断 Worker 是否在累积（销毁不及时会造成内存压力，
    // 而 GC 停顿测不出函数耗时，只会表现为主线程凭空卡住）。
    mark(`worker+ (存活 ${this.pending.size + 1})`);
    worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
      this.handleMessage(requestId, event);
    });
    worker.addEventListener('error', (event: ErrorEvent) => {
      this.handleError(requestId, event);
    });
    return worker;
  }

  private handleMessage(requestId: string, event: MessageEvent<WorkerResponse>): void {
    if (event.data.requestId !== requestId) return;
    const pending = this.pending.get(requestId);
    if (!pending) return;
    this.pending.delete(requestId);
    pending.worker.terminate();
    pending.resolve(event.data);
  }

  private handleError(requestId: string, event: ErrorEvent): void {
    this.rejectRequest(
      requestId,
      new WorkerExecutionError(event.message || 'JSON Worker 运行失败'),
    );
  }

  private rejectRequest(requestId: string, error: Error): boolean {
    const pending = this.pending.get(requestId);
    if (!pending) return false;
    this.pending.delete(requestId);
    pending.worker.terminate();
    pending.reject(error);
    return true;
  }

  private createRequestId(): string {
    this.sequence++;
    return `${Date.now().toString(36)}-${this.sequence.toString(36)}`;
  }
}

function createDefaultWorker(): Worker {
  return new Worker(new URL('../workers/json.worker.ts', import.meta.url), { type: 'module' });
}
