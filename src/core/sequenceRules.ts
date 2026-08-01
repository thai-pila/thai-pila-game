/** เกมที่มีหัวใจ — ใน sequence ต้องผ่านถึงจะไปเกมถัดไปได้ */
export const SEQUENCE_HEART_GAME_KEYS = new Set([
  "flappy-bird",
  "find-the-match",
  "flying-fruits",
  "game-show-quiz",
  "complete-the-sentence",
]);

export function sequenceGameRequiresPass(gameKey: string): boolean {
  return SEQUENCE_HEART_GAME_KEYS.has(gameKey);
}
