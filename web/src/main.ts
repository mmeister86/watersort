import './styles.css';

import { createStorage } from './storage';
import { createGameController, LOCAL_PLAYER_ID } from './ui/gameScreen';
import { createScreens } from './ui/screens';
import { generate } from './worker/client';

const container = document.querySelector<HTMLDivElement>('#app');

if (container === null) {
  throw new Error('#app element not found');
}

// Tiny screen state. Task 10 adds the family-code gate and real players; until
// then the game screen is the entry point and progress lives under a fixed
// pseudo-id.
const storage = createStorage();
const screens = createScreens(container, 'game');
screens.show('game');

const game = createGameController({
  screens,
  storage,
  playerId: LOCAL_PLAYER_ID,
  generate,
});

void game.start();
