/**
 * การตั้งค่าเสียงจาก questions JSON:
 * - JSON `false` (หรือไม่มีค่า) = เล่นเสียงหมวดนั้นได้
 * - JSON `true` = ปิดเสียงหมวดนั้น (muted)
 * - `initGameAudioFromQuestions` อ่านจาก questions[0] ตอนเริ่มเกม
 * - `applyGameAudioFromQuestion` อ่านจากข้อที่เกมกำลังเล่น (ไม่ทับที่ผู้เล่นปรับจากเมนู)
 * เมนู hamburger: ติ๊ก = ปิดเสียง (muted), ไม่ติ๊ก = เล่นเสียง
 */

export type GameAudioCategory =
  | "assistant_voice"
  | "background"
  | "choice"
  | "question";

export type GameAudioMuteState = Record<GameAudioCategory, boolean>;

type Listener = (category: GameAudioCategory, muted: boolean) => void;

export type SetGameAudioMutedOptions = {
  /** ผู้เล่นปรับจากเมนู — ไม่ให้ข้อคำถามถัดไปทับค่านี้ */
  byUser?: boolean;
};

export type ApplyGameAudioFromQuestionOptions = {
  /** ค่าเริ่มจาก JSON ของข้อนั้น — ไม่เคารพ override จากเมนู */
  respectUserOverrides?: boolean;
};

const ALL_CATEGORIES: GameAudioCategory[] = [
  "assistant_voice",
  "background",
  "choice",
  "question",
];

/** ปิด/เปิดจากเมนู "พื้นหลัง" — รวม BGM + SFX เอฟเฟกต์ (choice) */
export const BACKGROUND_AUDIO_GROUP: readonly GameAudioCategory[] = [
  "background",
  "choice",
];

const CATEGORY_TO_JSON_KEY: Record<GameAudioCategory, string> = {
  assistant_voice: "audio_assistant_voice",
  background: "audio_background",
  choice: "audio_choice",
  question: "audio_question",
};

const DEFAULT_MUTE: GameAudioMuteState = {
  assistant_voice: false,
  background: false,
  choice: false,
  question: false,
};

let muteState: GameAudioMuteState = { ...DEFAULT_MUTE };
const userOverrides = new Set<GameAudioCategory>();
const listeners = new Set<Listener>();

/** แปลงค่าจาก API — เฉพาะ true / "true" / 1 ถือว่าปิดเสียง */
function coerceJsonMuteFlag(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (typeof value === "string") {
    const s = value.trim().toLowerCase();
    if (s === "true" || s === "1") return true;
  }
  return false;
}

function asQuestionRecord(question: unknown): Record<string, unknown> | undefined {
  return question && typeof question === "object" ? (question as Record<string, unknown>) : undefined;
}

function readMuteFlag(question: Record<string, unknown> | undefined, category: GameAudioCategory): boolean {
  if (!question) return false;
  const key = CATEGORY_TO_JSON_KEY[category];
  return coerceJsonMuteFlag(question[key]);
}

function applyMuteStateFromQuestion(
  question: Record<string, unknown> | undefined,
  options?: ApplyGameAudioFromQuestionOptions
) {
  const respect = options?.respectUserOverrides ?? true;
  for (const cat of ALL_CATEGORIES) {
    if (respect && userOverrides.has(cat)) continue;
    const muted = readMuteFlag(question, cat);
    if (muteState[cat] === muted) continue;
    muteState = { ...muteState, [cat]: muted };
    for (const fn of listeners) fn(cat, muted);
  }
}

/** ตั้งค่าเริ่มจาก questions[0] เมื่อเข้าเกม / โหลด payload */
export function initGameAudioFromQuestions(questions: unknown[] | undefined) {
  userOverrides.clear();
  const first = questions?.[0];
  applyMuteStateFromQuestion(asQuestionRecord(first), { respectUserOverrides: false });
}

/** นำ audio_* จากข้อคำถามที่เกมกำลังแสดง (จาก JSON โดยตรง) */
export function applyGameAudioFromQuestion(
  question: unknown,
  options?: ApplyGameAudioFromQuestionOptions
) {
  applyMuteStateFromQuestion(asQuestionRecord(question), options);
}

export function resetGameAudioSettings() {
  userOverrides.clear();
  muteState = { ...DEFAULT_MUTE };
  notifyAll();
}

/** true = ปิดเสียงหมวดนั้น */
export function isGameAudioMuted(category: GameAudioCategory): boolean {
  return muteState[category];
}

/** true = เปิดเสียง (เล่นได้) */
export function isGameAudioEnabled(category: GameAudioCategory): boolean {
  return !muteState[category];
}

export function setGameAudioMuted(
  category: GameAudioCategory,
  muted: boolean,
  options?: SetGameAudioMutedOptions
) {
  if (options?.byUser) userOverrides.add(category);
  if (muteState[category] === muted) return;
  muteState = { ...muteState, [category]: muted };
  for (const fn of listeners) fn(category, muted);
}

export function toggleGameAudioMuted(category: GameAudioCategory, options?: SetGameAudioMutedOptions) {
  setGameAudioMuted(category, !muteState[category], options);
}

/** ปิด/เปิดกลุ่มพื้นหลัง + เอฟเฟกต์พร้อมกัน */
export function setBackgroundAudioGroupMuted(muted: boolean, options?: SetGameAudioMutedOptions) {
  for (const cat of BACKGROUND_AUDIO_GROUP) {
    setGameAudioMuted(cat, muted, options);
  }
}

export function isBackgroundAudioGroupMuted(): boolean {
  return BACKGROUND_AUDIO_GROUP.every((cat) => muteState[cat]);
}

/** ปิด/เปิดทุกหมวดจากเมนู "เลือกทั้งหมด" */
export function setAllGameAudioMuted(muted: boolean, options?: SetGameAudioMutedOptions) {
  for (const cat of ALL_CATEGORIES) {
    setGameAudioMuted(cat, muted, options);
  }
}

export function areAllGameAudioMuted(): boolean {
  return ALL_CATEGORIES.every((cat) => muteState[cat]);
}

export function getGameAudioMuteState(): Readonly<GameAudioMuteState> {
  return muteState;
}

export function subscribeGameAudioSettings(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notifyAll() {
  for (const cat of ALL_CATEGORIES) {
    for (const fn of listeners) fn(cat, muteState[cat]);
  }
}

export const GAME_AUDIO_MENU_LABELS: Record<GameAudioCategory, string> = {
  assistant_voice: "ปิดเสียงผู้ช่วย",
  background: "ปิดเพลงพื้นหลังและเสียงเอฟเฟกต์",
  choice: "ปิดเสียงตัวเลือก",
  question: "ปิดเสียงคำถาม",
};

export const GAME_AUDIO_SELECT_ALL_LABEL = "เลือกทั้งหมด";

/** ระดับเสียง BGM — ลดจากค่าเดิมลง 60% (เหลือ 40%) */
export const GAME_BGM_VOLUME = 0.24;
export const GAME_BGM_VOLUME_FADE = 0.18;
export const GAME_BGM_VOLUME_END = 0.22;
