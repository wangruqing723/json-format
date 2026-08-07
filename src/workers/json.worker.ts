/// <reference lib="webworker" />

import type { WorkerRequest } from '../types';
import { processWorkerRequest } from '../core/processor';

const workerScope: DedicatedWorkerGlobalScope = self as DedicatedWorkerGlobalScope;

workerScope.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  workerScope.postMessage(processWorkerRequest(event.data));
});

export {};
