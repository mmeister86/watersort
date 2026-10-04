// Pure game rules for Water Sort. No DOM, no Node APIs, no randomness here.

/** Color identifier, 1..K. */
export type ColorId = number;

/** A tube as a stack of colors. Index 0 is the bottom of the tube. */
export type Tube = ColorId[];

/** The whole board: an array of tubes. */
export type Board = Tube[];

/** A pour between two tube indices. */
export type Move = {
  from: number;
  to: number;
};

/** The color on top of a tube, or undefined when the tube is empty. */
function top(tube: Tube): ColorId | undefined {
  return tube[tube.length - 1];
}

/**
 * A move `from -> to` is legal when the tubes differ, the source is not
 * empty, the target is not full, and the target is empty or its top color
 * matches the source's top color.
 */
export function isMoveLegal(
  board: Board,
  capacity: number,
  from: number,
  to: number,
): boolean {
  if (from === to) return false;

  const source = board[from];
  const target = board[to];
  if (source === undefined || target === undefined) return false;

  if (source.length === 0) return false;
  if (target.length >= capacity) return false;

  if (target.length === 0) return true;
  return top(target) === top(source);
}

/**
 * Applies a legal move and returns a new board. The board array and every
 * tube that changes are new; tubes that are untouched may be shared by
 * reference. The whole contiguous top run of the source color is poured,
 * limited by the free space in the target. Throws on an illegal move.
 */
export function applyMove(
  board: Board,
  capacity: number,
  from: number,
  to: number,
): Board {
  if (!isMoveLegal(board, capacity, from, to)) {
    throw new Error(`Illegal move from tube ${from} to tube ${to}`);
  }

  const source = board[from] as Tube;
  const target = board[to] as Tube;
  const color = top(source) as ColorId;

  let run = 0;
  for (let i = source.length - 1; i >= 0; i -= 1) {
    if (source[i] !== color) break;
    run += 1;
  }

  const free = capacity - target.length;
  const amount = Math.min(run, free);

  const nextSource = source.slice(0, source.length - amount);
  const nextTarget = target.concat(Array<ColorId>(amount).fill(color));

  const next = board.slice();
  next[from] = nextSource;
  next[to] = nextTarget;
  return next;
}

/** A tube is complete when it is full and holds a single color. */
export function isTubeComplete(tube: Tube, capacity: number): boolean {
  if (tube.length !== capacity) return false;
  const color = tube[0];
  return tube.every((unit) => unit === color);
}

/** The board is won when every tube is empty or complete. */
export function isWin(board: Board, capacity: number): boolean {
  return board.every(
    (tube) => tube.length === 0 || isTubeComplete(tube, capacity),
  );
}

/** German color names for ids 1..14, used for accessible labels. */
const COLOR_NAMES: readonly string[] = [
  'rot',
  'blau',
  'grün',
  'gelb',
  'orange',
  'violett',
  'pink',
  'türkis',
  'braun',
  'hellblau',
  'dunkelgrün',
  'grau',
  'schwarz',
  'weiß',
];

/**
 * Returns the German name for a color id. Ids 1..14 map to the palette;
 * anything else falls back to a generic German label so callers always get
 * a usable string.
 */
export function colorName(id: ColorId): string {
  return COLOR_NAMES[id - 1] ?? `Farbe ${id}`;
}
