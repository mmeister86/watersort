// Budget-bounded best-first / A* solver for Water Sort.
// Pure: no DOM, no Node APIs, no randomness.

import {
  isTubeComplete,
  isWin,
  type Board,
  type ColorId,
  type Tube,
} from './rules';

/** The result of a solve attempt. */
export type SolveResult = {
  solved: boolean;
  moves: [number, number][];
  expanded: number;
};

/**
 * Canonical key for a board. Each tube is serialized as its color IDs joined
 * with `,`; the tube strings are sorted and joined with `|`. Because tube order
 * is irrelevant for the game, two boards that differ only by tube order produce
 * the same key. `|` cannot appear inside a tube string (IDs are numbers joined
 * by `,`), so the encoding is unambiguous.
 *
 * Exported so the canonicalization contract is directly testable and reusable
 * for debugging; `solve` is the only function the rest of the app needs.
 */
export function canonicalKey(board: Board): string {
  const parts: string[] = new Array<string>(board.length);
  for (let i = 0; i < board.length; i += 1) {
    parts[i] = board[i]!.join(',');
  }
  parts.sort();
  return parts.join('|');
}

/**
 * Heuristic: adjacent color changes inside all tubes plus the number of
 * non-uniform, non-empty tubes. A uniform tube (including a complete one)
 * contributes 0. Lower is closer to solved.
 */
function heuristic(board: Board): number {
  let h = 0;
  for (let t = 0; t < board.length; t += 1) {
    const tube = board[t]!;
    const length = tube.length;
    if (length === 0) continue;

    let uniform = true;
    for (let i = 1; i < length; i += 1) {
      if (tube[i] !== tube[i - 1]) {
        h += 1;
        uniform = false;
      }
    }
    if (!uniform) h += 1;
  }
  return h;
}

/**
 * Internal fast move, semantically identical to `rules.applyMove` for a move
 * the caller has already established is legal: it pours the whole contiguous
 * top run of `color` from `from` into `to`, limited by free space. Unlike
 * `applyMove` it does not re-validate the move and it reuses the run length and
 * top color the search has already computed. Every returned solution is
 * replayed through `applyMove` in the tests, which proves the two agree on the
 * paths the solver actually takes.
 */
function pour(
  board: Board,
  capacity: number,
  from: number,
  to: number,
  color: ColorId,
  run: number,
): Board {
  const source = board[from]!;
  const target = board[to]!;
  const free = capacity - target.length;
  const amount = run < free ? run : free;

  const nextSourceLength = source.length - amount;
  const nextSource: Tube = new Array<ColorId>(nextSourceLength);
  for (let i = 0; i < nextSourceLength; i += 1) {
    nextSource[i] = source[i]!;
  }

  const nextTargetLength = target.length + amount;
  const nextTarget: Tube = new Array<ColorId>(nextTargetLength);
  for (let i = 0; i < target.length; i += 1) {
    nextTarget[i] = target[i]!;
  }
  for (let i = 0; i < amount; i += 1) {
    nextTarget[target.length + i] = color;
  }

  const next = board.slice();
  next[from] = nextSource;
  next[to] = nextTarget;
  return next;
}

/** A search node: a board, its path cost, and the move that produced it. */
type Node = {
  board: Board;
  g: number;
  h: number;
  f: number;
  parent: Node | null;
  from: number;
  to: number;
  /** Monotonic insertion counter, the final tie-break for stable ordering. */
  seq: number;
};

/** Binary min-heap ordered by f, then h, then insertion sequence. */
class MinHeap {
  private readonly items: Node[] = [];

  get size(): number {
    return this.items.length;
  }

  push(node: Node): void {
    this.items.push(node);
    this.siftUp(this.items.length - 1);
  }

  pop(): Node | undefined {
    const top = this.items[0];
    const last = this.items.pop();
    if (this.items.length > 0 && last !== undefined) {
      this.items[0] = last;
      this.siftDown(0);
    }
    return top;
  }

  private static less(a: Node, b: Node): boolean {
    if (a.f !== b.f) return a.f < b.f;
    if (a.h !== b.h) return a.h < b.h;
    return a.seq < b.seq;
  }

  private siftUp(index: number): void {
    let child = index;
    while (child > 0) {
      const parent = (child - 1) >> 1;
      if (!MinHeap.less(this.items[child]!, this.items[parent]!)) break;
      const swap = this.items[child]!;
      this.items[child] = this.items[parent]!;
      this.items[parent] = swap;
      child = parent;
    }
  }

  private siftDown(index: number): void {
    const length = this.items.length;
    let parent = index;
    for (;;) {
      const left = parent * 2 + 1;
      const right = left + 1;
      let smallest = parent;
      if (left < length && MinHeap.less(this.items[left]!, this.items[smallest]!)) {
        smallest = left;
      }
      if (right < length && MinHeap.less(this.items[right]!, this.items[smallest]!)) {
        smallest = right;
      }
      if (smallest === parent) break;
      const swap = this.items[parent]!;
      this.items[parent] = this.items[smallest]!;
      this.items[smallest] = swap;
      parent = smallest;
    }
  }
}

/** Rebuilds the move path from the root to `node` (exclusive of the root). */
function buildPath(node: Node): [number, number][] {
  const moves: [number, number][] = [];
  let current: Node | null = node;
  while (current !== null && current.parent !== null) {
    moves.push([current.from, current.to]);
    current = current.parent;
  }
  moves.reverse();
  return moves;
}

/**
 * Solves `board` with A* (priority `g + h`). Returns `solved: true` and a
 * replayable move sequence as soon as a win is generated, otherwise
 * `solved: false` when the open set empties or the number of expanded states
 * reaches `budget`. `expanded` never exceeds `budget`.
 */
export function solve(
  board: Board,
  capacity: number,
  budget = 200_000,
): SolveResult {
  if (!Number.isInteger(capacity) || capacity <= 0) {
    throw new RangeError(`solve: capacity must be a positive integer, got ${capacity}`);
  }

  if (isWin(board, capacity)) {
    return { solved: true, moves: [], expanded: 0 };
  }

  const rootH = heuristic(board);
  const root: Node = {
    board,
    g: 0,
    h: rootH,
    f: rootH,
    parent: null,
    from: -1,
    to: -1,
    seq: 0,
  };

  const maxExpansions = Math.max(0, Math.floor(budget));
  const visited = new Set<string>([canonicalKey(board)]);
  const open = new MinHeap();
  open.push(root);

  let expanded = 0;
  let seq = 1;

  while (open.size > 0 && expanded < maxExpansions) {
    const node = open.pop()!;
    expanded += 1;

    const current = node.board;
    const tubeCount = current.length;

    let firstEmpty = -1;
    for (let i = 0; i < tubeCount; i += 1) {
      if (current[i]!.length === 0) {
        firstEmpty = i;
        break;
      }
    }

    for (let from = 0; from < tubeCount; from += 1) {
      const source = current[from]!;
      if (source.length === 0) continue;
      // Prune 1: never pour from a complete tube.
      if (isTubeComplete(source, capacity)) continue;

      const color = source[source.length - 1]!;
      let run = 1;
      for (let i = source.length - 2; i >= 0; i -= 1) {
        if (source[i] !== color) break;
        run += 1;
      }
      const sourceUniform = run === source.length;

      for (let to = 0; to < tubeCount; to += 1) {
        if (to === from) continue;
        const target = current[to]!;
        if (target.length >= capacity) continue;

        if (target.length === 0) {
          // Prune 2: never pour a single-color tube into an empty tube.
          if (sourceUniform) continue;
          // Prune 3: with several empty tubes, only the first is a target.
          if (to !== firstEmpty) continue;
        } else if (target[target.length - 1] !== color) {
          continue;
        }

        const child = pour(current, capacity, from, to, color, run);

        if (isWin(child, capacity)) {
          const goal: Node = {
            board: child,
            g: node.g + 1,
            h: 0,
            f: node.g + 1,
            parent: node,
            from,
            to,
            seq,
          };
          return { solved: true, moves: buildPath(goal), expanded };
        }

        const key = canonicalKey(child);
        if (visited.has(key)) continue;
        visited.add(key);

        const g = node.g + 1;
        const h = heuristic(child);
        open.push({
          board: child,
          g,
          h,
          f: g + h,
          parent: node,
          from,
          to,
          seq,
        });
        seq += 1;
      }
    }
  }

  return { solved: false, moves: [], expanded };
}
