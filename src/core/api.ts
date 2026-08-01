// =============================================================
// Central API module – ใช้ร่วมกันทุกเกม
// แยกหน้าที่ยิง API / parse URL / map game_type → scene key ออกมาที่นี่
// เพื่อให้ main.ts เป็นจุดเดียวที่ตัดสินใจว่าจะเล่นเกมเดี่ยวหรือ sequence
// =============================================================

// export const API_BASE_URL = "https://thaipilacreate.gforcesolution.com/api";
export const API_BASE_URL = "https://thaipilacreate.eef.or.th/api";

// ---------- Types ----------
export type GameTypeRaw =
  | "situation"
  | "whack_a_mole"
  | "flip_cards"
  | "find_the_match"
  | "flappy_bird"
  | "air_plan/flying_fruits"
  | "game_show_quiz"
  | "complete_the_sentence"
  | "anagram"
  | string;

export type GameSceneKey =
  | "situation"
  | "whack-a-mole"
  | "flip-cards"
  | "find-the-match"
  | "anagram"
  | "flappy-bird"
  | "flying-fruits"
  | "game-show-quiz"
  | "complete-the-sentence";

/**
 * พารามิเตอร์ใน query ที่บังคับ scene — เช่น `?flip_cards` หรือ `?situation=1`
 * ใช้ใน getSceneOverrideFromQuery (main) และ shouldSkipKnowLearningAgentsFromUrl
 */
export const QUERY_KEY_TO_GAME_SCENE: ReadonlyArray<readonly [string, GameSceneKey]> = [
  ["find_the_match", "find-the-match"],
  ["game_show_quiz", "game-show-quiz"],
  ["flip_cards", "flip-cards"],
  ["flying_fruits", "flying-fruits"],
  ["flappy_bird", "flappy-bird"],
  ["whack_a_mole", "whack-a-mole"],
  ["anagram", "anagram"],
  ["situation", "situation"],
  ["complete_the_sentence", "complete-the-sentence"],
];

export interface GameInfo {
  id: number;
  uuid: string;
  exercise_name: string;
  description?: string | null;
  subject: string;
  question_type: string;
  game_type: GameTypeRaw;
  thumbnail?: string | null;
  question_category_id?: number;
  group_id?: number;
  game_default?: boolean;
  other_image?: string | null;
  suggestion?: string | null;
  /** false = ยังไม่เผยแพร่ */
  status?: boolean;
  /** ไม่ null = ถูกลบ/แบนออกจากระบบ */
  ban_at?: string | null;
  create_at?: string;
  delete_at?: string | null;
  uuid_newgen?: string;
}

export type GameUnplayableReason = "unpublished" | "banned";

export type GameAvailability =
  | { playable: true }
  | { playable: false; reason: GameUnplayableReason };

export const GAME_UNPUBLISHED_MESSAGE = [
  "แบบฝึกหัดนี้ยังไม่ได้ถูกเผยแพร่",
  "กรุณาดำเนินการเปลี่ยนสถานะเป็น เผยแพร่แบบฝึกหัดในหน้าสร้างเกมก่อน",
  "เพื่อให้สามารถใช้งานได้ตามปกติ",
].join("\n");
export const GAME_BANNED_MESSAGE = "เกมนี้ถูกลบออกจากระบบ โปรดติดต่อ admin";

/** ถ้า URL มี query (?…) ให้ข้ามเช็ค status (unpublished) — โหมด dev/preview เล่นเกมที่ยังไม่เผยแพร่ได้ แต่ ban_at ยังกันอยู่ */
function shouldBypassUnpublishedCheck(): boolean {
  if (typeof window === "undefined") return false;
  return window.location.search.length > 0;
}

/** ตรวจว่าเกมเล่นได้หรือไม่จาก `game_info.status` / `ban_at` */
export function getGameAvailability(gameInfo: GameInfo): GameAvailability {
  if (gameInfo.status === false && !shouldBypassUnpublishedCheck()) {
    return { playable: false, reason: "unpublished" };
  }
  if (gameInfo.ban_at != null) {
    return { playable: false, reason: "banned" };
  }
  return { playable: true };
}

export function getGameUnplayableMessage(reason: GameUnplayableReason): string {
  return reason === "unpublished" ? GAME_UNPUBLISHED_MESSAGE : GAME_BANNED_MESSAGE;
}

/** ข้อความแสดงบนจอ boot — unpublished ใช้ตัวหนาบรรทัดแรก + 2 บรรทัดถัดไป */
export function getGameUnplayableMessageHtml(reason: GameUnplayableReason): string {
  if (reason === "banned") return GAME_BANNED_MESSAGE;
  return [
    "<strong>แบบฝึกหัดนี้ยังไม่ได้ถูกเผยแพร่</strong>",
    "กรุณาดำเนินการเปลี่ยนสถานะเป็น เผยแพร่แบบฝึกหัดในหน้าสร้างเกมก่อน",
    "เพื่อให้สามารถใช้งานได้ตามปกติ",
  ].join("<br>");
}

export function isGamePlayable(gameInfo: GameInfo): boolean {
  return getGameAvailability(gameInfo).playable;
}

// payload ของ "เกมเดียว" – เป็นโครงเดียวกันทั้งใน source=game และในแต่ละ entry ของ source=sequence
export interface GamePayloadEntry {
  game_info: GameInfo;
  questions: any[];
  situation_assets?: any[];
}

// payload ที่ source=game ส่งกลับมา (มี source + game_info + questions อยู่ระดับ root)
export interface GameSourcePayload extends GamePayloadEntry {
  source: "game";
}

// payload ที่ source=sequence ส่งกลับมา
export interface SequenceSourcePayload {
  source: "sequence";
  sequence_info: {
    id: number;
    uuid: string;
    exercise_name: string;
    subject: string;
    thumbnail?: string | null;
    create_at?: string;
    update_at?: string;
    delete_at?: string | null;
    uuid_newgen?: string;
  };
  games: GamePayloadEntry[];
}

export type RootPayload = GameSourcePayload | SequenceSourcePayload;

// ---------- URL helpers ----------
const UUID_REGEX = /^[0-9a-f-]{36}$/i;

export interface UrlParams {
  source: "game" | "sequence" | null;
  uuid: string | null;
}

/**
 * อ่าน source / uuid จาก URL
 * รองรับ 2 รูปแบบ:
 *   1) query string: ?source=game&uuid=xxxx
 *   2) path: /<source>/<uuid>   เช่น /game/19e16575-...
 */
export function readUrlParams(): UrlParams {
  if (typeof window === "undefined") return { source: null, uuid: null };

  const search = new URLSearchParams(window.location.search);
  const qSource = search.get("source");
  const qUuid = search.get("uuid");

  let source: UrlParams["source"] = null;
  if (qSource === "game" || qSource === "sequence") source = qSource;

  let uuid: string | null = null;
  if (qUuid && UUID_REGEX.test(qUuid)) uuid = qUuid;

  if (!source || !uuid) {
    const segments = window.location.pathname.replace(/^\/+|\/+$/g, "").split("/");
    if (segments.length >= 2) {
      const [pSource, pUuid] = segments;
      if (!source && (pSource === "game" || pSource === "sequence")) {
        source = pSource;
      }
      if (!uuid && pUuid && UUID_REGEX.test(pUuid)) uuid = pUuid;
    } else if (segments.length === 1 && UUID_REGEX.test(segments[0])) {
      if (!uuid) uuid = segments[0];
      if (!source) source = "game";
    }
  }

  return { source, uuid };
}

// ---------- Fetch ----------
export async function fetchGamePayload(uuid: string): Promise<GameSourcePayload> {
  const url = `${API_BASE_URL}/game/uuid/${uuid}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Fetch game failed: ${response.status}`);
  const data = (await response.json()) as GameSourcePayload;
  if (!data.source) (data as any).source = "game";
  return data;
}

export async function fetchSequencePayload(uuid: string): Promise<SequenceSourcePayload> {
  const url = `${API_BASE_URL}/sequence/uuid/${uuid}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Fetch sequence failed: ${response.status}`);
  const data = (await response.json()) as SequenceSourcePayload;
  if (!data.source) (data as any).source = "sequence";
  return data;
}

export async function fetchRootPayload(
  source: "game" | "sequence",
  uuid: string
): Promise<RootPayload> {
  return source === "sequence" ? fetchSequencePayload(uuid) : fetchGamePayload(uuid);
}

// ---------- game_type → scene key ----------
const GAME_TYPE_TO_KEY: Record<string, GameSceneKey> = {
  situation: "situation",
  whack_a_mole: "whack-a-mole",
  "whack-a-mole": "whack-a-mole",
  flip_cards: "flip-cards",
  "flip-cards": "flip-cards",
  find_the_match: "find-the-match",
  "find-the-match": "find-the-match",
  anagram: "anagram",
  flappy_bird: "flappy-bird",
  "flappy-bird": "flappy-bird",
  "air_plan/flying_fruits": "flying-fruits",
  air_plan_flying_fruits: "flying-fruits",
  "flying-fruits": "flying-fruits",
  flying_fruits: "flying-fruits",
  game_show_quiz: "game-show-quiz",
  "game-show-quiz": "game-show-quiz",
  complete_the_sentence: "complete-the-sentence",
  "complete-the-sentence": "complete-the-sentence",
};

export function mapGameTypeToSceneKey(gameType: string): GameSceneKey | null {
  return GAME_TYPE_TO_KEY[gameType] ?? null;
}

/** เอา GamePayloadEntry มา wrap เป็น GameSourcePayload เพื่อส่งให้ scene ใช้แบบเดียวกัน */
export function toGamePayload(entry: GamePayloadEntry): GameSourcePayload {
  return { source: "game", ...entry };
}
