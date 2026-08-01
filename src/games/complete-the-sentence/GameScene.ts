import Phaser from "phaser";
import { API_BASE_URL } from "../../core/api";
import { BaseGameScene } from "../../core/scenes/BaseGameScene";
import {
  getGameHudPillSlots,
  getGameHudRowMetrics,
  getHudTimeIconSize,
  hasHudCenterLabel,
  getHudSuggestionLabel,
  HUD_HOURGLASS_TEXTURE_KEY,
  HUD_LABEL_COLOR,
  HUD_VALUE_COLOR,
  HUD_VOLUME_TEXTURE_KEY,
  HUD_VOLUME_ASSET_PATH,
  layoutPhaserHeartsPill,
  layoutPhaserHudSuggestion,
  layoutPhaserLabelValuePill,
  layoutPhaserTimeValuePill,
  getHudCenterTextFont,
  preloadHudAssets,
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
import {
  canPlayGameAudio,
  GAME_BGM_VOLUME_END,
  GAME_BGM_VOLUME_FADE,
  guardedScenePlay,
  guardedScenePlayChoice,
  guardedScenePlayQuestion,
} from "../../core/audio/sceneAudio";
import { createHudScaleCtx } from "../../utils/desktopUiScale";
import {
  CHOCIE_CHOICE_TUNING,
  chocieThaiGameTextStyle,
  type ChocieChoiceOverlayLayout,
  computeChocieChoiceTextSoundLayout,
  getChocieInnerBottom,
  getChocieInnerCenterY,
  getChocieInnerTop,
  getChocieInnerWidth,
  resolveChocieChoiceTextMetrics,
} from "../../utils/chocieChoiceLayout";
import { isMobileLayout } from "../../utils/device";
import {
  isShortMobileViewport,
  isTinyMobileViewport,
  mobileCompactPx,
} from "../../utils/mobileLayout";
import { ensureNotoSansThaiLoopedReady } from "../../utils/notoThaiFont";
import {
  drawQuestionMediaFrameBox,
  drawQuestionMediaOverlayTextPill,
  fitQuestionMediaContainSize,
  getQuestionMediaCardFrameSize,
} from "../../utils/questionHudMedia";
import { createThaiTextElement, createThaiTextSpan, estimateThaiTextLineCount } from "../../utils/thaiText";

type CtsWrongAnswerItem = {
  text: string;
  sound?: string | null;
  image?: string | null;
};

type CtsQuestionAnswerPart = {
  word?: string | null;
  word_sound?: string | null;
  answer?: string | null;
  answer_sound?: string | null;
  answer_image?: string | null;
  wrong_answer?: CtsWrongAnswerItem[] | string[] | null;
};

type CtsChoiceOption = {
  text: string;
  sound?: string | null;
  image?: string | null;
};

type CtsQuestion = {
  id: number;
  no: number;
  question_answer: CtsQuestionAnswerPart[];
  hint?: string | null;
  sound_hint?: string | null;
  image_hint?: string | null;
  sound_question_answer?: string | null;
  image_question_answer?: string | null;
};

type CtsPayload = {
  game_info: {
    exercise_name?: string;
    suggestion?: string | null;
    uuid?: string;
  };
  questions: CtsQuestion[];
};

type BlankSlot = {
  index: number;
  correctAnswer: string;
  zone: Phaser.GameObjects.Container;
  /** drop zone — อย่า setInteractive บน zone (container) เพราะทำให้ hitAreaCallback พัง */
  dropZone: Phaser.GameObjects.Zone;
  underline: Phaser.GameObjects.Graphics;
  hitW: number;
  hitH: number;
  sentenceFontPx: number;
  filledLabel?: Phaser.GameObjects.DOMElement;
  filled: boolean;
};

type WordChip = {
  text: string;
  container: Phaser.GameObjects.Container;
  homeX: number;
  homeY: number;
  chipH: number;
  hasImage: boolean;
  used: boolean;
  /** จุดที่จับเมื่อลาก (เทียบกับศูนย์กลางชิป ใน world space) */
  dragGrabOffsetX: number;
  dragGrabOffsetY: number;
};

type ChoiceLayoutCache = {
  horizontal: boolean;
  chipW: number;
  chipGap: number;
  viewW: number;
  viewH: number;
  choiceW: number;
  choiceH: number;
  mobile: boolean;
};

const MAX_LIVES = 3;
const SCORE_PER_BLANK = 1;
/** สีพื้นหลังสำรอง — กันจอดำก่อน JPEG decode / ระหว่างโหลด */
const CTS_SCENE_BG = 0xf6edd8;
const CTS_TEACHER_PRAISE = ["สุดยอดเลย", "เก่งมากๆ", "ทำได้ดีมาก"] as const;

type GameplayPrepareState = "ok" | "no-questions" | "data-error";

/** ข้อความครูช่วยเหลือ — แก้ที่บล็อกนี้ */
const CTS_TEACHER_COPY = {
  introDesktop: "ลากคำตอบที่อยู่ด้านขวามือ ไปใส่ที่ช่องว่างด้านซ้ายมือ",
  introMobile: "เลือกคำตอบจากด้านล่างไปวางที่ด้านบน",
  scrollDesktop: "ลองใช้เม้าส์ลากตัวเลือกขึ้นลง เพื่อหาคำที่ถูกต้องดูสิ",
  scrollMobile: "ลองใช้นิ้วลากตัวเลือกซ้ายขวา เพื่อหาคำที่ถูกต้องดูสิ",
  idlePool: ["เวลาผ่านไปนานแล้วนะ", "ยากมั้ยจ๊ะ", "จะตอบได้ยังเอ่ย!"] as const,
  introDurationMs: 4800,
  scrollHintDurationMs: 60000,
  scrollHintRepeatMs: 8000,
  idleNudgeDelayMs: 20000,
  idleNudgeDurationMs: 4200,
} as const;

const CTS_FX = {
  depth: 180,
  sentenceBlinkRepeats: 3,
  sentenceBlinkDurationMs: 220,
  /** ขนาดดาว + วงแสง (1.5 = ใหญ่ขึ้น 50%) */
  starScale: 5,
} as const;

type CtsTeacherMessageKind = "intro" | "question-hint" | "scroll-hint" | "idle" | "normal";

/**
 * ปรับขนาดตัวอักษรทั้งเกม — แก้ที่บล็อกนี้ที่เดียว
 * mobile = มือถือ, desktop = จอใหญ่ (HUD desktop จะผ่าน ui.px() อีกชั้น)
 */
const CTS_FONT = {
  hud: {
    labelMobile: 16,
    labelDesktop: 22,
    digitsMobile: 24,
    digitsDesktop: 32,
    titleMobile: 17,
    titleDesktop: 24,
    titleWrapPadMobile: 24,
    titleWrapPadDesktop: 32,
  },
  gameplay: {
    /** ประโยคบนกระดาน (คำ + เลขข้อ) */
    sentenceMobile: 22,
    sentenceDesktop: 50,
    /** ชิปคำตอบที่ลาก */
    chipMobile: 20,
    chipDesktop: 40,
    /** คำที่เติมในช่องว่างแล้ว */
    filledMobile: 20,
    filledDesktop: 50,
    /** ขั้นต่ำเมื่อข้อความยาวเกินกรอบ chip */
    chipMinPx: 12,
  },
  teacher: {
    bubbleTextMobile: 15,
    bubbleTextDesktop: 17,
    bubbleHintWithImageMobile: 15,
    bubbleHintWithImageDesktop: 17,
    minFontPx: 13,
  },
  error: {
    mobile: 28,
    desktop: 36,
  },
} as const;

/** กรอบชิปคำตอบ (ลาก) — ระยะห่างระหว่างชิป + สัดส่วนความกว้างในโซนตัวเลือก */
const CTS_CHIP = {
  gapMobile: 14,
  gapDesktop: 20,
  /** ระยะเพิ่มเมื่อชิปมีรูป (pill ล้นลงล่าง + การ์ดสูงกว่า) */
  imageExtraGapMobile: 12,
  imageExtraGapDesktop: 26,
  maxWidthRatioMobile: 0.82,
  /** จำกัดความกว้างการ์ด — ไม่ยืดเต็มคอลัมน์ (ตาม mockup) */
  maxWidthRatioDesktop: 0.78,
} as const;

/** การ์ดตัวเลือก — chocie_bg แคบ (330×122) */
const CTS_CHOICE_CARD = {
  mobile: {
    ...CHOCIE_CHOICE_TUNING.mobile,
    wMax: 200,
    labelBoxTopTrim: 10,
    labelBoxBottomTrim: 14,
    imageCardH: 112,
    imageFrameW: 112,
    imageFrameGap: 10,
    speakerSize: 34,
    /** เลื่อนข้อความบนการ์ดที่มีรูปขึ้น (mobile) — ยิ่งมากยิ่งสูง กันทับ mask */
    imageTextLiftMobile: 16,
    /** กว้าง pill ข้อความเท่ากรอบรูปบน mobile */
    imageTextFullWidthMobile: true,
    imageTextBaseFontMobile: 22,
    imageTextMaxFontMobile: 34,
    imageTextPillHMobile: 38,
  },
  desktop: {
    ...CHOCIE_CHOICE_TUNING.desktop,
    wMax: 220,
    labelBoxTopTrim: 12,
    labelBoxBottomTrim: 16,
    imageCardH: 160,
    imageFrameW: 124,
    imageFrameGap: 12,
    speakerSize: 40,
  },
} as const;

type CtsChoiceFrameTc = {
  labelBoxTopTrim: number;
  labelBoxBottomTrim: number;
  imageFrameW: number;
  imageFrameGap: number;
  imageTextLiftMobile?: number;
  imageTextFullWidthMobile?: boolean;
  imageTextBaseFontMobile?: number;
  imageTextMaxFontMobile?: number;
  imageTextPillHMobile?: number;
};

function computeCtsChoiceCardHeight(cardW: number, bgNativeW: number, bgNativeH: number): number {
  return Math.ceil(bgNativeH * (cardW / Math.max(1, bgNativeW)));
}

/** layout รูปบน + ข้อความล่างใน chocie_bg — ใช้เฉพาะ complete-the-sentence */
function resolveCtsChoiceImageFrameLayout(
  bH: number,
  bW: number,
  tc: CtsChoiceFrameTc,
  mobile: boolean,
  hasText: boolean,
  hasSound: boolean,
  speakerSize: number
): {
  frameW: number;
  frameH: number;
  frameCenterY: number;
  frameBottom: number;
  frameLeft: number;
  frameRight: number;
  textCenterY?: number;
} {
  const boxBottom = getChocieInnerBottom(bH, tc.labelBoxBottomTrim);
  const boxTop = getChocieInnerTop(bH, tc.labelBoxTopTrim);
  const textBarH = mobile ? 30 : 36;
  const imageTextGap = tc.imageFrameGap;
  const topPad = mobile ? 8 : 10;

  if (!hasText) {
    const innerH = boxBottom - boxTop;
    const frameH = Math.min(tc.imageFrameW, bW * 0.76, innerH * 0.82);
    const frameCenterY = (boxTop + boxBottom) / 2;
    const frameBottom = frameCenterY + frameH / 2;
    return {
      frameW: frameH,
      frameH,
      frameCenterY,
      frameBottom,
      frameLeft: -frameH / 2,
      frameRight: frameH / 2,
    };
  }

  const chalkBottomY = bH / 2;
  const textLift = mobile ? (tc.imageTextLiftMobile ?? 0) : 0;
  const textCenterY = chalkBottomY - (mobile ? 6 : 8) - textLift;
  const frameBottom = textCenterY - imageTextGap - textBarH / 2;

  const imageZoneTop = boxTop + topPad;
  const imageZoneH = Math.max(0, frameBottom - imageZoneTop);
  const frameH = Math.max(1, imageZoneH);
  let frameW = Math.min(bW * 0.86, frameH);
  if (mobile) {
    frameW = Math.min(bW * 0.92, Math.max(frameW, bW * 0.84));
  }
  const frameCenterY = imageZoneTop + frameH / 2;

  return {
    frameW,
    frameH,
    frameCenterY,
    frameBottom,
    frameLeft: -frameW / 2,
    frameRight: frameW / 2,
    textCenterY,
  };
}

function computeCtsChoiceTextOverlayLayout(
  textCenterY: number,
  speakerSize: number,
  mobile: boolean,
  hasSound: boolean,
  pillW: number,
  speakerPillOverlap: number,
  pillHOverride?: number
): ChocieChoiceOverlayLayout {
  const pillH = pillHOverride ?? (mobile ? 30 : 36);
  if (hasSound) {
    return computeChocieChoiceTextSoundLayout(
      pillW,
      pillH,
      speakerSize,
      textCenterY,
      speakerPillOverlap
    );
  }

  return {
    speakerX: 0,
    speakerY: 0,
    speakerSize: 0,
    pillLeft: -pillW / 2,
    pillTop: textCenterY - pillH / 2,
    pillW,
    pillH,
    textCenterX: 0,
    textCenterY,
  };
}

function getCtsChoiceStackGap(
  chip: WordChip,
  nextChip: WordChip | undefined,
  baseGap: number,
  mobile: boolean
): number {
  const extra =
    chip.hasImage || nextChip?.hasImage ?
      mobile ? CTS_CHIP.imageExtraGapMobile : CTS_CHIP.imageExtraGapDesktop
    : 0;
  return baseGap + extra;
}

const CTS_CHOICE_SCROLL = {
  wheelFactor: 0.85,
  /** ปัดเลื่อนรายการตัวเลือกบนมือถือ (แกน X) */
  touchFactorMobile: 1.4,
  /** ต้องขยับนิ้วก่อนเริ่มลากชิป (ให้ปัด scroll ได้ก่อน) */
  dragThresholdMobile: 24,
  dragThresholdDesktop: 10,
  /** เมื่อรายการล้น — ต้องลากไกลขึ้นก่อนจะยกชิป (ให้ปัดบนชิปได้) */
  dragThresholdScrollableMobile: 32,
  dragThresholdScrollableDesktop: 18,
  /** ยังไม่ตัดสินว่า scroll หรือลากชิป */
  gestureDeadZonePx: 6,
  /** ทิศ scroll ต้องเด่นกว่าอีกแกน (คูณ) */
  scrollAxisBias: 1.1,
} as const;

type ChoiceGestureMode = "undecided" | "scroll" | "chip";

/** ตำแหน่งประโยคบนกระดานซ้าย */
const CTS_SENTENCE = {
  yRatioMobile: 0.54,
  yRatioDesktop: 0.6,
  /** ขอบซ้าย/ขวาของประโยคในกระดาน (ใช้คำนวณตัดบรรทัด + กันชนขอบ) */
  wrapPadLeftMobile: 32,
  wrapPadRightMobile: 34,
  wrapPadLeftDesktop: 36,
  wrapPadRightDesktop: 44,
  /** เลื่อนประโยคโจทย์ซ้าย(-) / ขวา(+) px (desktop) */
  sentenceOffsetXDesktop: 28,
  /** พื้นที่สำรองซ้ายสำหรับปุ่มลำโพง */
  speakerReserveMobile: 62,
  speakerReserveDesktop: 62,
  /** ระยะห่างแนวตั้งระหว่างบรรทัด */
  lineHeightRatioMobile: 1.68,
  lineHeightRatioDesktop: 1.42,
  /** ตำแหน่งเส้นใต้ช่องว่าง เทียบจุดกึ่งกลางข้อความ (y=0) */
  underlineYRatio: 0.38,
  /** ระยะจากขอบบนกระดานถึงจุดกลางรูปคำถาม (ยิ่งน้อยยิ่งสูง) */
  hintYOffsetMobile: 88,
  hintYOffsetDesktop: 280,
  speakerGapMobile: 14,
  speakerGapDesktop: 14,
} as const;

/**
 * กรอบ mask ตัวเลือก (มือถือ = กระดานล่าง) — ปรับตรงนี้ให้ทับขอบเขียวใน bg_game_mobile
 * syncChoiceClipMask() ใช้ค่าจาก getChoiceMaskRect()
 */
const CTS_CHOICE_VIEW = {
  padTopMobile: 1,
  padTopDesktop: 65,
  padBottomMobile: 1,
  padBottomDesktop: 42,
  padXMobile: 14,
  padXDesktop: 6,
} as const;

/**
 * Layout มือถือ — กระดานบน (รูป+ประโยค) / กระดานล่าง (ตัวเลือกแนวนอน)
 * ปรับตำแหน่ง: hintTopPad / hintOffsetX (รูป), sentenceYRatio / sentenceOffsetX (ประโยค),
 * choiceTopGap + choicePadTop (ตัวเลือกลง),
 * choiceOffsetX (เลื่อนแกน X ทั้งแถว), choiceRowYRatio (แนวตั้งในกระดานล่าง)
 */
const CTS_MOBILE_LAYOUT = {
  boardWRatio: 0.92,
  boardHRatio: 0.46,
  boardTopPad: 6,
  /** ระยะจากขอบบนกระดานบนถึงจุดกลางรูปคำใบ้ — ยิ่งน้อยยิ่งสูง */
  hintTopPad: 75,
  /** เลื่อนรูปโจทย์ซ้าย(-) / ขวา(+) px */
  hintOffsetX: 0,
  sentenceYRatio: 0.76,
  /** เลื่อนประโยคโจทย์ซ้าย(-) / ขวา(+) px */
  sentenceOffsetX: 0,
  /** ระยะจากกระดานบนถึงกระดานล่าง (ตัวเลือก) */
  choiceTopGap: 30,
  /** ความกว้างพื้นที่ตัวเลือก + mask (ไม่ควรเกิน 1.0) */
  choiceWRatio: 0.9,
  choiceH: 172,
  /** เลื่อนแถวตัวเลือกซ้าย(-) / ขวา(+) px */
  choiceOffsetX: 0,
  /** ตำแหน่งแนวตั้งของแถวชิปในกระดานล่าง (0–1 ของความสูงพื้นที่ clip) */
  choiceRowYRatio: 0.66,
  /** พื้นที่ปัด scroll ลงถึงใกล้ขอบล่างจอ (เหนือครู) — ยิ่งน้อยยิ่งลึกลง */
  scrollHitBottomReserve: 88,
} as const;

type CtsGameplayLayout = {
  boardX: number;
  boardY: number;
  boardW: number;
  boardH: number;
  choiceX: number;
  choiceY: number;
  choiceW: number;
  choiceH: number;
  hintY: number;
  sentenceY: number;
  choiceHorizontal: boolean;
};

export default class CompleteTheSentenceGameScene extends BaseGameScene {
  private mobile = false;
  private homeBackground?: Phaser.GameObjects.Image;
  private gameBackground?: Phaser.GameObjects.Image;
  private savedHomeData?: HomeSceneData;
  private gameplayStarted = false;
  private howtoViewActive = false;
  private tutorialPopup?: {
    howToImage?: Phaser.GameObjects.Image;
    startButton: Phaser.GameObjects.Image;
    restoreSceneInputEnabled: boolean;
    restoreHomeInputEnabled: boolean;
  };

  private ctsPayload?: CtsPayload;
  /** โหลดข้อมูล/รูปข้อคำถามระหว่างอยู่หน้า Home — ลดจอดำตอนกดเริ่ม */
  private gameplayPreparePromise?: Promise<GameplayPrepareState>;
  private currentQuestionIndex = 0;
  private endingRun = false;
  private textureKeyByUrl = new Map<string, string>();
  private audioKeyByUrl = new Map<string, string>();
  /** cache canvas texture ของข้อความบน chip — ลากลื่น ไม่ใช้ DOM */
  private hudRoot?: Phaser.GameObjects.Container;
  private hudTimerEvent?: Phaser.Time.TimerEvent;
  private hudTimeBg?: Phaser.GameObjects.Image;
  private hudTimeIcon?: Phaser.GameObjects.Image;
  private hudTimeText?: Phaser.GameObjects.Text;
  private hudScoreBg?: Phaser.GameObjects.Image;
  private hudScoreLabel?: Phaser.GameObjects.Text;
  private hudLivesBg?: Phaser.GameObjects.Image;
  private hudQuestionProgress?: PhaserQuestionProgressHud;
  private hudScoreText?: Phaser.GameObjects.Text;
  private hudHearts: Phaser.GameObjects.Image[] = [];
  private lives = MAX_LIVES;
  private gameFailedByNoLives = false;
  private hudExerciseText?: Phaser.GameObjects.Text;
  private hudExerciseDom?: Phaser.GameObjects.DOMElement;
  private hudExercisePill?: Phaser.GameObjects.Graphics;
  private hudExerciseTitle = "";
  private hudSuggestionLayoutH = 0;
  private hudElapsedRunning = false;
  private ctsBgmCurrent?: Phaser.Sound.BaseSound;
  private ctsBgmCurrentKey?: string;
  private ctsEndSound?: Phaser.Sound.BaseSound;

  private gameplayRoot?: Phaser.GameObjects.Container;
  private boardContainer?: Phaser.GameObjects.Container;
  private choicePanel?: Phaser.GameObjects.Container;
  private choiceListInner?: Phaser.GameObjects.Container;
  /** ขอบพื้นที่แสดงตัวเลือก (local ใน choiceListInner) */
  private choiceClipLocal = { x: 0, y: 0, w: 0, h: 0 };
  private choiceViewport = { x: 0, y: 0, w: 0, h: 0 };
  /** พื้นที่รับปัด scroll (มือถือกว้างถึงล่างจอ — แยกจาก mask ชิป) */
  private choiceScrollHitArea = { x: 0, y: 0, w: 0, h: 0 };
  private choiceClipMaskGfx?: Phaser.GameObjects.Graphics;
  private choiceClipMask?: Phaser.Display.Masks.GeometryMask;
  private choiceScrollCleanup?: () => void;
  private choiceScrollRuntime?: {
    axis: "x" | "y";
    maxScroll: number;
    touchFactor: number;
    applyScroll: (next: number) => void;
  };
  private choiceGesture?: {
    pointerId: number;
    mode: ChoiceGestureMode;
    chip?: WordChip;
    startX: number;
    startY: number;
    panStartScroll: number;
  };
  private choiceLayoutCache?: ChoiceLayoutCache;
  private sentenceTextDoms: Phaser.GameObjects.DOMElement[] = [];
  private sentenceSpeaker?: Phaser.GameObjects.DOMElement | Phaser.GameObjects.Image;
  private sentenceBlinkTween?: Phaser.Tweens.Tween;
  private fxEmitters: Phaser.GameObjects.Particles.ParticleEmitter[] = [];
  /** ล็อกเฉพาะ bubble แนะนำ (intro) — bubble อื่นไม่บล็อก */
  private guidanceInteractionLocked = false;
  private hintRow?: Phaser.GameObjects.Container;
  private blankSlots: BlankSlot[] = [];
  private wordChips: WordChip[] = [];
  private dragChip?: WordChip;

  private teacherHintUI?: TeacherHintUI;
  private teacherMessageKind: CtsTeacherMessageKind = "normal";
  private teacherMessageFollowUpEvent?: Phaser.Time.TimerEvent;
  private questionScrollInteracted = false;
  private scrollHintReminderEvent?: Phaser.Time.TimerEvent;
  private questionIdleNudgeEvent?: Phaser.Time.TimerEvent;
  private questionScrollHintDelayEvent?: Phaser.Time.TimerEvent;
  private questionVoiceDelayEvent?: Phaser.Time.TimerEvent;

  constructor() {
    super("complete-the-sentence");
  }

  protected override getLiveDashboardLaunchFields() {
    return {
      ...super.getLiveDashboardLaunchFields(),
      liveDashboardFlappyPassed: !this.gameFailedByNoLives,
    };
  }

  protected override getResultCorrectCount(): number {
    const total = this.ctsPayload?.questions.length ?? 0;
    if (this.gameFailedByNoLives) {
      return Math.max(0, this.currentQuestionIndex);
    }
    return total > 0 ? total : Math.max(0, this.currentQuestionIndex + 1);
  }

  protected override getResultScoreLabel(): string | undefined {
    return this.gameFailedByNoLives ? "ไม่ผ่าน" : undefined;
  }

  protected override onBeforeEndGame() {
    this.destroyGameplay();
    this.destroyTopHud();
    this.destroyCtsTeacher();
  }

  protected override endGame() {
    super.endGame();
  }

  /** หลัง scene.restart อ้างอิง Image เก่าที่ถูก destroy แล้ว — ต้องสร้างใหม่ */
  private ensureSceneImage(
    current: Phaser.GameObjects.Image | undefined,
    textureKey: string,
    depth = 0
  ): Phaser.GameObjects.Image {
    if (current?.active) {
      return current;
    }
    current?.destroy();
    return this.add.image(0, 0, textureKey).setOrigin(0, 0).setDepth(depth);
  }

  preload() {
    const img = (key: string, path: string) => {
      if (!this.textures.exists(key)) this.load.image(key, path);
    };

    // พื้นหลัง + UI ก่อน — ให้เห็นภาพเร็ว ลดแวบดำตอนเปิดเกม
    img("cts_bg_home", "assets/complete-the-sentence/bg_home.jpg");
    img("cts_bg_home_mobile", "assets/complete-the-sentence/bg_home_mobile.jpg");
    img("cts_bg_game", "assets/complete-the-sentence/bg_game.jpg");
    img("cts_bg_game_mobile", "assets/complete-the-sentence/bg_game_mobile.jpg");
    img("cts_logo", "assets/complete-the-sentence/logo.png");
    img("cts_btn_start", "assets/complete-the-sentence/btn_start.png");
    img("cts_btn_howto", "assets/complete-the-sentence/btn_howto.png");
    img("cts_chocie_bg", "assets/complete-the-sentence/chocie_bg.png");
    img("cts_bg_howto", "assets/complete-the-sentence/bg_howto.jpg");
    img("cts_howto_desktop", "assets/complete-the-sentence/howto_desktop.png");
    img("cts_howto_mobile", "assets/complete-the-sentence/howto_mobile.png");
    img("fx_star", "assets/flip-cards/star.png");

    preloadHudAssets(this);
    if (!this.textures.exists("flappy_heart_icon")) {
      this.load.image("flappy_heart_icon", "assets/flappy-bird/heart.png");
    }

    TeacherHintUI.preload(this);

    if (!this.cache.audio.exists("sfx_click_default")) {
      this.load.audio("sfx_click_default", "assets/sound/ui/click.mp3");
    }
    if (!this.cache.audio.exists("sfx_coin_collect")) {
      this.load.audio("sfx_coin_collect", "assets/sound/sfx_coin_collect.mp3");
    }
    if (!this.cache.audio.exists("sfx_incorrect")) {
      this.load.audio("sfx_incorrect", "assets/sound/sfx_incorrect_flip_cards.mp3");
    }
    if (!this.cache.audio.exists("sfx_notification_message")) {
      this.load.audio("sfx_notification_message", "assets/sound/sfx_notification_message_flip_cards.mp3");
    }
    if (!this.cache.audio.exists("cts_bgm_home")) {
      this.load.audio("cts_bgm_home", "assets/sound/complete-the-sentence/bgm_home.mp3");
    }
    if (!this.cache.audio.exists("cts_bgm_game")) {
      this.load.audio("cts_bgm_game", "assets/sound/complete-the-sentence/bgm_game.mp3");
    }
    if (!this.cache.audio.exists("cts_bgm_end")) {
      this.load.audio("cts_bgm_end", "assets/sound/complete-the-sentence/end.mp3");
    }
  }

  create() {
    super.create();
    this.mobile = isMobileLayout();
    this.gameplayStarted = false;
    this.endingRun = false;
    this.gameplayPreparePromise = undefined;
    this.homeBackground = undefined;
    this.gameBackground = undefined;

    this.applySceneBackdropColor();
    this.layoutHomeBackground();
    this.playCtsBgm("cts_bgm_home");
    this.startGameplayPrepare();

    this.savedHomeData = {
      gameKey: this.scene.key,
      ui: {
        startButtonPath: "assets/complete-the-sentence/btn_start.png",
        startButtonKey: "cts_btn_start",
        howToButtonPath: "assets/complete-the-sentence/btn_howto.png",
        howToButtonKey: "cts_btn_howto",
        homeLogoPath: "assets/complete-the-sentence/logo.png",
        homeLogoKey: "cts_logo",
        homeLogoWidth: this.mobile ? 300 : 1000,
        homeLogoYRatio: this.mobile ? 0.27 : 0.4,
        startButtonWidth: this.mobile ? 220 : 280,
        howToButtonWidth: this.mobile ? 180 : 210,
        startButtonYRatio: this.mobile ? 0.7 : 0.72,
        howToButtonYRatio: this.mobile ? 0.82 : 0.84,
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

    const onResize = (gameSize: Phaser.Structs.Size) => {
      this.mobile = isMobileLayout();
      if (this.gameplayStarted) {
        this.layoutGameBackground(gameSize.width, gameSize.height);
        this.layoutGameplay();
      } else if (this.howtoViewActive) {
        this.layoutHowtoBackground(gameSize.width, gameSize.height);
      } else {
        this.layoutHomeBackground(gameSize.width, gameSize.height);
      }
    };
    this.scale.on(Phaser.Scale.Events.RESIZE, onResize);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, onResize);
      this.destroyHowToPopup();
      this.destroyGameplay();
      this.destroyTopHud();
      this.destroyCtsTeacher();
      this.stopCtsBgm(0);
      this.stopCtsEndSound();
      this.homeBackground = undefined;
      this.gameBackground = undefined;
    });
  }

  protected override onGameAudioSettingsChanged(): void {
    if (!canPlayGameAudio("background")) {
      this.stopCtsBgm(0);
      this.stopCtsEndSound();
      return;
    }
    if (this.ctsEndSound?.isPlaying) return;
    const key = this.gameplayStarted && !this.endingRun ? "cts_bgm_game" : "cts_bgm_home";
    if (this.ctsBgmCurrentKey !== key || !this.ctsBgmCurrent?.isPlaying) {
      this.ctsBgmCurrentKey = undefined;
      this.playCtsBgm(key);
    }
  }

  private applySceneBackdropColor() {
    this.cameras.main.setBackgroundColor(CTS_SCENE_BG);
  }

  private layoutHomeBackground(width = this.scale.width, height = this.scale.height) {
    const key = this.mobile ? "cts_bg_home_mobile" : "cts_bg_home";
    this.applySceneBackdropColor();
    if (!this.textures.exists(key)) return;

    this.homeBackground = this.ensureSceneImage(this.homeBackground, key);
    this.homeBackground.setTexture(key).setVisible(true);
    this.homeBackground.setDisplaySize(width, height);
  }

  private layoutHowtoBackground(width = this.scale.width, height = this.scale.height) {
    this.applySceneBackdropColor();
    if (!this.textures.exists("cts_bg_howto")) return;

    this.homeBackground = this.ensureSceneImage(this.homeBackground, "cts_bg_howto");
    this.homeBackground.setTexture("cts_bg_howto").setVisible(true);
    this.homeBackground.setDisplaySize(width, height);
  }

  private layoutGameBackground(width = this.scale.width, height = this.scale.height) {
    const key = this.mobile ? "cts_bg_game_mobile" : "cts_bg_game";
    this.applySceneBackdropColor();
    if (!this.textures.exists(key)) return;

    this.gameBackground = this.ensureSceneImage(this.gameBackground, key);
    this.gameBackground.setTexture(key).setVisible(true);
    this.gameBackground.setDisplaySize(width, height);
    if (this.homeBackground?.active) {
      this.homeBackground.setVisible(false);
    }
  }

  private startGameplayPrepare() {
    if (this.gameplayPreparePromise) return;
    this.gameplayPreparePromise = this.runGameplayPrepare();
  }

  private async runGameplayPrepare(): Promise<GameplayPrepareState> {
    try {
      this.ctsPayload = await this.fetchCtsData();
    } catch (error) {
      console.error("[complete-the-sentence] load failed:", error);
      return "data-error";
    }

    const questions = this.ctsPayload.questions ?? [];
    if (!questions.length) return "no-questions";

    /** runstate + HUD: นับตามจำนวนข้อ (ไม่แยกตามช่องว่างในข้อเดียวกัน) */
    this.totalQuestions = questions.length;

    try {
      await this.preloadQuestionAssets(this.ctsPayload);
    } catch (err) {
      console.warn("[complete-the-sentence] preload assets:", err);
    }

    return "ok";
  }

  private async beginGameplayAfterHome() {
    if (this.gameplayStarted) return;
    this.gameplayStarted = true;
    this.input.enabled = true;
    this.input.dragDistanceThreshold = this.mobile
      ? CTS_CHOICE_SCROLL.dragThresholdMobile
      : CTS_CHOICE_SCROLL.dragThresholdDesktop;

    await ensureNotoSansThaiLoopedReady();

    const prepared = await (this.gameplayPreparePromise ?? this.runGameplayPrepare());
    if (prepared === "data-error") {
      this.add
        .text(this.scale.width / 2, this.scale.height / 2, "โหลดข้อมูลเกมไม่สำเร็จ", {
          font: `700 ${this.mobile ? CTS_FONT.error.mobile : CTS_FONT.error.desktop}px "Noto Sans Thai", sans-serif`,
          color: "#ffffff",
          backgroundColor: "#b02a37",
          padding: { x: 16, y: 10 },
        })
        .setOrigin(0.5)
        .setDepth(3000);
      return;
    }
    if (prepared === "no-questions") {
      this.add
        .text(this.scale.width / 2, this.scale.height / 2, "ไม่พบคำถาม", {
          font: `700 ${this.mobile ? CTS_FONT.error.mobile : CTS_FONT.error.desktop}px "Noto Sans Thai", sans-serif`,
          color: "#333",
        })
        .setOrigin(0.5)
        .setDepth(3000);
      return;
    }
    if (!this.ctsPayload) return;

    this.currentQuestionIndex = 0;
    this.score = 0;
    this.lives = MAX_LIVES;
    this.gameFailedByNoLives = false;
    this.endingRun = false;
    this.startTime = 0;
    this.hudElapsedRunning = false;

    this.layoutGameBackground();
    this.playCtsBgm("cts_bgm_game");

    const ctsInfo = this.ctsPayload.game_info;
    const exerciseName = getHudSuggestionLabel(ctsInfo?.suggestion);
    this.createTopHud(exerciseName);
    this.ensureCtsTeacherHintUI();
    this.ensureGameplayShell();
    this.reportRunstateStart();
    await this.showIntroTutorialBubble();
    this.showQuestion(0);
  }

  private async fetchCtsData(): Promise<CtsPayload> {
    if (this.injectedPayload) {
      return this.injectedPayload as unknown as CtsPayload;
    }
    throw new Error("Missing injected payload for scene: complete-the-sentence");
  }

  private resolveUrl(pathOrUrl?: string | null): string {
    const raw = (pathOrUrl ?? "").trim();
    if (!raw) return "";
    const normalized = raw.toLowerCase();
    if (normalized === "null" || normalized === "undefined") return "";
    if (/^https?:\/\//i.test(raw)) return raw;
    return `${API_BASE_URL}${raw}`;
  }

  private async preloadQuestionAssets(payload: CtsPayload): Promise<void> {
    const audioJobs: Array<{ key: string; url: string }> = [];
    const imageJobs: Array<{ key: string; url: string }> = [];

    const registerAudio = (raw?: string | null) => {
      const url = this.resolveUrl(raw);
      if (!url || this.audioKeyByUrl.has(url)) return;
      const key = `cts_audio_${this.audioKeyByUrl.size}`;
      this.audioKeyByUrl.set(url, key);
      if (!this.cache.audio.exists(key)) audioJobs.push({ key, url });
    };
    const registerImage = (raw?: string | null) => {
      const url = this.resolveUrl(raw);
      if (!url || this.textureKeyByUrl.has(url)) return;
      const key = `cts_tex_${this.textureKeyByUrl.size}`;
      this.textureKeyByUrl.set(url, key);
      if (!this.textures.exists(key)) imageJobs.push({ key, url });
    };

    for (const q of payload.questions ?? []) {
      registerAudio(q.sound_hint);
      registerAudio(q.sound_question_answer);
      registerImage(q.image_hint);
      registerImage(q.image_question_answer);
      for (const p of q.question_answer ?? []) {
        registerAudio(p.answer_sound);
        registerAudio(p.word_sound);
        registerImage(p.answer_image);
        if (Array.isArray(p.wrong_answer)) {
          for (const w of p.wrong_answer) {
            if (w && typeof w === "object" && !Array.isArray(w)) {
              registerAudio(w.sound);
              registerImage(w.image);
            }
          }
        }
      }
    }

    if (!audioJobs.length && !imageJobs.length) return;

    for (const i of imageJobs) this.load.image(i.key, i.url);
    for (const a of audioJobs) this.load.audio(a.key, a.url);

    await new Promise<void>((resolve) => {
      const onComplete = () => {
        this.load.off(Phaser.Loader.Events.COMPLETE, onComplete);
        resolve();
      };
      this.load.once(Phaser.Loader.Events.COMPLETE, onComplete);
      this.load.start();
    });
  }

  private playUrlAudio(raw?: string | null) {
    const url = this.resolveUrl(raw);
    if (!url) return;
    const key = this.audioKeyByUrl.get(url);
    if (!key || !this.cache.audio.exists(key)) return;
    if (!canPlayGameAudio("question")) return;
    guardedScenePlayQuestion(this, key, 1);
  }

  private stopCtsQuestionVoices() {
    if (!this.ctsPayload) return;
    const urls = new Set<string>();
    for (const q of this.ctsPayload.questions) {
      const hint = this.resolveUrl(q.sound_hint);
      const answer = this.resolveUrl(q.sound_question_answer);
      if (hint) urls.add(hint);
      if (answer) urls.add(answer);
    }
    for (const url of urls) {
      const key = this.audioKeyByUrl.get(url);
      if (key) this.sound.stopByKey(key);
    }
  }

  private cancelPendingQuestionVoice() {
    this.questionVoiceDelayEvent?.destroy();
    this.questionVoiceDelayEvent = undefined;
  }

  private clearQuestionVoicePlayback() {
    this.cancelPendingQuestionVoice();
    this.stopCtsQuestionVoices();
  }

  private playUrlChoiceAudio(raw?: string | null) {
    const url = this.resolveUrl(raw);
    if (!url) return;
    const key = this.audioKeyByUrl.get(url);
    if (!key || !this.cache.audio.exists(key)) return;
    if (!canPlayGameAudio("choice")) return;
    guardedScenePlayChoice(this, key, 1);
  }

  private getTextureKeyForUrl(raw?: string | null): string | undefined {
    const url = this.resolveUrl(raw);
    if (!url) return undefined;
    const key = this.textureKeyByUrl.get(url);
    return key && this.textures.exists(key) ? key : undefined;
  }

  private formatElapsedTime(): string {
    if (!this.hudElapsedRunning) {
      return "0:00";
    }
    const sec = Math.max(0, Math.floor((Date.now() - this.startTime) / 1000));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  private getCtsHudLayout() {
    const w = this.scale.width;
    const h = this.scale.height;
    const ui = createHudScaleCtx(w, h, this.mobile);
    const metrics = getGameHudRowMetrics({
      mobile: this.mobile,
      width: w,
      height: h,
      px: ui.px.bind(ui),
      maxLives: MAX_LIVES,
      hasProgress: true,
      hasLives: true,
    });
    const slots = getGameHudPillSlots(0, 0, w, metrics, {
      hasProgress: true,
      hasLives: true,
      mobile: this.mobile,
    });
    return { w, h, ui, metrics, slots };
  }

  private layoutCtsHudStats() {
    const { w, ui, metrics, slots } = this.getCtsHudLayout();
    const rowY = slots.rowY;
    const labelPad = ui.px(this.mobile ? 12 : 18);
    const valuePad = ui.px(this.mobile ? 12 : 18);
    const heartSize = ui.px(this.mobile ? 22 : 28);
    const heartGap = ui.px(this.mobile ? 2 : 4);
    const livesPadLeft = ui.px(this.mobile ? 12 : 16);

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
        label: this.getCtsQuestionProgressLabel(),
        font: metrics.fontProgress,
      });
    }

    this.layoutCtsSuggestionHud();
  }

  private getCtsHudBottomReserve(): number {
    const { ui, metrics, slots } = this.getCtsHudLayout();
    if (!this.mobile) return ui.px(92);
    const showSuggestion = hasHudCenterLabel(this.hudExerciseTitle);
    const suggestionH = this.hudSuggestionLayoutH > 0 ? this.hudSuggestionLayoutH : ui.px(56);
    if (showSuggestion) {
      return slots.questionY + suggestionH + ui.px(12);
    }
    return slots.rowY + metrics.pillH / 2 + ui.px(12);
  }

  private layoutCtsSuggestionHud() {
    if (!this.hudExercisePill || !this.hudExerciseText) return;

    const mobile = this.mobile;
    const { w, ui, metrics, slots } = this.getCtsHudLayout();
    const title = this.hudExerciseTitle;
    const titleY = slots.questionY;
    const titleH = mobile ? ui.px(56) : metrics.questionH;
    const titleMinW = slots.questionMaxW * 0.65;
    const hudRes = Math.min(3, typeof window !== "undefined" ? window.devicePixelRatio || 2 : 2);
    const suggestionBox = resolveHudSuggestionBox({
      mobile,
      text: title,
      centerX: slots.questionCenterX,
      safeX: 0,
      safeWidth: w,
      sidePad: metrics.leftPad,
      minW: titleMinW,
      maxW: slots.questionMaxW,
      minLeft: slots.timeRight + metrics.questionGap,
      maxRight: slots.statsLeftEdge - metrics.questionGap,
    });
    const fontHudTitle = getHudCenterTextFont(ui.px.bind(ui), mobile);

    const suggestionLayout = layoutPhaserHudSuggestion({
        scene: this,
        pill: this.hudExercisePill,
        text: this.hudExerciseText,
        dom: this.hudExerciseDom,
        parent: this.hudRoot,
        label: title,
        box: suggestionBox,
        top: titleY,
        height: titleH,
        wrapPadX: ui.px(mobile ? 32 : CTS_FONT.hud.titleWrapPadDesktop),
        textPadX: ui.px(mobile ? 12 : 16),
        textPadY: ui.px(mobile ? 10 : 8),
        font: fontHudTitle,
        lineSpacing: mobile ? 3 : 2,
        resolution: hudRes,
        mobile,
      });
    this.hudExerciseDom = suggestionLayout.dom ?? this.hudExerciseDom;
    this.hudSuggestionLayoutH = suggestionLayout.height;
  }

  private createTopHud(exerciseName: string) {
    this.destroyTopHud();
    this.hudExerciseTitle = exerciseName;

    const mobile = this.mobile;
    const { w, ui, metrics } = this.getCtsHudLayout();
    const hudRes = Math.min(3, typeof window !== "undefined" ? window.devicePixelRatio || 2 : 2);

    const hud = this.add.container(0, 0).setScrollFactor(0).setDepth(2000);
    this.hudRoot = hud;

    const titlePill = this.add.graphics().setScrollFactor(0);
    hud.add(titlePill);
    this.hudExercisePill = titlePill;

    this.hudExerciseText = this.add
      .text(0, 0, exerciseName, {
        font: getHudCenterTextFont(ui.px.bind(ui), mobile),
        color: "#333333",
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setResolution(hudRes);
    hud.add(this.hudExerciseText);

    this.hudTimeBg = this.add.image(0, 0, "bg_hud").setScrollFactor(0);
    this.hudTimeIcon = this.add
      .image(0, 0, HUD_HOURGLASS_TEXTURE_KEY)
      .setOrigin(0.5)
      .setScrollFactor(0);
    this.hudTimeText = this.add
      .text(0, 0, "0:00", {
        font: metrics.fontDigits,
        color: HUD_VALUE_COLOR,
      })
      .setOrigin(1, 0.5)
      .setScrollFactor(0)
      .setResolution(hudRes);
    hud.add([this.hudTimeBg, this.hudTimeIcon, this.hudTimeText]);

    this.hudScoreBg = this.add.image(0, 0, "bg_hud").setScrollFactor(0);
    this.hudScoreLabel = this.add
      .text(0, 0, "คะแนน", { font: metrics.fontLabel, color: HUD_LABEL_COLOR })
      .setOrigin(0, 0.5)
      .setScrollFactor(0)
      .setResolution(hudRes);
    this.hudScoreText = this.add
      .text(0, 0, `${this.score}`, {
        font: metrics.fontDigits,
        color: HUD_VALUE_COLOR,
      })
      .setOrigin(1, 0.5)
      .setScrollFactor(0)
      .setResolution(hudRes);
    hud.add([this.hudScoreBg, this.hudScoreLabel, this.hudScoreText]);

    this.hudLivesBg = this.add.image(0, 0, "bg_hud").setScrollFactor(0);
    hud.add(this.hudLivesBg);
    this.hudHearts = [];
    for (let i = 0; i < MAX_LIVES; i += 1) {
      const heartImg = this.add
        .image(0, 0, "flappy_heart_icon")
        .setScrollFactor(0);
      this.hudHearts.push(heartImg);
      hud.add(heartImg);
    }

    this.hudQuestionProgress = createPhaserQuestionProgressHud(this, 2002, {
      mobile,
      width: w,
      px: ui.px.bind(ui),
      resolution: hudRes,
    });
    hud.add(this.hudQuestionProgress.bg);
    hud.add(this.hudQuestionProgress.text);

    this.layoutCtsHudStats();
    this.refreshHudLives();

    this.hudTimeText?.setText("0:00");
    this.hudTimerEvent = this.time.addEvent({
      delay: 250,
      loop: true,
      callback: () => {
        if (!this.hudElapsedRunning) return;
        this.hudTimeText?.setText(this.formatElapsedTime());
        this.layoutCtsHudStats();
      },
    });
    this.refreshHudScore();
  }

  private refreshHudScore() {
    this.layoutCtsHudStats();
  }

  private getCtsQuestionProgressLabel(): string {
    const total = this.totalQuestions ?? this.ctsPayload?.questions?.length ?? 0;
    if (total <= 0) return "";
    return getQuestionProgressLabel(total, { questionIndex0: this.currentQuestionIndex });
  }

  private refreshCtsQuestionProgressHud() {
    this.layoutCtsHudStats();
  }

  private refreshHudLives() {
    for (let i = 0; i < this.hudHearts.length; i += 1) {
      this.hudHearts[i]?.setAlpha(i < this.lives ? 1 : 0.25);
    }
  }

  private loseLife() {
    if (this.endingRun) return;
    this.lives = Math.max(0, this.lives - 1);
    this.refreshHudLives();
    if (this.lives <= 0) {
      this.gameFailedByNoLives = true;
      this.triggerCtsGameOver();
    }
  }

  private triggerCtsGameOver() {
    if (this.endingRun) return;
    this.endingRun = true;
    this.hudElapsedRunning = false;
    this.playCtsEndThenHome(() => {
      if (!this.scene.isActive()) return;
      this.endGame();
    });
  }

  private startHudElapsedTimer() {
    if (this.hudElapsedRunning) return;
    this.hudElapsedRunning = true;
    this.startTime = Date.now();
    this.hudTimeText?.setText(this.formatElapsedTime());
  }

  private destroyTopHud() {
    this.hudTimerEvent?.destroy();
    this.hudTimerEvent = undefined;
    this.hudRoot?.destroy(true);
    this.hudRoot = undefined;
    this.hudTimeBg = undefined;
    this.hudTimeIcon = undefined;
    this.hudTimeText = undefined;
    this.hudScoreBg = undefined;
    this.hudScoreLabel = undefined;
    this.hudScoreText = undefined;
    this.hudLivesBg = undefined;
    this.hudQuestionProgress = undefined;
    this.hudHearts = [];
    this.hudExerciseText = undefined;
    this.hudExerciseDom = undefined;
    this.hudExercisePill = undefined;
    this.hudExerciseTitle = "";
  }

  private getChoiceMaskRect(viewW: number, viewH: number, mobile: boolean) {
    const padT = mobile ? CTS_CHOICE_VIEW.padTopMobile : CTS_CHOICE_VIEW.padTopDesktop;
    const padB = mobile ? CTS_CHOICE_VIEW.padBottomMobile : CTS_CHOICE_VIEW.padBottomDesktop;
    const padX = mobile ? CTS_CHOICE_VIEW.padXMobile : CTS_CHOICE_VIEW.padXDesktop;
    return {
      x: padX,
      y: padT,
      w: Math.max(8, viewW - padX * 2),
      h: Math.max(8, viewH - padT - padB),
    };
  }

  private ensureGameplayShell() {
    if (this.gameplayRoot) return;
    this.gameplayRoot = this.add.container(0, 0).setDepth(50).setScrollFactor(0);
    this.boardContainer = this.add.container(0, 0);
    this.choicePanel = this.add.container(0, 0);
    this.choiceListInner = this.add.container(0, 0);
    this.choicePanel.add(this.choiceListInner);
    this.hintRow = this.add.container(0, 0);
    this.gameplayRoot.add([this.boardContainer, this.choicePanel, this.hintRow]);
    this.ensureChoiceClipMask();
  }

  private ensureChoiceClipMask() {
    if (this.choiceClipMaskGfx || !this.choicePanel) return;
    this.choiceClipMaskGfx = this.add.graphics();
    this.choiceClipMaskGfx.setScrollFactor(0).setDepth(52).setVisible(false);
    this.choiceClipMask = this.choiceClipMaskGfx.createGeometryMask();
    this.choicePanel.setMask(this.choiceClipMask);
  }

  /** กรอบ mask ทับพื้นที่เขียวของกระดานตัวเลือก (clip ขอบซ้าย–ขวาเหมือนตัวอย่าง) */
  private syncChoiceClipMask(viewW: number, viewH: number, mobile: boolean) {
    const panel = this.choicePanel;
    const gfx = this.choiceClipMaskGfx;
    if (!panel || !gfx) return;

    const rect = this.getChoiceMaskRect(viewW, viewH, mobile);
    const wx = panel.x + rect.x;
    const wy = panel.y + rect.y;
    gfx.clear();
    gfx.fillStyle(0xffffff);
    gfx.fillRect(wx, wy, rect.w, rect.h);
  }

  /** จัด layout ให้ทับกระดานใน bg_game (ไม่วาดกระดานเขียวซ้ำ) */
  private getGameplayLayout(): CtsGameplayLayout {
    const w = this.scale.width;
    const h = this.scale.height;
    const mobile = this.mobile;
    const ui = createHudScaleCtx(w, h, mobile);
    const hudBottom = this.getCtsHudBottomReserve();

    if (mobile) {
      const m = CTS_MOBILE_LAYOUT;
      const shortMobile = isShortMobileViewport(h, w);
      const tinyMobile = isTinyMobileViewport(h, w);
      const boardHRatio = tinyMobile ? 0.4 : shortMobile ? 0.43 : m.boardHRatio;
      const boardW = w * m.boardWRatio;
      const boardX = (w - boardW) / 2;
      const boardY = hudBottom + mobileCompactPx(m.boardTopPad, h, w);
      const boardH = (h - boardY) * boardHRatio;
      const choiceW = w * m.choiceWRatio;
      const choiceX = (w - choiceW) / 2;
      const choiceY = boardY + boardH + mobileCompactPx(m.choiceTopGap, h, w);
      const choiceH = mobileCompactPx(m.choiceH, h, w);
      const hintY = boardY + mobileCompactPx(m.hintTopPad, h, w);
      const sentenceY = boardY + boardH * m.sentenceYRatio;

      return {
        boardX,
        boardY,
        boardW,
        boardH,
        choiceX,
        choiceY,
        choiceW,
        choiceH,
        hintY,
        sentenceY,
        choiceHorizontal: true,
      };
    }

    const boardX = w * 0.04;
    const boardW = w * 0.62;
    const boardY = hudBottom + ui.px(10);
    const boardH = h - boardY - ui.px(110);

    return {
      boardX,
      boardY,
      boardW,
      boardH,
      choiceX: w * 0.74,
      choiceY: hudBottom + ui.px(48),
      choiceW: w * 0.2,
      choiceH: h - (hudBottom + ui.px(48)) - ui.px(96),
      hintY: boardY + ui.px(CTS_SENTENCE.hintYOffsetDesktop),
      sentenceY: boardY + boardH * CTS_SENTENCE.yRatioDesktop,
      choiceHorizontal: false,
    };
  }

  private layoutGameplay() {
    if (!this.gameplayRoot || !this.boardContainer || !this.choicePanel) return;
    this.layoutCtsHudStats();
    const q = this.ctsPayload?.questions[this.currentQuestionIndex];
    if (!q) return;
    const filledBlanks = this.captureQuestionFillState();
    this.clearQuestionUi();
    this.renderQuestion(q);
    this.restoreQuestionFillState(filledBlanks);
  }

  private captureQuestionFillState(): Array<{ blankIndex: number; answerText: string }> {
    return this.blankSlots
      .filter((blank) => blank.filled)
      .map((blank) => ({ blankIndex: blank.index, answerText: blank.correctAnswer }));
  }

  private restoreQuestionFillState(
    fills: Array<{ blankIndex: number; answerText: string }>
  ) {
    if (fills.length === 0) return;

    for (const { blankIndex, answerText } of fills) {
      const blank = this.blankSlots.find((b) => b.index === blankIndex);
      if (!blank || blank.filled) continue;

      const chip = this.wordChips.find((c) => !c.used && c.text === answerText);
      if (!chip || chip.text !== blank.correctAnswer) continue;

      blank.filled = true;
      blank.dropZone.disableInteractive();
      chip.used = true;
      blank.underline.clear();
      blank.underline.setVisible(false);
      blank.filledLabel = this.addThaiSpanDom(
        blank.zone,
        0,
        0,
        chip.text,
        blank.sentenceFontPx,
        "#ffffff",
        700
      );
      this.parkUsedChoiceChip(chip);
    }

    this.reflowChoiceChips();
  }

  private clearQuestionUi() {
    this.blankSlots = [];
    this.wordChips = [];
    this.dragChip = undefined;
    this.stopSentenceBlinkFx();
    this.sentenceTextDoms = [];
    this.sentenceSpeaker?.destroy();
    this.sentenceSpeaker = undefined;
    this.destroyFxEmitters();
    this.clearQuestionGuidanceTimers();
    this.clearQuestionVoicePlayback();
    this.questionScrollInteracted = false;
    this.teardownChoiceScroll();
    this.choiceLayoutCache = undefined;
    this.choiceListInner?.removeAll(true);
    this.boardContainer?.removeAll(true);
    this.hintRow?.removeAll(true);
  }

  private teardownChoiceScroll() {
    this.choiceScrollCleanup?.();
    this.choiceScrollCleanup = undefined;
    this.choiceScrollRuntime = undefined;
    this.choiceGesture = undefined;
  }

  private findChipAtPointer(pointer: Phaser.Input.Pointer): WordChip | undefined {
    for (const chip of this.wordChips) {
      if (chip.used) continue;
      if (chip.container.getBounds().contains(pointer.x, pointer.y)) return chip;
    }
    return undefined;
  }

  private isChoiceScrollDominant(dx: number, dy: number): boolean {
    const rt = this.choiceScrollRuntime;
    if (!rt || rt.maxScroll <= 0) return false;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    return rt.axis === "x"
      ? absDx >= absDy * CTS_CHOICE_SCROLL.scrollAxisBias
      : absDy >= absDx * CTS_CHOICE_SCROLL.scrollAxisBias;
  }

  private suppressChipDrag(chip: WordChip) {
    this.input.setDraggable(chip.container, false);
    chip.container.setPosition(chip.homeX, chip.homeY);
    chip.container.setScale(1);
    if (this.dragChip === chip) this.dragChip = undefined;
  }

  private restoreChipDrag(chip: WordChip) {
    if (!chip.used) this.input.setDraggable(chip.container, true);
  }

  private shouldStartChoiceScrollGesture(dx: number, dy: number): boolean {
    const dead = CTS_CHOICE_SCROLL.gestureDeadZonePx;
    if (Math.abs(dx) < dead && Math.abs(dy) < dead) return false;
    return this.isChoiceScrollDominant(dx, dy);
  }

  private isPointerInChoiceScrollZone(pointer: Phaser.Input.Pointer): boolean {
    const v = this.choiceScrollHitArea;
    return (
      pointer.x >= v.x &&
      pointer.x <= v.x + v.w &&
      pointer.y >= v.y &&
      pointer.y <= v.y + v.h
    );
  }

  /** คงให้ชิปมองเห็น — ตัดขอบด้วย geometry mask บน choicePanel */
  private syncChoiceChipClipVisibility() {
    for (const chip of this.wordChips) {
      if (chip.used) continue;
      chip.container.setVisible(true);
    }
  }

  private updateChoiceViewportFromClip(viewW: number, viewH: number, mobile: boolean) {
    const inner = this.choiceListInner;
    if (!inner) return;
    const rect = this.getChoiceMaskRect(viewW, viewH, mobile);
    this.choiceClipLocal = { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
    const m = inner.getWorldTransformMatrix();
    const p0 = new Phaser.Math.Vector2();
    const p1 = new Phaser.Math.Vector2();
    m.transformPoint(rect.x, rect.y, p0);
    m.transformPoint(rect.x + rect.w, rect.y + rect.h, p1);
    this.choiceViewport = {
      x: Math.min(p0.x, p1.x),
      y: Math.min(p0.y, p1.y),
      w: Math.abs(p1.x - p0.x),
      h: Math.abs(p1.y - p0.y),
    };
  }

  /** mask = กระดานเขียว | hit area มือถือ = จากกระดานล่างถึงพื้นที่ครีมใต้ครู */
  private updateChoiceScrollHitArea(viewW: number, viewH: number, mobile: boolean) {
    this.updateChoiceViewportFromClip(viewW, viewH, mobile);
    if (!mobile || !this.choicePanel) {
      this.choiceScrollHitArea = { ...this.choiceViewport };
      return;
    }

    const screenH = this.scale.height;
    const screenW = this.scale.width;
    const panelY = this.choicePanel.y;
    const bottomReserve = mobileCompactPx(CTS_MOBILE_LAYOUT.scrollHitBottomReserve, screenH, screenW);

    this.choiceScrollHitArea = {
      x: 0,
      y: panelY,
      w: screenW,
      h: Math.max(this.choiceViewport.h, screenH - panelY - bottomReserve),
    };
  }

  private setupChoiceListScroll(
    viewW: number,
    viewH: number,
    contentSpan: number,
    mobile: boolean,
    axis: "x" | "y" = "y"
  ) {
    this.teardownChoiceScroll();
    if (!this.choiceListInner || !this.choicePanel) return;

    const rect = this.getChoiceMaskRect(viewW, viewH, mobile);
    this.updateChoiceScrollHitArea(viewW, viewH, mobile);
    this.syncChoiceClipMask(viewW, viewH, mobile);

    const maxScroll =
      axis === "x" ? Math.max(0, contentSpan - rect.w) : Math.max(0, contentSpan - rect.h);
    this.choiceListInner.setPosition(0, 0);
    this.syncChoiceChipClipVisibility();

    let scrollPos = maxScroll > 0 ? -maxScroll / 2 : 0;
    const applyScroll = (next: number, fromUser = false) => {
      const prev = scrollPos;
      scrollPos = Phaser.Math.Clamp(next, -maxScroll, 0);
      if (fromUser && Math.abs(scrollPos - prev) > 1) {
        this.markChoiceScrollInteracted();
      }
      if (axis === "x") {
        this.choiceListInner?.setX(scrollPos);
      } else {
        this.choiceListInner?.setY(scrollPos);
      }
      this.syncChoiceChipClipVisibility();
    };
    applyScroll(scrollPos);

    const touchFactor = mobile && axis === "x" ? CTS_CHOICE_SCROLL.touchFactorMobile : 1;
    this.choiceScrollRuntime = {
      axis,
      maxScroll,
      touchFactor,
      applyScroll,
    };

    if (maxScroll > 0) {
      this.input.dragDistanceThreshold = mobile
        ? CTS_CHOICE_SCROLL.dragThresholdScrollableMobile
        : CTS_CHOICE_SCROLL.dragThresholdScrollableDesktop;
    }

    if (maxScroll <= 0) return;

    const onPointerDown = (pointer: Phaser.Input.Pointer) => {
      if (!pointer.isDown) return;
      if (this.guidanceInteractionLocked) return;
      if (!this.isPointerInChoiceScrollZone(pointer)) return;
      this.choiceGesture = {
        pointerId: pointer.id,
        mode: "undecided",
        chip: this.findChipAtPointer(pointer),
        startX: pointer.x,
        startY: pointer.y,
        panStartScroll: scrollPos,
      };
    };
    const onPointerMove = (pointer: Phaser.Input.Pointer) => {
      const gesture = this.choiceGesture;
      if (!gesture || !pointer.isDown || pointer.id !== gesture.pointerId) return;

      const dx = pointer.x - gesture.startX;
      const dy = pointer.y - gesture.startY;

      if (gesture.mode === "undecided") {
        const dead = CTS_CHOICE_SCROLL.gestureDeadZonePx;
        if (Math.abs(dx) < dead && Math.abs(dy) < dead) return;
        if (this.isChoiceScrollDominant(dx, dy)) {
          gesture.mode = "scroll";
          if (gesture.chip) this.suppressChipDrag(gesture.chip);
        } else {
          gesture.mode = "chip";
        }
      }

      if (gesture.mode === "scroll") {
        if (this.dragChip) this.suppressChipDrag(this.dragChip);
        const coord = axis === "x" ? pointer.x : pointer.y;
        const start = axis === "x" ? gesture.startX : gesture.startY;
        applyScroll(gesture.panStartScroll + (coord - start) * touchFactor, true);
      }
    };
    const onPointerUp = (pointer: Phaser.Input.Pointer) => {
      const gesture = this.choiceGesture;
      if (!gesture || pointer.id !== gesture.pointerId) return;
      if (gesture.chip && gesture.mode === "scroll") {
        this.restoreChipDrag(gesture.chip);
      }
      this.choiceGesture = undefined;
    };
    const onWheel = (
      _pointer: Phaser.Input.Pointer,
      _over: Phaser.GameObjects.GameObject[],
      dx: number,
      dy: number
    ) => {
      const p = this.input.activePointer;
      if (!this.isPointerInChoiceScrollZone(p)) return;
      const delta = axis === "x" ? -dx : -dy;
      applyScroll(scrollPos + delta * CTS_CHOICE_SCROLL.wheelFactor, true);
    };

    this.input.on("pointerdown", onPointerDown);
    this.input.on("pointermove", onPointerMove);
    this.input.on("pointerup", onPointerUp);
    this.input.on("pointerupoutside", onPointerUp);
    this.input.on("wheel", onWheel);

    this.choiceScrollCleanup = () => {
      this.input.off("pointerdown", onPointerDown);
      this.input.off("pointermove", onPointerMove);
      this.input.off("pointerup", onPointerUp);
      this.input.off("pointerupoutside", onPointerUp);
      this.input.off("wheel", onWheel);
    };
  }

  private floatChipForDrag(chip: WordChip, pointer: Phaser.Input.Pointer) {
    const container = chip.container;
    const root = this.gameplayRoot;
    if (!root) return;

    const bounds = container.getBounds();
    const cx = bounds.centerX;
    const cy = bounds.centerY;
    chip.dragGrabOffsetX = pointer.x - cx;
    chip.dragGrabOffsetY = pointer.y - cy;

    root.add(container);
    container.setPosition(cx, cy);
    container.setDepth(300);
  }

  private isBlankPart(part: CtsQuestionAnswerPart): boolean {
    if (!(part.answer ?? "").trim()) return false;
    const w = part.word;
    if (w == null) return true;
    const s = String(w).trim().toLowerCase();
    return s === "" || s === "null";
  }

  /** วัดความกว้างข้อความไทยก่อนวาง DOM (สระไม่จมเหมือน Phaser.Text) */
  private measureThaiSpanWidth(text: string, fontSizePx: number, fontWeight: 500 | 700 = 700): number {
    const span = createThaiTextSpan(text, {
      fontSizePx,
      color: "#ffffff",
      fontWeight,
      pointerEventsNone: true,
    });
    span.style.position = "absolute";
    span.style.visibility = "hidden";
    span.style.left = "-9999px";
    document.body.appendChild(span);
    const w = Math.ceil(span.getBoundingClientRect().width);
    document.body.removeChild(span);
    return Math.max(8, w);
  }

  /** เส้นใต้ช่องว่าง — ให้ตรง baseline กับคำใน DOM (origin 0.5 ที่ y=0) */
  private getSentenceUnderlineY(fontSizePx: number): number {
    return Math.round(fontSizePx * CTS_SENTENCE.underlineYRatio);
  }

  private addThaiSpanDom(
    parent: Phaser.GameObjects.Container,
    centerX: number,
    centerY: number,
    text: string,
    fontSizePx: number,
    color: string,
    fontWeight: 500 | 700 = 700,
    maxWidthPx?: number,
    trackSentenceText = false
  ): Phaser.GameObjects.DOMElement {
    const span = createThaiTextSpan(text, {
      fontSizePx,
      color,
      fontWeight,
      maxWidthPx,
      textAlign: "center",
      pointerEventsNone: true,
    });
    const wrap = document.createElement("div");
    wrap.style.cssText = "margin:0;padding:0;display:inline-block;line-height:0";
    wrap.appendChild(span);
    const dom = this.add.dom(centerX, centerY, wrap).setOrigin(0.5, 0.5);
    parent.add(dom);
    if (trackSentenceText) this.sentenceTextDoms.push(dom);
    return dom;
  }

  private getThaiSpanFromDom(dom: Phaser.GameObjects.DOMElement): HTMLElement | null {
    const root = dom.node as HTMLElement | undefined;
    if (!root) return null;
    return (root.firstElementChild as HTMLElement | null) ?? root;
  }

  private destroyFxEmitters() {
    for (const emitter of this.fxEmitters) {
      emitter.destroy();
    }
    this.fxEmitters = [];
  }

  private stopSentenceBlinkFx() {
    this.sentenceBlinkTween?.stop();
    this.sentenceBlinkTween = undefined;
    for (const dom of this.sentenceTextDoms) {
      const el = this.getThaiSpanFromDom(dom);
      if (el) el.style.color = "#ffffff";
    }
  }

  /** ดาววิ๊งตอนตอบถูก — อิง situation */
  private playCorrectAnswerFx(worldX: number, worldY: number) {
    if (!this.textures.exists("fx_star")) return;

    const mobile = this.mobile;
    const fxDepth = CTS_FX.depth;
    const s = CTS_FX.starScale;

    const halo = this.add
      .circle(worldX, worldY, (mobile ? 48 : 56) * s, 0xffffff, 0.28)
      .setScrollFactor(0)
      .setDepth(fxDepth);
    this.tweens.add({
      targets: halo,
      scale: (mobile ? 1.2 : 1.65) * s,
      alpha: 0,
      duration: 450,
      ease: "Quad.easeOut",
      onComplete: () => halo.destroy(),
    });

    const particles = this.add.particles(worldX, worldY - (mobile ? 24 : 32) * s, "fx_star", {
      speed: { min: 90 * s, max: 220 * s },
      angle: { min: 0, max: 360 },
      lifespan: 780,
      gravityY: 900,
      quantity: 14,
      emitting: false,
      tint: [0xffffff, 0xfff6b0, 0xfff2d8],
      blendMode: Phaser.BlendModes.NORMAL,
      scale: { start: (mobile ? 0.22 : 0.28) * s, end: 0.05 * s },
    });
    particles.setScrollFactor(0).setDepth(fxDepth + 1);
    this.fxEmitters.push(particles);

    particles.explode(14);
    this.time.delayedCall(1100, () => {
      this.tweens.add({
        targets: particles,
        alpha: 0,
        duration: 400,
        ease: "Quad.easeOut",
        onComplete: () => {
          particles.destroy();
          this.fxEmitters = this.fxEmitters.filter((e) => e !== particles);
        },
      });
    });
  }

  /** ข้อความประโยค (กระดานซ้าย/บน) กระพริบแดงเมื่อตอบผิด */
  private playWrongSentenceBlinkFx() {
    if (!this.sentenceTextDoms.length) return;
    this.stopSentenceBlinkFx();

    const phase = { on: 0 };
    this.sentenceBlinkTween = this.tweens.add({
      targets: phase,
      on: 1,
      duration: CTS_FX.sentenceBlinkDurationMs,
      yoyo: true,
      repeat: CTS_FX.sentenceBlinkRepeats,
      ease: "Sine.easeInOut",
      onUpdate: () => {
        const color = phase.on > 0.5 ? "#ff4c4c" : "#ffffff";
        for (const dom of this.sentenceTextDoms) {
          const el = this.getThaiSpanFromDom(dom);
          if (el) el.style.color = color;
        }
      },
      onComplete: () => {
        this.sentenceBlinkTween = undefined;
        for (const dom of this.sentenceTextDoms) {
          const el = this.getThaiSpanFromDom(dom);
          if (el) el.style.color = "#ffffff";
        }
      },
    });
  }

  private hasQuestionSound(q: CtsQuestion): boolean {
    const raw = [q.sound_hint, q.sound_question_answer]
      .map((v) => (v ?? "").trim())
      .filter((v) => v && v.toLowerCase() !== "null" && v.toLowerCase() !== "undefined");
    return raw.length > 0;
  }

  private resolveSentenceBoardMetrics(
    boardW: number,
    mobile: boolean,
    hasSound: boolean,
    ui: ReturnType<typeof createHudScaleCtx>
  ): { centerX: number; wrapMaxW: number } {
    const leftPad = mobile ? CTS_SENTENCE.wrapPadLeftMobile : CTS_SENTENCE.wrapPadLeftDesktop;
    const rightPad = mobile ? CTS_SENTENCE.wrapPadRightMobile : CTS_SENTENCE.wrapPadRightDesktop;
    const contentLeft = leftPad;
    const contentRight = boardW - rightPad;

    if (mobile) {
      const centerX = (contentLeft + contentRight) / 2;
      const speakerSize = hasSound ? ui.px(40) : 0;
      const speakerGap = hasSound ? ui.px(CTS_SENTENCE.speakerGapMobile) : 0;
      const speakerLane = speakerSize + speakerGap;
      const wrapMaxW = Math.max(80, contentRight - contentLeft - speakerLane);
      return { centerX, wrapMaxW };
    }

    const offsetX = ui.px(CTS_SENTENCE.sentenceOffsetXDesktop);
    const speakerReserve = hasSound ? ui.px(CTS_SENTENCE.speakerReserveDesktop) : 0;
    const baseCenterX = (contentLeft + contentRight) / 2;
    let centerX = baseCenterX + offsetX;

    const minCenterX = contentLeft + speakerReserve;
    const maxCenterX = contentRight;
    centerX = Phaser.Math.Clamp(centerX, minCenterX, maxCenterX);

    const halfFromLeft = Math.max(0, centerX - contentLeft - speakerReserve);
    const halfFromRight = Math.max(0, contentRight - centerX);
    const wrapMaxW = Math.max(80, Math.min(halfFromLeft, halfFromRight) * 2);

    return { centerX, wrapMaxW };
  }

  private layoutSentenceOnBoard(
    sentenceContainer: Phaser.GameObjects.Container,
    board: Phaser.GameObjects.Container,
    sentenceLocalY: number,
    q: CtsQuestion,
    parts: CtsQuestionAnswerPart[],
    wrapMaxW: number,
    boardW: number,
    boardCenterX: number,
    mobile: boolean,
    sentenceFontPx: number,
    partGap: number
  ) {
    type SentenceItem =
      | { kind: "text"; text: string }
      | { kind: "blank"; answer: string };

    const items: SentenceItem[] = [{ kind: "text", text: `${q.no}.` }];
    for (const part of parts) {
      if (this.isBlankPart(part) && part.answer) {
        items.push({ kind: "blank", answer: part.answer });
      } else if (!this.isBlankPart(part) && part.word) {
        items.push({ kind: "text", text: String(part.word) });
      }
    }

    const lineHeightRatio = mobile
      ? CTS_SENTENCE.lineHeightRatioMobile
      : CTS_SENTENCE.lineHeightRatioDesktop;
    const lineStep = Math.round(sentenceFontPx * lineHeightRatio);
    const blankMinW = mobile ? 72 : 90;
    const blankExtra = mobile ? 20 : 28;
    const blankH = mobile ? 40 : 48;
    const lineY = this.getSentenceUnderlineY(sentenceFontPx);

    const measureItemW = (item: SentenceItem): number => {
      if (item.kind === "text") {
        return this.measureThaiSpanWidth(item.text, sentenceFontPx, 700);
      }
      const answerW = this.measureThaiSpanWidth(item.answer, sentenceFontPx, 700);
      return Math.max(blankMinW, answerW + blankExtra);
    };

    const lines: { item: SentenceItem; x: number; w: number }[][] = [];
    let lineIdx = 0;
    let cursorX = 0;

    for (const item of items) {
      const w = measureItemW(item);
      if (cursorX > 0 && cursorX + w > wrapMaxW) {
        lineIdx += 1;
        cursorX = 0;
      }
      if (!lines[lineIdx]) lines[lineIdx] = [];
      lines[lineIdx].push({ item, x: cursorX, w });
      cursorX += w + partGap;
    }

    const totalLines = Math.max(1, lines.length);
    const blockTopY = -((totalLines - 1) * lineStep) / 2;
    const blockCenterY = blockTopY + ((totalLines - 1) * lineStep) / 2;
    let widestLineW = 0;
    for (const line of lines) {
      if (line.length) {
        widestLineW = Math.max(widestLineW, line[line.length - 1].x + line[line.length - 1].w);
      }
    }

    const hasSound = this.hasQuestionSound(q);
    const ui = createHudScaleCtx(this.scale.width, this.scale.height, mobile);
    let speakerSize = 0;
    let speakerGap = 0;
    let speakerX = 0;
    let textCenterX = 0;
    let speakerY = blockCenterY;

    if (hasSound && this.textures.exists(HUD_VOLUME_TEXTURE_KEY)) {
      speakerSize = ui.px(mobile ? 40 : 48);
      speakerGap = ui.px(mobile ? CTS_SENTENCE.speakerGapMobile : CTS_SENTENCE.speakerGapDesktop);
      if (mobile) {
        const leftPad = ui.px(CTS_SENTENCE.wrapPadLeftMobile);
        const speakerBoardX = leftPad + speakerSize / 2;
        speakerX = speakerBoardX - boardCenterX;
        // Keep the sentence centered on the chalkboard. The speaker has its own
        // left lane and should not shift the visual center of the text block.
        textCenterX = 0;
      } else {
        speakerX = -widestLineW / 2 - speakerGap - speakerSize / 2;
        textCenterX = 0;
      }
    }

    let blankIndex = 0;

    for (let li = 0; li < lines.length; li += 1) {
      const line = lines[li];
      const lineWidth = line.length ? line[line.length - 1].x + line[line.length - 1].w : 0;
      const centerShift = -lineWidth / 2 + partGap / 2 + textCenterX;
      const y = blockTopY + li * lineStep;

      for (const { item, x, w } of line) {
        const cx = x + centerShift + w / 2;
        if (item.kind === "text") {
          const needsWrap = this.measureThaiSpanWidth(item.text, sentenceFontPx, 700) > wrapMaxW;
          this.addThaiSpanDom(
            sentenceContainer,
            cx,
            y,
            item.text,
            sentenceFontPx,
            "#ffffff",
            700,
            needsWrap ? wrapMaxW : undefined,
            true
          );
        } else {
          const zone = this.add.container(cx, y);
          const underline = this.add.graphics();
          underline.lineStyle(3, 0xffffff, 1);
          underline.lineBetween(-w / 2 + 4, lineY, w / 2 - 4, lineY);
          zone.add(underline);

          const dropZone = this.add.zone(0, 0, w, blankH);
          dropZone.setRectangleDropZone(w, blankH);
          zone.add(dropZone);

          sentenceContainer.add(zone);
          this.blankSlots.push({
            index: blankIndex,
            correctAnswer: item.answer,
            zone,
            dropZone,
            underline,
            hitW: w,
            hitH: blankH,
            sentenceFontPx,
            filled: false,
          });
          blankIndex += 1;
        }
      }
    }

    if (hasSound && speakerSize > 0) {
      const speakerBoardX = mobile
        ? ui.px(CTS_SENTENCE.wrapPadLeftMobile) + speakerSize / 2
        : boardCenterX + speakerX;
      const speakerBoardY = sentenceLocalY + speakerY;
      this.sentenceSpeaker?.destroy();
      const onSpeakerTap = () => {
        if (q.sound_hint) this.playUrlAudio(q.sound_hint);
        else if (q.sound_question_answer) this.playUrlAudio(q.sound_question_answer);
      };
      if (mobile) {
        const img = document.createElement("img");
        img.src = HUD_VOLUME_ASSET_PATH;
        img.alt = "";
        img.style.width = `${speakerSize}px`;
        img.style.height = `${speakerSize}px`;
        img.style.display = "block";
        img.style.cursor = "pointer";
        img.style.pointerEvents = "auto";
        img.addEventListener("click", (e) => {
          e.preventDefault();
          onSpeakerTap();
        });
        this.sentenceSpeaker = this.add
          .dom(speakerBoardX, speakerBoardY, img)
          .setOrigin(0.5, 0.5)
          .setDepth(30);
      } else {
        this.sentenceSpeaker = this.add
          .image(speakerBoardX, speakerBoardY, HUD_VOLUME_TEXTURE_KEY)
          .setDisplaySize(speakerSize, speakerSize)
          .setOrigin(0.5)
          .setDepth(30)
          .setInteractive({ useHandCursor: true });
        this.sentenceSpeaker.on("pointerdown", onSpeakerTap);
      }
      board.add(this.sentenceSpeaker);
    }
  }

  private collectChoiceOptions(parts: CtsQuestionAnswerPart[]): CtsChoiceOption[] {
    const byText = new Map<string, CtsChoiceOption>();
    const add = (opt: CtsChoiceOption) => {
      const text = opt.text.trim();
      if (!text || byText.has(text)) return;
      byText.set(text, { text, sound: opt.sound, image: opt.image });
    };

    for (const p of parts) {
      if (this.isBlankPart(p) && p.answer) {
        add({
          text: String(p.answer).trim(),
          sound: p.answer_sound,
          image: p.answer_image,
        });
      }
      if (!Array.isArray(p.wrong_answer)) continue;
      for (const w of p.wrong_answer) {
        if (typeof w === "string") {
          if (w.trim()) add({ text: w.trim() });
        } else if (w?.text) {
          add({ text: String(w.text).trim(), sound: w.sound, image: w.image });
        }
      }
    }

    return Phaser.Utils.Array.Shuffle([...byText.values()]);
  }

  private showQuestion(index: number) {
    const questions = this.ctsPayload?.questions ?? [];
    const q = questions[index];
    if (!q) {
      this.endGame();
      return;
    }
    this.currentQuestionIndex = index;
    this.refreshCtsQuestionProgressHud();
    this.clearQuestionUi();
    this.renderQuestion(q);
    this.syncGameAudioFromQuestion(q);
    this.completeQuestionGuidance(q, index);
  }

  private setGuidanceInteractionLocked(locked: boolean) {
    this.guidanceInteractionLocked = locked;

    for (const chip of this.wordChips) {
      if (chip.used) continue;
      const container = chip.container;
      if (locked) {
        this.input.setDraggable(container, false);
        container.disableInteractive();
      } else {
        container.setSize(container.width, container.height);
        container.setInteractive({ useHandCursor: true, draggable: true });
        this.input.setDraggable(container, true);
      }
    }

    for (const blank of this.blankSlots) {
      if (blank.filled) continue;
      if (locked) {
        blank.dropZone.disableInteractive();
      } else {
        blank.dropZone.setInteractive();
        blank.dropZone.setRectangleDropZone(blank.hitW, blank.hitH);
      }
    }
  }

  private completeQuestionGuidance(q: CtsQuestion, questionIndex: number) {
    if (questionIndex === 0) {
      this.startHudElapsedTimer();
    }
    this.scheduleQuestionGuidance(q);
    void this.showCtsTeacherHintAsync(q);
  }

  private renderQuestion(q: CtsQuestion) {
    const board = this.boardContainer;
    const choicesPanel = this.choicePanel;
    const hintRow = this.hintRow;
    if (!board || !choicesPanel || !hintRow) return;

    const parts = q.question_answer ?? [];
    const layout = this.getGameplayLayout();
    const mobile = this.mobile;
    const ui = createHudScaleCtx(this.scale.width, this.scale.height, mobile);
    const sentenceFontPx = mobile ? CTS_FONT.gameplay.sentenceMobile : CTS_FONT.gameplay.sentenceDesktop;
    const partGap = mobile ? 10 : 12;

    board.setPosition(layout.boardX, layout.boardY);
    choicesPanel.setPosition(layout.choiceX, layout.choiceY);
    const hintCenterX =
      (mobile ? this.scale.width / 2 : layout.boardX + layout.boardW / 2) +
      (mobile ? ui.px(CTS_MOBILE_LAYOUT.hintOffsetX) : 0);
    hintRow.setPosition(hintCenterX, layout.hintY);

    this.buildHintRow(q, mobile ? this.scale.width : layout.boardW);

    const hasQuestionSound = this.hasQuestionSound(q);
    const sentenceMetrics = this.resolveSentenceBoardMetrics(
      layout.boardW,
      mobile,
      hasQuestionSound,
      ui
    );
    const sentenceLocalY = layout.sentenceY - layout.boardY;
    const sentenceContainer = this.add.container(
      sentenceMetrics.centerX,
      sentenceLocalY
    );
    board.add(sentenceContainer);
    this.layoutSentenceOnBoard(
      sentenceContainer,
      board,
      sentenceLocalY,
      q,
      parts,
      sentenceMetrics.wrapMaxW,
      layout.boardW,
      sentenceMetrics.centerX,
      mobile,
      sentenceFontPx,
      partGap
    );

    const choices = this.collectChoiceOptions(parts);
    const tc = mobile ? CTS_CHOICE_CARD.mobile : CTS_CHOICE_CARD.desktop;
    const maskRect = this.getChoiceMaskRect(layout.choiceW, layout.choiceH, mobile);
    const bgTex = this.textures.get("cts_chocie_bg").getSourceImage() as { width: number; height: number };
    let chipW = Phaser.Math.Clamp(
      Math.floor(
        layout.choiceW *
          (mobile ? CTS_CHIP.maxWidthRatioMobile : CTS_CHIP.maxWidthRatioDesktop)
      ),
      tc.wMin,
      tc.wMax
    );
    let chipH = computeCtsChoiceCardHeight(chipW, bgTex.width, bgTex.height);
    if (mobile && chipH > maskRect.h * 0.9) {
      chipW = Math.max(tc.wMin, Math.floor(chipW * ((maskRect.h * 0.9) / chipH)));
      chipH = computeCtsChoiceCardHeight(chipW, bgTex.width, bgTex.height);
    }
    const chipGap = mobile ? CTS_CHIP.gapMobile : CTS_CHIP.gapDesktop;
    const choicesInner = this.choiceListInner;
    if (!choicesInner) return;

    this.choiceLayoutCache = {
      horizontal: layout.choiceHorizontal,
      chipW,
      chipGap,
      viewW: layout.choiceW,
      viewH: layout.choiceH,
      choiceW: layout.choiceW,
      choiceH: layout.choiceH,
      mobile,
    };

    choices.forEach((opt) => {
      const chip = this.createWordChip(opt, 0, 0, chipW, chipH, mobile);
      choicesInner.add(chip.container);
      this.wordChips.push(chip);
    });

    const contentSpan = this.layoutActiveChoiceChips(this.wordChips, false);
    const axis = layout.choiceHorizontal ? "x" : "y";
    this.setupChoiceListScroll(layout.choiceW, layout.choiceH, contentSpan, mobile, axis);
  }

  private buildHintRow(q: CtsQuestion, _boardW: number) {
    if (!this.hintRow) return;

    const mobile = this.mobile;
    const ui = createHudScaleCtx(this.scale.width, this.scale.height, mobile);
    const imgUrl = this.resolveUrl(q.image_hint) || this.resolveUrl(q.image_question_answer);
    const imgKey = imgUrl ? this.textureKeyByUrl.get(imgUrl) : undefined;
    const hasImage = !!(imgKey && this.textures.exists(imgKey));
    if (!hasImage || !imgKey) return;

    const tex = this.textures.get(imgKey).getSourceImage() as { width?: number; height?: number };
    const srcW = tex?.width ?? 1;
    const srcH = tex?.height ?? 1;
    const mediaFrame = getQuestionMediaCardFrameSize(
      mobile,
      ui.px.bind(ui),
      this.scale.width,
      this.scale.height
    );
    const mobileFrameMax = ui.px(112);
    const frameW = mobile ? Math.min(mediaFrame.frameW, mobileFrameMax) : mediaFrame.frameW;
    const frameH = mobile ? Math.min(mediaFrame.frameH, mobileFrameMax) : mediaFrame.frameH;
    const framePad = ui.px(mobile ? 10 : 12);
    const fit = fitQuestionMediaContainSize(
      srcW,
      srcH,
      Math.max(1, frameW - framePad * 2),
      Math.max(1, frameH - framePad * 2)
    );

    const frameGfx = this.add.graphics().setDepth(0);
    drawQuestionMediaFrameBox(frameGfx, frameW, frameH);
    this.hintRow.add(frameGfx);

    const img = this.add
      .image(0, 0, imgKey)
      .setOrigin(0.5)
      .setDepth(1)
      .setDisplaySize(fit.imageW, fit.imageH);
    this.hintRow.add(img);
  }

  private addCtsChoiceSpeaker(
    card: Phaser.GameObjects.Container,
    x: number,
    y: number,
    size: number,
    soundUrl?: string | null
  ): Phaser.GameObjects.Image {
    const spk = this.add
      .image(x, y, HUD_VOLUME_TEXTURE_KEY)
      .setDisplaySize(size, size)
      .setOrigin(0.5)
      .setDepth(20)
      .setInteractive({ useHandCursor: true });
    spk.on(
      "pointerdown",
      (_p: Phaser.Input.Pointer, _lx: number, _ly: number, event: Phaser.Types.Input.EventData) => {
        event.stopPropagation();
        this.playUrlChoiceAudio(soundUrl);
      }
    );
    card.add(spk);
    return spk;
  }

  private createWordChip(
    option: CtsChoiceOption,
    x: number,
    y: number,
    cardW: number,
    cardH: number,
    mobile: boolean
  ): WordChip {
    const text = option.text.trim();
    const word = text;
    const hasText = word.length > 0;
    const tc = mobile ? CTS_CHOICE_CARD.mobile : CTS_CHOICE_CARD.desktop;
    const imageKey = this.getTextureKeyForUrl(option.image);
    const hasImage = !!imageKey && this.textures.exists(imageKey);
    const hasSound = !!this.resolveUrl(option.sound);
    const imgKey = hasImage ? imageKey : undefined;
    const textRes = Math.min(3, typeof window !== "undefined" ? window.devicePixelRatio || 2 : 2);
    const speakerSize = tc.speakerSize;
    const chipH = hasImage ? Math.max(cardH, tc.imageCardH) : cardH;

    const container = this.add.container(x, y);
    const bgTex = this.textures.get("cts_chocie_bg").getSourceImage() as { width?: number };
    const bgScale = cardW / Math.max(1, bgTex.width ?? 1);
    const bg =
      hasImage ?
        this.add.image(0, 0, "cts_chocie_bg").setDisplaySize(cardW, chipH)
      : this.add.image(0, 0, "cts_chocie_bg").setScale(bgScale);
    container.add(bg);
    const bW = bg.displayWidth;
    const bH = bg.displayHeight;
    const boxBottom = getChocieInnerBottom(bH, tc.labelBoxBottomTrim);

    if (hasImage && imgKey) {
      const {
        frameW,
        frameH,
        frameCenterY,
        frameBottom,
        frameLeft,
        textCenterY,
      } = resolveCtsChoiceImageFrameLayout(
        bH,
        bW,
        tc,
        mobile,
        hasText,
        hasSound,
        speakerSize
      );
      const frame = this.add.graphics().setDepth(8);
      frame.setPosition(0, frameCenterY);
      drawQuestionMediaFrameBox(frame, frameW, frameH);
      container.add(frame);

      const tex = this.textures.get(imgKey).getSourceImage() as { width: number; height: number };
      const imgPad = mobile ? 6 : 8;
      const fit = fitQuestionMediaContainSize(
        tex.width,
        tex.height,
        Math.max(1, frameW - imgPad * 2),
        Math.max(1, frameH - imgPad * 2)
      );
      container.add(
        this.add
          .image(0, frameCenterY, imgKey)
          .setDisplaySize(fit.imageW, fit.imageH)
          .setDepth(9)
      );

      if (hasText && textCenterY !== undefined) {
        const mtc = mobile ? CTS_CHOICE_CARD.mobile : null;
        const fullWidthPill = !!(mobile && mtc?.imageTextFullWidthMobile);
        const pillPadX = mobile ? 6 : 10;
        const pillH = mobile ? (mtc?.imageTextPillHMobile ?? 38) : 36;
        const pillW = fullWidthPill ? frameW : undefined;
        const boxInnerW = getChocieInnerWidth(bW, mobile);
        const maxPillW =
          pillW ??
          (hasSound
            ? Math.max(tc.textPillMinW, boxInnerW - speakerSize * 0.65)
            : boxInnerW);
        const minPillW = fullWidthPill ? maxPillW : tc.textPillMinW;
        const imageTextFont = {
          baseFont: mtc?.imageTextBaseFontMobile ?? 22,
          minFont: 13,
          maxFont: mtc?.imageTextMaxFontMobile ?? 34,
        };
        const { pillW: resolvedPillW, fontPx } = resolveChocieChoiceTextMetrics(
          word,
          mobile,
          pillPadX,
          minPillW,
          maxPillW,
          fullWidthPill ? imageTextFont : {
            baseFont: mobile ? 15 : 20,
            minFont: mobile ? 12 : 14,
            maxFont: mobile ? 28 : 32,
          }
        );
        const finalPillW = pillW ?? resolvedPillW;
        const overlay = computeCtsChoiceTextOverlayLayout(
          textCenterY,
          speakerSize,
          mobile,
          hasSound,
          finalPillW,
          tc.speakerPillOverlap,
          fullWidthPill ? pillH : undefined
        );

        const pillGfx = this.add.graphics().setDepth(11);
        drawQuestionMediaOverlayTextPill(
          pillGfx,
          overlay.pillLeft,
          overlay.pillTop,
          overlay.pillW,
          overlay.pillH,
          mobile ? 8 : 10,
          mobile ? 2 : 3
        );
        container.add(pillGfx);
        container.add(
          this.add
            .text(overlay.textCenterX, overlay.textCenterY, word, {
              ...chocieThaiGameTextStyle({
                mobile,
                fontPx,
                tightBottom: true,
              }),
            })
            .setOrigin(0.5, 0.5)
            .setDepth(12)
            .setResolution(textRes)
        );

        if (hasSound) {
          this.addCtsChoiceSpeaker(
            container,
            overlay.speakerX,
            overlay.speakerY,
            overlay.speakerSize,
            option.sound
          );
        }
      } else if (hasSound) {
        this.addCtsChoiceSpeaker(
          container,
          frameLeft + speakerSize * 0.28,
          frameBottom,
          speakerSize,
          option.sound
        );
      }
    } else if (hasText) {
      const pillH = mobile ? 34 : 40;
      const pillPadX = mobile ? 10 : 12;
      const boxInnerW = getChocieInnerWidth(bW, mobile);
      const boxCenterY = getChocieInnerCenterY(bH, tc.labelBoxTopTrim, tc.labelBoxBottomTrim);
      const fontOpts = {
        baseFont: mobile ? 18 : 24,
        minFont: mobile ? 14 : 18,
        maxFont: mobile ? 30 : 38,
      };

      if (hasSound) {
        const maxPillW = Math.max(tc.textPillMinW, boxInnerW - speakerSize * 0.65);
        const { pillW, fontPx } = resolveChocieChoiceTextMetrics(
          word,
          mobile,
          pillPadX,
          tc.textPillMinW,
          maxPillW,
          fontOpts
        );
        const layout = computeChocieChoiceTextSoundLayout(
          pillW,
          pillH,
          speakerSize,
          boxCenterY,
          tc.speakerPillOverlap
        );
        const pillGfx = this.add.graphics().setDepth(10);
        drawQuestionMediaOverlayTextPill(
          pillGfx,
          layout.pillLeft,
          layout.pillTop,
          layout.pillW,
          layout.pillH,
          mobile ? 10 : 12,
          mobile ? 2 : 3
        );
        container.add(pillGfx);
        container.add(
          this.add
            .text(layout.textCenterX, layout.textCenterY, word, {
              ...chocieThaiGameTextStyle({
                mobile,
                fontPx,
                tightBottom: true,
              }),
            })
            .setOrigin(0.5, 0.5)
            .setDepth(11)
            .setResolution(textRes)
        );
        this.addCtsChoiceSpeaker(
          container,
          layout.speakerX,
          layout.speakerY,
          layout.speakerSize,
          option.sound
        );
      } else {
        const { pillW, fontPx } = resolveChocieChoiceTextMetrics(
          word,
          mobile,
          pillPadX,
          tc.textPillMinW,
          boxInnerW,
          fontOpts
        );
        const pillLeft = -pillW / 2;
        const pillTop = boxCenterY - pillH / 2;
        const pillGfx = this.add.graphics().setDepth(10);
        drawQuestionMediaOverlayTextPill(
          pillGfx,
          pillLeft,
          pillTop,
          pillW,
          pillH,
          mobile ? 10 : 12,
          mobile ? 2 : 3
        );
        container.add(pillGfx);
        container.add(
          this.add
            .text(0, boxCenterY, word, {
              ...chocieThaiGameTextStyle({
                mobile,
                fontPx,
                tightBottom: true,
              }),
            })
            .setOrigin(0.5, 0.5)
            .setDepth(11)
            .setResolution(textRes)
        );
      }
    } else if (hasSound) {
      const boxCenterY = getChocieInnerCenterY(bH, tc.labelBoxTopTrim, tc.labelBoxBottomTrim);
      this.addCtsChoiceSpeaker(container, 0, boxCenterY, speakerSize, option.sound);
    }

    container.setSize(bW, chipH);
    container.setInteractive({ useHandCursor: true, draggable: true });
    this.input.setDraggable(container);

    const chip: WordChip = {
      text,
      container,
      homeX: x,
      homeY: y,
      chipH,
      hasImage,
      used: false,
      dragGrabOffsetX: 0,
      dragGrabOffsetY: 0,
    };
    container.setData("ctsChip", chip);

    container.on("dragstart", (pointer: Phaser.Input.Pointer) => {
      if (chip.used || this.guidanceInteractionLocked) return;

      const gesture = this.choiceGesture;
      if (gesture?.chip === chip) {
        if (gesture.mode === "scroll") {
          this.suppressChipDrag(chip);
          return;
        }
        if (gesture.mode === "undecided") {
          const dx = pointer.x - gesture.startX;
          const dy = pointer.y - gesture.startY;
          if (this.shouldStartChoiceScrollGesture(dx, dy)) {
            gesture.mode = "scroll";
            this.suppressChipDrag(chip);
            return;
          }
          gesture.mode = "chip";
        }
      }

      this.dragChip = chip;
      this.floatChipForDrag(chip, pointer);
      container.setScale(1.04);
    });

    container.on("drag", (pointer: Phaser.Input.Pointer, dragX: number, dragY: number) => {
      if (chip.used) return;
      if (this.choiceGesture?.mode === "scroll" && this.choiceGesture.chip === chip) return;
      if (container.parentContainer === this.gameplayRoot) {
        container.setPosition(
          pointer.x - chip.dragGrabOffsetX,
          pointer.y - chip.dragGrabOffsetY
        );
      } else {
        container.setPosition(dragX, dragY);
      }
    });

    container.on("dragend", () => {
      if (this.choiceGesture?.mode === "scroll" && this.choiceGesture.chip === chip) {
        this.restoreChipDrag(chip);
        return;
      }
      container.setScale(1);
      this.onChipDragEnd(chip);
    });

    return chip;
  }

  private onChipDragEnd(chip: WordChip) {
    this.dragChip = undefined;
    if (chip.used) return;

    const chipBounds = chip.container.getBounds();
    const drop = this.findBlankAt(chipBounds.centerX, chipBounds.centerY);
    if (!drop || drop.filled) {
      this.snapChipHome(chip);
      return;
    }

    this.clearQuestionVoicePlayback();

    if (chip.text !== drop.correctAnswer) {
      this.playSfx("sfx_incorrect");
      this.playWrongSentenceBlinkFx();
      this.snapChipHome(chip);
      this.bumpQuestionIdleNudge();
      this.loseLife();
      if (this.endingRun) return;
      const q = this.ctsPayload?.questions[this.currentQuestionIndex];
      if (q?.hint) {
        this.ctsShowTeacherMessage(` ${q.hint}`, 3200, "point");
      } else {
        this.ctsShowTeacherMessage("ลองอีกครั้งนะ", 2200, "point");
      }
      return;
    }

    drop.filled = true;
    drop.dropZone.disableInteractive();
    chip.used = true;
    this.score += SCORE_PER_BLANK;
    this.refreshHudScore();
    this.playSfx("sfx_coin_collect");

    const blankBounds = drop.zone.getBounds();
    this.playCorrectAnswerFx(blankBounds.centerX, blankBounds.centerY);

    drop.underline.clear();
    drop.underline.setVisible(false);

    drop.filledLabel = this.addThaiSpanDom(
      drop.zone,
      0,
      0,
      chip.text,
      drop.sentenceFontPx,
      "#ffffff",
      700
    );

    this.parkUsedChoiceChip(chip);
    this.reflowChoiceChips();
    this.bumpQuestionIdleNudge();

    if (this.blankSlots.every((b) => b.filled)) {
      this.clearQuestionGuidanceTimers();
      this.reportRunstateQuestionCompleted(this.currentQuestionIndex + 1);
      this.ctsShowTeacherMessage(
        Phaser.Utils.Array.GetRandom([...CTS_TEACHER_PRAISE]),
        2400,
        "clap"
      );
      this.time.delayedCall(900, () => {
        if (this.endingRun) return;
        const next = this.currentQuestionIndex + 1;
        if (next >= (this.ctsPayload?.questions.length ?? 0)) {
          this.gameFailedByNoLives = false;
          this.triggerCtsGameOver();
        } else {
          this.showQuestion(next);
        }
      });
    }
  }

  private parkUsedChoiceChip(chip: WordChip) {
    chip.container.parentContainer?.remove(chip.container);
    chip.container.setVisible(false);
    chip.container.disableInteractive();
    this.input.setDraggable(chip.container, false);
  }

  /** จัดตำแหน่งชิปในรายการ — คืนค่าความยาว/สูงรวมสำหรับ scroll */
  private layoutActiveChoiceChips(active: WordChip[], animate: boolean): number {
    const cache = this.choiceLayoutCache;
    const inner = this.choiceListInner;
    if (!cache || !inner || active.length === 0) return 0;

    const sorted = [...active].sort((a, b) =>
      cache.horizontal ? a.homeX - b.homeX : a.homeY - b.homeY
    );
    const viewRect = this.getChoiceMaskRect(cache.viewW, cache.viewH, cache.mobile);
    const ui = createHudScaleCtx(this.scale.width, this.scale.height, cache.mobile);
    let contentSpan = 0;

    if (cache.horizontal) {
      const w = cache.chipW;
      const n = sorted.length;
      contentSpan = sorted.reduce((sum, chip, i) => {
        const gap = i < n - 1 ? getCtsChoiceStackGap(chip, sorted[i + 1], cache.chipGap, cache.mobile) : 0;
        return sum + w + gap;
      }, 0);
      const overflow = contentSpan > viewRect.w;
      const rowOffsetX = overflow ? 0 : (viewRect.w - contentSpan) / 2;
      const rowY = viewRect.y + viewRect.h * CTS_MOBILE_LAYOUT.choiceRowYRatio;
      let cursorX = viewRect.x + rowOffsetX + ui.px(CTS_MOBILE_LAYOUT.choiceOffsetX) + w / 2;

      sorted.forEach((chip, i) => {
        this.placeChoiceChip(chip, cursorX, rowY, inner, animate);
        if (i < sorted.length - 1) {
          cursorX += w + getCtsChoiceStackGap(chip, sorted[i + 1], cache.chipGap, cache.mobile);
        }
      });
    } else {
      const totalStackH = sorted.reduce((sum, chip, i) => {
        const gap =
          i < sorted.length - 1 ?
            getCtsChoiceStackGap(chip, sorted[i + 1], cache.chipGap, cache.mobile)
          : 0;
        return sum + chip.chipH + gap;
      }, 0);
      contentSpan = totalStackH;
      const fits = totalStackH <= viewRect.h;
      let cursorY =
        fits ?
          viewRect.y + (viewRect.h - totalStackH) / 2 + sorted[0].chipH / 2
        : viewRect.y + sorted[0].chipH / 2;

      sorted.forEach((chip, i) => {
        const x = cache.choiceW / 2;
        this.placeChoiceChip(chip, x, cursorY, inner, animate);
        if (i < sorted.length - 1) {
          cursorY += chip.chipH + getCtsChoiceStackGap(chip, sorted[i + 1], cache.chipGap, cache.mobile);
        }
      });
    }

    return contentSpan;
  }

  private placeChoiceChip(
    chip: WordChip,
    x: number,
    y: number,
    inner: Phaser.GameObjects.Container,
    animate: boolean
  ) {
    if (chip.container.parentContainer !== inner) {
      inner.add(chip.container);
    }
    chip.homeX = x;
    chip.homeY = y;
    chip.container.setDepth(0);
    chip.container.setVisible(true);
    this.tweens.killTweensOf(chip.container);

    if (!animate) {
      chip.container.setPosition(x, y);
      return;
    }

    const fromX = chip.container.x;
    const fromY = chip.container.y;
    chip.container.setPosition(fromX, fromY);
    if (Math.abs(fromX - x) < 1 && Math.abs(fromY - y) < 1) {
      chip.container.setPosition(x, y);
      return;
    }
    this.tweens.add({
      targets: chip.container,
      x,
      y,
      duration: 220,
      ease: "Power2.easeOut",
      onComplete: () => chip.container.setPosition(chip.homeX, chip.homeY),
    });
  }

  /** จัดชิปที่เหลือให้ชิดกันไม่เว้นช่องว่าง (หลังตอบถูก) */
  private reflowChoiceChips() {
    const cache = this.choiceLayoutCache;
    if (!cache) return;

    const active = this.wordChips.filter((c) => !c.used);
    if (active.length === 0) {
      this.teardownChoiceScroll();
      return;
    }

    const contentSpan = this.layoutActiveChoiceChips(active, true);
    const axis = cache.horizontal ? "x" : "y";
    this.setupChoiceListScroll(cache.viewW, cache.viewH, contentSpan, cache.mobile, axis);
  }

  private findBlankAt(worldX: number, worldY: number): BlankSlot | undefined {
    for (const blank of this.blankSlots) {
      if (blank.filled) continue;
      const bounds = blank.zone.getBounds();
      const pad = this.mobile ? 18 : 24;
      bounds.x -= pad;
      bounds.y -= pad;
      bounds.width += pad * 2;
      bounds.height += pad * 2;
      if (bounds.contains(worldX, worldY)) return blank;
    }
    return undefined;
  }

  private snapChipHome(chip: WordChip) {
    const container = chip.container;
    const inner = this.choiceListInner;
    if (!inner) return;

    container.setScale(1);
    container.setVisible(true);
    container.setDepth(0);
    this.tweens.killTweensOf(container);

    let fromX = chip.homeX;
    let fromY = chip.homeY;
    if (container.parentContainer !== inner) {
      const wt = container.getWorldTransformMatrix();
      const local = new Phaser.Math.Vector2();
      inner.getLocalPoint(wt.tx, wt.ty, local);
      inner.add(container);
      fromX = local.x;
      fromY = local.y;
    } else {
      fromX = container.x;
      fromY = container.y;
    }

    container.setPosition(fromX, fromY);
    const dist = Phaser.Math.Distance.Between(fromX, fromY, chip.homeX, chip.homeY);
    if (dist < 3) {
      container.setPosition(chip.homeX, chip.homeY);
      this.syncChoiceChipClipVisibility();
      return;
    }

    this.tweens.add({
      targets: container,
      x: chip.homeX,
      y: chip.homeY,
      duration: 220,
      ease: "Back.easeOut",
      onComplete: () => {
        container.setPosition(chip.homeX, chip.homeY);
        container.setVisible(true);
        this.syncChoiceChipClipVisibility();
      },
    });
  }

  private showIntroTutorialBubble(): Promise<void> {
    return new Promise((resolve) => {
      this.ensureCtsTeacherHintUI();
      this.teacherMessageKind = "intro";
      this.setGuidanceInteractionLocked(true);
      const text = this.mobile ? CTS_TEACHER_COPY.introMobile : CTS_TEACHER_COPY.introDesktop;
      this.ctsShowTeacherMessage(text, CTS_TEACHER_COPY.introDurationMs, "point", "intro");
      this.time.delayedCall(CTS_TEACHER_COPY.introDurationMs + 200, () => {
        this.teacherMessageKind = "normal";
        this.setGuidanceInteractionLocked(false);
        resolve();
      });
    });
  }

  private clearQuestionGuidanceTimers() {
    this.questionScrollHintDelayEvent?.destroy();
    this.questionScrollHintDelayEvent = undefined;
    this.scrollHintReminderEvent?.destroy();
    this.scrollHintReminderEvent = undefined;
    this.questionIdleNudgeEvent?.destroy();
    this.questionIdleNudgeEvent = undefined;
  }

  private hasScrollableChoices(): boolean {
    return (this.choiceScrollRuntime?.maxScroll ?? 0) > 0;
  }

  private getScrollChoiceHintText(): string {
    return this.mobile ? CTS_TEACHER_COPY.scrollMobile : CTS_TEACHER_COPY.scrollDesktop;
  }

  private markChoiceScrollInteracted() {
    if (this.questionScrollInteracted) return;
    this.questionScrollInteracted = true;
    this.scrollHintReminderEvent?.destroy();
    this.scrollHintReminderEvent = undefined;
    if (this.teacherMessageKind === "scroll-hint") {
      this.hideCtsTeacherMessage();
      this.teacherMessageKind = "normal";
    }
  }

  private showScrollChoiceHintBubble() {
    if (this.questionScrollInteracted || !this.hasScrollableChoices()) return;
    this.teacherMessageKind = "scroll-hint";
    this.ctsShowTeacherMessage(
      this.getScrollChoiceHintText(),
      CTS_TEACHER_COPY.scrollHintDurationMs,
      "point",
      "scroll-hint"
    );
  }

  private scheduleScrollHintReminder() {
    this.scrollHintReminderEvent?.destroy();
    if (this.questionScrollInteracted || !this.hasScrollableChoices()) return;
    this.scrollHintReminderEvent = this.time.delayedCall(CTS_TEACHER_COPY.scrollHintRepeatMs, () => {
      if (this.questionScrollInteracted || !this.hasScrollableChoices()) return;
      if (this.teacherMessageKind !== "scroll-hint") {
        this.showScrollChoiceHintBubble();
      }
      this.scheduleScrollHintReminder();
    });
  }

  private maybeShowScrollChoiceHint() {
    if (this.questionScrollInteracted || !this.hasScrollableChoices()) return;
    this.showScrollChoiceHintBubble();
    this.scheduleScrollHintReminder();
  }

  private scheduleQuestionGuidance(q: CtsQuestion) {
    this.questionScrollHintDelayEvent?.destroy();
    this.questionScrollHintDelayEvent = this.time.delayedCall(5600, () => {
      this.maybeShowScrollChoiceHint();
    });
    this.resetQuestionIdleNudge(q);
  }

  private isQuestionFullyAnswered(): boolean {
    return this.blankSlots.length > 0 && this.blankSlots.every((b) => b.filled);
  }

  private resetQuestionIdleNudge(q: CtsQuestion) {
    this.questionIdleNudgeEvent?.destroy();
    this.questionIdleNudgeEvent = this.time.delayedCall(CTS_TEACHER_COPY.idleNudgeDelayMs, () => {
      if (this.endingRun || this.isQuestionFullyAnswered()) return;
      this.showIdleNudgeBubble(q);
      this.resetQuestionIdleNudge(q);
    });
  }

  private bumpQuestionIdleNudge() {
    if (this.isQuestionFullyAnswered()) {
      this.questionIdleNudgeEvent?.destroy();
      this.questionIdleNudgeEvent = undefined;
      return;
    }
    const q = this.ctsPayload?.questions[this.currentQuestionIndex];
    if (q) this.resetQuestionIdleNudge(q);
  }

  private showIdleNudgeBubble(q: CtsQuestion) {
    if (this.endingRun || this.isQuestionFullyAnswered()) return;
    if (this.teacherMessageKind === "scroll-hint") return;

    const pool: string[] = [...CTS_TEACHER_COPY.idlePool];
    const hint = (q.hint ?? "").trim();
    if (hint) pool.push(hint);
    this.teacherMessageKind = "idle";
    this.ctsShowTeacherMessage(
      Phaser.Utils.Array.GetRandom(pool),
      CTS_TEACHER_COPY.idleNudgeDurationMs,
      "point",
      "idle"
    );
  }

  private showCtsTeacherHintAsync(q: CtsQuestion): Promise<void> {
    this.ensureCtsTeacherHintUI();
    const hint = (q.hint ?? "").trim();
    const imgUrl = this.resolveUrl(q.image_hint);
    const imgKey =
      imgUrl && this.textureKeyByUrl.has(imgUrl) ? (this.textureKeyByUrl.get(imgUrl) as string) : undefined;
    const hintDurationMs = 5200;

    this.cancelPendingQuestionVoice();
    this.questionVoiceDelayEvent = this.time.delayedCall(800, () => {
      this.questionVoiceDelayEvent = undefined;
      if (this.endingRun) return;
      if (q.sound_hint) this.playUrlAudio(q.sound_hint);
      else if (q.sound_question_answer) this.playUrlAudio(q.sound_question_answer);
    });

    if (!hint && !imgKey) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      this.time.delayedCall(400, () => {
        if (this.endingRun) {
          resolve();
          return;
        }
        this.teacherMessageKind = "question-hint";
        this.teacherHintUI?.presentHint({
          text: hint,
          hintTextureKey: imgKey,
          durationMs: hintDurationMs,
          teacherState: "point",
        });
        this.scheduleTeacherMessageFollowUp("question-hint", hintDurationMs + 180);
        this.time.delayedCall(hintDurationMs + 200, () => resolve());
      });
    });
  }

  private ensureCtsTeacherHintUI() {
    if (this.teacherHintUI) return;

    this.teacherHintUI = new TeacherHintUI(this, {
      mobile: this.mobile,
      depth: 2600,
      messageDepth: 2650,
      onNotificationSfx: () => this.playSfx("sfx_notification_message", 0.55),
    });
    this.teacherHintUI.create("standby", true);
  }

  private clearTeacherMessageFollowUp() {
    this.teacherMessageFollowUpEvent?.destroy();
    this.teacherMessageFollowUpEvent = undefined;
  }

  private scheduleTeacherMessageFollowUp(kind: CtsTeacherMessageKind, delayMs: number) {
    this.clearTeacherMessageFollowUp();
    this.teacherMessageFollowUpEvent = this.time.delayedCall(delayMs, () => {
      if (this.teacherMessageKind !== kind) return;
      this.onCtsTeacherMessageHidden(kind);
    });
  }

  private onCtsTeacherMessageHidden(kind: CtsTeacherMessageKind) {
    if (this.teacherMessageKind !== kind) return;
    const wasScrollHint = kind === "scroll-hint";
    this.teacherMessageKind = "normal";
    if (wasScrollHint && !this.questionScrollInteracted && this.hasScrollableChoices()) {
      this.scheduleScrollHintReminder();
    }
  }

  private ctsShowTeacherMessage(
    text: string,
    durationMs = 2800,
    state: TeacherState = "point",
    kind: CtsTeacherMessageKind = "normal"
  ) {
    this.ensureCtsTeacherHintUI();
    const clean = (text ?? "").trim();
    if (!clean) return;

    this.teacherMessageKind = kind;
    this.teacherHintUI?.present({
      text: clean,
      durationMs: durationMs > 0 ? durationMs : 0,
      teacherState: state,
      resetHintBeforeShow: kind !== "question-hint",
    });

    if (durationMs > 0) {
      this.scheduleTeacherMessageFollowUp(kind, durationMs + 180);
    }
  }

  private hideCtsTeacherMessage() {
    const kind = this.teacherMessageKind;
    this.clearTeacherMessageFollowUp();
    this.teacherHintUI?.hide();
    this.onCtsTeacherMessageHidden(kind);
  }

  private destroyCtsTeacher() {
    this.clearQuestionGuidanceTimers();
    this.clearTeacherMessageFollowUp();
    this.teacherHintUI?.destroy();
    this.teacherHintUI = undefined;
    this.teacherMessageKind = "normal";
  }

  private destroyGameplay() {
    this.clearQuestionUi();
    this.teardownChoiceScroll();
    this.choicePanel?.clearMask(true);
    this.choiceClipMaskGfx?.destroy();
    this.choiceClipMaskGfx = undefined;
    this.choiceClipMask = undefined;
    this.gameplayRoot?.destroy(true);
    this.gameplayRoot = undefined;
    this.boardContainer = undefined;
    this.choicePanel = undefined;
    this.choiceListInner = undefined;
    this.hintRow = undefined;
  }

  private destroyCtsBgmSound(sound: Phaser.Sound.BaseSound) {
    try {
      sound.stop();
      sound.destroy();
    } catch {
      /* already destroyed */
    }
  }

  private fadeOutAndDestroyCtsBgm(sound: Phaser.Sound.BaseSound, fadeMs: number) {
    if (fadeMs <= 0 || !sound.isPlaying) {
      this.destroyCtsBgmSound(sound);
      return;
    }
    this.tweens.add({
      targets: sound,
      volume: 0,
      duration: fadeMs,
      onComplete: () => this.destroyCtsBgmSound(sound),
    });
  }

  /** เปลี่ยน BGM (fade out ของเดิม → fade in ของใหม่) */
  private playCtsBgm(key: string, volume = GAME_BGM_VOLUME_FADE, fadeMs = 420) {
    if (!canPlayGameAudio("background")) {
      this.stopCtsBgm(0);
      return;
    }
    if (this.ctsBgmCurrentKey === key && this.ctsBgmCurrent?.isPlaying) return;

    const oldBgm = this.ctsBgmCurrent;
    this.ctsBgmCurrent = undefined;
    this.ctsBgmCurrentKey = undefined;
    if (oldBgm) this.fadeOutAndDestroyCtsBgm(oldBgm, fadeMs);

    if (!this.cache.audio.exists(key)) return;
    const next = this.sound.add(key, { loop: true, volume: 0 });
    next.play();
    this.ctsBgmCurrent = next;
    this.ctsBgmCurrentKey = key;
    this.tweens.add({
      targets: next,
      volume,
      duration: fadeMs,
      onComplete: () => {
        if (this.ctsBgmCurrent !== next) return;
        try {
          if (next.isPlaying) next.setVolume(volume);
        } catch {
          /* noop */
        }
      },
    });
  }

  private stopCtsBgm(fadeMs = 300) {
    const old = this.ctsBgmCurrent;
    this.ctsBgmCurrent = undefined;
    this.ctsBgmCurrentKey = undefined;
    if (!old) return;
    this.fadeOutAndDestroyCtsBgm(old, fadeMs);
  }

  private stopCtsEndSound() {
    const end = this.ctsEndSound;
    this.ctsEndSound = undefined;
    if (!end) return;
    this.destroyCtsBgmSound(end);
  }

  /** เล่นเสียงจบครั้งเดียว แล้วกลับ bgm_home ก่อนเปิดหน้าผล */
  private playCtsEndThenHome(onDone: () => void) {
    this.stopCtsBgm(280);
    this.stopCtsEndSound();

    const finish = () => {
      if (!this.scene.isActive()) return;
      onDone();
    };

    if (!canPlayGameAudio("background")) {
      finish();
      return;
    }
    if (!this.cache.audio.exists("cts_bgm_end")) {
      this.playCtsBgm("cts_bgm_home");
      finish();
      return;
    }

    const endVol = GAME_BGM_VOLUME_END;
    const end = this.sound.add("cts_bgm_end", { loop: false, volume: 0 });
    this.ctsEndSound = end;
    end.once(Phaser.Sound.Events.COMPLETE, () => {
      if (this.ctsEndSound !== end) return;
      this.stopCtsEndSound();
      this.playCtsBgm("cts_bgm_home");
      finish();
    });
    end.play();
    this.tweens.add({
      targets: end,
      volume: endVol,
      duration: 280,
    });
  }

  private playSfx(key: string, volume = 1) {
    guardedScenePlay(this, key, volume);
  }

  private setHomeSceneUiVisible(visible: boolean) {
    const homeScene = this.scene.get("HomeScene") as Phaser.Scene | undefined;
    if (!homeScene?.scene?.isActive()) return;
    homeScene.children.each((child) => {
      if ("setVisible" in child && typeof child.setVisible === "function") {
        child.setVisible(visible);
      }
    });
  }

  private createHowtoOverlayImage(
    howToKey: string,
    width: number,
    height: number
  ): { image: Phaser.GameObjects.Image; startY: number } | null {
    if (!this.textures.exists(howToKey)) return null;
    this.textures.get(howToKey).setFilter(Phaser.Textures.FilterMode.LINEAR);

    const source = this.textures.get(howToKey).getSourceImage() as { width?: number; height?: number };
    const srcW = source?.width ?? 1;
    const srcH = source?.height ?? 1;
    const imageMaxW = this.mobile ? width * 0.96 : width * 0.8;
    const imageMaxH = this.mobile ? height * 0.78 : height * 0.66;
    const imageScale = Math.min(imageMaxW / srcW, imageMaxH / srcH);
    const howToW = Math.max(1, srcW * imageScale);
    const howToH = Math.max(1, srcH * imageScale);
    const howToY = height * (this.mobile ? 0.38 : 0.42);
    const image = this.add.image(width / 2, howToY, howToKey).setScrollFactor(0).setDepth(3501);
    image.setDisplaySize(howToW, howToH);
    const startY = Math.min(height - 36, howToY + howToH / 2 + (this.mobile ? 50 : 60));
    return { image, startY };
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

    if (this.mobile) {
      this.howtoViewActive = true;
      this.layoutHowtoBackground(width, height);
      this.setHomeSceneUiVisible(false);
    }

    const howToKey = this.mobile ? "cts_howto_mobile" : "cts_howto_desktop";
    const howtoOverlay = this.createHowtoOverlayImage(howToKey, width, height);
    if (!howtoOverlay) {
      this.input.enabled = restoreSceneInputEnabled;
      if (homeScene?.input) homeScene.input.enabled = restoreHomeInputEnabled;
      if (this.mobile) {
        this.howtoViewActive = false;
        this.setHomeSceneUiVisible(true);
        this.layoutHomeBackground(width, height);
      }
      return;
    }
    const { image: howToImage, startY } = howtoOverlay;

    const startKey = "cts_btn_start";
    if (!this.textures.exists(startKey)) {
      this.input.enabled = restoreSceneInputEnabled;
      if (homeScene?.input) homeScene.input.enabled = restoreHomeInputEnabled;
      howToImage.destroy();
      if (this.mobile) {
        this.howtoViewActive = false;
        this.setHomeSceneUiVisible(true);
        this.layoutHomeBackground(width, height);
      }
      return;
    }

    const ui = this.savedHomeData?.ui;
    const startTargetW = ui?.startButtonWidth ?? (this.mobile ? 220 : 280);
    const startButton = this.add
      .image(width / 2, startY, startKey)
      .setScrollFactor(0)
      .setDepth(3502)
      .setInteractive({ useHandCursor: true });
    this.applyHowtoStartButtonSize(startButton, startTargetW);
    this.attachHowtoStartButtonHover(startButton);

    const startGameFromHowto = () => {
      this.playSfx("sfx_click_default", 1);
      this.howtoViewActive = false;
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
    popup?.howToImage?.destroy();
    popup?.startButton.destroy();
    if (popup && !options?.preserveInputForImmediateStart) {
      if (this.howtoViewActive && !this.gameplayStarted) {
        this.howtoViewActive = false;
        this.setHomeSceneUiVisible(true);
        this.layoutHomeBackground();
      }
      this.input.enabled = popup.restoreSceneInputEnabled;
      const homeScene = this.scene.get("HomeScene");
      if (homeScene?.input && this.scene.isActive("HomeScene")) {
        homeScene.input.enabled = popup.restoreHomeInputEnabled;
      }
    }
  }
}
