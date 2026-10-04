// Star rating for a completed level. Pure: no DOM, no storage, no randomness.
//
// The rating compares the player's move count against the generator's certified
// solution length, which is the optimal number of pours for the level.

/**
 * Rates a finished level from the player's move count and the optimal move
 * count:
 *
 * - 3 stars: within three moves of optimal (a comfortable solve).
 * - 2 stars: within 1.5x optimal, rounded up (a reasonable solve).
 * - 1 star: anything slower.
 */
export function stars(playerMoves: number, optimal: number): 1 | 2 | 3 {
  if (playerMoves <= optimal + 3) {
    return 3;
  }
  if (playerMoves <= Math.ceil(optimal * 1.5)) {
    return 2;
  }
  return 1;
}
