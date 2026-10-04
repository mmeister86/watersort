// Screen shells for the Water Sort app plus the tiny screen-switching state.
//
// Task 6 only builds the structure. Tasks 8 and 10 fill in the behavior:
// the game screen and its controls are inert here, and the family-code /
// player-picker screens are placeholders.

/** The four top-level screens, in flow order. */
export type ScreenId = 'code' | 'player-picker' | 'game' | 'complete';

export const SCREEN_IDS: readonly ScreenId[] = [
  'code',
  'player-picker',
  'game',
  'complete',
];

export type ScreenManager = {
  /** The section element for each screen. */
  readonly screens: Readonly<Record<ScreenId, HTMLElement>>;
  /** Shows one screen and hides the others. */
  show(id: ScreenId): void;
  /** The currently visible screen. */
  current(): ScreenId;
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

function button(label: string, className = 'button'): HTMLButtonElement {
  const node = el('button', className, label);
  node.type = 'button';
  return node;
}

function hudStat(label: string, value: string, key: string): HTMLElement {
  const wrap = el('div', 'hud__stat');
  wrap.append(el('span', 'hud__label', label));
  const valueNode = el('span', 'hud__value', value);
  valueNode.dataset.hud = key;
  wrap.append(valueNode);
  return wrap;
}

function createCodeScreen(): HTMLElement {
  const screen = el('section', 'screen screen--code');

  const panel = el('div', 'panel');
  panel.append(el('h1', 'title', 'Water Sort'));
  panel.append(
    el('p', 'subtitle', 'Bitte den Familien-Code eingeben.'),
  );

  const form = el('form', 'form');
  form.noValidate = true;
  form.dataset.form = 'code';

  const field = el('label', 'field');
  field.append(el('span', 'field__label', 'Familien-Code'));
  const input = el('input', 'input');
  input.type = 'password';
  input.name = 'code';
  input.autocomplete = 'off';
  input.placeholder = 'Code';
  input.setAttribute('aria-label', 'Familien-Code');
  input.dataset.input = 'code';
  field.append(input);
  form.append(field);

  const error = el('p', 'form__error', 'Falscher Code');
  error.setAttribute('role', 'alert');
  error.hidden = true;
  error.dataset.error = 'code';
  form.append(error);

  const submit = button('Los', 'button button--primary');
  submit.type = 'submit';
  form.append(submit);

  // Inert scaffold: swallow the submit so the placeholder never reloads the
  // page. Task 10 replaces this with the real session request.
  form.addEventListener('submit', (event) => {
    event.preventDefault();
  });

  panel.append(form);
  screen.append(panel);
  return screen;
}

function createPlayerScreen(): HTMLElement {
  const screen = el('section', 'screen screen--player-picker');

  const panel = el('div', 'panel panel--wide');
  panel.append(el('h1', 'title', 'Wer spielt?'));
  panel.append(el('p', 'subtitle', 'Spieler auswählen oder neu anlegen.'));

  const list = el('ul', 'player-list');
  list.dataset.playerList = '';
  list.append(el('li', 'player-list__empty', 'Noch keine Spieler vorhanden.'));
  panel.append(list);

  // Inert placeholder: Task 10 wires player creation and selection.
  panel.append(button('+ Neuer Spieler'));

  screen.append(panel);
  return screen;
}

function createGameScreen(): HTMLElement {
  const screen = el('section', 'screen screen--game');

  const game = el('div', 'game');

  const hud = el('header', 'hud');
  hud.append(hudStat('Level', '–', 'level'));
  hud.append(hudStat('Züge', '0', 'moves'));
  game.append(hud);

  const boardWrap = el('div', 'board-wrap');
  const board = el('div', 'board');
  board.dataset.board = '';
  board.setAttribute('role', 'group');
  board.setAttribute('aria-label', 'Spielfeld');
  board.append(el('p', 'board__placeholder', 'Spielfeld'));
  boardWrap.append(board);
  game.append(boardWrap);

  const controls = el('div', 'controls');

  const undo = button('Zurück');
  undo.dataset.action = 'undo';
  undo.setAttribute('aria-keyshortcuts', 'Z');

  const restart = button('Neustart');
  restart.dataset.action = 'restart';
  restart.setAttribute('aria-keyshortcuts', 'R');

  const hint = button('Tipp');
  hint.dataset.action = 'hint';

  controls.append(undo, restart, hint);
  game.append(controls);

  screen.append(game);
  return screen;
}

function createCompleteScreen(): HTMLElement {
  const screen = el('section', 'screen screen--complete');

  const panel = el('div', 'panel');
  panel.append(el('h1', 'title', 'Level geschafft!'));

  const level = el('p', 'subtitle', 'Level –');
  level.dataset.completeLevel = '';
  panel.append(level);

  // Stars are a placeholder until Task 13 fills them from the move count.
  const stars = el('div', 'stars');
  stars.dataset.stars = '';
  stars.setAttribute('role', 'img');
  stars.setAttribute('aria-label', 'Sterne: noch keine Bewertung');
  for (let i = 0; i < 3; i += 1) {
    stars.append(el('span', 'star', '★'));
  }
  panel.append(stars);

  const next = button('Weiter', 'button button--primary');
  next.dataset.action = 'next';
  panel.append(next);

  screen.append(panel);
  return screen;
}

/**
 * Builds every screen inside `root` and returns the tiny state machine that
 * toggles which one is visible. The initial screen is only recorded; call
 * `show` to apply the `is-active` class.
 */
export function createScreens(
  root: HTMLElement,
  initial: ScreenId = 'game',
): ScreenManager {
  const screens: Record<ScreenId, HTMLElement> = {
    code: createCodeScreen(),
    'player-picker': createPlayerScreen(),
    game: createGameScreen(),
    complete: createCompleteScreen(),
  };

  for (const id of SCREEN_IDS) {
    root.append(screens[id]);
  }

  let current: ScreenId = initial;

  const show = (id: ScreenId): void => {
    current = id;
    for (const screenId of SCREEN_IDS) {
      screens[screenId].classList.toggle('is-active', screenId === id);
    }
  };

  return {
    screens,
    show,
    current: () => current,
  };
}
