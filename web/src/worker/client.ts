// Promise-based client for the level-generation worker.
//
// One worker is created lazily and reused for the app lifetime. Requests are
// matched to responses in order grouped by kind, so the wire protocol stays
// exactly as documented in `generator.worker.ts` (no correlation ids).

import type { Level } from '@shared/generator';
import type { Board } from '@shared/rules';

import type { WorkerRequest, WorkerResponse } from './generator.worker';

type Pending =
  | {
      kind: 'level';
      resolve: (level: Level) => void;
      reject: (reason: unknown) => void;
    }
  | {
      kind: 'solution';
      resolve: (firstMove: [number, number] | null) => void;
      reject: (reason: unknown) => void;
    };

const pending: Pending[] = [];

function take(kind: Pending['kind']): Pending | undefined {
  const index = pending.findIndex((entry) => entry.kind === kind);
  if (index === -1) {
    return undefined;
  }
  return pending.splice(index, 1)[0];
}

function onMessage(event: MessageEvent<WorkerResponse>): void {
  const response = event.data;

  if (response.type === 'level') {
    const entry = take('level');
    if (entry !== undefined && entry.kind === 'level') {
      entry.resolve(response.level);
    }
    return;
  }

  if (response.type === 'solution') {
    const entry = take('solution');
    if (entry !== undefined && entry.kind === 'solution') {
      entry.resolve(response.firstMove);
    }
    return;
  }

  const entry = pending.shift();
  entry?.reject(new Error(response.message));
}

let worker: Worker | null = null;

function getWorker(): Worker {
  if (worker === null) {
    worker = new Worker(new URL('./generator.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.addEventListener('message', onMessage);
  }
  return worker;
}

/** Generates the certified level for `n` off the main thread. */
export function generate(n: number): Promise<Level> {
  const request: WorkerRequest = { type: 'generate', n };
  return new Promise<Level>((resolve, reject) => {
    pending.push({ kind: 'level', resolve, reject });
    getWorker().postMessage(request);
  });
}

/** Solves `board` off the main thread and returns the recommended first move. */
export function solveFirstMove(
  board: Board,
  capacity: number,
): Promise<[number, number] | null> {
  const request: WorkerRequest = { type: 'solve', board, capacity };
  return new Promise<[number, number] | null>((resolve, reject) => {
    pending.push({ kind: 'solution', resolve, reject });
    getWorker().postMessage(request);
  });
}

/** Tears the singleton down and rejects anything still in flight. */
export function terminate(): void {
  if (worker === null) {
    return;
  }
  worker.terminate();
  worker = null;
  for (const entry of pending.splice(0)) {
    entry.reject(new Error('Generation worker terminated'));
  }
}
