import { describe, expect, it, vi } from 'vitest';
import type { WorkerRequest, WorkerResponse } from '../types';
import { JsonWorkerClient, WorkerCancelledError } from '../services/worker-client';

class FakeWorker {
  readonly requests: WorkerRequest[] = [];
  terminated = false;
  private messageListener?: (event: MessageEvent<WorkerResponse>) => void;
  private errorListener?: (event: Event) => void;

  postMessage(request: WorkerRequest): void {
    this.requests.push(request);
  }

  terminate(): void {
    this.terminated = true;
  }

  addEventListener(type: string, listener: EventListener): void {
    if (type === 'message') {
      this.messageListener = listener as (event: MessageEvent<WorkerResponse>) => void;
    }
    if (type === 'error') this.errorListener = listener;
  }

  emit(response: WorkerResponse): void {
    this.messageListener?.({ data: response } as MessageEvent<WorkerResponse>);
  }

  emitError(): void {
    this.errorListener?.(new Event('error'));
  }
}

describe('JsonWorkerClient', () => {
  it('关联 requestId 并忽略未知响应', async () => {
    const worker = new FakeWorker();
    const client = new JsonWorkerClient(() => worker as unknown as Worker);
    const task = client.process('validate', '{}');

    expect(worker.requests[0]).toMatchObject({
      requestId: task.requestId,
      operation: 'validate',
      source: '{}',
    });
    worker.emit({
      requestId: 'old-request',
      ok: false,
      error: {
        message: 'old',
        line: 1,
        column: 1,
        offset: 0,
        code: 'INVALID_JSON',
        severity: 'error',
      },
    });
    worker.emit({
      requestId: task.requestId,
      ok: true,
      result: '{}',
      meta: {
        operation: 'validate',
        durationMs: 0,
        inputBytes: 2,
        outputBytes: 2,
        valid: true,
      },
    });

    await expect(task.response).resolves.toMatchObject({ requestId: task.requestId, ok: true });
    client.dispose();
  });

  it('取消目标任务时不影响其他并发请求', async () => {
    const workers: FakeWorker[] = [];
    const factory = vi.fn(() => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker as unknown as Worker;
    });
    const client = new JsonWorkerClient(factory);
    const cancelledTask = client.process('format', '{}');
    const survivingTask = client.process('minify', '{ }');

    expect(client.cancel(cancelledTask.requestId)).toBe(true);
    expect(workers[0].terminated).toBe(true);
    expect(workers).toHaveLength(2);
    expect(workers[1].terminated).toBe(false);
    await expect(cancelledTask.response).rejects.toBeInstanceOf(WorkerCancelledError);

    workers[1].emit({
      requestId: survivingTask.requestId,
      ok: true,
      result: '{}',
      meta: {
        operation: 'minify',
        durationMs: 0,
        inputBytes: 3,
        outputBytes: 2,
        valid: true,
      },
    });
    await expect(survivingTask.response).resolves.toMatchObject({
      requestId: survivingTask.requestId,
      ok: true,
    });
    expect(workers[1].terminated).toBe(true);

    const nextTask = client.process('stats', '{}');
    expect(workers[2].requests[0].requestId).toBe(nextTask.requestId);
    client.dispose();
    await expect(nextTask.response).rejects.toBeInstanceOf(WorkerCancelledError);
  });

  it('cancelAll 取消所有进行中的独立 Worker', async () => {
    const workers: FakeWorker[] = [];
    const client = new JsonWorkerClient(() => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker as unknown as Worker;
    });
    const first = client.process('format', '{}');
    const second = client.process('validate', '[]');

    client.cancelAll();

    expect(workers.every((worker) => worker.terminated)).toBe(true);
    await expect(first.response).rejects.toBeInstanceOf(WorkerCancelledError);
    await expect(second.response).rejects.toBeInstanceOf(WorkerCancelledError);
  });
});
