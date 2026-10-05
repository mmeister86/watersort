// Board rendering for the Water Sort game screen.
//
// The pure helpers at the top are DOM-free and unit-tested. `createBoardView`
// owns the `[data-board]` grid. Tube nodes are created once per level and then
// updated in place, so liquid levels can animate between states (drain, fill,
// undo, restart) and a running pour animation survives a re-render.

import { colorName } from '@shared/rules';

import {
  HIDDEN_UNIT,
  canMove,
  visibleUnits,
  type GameState,
  type VisibleUnit,
} from '../game/state';
import { colorSymbol } from './symbols';

/** Hard cap on grid columns from AGENTS.md: two rows of at most 8 tubes. */
export const MAX_COLUMNS = 8;

/**
 * Number of grid columns for `tubeCount`: a single row up to 8 tubes, then two
 * balanced rows (e.g. 12 tubes → 6 columns), capped at 8 columns.
 */
export function boardColumns(tubeCount: number): number {
  if (tubeCount <= MAX_COLUMNS) {
    return Math.max(1, tubeCount);
  }
  return Math.min(MAX_COLUMNS, Math.ceil(tubeCount / 2));
}

/** Tube geometry in CSS pixels, all derived from the height of one unit. */
export type BoardMetrics = {
  /** Grid columns; rows follow from the tube count. */
  cols: number;
  /** Height of one liquid unit. */
  unit: number;
  tubeWidth: number;
  tubeHeight: number;
  gapX: number;
  gapY: number;
};

/** Tube width relative to one unit. */
const WIDTH_PER_UNIT = 1.1;
/** Empty glass above a full tube (neck + rim), in units. */
const HEADROOM_UNITS = 0.75;
/** Horizontal gap relative to the tube width. */
const GAP_X_PER_WIDTH = 0.42;
/** Vertical gap between rows, in units. Leaves room for the selection lift. */
const GAP_Y_UNITS = 1;
/** Free space kept above the top row for the selection lift, in units. */
const LIFT_UNITS = 0.6;
const MIN_UNIT = 12;
const MAX_UNIT = 72;

function metricsFor(
  tubeCount: number,
  cols: number,
  capacity: number,
  width: number,
  height: number,
): BoardMetrics {
  const rows = Math.max(1, Math.ceil(tubeCount / cols));
  const widthUnits = (cols + (cols - 1) * GAP_X_PER_WIDTH) * WIDTH_PER_UNIT;
  const heightUnits =
    rows * (capacity + HEADROOM_UNITS) + (rows - 1) * GAP_Y_UNITS + LIFT_UNITS;

  const fit = Math.min(width / widthUnits, height / heightUnits, MAX_UNIT);
  const unit = Math.max(MIN_UNIT, Math.floor(fit));
  const tubeWidth = Math.round(unit * WIDTH_PER_UNIT);

  return {
    cols,
    unit,
    tubeWidth,
    tubeHeight: Math.round(unit * (capacity + HEADROOM_UNITS)),
    gapX: Math.round(tubeWidth * GAP_X_PER_WIDTH),
    gapY: Math.round(unit * GAP_Y_UNITS),
  };
}

/**
 * The largest tube size that fits `tubeCount` tubes of `capacity` units into a
 * `width` × `height` box. Uses the two-row split of {@link boardColumns}, or a
 * single row when that gives bigger tubes (wide screens, landscape phones).
 * Pure, so it can be unit-tested without a DOM.
 */
export function boardMetrics(
  tubeCount: number,
  capacity: number,
  width: number,
  height: number,
): BoardMetrics {
  const split = metricsFor(tubeCount, boardColumns(tubeCount), capacity, width, height);
  if (tubeCount <= MAX_COLUMNS) {
    return split;
  }
  const single = metricsFor(tubeCount, tubeCount, capacity, width, height);
  return single.unit > split.unit ? single : split;
}

/**
 * German aria-label for one tube. `units` are the units as *rendered*, so a
 * hidden placeholder is announced as unknown. The empty and visible formats
 * include the fill count, per the task brief.
 */
export function tubeAriaLabel(
  index: number,
  units: readonly VisibleUnit[],
  capacity: number,
): string {
  const tube = index + 1;
  if (units.length === 0) {
    return `Röhre ${tube}, leer`;
  }

  const top = units[units.length - 1];
  if (top === undefined) {
    return `Röhre ${tube}, leer`;
  }
  if (top === HIDDEN_UNIT) {
    return `Röhre ${tube}, oben unbekannt`;
  }
  return `Röhre ${tube}, oben ${colorName(top)}, ${units.length} von ${capacity} gefüllt`;
}

/**
 * The units to draw for one tube: the real colors, or the top-revealing mask
 * when the level has hidden layers.
 */
export function renderedUnits(state: GameState, index: number): VisibleUnit[] {
  const tube = state.board[index] ?? [];
  return state.level.hidden ? visibleUnits(tube) : tube.slice();
}

/** Whether a rendered tube is full with one visible color (gets a cork). */
export function isTubeComplete(
  units: readonly VisibleUnit[],
  capacity: number,
): boolean {
  if (units.length !== capacity || capacity === 0) {
    return false;
  }
  const first = units[0];
  return first !== HIDDEN_UNIT && units.every((unit) => unit === first);
}

/** A live board bound to a container element. */
export type BoardView = {
  readonly element: HTMLElement;
  /**
   * Updates every tube for `state` and returns the buttons in tube order.
   * `selection` marks the lifted tube and highlights its legal targets. When
   * `colorBlind` is true every visible unit gets its color's symbol overlay.
   * Tube nodes are reused while the tube count and capacity stay the same, so
   * focus and running animations survive the update.
   */
  update(
    state: GameState,
    selection: number | null,
    colorBlind?: boolean,
  ): HTMLButtonElement[];
  /** The current tube buttons in tube order. */
  tubes(): HTMLButtonElement[];
  /** The geometry currently applied to the board. */
  metrics(): BoardMetrics;
};

type TubeNode = {
  button: HTMLButtonElement;
  units: HTMLSpanElement[];
};

function createTube(index: number, capacity: number): TubeNode {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'tube';
  button.dataset.tube = String(index);

  const glass = document.createElement('span');
  glass.className = 'tube__glass';
  const liquid = document.createElement('span');
  liquid.className = 'tube__liquid';

  const units: HTMLSpanElement[] = [];
  for (let slot = 0; slot < capacity; slot += 1) {
    const unit = document.createElement('span');
    unit.className = 'unit is-empty';
    // The tube's aria-label names the contents; layers are purely visual.
    unit.setAttribute('aria-hidden', 'true');
    liquid.append(unit);
    units.push(unit);
  }
  glass.append(liquid);

  const cork = document.createElement('span');
  cork.className = 'tube__cork';
  cork.setAttribute('aria-hidden', 'true');

  button.append(glass, cork);
  return { button, units };
}

function updateUnit(
  node: HTMLSpanElement,
  unit: VisibleUnit | undefined,
  isSurface: boolean,
  colorBlind: boolean,
): void {
  if (unit === undefined) {
    // Keep the last color while the slot drains, so it shrinks instead of
    // vanishing. An empty slot has no height and is never seen.
    node.classList.add('is-empty');
    node.classList.remove('is-hidden', 'is-surface');
    node.textContent = '';
    return;
  }

  node.classList.remove('is-empty');
  node.classList.toggle('is-surface', isSurface);
  if (unit === HIDDEN_UNIT) {
    node.classList.add('is-hidden');
    node.textContent = '';
    return;
  }

  node.classList.remove('is-hidden');
  node.dataset.color = String(unit);
  if (colorBlind) {
    if (node.firstElementChild === null || node.textContent !== colorSymbol(unit)) {
      const symbol = document.createElement('span');
      symbol.className = 'unit__symbol';
      symbol.textContent = colorSymbol(unit);
      node.replaceChildren(symbol);
    }
  } else if (node.firstChild !== null) {
    node.textContent = '';
  }
}

function setMetrics(element: HTMLElement, metrics: BoardMetrics): void {
  element.style.setProperty('--cols', String(metrics.cols));
  element.style.setProperty('--unit', `${metrics.unit}px`);
  element.style.setProperty('--tube-w', `${metrics.tubeWidth}px`);
  element.style.setProperty('--tube-h', `${metrics.tubeHeight}px`);
  element.style.setProperty('--gap-x', `${metrics.gapX}px`);
  element.style.setProperty('--gap-y', `${metrics.gapY}px`);
}

/**
 * Creates the board view for the `[data-board]` element. The board sizes its
 * tubes to fill its parent and re-fits whenever the parent is resized.
 */
export function createBoardView(element: HTMLElement): BoardView {
  let nodes: TubeNode[] = [];
  let capacity = 0;
  let current = boardMetrics(1, 4, 0, 0);
  const container = element.parentElement ?? element;

  const fit = (): void => {
    if (nodes.length === 0) return;
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width === 0 || height === 0) return;
    current = boardMetrics(nodes.length, capacity, width, height);
    setMetrics(element, current);
  };

  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(fit).observe(container);
  }

  const update = (
    state: GameState,
    selection: number | null,
    colorBlind = false,
  ): HTMLButtonElement[] => {
    const levelCapacity = state.level.capacity;
    const attached = nodes[0]?.button.parentElement === element;
    if (
      !attached ||
      nodes.length !== state.board.length ||
      capacity !== levelCapacity
    ) {
      capacity = levelCapacity;
      nodes = state.board.map((_, index) => createTube(index, levelCapacity));
      element.replaceChildren(...nodes.map((node) => node.button));
      element.style.setProperty('--cols', String(boardColumns(nodes.length)));
      fit();
    }

    element.classList.toggle('is-color-blind', colorBlind);

    nodes.forEach((node, index) => {
      const units = renderedUnits(state, index);
      node.units.forEach((slot, position) => {
        updateUnit(slot, units[position], position === units.length - 1, colorBlind);
      });

      const { button } = node;
      button.setAttribute('aria-label', tubeAriaLabel(index, units, levelCapacity));
      button.classList.toggle('is-selected', selection === index);
      button.classList.toggle(
        'is-legal',
        selection !== null && selection !== index && canMove(state, selection, index),
      );
      button.classList.toggle('is-complete', isTubeComplete(units, levelCapacity));
    });

    return nodes.map((node) => node.button);
  };

  return {
    element,
    update,
    tubes: () => nodes.map((node) => node.button),
    metrics: () => current,
  };
}
