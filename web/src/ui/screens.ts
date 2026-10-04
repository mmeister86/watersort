// Screen shells for the Water Sort app plus the tiny screen-switching state.
//
// This module only builds the static DOM and toggles visibility. The behavior
// lives in the per-screen controllers (`codeScreen`, `playerScreen`,
// `gameScreen`), which query these `data-*` hooks.

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

  // Shown only when the server cannot be reached; lets the player continue
  // against the local board and sync later.
  const notice = el('p', 'form__notice', 'Server nicht erreichbar.');
  notice.hidden = true;
  notice.dataset.notice = 'code';
  form.append(notice);

  const offline = button('Offline weiter spielen');
  offline.dataset.action = 'offline';
  offline.hidden = true;
  form.append(offline);

  const submit = button('Los', 'button button--primary');
  submit.type = 'submit';
  form.append(submit);

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

  const notice = el('p', 'form__error');
  notice.setAttribute('role', 'alert');
  notice.hidden = true;
  notice.dataset.notice = 'player';
  panel.append(notice);

  const newPlayer = button('+ Neuer Spieler');
  newPlayer.dataset.action = 'new-player';
  panel.append(newPlayer);

  const form = el('form', 'form form--new-player');
  form.noValidate = true;
  form.dataset.form = 'player';
  form.hidden = true;

  const nameField = el('label', 'field');
  nameField.append(el('span', 'field__label', 'Name'));
  const nameInput = el('input', 'input');
  nameInput.type = 'text';
  nameInput.name = 'name';
  nameInput.maxLength = 20;
  nameInput.autocomplete = 'off';
  nameInput.placeholder = 'Name';
  nameInput.setAttribute('aria-label', 'Spielername');
  nameInput.dataset.input = 'player-name';
  nameField.append(nameInput);
  form.append(nameField);

  const colors = el('div', 'color-picker');
  colors.dataset.colors = '';
  colors.setAttribute('role', 'radiogroup');
  colors.setAttribute('aria-label', 'Farbe');
  form.append(colors);

  const formError = el('p', 'form__error');
  formError.setAttribute('role', 'alert');
  formError.hidden = true;
  formError.dataset.error = 'player';
  form.append(formError);

  const actions = el('div', 'form__actions');
  const cancel = button('Abbrechen');
  cancel.dataset.action = 'cancel-player';
  const create = button('Anlegen', 'button button--primary');
  create.type = 'submit';
  actions.append(cancel, create);
  form.append(actions);

  panel.append(form);

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

  // Live region for hint feedback (for example when no solve is available).
  const hintMessage = el('p', 'game__hint');
  hintMessage.dataset.hintMessage = '';
  hintMessage.setAttribute('role', 'status');
  hintMessage.hidden = true;
  game.append(hintMessage);

  const controls = el('div', 'controls');

  const undo = button('Zurück');
  undo.dataset.action = 'undo';
  undo.setAttribute('aria-keyshortcuts', 'Z');

  const restart = button('Neustart');
  restart.dataset.action = 'restart';
  restart.setAttribute('aria-keyshortcuts', 'R');

  const hint = button('Tipp');
  hint.dataset.action = 'hint';

  const symbols = button('Symbole');
  symbols.dataset.action = 'color-blind';
  // Keep the visible label ("Symbole") inside the accessible name.
  symbols.setAttribute('aria-label', 'Symbole (Farbenblind-Modus)');
  symbols.setAttribute('aria-pressed', 'false');

  const switchPlayer = button('Spieler');
  switchPlayer.dataset.action = 'switch-player';

  controls.append(undo, restart, hint, symbols, switchPlayer);
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

  const switchPlayer = button('Spieler wechseln');
  switchPlayer.dataset.action = 'switch-player';
  panel.append(switchPlayer);

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
