import { describe, expect, it } from 'vitest';

import { GENERATOR_VERSION, type Level } from '@shared/generator';
import type { Board } from '@shared/rules';

import { startLevel, move as applyGameMove } from '../src/game/state';
import {
  boardColumns,
  boardMetrics,
  isTubeComplete,
  renderedUnits,
  tubeAriaLabel,
} from '../src/ui/board';
import { restoreState } from '../src/ui/gameScreen';
import { TUBE_KEYS, keyboardAction, type KeyModifiers } from '../src/ui/input';
import type { PlayerProgress } from '../src/storage';

const CAPACITY = 3;

const NO_MODS: KeyModifiers = {
  ctrl: false,
  meta: false,
  alt: false,
  shift: false,
  repeat: false,
};

function withMods(overrides: Partial<KeyModifiers>): KeyModifiers {
  return { ...NO_MODS, ...overrides };
}

function levelWith(tubes: Board, capacity = CAPACITY, n = 1): Level {
  return {
    n,
    version: GENERATOR_VERSION,
    tubes,
    capacity,
    hidden: false,
    solution: [],
  };
}

describe('boardColumns', () => {
  it('uses a single row for up to 8 tubes', () => {
    expect(boardColumns(1)).toBe(1);
    expect(boardColumns(5)).toBe(5);
    expect(boardColumns(8)).toBe(8);
  });

  it('splits more than 8 tubes into two balanced rows capped at 8', () => {
    expect(boardColumns(9)).toBe(5);
    expect(boardColumns(12)).toBe(6);
    expect(boardColumns(16)).toBe(8);
  });
});

describe('boardMetrics', () => {
  it('fills the width with a single row of few tubes', () => {
    const m = boardMetrics(5, 4, 358, 600);
    const used = 5 * m.tubeWidth + 4 * m.gapX;
    expect(used).toBeLessThanOrEqual(358);
    expect(used).toBeGreaterThan(358 * 0.85);
  });

  it('fits every row into the height', () => {
    for (const [width, height] of [[900, 300], [358, 560], [1200, 700]] as const) {
      const m = boardMetrics(16, 5, width, height);
      const rows = Math.ceil(16 / m.cols);
      const used = rows * m.tubeHeight + (rows - 1) * m.gapY + m.unit * 0.6;
      expect(used).toBeLessThanOrEqual(height);
      expect(m.cols * m.tubeWidth + (m.cols - 1) * m.gapX).toBeLessThanOrEqual(width);
    }
  });

  it('uses two rows on a narrow screen and one row on a wide, short one', () => {
    expect(boardMetrics(12, 4, 358, 640).cols).toBe(6);
    expect(boardMetrics(12, 4, 1600, 300).cols).toBe(12);
  });

  it('caps the unit size on large screens and never goes below the minimum', () => {
    expect(boardMetrics(3, 4, 4000, 4000).unit).toBe(72);
    expect(boardMetrics(16, 5, 10, 10).unit).toBe(12);
  });

  it('derives every size from the unit', () => {
    const m = boardMetrics(8, 4, 800, 600);
    expect(m.tubeWidth).toBe(Math.round(m.unit * 1.1));
    expect(m.tubeHeight).toBe(Math.round(m.unit * 4.75));
  });
});

describe('isTubeComplete', () => {
  it('is true for a full single-color tube', () => {
    expect(isTubeComplete([2, 2, 2], 3)).toBe(true);
  });

  it('is false for partial, mixed, empty or hidden tubes', () => {
    expect(isTubeComplete([2, 2], 3)).toBe(false);
    expect(isTubeComplete([2, 1, 2], 3)).toBe(false);
    expect(isTubeComplete([], 3)).toBe(false);
    expect(isTubeComplete(['?', '?', 2], 3)).toBe(false);
  });
});

describe('tubeAriaLabel', () => {
  it('labels an empty tube', () => {
    expect(tubeAriaLabel(4, [], 4)).toBe('Röhre 5, leer');
  });

  it('labels a visible top color with the fill count', () => {
    expect(tubeAriaLabel(2, [1, 2], 4)).toBe(
      'Röhre 3, oben blau, 2 von 4 gefüllt',
    );
  });

  it('labels a hidden top as unknown', () => {
    expect(tubeAriaLabel(1, ['?', 3, '?'], 4)).toBe('Röhre 2, oben unbekannt');
  });
});

describe('renderedUnits', () => {
  it('returns the real colors when the level has no hidden layers', () => {
    const state = startLevel(levelWith([[1, 2, 3], []]));
    expect(renderedUnits(state, 0)).toEqual([1, 2, 3]);
  });

  it('masks every unit below the top when layers are hidden', () => {
    const level = { ...levelWith([[1, 2, 3]]), hidden: true };
    const state = startLevel(level);
    expect(renderedUnits(state, 0)).toEqual(['?', '?', 3]);
  });
});

describe('TUBE_KEYS', () => {
  it('maps digits and the Q..P row, leaving R for restart', () => {
    expect(TUBE_KEYS['1']).toBe(0);
    expect(TUBE_KEYS['9']).toBe(8);
    expect(TUBE_KEYS['0']).toBe(9);
    expect(TUBE_KEYS.q).toBe(10);
    expect(TUBE_KEYS.w).toBe(11);
    expect(TUBE_KEYS.e).toBe(12);
    expect(TUBE_KEYS.r).toBeUndefined();
    expect(TUBE_KEYS.t).toBe(14);
    expect(TUBE_KEYS.p).toBe(19);
  });
});

describe('keyboardAction', () => {
  it('selects tubes with digits, 0 and the Q..P row', () => {
    expect(keyboardAction('1', NO_MODS)).toEqual({ kind: 'select', index: 0 });
    expect(keyboardAction('9', NO_MODS)).toEqual({ kind: 'select', index: 8 });
    expect(keyboardAction('0', NO_MODS)).toEqual({ kind: 'select', index: 9 });
    expect(keyboardAction('Q', NO_MODS)).toEqual({ kind: 'select', index: 10 });
    expect(keyboardAction('p', NO_MODS)).toEqual({ kind: 'select', index: 19 });
    expect(keyboardAction('t', NO_MODS)).toEqual({ kind: 'select', index: 14 });
  });

  it('restarts on R instead of selecting tube 14', () => {
    expect(keyboardAction('r', NO_MODS)).toEqual({ kind: 'restart' });
    expect(keyboardAction('R', NO_MODS)).toEqual({ kind: 'restart' });
  });

  it('does not hijack browser shortcuts with Ctrl/Cmd', () => {
    expect(keyboardAction('r', withMods({ ctrl: true }))).toBeNull();
    expect(keyboardAction('r', withMods({ meta: true }))).toBeNull();
    expect(keyboardAction('q', withMods({ ctrl: true }))).toBeNull();
  });

  it('undoes on plain Z and the platform chords', () => {
    expect(keyboardAction('z', NO_MODS)).toEqual({ kind: 'undo' });
    expect(keyboardAction('Z', NO_MODS)).toEqual({ kind: 'undo' });
    expect(keyboardAction('z', withMods({ ctrl: true }))).toEqual({
      kind: 'undo',
    });
    expect(keyboardAction('z', withMods({ meta: true }))).toEqual({
      kind: 'undo',
    });
  });

  it('deselects on Escape', () => {
    expect(keyboardAction('Escape', NO_MODS)).toEqual({ kind: 'deselect' });
  });

  it('ignores auto-repeat and unbound keys', () => {
    expect(keyboardAction('1', withMods({ repeat: true }))).toBeNull();
    expect(keyboardAction('x', NO_MODS)).toBeNull();
    expect(keyboardAction('q', withMods({ alt: true }))).toBeNull();
    expect(keyboardAction('z', withMods({ alt: true }))).toBeNull();
  });
});

describe('restoreState', () => {
  it('replays a valid history and matches the saved state', () => {
    const level = levelWith([[1], [2], []]);
    const state = applyGameMove(startLevel(level), 0, 2);
    const progress: PlayerProgress = {
      level: 1,
      board: state.board,
      moves: state.moves,
      history: state.history,
      version: GENERATOR_VERSION,
    };

    expect(restoreState(level, progress)).toEqual(state);
  });

  it('restores from history alone when no board is stored', () => {
    const level = levelWith([[1], [2], []]);
    const state = applyGameMove(startLevel(level), 0, 2);
    const progress: PlayerProgress = {
      level: 1,
      history: state.history,
      version: GENERATOR_VERSION,
    };

    expect(restoreState(level, progress)).toEqual(state);
  });

  it('rejects a history with an illegal move', () => {
    const level = levelWith([[1], [2], []]);
    const progress: PlayerProgress = {
      level: 1,
      history: [{ from: 0, to: 1 }],
      version: GENERATOR_VERSION,
    };

    expect(restoreState(level, progress)).toBeNull();
  });

  it('rejects a board whose tube count does not match the level', () => {
    const level = levelWith([[1], [2], []]);
    const progress: PlayerProgress = {
      level: 1,
      board: [[1]],
      history: [],
      version: GENERATOR_VERSION,
    };

    expect(restoreState(level, progress)).toBeNull();
  });

  it('rejects a board that disagrees with the replayed history', () => {
    const level = levelWith([[1], [2], []]);
    const progress: PlayerProgress = {
      level: 1,
      board: [[], [2], [1]],
      history: [],
      version: GENERATOR_VERSION,
    };

    expect(restoreState(level, progress)).toBeNull();
  });

  it('rejects a board with more units than the level capacity', () => {
    const level = levelWith([[1], [2], []]);
    const progress: PlayerProgress = {
      level: 1,
      board: [[1, 1, 1, 1], [], []],
      history: [],
      version: GENERATOR_VERSION,
    };

    expect(restoreState(level, progress)).toBeNull();
  });

  it('requires a history field', () => {
    const level = levelWith([[1], [2], []]);
    const progress: PlayerProgress = { level: 1, version: GENERATOR_VERSION };

    expect(restoreState(level, progress)).toBeNull();
  });
});
