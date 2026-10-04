// Star rating for a completed level. Pure: no DOM, no storage, no randomness.
//
// The rating compares the player's move count against the generator's certified
// solution length. That length is near-optimal, not proven optimal: the solver
// uses an inadmissible heuristic, so it may return a solution slightly longer
// than the true minimum. The rating is therefore approximate.

/**
 * Rates a finished level from the player's move count and the generator's
 * reference solution length (near-optimal, see the file header):
 *
 * - 3 stars: within three moves of the reference (a comfortable solve).
 * - 2 stars: within 1.5x the reference, rounded up (a reasonable solve).
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
