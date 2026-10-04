import './styles.css';

import { createScreens, type ScreenId } from './ui/screens';

const container = document.querySelector<HTMLDivElement>('#app');

if (container === null) {
  throw new Error('#app element not found');
}

// Tiny screen state. Task 10 adds the family-code gate; until then the game
// screen is the entry point so the shell is visible in `npm run dev`.
const state: { screen: ScreenId } = { screen: 'game' };

const screens = createScreens(container, state.screen);
screens.show(state.screen);
