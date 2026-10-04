// Board rendering for the Water Sort game screen.
//
// The pure helpers at the top are DOM-free and unit-tested. `createBoardView`
// owns the `[data-board]` grid: it rebuilds the tube buttons on every state
// change so layers, aria-labels, selection and legal-target highlights can
// never drift out of sync.

import { colorName } from '@shared/rules';
import type { Level } from '@shared/generator';

import {
  HIDDEN_UNIT,
  canMove,
  visibleUnits,
  type GameState,
  type VisibleUnit,
} from '../game/state';

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

/** A live board bound to a container element. */
export type BoardView = {
  readonly element: HTMLElement;
  /**
   * Rebuilds every tube for `state` and returns the buttons in tube order.
   * `selection` marks the lifted tube and highlights its legal targets.
   */
  update(state: GameState, selection: number | null): HTMLButtonElement[];
};

function createLayer(unit: VisibleUnit): HTMLDivElement {
  const layer = document.createElement('div');
  layer.className = 'unit';
  if (unit === HIDDEN_UNIT) {
    layer.classList.add('is-hidden');
  } else {
    layer.dataset.color = String(unit);
  }
  return layer;
}

/** Creates the board view for the `[data-board]` element. */
export function createBoardView(element: HTMLElement): BoardView {
  const update = (
    state: GameState,
    selection: number | null,
  ): HTMLButtonElement[] => {
    const capacity = state.level.capacity;
    element.style.setProperty('--cols', String(boardColumns(state.board.length)));
    element.style.setProperty('--capacity', String(capacity));
    element.replaceChildren();

    const buttons: HTMLButtonElement[] = [];
    for (let index = 0; index < state.board.length; index += 1) {
      const units = renderedUnits(state, index);

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'tube';
      button.dataset.tube = String(index);
      for (const unit of units) {
        button.append(createLayer(unit));
      }
      button.setAttribute('aria-label', tubeAriaLabel(index, units, capacity));

      if (selection === index) {
        button.classList.add('is-selected');
      } else if (selection !== null && canMove(state, selection, index)) {
        button.classList.add('is-legal');
      }

      element.append(button);
      buttons.push(button);
    }
    return buttons;
  };

  return { element, update };
}
