// Level-generation and hint-solving Web Worker.
//
// The heavy `@shared` generator and solver run here so the UI thread never
// blocks. The wire protocol is intentionally small and JSON-cloneable:
//
//   request  { type: 'generate', n }            -> { type: 'level', level }
//            { type: 'solve', board, capacity } -> { type: 'solution', ... }
//   failure                                    -> { type: 'error', message }

import { generateLevel, type Level } from '@shared/generator';
import type { Board } from '@shared/rules';
import { solve } from '@shared/solver';

/** A message sent from the client to this worker. */
export type WorkerRequest =
  | { type: 'generate'; n: number }
  | { type: 'solve'; board: Board; capacity: number };

/** A message sent from this worker back to the client. */
export type WorkerResponse =
  | { type: 'level'; level: Level }
  | { type: 'solution'; solved: boolean; firstMove: [number, number] | null }
  | { type: 'error'; message: string };

// Minimal structural view of the dedicated worker global. Typing it locally
// keeps this file on the DOM lib, which the rest of the web app already uses.
type WorkerScope = {
  postMessage(message: WorkerResponse): void;
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<WorkerRequest>) => void,
  ): void;
};

function handle(request: WorkerRequest): WorkerResponse {
  if (request.type === 'generate') {
    return { type: 'level', level: generateLevel(request.n) };
  }

  const result = solve(request.board, request.capacity);
  const first = result.moves[0];
  return {
    type: 'solution',
    solved: result.solved,
    firstMove: first === undefined ? null : [first[0], first[1]],
  };
}

const scope = self as unknown as WorkerScope;

scope.addEventListener('message', (event) => {
  try {
    scope.postMessage(handle(event.data));
  } catch (error) {
    scope.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});
