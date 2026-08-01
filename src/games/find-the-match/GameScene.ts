import Phaser from "phaser";
import { API_BASE_URL } from "../../core/api";
import type { GameSourcePayload } from "../../core/api";
import { BaseGameScene } from "../../core/scenes/BaseGameScene";
import {
  getGameHudPillSlots,
  getGameHudRowMetrics,
  getHudTimeIconSize,
  HUD_HOURGLASS_TEXTURE_KEY,
  HUD_LABEL_COLOR,
  HUD_VALUE_COLOR,
  HUD_VOLUME_TEXTURE_KEY,
  layoutPhaserHeartsPill,
  layoutPhaserLabelValuePill,
  layoutPhaserTimeValuePill,
  hasHudCenterLabel,
  getHudSuggestionLabel,
  layoutPhaserHudSuggestion,
  applyPhaserHudQuestionText,
  getHudCenterTextFont,
  getHudCenterTextMaxFontPx,
  preloadHudAssets,
  resolveCenteredQuestionBox,
  resolveHudSuggestionBox,
} from "../../core/hud/gameHudLayout";
import {
  createPhaserQuestionProgressHud,
  getQuestionProgressLabel,
  layoutPhaserQuestionProgressHud,
  type PhaserQuestionProgressHud,
} from "../../core/hud/questionProgressHud";
import type { HomeActionPayload, HomeSceneData } from "../../core/scenes/HomeScene";
import { TeacherHintUI } from "../../core/teacher/TeacherHintUI";
import type { TeacherState } from "../../core/teacher/TeacherAssistant";
import { createHudScaleCtx } from "../../utils/desktopUiScale";
import { isMobileLayout } from "../../utils/device";
import { mobileCompactPx } from "../../utils/mobileLayout";
import { ensureNotoSansThaiLoopedReady } from "../../utils/notoThaiFont";
import {
  CHOCIE_CHOICE_TUNING as FTM_WORD_CARD_TUNING,
  chocieThaiGameTextStyle as ftmThaiGameTextStyle,
  computeChocieChoiceBoxBottomOverlayLayout as computeFtmChoiceBoxBottomOverlayLayout,
  computeChocieChoiceTextSoundLayout as computeFtmChoiceTextSoundLayout,
  getChocieInnerBottom as getFtmChocieInnerBottom,
  getChocieInnerCenterY as getFtmChocieInnerCenterY,
  getChocieInnerTop as getFtmChocieInnerTop,
  getChocieInnerWidth as getFtmChocieInnerWidth,
  resolveChocieChoiceImageFrameLayout as resolveFtmChoiceImageFrameLayout,
  resolveChocieChoiceTextLayout as resolveFtmChoiceTextLayout,
} from "../../utils/chocieChoiceLayout";
import {
  computeQuestionMediaLayout,
  drawQuestionMediaCardFrameBox,
  drawQuestionMediaFrameBox,
  drawQuestionMediaOverlayTextPill,
  fitQuestionMediaContainSize,
  fitQuestionMediaOverlayFontPx,
  getQuestionMediaCardLayoutHalfH,
  getQuestionMediaCenterYBelowAnchor,
  getQuestionMediaFrameHalfH,
  getQuestionMediaFrameTargetW,
  resolveQuestionHudTextPillBox,
} from "../../utils/questionHudMedia";
import {
  canPlayGameAudio,
  GAME_BGM_VOLUME_FADE,
  guardedScenePlay,
  guardedScenePlayQuestion,
  guardedScenePlayQuestionThen,
} from "../../core/audio/sceneAudio";

const PARALLAX_OVERLAP_PX = 1;
const SKY_GRADIENT_KEY = "ftm_sky_gradient_tex";

/**
 * Parallax — ความเร็วฐาน (px/s) ต่อชั้น เทียบ flappy-bird
 *
 * สูตร: `baseSpeed × phaseMul × gameplayExtraMul`
 * - `phaseMul` = `PARALLAX_SPEED_MUL_HOME` หรือ `PARALLAX_SPEED_MUL_GAMEPLAY` ตามหน้า
 * - `gameplayExtraMul` = เริ่ม 1 → หลังตัวละครเข้าที่ตั้งเป็น `PARALLAX_GAMEPLAY_EXTRA_AFTER_RIDER_ENTER`
 *   → ปรับระหว่างเล่นได้อีกด้วย `setParallaxGameplaySpeedExtra()`
 *
 * ปรับ "หน้าเล่น" ให้เร็วขึ้น: เพิ่ม `PARALLAX_SPEED_MUL_GAMEPLAY` และ/หรือ
 * `PARALLAX_GAMEPLAY_EXTRA_AFTER_RIDER_ENTER` (ใกล้ 1 หรือมากกว่า 1 = เร็วขึ้น)
 */
const FTM_PARALLAX_TREE_BASE_SPEED = 32;
const FTM_PARALLAX_WALL_BASE_SPEED = 58;
const FTM_PARALLAX_FLOOR_BASE_SPEED = 118;

/** ใช้เฉพาะตอนหน้า home — ไม่กระทบความเร็วหลังกดเริ่มเกม */
const PARALLAX_SPEED_MUL_HOME = 10;
/** ใช้เฉพาะหลังเข้าเกม (คูณกับ gameplayExtraMul) — เพิ่มตัวนี้ถ้าหน้าเล่นช้าไป */
const PARALLAX_SPEED_MUL_GAMEPLAY = 5;

/** เมฆ: ช่วงสุ่มความเร็วฐาน (px/s) */
const FTM_PARALLAX_CLOUD_SPEED_MIN = 10;
const FTM_PARALLAX_CLOUD_SPEED_MAX = 26;

/** ขอบเขต `setParallaxGameplaySpeedExtra` ระหว่างเล่น */
const PARALLAX_GAMEPLAY_EXTRA_MIN = 0.25;
const PARALLAX_GAMEPLAY_EXTRA_MAX = 3;

/** ความสูงตัวละครหน้า home = สัดส่วนต่อความสูงจอ — กว้างคำนวณตามสัดส่วนภาพ */
const RIDER_HOME_HEIGHT_RATIO_MOBILE = 0.28;
const RIDER_HOME_HEIGHT_RATIO_DESKTOP = 0.5;
/** ตำแหน่งหน้า home: x = ความกว้างจอ × ค่านี้, ระยะเหนือ foreground = ความสูงจอ × ค่านี้ */
const RIDER_HOME_X_RATIO = 0.50;
const RIDER_HOME_CLEARANCE_ABOVE_FG_RATIO = 0.05;
/** เลื่อนตัวละครขึ้น (px) ตอนเล่น — ค่ามาก = สูงขึ้น */
const FTM_RIDER_LIFT_PX = { mobile: 54, desktop: 30 } as const;
/** ระยะจากขอบล่างจอถึงก้อน choice — ค่ามาก = ก้อนคำตอบสูงขึ้น (ขั้นต่ำบนมือถือ; จริงใช้ hint reserve) */
const FTM_CHOICE_GRID_BOTTOM_PAD = { mobile: 88, desktop: 44 } as const;
/** เลื่อนเฉพาะแถวคำตอบใต้แถวแรกลงบนมือถือ โดยไม่กระทบแถวบนและ desktop */
const FTM_CHOICE_GRID_Y_OFFSET_MOBILE = 36;
/** ขยับแถวล่างไปทางขวาเพื่อหลบตัวครูบริเวณมุมซ้ายล่าง */
const FTM_CHOICE_GRID_X_OFFSET_MOBILE = 36;
/** บีบความสูง keyword media บนมือถือ — กัน HUD กินพื้นที่ choice */
const FTM_MOBILE_KEYWORD_MEDIA_HEIGHT_SCALE = 0.82;
/** ขยับภาพพื้นหน้า `ftm_bg_foreground` ในแกน Y (ค่าลบ = ขึ้น, ค่าบวก = ลง) */
const FTM_FOREGROUND_Y_OFFSET = { mobile: -25, desktop: 0 } as const;

/** แอนิเมชันขึ้นลงอย่างเดียว: ระยะจากตำแหน่งก้นเดิม + ระยะเวลา */
const RIDER_BOB_OFFSET_PX = 5;
const RIDER_BOB_DURATION_MS = 500;

/** ตัวละครสไลด์จากซ้ายเข้าที่หลังเริ่มเกม — ค่ามาก = เคลื่อนที่ช้า */
const RIDER_ENTER_FROM_LEFT_DURATION_MS = 2000;
/** เฟสแรก: ตัวละครหายไปข้างหน้า (home) ก่อนเข้าจากซ้าย */
const RIDER_EXIT_FORWARD_DURATION_MS = 420;
/**
 * หลังตัวละครเข้าที่แล้ว — ตั้ง `gameplayExtraMul` ครั้งแรก (ซ้อนกับ PARALLAX_SPEED_MUL_GAMEPLAY)
 * 1 = ไม่ช้าลงจากค่า gameplay, < 1 = ช้าลง, > 1 = เร็วกว่าค่า PARALLAX_SPEED_MUL_GAMEPLAY
 */
const PARALLAX_GAMEPLAY_EXTRA_AFTER_RIDER_ENTER = 1;

/** HUD หัวใจ */
const FTM_HUD_MAX_LIVES = 3;
/** จำนวน matching_word สูงสุดที่แสดงพร้อมกัน */
const FTM_MAX_DISPLAY = 8;
/** จำนวนคอลัมน์ของ choice grid — desktop */
const FTM_CHOICE_COLS_DESKTOP = 4;
/** mobile: 3 คอลัมน์เพื่อให้คำตอบอยู่เพียง 2 แถวในชุดคำถามปกติ */
const FTM_CHOICE_COLS_MOBILE = 3;

const FTM_TEACHER_WRONG_LINES = [
  "ไม่เป็นไรลองใหม่",
  "เร็วอีกนิด เดี๋ยวหมากัดนะ",
  "ลองคิดดูอีกที",
] as const;

const FTM_TEACHER_CORRECT_LINES = ["เก่งมากๆเลย", "แว๊นไปเลยจ้า", "ทำได้ดีมาก"] as const;

/** กล่องข้อความครู — กลางจอ (สอดคล้องเกมอื่น + ครูข้างกล่อง) */
const FTM_TEACHER_BUBBLE_X_RATIO = { mobile: 0.5, desktop: 0.5 } as const;

// ── สัตว์ไล่ตาม / smoke เมื่อจบเกม ─────────────────────────
const FTM_ANIMAL_KEYS = [
  "ftm_animal_1",
  "ftm_animal_2",
  "ftm_animal_3",
] as const;
const FTM_ANIMAL_MAX_COUNT = 3;
const FTM_ANIMAL_SPAWN_INTERVAL_MS = 2000;
const FTM_ANIMAL_HEIGHT_RATIO = { mobile: 0.07, desktop: 0.11 } as const;
const FTM_ANIMAL_GAP_PX = { mobile: 28, desktop: 64 } as const;
/** ระยะหลังตัวละคร (ค่ามาก = สัตว์อยู่ซ้ายขึ้น ห่างจากกล่อง choice) */
const FTM_ANIMAL_TRAIL_OFFSET_PX = { mobile: 140, desktop: 550 } as const;
/** ยกสัตว์ขึ้นจากเท้าตัวละคร (สัดส่วนต่อความสูงสัตว์) — ค่ามาก = สูงขึ้น ห่างจากกล่องล่าง */
const FTM_ANIMAL_LIFT_FROM_FEET_RATIO = { mobile: 1.05, desktop: 0.72 } as const;
/** สลับ Y แบบ zigzag เพื่อไม่ให้สัตว์เรียงเป็นแถวเดียว (พิกเซลที่บวก/ลบจาก baseY) */
const FTM_ANIMAL_ZIGZAG_Y_PX = { mobile: 10, desktop: 25} as const;
/** มือถือ: เรียง 3 ตัวในแถวเดียวหลังตัวละคร */
const FTM_ANIMAL_MOBILE_COLS = 3;
/** มือถือ: ระยะระหว่างแถว Y (สัดส่วนต่อความสูงตัวสัตว์) — ค่าน้อย = แต่ละแถวซ้อนกันมาก */
const FTM_ANIMAL_MOBILE_ROW_Y_RATIO = 0.55;
const FTM_ANIMAL_RUN_IN_DURATION_MS = 1600;
/** ตอบถูก: parallax เร็วขึ้น (คูณกับค่า gameplay) — สัตว์ตามไม่ทัน */
const FTM_PARALLAX_BURST_MUL = 2.4;
const FTM_PARALLAX_BURST_DURATION_MS = 3400;
/** ดีเลย์ก่อนที่สัตว์จะวิ่งกลับมาใหม่หลังถูกเขี่ยออก */
const FTM_ANIMAL_RESPAWN_DELAY_MS = 1600;
/** ตอบครบทุกข้อ: parallax เร็วแบบหน้า home */
const FTM_PARALLAX_VICTORY_MUL = 2.6;
const FTM_VICTORY_OUTRO_MS = 1400;
/** game over: เวลาที่สัตว์วิ่งเข้าหาตัวละคร + smoke ก่อนเปิด Result */
const FTM_GAMEOVER_OUTRO_MS = 1500;
// smoke sheet (animal/smoke_animation.png) — 751x501, 3 cols × 3 rows = 9 frames
const FTM_SMOKE_FRAME_W = 250;
const FTM_SMOKE_FRAME_H = 167;
const FTM_SMOKE_FRAME_COUNT = 9;

const FTM_CHOICE_CURSOR_GRAB = "grab";
const FTM_CHOICE_CURSOR_GRABBING = "grabbing";

/**
 * กล่องบรรทุก (drop zone) + glow ชมพูบนสไปรต์ — ดู `buildFtmDropBox` / `drawFtmDropGlow`
 *
 * ตำแหน่งกล่อง:
 *  - `centerXFromLeft` / `centerYFromBottom` — จุดศูนย์กลางอิงจากสไปรต์ rider (0–1)
 *  - `glowOffsetX` / `glowOffsetY` — ขยับ glow เพิ่ม (px) จาก hit box
 *
 * ขนาดกล่อง:
 *  - `widthMul` / `heightMul` — สัดส่วนเทียบสไปรต์
 *  - `wMin`…`wMax` / `hMin`…`hMax` — clamp ความกว้าง/สูง
 *  - `glowWidthAdd` / `glowHeightAdd` — ขยาย glow ให้ใหญ่กว่า hit box (px)
 *
 * ขนาด/รูป glow:
 *  - `cornerRadius` — มุมโค้งหลัก
 *  - `expandOuter` / `expandMid` / `expandInner` — ระยะขยายชั้น glow ออกจากขอบ (px)
 *  - `strokeOuter`…`strokeCore` — ความหนาเส้นแต่ละชั้น
 */
const FTM_DROP_GLOW_ENABLED = false;

const FTM_DROP_TUNING = {
  mobile: {
    centerXFromLeft: 0.12,
    centerYFromBottom: 0.4,
    widthMul: 0.52,
    heightMul: 0.44,
    wMin: 110,
    wMax: 118,
    hMin: 40,
    hMax: 50,
    cornerRadius: 12,
    glowOffsetX: 0,
    glowOffsetY: 4,
    glowWidthAdd: 0,
    glowHeightAdd: 0,
    expandOuter: 6,
    expandMid: 4,
    expandInner: 2,
    radiusOuterAdd: 5,
    radiusMidAdd: 3,
    radiusInnerAdd: 1,
    strokeOuter: 18,
    strokeMid: 12,
    strokeInner: 8,
    strokeCore: 2.5,
    strokeCoreOver: 3,
    travelStrokeHot: 6,
    travelStrokeMid: 4,
    glowOuter: 0xffe4f0,
    glowMid: 0xffc8e0,
    glowCore: 0xff4d9d,
    glowHot: 0xffd8ec,
  },
  desktop: {
    centerXFromLeft: 0.2,
    centerYFromBottom: 0.35,
    widthMul: 0.58,
    heightMul: 0.22,
    wMin: 145,
    wMax: 230,
    hMin: 90,
    hMax: 108,
    cornerRadius: 14,
    glowOffsetX: -3,
    glowOffsetY: 5,
    glowWidthAdd: 0,
    glowHeightAdd: 0,
    expandOuter: 6,
    expandMid: 4,
    expandInner: 2,
    radiusOuterAdd: 5,
    radiusMidAdd: 3,
    radiusInnerAdd: 1,
    strokeOuter: 22,
    strokeMid: 14,
    strokeInner: 10,
    strokeCore: 3,
    strokeCoreOver: 4,
    travelStrokeHot: 7,
    travelStrokeMid: 5,
    glowOuter: 0xffe4f0,
    glowMid: 0xffc8e0,
    glowCore: 0xff4d9d,
    glowHot: 0xffd8ec,
  },
} as const;

/** จุดบนเส้นรอบ rounded-rect สำหรับ glow วิ่งตามขอบ (t = 0..1 ตามเข็มนาฬิกา) */
function ftmPointOnRoundedRectPerimeter(
  left: number,
  top: number,
  w: number,
  h: number,
  r: number,
  t: number
): { px: number; py: number } {
  const rr = Math.min(Math.max(0, r), w / 2, h / 2);
  const topW = Math.max(0, w - 2 * rr);
  const sideH = Math.max(0, h - 2 * rr);
  const arcLen = (Math.PI / 2) * rr;
  const total = 2 * topW + 2 * sideH + 4 * arcLen;
  let d = Phaser.Math.Wrap(t, 0, 1) * total;

  const botY = top + h;
  const rightX = left + w;

  if (d <= topW) return { px: left + rr + d, py: top };
  d -= topW;
  if (d <= arcLen) {
    const a = -Math.PI / 2 + (d / arcLen) * (Math.PI / 2);
    return { px: rightX - rr + Math.cos(a) * rr, py: top + rr + Math.sin(a) * rr };
  }
  d -= arcLen;
  if (d <= sideH) return { px: rightX, py: top + rr + d };
  d -= sideH;
  if (d <= arcLen) {
    const a = (d / arcLen) * (Math.PI / 2);
    return { px: rightX - rr + Math.cos(a) * rr, py: botY - rr + Math.sin(a) * rr };
  }
  d -= arcLen;
  if (d <= topW) return { px: rightX - rr - d, py: botY };
  d -= topW;
  if (d <= arcLen) {
    const a = Math.PI / 2 + (d / arcLen) * (Math.PI / 2);
    return { px: left + rr + Math.cos(a) * rr, py: botY - rr + Math.sin(a) * rr };
  }
  d -= arcLen;
  if (d <= sideH) return { px: left, py: botY - rr - d };
  d -= sideH;
  const a = Math.PI + (d / arcLen) * (Math.PI / 2);
  return { px: left + rr + Math.cos(a) * rr, py: top + rr + Math.sin(a) * rr };
}

/** โครง question จาก API */
type FtmQuestion = {
  id: number;
  no: number;
  keyword: string;
  matching_word: string;
  hint?: string | null;
  sound_keyword?: string | null;
  image_keyword?: string | null;
  sound_hint?: string | null;
  image_hint?: string | null;
  sound_matching_word?: string | null;
  image_matching_word?: string | null;
};

/** entry ของ matching_word ที่จะแสดงเป็น card */
type FtmWordEntry = {
  word: string;
  qIndex: number;
  soundUrl?: string;
  imageUrl?: string;
};

type ParallaxTileTrack = {
  tileA: Phaser.GameObjects.Container;
  tileB: Phaser.GameObjects.Container;
  cellW: number;
  baseSpeedPxPerSec: number;
};

type CloudParallax = {
  img: Phaser.GameObjects.Image;
  baseSpeedPxPerSec: number;
};

/** ชั้นเมฆ + พื้น/กำแพงเลื่อน — อ้างอิงแนวเดียวกับ flappy-bird */
export default class FindTheMatchGameScene extends BaseGameScene {
  private mobile = false;
  private parallaxTracks: ParallaxTileTrack[] = [];
  private parallaxClouds: CloudParallax[] = [];
  private parallaxActive = false;
  /** `home` = ใช้ PARALLAX_SPEED_MUL_HOME | `gameplay` = ใช้ PARALLAX_SPEED_MUL_GAMEPLAY */
  private parallaxPhase: "home" | "gameplay" = "home";
  /** ปรับจากลูปเกม (ความเร็วรวมเพิ่ม/ลดระหว่างเล่น) — ดู `setParallaxGameplaySpeedExtra` */
  private parallaxGameplayExtraMul = 1;
  private skyGradientImage?: Phaser.GameObjects.Image;
  private foregroundStatic?: Phaser.GameObjects.Image;
  private homeCharacter?: Phaser.GameObjects.Image;
  private riderFloatTweens: Phaser.Tweens.Tween[] = [];
  private savedHomeData?: HomeSceneData;
  private tutorialPopup?: {
    overlay: Phaser.GameObjects.Rectangle;
    howToImage: Phaser.GameObjects.Image;
    startButton: Phaser.GameObjects.Image;
    restoreSceneInputEnabled: boolean;
    restoreHomeInputEnabled: boolean;
  };

  private ftmPayload?: GameSourcePayload;
  private hudExerciseTitle = "";
  private hudRoot?: Phaser.GameObjects.Container;
  private hudTitlePill?: Phaser.GameObjects.Graphics;
  private hudTitleText?: Phaser.GameObjects.Text;
  private hudTitleDom?: Phaser.GameObjects.DOMElement;
  private hudKeywordPill?: Phaser.GameObjects.Graphics;
  private hudKeywordText?: Phaser.GameObjects.Text;
  private hudKeywordDom?: Phaser.GameObjects.DOMElement;
  private hudTimeBg?: Phaser.GameObjects.Image;
  private hudTimeIcon?: Phaser.GameObjects.Image;
  private hudTimeText?: Phaser.GameObjects.Text;
  private hudScoreBg?: Phaser.GameObjects.Image;
  private hudScoreLabel?: Phaser.GameObjects.Text;
  private hudLivesBg?: Phaser.GameObjects.Image;
  private hudTimerEvent?: Phaser.Time.TimerEvent;
  private hudHearts: Phaser.GameObjects.Image[] = [];
  private hudQuestionProgress?: PhaserQuestionProgressHud;
  private hudScoreText?: Phaser.GameObjects.Text;
  private ftmHudLives = FTM_HUD_MAX_LIVES;
  /** หมดชีวิตกลางเกม — หน้า Result แสดง "ไม่ผ่าน" และไม่ส่งคะแนนขึ้น server */
  private ftmGameFailedByNoLives = false;
  private ftmCharEmoteTimer?: Phaser.Time.TimerEvent;
  private ftmCharEmoteLock = false;

  // ── gameplay drag-and-drop ──────────────────────────────
  private ftmQuestions: FtmQuestion[] = [];
  private ftmQueueIndices: number[] = [];
  private ftmCurrentQIndex = -1;
  private ftmGameplayActive = false;
  private ftmAnswerLocked = false;
  private ftmWordPool: FtmWordEntry[] = [];
  private ftmDisplayed: FtmWordEntry[] = [];
  private ftmCardByEntry = new Map<FtmWordEntry, Phaser.GameObjects.Container>();
  private ftmChoiceRoot?: Phaser.GameObjects.Container;
  private ftmKeywordRoot?: Phaser.GameObjects.Container;
  private ftmDropBounds = new Phaser.Geom.Rectangle(0, 0, 1, 1);
  private ftmAudioByUrl = new Map<string, string>();
  private ftmTexByUrl = new Map<string, string>();
  private ftmDragEventsAttached = false;
  private ftmDragOverZone = false;
  private ftmDropGlow?: Phaser.GameObjects.Graphics;
  private ftmDropGlowTimer?: Phaser.Time.TimerEvent;
  private ftmDropGlowPhase = 0;
  private ftmDropGlowRadius = 12;
  private ftmDropGlowRect = new Phaser.Geom.Rectangle(0, 0, 1, 1);
  // HUD keyword display refs (like flappy setHudQuestion)
  private hudKwPillMinW = 0;
  private hudKwPillMaxW = 0;
  private hudKwPillY = 0;
  private hudKwPillH = 0;
  private hudKwMediaCenterX = 0;
  private hudKwMediaCenterY = 0;
  private hudKwAreaBottomY = 0;
  private hudKwImageBg?: Phaser.GameObjects.Graphics;
  private hudKwImage?: Phaser.GameObjects.Image;
  private hudKwSpeaker?: Phaser.GameObjects.Image;

  private teacherHintUI?: TeacherHintUI;

  // BGM (home/gameplay/end) — เปลี่ยน track ตาม phase ของเกม
  private ftmBgmCurrent?: Phaser.Sound.BaseSound;
  private ftmBgmCurrentKey?: string;

  // สัตว์ไล่ตาม + smoke ตอนจบเกม
  private ftmAnimals: Phaser.GameObjects.Image[] = [];
  private ftmAnimalSpawnQueue: string[] = [];
  private ftmAnimalSpawnEvent?: Phaser.Time.TimerEvent;
  private ftmAnimalRespawnEvent?: Phaser.Time.TimerEvent;
  private ftmParallaxBurstEvent?: Phaser.Time.TimerEvent;
  private ftmSmokeSprite?: Phaser.GameObjects.Sprite;

  constructor() {
    super("find-the-match");
  }

  preload() {
    TeacherHintUI.preload(this);
    if (!this.cache.audio.exists("sfx_click_default")) {
      this.load.audio("sfx_click_default", "assets/sound/ui/click.mp3");
    }
    if (!this.cache.audio.exists("sfx_notification_message")) {
      this.load.audio("sfx_notification_message", "assets/sound/sfx_notification_message_flip_cards.mp3");
    }
    if (!this.cache.audio.exists("ftm_bgm_home")) {
      this.load.audio("ftm_bgm_home", "assets/sound/find-the-match/home.mp3");
    }
    if (!this.cache.audio.exists("ftm_bgm_gameplay")) {
      this.load.audio("ftm_bgm_gameplay", "assets/sound/find-the-match/gameplay.mp3");
    }
    if (!this.cache.audio.exists("ftm_bgm_end")) {
      this.load.audio("ftm_bgm_end", "assets/sound/find-the-match/end.mp3");
    }
    if (!this.cache.audio.exists("ftm_sfx_cat")) {
      this.load.audio("ftm_sfx_cat", "assets/sound/find-the-match/cat.mp3");
    }
    if (!this.cache.audio.exists("ftm_sfx_dog")) {
      this.load.audio("ftm_sfx_dog", "assets/sound/find-the-match/dog.mp3");
    }
    if (!this.cache.audio.exists("sfx_pop")) {
      this.load.audio("sfx_pop", "assets/sound/sfx_pop.mp3");
    }
    if (!this.cache.audio.exists("sfx_correct_flip_cards")) {
      this.load.audio("sfx_correct_flip_cards", "assets/sound/sfx_correct_flip_cards.mp3");
    }
    if (!this.cache.audio.exists("sfx_incorrect_flip_cards")) {
      this.load.audio("sfx_incorrect_flip_cards", "assets/sound/sfx_incorrect_flip_cards.mp3");
    }

    const img = (key: string, path: string) => {
      if (!this.textures.exists(key)) this.load.image(key, path);
    };

    img("ftm_logo", "assets/find-the-match/logo.png");
    img("ftm_btn_start", "assets/find-the-match/btn_start.png");
    img("ftm_btn_howto", "assets/find-the-match/btn_howto.png");
    img("ftm_char_idle_home", "assets/find-the-match/character/idle_home.png");
    img("ftm_char_idle_play", "assets/find-the-match/character/idle.png");
    img("ftm_bg_foreground", "assets/find-the-match/Background/foreground.png");
    img("ftm_bg_floor", "assets/find-the-match/Background/floor.png");
    img("ftm_bg_wall1", "assets/find-the-match/Background/wall1.png");
    img("ftm_bg_wall2", "assets/find-the-match/Background/wall2.png");
    img("ftm_tree_a", "assets/find-the-match/Background/treeA.png");
    img("ftm_tree_b", "assets/find-the-match/Background/treeB.png");
    img("ftm_bg_cloud", "assets/flappy-bird/Background/cloud.png");
    img("ftm_howto_mobile", "assets/find-the-match/howto_mobile.png");
    img("ftm_howto_desktop", "assets/find-the-match/howto_desktop.png");
    preloadHudAssets(this);
    img("ftm_heart_icon", "assets/flappy-bird/heart.png");
    img("ftm_bgchocie", "assets/find-the-match/bgchocie.png");
    img("ftm_choice_bg", "assets/find-the-match/chocie.png");
    img("ftm_correct_icon", "assets/find-the-match/correct_icon.png");
    img("ftm_wrong_icon", "assets/find-the-match/wrong_icon.png");
    img("ftm_char_answer", "assets/find-the-match/character/answer.png");
    img("ftm_char_wrong", "assets/find-the-match/character/wrong.png");
    img("ftm_char_correct", "assets/find-the-match/character/correct.png");
    img("ftm_star_fx", "assets/flip-cards/star.png");
    img("ftm_animal_1", "assets/find-the-match/animal/animal1.png");
    img("ftm_animal_2", "assets/find-the-match/animal/animal2.png");
    img("ftm_animal_3", "assets/find-the-match/animal/animal3.png");
    img("ftm_animal_4", "assets/find-the-match/animal/animal4.png");
    img("ftm_animal_5", "assets/find-the-match/animal/animal5.png");
    if (!this.textures.exists("ftm_smoke_sheet")) {
      this.load.spritesheet("ftm_smoke_sheet", "assets/find-the-match/smoke_animation.png", {
        frameWidth: FTM_SMOKE_FRAME_W,
        frameHeight: FTM_SMOKE_FRAME_H,
      });
    }
  }

  async create() {
    super.create();
    this.mobile = isMobileLayout();
    this.cameras.main.roundPixels = false;

    this.buildSkyGradient();
    this.buildParallaxWorld();
    this.buildForegroundStatic();
    this.parallaxActive = true;
    this.parallaxPhase = "home";
    this.parallaxGameplayExtraMul = 1;

    this.playFtmBgm("ftm_bgm_home");

    await this.loadFindTheMatchPayload();

    this.savedHomeData = {
      gameKey: this.scene.key,
      ui: {
        startButtonPath: "assets/find-the-match/btn_start.png",
        startButtonKey: "ftm_btn_start",
        howToButtonPath: "assets/find-the-match/btn_howto.png",
        howToButtonKey: "ftm_btn_howto",
        homeLogoPath: "assets/find-the-match/logo.png",
        homeLogoKey: "ftm_logo",
        homeLogoWidth: this.mobile ? 320 : 400,
        homeLogoYRatio: this.mobile ? 0.2 : 0.18,
        startButtonWidth: this.mobile ? 220 : 280,
        howToButtonWidth: this.mobile ? 180 : 210,
        startButtonYRatio: this.mobile ? 0.7 : 0.76,
        howToButtonYRatio: this.mobile ? 0.7 : 0.69,
        minButtonGapPx: this.mobile ? 20 : 18,
        howtoHidesHomeButtons: false,
      },
    };

    this.scene.launch("HomeScene", this.savedHomeData);
    this.scene.bringToTop("HomeScene");

    const homeScene = this.scene.get("HomeScene");
    const onHomeAction = (payload: HomeActionPayload) => {
      if (payload.gameKey !== this.scene.key) return;
      if (payload.action === "howto") {
        this.events.emit("howto");
        this.openHowToPopup();
      }
    };
    homeScene.events.on("home-action", onHomeAction);

    this.input.enabled = false;
    homeScene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      homeScene.events.off("home-action", onHomeAction);
      void this.beginGameplayAfterHome();
    });

    this.spawnHomeCharacter();

    const onResize = () => {
      this.buildSkyGradient();
      this.buildParallaxWorld();
      this.buildForegroundStatic();
      this.relayoutHomeCharacter();
      if (this.hudRoot) {
        this.destroyFindTheMatchHud();
        this.createFindTheMatchTopHud(this.hudExerciseTitle);
        // คืน keyword ใน HUD ถ้ากำลังเล่นอยู่
        if (this.ftmGameplayActive && this.ftmCurrentQIndex >= 0) {
          const q = this.ftmQuestions[this.ftmCurrentQIndex];
          if (q) this.setFtmHudKeyword(q);
        }
      }
      if (this.ftmGameplayActive) {
        this.buildFtmDropBox();
        this.buildFtmChoiceGrid();
      }
      this.relayoutFtmAnimalsAndSmoke();
    };
    this.scale.on(Phaser.Scale.Events.RESIZE, onResize);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, onResize);
      this.stopRiderFloat();
      this.destroyParallaxWorld();
      this.destroySkyGradient();
      this.foregroundStatic?.destroy();
      this.foregroundStatic = undefined;
      this.homeCharacter?.destroy();
      this.homeCharacter = undefined;
      this.destroyHowToPopup();
      this.destroyFtmGameplay();
      this.destroyFindTheMatchHud();
      this.destroyFtmTeacherAndMessage();
      this.destroyFtmAnimalsAndSmoke();
      this.stopFtmBgm(0);
    });
  }

  protected override getLiveDashboardLaunchFields() {
    return {
      ...super.getLiveDashboardLaunchFields(),
      liveDashboardFlappyPassed: !this.ftmGameFailedByNoLives,
    };
  }

  protected override onBeforeEndGame() {
    this.destroyFtmGameplay({ resetCharacter: false });
    this.destroyFindTheMatchHud();
    this.destroyFtmTeacherAndMessage();
    this.parallaxActive = true;
    if (this.ftmGameFailedByNoLives) {
      this.setFtmCharTexture("ftm_char_wrong");
    }
    const ch = this.homeCharacter;
    if (ch?.active) {
      this.startRiderFloat(ch);
    }
  }

  protected override getResultCorrectCount(): number {
    return this.score;
  }

  protected override getResultScoreLabel(): string | undefined {
    return this.ftmGameFailedByNoLives ? "ไม่ผ่าน" : undefined;
  }

  protected override getResultSceneLaunchOverrides() {
    return this.ftmGameFailedByNoLives ? { scoreLabelColor: "#ef4444" } : {};
  }

  private async loadFindTheMatchPayload(): Promise<void> {
    try {
      if (this.injectedPayload?.source === "game") {
        this.ftmPayload = this.injectedPayload as GameSourcePayload;
      } else {
        throw new Error("Missing injected payload for find-the-match");
      }
      this.totalQuestions = this.ftmPayload.questions?.length ?? 0;
    } catch (err) {
      console.error("[find-the-match] Failed to load payload:", err);
      this.ftmPayload = undefined;
      this.totalQuestions = undefined;
    }
  }

  private formatElapsedTime(): string {
    const elapsedSec = Math.max(0, Math.floor((Date.now() - this.startTime) / 1000));
    const min = Math.floor(elapsedSec / 60);
    const sec = elapsedSec % 60;
    return `${min}:${sec.toString().padStart(2, "0")}`;
  }

  private destroyFindTheMatchHud() {
    this.hudTimerEvent?.destroy();
    this.hudTimerEvent = undefined;
    // keyword media (added outside hudRoot – destroy separately)
    this.hudKwImageBg?.destroy();
    this.hudKwImageBg = undefined;
    this.hudKwImage?.destroy();
    this.hudKwImage = undefined;
    this.hudKwSpeaker?.destroy();
    this.hudKwSpeaker = undefined;
    this.hudRoot?.destroy(true);
    this.hudRoot = undefined;
    this.hudTitlePill = undefined;
    this.hudTitleText = undefined;
    this.hudTitleDom = undefined;
    this.hudKeywordPill = undefined;
    this.hudKeywordText = undefined;
    this.hudKeywordDom = undefined;
    this.hudTimeBg = undefined;
    this.hudTimeIcon = undefined;
    this.hudTimeText = undefined;
    this.hudScoreBg = undefined;
    this.hudScoreLabel = undefined;
    this.hudScoreText = undefined;
    this.hudLivesBg = undefined;
    this.hudQuestionProgress = undefined;
    this.hudHearts = [];
  }

  private getFtmHudLayout() {
    const safe = this.getFtmSafeArea();
    const ui = createHudScaleCtx(safe.width, safe.height, this.mobile);
    const metrics = getGameHudRowMetrics({
      mobile: this.mobile,
      width: safe.width,
      height: safe.height,
      px: ui.px.bind(ui),
      maxLives: FTM_HUD_MAX_LIVES,
      hasProgress: true,
      hasLives: true,
    });
    const slots = getGameHudPillSlots(safe.x, safe.y, safe.width, metrics, {
      hasProgress: true,
      hasLives: true,
      mobile: this.mobile,
    });
    return { safe, ui, metrics, slots };
  }

  private layoutFtmHudStats() {
    const { safe, ui, metrics, slots } = this.getFtmHudLayout();
    const rowY = safe.y + slots.rowY;
    const labelPad = ui.px(this.mobile ? 12 : 18);
    const valuePad = ui.px(this.mobile ? 12 : 18);
    const heartSize = ui.px(this.mobile ? 22 : 28);
    const heartGap = ui.px(this.mobile ? 2 : 4);
    const livesPadLeft = ui.px(this.mobile ? 12 : 16);
    const progressLabel = this.getFtmQuestionProgressLabel();

    if (this.hudTimeBg && this.hudTimeIcon && this.hudTimeText) {
      layoutPhaserTimeValuePill({
        scene: this,
        bg: this.hudTimeBg,
        icon: this.hudTimeIcon,
        value: this.hudTimeText,
        cx: slots.timeCx,
        cy: rowY,
        pillW: metrics.timeW,
        pillH: metrics.pillH,
        valueText: this.formatElapsedTime(),
        labelPadLeft: labelPad,
        valuePadRight: valuePad,
        iconSize: getHudTimeIconSize(this.mobile, ui.px.bind(ui)),
        fontDigits: metrics.fontDigits,
      });
    }

    if (this.hudScoreBg && this.hudScoreLabel && this.hudScoreText) {
      layoutPhaserLabelValuePill({
        scene: this,
        bg: this.hudScoreBg,
        label: this.hudScoreLabel,
        value: this.hudScoreText,
        cx: slots.scoreCx,
        cy: rowY,
        pillW: metrics.scoreW,
        pillH: metrics.pillH,
        labelText: "คะแนน",
        valueText: `${this.score}`,
        labelPadLeft: labelPad,
        valuePadRight: valuePad,
        fontLabel: metrics.fontLabel,
        fontDigits: metrics.fontDigits,
      });
    }

    if (this.hudLivesBg && this.hudHearts.length && slots.livesCx != null) {
      layoutPhaserHeartsPill({
        bg: this.hudLivesBg,
        hearts: this.hudHearts,
        cx: slots.livesCx,
        cy: rowY,
        pillW: metrics.livesW,
        pillH: metrics.pillH,
        heartSize,
        heartGap,
        padLeft: livesPadLeft,
      });
    }

    if (this.hudQuestionProgress) {
      layoutPhaserQuestionProgressHud({
        scene: this,
        hud: this.hudQuestionProgress,
        cx: slots.progressCx ?? 0,
        rowY,
        boxH: metrics.pillH,
        boxW: metrics.progressW,
        label: progressLabel,
        font: metrics.fontProgress,
      });
    }

    this.layoutFtmSuggestionHud();
  }

  private layoutFtmSuggestionHud() {
    if (!this.hudTitlePill || !this.hudTitleText) return;

    const mobile = this.mobile;
    const { safe, ui, metrics, slots } = this.getFtmHudLayout();
    const title = this.hudExerciseTitle;
    const titleY = safe.y + slots.questionY;
    const titleH = metrics.questionH;
    const titleMinW = slots.questionMaxW * 0.65;
    const hudTextRes = Math.min(3, typeof window !== "undefined" ? window.devicePixelRatio || 2 : 2);
    const suggestionBox = resolveHudSuggestionBox({
      mobile,
      text: title,
      centerX: slots.questionCenterX,
      safeX: safe.x,
      safeWidth: safe.width,
      sidePad: metrics.leftPad,
      minW: titleMinW,
      maxW: slots.questionMaxW,
      minLeft: slots.timeRight + metrics.questionGap,
      maxRight: slots.statsLeftEdge - metrics.questionGap,
    });
    const fontHudTitle = getHudCenterTextFont(ui.px.bind(ui), mobile);
    const suggestionLayout = layoutPhaserHudSuggestion({
      scene: this,
      pill: this.hudTitlePill,
      text: this.hudTitleText,
      dom: this.hudTitleDom,
      parent: this.hudRoot,
      label: title,
      box: suggestionBox,
      top: titleY,
      height: titleH,
      wrapPadX: ui.px(mobile ? 56 : 96),
      textPadX: ui.px(mobile ? 12 : 16),
      textPadY: ui.px(mobile ? 10 : 8),
      font: fontHudTitle,
      lineSpacing: mobile ? 3 : 2,
      resolution: hudTextRes,
      mobile,
    });
    this.hudTitleDom = suggestionLayout.dom ?? this.hudTitleDom;

    this.hudKwPillY = titleY;
    this.hudKwPillH = suggestionLayout.height;
    this.hudKwPillMinW = mobile ? safe.width * 0.74 : titleMinW;
    this.hudKwPillMaxW = suggestionBox.width;
    this.hudKwMediaCenterX = suggestionBox.centerX;
    this.hudKwAreaBottomY = titleY + suggestionLayout.height;
  }

  /** HUD บน — โครงคล้าย flappy-bird; ซ้ายแสดง keyword pill แทนข้อความคำถาม */
  private createFindTheMatchTopHud(exerciseName: string) {
    this.destroyFindTheMatchHud();
    const title = getHudSuggestionLabel(exerciseName);
    this.hudExerciseTitle = title;

    const mobile = this.mobile;
    const { safe, ui, metrics, slots } = this.getFtmHudLayout();
    const w = safe.width;
    const h = safe.height;
    const hudDepth = 2000;
    const hudTextRes = Math.min(3, typeof window !== "undefined" ? window.devicePixelRatio || 2 : 2);

    const hudRoot = this.add.container(0, 0).setScrollFactor(0).setDepth(hudDepth);
    this.hudRoot = hudRoot;

    const titlePill = this.add.graphics().setScrollFactor(0);
    hudRoot.add(titlePill);
    this.hudTitlePill = titlePill;

    this.hudTitleText = this.add
      .text(0, 0, "", {
        font: getHudCenterTextFont(ui.px.bind(ui), mobile),
        color: "#333333",
        align: "center",
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setResolution(hudTextRes);
    hudRoot.add(this.hudTitleText);

    const showSuggestion = hasHudCenterLabel(title);
    const titleY = safe.y + slots.questionY;
    const titleH = metrics.questionH;
    const mediaLayoutH = mobile ? h * FTM_MOBILE_KEYWORD_MEDIA_HEIGHT_SCALE : h;
    const kwFrameHalfH = getQuestionMediaFrameHalfH(mobile, ui.px.bind(ui), w, true, mediaLayoutH);
    this.hudKwMediaCenterY = getQuestionMediaCenterYBelowAnchor(
      showSuggestion ? titleY + titleH : titleY,
      kwFrameHalfH,
      mobile,
      ui.px.bind(ui)
    );

    this.layoutFtmSuggestionHud();

    const fontHudTitle = getHudCenterTextFont(ui.px.bind(ui), mobile);
    this.hudKeywordPill = this.add.graphics().setScrollFactor(0).setVisible(false);
    this.hudKeywordText = this.add
      .text(0, 0, "", {
        font: fontHudTitle,
        color: "#333333",
        align: "center",
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setResolution(hudTextRes)
      .setVisible(false);
    hudRoot.add(this.hudKeywordPill);
    hudRoot.add(this.hudKeywordText);

    this.hudTimeBg = this.add.image(0, 0, "bg_hud").setScrollFactor(0);
    this.hudTimeIcon = this.add
      .image(0, 0, HUD_HOURGLASS_TEXTURE_KEY)
      .setOrigin(0.5)
      .setScrollFactor(0);
    this.hudTimeText = this.add
      .text(0, 0, this.formatElapsedTime(), {
        font: metrics.fontDigits,
        color: HUD_VALUE_COLOR,
      })
      .setOrigin(1, 0.5)
      .setScrollFactor(0)
      .setResolution(hudTextRes);
    hudRoot.add([this.hudTimeBg, this.hudTimeIcon, this.hudTimeText]);

    this.hudScoreBg = this.add.image(0, 0, "bg_hud").setScrollFactor(0);
    this.hudScoreLabel = this.add
      .text(0, 0, "คะแนน", { font: metrics.fontLabel, color: HUD_LABEL_COLOR })
      .setOrigin(0, 0.5)
      .setScrollFactor(0)
      .setResolution(hudTextRes);
    this.hudScoreText = this.add
      .text(0, 0, `${this.score}`, {
        font: metrics.fontDigits,
        color: HUD_VALUE_COLOR,
      })
      .setOrigin(1, 0.5)
      .setScrollFactor(0)
      .setResolution(hudTextRes);
    hudRoot.add([this.hudScoreBg, this.hudScoreLabel, this.hudScoreText]);

    this.hudLivesBg = this.add.image(0, 0, "bg_hud").setScrollFactor(0);
    hudRoot.add(this.hudLivesBg);
    this.hudHearts = [];
    for (let i = 0; i < FTM_HUD_MAX_LIVES; i += 1) {
      const heartImg = this.add
        .image(0, 0, "ftm_heart_icon")
        .setScrollFactor(0);
      this.hudHearts.push(heartImg);
      hudRoot.add(heartImg);
    }

    this.hudQuestionProgress = createPhaserQuestionProgressHud(this, hudDepth + 2, {
      mobile,
      width: safe.width,
      px: ui.px.bind(ui),
      resolution: hudTextRes,
    });
    hudRoot.add(this.hudQuestionProgress.bg);
    hudRoot.add(this.hudQuestionProgress.text);

    this.layoutFtmHudStats();

    this.hudTimerEvent = this.time.addEvent({
      delay: 250,
      loop: true,
      callback: () => {
        this.hudTimeText?.setText(this.formatElapsedTime());
        this.layoutFtmHudStats();
      },
    });

    this.refreshFindTheMatchHudHearts();

    this.setFtmSuggestionVisible(showSuggestion);
  }

  /** suggestion ด้านบน — แสดงเมื่อมี suggestion เท่านั้น */
  private setFtmSuggestionVisible(visible: boolean) {
    if (!visible) {
      this.hudTitlePill?.setVisible(false);
      this.hudTitleText?.setVisible(false);
      this.hudTitleDom?.setVisible(false);
      return;
    }
    this.layoutFtmSuggestionHud();
  }

  private getFtmQuestionProgressLabel(): string {
    const total = this.ftmQuestions.length || this.totalQuestions || 0;
    if (total <= 0) return "";
    const questionIndex0 = this.ftmCurrentQIndex >= 0 ? this.ftmCurrentQIndex : null;
    return getQuestionProgressLabel(total, {
      questionIndex0,
      gameplayActive: this.ftmGameplayActive,
    });
  }

  private refreshFtmQuestionProgressHud() {
    this.layoutFtmHudStats();
  }

  private refreshFindTheMatchHudHearts() {
    for (let i = 0; i < this.hudHearts.length; i += 1) {
      const alive = i < this.ftmHudLives;
      this.hudHearts[i]?.setAlpha(alive ? 1 : 0.25);
    }
    this.layoutFtmHudStats();
  }

  /** อัปเดต HUD center — แสดงได้ตามที่มี: keyword / image_keyword / sound_keyword (ไม่บังคับครบ) */
  private setFtmHudKeyword(q: FtmQuestion) {
    if (!this.hudTitleText || !this.hudTitlePill || !this.hudKeywordPill || !this.hudKeywordText) {
      return;
    }
    const mobile = this.mobile;
    const safe = this.getFtmSafeArea();
    const w = safe.width;
    const h = safe.height;
    const mediaLayoutH = mobile ? h * FTM_MOBILE_KEYWORD_MEDIA_HEIGHT_SCALE : h;
    const ui = createHudScaleCtx(w, h, mobile);
    const { slots, metrics } = this.getFtmHudLayout();
    const hudTextRes = Math.min(3, typeof window !== "undefined" ? window.devicePixelRatio || 2 : 2);

    const keyword = (q.keyword ?? "").trim();
    const hasKeyword = hasHudCenterLabel(keyword);
    const imgKey = this.getFtmTexKey(q.image_keyword);
    const hasImage = !!imgKey;
    const skUrl = this.getFtmAudioUrl(q.sound_keyword);
    const hasSound = !!skUrl;

    this.hudKwImageBg?.destroy();
    this.hudKwImageBg = undefined;
    this.hudKwImage?.destroy();
    this.hudKwImage = undefined;
    this.hudKwSpeaker?.destroy();
    this.hudKwSpeaker = undefined;
    this.hudKeywordPill.setVisible(false);
    this.hudKeywordText.setVisible(false);
    this.hudKeywordDom?.setVisible(false);

    const showSuggestion = hasHudCenterLabel(this.hudExerciseTitle);
    this.setFtmSuggestionVisible(showSuggestion);

    if (!hasKeyword && !hasImage && !hasSound) {
      this.hudKwAreaBottomY = showSuggestion ? this.hudKwPillY + this.hudKwPillH : safe.y + slots.questionY;
      return;
    }

    const useCardKeywordLayout = hasKeyword && hasImage;

    let mediaCenterX = this.hudKwMediaCenterX || slots.questionCenterX;
    let mediaAnchorBottomY = safe.y + slots.questionY;
    if (showSuggestion) {
      mediaAnchorBottomY = this.hudKwPillY + this.hudKwPillH;
    }

    const addFtmHudSpeaker = (x: number, y: number, size: number) => {
      if (!skUrl) return;
      const btn = this.add
        .image(x, y, HUD_VOLUME_TEXTURE_KEY)
        .setDisplaySize(size, size)
        .setScrollFactor(0)
        .setDepth(2003)
        .setInteractive({ useHandCursor: true });
      btn.on("pointerdown", () => {
        this.tweens.add({ targets: btn, scale: { from: btn.scale, to: btn.scale * 0.88 }, yoyo: true, duration: 90 });
        this.playFtmAudio(skUrl);
      });
      this.hudRoot?.add(btn);
      this.hudRoot?.bringToTop(btn);
      this.hudKwSpeaker = btn;
    };

    if (hasKeyword && !hasImage) {
      const keywordPillY = mediaAnchorBottomY + ui.px(mobile ? 14 : 18);
      const minLeft = mobile ? safe.x + metrics.leftPad : slots.timeRight + metrics.questionGap;
      const maxRight = mobile ? safe.x + safe.width - metrics.leftPad : slots.statsLeftEdge - metrics.questionGap;
      const maxAllowedW = Math.max(1, maxRight - minLeft);
      const effectiveMaxW = Math.min(this.hudKwPillMaxW, maxAllowedW);
      const pillPadX = ui.px(mobile ? 12 : 16);
      const pill = resolveQuestionHudTextPillBox({
        text: keyword,
        mobile,
        px: ui.px.bind(ui),
        centerX: slots.questionCenterX,
        topY: keywordPillY,
        minW: this.hudKwPillMinW,
        maxW: effectiveMaxW,
        pillPadX,
        basePillH: this.hudKwPillH,
        fontPx: getHudCenterTextMaxFontPx(ui.px.bind(ui), mobile),
        maxLines: 2,
      });
      const box = resolveCenteredQuestionBox({
        centerX: slots.questionCenterX,
        desiredW: pill.width,
        minW: this.hudKwPillMinW,
        maxW: this.hudKwPillMaxW,
        minLeft,
        maxRight,
      });
      const keywordPillH = pill.height;
      const wrapInner = pill.wrapWidth;
      const kwFontPx = pill.fontPx ?? getHudCenterTextMaxFontPx(ui.px.bind(ui), mobile);

      this.hudKeywordPill.clear();
      this.hudKeywordPill.fillStyle(0xffffff, 0.92);
      this.hudKeywordPill.lineStyle(2, 0xd9e8e5, 1);
      this.hudKeywordPill.fillRoundedRect(box.left, keywordPillY, box.width, keywordPillH, 14);
      this.hudKeywordPill.strokeRoundedRect(box.left, keywordPillY, box.width, keywordPillH, 14);
      this.hudKeywordPill.setVisible(true);

      const textPadX = ui.px(mobile ? 12 : 16);
      const textPadY = ui.px(mobile ? 10 : 8);
      const wrapPadX = ui.px(mobile ? 56 : 96);
      this.hudKeywordDom =
        applyPhaserHudQuestionText({
          scene: this,
          text: this.hudKeywordText,
          dom: this.hudKeywordDom,
          parent: this.hudRoot,
          content: keyword,
          centerX: box.centerX,
          centerY: keywordPillY + keywordPillH / 2,
          fontPx: kwFontPx,
          boxWidth: box.width,
          wrapWidth: wrapInner,
          wrapPadX,
          textPadX,
          textPadY,
          resolution: hudTextRes,
          mobile,
          depth: 2002,
          lineSpacing: mobile ? 3 : 2,
        }) ?? this.hudKeywordDom;

      if (hasSound) {
        const speakerSize = ui.px(mobile ? 38 : 46);
        const speakerGap = ui.px(mobile ? 8 : 10);
        addFtmHudSpeaker(
          box.left - speakerSize / 2 - speakerGap,
          keywordPillY + keywordPillH / 2,
          speakerSize
        );
      }
      this.hudKwAreaBottomY = keywordPillY + keywordPillH;
      return;
    }

    if (!hasImage && !hasSound) return;

    if (!hasImage) {
      const speakerSize = ui.px(mobile ? 42 : 52);
      const speakerY = mediaAnchorBottomY + ui.px(mobile ? 14 : 18) + speakerSize / 2;
      this.hudKwMediaCenterX = mediaCenterX;
      this.hudKwMediaCenterY = speakerY;
      addFtmHudSpeaker(mediaCenterX, speakerY, speakerSize);
      this.hudKwAreaBottomY = speakerY + speakerSize / 2;
      return;
    }

    this.hudKwMediaCenterX = mediaCenterX;
    const kwFrameHalfH = useCardKeywordLayout
      ? getQuestionMediaCardLayoutHalfH(mobile, ui.px.bind(ui), w, mediaLayoutH)
      : getQuestionMediaFrameHalfH(mobile, ui.px.bind(ui), w, true, mediaLayoutH);
    this.hudKwMediaCenterY = getQuestionMediaCenterYBelowAnchor(
      mediaAnchorBottomY,
      kwFrameHalfH,
      mobile,
      ui.px.bind(ui)
    );

    const hudDepth = 2001;
    const imgTex = imgKey ? this.getFtmTextureSourceSize(imgKey) : undefined;
    const layout = computeQuestionMediaLayout({
      mobile,
      px: ui.px.bind(ui),
      screenWidth: w,
      screenHeight: mediaLayoutH,
      mediaCenterX: this.hudKwMediaCenterX,
      mediaCenterY: this.hudKwMediaCenterY,
      hasImage: true,
      hasSound,
      imageTexW: imgTex?.width,
      imageTexH: imgTex?.height,
      questionText: useCardKeywordLayout && hasKeyword ? keyword : undefined,
      maxTextOverlayW: this.hudKwPillMaxW,
      variant: useCardKeywordLayout ? "card" : "default",
    });

    if (!layout) return;

    const mediaBottomY =
      useCardKeywordLayout && hasKeyword && layout.textOverlay
        ? layout.textOverlay.top + layout.textOverlay.height
        : useCardKeywordLayout
          ? this.hudKwMediaCenterY + getQuestionMediaCardLayoutHalfH(mobile, ui.px.bind(ui), w, mediaLayoutH)
          : this.hudKwMediaCenterY + getQuestionMediaFrameHalfH(mobile, ui.px.bind(ui), w, true, mediaLayoutH);
    this.hudKwAreaBottomY = mediaBottomY + ui.px(mobile ? 8 : 10);

    const frame = this.add.graphics().setScrollFactor(0).setDepth(hudDepth);
    if (useCardKeywordLayout) {
      drawQuestionMediaCardFrameBox(frame, layout.frameW, layout.frameH, ui.px(mobile ? 3 : 4));
    } else {
      drawQuestionMediaFrameBox(frame, layout.frameW, layout.frameH);
    }
    frame.setPosition(this.hudKwMediaCenterX, this.hudKwMediaCenterY);
    this.hudRoot?.add(frame);
    this.hudKwImageBg = frame;

    if (layout.showImage && imgKey) {
      const qImg = this.add
        .image(layout.imageCenterX, layout.imageCenterY, imgKey)
        .setDisplaySize(layout.imageW, layout.imageH)
        .setScrollFactor(0)
        .setDepth(hudDepth + 1);
      this.hudRoot?.add(qImg);
      this.hudKwImage = qImg;
    }

    if (useCardKeywordLayout && hasKeyword && layout.textOverlay) {
      const overlay = layout.textOverlay;
      const pillPadX = ui.px(mobile ? 8 : 10);
      const fontPx =
        overlay.fontPx ??
        fitQuestionMediaOverlayFontPx(keyword, overlay.width - pillPadX * 2, mobile, ui.px.bind(ui));
      const wrapW = overlay.wrapWidth;

      const pillRadius = ui.px(mobile ? 8 : 10);
      drawQuestionMediaOverlayTextPill(
        this.hudKeywordPill,
        overlay.left,
        overlay.top,
        overlay.width,
        overlay.height,
        pillRadius,
        ui.px(mobile ? 2 : 3)
      );
      this.hudKeywordPill.setVisible(true);

      const textPadX = ui.px(mobile ? 12 : 16);
      const textPadY = ui.px(mobile ? 10 : 8);
      const wrapPadX = ui.px(mobile ? 56 : 96);
      this.hudKeywordDom =
        applyPhaserHudQuestionText({
          scene: this,
          text: this.hudKeywordText,
          dom: this.hudKeywordDom,
          parent: this.hudRoot,
          content: keyword,
          centerX: overlay.centerX,
          centerY: overlay.centerY,
          fontPx,
          boxWidth: overlay.width,
          wrapWidth: wrapW,
          wrapPadX,
          textPadX,
          textPadY,
          resolution: hudTextRes,
          mobile,
          depth: 2002,
          lineSpacing: mobile ? 3 : 2,
        }) ?? this.hudKeywordDom;
      this.hudRoot?.bringToTop(this.hudKeywordPill);
      this.hudRoot?.bringToTop(this.hudKeywordText);
      this.hudKeywordDom && this.hudRoot?.bringToTop(this.hudKeywordDom);
    }

    if (layout.showSound && skUrl) {
      addFtmHudSpeaker(layout.speakerX, layout.speakerY, layout.speakerSize);
    }
  }

  /** เปลี่ยน texture ตัวละครระหว่างเล่น */
  private setFtmCharTexture(key: string) {
    const ch = this.homeCharacter;
    if (!ch?.active || !this.textures.exists(key)) return;
    const heightRatio = this.mobile ? RIDER_HOME_HEIGHT_RATIO_MOBILE : RIDER_HOME_HEIGHT_RATIO_DESKTOP;
    this.applyRiderTextureAndSize(ch, key, heightRatio);
  }

  private cancelFtmCharEmote() {
    this.ftmCharEmoteTimer?.remove(false);
    this.ftmCharEmoteTimer = undefined;
    this.ftmCharEmoteLock = false;
  }

  /** ตอบถูก → correct.png | ตอบผิด → wrong.png แล้วกลับ idle (answer = ท่าเปิดกล่องตอนลาก) */
  private showFtmCharacterEmote(textureKey: "ftm_char_correct" | "ftm_char_wrong") {
    if (!this.ftmGameplayActive || !this.homeCharacter?.active) return;
    this.cancelFtmCharEmote();
    this.ftmCharEmoteLock = true;
    this.setFtmCharTexture(textureKey);
    this.ftmCharEmoteTimer = this.time.delayedCall(2000, () => {
      this.ftmCharEmoteTimer = undefined;
      this.ftmCharEmoteLock = false;
      if (!this.ftmGameplayActive || this.ftmGameFailedByNoLives) return;
      this.setFtmCharTexture("ftm_char_idle_play");
    });
  }

  /** คำนวณพื้นที่ drop zone (มองไม่เห็น) — อิงขนาด/ตำแหน่งจากสไปรต์จริง */
  private syncFtmDropBoxToCharacter() {
    const ch = this.homeCharacter;
    if (!ch?.active) return false;

    const mobile = this.mobile;
    const t = mobile ? FTM_DROP_TUNING.mobile : FTM_DROP_TUNING.desktop;
    const dispW = ch.displayWidth;
    const dispH = ch.displayHeight;
    const cx = ch.x;
    const cy = ch.y;

    const boxW = Math.round(Phaser.Math.Clamp(dispW * t.widthMul, t.wMin, t.wMax));
    const boxH = Math.round(Phaser.Math.Clamp(dispH * t.heightMul, t.hMin, t.hMax));
    const boxCX = Math.round(cx - dispW * t.centerXFromLeft);
    const boxCY = Math.round(cy - dispH * t.centerYFromBottom);

    this.ftmDropBounds.setTo(boxCX - boxW / 2, boxCY - boxH / 2, boxW, boxH);
    this.ftmDropGlowRect.setTo(
      this.ftmDropBounds.x + t.glowOffsetX,
      this.ftmDropBounds.y + t.glowOffsetY,
      boxW + t.glowWidthAdd,
      boxH + t.glowHeightAdd
    );
    this.ftmDropGlowRadius = Math.round(
      Phaser.Math.Clamp(Math.min(boxW, boxH) * 0.11, t.cornerRadius - 2, t.cornerRadius + 4)
    );
    return true;
  }

  private buildFtmDropBox() {
    this.ftmDropGlowTimer?.remove(false);
    this.ftmDropGlowTimer = undefined;
    this.ftmDropGlow?.destroy();
    this.ftmDropGlow = undefined;

    if (!this.syncFtmDropBoxToCharacter()) {
      const { height } = this.scale;
      const mobile = this.mobile;
      const { x: anchorX, y: anchorY } = this.getRiderScreenAnchor();
      const riderH = height * (mobile ? RIDER_HOME_HEIGHT_RATIO_MOBILE : RIDER_HOME_HEIGHT_RATIO_DESKTOP);
      const dispW = Math.max(100, riderH * 1.05);
      const dispH = riderH;
      const t = mobile ? FTM_DROP_TUNING.mobile : FTM_DROP_TUNING.desktop;
      const boxW = Math.round(Phaser.Math.Clamp(dispW * t.widthMul, t.wMin, t.wMax));
      const boxH = Math.round(Phaser.Math.Clamp(dispH * t.heightMul, t.hMin, t.hMax));
      const boxCX = Math.round(anchorX - dispW * t.centerXFromLeft);
      const boxCY = Math.round(anchorY - dispH * t.centerYFromBottom);
      this.ftmDropBounds.setTo(boxCX - boxW / 2, boxCY - boxH / 2, boxW, boxH);
      this.ftmDropGlowRect.setTo(
        this.ftmDropBounds.x + t.glowOffsetX,
        this.ftmDropBounds.y + t.glowOffsetY,
        boxW + t.glowWidthAdd,
        boxH + t.glowHeightAdd
      );
      this.ftmDropGlowRadius = Math.round(
        Phaser.Math.Clamp(Math.min(boxW, boxH) * 0.11, t.cornerRadius - 2, t.cornerRadius + 4)
      );
    }

    if (!FTM_DROP_GLOW_ENABLED) return;

    this.ftmDropGlow = this.add.graphics().setScrollFactor(0).setDepth(90);
    this.ftmDropGlowPhase = 0;
    this.drawFtmDropGlow();
    this.ftmDropGlowTimer = this.time.addEvent({
      delay: 40,
      loop: true,
      callback: () => {
        if (!this.ftmDropGlow?.active) return;
        this.ftmDropGlowPhase = (this.ftmDropGlowPhase + 0.16) % (Math.PI * 2);
        this.drawFtmDropGlow();
      },
    });
  }

  private drawFtmDropTravelingGlow(
    g: Phaser.GameObjects.Graphics,
    b: Phaser.Geom.Rectangle,
    radius: number,
    phase: number,
    segLen: number,
    steps: number,
    strokeW: number,
    color: number,
    alpha: number
  ) {
    g.lineStyle(strokeW, color, alpha);
    g.beginPath();
    for (let i = 0; i <= steps; i += 1) {
      const p = ftmPointOnRoundedRectPerimeter(
        b.x,
        b.y,
        b.width,
        b.height,
        radius,
        phase + (i / steps) * segLen
      );
      if (i === 0) g.moveTo(p.px, p.py);
      else g.lineTo(p.px, p.py);
    }
    g.strokePath();
  }

  private drawFtmDropGlow() {
    const g = this.ftmDropGlow;
    if (!g?.active) return;
    const b = this.ftmDropGlowRect;
    const mobile = this.mobile;
    const t = mobile ? FTM_DROP_TUNING.mobile : FTM_DROP_TUNING.desktop;
    const radius = this.ftmDropGlowRadius;
    const over = this.ftmDragOverZone;
    const phase = this.ftmDropGlowPhase;
    const pulse = 0.42 + 0.38 * Math.sin(phase);
    const glowAlpha = over ? 1 : pulse;
    const travelPhase = (phase / (Math.PI * 2)) % 1;

    const eOut = t.expandOuter;
    const eMid = t.expandMid;
    const eIn = t.expandInner;

    g.clear();

    g.lineStyle(t.strokeOuter, t.glowOuter, glowAlpha * 0.16);
    g.strokeRoundedRect(
      b.x - eOut,
      b.y - eOut,
      b.width + eOut * 2,
      b.height + eOut * 2,
      radius + t.radiusOuterAdd
    );

    g.lineStyle(t.strokeMid, t.glowMid, glowAlpha * 0.24);
    g.strokeRoundedRect(
      b.x - eMid,
      b.y - eMid,
      b.width + eMid * 2,
      b.height + eMid * 2,
      radius + t.radiusMidAdd
    );

    g.lineStyle(t.strokeInner, t.glowMid, glowAlpha * 0.32);
    g.strokeRoundedRect(
      b.x - eIn,
      b.y - eIn,
      b.width + eIn * 2,
      b.height + eIn * 2,
      radius + t.radiusInnerAdd
    );

    g.lineStyle(over ? t.strokeCoreOver : t.strokeCore, t.glowCore, over ? 0.72 : 0.58);
    g.strokeRoundedRect(b.x, b.y, b.width, b.height, radius);

    const segLen = mobile ? 0.16 : 0.14;
    const steps = 8;
    this.drawFtmDropTravelingGlow(
      g,
      b,
      radius,
      travelPhase,
      segLen,
      steps,
      t.travelStrokeHot,
      t.glowHot,
      over ? 0.62 : 0.48
    );
    this.drawFtmDropTravelingGlow(
      g,
      b,
      radius,
      (travelPhase + 0.5) % 1,
      segLen,
      steps,
      t.travelStrokeMid,
      t.glowMid,
      over ? 0.45 : 0.34
    );
  }

  // ═══════════════════════════════════════════════════════════
  // GAMEPLAY: Drag-and-Drop จับคู่ keyword ↔ matching_word
  // ═══════════════════════════════════════════════════════════

  private resolveAssetUrl(raw?: string | null): string | undefined {
    if (!raw) return undefined;
    const t = String(raw).trim();
    if (!t) return undefined;

    if (/^https?:\/\//i.test(t)) {
      try {
        const url = new URL(t);
        url.pathname = decodeURIComponent(url.pathname).replace(/\/{2,}/g, "/");
        return url.toString();
      } catch {
        return t;
      }
    }

    const path = decodeURIComponent(t).replace(/^\/+/, "");
    return `${API_BASE_URL}/${path}`;
  }

  private getFtmTexKey(raw?: string | null): string | undefined {
    const url = this.resolveAssetUrl(raw);
    if (!url) return undefined;
    const key = this.ftmTexByUrl.get(url);
    return key && this.textures.exists(key) ? key : undefined;
  }

  private getFtmAudioUrl(raw?: string | null): string | undefined {
    const url = this.resolveAssetUrl(raw);
    if (!url) return undefined;
    const key = this.ftmAudioByUrl.get(url);
    return key && this.cache.audio.exists(key) ? url : undefined;
  }

  private getFtmTextureSourceSize(
    imgKey: string
  ): { width: number; height: number } | undefined {
    const src = this.textures.get(imgKey).getSourceImage() as {
      width?: number;
      height?: number;
      naturalWidth?: number;
      naturalHeight?: number;
    };
    const width = src.naturalWidth ?? src.width ?? 0;
    const height = src.naturalHeight ?? src.height ?? 0;
    if (!width || !height) return undefined;
    return { width, height };
  }

  private pruneMissingFtmTextures() {
    for (const [url, key] of this.ftmTexByUrl.entries()) {
      if (!this.textures.exists(key)) {
        this.ftmTexByUrl.delete(url);
        // eslint-disable-next-line no-console -- debug โหลด asset find-the-match
        console.warn("[find-the-match] โหลดรูปไม่สำเร็จ", { url, key });
      }
    }
  }

  private async loadFtmDynamicAssets(): Promise<void> {
    const qs = this.ftmPayload?.questions as FtmQuestion[] | undefined;
    if (!qs?.length) return;

    const audioJobs: { key: string; url: string }[] = [];
    const imageJobs: { key: string; url: string }[] = [];

    const regAudio = (raw?: string | null) => {
      const url = this.resolveAssetUrl(raw);
      if (!url || this.ftmAudioByUrl.has(url)) return;
      const key = `ftm_audio_${this.ftmAudioByUrl.size}`;
      this.ftmAudioByUrl.set(url, key);
      if (!this.cache.audio.exists(key)) audioJobs.push({ key, url });
    };
    const regImage = (raw?: string | null) => {
      const url = this.resolveAssetUrl(raw);
      if (!url || this.ftmTexByUrl.has(url)) return;
      const key = `ftm_tex_${this.ftmTexByUrl.size}`;
      this.ftmTexByUrl.set(url, key);
      if (!this.textures.exists(key)) imageJobs.push({ key, url });
    };

    for (const q of qs) {
      regAudio(q.sound_keyword);
      regImage(q.image_keyword);
      regAudio(q.sound_hint);
      regImage(q.image_hint);
      regAudio(q.sound_matching_word);
      regImage(q.image_matching_word);
    }

    if (!audioJobs.length && !imageJobs.length) return;
    if (imageJobs.length) this.load.setCORS("anonymous");
    for (const a of audioJobs) this.load.audio(a.key, a.url);
    for (const i of imageJobs) this.load.image(i.key, i.url);

    await new Promise<void>((resolve) => {
      this.load.once(Phaser.Loader.Events.COMPLETE, resolve);
      this.load.start();
    });
    this.pruneMissingFtmTextures();
  }

  private beginFtmFlow() {
    const qs = this.ftmPayload?.questions as FtmQuestion[] | undefined;
    if (!qs?.length) return;

    this.ftmQuestions = qs;
    this.ftmQueueIndices = qs.map((_, i) => i);
    this.ftmHudLives = FTM_HUD_MAX_LIVES;
    this.ftmGameFailedByNoLives = false;
    this.score = 0;
    this.refreshFindTheMatchHudHearts();
    this.ftmGameplayActive = true;
    this.ftmAnswerLocked = false;
    this.ftmAudioByUrl = this.ftmAudioByUrl; // keep loaded refs

    // สร้าง word pool จาก matching_word ทุกข้อ แล้ว shuffle
    const allWords: FtmWordEntry[] = qs.map((q, i) => ({
      word: q.matching_word ?? "",
      qIndex: i,
      soundUrl: this.resolveAssetUrl(q.sound_matching_word),
      imageUrl: this.resolveAssetUrl(q.image_matching_word),
    }));
    Phaser.Utils.Array.Shuffle(allWords);
    this.ftmWordPool = allWords;
    this.ftmDisplayed = [];
    this.ftmCardByEntry.clear();

    if (!this.ftmDragEventsAttached) {
      this.ftmDragEventsAttached = true;
      this.input.on(Phaser.Input.Events.DRAG_START, this.onFtmDragStart, this);
      this.input.on(Phaser.Input.Events.DRAG, this.onFtmDrag, this);
      this.input.on(Phaser.Input.Events.DRAG_END, this.onFtmDragEnd, this);
    }

    this.buildFtmDropBox();
    this.createFtmTeacherUiIfNeeded();

    const firstIndex = this.ftmQueueIndices.shift() ?? 0;
    this.startFtmQuestion(firstIndex);
    this.startFtmAnimalChase();
  }

  private onFtmDragStart(
    _ptr: Phaser.Input.Pointer,
    obj: Phaser.GameObjects.Container
  ) {
    if (!this.ftmGameplayActive || this.ftmAnswerLocked) return;
    // ตรวจว่า object ที่กำลังลากเป็น choice card ของเราจริงๆ
    let isOurCard = false;
    for (const c of this.ftmCardByEntry.values()) {
      if (c === obj) { isOurCard = true; break; }
    }
    if (!isOurCard) return;
    if (this.cache.audio.exists("sfx_pop")) {
      guardedScenePlay(this, "sfx_pop", 0.7, "choice");
    }
    this.setFtmChoiceDragCursor(FTM_CHOICE_CURSOR_GRABBING);
  }

  private setFtmChoiceDragCursor(cursor: string) {
    const canvas = this.input.manager?.canvas as HTMLCanvasElement | undefined;
    if (canvas) canvas.style.cursor = cursor;
  }

  private resetFtmChoiceDragCursor() {
    this.setFtmChoiceDragCursor("");
  }

  private onFtmDrag(
    _ptr: Phaser.Input.Pointer,
    obj: Phaser.GameObjects.Container,
    dragX: number,
    dragY: number
  ) {
    obj.setPosition(dragX, dragY);
    obj.setDepth(500);
    const over = this.ftmDropBounds.contains(dragX, dragY);
    if (over !== this.ftmDragOverZone) {
      this.ftmDragOverZone = over;
      this.drawFtmDropGlow();
      // ท่าเปิดกล่อง (answer) ตอนลากอยู่เหนือ zone — ยังไม่เช็คคำตอบ
      if (!this.ftmCharEmoteLock && !this.ftmAnswerLocked) {
        this.setFtmCharTexture(over ? "ftm_char_answer" : "ftm_char_idle_play");
      }
    }
  }

  private onFtmDragEnd(ptr: Phaser.Input.Pointer, obj: Phaser.GameObjects.Container) {
    this.ftmDragOverZone = false;
    this.drawFtmDropGlow();
    this.resetFtmChoiceDragCursor();

    if (this.ftmAnswerLocked || !this.ftmGameplayActive) {
      if (!this.ftmCharEmoteLock) this.setFtmCharTexture("ftm_char_idle_play");
      this.snapFtmCardBack(obj);
      return;
    }
    let matched: FtmWordEntry | undefined;
    for (const [e, c] of this.ftmCardByEntry) {
      if (c === obj) { matched = e; break; }
    }
    if (!matched) {
      if (!this.ftmCharEmoteLock) this.setFtmCharTexture("ftm_char_idle_play");
      this.snapFtmCardBack(obj);
      return;
    }

    // เช็คคำตอบเมื่อปล่อยมือเท่านั้น
    if (this.ftmDropBounds.contains(ptr.x, ptr.y)) {
      this.handleFtmDrop(matched, obj);
    } else {
      if (!this.ftmCharEmoteLock) this.setFtmCharTexture("ftm_char_idle_play");
      this.snapFtmCardBack(obj);
    }
  }

  private snapFtmCardBack(card: Phaser.GameObjects.Container) {
    const hx = (card.getData("hx") as number) ?? 0;
    const hy = (card.getData("hy") as number) ?? 0;
    card.setDepth(100);
    this.tweens.add({ targets: card, x: hx, y: hy, duration: 240, ease: "Back.Out" });
  }

  private startFtmQuestion(qIndex: number) {
    this.ftmCurrentQIndex = qIndex;
    const q = this.ftmQuestions[qIndex];
    if (!q) return;

    this.refreshFtmQuestionProgressHud();
    this.fillFtmDisplayForQuestion(qIndex);
    this.setFtmHudKeyword(q);
    this.buildFtmChoiceGrid();

    const skUrl = this.getFtmAudioUrl(q.sound_keyword);
    const shUrl = this.getFtmAudioUrl(q.sound_hint);
    const hintHasSound = !!shUrl && (!skUrl || shUrl !== skUrl);
    const hasHint = this.hasFtmQuestionHint(q);

    if (skUrl && hasHint && hintHasSound) {
      // เสียงโจทย์ (keyword) เล่นจบก่อน แล้วค่อยขึ้นคำใบ้ + เสียงคำใบ้
      const qKey = this.ftmAudioByUrl.get(skUrl);
      this.time.delayedCall(350, () => {
        guardedScenePlayQuestionThen(this, qKey, 1, () => {
          if (!this.sys.isActive()) return;
          this.showFtmQuestionHint(q);
          this.time.delayedCall(150, () => this.playFtmHintSound(q));
        });
      });
    } else {
      this.showFtmQuestionHint(q);
      if (skUrl) {
        this.time.delayedCall(350, () => this.playFtmAudio(skUrl));
      }
      this.time.delayedCall(600, () => this.playFtmHintSound(q));
    }
  }

  private hasFtmQuestionHint(q: FtmQuestion): boolean {
    const hint = (q.hint ?? "").trim();
    const imgKey = this.getFtmTexKey(q.image_hint);
    return !!(hint || imgKey);
  }

  private playFtmHintSound(q: FtmQuestion) {
    const sk = this.resolveAssetUrl(q.sound_keyword);
    const sh = this.resolveAssetUrl(q.sound_hint);
    if (!sh || (sk && sh === sk)) return;
    this.playFtmAudio(sh);
  }

  /** ตรวจสอบและเพิ่มคำตอบที่ถูกของข้อปัจจุบันเข้า ftmDisplayed เสมอ */
  private fillFtmDisplayForQuestion(qIndex: number) {
    const alreadyIn = this.ftmDisplayed.some((e) => e.qIndex === qIndex);
    if (!alreadyIn) {
      const pi = this.ftmWordPool.findIndex((e) => e.qIndex === qIndex);
      if (pi >= 0) {
        const [correct] = this.ftmWordPool.splice(pi, 1);
        if (this.ftmDisplayed.length >= FTM_MAX_DISPLAY) {
          // ดึงตัวสุดท้ายออกคืน pool แล้วใส่คำตอบแทน
          const displaced = this.ftmDisplayed.pop()!;
          this.ftmWordPool.unshift(displaced);
        }
        this.ftmDisplayed.push(correct);
      }
    }
    // เติมช่องว่างที่เหลือ
    while (this.ftmDisplayed.length < FTM_MAX_DISPLAY && this.ftmWordPool.length > 0) {
      this.ftmDisplayed.push(this.ftmWordPool.shift()!);
    }
  }

  private getFtmMobileChoiceTuning() {
    return {
      ...FTM_WORD_CARD_TUNING.mobile,
      wMin: 82,
      wMax: 116,
      hPad: 7,
      gapX: 6,
      gapY: 2,
      rowGapY: 6,
      imageFrameW: 66,
      imageFrameH: 66,
      imageFrameGap: 5,
      speakerSize: 24,
      speakerPillOverlap: 0.2,
      textPillMinW: 48,
    };
  }

  private getFtmChoiceTuning() {
    return this.mobile ? this.getFtmMobileChoiceTuning() : FTM_WORD_CARD_TUNING.desktop;
  }

  private getFtmChoiceGridBottomReservePx(height: number, width: number): number {
    if (!this.mobile) return FTM_CHOICE_GRID_BOTTOM_PAD.desktop;

    const basePad = mobileCompactPx(FTM_CHOICE_GRID_BOTTOM_PAD.mobile, height, width);
    const q = this.ftmCurrentQIndex >= 0 ? this.ftmQuestions[this.ftmCurrentQIndex] : undefined;
    const hintText = (q?.hint ?? "").trim();
    const imgKey = q ? this.getFtmTexKey(q.image_hint) : undefined;
    const hasHint = !!hintText || !!(imgKey && this.textures.exists(imgKey));
    if (!hasHint) return basePad;

    const safetyGap = mobileCompactPx(22, height, width);
    return Math.max(
      basePad,
      TeacherHintUI.measureBottomReservePx(this, this.mobile, {
        hintText,
        hintTextureKey: imgKey,
        safetyGap,
      })
    );
  }

  private getFtmKeywordAreaBottomY(height: number, width: number): number {
    const safe = this.getFtmSafeArea();
    const { slots, metrics } = this.getFtmHudLayout();
    let bottom = safe.y + slots.questionY + (this.hudKwPillH > 0 ? this.hudKwPillH : metrics.questionH);
    if (this.hudKwAreaBottomY > 0) {
      bottom = Math.max(bottom, this.hudKwAreaBottomY);
    }
    const gap = this.mobile ? mobileCompactPx(14, height, width) : 20;
    return bottom + gap;
  }

  private buildFtmChoiceGrid() {
    this.ftmChoiceRoot?.destroy(true);
    this.ftmChoiceRoot = undefined;
    this.ftmCardByEntry.clear();

    if (!this.ftmDisplayed.length) return;

    const safe = this.getFtmSafeArea();
    const width = safe.width;
    const height = safe.height;
    const mobile = this.mobile;
    const tc = this.getFtmChoiceTuning();
    const cols = mobile ? FTM_CHOICE_COLS_MOBILE : FTM_CHOICE_COLS_DESKTOP;
    const hPad = tc.hPad;
    const gapX = tc.gapX;
    const gapY = tc.gapY;

    const bgTex = this.textures.get("ftm_choice_bg").getSourceImage() as { width: number; height: number };
    const innerW = width - hPad * 2 - (cols - 1) * gapX;
    let cardW = Math.floor(innerW / cols);
    let cardWClamped = Phaser.Math.Clamp(cardW, tc.wMin, tc.wMax);
    let bgScale = cardWClamped / Math.max(1, bgTex.width);
    let cardH = Math.ceil(bgTex.height * bgScale);
    const rowGapY =
      "rowGapY" in tc && typeof (tc as { rowGapY?: number }).rowGapY === "number"
        ? (tc as { rowGapY: number }).rowGapY
        : gapY;
    let rowStep = cardH + rowGapY;
    const staggerShiftX = mobile ? 0 : (cardWClamped + gapX) / 2;

    const rows = Math.ceil(this.ftmDisplayed.length / cols);
    const bottomReserve = this.getFtmChoiceGridBottomReservePx(height, width);
    const gridBottomY = safe.y + height - bottomReserve;
    const keywordBottom = this.getFtmKeywordAreaBottomY(height, width);
    const topGap = mobile ? mobileCompactPx(10, height, width) : 20;
    const maxGridHeight = Math.max(cardH, gridBottomY - keywordBottom - topGap);

    if (mobile && rows > 0) {
      const neededHeight = cardH + (rows - 1) * rowStep;
      if (neededHeight > maxGridHeight) {
        const maxCardH = Math.max(1, (maxGridHeight - (rows - 1) * rowGapY) / rows);
        const maxCardW = Math.floor((maxCardH * bgTex.width) / Math.max(1, bgTex.height));
        cardWClamped = Math.max(tc.wMin, Math.min(cardWClamped, maxCardW));
        bgScale = cardWClamped / Math.max(1, bgTex.width);
        cardH = Math.ceil(bgTex.height * bgScale);
        rowStep = cardH + rowGapY;
      }
    }

    const fullRowW = cols * cardWClamped + (cols - 1) * gapX;
    const fullRowStartX = safe.x + width / 2 - fullRowW / 2 + cardWClamped / 2;

    const mobileLowerRowsOffsetY = mobile
      ? mobileCompactPx(FTM_CHOICE_GRID_Y_OFFSET_MOBILE, height, width)
      : 0;
    const mobileLowerRowsOffsetX = mobile
      ? mobileCompactPx(FTM_CHOICE_GRID_X_OFFSET_MOBILE, height, width)
      : 0;
    const startY = gridBottomY - cardH / 2 - (rows - 1) * rowStep;

    const root = this.add.container(0, 0).setScrollFactor(0).setDepth(100);
    this.ftmChoiceRoot = root;

    this.ftmDisplayed.forEach((entry, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      // Mobile uses centered straight rows; desktop keeps the original staggered layout.
      const rowStartIndex = row * cols;
      const rowItemCount = Math.min(cols, this.ftmDisplayed.length - rowStartIndex);
      const rowW = rowItemCount * cardWClamped + (rowItemCount - 1) * gapX;
      const centeredRowStartX = safe.x + width / 2 - rowW / 2 + cardWClamped / 2;
      const rowStaggerX = !mobile && row % 2 === 1 ? staggerShiftX : 0;
      const rowRight = centeredRowStartX + (rowItemCount - 1) * (cardWClamped + gapX) + cardWClamped / 2;
      const lowerRowShiftX =
        mobile && row > 0
          ? Math.max(0, Math.min(mobileLowerRowsOffsetX, safe.x + width - hPad - rowRight))
          : 0;
      const cx =
        (mobile ? centeredRowStartX : fullRowStartX) +
        rowStaggerX +
        col * (cardWClamped + gapX) +
        lowerRowShiftX;
      const cy = startY + row * rowStep + (row > 0 ? mobileLowerRowsOffsetY : 0);
      const card = this.buildFtmChoiceCard(entry, cx, cy, cardWClamped);
      root.add(card);
      this.ftmCardByEntry.set(entry, card);
    });
  }

  private addFtmChoiceSpeaker(
    card: Phaser.GameObjects.Container,
    x: number,
    y: number,
    size: number,
    soundUrl: string
  ): Phaser.GameObjects.Image {
    const spk = this.add
      .image(x, y, HUD_VOLUME_TEXTURE_KEY)
      .setDisplaySize(size, size)
      .setScrollFactor(0)
      .setDepth(20)
      .setInteractive({ useHandCursor: true });
    spk.on(
      "pointerdown",
      (_p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
        ev.stopPropagation();
        this.tweens.add({ targets: spk, scale: { from: spk.scale, to: spk.scale * 0.82 }, yoyo: true, duration: 90 });
        this.playFtmAudio(soundUrl);
      }
    );
    card.add(spk);
    return spk;
  }

  /** ปรับความสูง pill ให้ครอบข้อความที่ wrap จริงใน Phaser */
  private syncFtmChoiceWrappedPill(
    pillGfx: Phaser.GameObjects.Graphics,
    text: Phaser.GameObjects.Text,
    pillLeft: number,
    centerY: number,
    pillW: number,
    pillH: number,
    wordWrapWidth: number | undefined,
    radius: number
  ): { pillTop: number; pillH: number } {
    const mobile = this.mobile;
    const shadow = mobile ? 2 : 3;
    let finalH = pillH;
    if (wordWrapWidth && wordWrapWidth > 0) {
      finalH = Math.max(pillH, Math.ceil(text.height + 8));
      text.setY(centerY);
    }
    const pillTop = centerY - finalH / 2;
    drawQuestionMediaOverlayTextPill(pillGfx, pillLeft, pillTop, pillW, finalH, radius, shadow);
    return { pillTop, pillH: finalH };
  }

  private buildFtmChoiceCard(
    entry: FtmWordEntry,
    cx: number,
    cy: number,
    cardW: number
  ): Phaser.GameObjects.Container {
    const mobile = this.mobile;
    const tc = this.getFtmChoiceTuning();
    const card = this.add.container(cx, cy).setDepth(100);
    card.setData("hx", cx);
    card.setData("hy", cy);

    const bgTex = this.textures.get("ftm_choice_bg").getSourceImage() as { width: number; height: number };
    const bgScale = cardW / Math.max(1, bgTex.width);
    const bg = this.add.image(0, 0, "ftm_choice_bg").setScale(bgScale).setScrollFactor(0);
    card.add(bg);
    const bW = bg.displayWidth;
    const bH = bg.displayHeight;

    const hasImage = !!entry.imageUrl && !!this.getFtmTexKey(entry.imageUrl);
    const hasSound = !!entry.soundUrl && this.ftmAudioByUrl.has(entry.soundUrl);
    const word = entry.word.trim();
    const hasText = word.length > 0;
    const imgKey = hasImage ? this.getFtmTexKey(entry.imageUrl) : undefined;
    const textRes = Math.min(3, typeof window !== "undefined" ? window.devicePixelRatio || 2 : 2);
    const speakerSize = tc.speakerSize;
    const boxBottom = getFtmChocieInnerBottom(bH, tc.labelBoxBottomTrim);

    let hitTop = -bH / 2;
    let hitBottom = bH / 2;
    let hitW = bW;

    if (hasImage && imgKey) {
      const {
        frameW,
        frameH,
        frameCenterY,
        frameBottom,
        frameLeft,
        frameRight,
      } = resolveFtmChoiceImageFrameLayout(bH, bW, tc, mobile, hasText, hasSound, speakerSize);
      const pad = mobile ? 6 : 8;

      const frame = this.add.graphics().setScrollFactor(0).setDepth(8);
      frame.setPosition(0, frameCenterY);
      drawQuestionMediaFrameBox(frame, frameW, frameH);
      card.add(frame);

      const tex = this.textures.get(imgKey).getSourceImage() as { width: number; height: number };
      const fit = fitQuestionMediaContainSize(tex.width, tex.height, frameW - pad * 2, frameH - pad * 2);
      const img = this.add
        .image(0, frameCenterY, imgKey)
        .setDisplaySize(fit.imageW, fit.imageH)
        .setScrollFactor(0)
        .setDepth(9);
      card.add(img);

      if (hasText) {
        const pillPadX = mobile ? 6 : 10;
        const boxInnerW = getFtmChocieInnerWidth(bW, mobile);
        const maxPillW = hasSound
          ? Math.max(tc.textPillMinW, boxInnerW - speakerSize * 0.65)
          : boxInnerW;
        const { pillW, fontPx, pillH, wordWrapWidth, wrappedText } = resolveFtmChoiceTextLayout(
          word,
          mobile,
          pillPadX,
          tc.textPillMinW,
          maxPillW,
          {
            baseFont: mobile ? 14 : 20,
            minFont: mobile ? 11 : 14,
            maxFont: mobile ? 20 : 32,
          }
        );
        const overlay = computeFtmChoiceBoxBottomOverlayLayout(
          frameBottom,
          speakerSize,
          mobile,
          hasSound,
          pillW,
          { imageTextGap: tc.imageFrameGap, speakerPillOverlap: tc.speakerPillOverlap },
          pillH
        );

        const pillGfx = this.add.graphics().setScrollFactor(0).setDepth(11);
        const textObj = this.add
          .text(overlay.textCenterX, overlay.textCenterY, wrappedText ?? word, {
            ...ftmThaiGameTextStyle({
              mobile,
              fontPx,
              tightBottom: true,
              wordWrapWidth: wrappedText ? undefined : wordWrapWidth,
              strokeThickness: mobile ? 2 : undefined,
            }),
          })
          .setOrigin(0.5, 0.5)
          .setScrollFactor(0)
          .setDepth(12)
          .setResolution(textRes);
        const synced = this.syncFtmChoiceWrappedPill(
          pillGfx,
          textObj,
          overlay.pillLeft,
          overlay.textCenterY,
          overlay.pillW,
          pillH,
          wordWrapWidth,
          mobile ? 8 : 10
        );
        card.add(pillGfx);
        card.add(textObj);
        overlay.pillTop = synced.pillTop;
        overlay.pillH = synced.pillH;

        if (hasSound && entry.soundUrl) {
          this.addFtmChoiceSpeaker(
            card,
            overlay.speakerX,
            overlay.speakerY,
            overlay.speakerSize,
            entry.soundUrl
          );
        }

        hitTop = frameCenterY - frameH / 2;
        hitBottom = boxBottom;
        hitW = Math.max(
          bW,
          frameW,
          overlay.pillW + (hasSound ? speakerSize * 0.65 : 0)
        );
      } else if (hasSound && entry.soundUrl) {
        this.addFtmChoiceSpeaker(card, frameLeft + speakerSize * 0.28, frameBottom, speakerSize, entry.soundUrl);
        hitTop = frameCenterY - frameH / 2;
        hitBottom = boxBottom;
        hitW = Math.max(bW, frameW);
      } else {
        hitTop = frameCenterY - frameH / 2;
        hitBottom = boxBottom;
        hitW = Math.max(bW, frameW);
      }
    } else if (hasText) {
      const pillPadX = mobile ? 6 : 12;
      const boxInnerW = getFtmChocieInnerWidth(bW, mobile);
      const boxCenterY = getFtmChocieInnerCenterY(bH, tc.labelBoxTopTrim, tc.labelBoxBottomTrim);
      const pillHDefault = mobile ? 26 : 40;
      const fontOpts = {
        baseFont: mobile ? 16 : 24,
        minFont: mobile ? 12 : 18,
        maxFont: mobile ? 24 : 38,
      };

      if (hasSound && entry.soundUrl) {
        const maxPillW = Math.max(tc.textPillMinW, boxInnerW - speakerSize * 0.65);
        const { pillW, fontPx, pillH, wordWrapWidth, wrappedText } = resolveFtmChoiceTextLayout(
          word,
          mobile,
          pillPadX,
          tc.textPillMinW,
          maxPillW,
          fontOpts,
          pillHDefault
        );
        const layout = computeFtmChoiceTextSoundLayout(
          pillW,
          pillH,
          speakerSize,
          boxCenterY,
          tc.speakerPillOverlap
        );
        const pillGfx = this.add.graphics().setScrollFactor(0).setDepth(10);
        const textObj = this.add
          .text(layout.textCenterX, layout.textCenterY, wrappedText ?? word, {
            ...ftmThaiGameTextStyle({
              mobile,
              fontPx,
              tightBottom: true,
              wordWrapWidth: wrappedText ? undefined : wordWrapWidth,
              strokeThickness: mobile ? 2 : undefined,
            }),
          })
          .setOrigin(0.5, 0.5)
          .setScrollFactor(0)
          .setDepth(11)
          .setResolution(textRes);
        const synced = this.syncFtmChoiceWrappedPill(
          pillGfx,
          textObj,
          layout.pillLeft,
          layout.textCenterY,
          layout.pillW,
          pillH,
          wordWrapWidth,
          mobile ? 10 : 12
        );
        card.add(pillGfx);
        card.add(textObj);
        layout.pillTop = synced.pillTop;
        layout.pillH = synced.pillH;
        this.addFtmChoiceSpeaker(
          card,
          layout.speakerX,
          layout.speakerY,
          layout.speakerSize,
          entry.soundUrl
        );
        const totalW = layout.pillW + layout.speakerSize * 0.65;
        hitW = Math.max(bW, totalW);
        hitTop = layout.pillTop;
        hitBottom = layout.pillTop + layout.pillH;
      } else {
        const { pillW, fontPx, pillH, wordWrapWidth, wrappedText } = resolveFtmChoiceTextLayout(
          word,
          mobile,
          pillPadX,
          tc.textPillMinW,
          boxInnerW,
          fontOpts,
          pillHDefault
        );
        const pillLeft = -pillW / 2;
        const pillGfx = this.add.graphics().setScrollFactor(0).setDepth(10);
        const textObj = this.add
          .text(0, boxCenterY, wrappedText ?? word, {
            ...ftmThaiGameTextStyle({
              mobile,
              fontPx,
              tightBottom: true,
              wordWrapWidth: wrappedText ? undefined : wordWrapWidth,
              strokeThickness: mobile ? 2 : undefined,
            }),
          })
          .setOrigin(0.5, 0.5)
          .setScrollFactor(0)
          .setDepth(11)
          .setResolution(textRes);
        const synced = this.syncFtmChoiceWrappedPill(
          pillGfx,
          textObj,
          pillLeft,
          boxCenterY,
          pillW,
          pillH,
          wordWrapWidth,
          mobile ? 10 : 12
        );
        card.add(pillGfx);
        card.add(textObj);
        const pillTop = synced.pillTop;
        const finalPillH = synced.pillH;
        hitW = Math.max(bW, pillW);
        hitTop = pillTop;
        hitBottom = pillTop + finalPillH;
      }
    } else if (hasSound && entry.soundUrl) {
      const boxCenterY = getFtmChocieInnerCenterY(bH, tc.labelBoxTopTrim, tc.labelBoxBottomTrim);
      this.addFtmChoiceSpeaker(card, 0, boxCenterY, speakerSize, entry.soundUrl);
      hitTop = boxCenterY - speakerSize / 2;
      hitBottom = boxCenterY + speakerSize / 2;
      hitW = Math.max(bW, speakerSize);
    }

    const hitRect = new Phaser.Geom.Rectangle(-hitW / 2, hitTop, hitW, hitBottom - hitTop);
    card.setInteractive({
      hitArea: hitRect,
      hitAreaCallback: Phaser.Geom.Rectangle.Contains,
    });
    if (card.input) card.input.cursor = FTM_CHOICE_CURSOR_GRAB;
    this.input.setDraggable(card);

    return card;
  }

  private handleFtmDrop(entry: FtmWordEntry, card: Phaser.GameObjects.Container) {
    const isCorrect = entry.qIndex === this.ftmCurrentQIndex;

    if (isCorrect) {
      this.ftmAnswerLocked = true;
      this.score += 1;
      this.refreshFindTheMatchHudHearts();
      this.reportRunstateQuestionCompleted(this.ftmCurrentQIndex + 1);
      if (this.cache.audio.exists("sfx_correct_flip_cards")) {
        guardedScenePlay(this, "sfx_correct_flip_cards", 0.9, "choice");
      }
      this.showFtmCharacterEmote("ftm_char_correct");
      this.showFtmTeacherCorrectPraise();
      this.createFtmCorrectStarBurstAroundCharacter();

      // ดึงการ์ดออกจาก root ก่อนจะ destroy root ทีหลัง
      this.ftmChoiceRoot?.remove(card, false);
      card.disableInteractive();

      this.showFtmCorrectEffect(card.x, card.y);

      // บินเข้ากล่อง drop zone (center ของ ftmDropBounds)
      const kx = this.ftmDropBounds.centerX;
      const ky = this.ftmDropBounds.centerY;
      this.tweens.add({
        targets: card,
        x: kx,
        y: ky,
        scale: { from: card.scale, to: 1.15 },
        alpha: 0,
        duration: 440,
        ease: "Cubic.easeOut",
        onComplete: () => card.destroy(true),
      });

      // อัปเดต pool และ displayed
      const di = this.ftmDisplayed.indexOf(entry);
      if (di >= 0) this.ftmDisplayed.splice(di, 1);
      this.ftmCardByEntry.delete(entry);
      const next = this.ftmWordPool.shift();
      if (next) this.ftmDisplayed.push(next);

      // ตอบถูกข้อสุดท้าย → victory dispersion, อย่างอื่น → fall-behind ปกติ
      const isLastQuestion = this.ftmQueueIndices.length === 0;
      if (isLastQuestion) {
        this.victoryFtmAnimalsExit();
      } else {
        this.triggerFtmAnimalFallBehind();
      }

      this.time.delayedCall(620, () => {
        this.ftmAnswerLocked = false;
        this.ftmAdvanceQuestion();
      });
    } else {
      if (this.cache.audio.exists("sfx_incorrect_flip_cards")) {
        guardedScenePlay(this, "sfx_incorrect_flip_cards", 0.9, "choice");
      }
      this.showFtmWrongEffect(card.x, card.y);
      this.snapFtmCardBack(card);
      this.flashFtmCardWrong(card);
      this.showFtmCharacterEmote("ftm_char_wrong");
      this.showFtmTeacherWrongMessage();
      this.ftmLoseLife();
    }
  }

  /** ดาวรอบตัวละครเมื่อตอบถูก — อิง `createCorrectStarBurst` จาก flappy-bird */
  private createFtmCorrectStarBurstAroundCharacter() {
    const ch = this.homeCharacter;
    if (!ch?.active) return;
    const cx = ch.x;
    const cy = ch.y - ch.displayHeight * 0.22;
    this.createFtmCorrectStarBurst(cx, cy);

    const r = Math.max(40, ch.displayWidth * 0.34);
    const ring = [
      { dx: -r, dy: -r * 0.55 },
      { dx: r, dy: -r * 0.55 },
      { dx: -r * 0.95, dy: r * 0.12 },
      { dx: r * 0.95, dy: r * 0.12 },
    ];
    ring.forEach((p, i) => {
      this.time.delayedCall(60 + i * 45, () => {
        this.createFtmCorrectStarBurst(cx + p.dx, cy + p.dy, { burst: 14, secondBurst: 8 });
      });
    });
  }

  private createFtmCorrectStarBurst(
    x: number,
    y: number,
    opts?: { burst?: number; secondBurst?: number }
  ) {
    if (!this.textures.exists("ftm_star_fx")) return;
    const burst = opts?.burst ?? 30;
    const secondBurst = opts?.secondBurst ?? 18;
    const particles = this.add.particles(x, y, "ftm_star_fx", {
      speed: { min: 160, max: 360 },
      angle: { min: 0, max: 360 },
      lifespan: 950,
      gravityY: 340,
      quantity: burst,
      scale: { start: this.mobile ? 0.3 : 0.4, end: 0 },
      emitting: false,
    });
    particles.setScrollFactor(0);
    particles.setDepth(90);
    particles.explode(burst);

    this.time.delayedCall(110, () => {
      if (!particles.active) return;
      particles.explode(
        secondBurst,
        x + Phaser.Math.Between(-18, 18),
        y + Phaser.Math.Between(-35, 55)
      );
    });
    this.time.delayedCall(1200, () => particles.destroy());
  }

  private showFtmFeedbackIcon(x: number, y: number, textureKey: "ftm_correct_icon" | "ftm_wrong_icon") {
    if (!this.textures.exists(textureKey)) return;
    const icon = this.add
      .image(x, y, textureKey)
      .setDisplaySize(62, 62)
      .setScrollFactor(0)
      .setDepth(600)
      .setAlpha(0)
      .setScale(0.4);
    this.tweens.add({
      targets: icon,
      alpha: 1,
      scale: 1.15,
      duration: 200,
      ease: "Back.Out",
      onComplete: () => {
        this.tweens.add({
          targets: icon,
          alpha: 0,
          y: y - 44,
          duration: 380,
          delay: 260,
          ease: "Cubic.easeIn",
          onComplete: () => icon.destroy(),
        });
      },
    });
  }

  private showFtmCorrectEffect(x: number, y: number) {
    this.showFtmFeedbackIcon(x, y, "ftm_correct_icon");
  }

  private showFtmWrongEffect(x: number, y: number) {
    this.showFtmFeedbackIcon(x, y, "ftm_wrong_icon");
  }

  private flashFtmCardWrong(card: Phaser.GameObjects.Container) {
    card.iterate((child: Phaser.GameObjects.GameObject) => {
      if (child instanceof Phaser.GameObjects.Image) child.setTint(0xff7777);
    });
    this.time.delayedCall(380, () => {
      if (!card.active) return;
      card.iterate((child: Phaser.GameObjects.GameObject) => {
        if (child instanceof Phaser.GameObjects.Image) child.clearTint();
      });
    });
  }

  private ftmLoseLife() {
    this.ftmHudLives = Math.max(0, this.ftmHudLives - 1);
    this.refreshFindTheMatchHudHearts();
    if (this.ftmHudLives <= 0) {
      this.ftmGameFailedByNoLives = true;
      this.time.delayedCall(420, () => this.ftmTriggerGameOver());
    }
  }

  private ftmAdvanceQuestion() {
    if (!this.ftmGameplayActive) return;
    if (!this.ftmQueueIndices.length) {
      this.ftmGameFailedByNoLives = false;
      this.ftmTriggerGameOver();
      return;
    }
    const next = this.ftmQueueIndices.shift()!;
    this.startFtmQuestion(next);
  }

  private ftmTriggerGameOver() {
    if (!this.ftmGameplayActive) return;
    this.ftmGameplayActive = false;
    this.cancelFtmCharEmote();
    this.destroyFtmGameplay({ resetCharacter: false });
    this.playFtmBgm("ftm_bgm_end");

    if (this.ftmGameFailedByNoLives) {
      // ลด parallax ให้ช้าลงเพราะตัวละครหยุด (โดนสัตว์ไล่ทัน)
      this.setParallaxGameplaySpeedExtra(PARALLAX_GAMEPLAY_EXTRA_MIN);
      this.chaseAndSmokeFtmCharacter(() => this.endGame());
    } else {
      this.endGame();
    }
  }

  private destroyFtmGameplay(options?: { resetCharacter?: boolean }) {
    const resetCharacter = options?.resetCharacter !== false;
    this.ftmDropGlowTimer?.remove(false);
    this.ftmDropGlowTimer = undefined;
    this.ftmDropGlow?.destroy();
    this.ftmDropGlow = undefined;
    this.ftmChoiceRoot?.destroy(true);
    this.ftmChoiceRoot = undefined;
    this.ftmKeywordRoot?.destroy(true);
    this.ftmKeywordRoot = undefined;
    this.ftmCardByEntry.clear();
    this.ftmDragOverZone = false;
    this.cancelFtmCharEmote();
    this.resetFtmChoiceDragCursor();
    if (resetCharacter) {
      this.setFtmCharTexture("ftm_char_idle_play");
    }
    if (this.ftmDragEventsAttached) {
      this.ftmDragEventsAttached = false;
      this.input.off(Phaser.Input.Events.DRAG_START, this.onFtmDragStart, this);
      this.input.off(Phaser.Input.Events.DRAG, this.onFtmDrag, this);
      this.input.off(Phaser.Input.Events.DRAG_END, this.onFtmDragEnd, this);
    }
  }

  // ───────────────────────────────────────────────────────────
  //  สัตว์ไล่ตาม + smoke ตอนจบเกม
  // ───────────────────────────────────────────────────────────

  /**
   * จุดเป้าหมายของสัตว์ตัวที่ index (อยู่ด้านหลังตัวละคร)
   * - มือถือ: จัดเป็น grid `FTM_ANIMAL_MOBILE_COLS` คอลัมน์ × หลายแถว (Y ไล่ขึ้นไปทีละแถว) เพื่อให้พอจอแคบ
   * - เดสก์ท็อป: เรียงแถวเดียวพร้อม zigzag Y เล็กน้อย
   */
  private getFtmAnimalAnchorXY(index: number): { x: number; y: number; targetH: number } {
    const ch = this.homeCharacter;
    const anchor = this.getRiderScreenAnchor();
    const baseX = ch?.x ?? anchor.x;
    const baseY = ch?.y ?? anchor.y;
    const { height } = this.scale;
    const trail = this.mobile
      ? FTM_ANIMAL_TRAIL_OFFSET_PX.mobile
      : FTM_ANIMAL_TRAIL_OFFSET_PX.desktop;
    const gap = this.mobile ? FTM_ANIMAL_GAP_PX.mobile : FTM_ANIMAL_GAP_PX.desktop;
    const targetH =
      height *
      (this.mobile ? FTM_ANIMAL_HEIGHT_RATIO.mobile : FTM_ANIMAL_HEIGHT_RATIO.desktop);
    const stepX = targetH * 0.9 + gap;
    const lift =
      targetH *
      (this.mobile ? FTM_ANIMAL_LIFT_FROM_FEET_RATIO.mobile : FTM_ANIMAL_LIFT_FROM_FEET_RATIO.desktop);
    const footY = baseY - lift;

    if (this.mobile) {
      const cols = Math.max(1, FTM_ANIMAL_MOBILE_COLS);
      const col = index % cols;
      const row = Math.floor(index / cols);
      const rowY = targetH * FTM_ANIMAL_MOBILE_ROW_Y_RATIO;
      const x = baseX - trail - col * stepX;
      const zig = FTM_ANIMAL_ZIGZAG_Y_PX.mobile;
      const colJitter = col === 1 ? 0 : col === 0 ? zig * 0.25 : -zig * 0.25;
      const y = footY - row * rowY + colJitter;
      return { x, y, targetH };
    }

    const x = baseX - trail - index * stepX;
    const zig = FTM_ANIMAL_ZIGZAG_Y_PX.desktop;
    const y = footY + (index % 2 === 0 ? zig : -zig);
    return { x, y, targetH };
  }

  /** เริ่ม spawn สัตว์ทยอยออกมาทีละตัว (สุ่มลำดับ) */
  private startFtmAnimalChase() {
    this.stopFtmAnimalSpawnTimers();
    const keys = Phaser.Utils.Array.Shuffle([...FTM_ANIMAL_KEYS]).slice(0, FTM_ANIMAL_MAX_COUNT);
    this.ftmAnimalSpawnQueue = keys;
    this.spawnNextFtmAnimal();
    const remaining = this.ftmAnimalSpawnQueue.length;
    if (remaining > 0) {
      this.ftmAnimalSpawnEvent = this.time.addEvent({
        delay: FTM_ANIMAL_SPAWN_INTERVAL_MS,
        repeat: remaining - 1,
        callback: () => this.spawnNextFtmAnimal(),
      });
    }
  }

  /** เสียงตามชนิดสัตว์: เฉพาะแมวดำ (animal1) และหมา (animal2) เท่านั้น */
  private playFtmAnimalSpawnSfx(animalKey: string) {
    const sfxKey =
      animalKey === "ftm_animal_1" ? "ftm_sfx_cat"
      : animalKey === "ftm_animal_2" ? "ftm_sfx_dog"
      : undefined;
    if (!sfxKey) return;
    if (!this.cache.audio.exists(sfxKey)) return;
    guardedScenePlay(this, sfxKey, 0.2);
  }

  /** ลึกของสัตว์ตาม y — y มาก (ล่างสุดของจอ) = depth สูง = อยู่หน้าสุด, แต่ยังต่ำกว่าตัวละคร (82) */
  private ftmAnimalDepthForY(y: number): number {
    return 78 + (y / Math.max(1, this.scale.height)) * 3;
  }

  private spawnNextFtmAnimal() {
    if (!this.ftmGameplayActive) return;
    if (this.ftmAnimals.length >= FTM_ANIMAL_MAX_COUNT) return;
    const key = this.ftmAnimalSpawnQueue.shift();
    if (!key) return;
    if (!this.textures.exists(key)) return;

    this.playFtmAnimalSpawnSfx(key);

    const index = this.ftmAnimals.length;
    const { x: targetX, y: targetY, targetH } = this.getFtmAnimalAnchorXY(index);

    const animal = this.add
      .image(0, targetY, key)
      .setOrigin(0.5, 1)
      .setScrollFactor(0)
      .setDepth(this.ftmAnimalDepthForY(targetY));

    const tex = animal.texture.getSourceImage() as { width?: number; height?: number };
    const srcW = tex?.width ?? 1;
    const srcH = tex?.height ?? 1;
    const w = (targetH / srcH) * srcW;
    animal.setDisplaySize(w, targetH);
    animal.x = -w - 20;
    animal.setData("idx", index);
    this.ftmAnimals.push(animal);

    const runDuration = FTM_ANIMAL_RUN_IN_DURATION_MS + Phaser.Math.Between(-120, 120);
    // กระโดดเป็นจังหวะวิ่ง (gallop) — เด้งขึ้น-ลงเป็นรอบสั้นๆ ระหว่างวิ่ง
    const gallopAmp = targetH * 0.16;
    const gallopPeriod = 240 + Phaser.Math.Between(-30, 30);
    const gallop = this.tweens.add({
      targets: animal,
      y: targetY - gallopAmp,
      duration: gallopPeriod,
      ease: "Sine.easeOut",
      yoyo: true,
      repeat: -1,
    });
    // เอียงตัวเบาๆ ตามจังหวะวิ่ง
    animal.setAngle(-3);
    const tilt = this.tweens.add({
      targets: animal,
      angle: 3,
      duration: gallopPeriod * 2,
      ease: "Sine.easeInOut",
      yoyo: true,
      repeat: -1,
    });
    animal.setData("runGallop", gallop);
    animal.setData("runTilt", tilt);

    // ระยะ x ใช้ Sine.easeOut → ความเร็วเริ่มต้นไว แล้วค่อยๆชะลอลงเข้าหาตำแหน่งสุดท้าย ดูธรรมชาติกว่า Cubic
    this.tweens.add({
      targets: animal,
      x: targetX,
      duration: runDuration,
      ease: "Sine.easeOut",
      onComplete: () => {
        gallop.stop();
        tilt.stop();
        animal.setAngle(0);
        animal.setY(targetY);
        animal.setData("runGallop", undefined);
        animal.setData("runTilt", undefined);
        // ลงพื้นนุ่มๆ ก่อนเริ่ม bob ปกติ
        this.tweens.add({
          targets: animal,
          y: targetY + 4,
          duration: 110,
          yoyo: true,
          ease: "Sine.easeOut",
          onComplete: () => this.startFtmAnimalBob(animal),
        });
      },
    });
  }

  /** อนิเมชันเด้งขึ้น-ลงเบาๆ ขณะวิ่งตามตัวละคร */
  private startFtmAnimalBob(animal: Phaser.GameObjects.Image) {
    if (!animal.active) return;
    const baseY = animal.y;
    animal.setData("bobBaseY", baseY);
    const bobTween = this.tweens.add({
      targets: animal,
      y: baseY - 6 - Math.random() * 4,
      duration: 320 + Math.random() * 160,
      ease: "Sine.easeInOut",
      yoyo: true,
      repeat: -1,
    });
    animal.setData("bobTween", bobTween);
  }

  private stopFtmAnimalSpawnTimers() {
    if (this.ftmAnimalSpawnEvent) {
      this.ftmAnimalSpawnEvent.remove(false);
      this.ftmAnimalSpawnEvent = undefined;
    }
    if (this.ftmAnimalRespawnEvent) {
      this.ftmAnimalRespawnEvent.remove(false);
      this.ftmAnimalRespawnEvent = undefined;
    }
    if (this.ftmParallaxBurstEvent) {
      this.ftmParallaxBurstEvent.remove(false);
      this.ftmParallaxBurstEvent = undefined;
    }
    this.ftmAnimalSpawnQueue = [];
  }

  /** ตอบถูก: parallax เร็วขึ้น สัตว์ตามไม่ทันหายไปทางซ้าย แล้วสักพักวิ่งกลับมาใหม่ */
  private triggerFtmAnimalFallBehind() {
    if (!this.ftmGameplayActive) return;
    this.setParallaxGameplaySpeedExtra(FTM_PARALLAX_BURST_MUL);
    if (this.ftmParallaxBurstEvent) this.ftmParallaxBurstEvent.remove(false);
    this.ftmParallaxBurstEvent = this.time.delayedCall(FTM_PARALLAX_BURST_DURATION_MS, () => {
      this.ftmParallaxBurstEvent = undefined;
      if (this.ftmGameplayActive) {
        this.setParallaxGameplaySpeedExtra(PARALLAX_GAMEPLAY_EXTRA_AFTER_RIDER_ENTER);
      }
    });

    if (this.ftmAnimalSpawnEvent) {
      this.ftmAnimalSpawnEvent.remove(false);
      this.ftmAnimalSpawnEvent = undefined;
    }
    this.ftmAnimalSpawnQueue = [];

    const animals = [...this.ftmAnimals];
    this.ftmAnimals = [];
    animals.forEach((a, i) => {
      if (!a.active) return;
      const bob = a.getData("bobTween") as Phaser.Tweens.Tween | undefined;
      bob?.stop();
      this.tweens.killTweensOf(a);
      this.tweens.add({
        targets: a,
        x: -a.displayWidth - 60,
        alpha: 0.6,
        duration: 850 + i * 90,
        ease: "Cubic.easeIn",
        onComplete: () => a.destroy(),
      });
    });

    if (this.ftmAnimalRespawnEvent) this.ftmAnimalRespawnEvent.remove(false);
    this.ftmAnimalRespawnEvent = this.time.delayedCall(
      FTM_PARALLAX_BURST_DURATION_MS + FTM_ANIMAL_RESPAWN_DELAY_MS,
      () => {
        this.ftmAnimalRespawnEvent = undefined;
        if (!this.ftmGameplayActive) return;
        this.startFtmAnimalChase();
      }
    );
  }

  /** ตอบครบทุกข้อ: parallax เร็วแบบหน้า home + สัตว์ค่อยๆหายไป */
  private victoryFtmAnimalsExit() {
    this.stopFtmAnimalSpawnTimers();
    this.setParallaxGameplaySpeedExtra(FTM_PARALLAX_VICTORY_MUL);
    const animals = [...this.ftmAnimals];
    this.ftmAnimals = [];
    animals.forEach((a, i) => {
      if (!a.active) return;
      const bob = a.getData("bobTween") as Phaser.Tweens.Tween | undefined;
      bob?.stop();
      this.tweens.killTweensOf(a);
      this.tweens.add({
        targets: a,
        x: -a.displayWidth - 60,
        alpha: 0,
        duration: 900 + i * 80,
        ease: "Cubic.easeIn",
        onComplete: () => a.destroy(),
      });
    });
  }

  /** game over (หัวใจหมด): สัตว์วิ่งเข้าหาตัวละคร + smoke แล้วค่อยเข้า Result */
  private chaseAndSmokeFtmCharacter(onDone: () => void) {
    this.stopFtmAnimalSpawnTimers();
    const ch = this.homeCharacter;
    const safe = this.getFtmSafeArea();
    const tx = ch?.x ?? safe.x + safe.width * 0.5;
    const baseY = ch?.y ?? safe.y + safe.height * 0.65;

    const animals = [...this.ftmAnimals];
    this.ftmAnimals = [];
    if (animals.length === 0) {
      // ไม่มีสัตว์อยู่ในจอตอนนี้ — ให้สัตว์โผล่จากซ้ายแล้ววิ่งเข้าหา
      const keys = Phaser.Utils.Array.Shuffle([...FTM_ANIMAL_KEYS]).slice(0, FTM_ANIMAL_MAX_COUNT);
      keys.forEach((key, i) => {
        if (!this.textures.exists(key)) return;
        const targetH =
          this.scale.height *
          (this.mobile ? FTM_ANIMAL_HEIGHT_RATIO.mobile : FTM_ANIMAL_HEIGHT_RATIO.desktop);
        const a = this.add
          .image(-50 - i * 80, baseY, key)
          .setOrigin(0.5, 1)
          .setScrollFactor(0)
          .setDepth(this.ftmAnimalDepthForY(baseY));
        const tex = a.texture.getSourceImage() as { width?: number; height?: number };
        a.setDisplaySize((targetH / (tex?.height ?? 1)) * (tex?.width ?? 1), targetH);
        this.time.delayedCall(i * 140, () => this.playFtmAnimalSpawnSfx(key));
        animals.push(a);
      });
    }

    animals.forEach((a, i) => {
      if (!a.active) return;
      const bob = a.getData("bobTween") as Phaser.Tweens.Tween | undefined;
      bob?.stop();
      this.tweens.killTweensOf(a);
      this.tweens.add({
        targets: a,
        x: tx - 18 + i * 8,
        duration: 700 + i * 60,
        ease: "Cubic.easeIn",
        onComplete: () => {
          this.tweens.add({
            targets: a,
            alpha: 0,
            duration: 280,
            delay: 100,
            onComplete: () => a.destroy(),
          });
        },
      });
    });

    this.time.delayedCall(520, () => this.playFtmSmokeAtCharacter());
    this.time.delayedCall(FTM_GAMEOVER_OUTRO_MS, onDone);
  }

  private playFtmSmokeAtCharacter() {
    if (!this.textures.exists("ftm_smoke_sheet")) return;
    if (!this.anims.exists("ftm_smoke_anim")) {
      this.anims.create({
        key: "ftm_smoke_anim",
        frames: this.anims.generateFrameNumbers("ftm_smoke_sheet", {
          start: 0,
          end: FTM_SMOKE_FRAME_COUNT - 1,
        }),
        frameRate: 12,
        repeat: -1,
      });
    }
    const ch = this.homeCharacter;
    const safe = this.getFtmSafeArea();
    const cx = ch?.x ?? safe.x + safe.width * 0.5;
    const cy = ch?.y ?? safe.y + safe.height * 0.65;
    this.ftmSmokeSprite?.destroy();
    const sp = this.add
      .sprite(cx, cy - (ch ? ch.displayHeight * 0.42 : 0), "ftm_smoke_sheet")
      .setOrigin(0.5, 0.55)
      .setScrollFactor(0)
      .setDepth(95);
    const targetH = (ch?.displayHeight ?? 200) * 1.6;
    sp.setScale(targetH / FTM_SMOKE_FRAME_H);
    sp.play("ftm_smoke_anim");
    this.ftmSmokeSprite = sp;
  }

  private relayoutFtmAnimalsAndSmoke() {
    this.ftmAnimals.forEach((a, idx) => {
      if (!a.active) return;
      const { x: targetX, y: targetY } = this.getFtmAnimalAnchorXY(idx);
      const isAtRest = !this.tweens.isTweening(a);
      if (isAtRest) {
        a.setPosition(targetX, targetY);
        a.setData("bobBaseY", targetY);
        a.setDepth(this.ftmAnimalDepthForY(targetY));
      }
    });
    if (this.ftmSmokeSprite?.active) {
      const ch = this.homeCharacter;
      if (ch) {
        this.ftmSmokeSprite.setPosition(ch.x, ch.y - ch.displayHeight * 0.42);
        const targetH = ch.displayHeight * 1.6;
        this.ftmSmokeSprite.setScale(targetH / FTM_SMOKE_FRAME_H);
      }
    }
  }

  private destroyFtmAnimalsAndSmoke() {
    this.stopFtmAnimalSpawnTimers();
    this.ftmAnimals.forEach((a) => {
      if (a?.active) {
        this.tweens.killTweensOf(a);
        a.destroy();
      }
    });
    this.ftmAnimals = [];
    this.ftmSmokeSprite?.destroy();
    this.ftmSmokeSprite = undefined;
  }

  private playFtmAudio(url?: string) {
    if (!url) return;
    const key = this.ftmAudioByUrl.get(url);
    if (!key || !this.cache.audio.exists(key)) return;
    guardedScenePlayQuestion(this, key, 1);
  }

  /** หยุด tween volume ก่อน destroy — กัน WebAudio gain=null ตอน tween ยังรันอยู่ */
  private killFtmBgmTweens(sound?: Phaser.Sound.BaseSound) {
    if (!sound) return;
    this.tweens.killTweensOf(sound);
  }

  private destroyFtmBgmSound(sound?: Phaser.Sound.BaseSound) {
    if (!sound) return;
    this.killFtmBgmTweens(sound);
    try {
      if (sound.isPlaying) sound.stop();
    } catch {}
    try {
      sound.destroy();
    } catch {}
  }

  private fadeOutAndDestroyFtmBgm(sound: Phaser.Sound.BaseSound, fadeMs: number) {
    this.killFtmBgmTweens(sound);
    if (fadeMs <= 0 || !sound.isPlaying) {
      this.destroyFtmBgmSound(sound);
      return;
    }
    this.tweens.add({
      targets: sound,
      volume: 0,
      duration: fadeMs,
      onComplete: () => this.destroyFtmBgmSound(sound),
    });
  }

  /** เปลี่ยน BGM (fade out ของเดิม → fade in ของใหม่). ถ้าเล่นอยู่แล้วจะไม่ทำซ้ำ */
  private playFtmBgm(key: string, volume = GAME_BGM_VOLUME_FADE, fadeMs = 420) {
    if (!canPlayGameAudio("background")) {
      this.stopFtmBgm(0);
      return;
    }
    if (this.ftmBgmCurrentKey === key && this.ftmBgmCurrent?.isPlaying) return;

    const oldBgm = this.ftmBgmCurrent;
    this.ftmBgmCurrent = undefined;
    this.ftmBgmCurrentKey = undefined;
    if (oldBgm) this.fadeOutAndDestroyFtmBgm(oldBgm, fadeMs);

    if (!this.cache.audio.exists(key)) return;
    const next = this.sound.add(key, { loop: true, volume: 0 });
    next.play();
    this.ftmBgmCurrent = next;
    this.ftmBgmCurrentKey = key;
    this.tweens.add({
      targets: next,
      volume,
      duration: fadeMs,
      onComplete: () => {
        if (this.ftmBgmCurrent !== next) return;
        try {
          if (next.isPlaying) next.setVolume(volume);
        } catch {}
      },
    });
  }

  private stopFtmBgm(fadeMs = 300) {
    const old = this.ftmBgmCurrent;
    this.ftmBgmCurrent = undefined;
    this.ftmBgmCurrentKey = undefined;
    if (!old) return;
    this.fadeOutAndDestroyFtmBgm(old, fadeMs);
  }

  // ═══════════════════════════════════════════════════════════

  private async onRiderEnteredGameplay(ch?: Phaser.GameObjects.Image) {
    /** เริ่มจับเวลาเมื่อตัวละครถึงจุด */
    this.startTime = Date.now();
    this.parallaxPhase = "gameplay";
    this.setParallaxGameplaySpeedExtra(PARALLAX_GAMEPLAY_EXTRA_AFTER_RIDER_ENTER);
    this.playFtmBgm("ftm_bgm_gameplay");
    this.reportRunstateStart();
    await ensureNotoSansThaiLoopedReady();
    const ftmInfo = this.ftmPayload?.game_info;
    const name = getHudSuggestionLabel(ftmInfo?.suggestion);
    this.createFindTheMatchTopHud(name);
    if (ch?.active) {
      this.startRiderFloat(ch);
    }
    await this.loadFtmDynamicAssets();
    this.beginFtmFlow();
  }

  private getParallaxEffectiveSpeedMul(): number {
    const phaseMul =
      this.parallaxPhase === "home" ? PARALLAX_SPEED_MUL_HOME : PARALLAX_SPEED_MUL_GAMEPLAY;
    return phaseMul * this.parallaxGameplayExtraMul;
  }

  /**
   * ปรับความเร็ว parallax ระหว่างเล่นเกมเท่านั้น (คูณซ้อนกับ `PARALLAX_SPEED_MUL_GAMEPLAY` และ base แต่ละชั้น)
   * @param multiplier 1 = ตามฐาน, 0.5 = ช้าครึ่ง, 2 = เร็วสองเท่า
   */
  setParallaxGameplaySpeedExtra(multiplier: number) {
    this.parallaxGameplayExtraMul = Phaser.Math.Clamp(
      multiplier,
      PARALLAX_GAMEPLAY_EXTRA_MIN,
      PARALLAX_GAMEPLAY_EXTRA_MAX
    );
  }

  update(_time: number, delta: number) {
    if (this.parallaxActive) {
      this.updateParallax(delta);
    }
    if (this.ftmGameplayActive) {
      this.syncFtmDropBoxToCharacter();
    }
  }

  private getFtmSafeArea(): Phaser.Geom.Rectangle {
    return this.getSafeAreaRect(this.mobile ? 9 / 16 : 16 / 9);
  }

  private getRiderScreenAnchor(): { x: number; y: number; fgH: number } {
    const safe = this.getFtmSafeArea();
    const width = safe.width;
    const height = safe.height;
    const fgH = height * 0.2;
    const lift = this.mobile ? FTM_RIDER_LIFT_PX.mobile : FTM_RIDER_LIFT_PX.desktop;
    return {
      x: safe.x + width * RIDER_HOME_X_RATIO,
      y: safe.y + height - fgH - height * RIDER_HOME_CLEARANCE_ABOVE_FG_RATIO - lift,
      fgH,
    };
  }

  private applyRiderTextureAndSize(
    ch: Phaser.GameObjects.Image,
    textureKey: string,
    heightRatio: number
  ) {
    ch.setTexture(textureKey);
    const tex = ch.texture.getSourceImage() as { width?: number; height?: number };
    const srcH = tex?.height ?? 1;
    const targetH = this.getFtmSafeArea().height * heightRatio;
    ch.setDisplaySize((targetH / srcH) * (tex?.width ?? 1), targetH);
  }

  private beginGameplayAfterHome() {
    this.input.enabled = true;
    const ch = this.homeCharacter;
    this.stopRiderFloat();
    if (ch) this.tweens.killTweensOf(ch);

    const playKey = "ftm_char_idle_play";

    if (!ch?.active || !this.textures.exists(playKey)) {
      void this.onRiderEnteredGameplay(undefined);
      return;
    }

    const heightRatio = this.mobile ? RIDER_HOME_HEIGHT_RATIO_MOBILE : RIDER_HOME_HEIGHT_RATIO_DESKTOP;
    const { x: targetX, y: targetY } = this.getRiderScreenAnchor();
    const width = this.getFtmSafeArea().width;

    ch.setVisible(true);
    ch.setAlpha(1);
    ch.setAngle(0);
    this.applyRiderTextureAndSize(ch, "ftm_char_idle_home", heightRatio);

    this.tweens.add({
      targets: ch,
      alpha: 0,
      x: ch.x + width * 0.35,
      duration: RIDER_EXIT_FORWARD_DURATION_MS,
      ease: "Cubic.easeIn",
      onComplete: () => {
        this.applyRiderTextureAndSize(ch, playKey, heightRatio);
        const startX = Math.min(-ch.displayWidth * 0.55, -width * 0.08);
        ch.setPosition(startX, targetY);
        ch.setAlpha(1);
        ch.setVisible(true);

        this.tweens.add({
          targets: ch,
          x: targetX,
          duration: RIDER_ENTER_FROM_LEFT_DURATION_MS,
          ease: "Cubic.easeOut",
          onComplete: () => {
            void this.onRiderEnteredGameplay(ch);
          },
        });
      },
    });
  }

  private buildSkyGradient() {
    this.destroySkyGradient();
    const { width, height } = this.scale;
    const texW = Math.max(2, Math.floor(width));
    const texH = Math.max(2, Math.floor(height));
    const canvas = document.createElement("canvas");
    canvas.width = texW;
    canvas.height = texH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const grd = ctx.createLinearGradient(0, 0, 0, texH);
    grd.addColorStop(0, "#AFF3EA");
    grd.addColorStop(1, "#FFFFFF");
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, texW, texH);

    if (this.textures.exists(SKY_GRADIENT_KEY)) {
      this.textures.remove(SKY_GRADIENT_KEY);
    }
    this.textures.addCanvas(SKY_GRADIENT_KEY, canvas);
    this.skyGradientImage = this.add
      .image(0, 0, SKY_GRADIENT_KEY)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(-50)
      .setDisplaySize(width, height);
  }

  private destroySkyGradient() {
    this.skyGradientImage?.destroy();
    this.skyGradientImage = undefined;
    if (this.textures.exists(SKY_GRADIENT_KEY)) {
      this.textures.remove(SKY_GRADIENT_KEY);
    }
  }

  private buildParallaxWorld() {
    this.destroyParallaxWorld();
    const { width, height: h } = this.scale;

    const cloudCount = Math.min(42, Math.max(16, Math.round(width / 28)));
    for (let i = 0; i < cloudCount; i += 1) {
      const img = this.add
        .image(
          Phaser.Math.Between(-80, width + 120),
          Phaser.Math.Between(h * 0.03, h * 0.52),
          "ftm_bg_cloud"
        )
        .setScrollFactor(0)
        .setDepth(Phaser.Math.Between(4, 12))
        .setAlpha(Phaser.Math.FloatBetween(0.45, 0.95));
      const sc = Phaser.Math.FloatBetween(0.32, 1.12);
      img.setScale(sc);
      if (Math.random() < 0.45) img.setFlipX(true);
      this.parallaxClouds.push({
        img,
        baseSpeedPxPerSec: Phaser.Math.FloatBetween(FTM_PARALLAX_CLOUD_SPEED_MIN, FTM_PARALLAX_CLOUD_SPEED_MAX),
      });
    }

    /** สัดส่วนและความเร็วชั้นเดียวกับ flappy-bird/buildParallaxWorld */
    const mountainH = h * 0.8;
    const mountainBottomY = h * 0.65;

    const wallH = h * 0.6;
    const wallBottomY = h * 0.65;

    const floorH = h * 0.42;
    const floorBottomY = h*0.99;

    const treeCellW = this.computeFtmWallGateCellW(wallH);

    this.pushTwoTileTrack(() => this.buildRandomTreesCell(mountainH, treeCellW), FTM_PARALLAX_TREE_BASE_SPEED, 14, mountainBottomY);
    this.pushTwoTileTrack(() => this.buildFtmWallGateCell(wallH), FTM_PARALLAX_WALL_BASE_SPEED, 24, wallBottomY);
    this.pushTwoTileTrack(() => this.buildMirroredPairCell("ftm_bg_floor", floorH), FTM_PARALLAX_FLOOR_BASE_SPEED, 36, floorBottomY);
  }

  /** ชั้นต้นไม้: แนวลึกเหมือน mountain flappy — สูงใกล้ mountainH แต่ก้นแนบ mountainBottomY */
  private buildRandomTreesCell(
    mountainH: number,
    treeCellWidth: number
  ): { container: Phaser.GameObjects.Container; cellW: number } {
    const c = this.add.container(0, 0);
    const count = Phaser.Math.Between(2, 5);
    const treeH = mountainH * 0.68;
    for (let i = 0; i < count; i += 1) {
      const key = Math.random() < 0.5 ? "ftm_tree_a" : "ftm_tree_b";
      const tex = this.textures.get(key).getSourceImage() as { width: number; height: number };
      const th = treeH;
      const tw = th * (tex.width / tex.height);
      const margin = tw * 0.5 + 8;
      const x = Phaser.Math.FloatBetween(margin, Math.max(margin + 4, treeCellWidth - margin));
      const img = this.add.image(x, 0, key).setOrigin(0.5, 1).setDisplaySize(tw, th);
      c.add(img);
    }
    return { container: c, cellW: treeCellWidth };
  }

  /** wall1 + wall2 ชิดกัน ไม่ flip — logic ขนาดเดียวกับ flappy buildWallGateCell */
  private buildFtmWallGateCell(displayH: number): { container: Phaser.GameObjects.Container; cellW: number } {
    const { width } = this.scale;
    const t1 = this.textures.get("ftm_bg_wall1").getSourceImage() as { width: number; height: number };
    const t2 = this.textures.get("ftm_bg_wall2").getSourceImage() as { width: number; height: number };
    let tw1 = displayH * (t1.width / t1.height);
    let tw2 = displayH * (t2.width / t2.height);
    const minSum = width * 0.58;
    const sum = tw1 + tw2;
    if (sum < minSum) {
      const s = minSum / sum;
      tw1 *= s;
      tw2 *= s;
    }
    const c = this.add.container(0, 0);
    const w1 = this.add.image(0, 0, "ftm_bg_wall1").setOrigin(0, 1).setDisplaySize(tw1, displayH);
    const w2 = this.add
      .image(tw1 - PARALLAX_OVERLAP_PX, 0, "ftm_bg_wall2")
      .setOrigin(0, 1)
      .setDisplaySize(tw2, displayH);
    c.add([w1, w2]);
    return { container: c, cellW: tw1 + tw2 - PARALLAX_OVERLAP_PX };
  }

  private computeFtmWallGateCellW(displayH: number): number {
    const { width } = this.scale;
    const t1 = this.textures.get("ftm_bg_wall1").getSourceImage() as { width: number; height: number };
    const t2 = this.textures.get("ftm_bg_wall2").getSourceImage() as { width: number; height: number };
    let tw1 = displayH * (t1.width / t1.height);
    let tw2 = displayH * (t2.width / t2.height);
    const minSum = width * 0.58;
    const sum = tw1 + tw2;
    if (sum < minSum) {
      const s = minSum / sum;
      tw1 *= s;
      tw2 *= s;
    }
    return tw1 + tw2 - PARALLAX_OVERLAP_PX;
  }

  /** พื้นเลื่อนแบบ flappy: ครึ่งซ้าย + ครึ่งขวา flipX ต่อยาว */
  private buildMirroredPairCell(
    key: string,
    displayH: number
  ): { container: Phaser.GameObjects.Container; cellW: number } {
    const { width } = this.scale;
    const tex = this.textures.get(key).getSourceImage() as { width: number; height: number };
    let tw = displayH * (tex.width / tex.height);
    const minHalfW = width * 0.52;
    tw = Math.max(tw, minHalfW);
    const c = this.add.container(0, 0);
    const left = this.add.image(0, 0, key).setOrigin(0, 1).setDisplaySize(tw, displayH);
    const right = this.add
      .image(tw - PARALLAX_OVERLAP_PX, 0, key)
      .setOrigin(0, 1)
      .setDisplaySize(tw, displayH)
      .setFlipX(true);
    c.add([left, right]);
    return { container: c, cellW: tw * 2 - PARALLAX_OVERLAP_PX };
  }

  private pushTwoTileTrack(
    buildCell: () => { container: Phaser.GameObjects.Container; cellW: number },
    baseSpeedPxPerSec: number,
    depth: number,
    worldBottomY: number
  ) {
    const ca = buildCell();
    const cb = buildCell();
    ca.container.setScrollFactor(0).setDepth(depth);
    cb.container.setScrollFactor(0).setDepth(depth);
    ca.container.setPosition(0, worldBottomY);
    cb.container.setPosition(ca.cellW - PARALLAX_OVERLAP_PX, worldBottomY);
    this.parallaxTracks.push({
      tileA: ca.container,
      tileB: cb.container,
      cellW: ca.cellW,
      baseSpeedPxPerSec,
    });
  }

  private updateParallax(delta: number) {
    const dt = delta / 1000;
    const { width, height } = this.scale;
    const speedMul = this.getParallaxEffectiveSpeedMul();

    for (const c of this.parallaxClouds) {
      c.img.x -= c.baseSpeedPxPerSec * speedMul * dt;
      if (c.img.x < -c.img.displayWidth - 40) {
        c.img.x = width + Phaser.Math.Between(30, 200);
        c.img.y = Phaser.Math.Between(height * 0.04, height * 0.48);
        c.img.setAlpha(Phaser.Math.FloatBetween(0.42, 0.92));
        c.baseSpeedPxPerSec = Phaser.Math.FloatBetween(
          FTM_PARALLAX_CLOUD_SPEED_MIN,
          FTM_PARALLAX_CLOUD_SPEED_MAX
        );
      }
    }

    for (const track of this.parallaxTracks) {
      const dx = track.baseSpeedPxPerSec * speedMul * dt;
      track.tileA.x -= dx;
      track.tileB.x -= dx;
      const w = track.cellW;
      if (track.tileA.x <= -w) {
        track.tileA.x = track.tileB.x + w - PARALLAX_OVERLAP_PX;
      }
      if (track.tileB.x <= -w) {
        track.tileB.x = track.tileA.x + w - PARALLAX_OVERLAP_PX;
      }
    }
  }

  private destroyParallaxWorld() {
    this.parallaxClouds.forEach((c) => c.img.destroy());
    this.parallaxClouds = [];
    this.parallaxTracks.forEach((t) => {
      t.tileA.destroy(true);
      t.tileB.destroy(true);
    });
    this.parallaxTracks = [];
  }

  /** foreground นิ่ง — ด้านหน้าสุดของฉากก่อน UI หน้าแรก */
  private buildForegroundStatic() {
    this.foregroundStatic?.destroy();
    const safe = this.getFtmSafeArea();
    const width = safe.width;
    const height = safe.height;
    const tex = this.textures.get("ftm_bg_foreground").getSourceImage() as { width: number; height: number };
    const srcW = tex?.width ?? 1;
    const srcH = tex?.height ?? 1;
    const fgH = height * 0.45;
    const targetW = (fgH / srcH) * srcW;
    const x = safe.x + width / 2;
    // มือถือ: ขยับ foreground ขึ้น (ค่าลบ = สูงขึ้น)
    const yOffset = this.mobile ? FTM_FOREGROUND_Y_OFFSET.mobile : FTM_FOREGROUND_Y_OFFSET.desktop;
    const y = safe.y + height + yOffset;
    this.foregroundStatic = this.add
      .image(x, y, "ftm_bg_foreground")
      .setScrollFactor(0)
      .setDepth(88)
      .setDisplaySize(targetW, fgH);
  }

  private spawnHomeCharacter() {
    this.homeCharacter?.destroy();
    const { height } = this.getFtmSafeArea();
    const { x, y } = this.getRiderScreenAnchor();
    const ch = this.add
      .image(x, y, "ftm_char_idle_home")
      .setOrigin(0.5, 1)
      .setDepth(82)
      .setScrollFactor(0);
    const tex = ch.texture.getSourceImage() as { width?: number; height?: number };
    const srcH = tex?.height ?? 1;
    const targetH = height * (this.mobile ? RIDER_HOME_HEIGHT_RATIO_MOBILE : RIDER_HOME_HEIGHT_RATIO_DESKTOP);
    ch.setDisplaySize((targetH / srcH) * (tex?.width ?? 1), targetH);
    this.homeCharacter = ch;
    this.startRiderFloat(ch);
  }

  private relayoutHomeCharacter() {
    const ch = this.homeCharacter;
    if (!ch?.active) return;
    const { x: baseX, y: baseY } = this.getRiderScreenAnchor();
    ch.setPosition(baseX, baseY);
    this.stopRiderFloat();
    this.startRiderFloat(ch);
  }

  /** ขึ้นลงอย่างเดียว (ไม่เอียง / ไม่ขยับแกน x) — ปรับระยะที่ RIDER_BOB_* ด้านบนไฟล์ */
  private startRiderFloat(character: Phaser.GameObjects.Image) {
    this.stopRiderFloat();
    character.setAngle(0);
    const baseY = character.y;
    const bob = this.tweens.add({
      targets: character,
      y: baseY - RIDER_BOB_OFFSET_PX,
      duration: RIDER_BOB_DURATION_MS,
      ease: "Sine.easeInOut",
      yoyo: true,
      repeat: -1,
    });
    this.riderFloatTweens.push(bob);
  }

  private stopRiderFloat() {
    this.riderFloatTweens.forEach((t) => t.stop());
    this.riderFloatTweens = [];
  }

  protected onGameAudioSettingsChanged(): void {
    const key = this.ftmBgmCurrentKey;
    if (!key) return;
    this.stopFtmBgm(0);
    if (canPlayGameAudio("background")) this.playFtmBgm(key);
  }

  private playSfx(key: string, volume = 1) {
    guardedScenePlay(this, key, volume);
  }

  private openHowToPopup() {
    this.destroyHowToPopup();
    const restoreSceneInputEnabled = this.input.enabled;
    const homeScene = this.scene.get("HomeScene");
    const restoreHomeInputEnabled = homeScene?.input?.enabled ?? false;
    this.input.enabled = true;
    if (homeScene?.input) {
      homeScene.input.enabled = false;
    }
    this.scene.bringToTop(this.scene.key);

    const { width, height } = this.scale;
    const howToKey = this.mobile ? "ftm_howto_mobile" : "ftm_howto_desktop";
    if (!this.textures.exists(howToKey)) {
      this.input.enabled = restoreSceneInputEnabled;
      if (homeScene?.input) homeScene.input.enabled = restoreHomeInputEnabled;
      return;
    }
    this.textures.get(howToKey).setFilter(Phaser.Textures.FilterMode.LINEAR);

    const overlay = this.add
      .rectangle(width / 2, height / 2, width, height, 0x000000, 0.55)
      .setScrollFactor(0)
      .setDepth(3500);

    const source = this.textures.get(howToKey).getSourceImage() as { width?: number; height?: number };
    const srcW = source?.width ?? 1;
    const srcH = source?.height ?? 1;
    const imageMaxW = this.mobile ? width * 0.96 : width * 0.8;
    const imageMaxH = this.mobile ? height * 0.78 : height * 0.66;
    const imageScale = Math.min(imageMaxW / srcW, imageMaxH / srcH);
    const howToW = Math.max(1, srcW * imageScale);
    const howToH = Math.max(1, srcH * imageScale);
    const howToY = height * (this.mobile ? 0.44 : 0.42);
    const howToImage = this.add.image(width / 2, howToY, howToKey).setScrollFactor(0).setDepth(3501);
    howToImage.setDisplaySize(howToW, howToH);

    const startKey = "ftm_btn_start";
    if (!this.textures.exists(startKey)) {
      this.input.enabled = restoreSceneInputEnabled;
      if (homeScene?.input) homeScene.input.enabled = restoreHomeInputEnabled;
      overlay.destroy();
      howToImage.destroy();
      return;
    }

    const ui = this.savedHomeData?.ui;
    const startTargetW = ui?.startButtonWidth ?? (this.mobile ? 220 : 280);
    const startY = Math.min(height - 36, howToY + howToH / 2 + (this.mobile ? 32 : 48));
    const startButton = this.add
      .image(width / 2, startY, startKey)
      .setScrollFactor(0)
      .setDepth(3502)
      .setInteractive({ useHandCursor: true });
    this.applyHowtoStartButtonSize(startButton, startTargetW);
    this.attachHowtoStartButtonHover(startButton);

    const startGameFromHowto = () => {
      this.playSfx("sfx_click_default", 1);
      this.destroyHowToPopup({ preserveInputForImmediateStart: true });
      this.events.emit("home-dismissed-for-play");
      if (this.scene.isActive("HomeScene")) {
        const hs = this.scene.get("HomeScene");
        hs.events.emit("home-action", { action: "start", gameKey: this.scene.key } as HomeActionPayload);
        this.scene.stop("HomeScene");
      }
    };

    startButton.once("pointerdown", startGameFromHowto);

    this.tutorialPopup = {
      overlay,
      howToImage,
      startButton,
      restoreSceneInputEnabled,
      restoreHomeInputEnabled,
    };
  }

  private applyHowtoStartButtonSize(button: Phaser.GameObjects.Image, targetWidth: number) {
    const tex = button.texture.getSourceImage() as HTMLImageElement;
    const texW = tex?.naturalWidth || tex?.width || 1;
    const texH = tex?.naturalHeight || tex?.height || 1;
    const ratio = texW / texH;
    button.setDisplaySize(targetWidth, targetWidth / ratio);
  }

  // ── ครูผู้ช่วย (UI อิง flappy-bird) ─────────────────────────────

  private createFtmTeacherUiIfNeeded() {
    if (this.teacherHintUI) return;

    this.teacherHintUI = new TeacherHintUI(this, {
      mobile: this.mobile,
      depth: 2600,
      messageDepth: 2650,
      onNotificationSfx: () => this.playFtmNotifySfx(),
      smallHeightRatioMobile: 0.18,
      feetLiftPxMobile: 6,
      mobileFeetYOffsetPx: 22,
    });
    this.teacherHintUI.create("standby", true);
  }

  private destroyFtmTeacherAndMessage() {
    this.teacherHintUI?.destroy();
    this.teacherHintUI = undefined;
  }

  private ftmShowTeacherMessage(text: string, durationMs = 2800, teacherState?: "point" | "clap") {
    this.createFtmTeacherUiIfNeeded();
    const clean = (text ?? "").trim();
    if (!clean) return;
    this.teacherHintUI?.present({
      text: clean,
      durationMs,
      teacherState,
      resetHintBeforeShow: true,
    });
  }

  private hideFtmTeacherMessage() {
    this.teacherHintUI?.hide();
  }

  private playFtmNotifySfx() {
    guardedScenePlay(this, "sfx_notification_message", 0.55, "assistant_voice");
  }

  private showFtmTeacherWrongMessage() {
    if (!this.ftmGameplayActive) return;
    this.createFtmTeacherUiIfNeeded();
    const line = Phaser.Utils.Array.GetRandom([...FTM_TEACHER_WRONG_LINES]);
    this.ftmShowTeacherMessage(line, 2600, "point");
  }

  private showFtmTeacherCorrectPraise() {
    if (!this.ftmGameplayActive) return;
    this.createFtmTeacherUiIfNeeded();
    const line = Phaser.Utils.Array.GetRandom([...FTM_TEACHER_CORRECT_LINES]);
    this.ftmShowTeacherMessage(line, 2600, "clap");
  }

  private showFtmQuestionHint(q: FtmQuestion) {
    this.createFtmTeacherUiIfNeeded();
    const hint = (q.hint ?? "").trim();
    const imgKey = this.getFtmTexKey(q.image_hint);
    const imgReady = !!(imgKey && this.textures.exists(imgKey));
    if (!hint && !imgReady) return;

    this.teacherHintUI?.presentHint({
      text: hint,
      hintTextureKey: imgReady ? imgKey : undefined,
      durationMs: 5200,
      teacherState: "point",
    });
  }


  private attachHowtoStartButtonHover(button: Phaser.GameObjects.Image) {
    const baseScaleX = button.scaleX;
    const baseScaleY = button.scaleY;
    const animateScale = (scaleFactor: number) => {
      this.tweens.killTweensOf(button);
      this.tweens.add({
        targets: button,
        scaleX: baseScaleX * scaleFactor,
        scaleY: baseScaleY * scaleFactor,
        duration: 120,
        ease: "Sine.easeOut",
      });
    };
    button.on("pointerover", () => {
      animateScale(1.05);
      button.setTint(0xf2f2f2);
    });
    button.on("pointerout", () => {
      animateScale(1);
      button.clearTint();
    });
    button.on("pointerdown", () => animateScale(0.98));
    button.on("pointerup", () => animateScale(1.05));
  }

  private destroyHowToPopup(options?: { preserveInputForImmediateStart?: boolean }) {
    const popup = this.tutorialPopup;
    this.tutorialPopup = undefined;
    popup?.overlay.destroy();
    popup?.howToImage.destroy();
    popup?.startButton.destroy();
    if (popup && !options?.preserveInputForImmediateStart) {
      this.input.enabled = popup.restoreSceneInputEnabled;
      const homeScene = this.scene.get("HomeScene");
      if (homeScene?.input && this.scene.isActive("HomeScene")) {
        homeScene.input.enabled = popup.restoreHomeInputEnabled;
      }
    }
  }
}

