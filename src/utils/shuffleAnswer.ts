/** แปลงค่า shuffle_answer จาก JSON/API ให้เป็น boolean */
export function coerceShuffleAnswer(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "1";
  }
  return false;
}

/** คืน copy ของ choices — สลับลำดับเมื่อ shuffle_answer = true */
export function maybeShuffleChoices<T>(choices: readonly T[], shuffleAnswer: unknown): T[] {
  const copy = [...choices];
  if (coerceShuffleAnswer(shuffleAnswer)) {
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
  }
  return copy;
}
