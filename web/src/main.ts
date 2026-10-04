// App entry point and top-level flow.
//
// Boot: probe the session by listing players. A 401 shows the family-code
// screen; an unreachable server offers offline play; a valid session shows the
// player picker. Selecting a player opens the game at `max(local, server)`
// level, and every solved level is reported to the server (queued when it
// fails and flushed on `online` and app start).

import './styles.css';

import { ApiError, listPlayers, type Player } from './api';
import { enqueueProgress, flushPendingSync, mergeLevel } from './sync';
import { createStorage, type PendingSyncEntry } from './storage';
import { createCodeController } from './ui/codeScreen';
import { createGameController, LOCAL_PLAYER_ID, type SolvedInfo } from './ui/gameScreen';
import { createPlayerController } from './ui/playerScreen';
import { createScreens } from './ui/screens';
import { generate } from './worker/client';

const container = document.querySelector<HTMLDivElement>('#app');

if (container === null) {
  throw new Error('#app element not found');
}

const storage = createStorage();
const screens = createScreens(container, 'code');
// Show the gate immediately so the app is never blank while the session probe
// runs; a valid session swaps to the player picker as soon as it resolves.
screens.show('code');

/** Reports one solve: queue it, then try to flush the whole queue. */
async function reportSolved(info: SolvedInfo): Promise<void> {
  const entry: PendingSyncEntry = {
    playerId: info.playerId,
    level: info.level + 1,
    statsDelta: info.statsDelta,
  };
  enqueueProgress(storage, entry);
  await flushPendingSync(storage);
}

/**
 * Flushes queued updates, using the given players for their server-confirmed
 * levels when available, else fetching a fresh list. Best-effort: an offline
 * server or missing session just leaves the queue in place.
 */
async function flushProgress(knownPlayers?: Player[]): Promise<void> {
  let serverLevels: Map<string, number>;
  if (knownPlayers !== undefined) {
    serverLevels = new Map(knownPlayers.map((player) => [player.id, player.level]));
  } else {
    serverLevels = new Map();
    try {
      const players = await listPlayers();
      serverLevels = new Map(players.map((player) => [player.id, player.level]));
    } catch {
      // No session or no network: flush with no confirmed levels.
    }
  }
  await flushPendingSync(storage, undefined, { serverLevels });
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

/** Fetches the player list and shows the picker; falls back to the code gate. */
async function openPicker(): Promise<void> {
  try {
    const players = await listPlayers();
    await flushProgress(players);
    playerScreen.show(players);
  } catch (thrown: unknown) {
    if (thrown instanceof ApiError && thrown.status === 401) {
      code.open();
      return;
    }
    code.open();
    code.showOffline('Server nicht erreichbar.');
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
    // The active marker is cleared by `removePlayer`; nothing else to do while
    // the picker is already the visible screen.
  },
});

const game = createGameController({
  screens,
  storage,
  playerId: LOCAL_PLAYER_ID,
  generate,
  onSolved: (info) => {
    void reportSolved(info);
  },
  onSwitchPlayer: () => {
    game.stop();
    void openPicker();
  },
});

async function boot(): Promise<void> {
  try {
    const players = await listPlayers();
    await flushProgress(players);
    playerScreen.show(players);
  } catch (thrown: unknown) {
    if (thrown instanceof ApiError && thrown.status === 401) {
      code.open();
      return;
    }
    // Unreachable server: still allow play against the local board.
    code.open();
    code.showOffline('Server nicht erreichbar.');
  }
}

globalThis.addEventListener('online', () => {
  void flushProgress();
});

void boot();
