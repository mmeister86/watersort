// App entry point and top-level flow.
//
// Boot: probe the session by listing players. A 401 shows the family-code
// screen; an unreachable server offers offline play; a valid session shows the
// player picker. Selecting a player opens the game at `max(local, server)`
// level, and every solved level is reported to the server (queued when it
// fails and flushed on `online` and app start).

import './styles.css';

import { registerSW } from 'virtual:pwa-register';

import { listPlayers, type Player } from './api';
import { resolveBoot } from './flow';
import { createSyncCoordinator, mergeLevel } from './sync';
import { createStorage, type PendingSyncEntry } from './storage';
import { createCodeController } from './ui/codeScreen';
import { createGameController, LOCAL_PLAYER_ID, type SolvedInfo } from './ui/gameScreen';
import { createIosHint } from './ui/iosHint';
import { createPlayerController } from './ui/playerScreen';
import { createScreens } from './ui/screens';
import { generate, solveFirstMove } from './worker/client';

const container = document.querySelector<HTMLDivElement>('#app');

if (container === null) {
  throw new Error('#app element not found');
}

const storage = createStorage();
const screens = createScreens(container, 'code');
// Show the gate immediately so the app is never blank while the session probe
// runs; a valid session swaps to the player picker as soon as it resolves.
screens.show('code');

// One-time iOS Safari hint; a no-op elsewhere and after it was dismissed.
createIosHint({ storage }).maybeShow();

// Service worker: autoUpdate takes new versions in the background. The plugin
// would reload the page as soon as an update activates; skip that reload while
// a level is open so a running game is never interrupted. The new version is
// then used on the next launch.
registerSW({
  immediate: true,
  onNeedReload() {
    if (screens.current() !== 'game') {
      globalThis.location.reload();
    }
  },
});

// Serializes every flush so a solved level, the boot probe and the `online`
// event can never PUT the same queued entry twice.
const sync = createSyncCoordinator(storage);

/** Reports one solve: queue it, then try to flush the whole queue. */
async function reportSolved(info: SolvedInfo): Promise<void> {
  const entry: PendingSyncEntry = {
    playerId: info.playerId,
    level: info.level + 1,
    statsDelta: info.statsDelta,
  };
  sync.enqueue(entry);
  await sync.flush();
}

/**
 * Flushes queued updates, using the given players for their server-confirmed
 * levels when available, else fetching a fresh list. Best-effort: an offline
 * server or missing session just leaves the queue in place.
 */
async function flushProgress(knownPlayers?: Player[]): Promise<void> {
  if (globalThis.navigator?.onLine === false) {
    // Offline: leave the queue for the next `online` event. Still route through
    // the coordinator so an already-running flush finishes first.
    await sync.flush({ online: false });
    return;
  }

  let serverLevels: Map<string, number>;
  if (knownPlayers !== undefined) {
    serverLevels = new Map(knownPlayers.map((player) => [player.id, player.level]));
  } else {
    serverLevels = new Map();
    try {
      const players = await listPlayers();
      serverLevels = new Map(players.map((player) => [player.id, player.level]));
    } catch {
      // No session or no network: flush with no confirmed levels and let the
      // queue decide what to attempt.
    }
  }
  await sync.flush({ serverLevels });
}

/** Opens the game for `player`, merging the local and server level. */
async function playAs(player: Player): Promise<void> {
  storage.setActivePlayer(player.id);
  const local = storage.getPlayerProgress(player.id);
  const level = mergeLevel(local?.level ?? 1, player.level);
  game.stop();
  game.setPlayer(player.id);
  await game.start(level);
}

/** Probes the session and shows the picker, code gate or offline offer. */
async function openPicker(): Promise<void> {
  const outcome = await resolveBoot(listPlayers);
  switch (outcome.kind) {
    case 'session':
      await flushProgress(outcome.players);
      playerScreen.show(outcome.players);
      return;
    case 'no-session':
      code.open();
      return;
    case 'unreachable':
      code.open();
      code.showOffline('Server nicht erreichbar.');
      return;
  }
}

/** Continues with the last known player (or the local pseudo-player) offline. */
async function continueOffline(): Promise<void> {
  const id = storage.getActivePlayer() ?? LOCAL_PLAYER_ID;
  game.stop();
  game.setPlayer(id);
  await game.start();
}

const code = createCodeController({
  screens,
  onAuthenticated: () => openPicker(),
  onOffline: () => {
    void continueOffline();
  },
});

const playerScreen = createPlayerController({
  screens,
  storage,
  onSelect: (player) => {
    void playAs(player);
  },
  onDeleted: () => {
    // Deletion only happens on the picker. Never auto-select a replacement;
    // keep showing the remaining players.
    screens.show('player-picker');
  },
});

const game = createGameController({
  screens,
  storage,
  playerId: LOCAL_PLAYER_ID,
  generate,
  solve: solveFirstMove,
  onSolved: (info) => {
    void reportSolved(info);
  },
  onSwitchPlayer: () => {
    game.stop();
    void openPicker();
  },
});

globalThis.addEventListener('online', () => {
  void flushProgress();
});

void openPicker();
