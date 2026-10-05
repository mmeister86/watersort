// Player-picker screen controller.
//
// Renders the family's players, creates new ones (name + one of the 14 palette
// colors), and deletes them after a confirmation. Selection persists the active
// player and hands the chosen player back to the caller.

import { colorName } from '@shared/rules';

import {
  createPlayer as apiCreatePlayer,
  deletePlayer as apiDeletePlayer,
  listPlayers as apiListPlayers,
  type Player,
} from '../api';
import {
  performCreatePlayer,
  performDeletePlayer,
} from '../flow';
import type { AppStorage } from '../storage';
import { icon } from './icons';
import type { ScreenManager } from './screens';

/** The 14 selectable player colors, in palette order. */
export const PLAYER_COLORS: ReadonlyArray<{ id: number; name: string }> = Array.from(
  { length: 14 },
  (_unused, index) => ({ id: index + 1, name: colorName(index + 1) }),
);

const COLOR_ID_BY_NAME = new Map(
  PLAYER_COLORS.map((color) => [color.name, color.id]),
);

const SELECTORS = {
  list: '[data-player-list]',
  newPlayer: '[data-action="new-player"]',
  cancel: '[data-action="cancel-player"]',
  notice: '[data-notice="player"]',
  form: '[data-form="player"]',
  nameInput: '[data-input="player-name"]',
  colors: '[data-colors]',
  formError: '[data-error="player"]',
} as const;

export type PlayerScreenDeps = {
  screens: ScreenManager;
  storage: AppStorage;
  /** API seams, injectable for tests. */
  listPlayers?: () => Promise<Player[]>;
  createPlayer?: (name: string, color: string) => Promise<Player>;
  deletePlayer?: (id: string) => Promise<void>;
  /** Confirmation for deletion; defaults to `window.confirm`. */
  confirmDelete?: (name: string) => boolean;
  /** Called after a player is tapped. */
  onSelect: (player: Player) => void;
  /** Called after a player (and their local state) is deleted. */
  onDeleted?: (id: string) => void;
};

export type PlayerController = {
  /** Renders a known player list and shows the screen. */
  show(players: Player[]): void;
  /** Re-fetches the list from the server and re-renders. */
  refresh(): Promise<void>;
};

function requireElement<T extends Element>(root: ParentNode, selector: string): T {
  const found = root.querySelector<T>(selector);
  if (found === null) {
    throw new Error(`Player screen is missing ${selector}`);
  }
  return found;
}

function colorStyle(id: number): string {
  return `var(--color-${id})`;
}

/** Builds the player-picker controller and wires its controls immediately. */
export function createPlayerController(deps: PlayerScreenDeps): PlayerController {
  const { screens, storage, onSelect, onDeleted } = deps;
  const fetchPlayers = deps.listPlayers ?? apiListPlayers;
  const createPlayer = deps.createPlayer ?? apiCreatePlayer;
  const deletePlayer = deps.deletePlayer ?? apiDeletePlayer;
  const confirmDelete =
    deps.confirmDelete ??
    ((name: string): boolean =>
      globalThis.confirm(`Spieler löschen? "${name}" wird entfernt.`));

  const screen = screens.screens['player-picker'];
  const list = requireElement<HTMLElement>(screen, SELECTORS.list);
  const newPlayerButton = requireElement<HTMLButtonElement>(screen, SELECTORS.newPlayer);
  const cancelButton = requireElement<HTMLButtonElement>(screen, SELECTORS.cancel);
  const notice = requireElement<HTMLElement>(screen, SELECTORS.notice);
  const form = requireElement<HTMLFormElement>(screen, SELECTORS.form);
  const nameInput = requireElement<HTMLInputElement>(screen, SELECTORS.nameInput);
  const colors = requireElement<HTMLElement>(screen, SELECTORS.colors);
  const formError = requireElement<HTMLElement>(screen, SELECTORS.formError);

  let players: Player[] = [];
  let selectedColorId = PLAYER_COLORS[0]?.id ?? 1;
  let busy = false;

  const swatches: HTMLButtonElement[] = [];

  function selectColor(id: number): void {
    selectedColorId = id;
    for (const swatch of swatches) {
      const isSelected = Number(swatch.dataset.colorId) === id;
      swatch.classList.toggle('is-selected', isSelected);
      swatch.setAttribute('aria-pressed', String(isSelected));
    }
  }

  for (const color of PLAYER_COLORS) {
    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'color-swatch';
    swatch.dataset.colorId = String(color.id);
    swatch.style.background = colorStyle(color.id);
    swatch.setAttribute('aria-label', color.name);
    swatch.title = color.name;
    swatch.addEventListener('click', () => {
      selectColor(color.id);
    });
    swatches.push(swatch);
    colors.append(swatch);
  }
  selectColor(selectedColorId);

  function setNotice(message: string | null): void {
    if (message === null) {
      notice.hidden = true;
      return;
    }
    notice.textContent = message;
    notice.hidden = false;
  }

  function setFormError(message: string | null): void {
    if (message === null) {
      formError.hidden = true;
      return;
    }
    formError.textContent = message;
    formError.hidden = false;
  }

  function hideForm(): void {
    form.hidden = true;
    setFormError(null);
    nameInput.value = '';
  }

  function render(): void {
    list.replaceChildren();
    if (players.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'player-list__empty';
      empty.textContent = 'Noch keine Spieler vorhanden.';
      list.append(empty);
      return;
    }

    for (const player of players) {
      const row = document.createElement('li');
      row.className = 'player-row';

      const select = document.createElement('button');
      select.type = 'button';
      select.className = 'player';
      select.dataset.playerId = player.id;

      const dot = document.createElement('span');
      dot.className = 'player__dot';
      const colorId = COLOR_ID_BY_NAME.get(player.color);
      if (colorId !== undefined) {
        dot.style.background = colorStyle(colorId);
        select.style.setProperty('--player-color', colorStyle(colorId));
      }
      select.append(dot);

      const name = document.createElement('span');
      name.className = 'player__name';
      name.textContent = player.name;
      select.append(name);

      const level = document.createElement('span');
      level.className = 'player__level';
      level.textContent = `Level ${player.level}`;
      select.append(level);

      select.addEventListener('click', () => {
        storage.setActivePlayer(player.id);
        onSelect(player);
      });

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'tool player__remove';
      remove.title = 'Entfernen';
      remove.append(icon('remove'));
      remove.setAttribute('aria-label', `${player.name} entfernen`);
      remove.addEventListener('click', () => {
        void removePlayer(player);
      });

      row.append(select, remove);
      list.append(row);
    }
  }

  async function removePlayer(player: Player): Promise<void> {
    if (busy) return;
    if (!confirmDelete(player.name)) return;
    busy = true;
    setNotice(null);

    const outcome = await performDeletePlayer(
      player.id,
      deletePlayer,
      (id) => {
        storage.removePlayer(id);
      },
    );
    if (outcome === 'failed') {
      setNotice('Spieler konnte nicht gelöscht werden.');
      busy = false;
      return;
    }

    players = players.filter((entry) => entry.id !== player.id);
    onDeleted?.(player.id);
    render();
    busy = false;
  }

  newPlayerButton.addEventListener('click', () => {
    setNotice(null);
    setFormError(null);
    form.hidden = false;
    nameInput.focus();
  });

  cancelButton.addEventListener('click', () => {
    hideForm();
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (busy) return;

    const color = colorName(selectedColorId);
    busy = true;
    setFormError(null);

    void (async () => {
      const outcome = await performCreatePlayer(
        nameInput.value,
        color,
        createPlayer,
      );
      busy = false;
      switch (outcome.kind) {
        case 'ok':
          hideForm();
          await refresh();
          return;
        case 'invalid-name':
          setFormError('Bitte einen Namen mit 1–20 Zeichen eingeben.');
          return;
        case 'name-taken':
          setFormError('Name bereits vergeben.');
          return;
        case 'invalid':
          setFormError('Ungültiger Name oder Farbe.');
          return;
        case 'failed':
          setFormError('Anlegen fehlgeschlagen.');
          return;
      }
    })();
  });

  function show(nextPlayers: Player[]): void {
    players = nextPlayers;
    setNotice(null);
    hideForm();
    render();
    screens.show('player-picker');
  }

  async function refresh(): Promise<void> {
    try {
      players = await fetchPlayers();
      render();
    } catch {
      setNotice('Spieler konnten nicht geladen werden.');
    }
  }

  return { show, refresh };
}
