import Phaser from "phaser";
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
import { API_BASE_URL } from "../../core/api";
import type { HomeActionPayload } from "../../core/scenes/HomeScene";
import { TeacherHintUI } from "../../core/teacher/TeacherHintUI";
import type { TeacherState } from "../../core/teacher/TeacherAssistant";
import {
  canPlayGameAudio,
  GAME_BGM_VOLUME,
  guardedScenePlay,
  guardedScenePlayChoice,
  guardedScenePlayQuestion,
  guardedScenePlayQuestionThen,
  guardedScenePlayVoice,
} from "../../core/audio/sceneAudio";
import { createHudScaleCtx } from "../../utils/desktopUiScale";
import { isMobileLayout } from "../../utils/device";
import {
  CHOCIE_CHOICE_TUNING,
  chocieThaiGameTextStyle,
  computeChocieChoiceBoxBottomOverlayLayout,
  computeChocieChoiceTextSoundLayout,
  getChocieInnerCenterY,
  getChocieInnerWidth,
  resolveChocieChoiceImageFrameLayout,
  resolveChocieChoiceTextMetrics,
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
  resolveQuestionHudTextPillBox,
  resolveQuestionMediaCardTextOverlay,
  type QuestionMediaLayoutResult,
} from "../../utils/questionHudMedia";

type FlyingFruitsChoice = {
  id: number;
  id_question_multiple: number;
  choice: string;
  is_correct: boolean;
  sound_choice: string;
  image_choice: string;
}

type FlyingFruitsQuestion = {
  id: number;
  id_game_info: number;
  no: number;
  question: string;
  sound_question: string;
  image_question: string;
  hint?: string | null;
  sound_hint?: string | null;
  image_hint?: string | null;
  choices: FlyingFruitsChoice[];
};

type FlyingFruitsPayload = {
  game_info: {
    id: number;
    uuid: string;
    exercise_name: string;
    description?: string | null;
    subject: string;
    question_type: string;
    game_type: string;
    thumbnail: string;
    question_category_id: number;
    other_image: string;
    suggestion: string;
  };
  questions: FlyingFruitsQuestion[];
}

type SpawnCategory = "correct" | "wrong" | "decoy";

type FlyingFruitsFruitView = {
  choice?: FlyingFruitsChoice;
  isDecoy: boolean;
  fruitKey: string;
  body: Phaser.Physics.Arcade.Image;
  choiceCard?: Phaser.GameObjects.Container;
  iceOverlay?: Phaser.GameObjects.Image;
  snowflakeFx?: Phaser.GameObjects.Container;
  frozen?: boolean;
  frozenVel?: { vx: number; vy: number; av: number };
  freezeTimer?: Phaser.Time.TimerEvent;
  sliced: boolean;
};

const FF_HUD_MAX_LIVES = 3;
const FF_NET_FREEZE_MS = 8000;
/** กรอบรูปโจทย์ HUD — สี่เหลี่ยมจัตุรัส */
const FF_QUESTION_MEDIA_FRAME = 180;

const FF_ITEM_FRUIT_PATHS = {
  a: "assets/flying-fruits/items_fruit/a.png",
  b: "assets/flying-fruits/items_fruit/b.png",
  c: "assets/flying-fruits/items_fruit/c.png",
  d: "assets/flying-fruits/items_fruit/d.png",
  e: "assets/flying-fruits/items_fruit/e.png",
  f: "assets/flying-fruits/items_fruit/f.png",
  g: "assets/flying-fruits/items_fruit/g.png",
  h: "assets/flying-fruits/items_fruit/h.png",
  i: "assets/flying-fruits/items_fruit/i.png",
} as const;

const FF_ITEM_FRUIT_KEYS = Object.keys(FF_ITEM_FRUIT_PATHS).map((name) => `ff_item_fruit_${name}`);
const FF_HOME_LOGO_PATH = "assets/flying-fruits/icon_flying_fruits.png";
const FF_HOME_LOGO_KEY = "icon_flying_fruits";

/** ความเร็วการเคลื่อนที่ผลไม้/choice (1 = ปกติ, 0.5 = ช้าลง 50% ให้เด็กอ่านทัน) */
const FF_FRUIT_MOTION_SPEED = 0.3;
/** แรงโน้มถ่วงผลไม้ — ปรับตาม FF_FRUIT_MOTION_SPEED */
const FF_FRUIT_GRAVITY = 360 * FF_FRUIT_MOTION_SPEED;
const FF_FRUIT_SPAWN_DELAY_MS = {
  mobile: Math.round(720 / FF_FRUIT_MOTION_SPEED),
  desktop: Math.round(620 / FF_FRUIT_MOTION_SPEED),
} as const;
const FF_FRUIT_INITIAL_SPAWN_STAGGER_MS = Math.round(200 / FF_FRUIT_MOTION_SPEED);

/** พื้นที่วางตัวเลือกบนผลไม้ — ไม่มี bg แยก ใช้ sprite ผลไม้เป็นฐาน */
const FF_CHOICE_OVERLAY = {
  mobile: {
    innerRatio: 0.86,
    labelBoxTopTrim: 8,
    labelBoxBottomTrim: 10,
    imageFrameW: 76,
    imageFrameGap: 6,
    speakerSize: 34,
  },
  desktop: {
    innerRatio: 0.86,
    labelBoxTopTrim: 10,
    labelBoxBottomTrim: 12,
    imageFrameW: 108,
    imageFrameGap: 8,
    speakerSize: 40,
  },
} as const;

export default class FlyingFruitsGameScene extends BaseGameScene {
  private mobile = false;
  private startRequested = false;
  private assetsReady = false;
  private gameStarted = false;
  private ending = false;
  private lockInput = false;
  private imageKeyByUrl = new Map<string, string>();
  private imageKeySeq = 0;
  private soundKeyByUrl = new Map<string, string>();
  private soundKeySeq = 0;
  private hudTimerEvent?: Phaser.Time.TimerEvent;
  private hudStartMs = 0;
  private hudStarted = false;
  private hudElapsedAccumSec = 0;
  private hudRoot?: Phaser.GameObjects.Container;
  private hudTitlePill?: Phaser.GameObjects.Graphics;
  private hudTitleText?: Phaser.GameObjects.Text;
  private hudTitleDom?: Phaser.GameObjects.DOMElement;
  private hudQuestionPill?: Phaser.GameObjects.Graphics;
  private hudQuestionText?: Phaser.GameObjects.Text;
  private hudQuestionDom?: Phaser.GameObjects.DOMElement;
  private hudTimeBg?: Phaser.GameObjects.Image;
  private hudTimeIcon?: Phaser.GameObjects.Image;
  private hudTimeText?: Phaser.GameObjects.Text;
  private hudScoreBg?: Phaser.GameObjects.Image;
  private hudScoreLabel?: Phaser.GameObjects.Text;
  private hudLivesBg?: Phaser.GameObjects.Image;
  private hudQuestionProgress?: PhaserQuestionProgressHud;
  private hudScoreText?: Phaser.GameObjects.Text;
  private hudHearts: Phaser.GameObjects.Image[] = [];
  private hudKwPillY = 0;
  private hudKwPillH = 0;
  private hudKwPillMinW = 0;
  private hudKwPillMaxW = 0;
  private hudKwMediaCenterX = 0;
  private hudKwMediaCenterY = 0;
  private hudKwImageBg?: Phaser.GameObjects.Graphics;
  private hudKwImage?: Phaser.GameObjects.Image;
  private hudKwSpeaker?: Phaser.GameObjects.Image;
  private hudExerciseTitle = "";
  private currentHudQuestion?: FlyingFruitsQuestion;
  private teacherHintUI?: TeacherHintUI;
  private lastMessageShownMs = 0;
  private lastScoreChangeMs = 0;
  private idleNoScoreMessageShown = false;
  private readonly messageMilestonesSec = [15, 30, 45, 60, 90];
  private milestoneShown = new Set<number>();
  private readonly messageCatalog: Record<string, { text: string; voice?: string }> = {
    intro_start_a: { text: "ดูให้ดี แล้วเลือกคำตอบนะ" },
    intro_start_b: { text: "ข้อนี้ตอบอะไรเอ่ย!" },
    intro_start_c: { text: "ลองดูก่อน แล้วค่อยเลือกน้อย" },
    intro_start_d: { text: "เลือกคำตอบที่ถูกต้องกันเลย" },
  
    idle_5_a: { text: "คิดออกไหม?" },
    idle_5_b: { text: "ลองเลือกดูได้เลย!" },
    idle_5_c: { text: "ดูคำตอบดี ๆ น้า" },
  
    idle_15_a: { text: "อย่าปล่อยเวลาไปน้า รีบเลือกเลย!" },
    idle_15_b: { text: "ดูดี ๆ ตอบได้แน่นอน" },
    idle_15_c: { text: "ยังไม่แน่ใจใช่ไหม ลองเดาก่อนก็ได้" },
  
    time_15_a: { text: "15 วินาทีผ่านไป เครื่องติดหรือยังนะ" },
    time_15_b: { text: "15 วินาทีแล้ว เริ่มจับทางได้ยังน้า" },
    time_15_c: { text: "เวลากำลังเดินนะ 15 วินาทีแล้ว" },
    time_30_a: { text: "30 วินาทีผ่านไป ไวกว่านี้ได้อีกนะ" },
    time_30_b: { text: "30 วินาทีแล้ว เร่งมือหน่อยคนเก่ง" },
    time_45_a: { text: "45 วินาทีแล้ว มีคำไหนคุ้นตาบ้างไหม" },
    time_45_b: { text: "45 วินาทีแล้ว ลองหาคำที่เหมือนกันนะ" },
    time_60_a: { text: "60 วินาทีแล้ว สู้ต่ออีกนิด!" },
    time_60_b: { text: "60 วินาทีแล้ว อย่าเพิ่งยอมน้า" },
    time_60_c: { text: "ครบนาทีแล้ว สู้ต่อ! ลุยกันเลย" },
    time_90_a: { text: "90 วินาทีแล้ว ใกล้สำเร็จแล้วนะ!" },
  
    correct_a: { text: "ใช่แล้ว!" },
    correct_b: { text: "เก่งมาก!" },
    correct_c: { text: "ถูกต้อง!" },
    correct_d: { text: "เยี่ยมเลย!" },
  
    wrong_a: { text: "ไม่เป็นไร ลองอีกครั้งนะ" },
    wrong_b: { text: "เกือบแล้ว!" },
    wrong_c: { text: "ลองใหม่อีกนิด" },
    wrong_d: { text: "สู้ ๆ นะ" },
  };
  private readonly messagePools = {
    intro: ["intro_start_a", "intro_start_b", "intro_start_c", "intro_start_d"],
    idleNoScore5: ["idle_5_a", "idle_5_b", "idle_5_c"],
    idleNoScore15: ["idle_15_a", "idle_15_b", "idle_15_c"],
    time: {
      15: ["time_15_a", "time_15_b", "time_15_c"],
      30: ["time_30_a", "time_30_b"],
      45: ["time_45_a", "time_45_b"],
      60: ["time_60_a", "time_60_b", "time_60_c"],
      90: ["time_90_a"],
    } as Record<number, string[]>,
    correct: ["correct_a", "correct_b", "correct_c", "correct_d"],
    wrong: ["wrong_a", "wrong_b", "wrong_c", "wrong_d"],
  };
  private timeFlashEvent?: Phaser.Time.TimerEvent;
  private timeFlashSeq = 0;
  private timeRedLoopActive = false;

  private tickingState: "normal" | "danger" | null = null;
  private tickingEvent?: Phaser.Time.TimerEvent;
  private tickingSoundKey: string | null = null;
  
  private pendingPayload?: FlyingFruitsPayload;
  private readonly maxLifePoints = 3;
  private lifePoints = this.maxLifePoints;
  /** หมดหัวใจก่อนจบครบทุกข้อ — ไม่ส่งคะแนน live-dashboard (เหมือน find-the-match) */
  private ffGameFailedByNoLives = false;
  /** นับถอยหลัง 3-2-1 แค่ครั้งแรกตอนเริ่มเล่น */
  private ffGameStartCountdownDone = false;
  private questionIntroSeq = 0;
  private questionOutroSeq = 0;
  private questionAudioTimers: Phaser.Time.TimerEvent[] = [];
  
  private bgmState: "start" | "game" | "result" | null = null;
  private bgmStartSound?: Phaser.Sound.BaseSound;
  private bgmGameSound?: Phaser.Sound.BaseSound;
  private bgmResultSound?: Phaser.Sound.BaseSound;

  private introDecor?: {
    title: Phaser.GameObjects.Image;
    animated: boolean;
  };

  private backgroundImage?: Phaser.GameObjects.Image;
  private introFruits: Phaser.Physics.Arcade.Image[] = [];
  private introSpawnEvent?: Phaser.Time.TimerEvent;

  private tutorialPopup?: {
    title: Phaser.GameObjects.Image;
    howtoplay: Phaser.GameObjects.Image;
    startButton: Phaser.GameObjects.Image;
    restoreInputEnabled: boolean;
    restoreLockInput: boolean;
  };

  private questions: FlyingFruitsQuestion[] = [];
  private currentQuestionIndex = 0;
  private questionScoreEarned = 0;
  private remainingCorrectChoiceIds = new Set<number>();
  private fruits: FlyingFruitsFruitView[] = [];
  private spawnEvent?: Phaser.Time.TimerEvent;
  private spawnBag: SpawnCategory[] = [];
  /** คิวตัวเลือกต่อข้อ — สุ่มแล้วไม่ซ้ำจนกว่าจะครบทุกตัวแล้วค่อยสุ่มใหม่ */
  private correctChoiceQueue: FlyingFruitsChoice[] = [];
  private wrongChoiceQueue: FlyingFruitsChoice[] = [];
  private pointerDown = false;
  private lastPointerPos: Phaser.Math.Vector2 | null = null;
  private netButton?: Phaser.GameObjects.Image;
  private netButtonPulseTween?: Phaser.Tweens.Tween;

  private getFlyingFruitsSafeArea(): Phaser.Geom.Rectangle {
    return this.getSafeAreaRect(this.mobile ? 9 / 16 : 16 / 9);
  }

  private resetSwipeState() {
    this.pointerDown = false;
    this.lastPointerPos = null;
  }

  private refillSpawnBag() {
    const bag: SpawnCategory[] = [];
    for (let i = 0; i < 6; i += 1) bag.push("correct");
    for (let i = 0; i < 3; i += 1) bag.push("wrong");
    for (let i = 0; i < 1; i += 1) bag.push("decoy");
    Phaser.Utils.Array.Shuffle(bag);
    this.spawnBag = bag;
  }

  private nextSpawnCategory(hasCorrect: boolean, hasWrong: boolean): SpawnCategory {
    if (this.spawnBag.length === 0) this.refillSpawnBag();
    const picked = this.spawnBag.shift() ?? "correct";
    if (picked === "correct" && !hasCorrect) return hasWrong ? "wrong" : "decoy";
    if (picked === "wrong" && !hasWrong) return hasCorrect ? "correct" : "decoy";
    return picked;
  }

  private choiceIdentityKey(c: FlyingFruitsChoice): string {
    if (c.id != null && Number.isFinite(Number(c.id))) return `id:${c.id}`;
    return `text:${(c.choice ?? "").trim()}`;
  }

  private dedupeChoices(choices: FlyingFruitsChoice[]): FlyingFruitsChoice[] {
    const seen = new Set<string>();
    const out: FlyingFruitsChoice[] = [];
    for (const c of choices) {
      if (!c) continue;
      const key = this.choiceIdentityKey(c);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(c);
    }
    return out;
  }

  private resetChoiceQueuesForQuestion(q: FlyingFruitsQuestion) {
    const choices = this.dedupeChoices(q.choices ?? []);
    const correct = choices.filter((c) => c.is_correct);
    const wrong = choices.filter((c) => !c.is_correct);
    this.correctChoiceQueue = Phaser.Utils.Array.Shuffle([...correct]);
    this.wrongChoiceQueue = Phaser.Utils.Array.Shuffle([...wrong]);
  }

  /** ตัวเลือกที่ยังลอยอยู่บนจอ (ยังไม่ถูก slice) */
  private activeChoiceKeysOnScreen(): Set<string> {
    const keys = new Set<string>();
    for (const f of this.fruits) {
      if (f.sliced || f.isDecoy || !f.choice || !f.body.active) continue;
      keys.add(this.choiceIdentityKey(f.choice));
    }
    return keys;
  }

  /**
   * เลือกตัวเลือกจากคิว — ไม่ซ้ำกับที่แสดงบนจอ
   * ครบรอบแล้วสุ่มคิวใหม่จากตัวที่ยังไม่อยู่บนจอเท่านั้น
   */
  private takeChoiceFromQueue(
    queue: FlyingFruitsChoice[],
    pool: FlyingFruitsChoice[]
  ): { choice?: FlyingFruitsChoice; queue: FlyingFruitsChoice[] } {
    if (pool.length === 0) return { choice: undefined, queue: [] };

    const onScreen = this.activeChoiceKeysOnScreen();
    const poolKeys = new Set(pool.map((c) => this.choiceIdentityKey(c)));
    const available = pool.filter((c) => !onScreen.has(this.choiceIdentityKey(c)));
    if (available.length === 0) return { choice: undefined, queue };

    let q = queue.filter(
      (c) => poolKeys.has(this.choiceIdentityKey(c)) && !onScreen.has(this.choiceIdentityKey(c))
    );
    if (q.length === 0) {
      q = Phaser.Utils.Array.Shuffle([...available]);
    }

    const choice = q.shift();
    return { choice, queue: q };
  }

  private getHudElapsedSeconds() {
    const base = this.hudElapsedAccumSec;
    if (!this.hudStarted) return base;
    return base + (Date.now() - this.hudStartMs) / 1000;
  }

  private pauseHudTime() {
    if (!this.hudStarted) return;
    this.hudElapsedAccumSec += (Date.now() - this.hudStartMs) / 1000;
    this.hudStarted = false;
    this.stopTicking();
    this.updateHud();
  }

  private resumeHudTime() {
    if (this.hudStarted) return;
    this.hudStarted = true;
    this.hudStartMs = Date.now();
    this.updateHud();
  }

  private formatHudElapsedTime() {
    const safe = Math.max(0, Math.floor(this.getHudElapsedSeconds()));
    const mm = Math.floor(safe / 60);
    const ss = safe % 60;
    return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
  }

  private destroyFlyingFruitsHud() {
    this.hudTimerEvent?.destroy();
    this.hudTimerEvent = undefined;
    this.hudKwImageBg?.destroy();
    this.hudKwImageBg = undefined;
    this.hudKwImage?.destroy();
    this.hudKwImage = undefined;
    this.hudKwSpeaker?.destroy();
    this.hudKwSpeaker = undefined;
    this.releaseAllFfNetFreezes();
    this.netButton = undefined;
    this.hudRoot?.destroy(true);
    this.hudRoot = undefined;
    this.hudTitlePill = undefined;
    this.hudTitleText = undefined;
    this.hudTitleDom = undefined;
    this.hudQuestionPill = undefined;
    this.hudQuestionText = undefined;
    this.hudQuestionDom = undefined;
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

  private getFfHudLayout() {
    const safe = this.getFlyingFruitsSafeArea();
    const ui = createHudScaleCtx(safe.width, safe.height, this.mobile);
    const metrics = getGameHudRowMetrics({
      mobile: this.mobile,
      width: safe.width,
      height: safe.height,
      px: ui.px.bind(ui),
      maxLives: FF_HUD_MAX_LIVES,
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

  private layoutFfHudStats(index = this.currentQuestionIndex) {
    const { safe, ui, metrics, slots } = this.getFfHudLayout();
    const rowY = safe.y + slots.rowY;
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
        valueText: this.formatHudElapsedTime(),
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
        label: this.getFfQuestionProgressLabel(index),
        font: metrics.fontProgress,
      });
    }

    this.layoutFfSuggestionHud();
  }

  private layoutFfSuggestionHud() {
    if (!this.hudTitlePill || !this.hudTitleText) return;

    const mobile = this.mobile;
    const { safe, ui, metrics, slots } = this.getFfHudLayout();
    const title = this.hudExerciseTitle;
    const titleY = safe.y + slots.questionY;
    const titleH = metrics.questionH;
    const titleMinW = slots.questionMaxW * 0.65;
    const hudTextRes = Math.min(3, typeof window !== "undefined" ? window.devicePixelRatio || 2 : 2);
    const box = resolveHudSuggestionBox({
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
      box,
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
    this.hudKwPillMaxW = box.width;
    this.hudKwMediaCenterX = box.centerX;
  }

  private createFlyingFruitsTopHud(exerciseName: string) {
    this.destroyFlyingFruitsHud();
    const title = getHudSuggestionLabel(exerciseName);
    this.hudExerciseTitle = title;

    const mobile = this.mobile;
    const { safe, ui, metrics, slots } = this.getFfHudLayout();
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
    const kwFrameHalfH = getQuestionMediaFrameHalfH(mobile, ui.px.bind(ui), w, true, h);
    this.hudKwMediaCenterY = getQuestionMediaCenterYBelowAnchor(
      showSuggestion ? titleY + titleH : titleY,
      kwFrameHalfH,
      mobile,
      ui.px.bind(ui)
    );

    this.layoutFfSuggestionHud();

    const fontHudQuestion = getHudCenterTextFont(ui.px.bind(ui), mobile);
    this.hudQuestionPill = this.add.graphics().setScrollFactor(0).setVisible(false);
    this.hudQuestionText = this.add
      .text(0, 0, "", {
        font: fontHudQuestion,
        color: "#333333",
        align: "center",
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setResolution(hudTextRes)
      .setVisible(false);
    hudRoot.add(this.hudQuestionPill);
    hudRoot.add(this.hudQuestionText);

    this.hudTimeBg = this.add.image(0, 0, "bg_hud").setScrollFactor(0);
    this.hudTimeIcon = this.add
      .image(0, 0, HUD_HOURGLASS_TEXTURE_KEY)
      .setOrigin(0.5)
      .setScrollFactor(0);
    this.hudTimeText = this.add
      .text(0, 0, this.formatHudElapsedTime(), {
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
    for (let i = 0; i < FF_HUD_MAX_LIVES; i += 1) {
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

    this.layoutFfHudStats();

    this.hudTimerEvent = this.time.addEvent({
      delay: 250,
      loop: true,
      callback: () => {
        this.hudTimeText?.setText(this.formatHudElapsedTime());
        this.layoutFfHudStats();
      },
    });

    this.setFlyingFruitsSuggestionVisible(showSuggestion);
    this.createFfNetButton();
    this.refreshFlyingFruitsHud();
  }

  private createFfNetButton() {
    this.destroyFfNetUi();
    const mobile = this.mobile;
    const { safe, ui } = this.getFfHudLayout();
    const btnSize = ui.px(mobile ? 88 : 108);
    const pad = ui.px(mobile ? 10 : 16);
    const x = safe.x + safe.width - pad - btnSize / 2;
    const y = safe.y + safe.height - pad - btnSize / 2;

    const btn = this.add
      .image(x, y, "ff_btn_net")
      .setScrollFactor(0)
      .setDepth(2002)
      .setDisplaySize(btnSize, btnSize)
      .setInteractive({ useHandCursor: true })
      .setVisible(false);

    btn.on(
      "pointerdown",
      (_p: Phaser.Input.Pointer, _lx: number, _ly: number, event: Phaser.Types.Input.EventData) => {
        event.stopPropagation();
        this.activateFfNetFreeze();
      }
    );

    this.netButton = btn;
    this.hudRoot?.add(btn);
    this.hudRoot?.bringToTop(btn);
  }

  private startFfNetButtonPulse() {
    if (!this.netButton?.visible) return;
    this.stopFfNetButtonPulse();
    const btn = this.netButton;
    const baseScaleX = btn.scaleX;
    const baseScaleY = btn.scaleY;
    this.netButtonPulseTween = this.tweens.add({
      targets: btn,
      scaleX: baseScaleX * 1.08,
      scaleY: baseScaleY * 1.08,
      duration: 900,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });
  }

  private stopFfNetButtonPulse() {
    this.netButtonPulseTween?.stop();
    this.netButtonPulseTween = undefined;
    if (this.netButton) this.tweens.killTweensOf(this.netButton);
  }

  private layoutFfNetButton() {
    if (!this.netButton) return;
    const mobile = this.mobile;
    const { safe, ui } = this.getFfHudLayout();
    const btnSize = ui.px(mobile ? 88 : 108);
    const pad = ui.px(mobile ? 10 : 16);
    const x = safe.x + safe.width - pad - btnSize / 2;
    const y = safe.y + safe.height - pad - btnSize / 2;
    this.netButton.setPosition(x, y).setDisplaySize(btnSize, btnSize);
    this.hudRoot?.bringToTop(this.netButton);
    if (this.netButton.visible) this.startFfNetButtonPulse();
  }

  private findTopmostChoiceFruit(): FlyingFruitsFruitView | undefined {
    let best: FlyingFruitsFruitView | undefined;
    let bestY = Number.POSITIVE_INFINITY;
    for (const fruit of this.fruits) {
      if (fruit.sliced || fruit.frozen || !fruit.body.active || fruit.isDecoy || !fruit.choice) continue;
      const y = fruit.body.y;
      if (y < bestY) {
        bestY = y;
        best = fruit;
      }
    }
    return best;
  }


  private shrinkFfQuestionMediaLayout(
    layout: QuestionMediaLayoutResult,
    frameSize: number,
    mediaCenterX: number,
    mediaCenterY: number,
    mobile: boolean,
    ui: ReturnType<typeof createHudScaleCtx>,
    imageTexW?: number,
    imageTexH?: number
  ): QuestionMediaLayoutResult {
    const pad = ui.px(mobile ? 10 : 12);
    const innerW = Math.max(1, frameSize - pad * 2);
    const innerH = Math.max(1, frameSize - pad * 2);
    const fit =
      imageTexW && imageTexH
        ? fitQuestionMediaContainSize(imageTexW, imageTexH, innerW, innerH)
        : { imageW: 0, imageH: 0 };
    const speakerSize = ui.px(mobile ? 26 : 32);
    const speakerPad = ui.px(mobile ? 9 : 11);
    const frameBottom = mediaCenterY + frameSize / 2;
    return {
      ...layout,
      frameW: frameSize,
      frameH: frameSize,
      imageCenterX: mediaCenterX,
      imageCenterY: mediaCenterY,
      imageW: fit.imageW,
      imageH: fit.imageH,
      speakerX: mediaCenterX,
      speakerY: frameBottom - speakerSize / 2 - speakerPad,
      speakerSize,
    };
  }

  private shrinkFfQuestionCardLayout(
    frameSize: number,
    mediaCenterX: number,
    mediaCenterY: number,
    mobile: boolean,
    ui: ReturnType<typeof createHudScaleCtx>,
    hasSound: boolean,
    imageTexW?: number,
    imageTexH?: number,
    questionText?: string,
    maxTextOverlayW?: number
  ): QuestionMediaLayoutResult {
    const frameW = frameSize;
    const frameH = frameSize;
    const frameLeft = mediaCenterX - frameW / 2;
    const frameRight = mediaCenterX + frameW / 2;
    const frameBottom = mediaCenterY + frameH / 2;

    const speakerSize = ui.px(mobile ? 36 : 44);
    const textBarH = ui.px(mobile ? 30 : 36);

    const trimmed = (questionText ?? "").trim();
    const useExpandablePill = !!(trimmed && maxTextOverlayW && maxTextOverlayW > 0);

    let textOverlay;
    let speakerX: number;
    let speakerY: number;

    if (useExpandablePill) {
      const card = resolveQuestionMediaCardTextOverlay({
        text: trimmed,
        mobile,
        px: ui.px.bind(ui),
        mediaCenterX,
        frameBottom,
        speakerSize,
        minW: ui.px(mobile ? 72 : 88),
        maxW: maxTextOverlayW,
        pillPadX: ui.px(mobile ? 8 : 10),
        basePillH: textBarH,
        fontPx: getHudCenterTextMaxFontPx(ui.px.bind(ui), mobile),
      });
      textOverlay = card.textOverlay;
      speakerX = card.speakerX;
      speakerY = card.speakerY;
    } else {
      speakerX = frameLeft + speakerSize * 0.28;
      speakerY = frameBottom + speakerSize * 0.06;
      const hangBelowLegacy = textBarH * 0.45;
      const textBarBottom = frameBottom + hangBelowLegacy;
      const textBarTopLegacy = textBarBottom - textBarH;
      const textLeft = frameLeft + speakerSize * 0.62;
      const textRight = frameRight + ui.px(4);
      const textW = Math.max(ui.px(48), textRight - textLeft);
      textOverlay = {
        left: textLeft,
        top: textBarTopLegacy,
        width: textW,
        height: textBarH,
        centerX: textLeft + textW / 2,
        centerY: (textBarTopLegacy + textBarBottom) / 2,
      };
    }

    const pad = ui.px(mobile ? 8 : 10);
    const innerW = Math.max(1, frameW - pad * 2);
    const innerH = Math.max(1, frameH - pad * 2);
    const fit =
      imageTexW && imageTexH
        ? fitQuestionMediaContainSize(imageTexW, imageTexH, innerW, innerH)
        : { imageW: 0, imageH: 0 };

    return {
      frameW,
      frameH,
      imageCenterX: mediaCenterX,
      imageCenterY: mediaCenterY,
      imageW: fit.imageW,
      imageH: fit.imageH,
      speakerX,
      speakerY,
      speakerSize,
      showImage: !!(imageTexW && imageTexH),
      showSound: hasSound,
      soundOnlyFrame: false,
      textOverlay,
    };
  }

  private destroyFfSnowflakeFx(fruit: FlyingFruitsFruitView) {
    if (!fruit.snowflakeFx) return;
    fruit.snowflakeFx.each((child: Phaser.GameObjects.GameObject) => {
      if (child) this.tweens.killTweensOf(child);
    });
    this.tweens.killTweensOf(fruit.snowflakeFx);
    fruit.snowflakeFx.destroy(true);
    fruit.snowflakeFx = undefined;
  }

  private createFfSnowflakeFx(fruit: FlyingFruitsFruitView) {
    this.destroyFfSnowflakeFx(fruit);
    const mobile = this.mobile;
    const { safe } = this.getFfHudLayout();
    const ui = createHudScaleCtx(safe.width, safe.height, mobile);
    const count = mobile ? 6 : 8;
    const radius = Math.max(fruit.body.displayWidth, fruit.body.displayHeight) * 0.58;
    const flakeSize = ui.px(mobile ? 16 : 20);
    const container = this.add
      .container(fruit.body.x, fruit.body.y)
      .setDepth(fruit.body.depth + 0.45)
      .setAngle(fruit.body.angle);

    for (let i = 0; i < count; i += 1) {
      const angle = (i / count) * Math.PI * 2;
      const flake = this.add
        .image(Math.cos(angle) * radius, Math.sin(angle) * radius, "ff_snowflake")
        .setDisplaySize(flakeSize, flakeSize)
        .setAlpha(0.25);
      container.add(flake);
      this.tweens.add({
        targets: flake,
        alpha: { from: 0.2, to: 1 },
        scaleX: { from: flake.scaleX * 0.8, to: flake.scaleX * 1.2 },
        scaleY: { from: flake.scaleY * 0.8, to: flake.scaleY * 1.2 },
        duration: 360 + i * 70,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      });
    }

    fruit.snowflakeFx = container;
  }

  private freezeFfFruit(fruit: FlyingFruitsFruitView) {
    const arcadeBody = fruit.body.body as Phaser.Physics.Arcade.Body | null;
    if (!arcadeBody || fruit.frozen) return;

    fruit.frozen = true;
    fruit.frozenVel = {
      vx: arcadeBody.velocity.x,
      vy: arcadeBody.velocity.y,
      av: arcadeBody.angularVelocity,
    };
    fruit.body.setVelocity(0, 0);
    fruit.body.setAngularVelocity(0);
    fruit.body.setAcceleration(0, 0);
    arcadeBody.setAllowGravity(false);

    const iceSize = Math.max(fruit.body.displayWidth, fruit.body.displayHeight) * 1.02;
    fruit.iceOverlay = this.add
      .image(fruit.body.x, fruit.body.y, "ff_ice")
      .setOrigin(0.5, 0.5)
      .setDepth(fruit.body.depth + 0.5)
      .setDisplaySize(iceSize, iceSize)
      .setAngle(fruit.body.angle);
    this.createFfSnowflakeFx(fruit);
    this.playSfx("sfx_freeze", 0.9);
  }

  private unfreezeFfFruit(fruit: FlyingFruitsFruitView, playCrackSfx = true) {
    if (!fruit.frozen) return;
    fruit.frozen = false;
    fruit.freezeTimer?.destroy();
    fruit.freezeTimer = undefined;

    const arcadeBody = fruit.body.body as Phaser.Physics.Arcade.Body | null;
    if (arcadeBody) {
      arcadeBody.setAllowGravity(true);
      const vel = fruit.frozenVel;
      if (vel) {
        fruit.body.setVelocity(vel.vx, vel.vy);
        fruit.body.setAngularVelocity(vel.av);
      }
    }
    fruit.frozenVel = undefined;

    fruit.iceOverlay?.destroy();
    fruit.iceOverlay = undefined;
    this.destroyFfSnowflakeFx(fruit);
    if (playCrackSfx) this.playSfx("sfx_crack", 0.9);
  }

  private releaseAllFfNetFreezes() {
    for (const fruit of [...this.fruits]) {
      if (fruit.frozen) this.unfreezeFfFruit(fruit, false);
    }
  }

  private activateFfNetFreeze() {
    if (this.lockInput || this.ending || !this.gameStarted) return;

    this.playSfx("sfx_click_default", 1);

    const fruit = this.findTopmostChoiceFruit();
    if (!fruit) {
      if (this.netButton) {
        this.stopFfNetButtonPulse();
        this.tweens.add({
          targets: this.netButton,
          x: this.netButton.x + 6,
          duration: 45,
          yoyo: true,
          repeat: 3,
          ease: "Sine.easeInOut",
          onComplete: () => this.startFfNetButtonPulse(),
        });
      }
      return;
    }

    this.freezeFfFruit(fruit);

    fruit.freezeTimer?.destroy();
    fruit.freezeTimer = this.time.delayedCall(FF_NET_FREEZE_MS, () => {
      if (!fruit.frozen || fruit.sliced || !fruit.body.active) return;
      this.unfreezeFfFruit(fruit);
    });
  }

  private destroyFfNetUi() {
    this.stopFfNetButtonPulse();
    this.releaseAllFfNetFreezes();
    if (this.netButton?.active) this.netButton.destroy();
    this.netButton = undefined;
  }

  private clearFfNetOnFruitDestroyed(fruit: FlyingFruitsFruitView) {
    const wasFrozen = fruit.frozen;
    fruit.freezeTimer?.destroy();
    fruit.freezeTimer = undefined;
    fruit.iceOverlay?.destroy();
    fruit.iceOverlay = undefined;
    this.destroyFfSnowflakeFx(fruit);
    fruit.frozen = false;
    fruit.frozenVel = undefined;
    if (wasFrozen) this.playSfx("sfx_crack", 0.9);
  }

  /** suggestion ด้านบน — แสดงเมื่อมี suggestion เท่านั้น */
  private setFlyingFruitsSuggestionVisible(visible: boolean) {
    if (!visible) {
      this.hudTitlePill?.setVisible(false);
      this.hudTitleText?.setVisible(false);
      this.hudTitleDom?.setVisible(false);
      return;
    }
    this.layoutFfSuggestionHud();
  }

  /** ซ่อนโจทย์กลางจอ (ข้อความ + รูป/เสียง) — ไม่กระทบ suggestion ด้านบน */
  private hideFlyingFruitsQuestionHud() {
    this.hudQuestionPill?.setVisible(false);
    this.hudQuestionText?.setVisible(false);
    this.hudKwImageBg?.setVisible(false);
    this.hudKwImage?.setVisible(false);
    this.hudKwSpeaker?.setVisible(false);
  }

  private refreshFlyingFruitsHud() {
    for (let i = 0; i < this.hudHearts.length; i += 1) {
      const alive = i < this.lifePoints;
      this.hudHearts[i]?.setAlpha(alive ? 1 : 0.25);
    }
    this.layoutFfHudStats();
    this.layoutFfNetButton();
  }

  private getFfQuestionProgressLabel(index = this.currentQuestionIndex): string {
    const total = this.questions.length || this.totalQuestions || 0;
    if (total <= 0) return "";
    return getQuestionProgressLabel(total, { questionIndex0: index });
  }

  private refreshFfQuestionProgressHud(index = this.currentQuestionIndex) {
    this.layoutFfHudStats(index);
  }

  private fadeOutAndDestroyFfHudObject(obj?: Phaser.GameObjects.GameObject) {
    if (!obj) return;
    this.tweens.killTweensOf(obj);
    this.tweens.add({
      targets: obj,
      alpha: 0,
      duration: 90,
      ease: "Sine.easeOut",
      onComplete: () => obj.destroy(),
    });
  }

  private fadeInFfQuestionHudObjects(objects: Array<Phaser.GameObjects.GameObject | undefined>, delay = 110) {
    const targets = objects.filter((obj): obj is Phaser.GameObjects.GameObject => Boolean(obj));
    if (targets.length === 0) return;
    targets.forEach((obj) => {
      this.tweens.killTweensOf(obj);
      (obj as Phaser.GameObjects.GameObject & { setAlpha?: (value: number) => unknown }).setAlpha?.(0);
    });
    this.tweens.add({
      targets,
      alpha: 1,
      delay,
      duration: 130,
      ease: "Sine.easeOut",
    });
  }

  private fadeOutCurrentFfQuestionHudBeforeChange(): number {
    const duration = 140;
    const targets: Phaser.GameObjects.GameObject[] = [
      this.hudKwImageBg,
      this.hudKwImage,
      this.hudKwSpeaker,
      this.hudQuestionPill,
      this.hudQuestionText,
      this.hudQuestionDom,
    ].filter(Boolean) as Phaser.GameObjects.GameObject[];

    if (targets.length === 0) return 0;
    targets.forEach((obj) => this.tweens.killTweensOf(obj));
    this.tweens.add({
      targets,
      alpha: 0,
      duration,
      ease: "Sine.easeOut",
      onComplete: () => {
        this.hudKwImageBg?.destroy();
        this.hudKwImageBg = undefined;
        this.hudKwImage?.destroy();
        this.hudKwImage = undefined;
        this.hudKwSpeaker?.destroy();
        this.hudKwSpeaker = undefined;
        this.hudQuestionPill?.setVisible(false);
        this.hudQuestionText?.setVisible(false);
        this.hudQuestionDom?.setVisible(false);
      },
    });
    return duration;
  }

  private setFlyingFruitsHudQuestion(q: FlyingFruitsQuestion) {
    if (!this.hudTitleText || !this.hudTitlePill || !this.hudQuestionPill || !this.hudQuestionText) {
      return;
    }
    this.currentHudQuestion = q;
    const mobile = this.mobile;
    const safe = this.getFlyingFruitsSafeArea();
    const w = safe.width;
    const h = safe.height;
    const ui = createHudScaleCtx(w, h, mobile);
    const { slots, metrics } = this.getFfHudLayout();
    const hudTextRes = Math.min(3, typeof window !== "undefined" ? window.devicePixelRatio || 2 : 2);

    const questionText = (q.question ?? "").trim();
    const hasQuestion = hasHudCenterLabel(questionText);

    this.fadeOutAndDestroyFfHudObject(this.hudKwImageBg);
    this.hudKwImageBg = undefined;
    this.fadeOutAndDestroyFfHudObject(this.hudKwImage);
    this.hudKwImage = undefined;
    this.fadeOutAndDestroyFfHudObject(this.hudKwSpeaker);
    this.hudKwSpeaker = undefined;
    this.tweens.killTweensOf(this.hudQuestionPill);
    this.tweens.killTweensOf(this.hudQuestionText);
    if (this.hudQuestionDom) this.tweens.killTweensOf(this.hudQuestionDom);
    this.hudQuestionPill.setAlpha(0);
    this.hudQuestionText.setAlpha(0);
    this.hudQuestionDom?.setAlpha(0);
    this.hudQuestionPill.setVisible(false);
    this.hudQuestionText.setVisible(false);
    this.hudQuestionDom?.setVisible(false);

    const imageUrl = typeof q.image_question === "string" ? q.image_question.trim() : "";
    const resolvedImageUrl = imageUrl ? this.resolveImageUrl(imageUrl) : "";
    const imgKey = resolvedImageUrl ? this.imageKeyByUrl.get(resolvedImageUrl) : undefined;
    const hasImage = Boolean(imgKey && this.textures.exists(imgKey));

    const soundUrl = typeof q.sound_question === "string" ? q.sound_question.trim() : "";
    const resolvedSound = soundUrl ? this.resolveSoundUrl(soundUrl) : "";
    const hasSound = Boolean(resolvedSound && this.soundKeyByUrl.has(resolvedSound));

    if (!hasQuestion && !hasImage && !hasSound) {
      return;
    }

    const useCardQuestionLayout = hasQuestion && (hasImage || hasSound);
    const showSuggestion = hasHudCenterLabel(this.hudExerciseTitle);

    let mediaCenterX = this.hudKwMediaCenterX || slots.questionCenterX;
    let mediaAnchorBottomY = safe.y + slots.questionY;
    if (showSuggestion) {
      mediaAnchorBottomY = this.hudKwPillY + this.hudKwPillH;
    }

    if (hasQuestion && !useCardQuestionLayout) {
      const questionPillY = mediaAnchorBottomY + ui.px(mobile ? 14 : 18);
      const minLeft = mobile ? safe.x + metrics.leftPad : slots.timeRight + metrics.questionGap;
      const maxRight = mobile ? safe.x + safe.width - metrics.leftPad : slots.statsLeftEdge - metrics.questionGap;
      const maxAllowedW = Math.max(1, maxRight - minLeft);
      const effectiveMaxW = Math.min(this.hudKwPillMaxW, maxAllowedW);
      const pillPadX = ui.px(mobile ? 12 : 16);
      const pill = resolveQuestionHudTextPillBox({
        text: questionText,
        mobile,
        px: ui.px.bind(ui),
        centerX: slots.questionCenterX,
        topY: questionPillY,
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
      const questionPillH = pill.height;
      const wrapInner = pill.wrapWidth;
      const kwFontPx = pill.fontPx ?? getHudCenterTextMaxFontPx(ui.px.bind(ui), mobile);

      this.hudQuestionPill.clear();
      this.hudQuestionPill.fillStyle(0xffffff, 0.92);
      this.hudQuestionPill.lineStyle(2, 0xd9e8e5, 1);
      this.hudQuestionPill.fillRoundedRect(box.left, questionPillY, box.width, questionPillH, 14);
      this.hudQuestionPill.strokeRoundedRect(box.left, questionPillY, box.width, questionPillH, 14);
      this.hudQuestionPill.setVisible(true);

      const textPadX = ui.px(mobile ? 12 : 16);
      const textPadY = ui.px(mobile ? 10 : 8);
      const wrapPadX = ui.px(mobile ? 56 : 96);
      this.hudQuestionDom =
        applyPhaserHudQuestionText({
          scene: this,
          text: this.hudQuestionText,
          dom: this.hudQuestionDom,
          parent: this.hudRoot,
          content: questionText,
          centerX: box.centerX,
          centerY: questionPillY + questionPillH / 2,
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
        }) ?? this.hudQuestionDom;

      this.fadeInFfQuestionHudObjects([
        this.hudQuestionPill,
        this.hudQuestionText,
        this.hudQuestionDom,
      ]);

      mediaCenterX = box.centerX;
      mediaAnchorBottomY = questionPillY + questionPillH;
    }

    if (!hasImage && !hasSound) return;

    this.hudKwMediaCenterX = mediaCenterX;
    const kwFrameHalfH = useCardQuestionLayout
      ? getQuestionMediaCardLayoutHalfH(mobile, ui.px.bind(ui), w, h)
      : hasImage
        ? getQuestionMediaFrameHalfH(mobile, ui.px.bind(ui), w, true, h)
        : getQuestionMediaFrameHalfH(mobile, ui.px.bind(ui), w, hasImage, h);
    this.hudKwMediaCenterY = getQuestionMediaCenterYBelowAnchor(
      mediaAnchorBottomY,
      kwFrameHalfH,
      mobile,
      ui.px.bind(ui)
    );

    const hudDepth = 2001;
    const imgTex =
      hasImage && imgKey
        ? (this.textures.get(imgKey).getSourceImage() as { width: number; height: number })
        : undefined;
    let layout = computeQuestionMediaLayout({
      mobile,
      px: ui.px.bind(ui),
      screenWidth: w,
      screenHeight: h,
      mediaCenterX: this.hudKwMediaCenterX,
      mediaCenterY: this.hudKwMediaCenterY,
      hasImage,
      hasSound,
      imageTexW: imgTex?.width,
      imageTexH: imgTex?.height,
      questionText: useCardQuestionLayout && hasQuestion ? questionText : undefined,
      maxTextOverlayW: this.hudKwPillMaxW,
      variant: useCardQuestionLayout ? "card" : "default",
    });

    if (!layout) return;

    if (hasImage && !useCardQuestionLayout) {
      layout = this.shrinkFfQuestionMediaLayout(
        layout,
        ui.px(FF_QUESTION_MEDIA_FRAME),
        this.hudKwMediaCenterX,
        this.hudKwMediaCenterY,
        mobile,
        ui,
        imgTex?.width,
        imgTex?.height
      );
    }

    const frame = this.add.graphics().setScrollFactor(0).setDepth(hudDepth);
    if (useCardQuestionLayout) {
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

    if (useCardQuestionLayout && hasQuestion && layout.textOverlay) {
      const overlay = layout.textOverlay;
      const pillPadX = ui.px(mobile ? 8 : 10);
      const fontPx =
        overlay.fontPx ??
        fitQuestionMediaOverlayFontPx(
          questionText,
          overlay.width - pillPadX * 2,
          mobile,
          ui.px.bind(ui)
        );
      const wrapW = overlay.wrapWidth;

      const pillRadius = ui.px(mobile ? 8 : 10);
      drawQuestionMediaOverlayTextPill(
        this.hudQuestionPill,
        overlay.left,
        overlay.top,
        overlay.width,
        overlay.height,
        pillRadius,
        ui.px(mobile ? 2 : 3)
      );
      this.hudQuestionPill.setVisible(true);

      const textPadX = ui.px(mobile ? 12 : 16);
      const textPadY = ui.px(mobile ? 10 : 8);
      const wrapPadX = ui.px(mobile ? 56 : 96);
      this.hudQuestionDom =
        applyPhaserHudQuestionText({
          scene: this,
          text: this.hudQuestionText,
          dom: this.hudQuestionDom,
          parent: this.hudRoot,
          content: questionText,
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
          depth: hudDepth + 2,
          lineSpacing: mobile ? 3 : 2,
        }) ?? this.hudQuestionDom;
      this.hudRoot?.bringToTop(this.hudQuestionPill);
      this.hudRoot?.bringToTop(this.hudQuestionText);
      this.hudQuestionDom && this.hudRoot?.bringToTop(this.hudQuestionDom);
    }

    if (layout.showSound) {
      const btn = this.add
        .image(layout.speakerX, layout.speakerY, HUD_VOLUME_TEXTURE_KEY)
        .setDisplaySize(layout.speakerSize, layout.speakerSize)
        .setScrollFactor(0)
        .setDepth(hudDepth + 2)
        .setInteractive({ useHandCursor: true });
      btn.on("pointerdown", () => {
        this.tweens.add({ targets: btn, scale: { from: btn.scale, to: btn.scale * 0.88 }, yoyo: true, duration: 90 });
        this.playQuestionSound(soundUrl);
      });
      this.hudRoot?.add(btn);
      this.hudRoot?.bringToTop(btn);
      this.hudKwSpeaker = btn;
    }

    this.fadeInFfQuestionHudObjects([
      this.hudKwImageBg,
      this.hudKwImage,
      this.hudQuestionPill.visible ? this.hudQuestionPill : undefined,
      this.hudQuestionText.visible ? this.hudQuestionText : undefined,
      this.hudQuestionDom?.visible ? this.hudQuestionDom : undefined,
      this.hudKwSpeaker,
    ]);
  }

  private playCountdown(onComplete: () => void) {
    const safe = this.getFlyingFruitsSafeArea();
    const width = safe.width;
    const height = safe.height;
    const text = this.add
      .text(safe.x + width / 2, safe.y + height / 2, "", {
        fontFamily: "Noto Sans Thai",
        fontSize: this.mobile ? "78px" : "120px",
        color: "#4E4E4E",
        align: "center",
      })
      .setOrigin(0.5, 0.5)
      .setDepth(2500);
    text.setStroke("#FFFFFF", 10);

    const show = (n: number) => {
      if (!this.sys.isActive()) return;
      this.playSfx("sfx_countnum", 0.9);
      text.setText(String(n));
      text.setAlpha(0);
      text.setScale(0.72);
      this.tweens.add({
        targets: text,
        alpha: 1,
        scale: 1,
        duration: 160,
        ease: "Back.easeOut",
        easeParams: [2.2],
        onComplete: () => {
          this.time.delayedCall(240, () => {
            this.tweens.add({
              targets: text,
              alpha: 0,
              scale: 1.08,
              duration: 160,
              ease: "Cubic.easeIn",
              onComplete: () => {
                if (n <= 1) {
                  text.destroy();
                  onComplete();
                  return;
                }
                show(n - 1);
              },
            });
          });
        },
      });
    };
    show(3);
  }

  private waitForFruitsToClear(seq: number, timeoutMs: number = 6000): Promise<void> {
    const startMs = Date.now();
    return new Promise((resolve) => {
      const event = this.time.addEvent({
        delay: 120,
        loop: true,
        callback: () => {
          if (seq !== this.questionOutroSeq) {
            event.destroy();
            resolve();
            return;
          }
          if (!this.sys.isActive()) {
            event.destroy();
            resolve();
            return;
          }
          if (this.fruits.length === 0) {
            event.destroy();
            resolve();
            return;
          }
          if (Date.now() - startMs >= timeoutMs) {
            event.destroy();
            resolve();
          }
        },
      });
    });
  }

  private tweenOnce(config: Phaser.Types.Tweens.TweenBuilderConfig): Promise<void> {
    return new Promise((resolve) => {
      const { onComplete, ...rest } = config;
      this.tweens.add({
        ...rest,
        onComplete: (...args: Parameters<Phaser.Types.Tweens.TweenOnCompleteCallback>) => {
          onComplete?.(...args);
          resolve();
        },
      });
    });
  }

  private async playQuestionCompleteOutro(): Promise<void> {
    const seq = this.questionOutroSeq;
    this.lockInput = true;
    this.input.enabled = false;
    this.resetSwipeState();
    this.stopSpawning();

    await this.waitForFruitsToClear(seq, 1500);
    if (seq !== this.questionOutroSeq) return;
    if (!this.sys.isActive()) return;

    const cx = this.hudKwMediaCenterX || this.scale.width / 2;
    const cy = this.hudKwMediaCenterY || this.scale.height * 0.22;

    await new Promise((resolve) => this.time.delayedCall(400, resolve));
    if (seq !== this.questionOutroSeq) return;

    this.playSfx("sfx_all_correct", 1);
    this.createParticleBurst(cx, cy, 2201);
    if (this.questionScoreEarned > 0) {
      const scoreOffsetX = this.mobile ? 86 : 132;
      const scoreOffsetY = this.mobile ? 70 : 88;
      this.showScorePlus(cx + scoreOffsetX, cy + scoreOffsetY, this.questionScoreEarned, 2202);
    }
    if (seq !== this.questionOutroSeq) return;
  }

  private startIntroSpawning() {
    if (this.introSpawnEvent) return;
    const initial = this.mobile ? 4 : 6;
    for (let i = 0; i < initial; i += 1) this.spawnIntroFruit();
    this.introSpawnEvent = this.time.addEvent({
      delay: this.mobile ? 680 : 520,
      loop: true,
      callback: () => {
        if (this.gameStarted) return;
        const maxActive = this.mobile ? 8 : 12;
        if (this.introFruits.filter((f) => f.active).length >= maxActive) return;
        this.spawnIntroFruit();
      },
    });
  }

  private stopIntroSpawning() {
    this.introSpawnEvent?.destroy();
    this.introSpawnEvent = undefined;
  }

  private clearIntroFruits() {
    for (const f of this.introFruits) f.destroy();
    this.introFruits = [];
  }

  private cleanupOffscreenIntroFruits() {
    const { width, height } = this.scale;
    const maxSize = this.introFruits.reduce((m, f) => Math.max(m, f.displayWidth, f.displayHeight), 0);
    const margin = Math.max(220, Math.round(maxSize + 40));
    const toRemove: Phaser.Physics.Arcade.Image[] = [];
    for (const f of this.introFruits) {
      if (!f.active) continue;
      const x = f.x;
      const y = f.y;
      if (x < -margin || x > width + margin || y > height + margin) toRemove.push(f);
    }
    if (toRemove.length === 0) return;
    for (const f of toRemove) f.destroy();
    this.introFruits = this.introFruits.filter((f) => f.active);
  }

  private spawnIntroFruit() {
    const fruitKeys = FF_ITEM_FRUIT_KEYS;
    const fruitKey = fruitKeys[Phaser.Math.Between(0, fruitKeys.length - 1)];
    const { width, height } = this.scale;
    const ui = createHudScaleCtx(width, height, this.mobile);
    const size = ui.px(this.mobile ? 86 : 150);
    const { xMin, xMax, spawnY } = this.getSpawnAreaPx(size);
    const safeXMin = Math.floor(Math.min(xMin, xMax));
    const safeXMax = Math.floor(Math.max(xMin, xMax));
    const x = safeXMin === safeXMax ? safeXMin : Phaser.Math.Between(safeXMin, safeXMax);
    const y = spawnY;

    const body = this.physics.add.image(x, y, fruitKey).setDepth(2);
    body.setAlpha(0.92);
    const fruitSrc = this.textures.get(fruitKey).getSourceImage() as { width?: number; height?: number };
    const fruitSrcW = fruitSrc?.width ?? 1;
    const fruitSrcH = fruitSrc?.height ?? 1;
    const fruitScale = Math.min(size / fruitSrcW, size / fruitSrcH);
    body.setDisplaySize(Math.max(1, fruitSrcW * fruitScale), Math.max(1, fruitSrcH * fruitScale));

    const arcadeBody = body.body;
    if (arcadeBody) {
      arcadeBody.setSize(body.displayWidth * 0.8, body.displayHeight * 0.8, true);
    }

    const g = Math.max(1, Number(this.physics.world.gravity.y) || FF_FRUIT_GRAVITY);
    const apexMinY = height * (this.mobile ? 0.42 : 0.25);
    const apexMaxY = height * (this.mobile ? 0.55 : 0.5);
    const apexY = Phaser.Math.FloatBetween(apexMinY, apexMaxY);
    const rise = Math.max(50, y - apexY);
    const baseVy = -Math.sqrt(2 * g * rise);

    const playW = Math.max(1, xMax - xMin);
    const vxBase = Phaser.Math.Clamp(playW * 0.18, 90, 220);
    body.setVelocity(
      Phaser.Math.Between(-Math.floor(vxBase), Math.floor(vxBase)),
      baseVy * Phaser.Math.FloatBetween(0.9, 1.05)
    );
    body.setAngularVelocity(Phaser.Math.Between(-160, 160));

    this.introFruits.push(body);
  }

  private clearSceneForEndGameKeepBg() {
    this.lockInput = true;
    this.input.enabled = false;
    this.resetSwipeState();

    this.questionIntroSeq += 1;
    this.questionOutroSeq += 1;
    this.clearQuestionVoicePlayback();

    this.stopIntroSpawning();
    this.stopSpawning();
    this.hudTimerEvent?.destroy();
    this.hudTimerEvent = undefined;
    this.timeFlashEvent?.destroy();
    this.timeFlashEvent = undefined;
    this.tickingEvent?.destroy();
    this.tickingEvent = undefined;
    this.stopTicking();

    this.tweens.killAll();

    this.input.off("pointerdown");
    this.input.off("pointerup");
    this.input.off("pointermove");

    this.clearIntroFruits();
    this.clearFruits();

    this.destroyFlyingFruitsHud();

    if (this.tutorialPopup) {
      this.tutorialPopup.title.destroy();
      this.tutorialPopup.howtoplay.destroy();
      this.tutorialPopup.startButton.destroy();
      this.tutorialPopup = undefined;
    }

    this.destroyIntroDecor();
    this.teacherHintUI?.destroy();
    this.teacherHintUI = undefined;

    const keep = this.backgroundImage;
    const children = [...this.children.list];
    for (const obj of children) {
      if (!obj || !obj.active) continue;
      if (keep && obj === keep) continue;
      obj.destroy();
    }
  }

  private getSpawnAreaPx(fruitSize: number) {
    const safe = this.getFlyingFruitsSafeArea();
    const width = safe.width;
    const height = safe.height;
    const half = fruitSize * 0.5;
    const sideInsetRatio = this.mobile ? 0.14 : 0.28;
    const inset = width * sideInsetRatio;
    const xMin = safe.x + Math.max(half, inset + half);
    const xMax = safe.x + Math.min(width - half, width - inset - half);
    const spawnY = safe.y + height + fruitSize;
    return { xMin, xMax, spawnY, width, height };
  }

  /** สุ่มตำแหน่ง X ให้ห่างจากผลไม้ที่ลอยอยู่ — ลดการทับกัน */
  private pickSpawnX(xMin: number, xMax: number, fruitSize: number): number {
    const safeMin = Math.floor(Math.min(xMin, xMax));
    const safeMax = Math.floor(Math.max(xMin, xMax));
    if (safeMin === safeMax) return safeMin;

    const minGap = fruitSize * (this.mobile ? 1.12 : 1.22);
    const activeXs = this.fruits
      .filter((f) => !f.sliced && f.body.active)
      .map((f) => f.body.x);

    for (let attempt = 0; attempt < 28; attempt += 1) {
      const x = Phaser.Math.Between(safeMin, safeMax);
      if (activeXs.every((ax) => Math.abs(ax - x) >= minGap)) return x;
    }

    if (activeXs.length === 0) return Phaser.Math.Between(safeMin, safeMax);

    let bestX = Phaser.Math.Between(safeMin, safeMax);
    let bestGap = -1;
    const samples = 16;
    const step = (safeMax - safeMin) / Math.max(1, samples - 1);
    for (let i = 0; i < samples; i += 1) {
      const x = safeMin + step * i;
      const nearest = activeXs.reduce((m, ax) => Math.min(m, Math.abs(ax - x)), Number.POSITIVE_INFINITY);
      if (nearest > bestGap) {
        bestGap = nearest;
        bestX = x;
      }
    }
    return bestX;
  }

  constructor() {
    super({
      key: "flying-fruits",
      physics: {
        default: "arcade",
        arcade: {
          gravity: { x: 0, y: FF_FRUIT_GRAVITY },
        }
      }
    });
  }

  preload() {
    this.load.image("bg_flying_fruits_mobile", "assets/flying-fruits/bg_flying_fruits_mobile.png");
    this.load.image("bg_flying_fruits", "assets/flying-fruits/bg_flying_fruits.png");
    this.load.image(FF_HOME_LOGO_KEY, FF_HOME_LOGO_PATH);
    for (const [name, path] of Object.entries(FF_ITEM_FRUIT_PATHS)) {
      this.load.image(`ff_item_fruit_${name}`, path);
    }
    this.load.image("btn_start_flying_fruits", "assets/flying-fruits/btn_start_tutorial.png");
    this.load.image("howtoplay_flying_fruits", "assets/flying-fruits/howtoplay_flying_fruits.png");
    this.load.image("howtoplay_flying_fruits_mobile", "assets/flying-fruits/howtoplay_flying_fruits_mobile.png");
    this.load.image("heart_flying_fruits", "assets/flying-fruits/heart_flying_fruits.png");
    this.load.image("slash_flying_fruits", "assets/flying-fruits/slash_flying_fruits.png");
    this.load.image("bg_question", "assets/flying-fruits/bg_question.png");
    this.load.image("ff_btn_net", "assets/flying-fruits/btn_net.png");
    this.load.image("ff_ice", "assets/flying-fruits/ice.png");
    this.load.image("ff_snowflake", "assets/flying-fruits/snowflake.png");
    if (!this.textures.exists("star")) {
      this.load.image("star", "assets/whack-a-mole/star.png");
    }
    preloadHudAssets(this);
    if (!this.textures.exists("ftm_heart_icon")) {
      this.load.image("ftm_heart_icon", "assets/flappy-bird/heart.png");
    }
    this.load.audio("bgm_clock_ticking_normal", "assets/sound/flip-cards/bgm_clock_ticking_normal_flip_cards.mp3");
    this.load.audio("bgm_clock_ticking_danger", "assets/sound/flip-cards/bgm_clock_ticking_danger_flip_cards.mp3");
    this.load.audio("bgm_game_scene", "assets/sound/flying-fruits/bgm_game_music.mp3");
    this.load.audio("bgm_result", "assets/sound/flying-fruits/bgm_result_music.mp3");
    this.load.audio("bgm_start", "assets/sound/flying-fruits/bgm_start_music.mp3");
    this.load.audio("sfx_sparkle", "assets/sound/sfx_sparkle.mp3");
    this.load.audio("sfx_correct", "assets/sound/sfx_correct_anagram.mp3");
    this.load.audio("sfx_incorrect", "assets/sound/sfx_incorrect_flip_cards.mp3");
    this.load.audio("sfx_alert_danger", "assets/sound/sfx_alert_danger_flip_cards.mp3");
    this.load.audio("sfx_alert_warning", "assets/sound/sfx_alert_warning_flip_cards.mp3");
    this.load.audio("sfx_all_correct", "assets/sound/sfx_correct_flip_cards.mp3");
    this.load.audio("sfx_notification_message", "assets/sound/sfx_notification_message_flip_cards.mp3");
    this.load.audio("sfx_pop", "assets/sound/sfx_pop.mp3");
    if (!this.cache.audio.exists("sfx_click_default")) {
      this.load.audio("sfx_click_default", "assets/sound/ui/click.mp3");
    }
    if (!this.cache.audio.exists("sfx_countnum")) {
      this.load.audio("sfx_countnum", "assets/sound/countnum.mp3");
    }
    if (!this.cache.audio.exists("sfx_freeze")) {
      this.load.audio("sfx_freeze", "assets/sound/freeze.mp3");
    }
    if (!this.cache.audio.exists("sfx_crack")) {
      this.load.audio("sfx_crack", "assets/sound/crack.mp3");
    }
    TeacherHintUI.preload(this);
  }

  async create() {
    super.create();
    this.mobile = isMobileLayout();
    this.scene.launch("HomeScene", {
      gameKey: this.scene.key,
      ui: {
        startButtonPath: "assets/flying-fruits/btn_start.png",
        howToButtonPath: "assets/flying-fruits/btn_howto.png",
        startButtonWidth: this.mobile ? 190 : 320, 
        howToButtonWidth: this.mobile ? 130 : 260,
      },
    });
    this.scene.bringToTop("HomeScene");
    this.setBgmState("start");

    const homeScene = this.scene.get("HomeScene");
    const onHomeAction = (payload: HomeActionPayload) => {
      if (payload.gameKey !== this.scene.key) return;
      if (payload.action === "howto") {
        this.events.emit("howto");
        this.openHowToPopup();
        return;
      }
    };

    homeScene.events.on("home-action", onHomeAction);
    const cleanupHomeAction = () => homeScene.events.off("home-action", onHomeAction);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, cleanupHomeAction);
    homeScene.events.once(Phaser.Scenes.Events.SHUTDOWN, cleanupHomeAction);

    this.input.enabled = false;
    this.lockInput = true;
    this.startRequested = false;
    this.assetsReady = false;
    this.gameStarted = false;
    this.ending = false;
    this.pendingPayload = undefined;
    this.hudTimerEvent?.destroy();
    this.hudTimerEvent = undefined;
    this.hudStarted = false;
    this.hudStartMs = 0;
    this.destroyFlyingFruitsHud();
    if (this.hudTimeText) this.tweens.killTweensOf(this.hudTimeText);

    this.imageKeyByUrl.clear();
    this.imageKeySeq = 0;
    this.soundKeyByUrl.clear();
    this.soundKeySeq = 0;
    this.teacherHintUI?.destroy();
    this.teacherHintUI = undefined;

    this.lastMessageShownMs = 0;
    this.lastScoreChangeMs = 0;
    this.idleNoScoreMessageShown = false;
    this.milestoneShown.clear();
    this.timeFlashEvent?.destroy();
    this.timeFlashEvent = undefined;
    this.timeFlashSeq = 0;
    this.timeRedLoopActive = false;
    this.tickingState = null;

    const { width, height } = this.scale;

    const worldWidth = width;
    const worldHeight = height;

    this.cameras.main.setBounds(0, 0, worldWidth, worldHeight);
    this.cameras.main.setScroll(0, 0);
    this.cameras.main.setBackgroundColor("#000000");
    this.physics.world.setBounds(0, 0, worldWidth, worldHeight);

    const background = this.add.image(0, 0, this.mobile ? "bg_flying_fruits_mobile" : "bg_flying_fruits").setOrigin(0, 0).setDepth(0);
    background.setDisplaySize(worldWidth, worldHeight);
    this.backgroundImage = background;
    this.destroyIntroDecor();
    this.createIntroDecor(worldWidth, worldHeight);
    this.stopIntroSpawning();
    this.clearIntroFruits();
    this.startIntroSpawning();

    const onResize = (gameSize: Phaser.Structs.Size) => {
      const w = gameSize.width;
      const h = gameSize.height;
      this.cameras.main.setBounds(0, 0, w, h);
      background.setDisplaySize(w, h);
      this.physics.world.setBounds(0, 0, w, h);
      const ffResizeInfo = this.pendingPayload?.game_info;
      const exercise =
        this.hudExerciseTitle || getHudSuggestionLabel(ffResizeInfo?.suggestion);
      this.createFlyingFruitsTopHud(exercise);
      const q = this.currentHudQuestion ?? this.questions[this.currentQuestionIndex];
      if (q) this.setFlyingFruitsHudQuestion(q);
      else this.hideFlyingFruitsQuestionHud();
    };
    this.scale.on(Phaser.Scale.Events.RESIZE, onResize);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, onResize);
      this.stopIntroSpawning();
      this.clearIntroFruits();
      this.stopSpawning();
      this.clearFruits();
      this.input.off("pointerdown");
      this.input.off("pointerup");
      this.input.off("pointermove");
      this.stopAllAudio();
      this.teacherHintUI?.destroy();
      this.teacherHintUI = undefined;
    });
        
    this.scene.get("HomeScene").events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.destroyIntroDecor();
      this.stopIntroSpawning();
      this.clearIntroFruits();
      if (!this.teacherHintUI) {
        this.createTeacherHintUI();
      } else {
        this.teacherHintUI.assistant.setCompact(true, 600);
      }
      this.startRequested = true;
      this.setBgmState("game");
      this.tryStartGame();
    });

    try {
      const payload = await this.fetchFlyingFruitsData();
      this.pendingPayload = payload;
      await this.preloadQuestionImageTextures(payload);
      await this.preloadQuestionSoundAudio(payload);
      this.assetsReady = true;
      this.tryStartGame();
    } catch (error) {
      console.error("Failed to load whack a mole data:", error);
      this.add
        .text(this.scale.width / 2, this.scale.height / 2, "โหลดข้อมูลเกมไม่สำเร็จ", {
          fontSize: "36px",
          color: "#ffffff",
          fontFamily: "Noto Sans Thai",
          backgroundColor: "#b02a37",
          padding: { x: 16, y: 10 },
        })
        .setOrigin(0.5)
        .setDepth(2000);
    }
  }

  private async fetchFlyingFruitsData(): Promise<FlyingFruitsPayload> {
    if (this.injectedPayload) {
      return this.injectedPayload as unknown as FlyingFruitsPayload;
    }
    throw new Error("Missing injected payload for scene: flying-fruits");
  }

  private tryStartGame() {
    if (this.gameStarted) return;
    if (!this.startRequested) return;
    if (!this.assetsReady) return;
    if (!this.pendingPayload) return;

    this.gameStarted = true;
    const ffInfo = this.pendingPayload.game_info;
    this.createFlyingFruitsTopHud(getHudSuggestionLabel(ffInfo.suggestion));
    this.lockInput = false;
    this.input.enabled = true;

    this.hudStarted = false;
    this.hudStartMs = 0;
    this.hudElapsedAccumSec = 0;
    this.score = 0;
    this.lifePoints = this.maxLifePoints;
    this.ffGameFailedByNoLives = false;
    this.ffGameStartCountdownDone = false;
    this.ensureHudTimer();
    this.updateHud();

    this.bindSwipeInput();
    this.buildGame(this.pendingPayload);
  }

  update() {
    if (!this.gameStarted) {
      this.cleanupOffscreenIntroFruits();
      return;
    }
    if (this.ending) return;
    this.cleanupOffscreenFruits();
    for (const fruit of this.fruits) {
      if (!fruit.body.active) continue;
      fruit.choiceCard?.setPosition(fruit.body.x, fruit.body.y);
      if (fruit.iceOverlay) {
        fruit.iceOverlay.setPosition(fruit.body.x, fruit.body.y).setAngle(fruit.body.angle);
      }
      if (fruit.snowflakeFx) {
        fruit.snowflakeFx.setPosition(fruit.body.x, fruit.body.y).setAngle(fruit.body.angle);
      }
    }
  }

  private buildGame(payload: FlyingFruitsPayload) {
    const questions = payload.questions?.filter((q) => q && Array.isArray(q.choices) && q.choices.length > 0 && q.id != null) ?? [];

    this.questions = [...questions].sort((a, b) => (a.no ?? 0) - (b.no ?? 0));
    this.totalQuestions = this.questions.length;
    this.currentQuestionIndex = 0;

    if (this.questions.length === 0) {
      this.ending = true;
      this.time.delayedCall(150, () => this.endGame());
      return;
    }

    this.score = 0;
    this.lifePoints = this.maxLifePoints;
    this.ffGameFailedByNoLives = false;
    this.ffGameStartCountdownDone = false;
    this.lastScoreChangeMs = Date.now();
    this.hudElapsedAccumSec = 0;
    this.hudStartMs = Date.now();
    this.hudStarted = true;
    this.updateHud();

    this.startFirstQuestionAfterCountdown();
  }

  /** นับ 3-2-1 ก่อน แล้วค่อยแสดงโจทย์ข้อแรก */
  private startFirstQuestionAfterCountdown() {
    if (this.questions.length === 0) {
      this.ending = true;
      this.time.delayedCall(150, () => this.endGame());
      return;
    }

    this.lockInput = true;
    this.input.enabled = false;
    this.pauseHudTime();
    this.reportRunstateStart();
    this.playCountdown(() => {
      if (!this.sys.isActive()) return;
      this.ffGameStartCountdownDone = true;
      this.resumeHudTime();
      this.renderQuestion(0);
    });
  }

  private renderQuestion(index: number) {
    const q = this.questions[index];
    if (!q) return;

    this.currentQuestionIndex = index;
    this.refreshFfQuestionProgressHud(index);

    this.syncGameAudioFromQuestion(q);

    this.clearQuestionVoicePlayback();
    const seq = (this.questionIntroSeq += 1);
    this.questionScoreEarned = 0;

    this.lockInput = true;
    this.input.enabled = false;
    this.resetSwipeState();
    this.releaseAllFfNetFreezes();
    this.netButton?.setVisible(false);
    this.stopFfNetButtonPulse();
    this.clearFruits();
    this.stopSpawning();
    this.setFlyingFruitsHudQuestion(q);
    this.remainingCorrectChoiceIds = new Set((q.choices ?? []).filter((c) => c.is_correct).map((c) => c.id));
    this.resetChoiceQueuesForQuestion(q);
    this.spawnBag = [];
    this.refillSpawnBag();

    if (this.remainingCorrectChoiceIds.size === 0) {
      this.resetSwipeState();
      this.time.delayedCall(200, () => this.goToNextQuestion());
      return;
    }

    const soundUrl = typeof q.sound_question === "string" ? q.sound_question.trim() : "";
    const hasHint = this.hasFlyingFruitsQuestionHint(q);
    const shResolved = this.resolveMediaUrl(q.sound_hint);
    const sqResolved = this.resolveMediaUrl(q.sound_question);
    const hintHasSound = !!shResolved && (!sqResolved || shResolved !== sqResolved);

    if (soundUrl && hasHint && hintHasSound) {
      // เสียงโจทย์เล่นจบก่อน แล้วค่อยขึ้นคำใบ้ + เสียงคำใบ้
      const qKey = this.soundKeyByUrl.get(this.resolveSoundUrl(soundUrl));
      guardedScenePlayQuestionThen(this, qKey, 1, () => {
        if (seq !== this.questionIntroSeq) return;
        if (!this.sys.isActive()) return;
        this.showFlyingFruitsQuestionHint(q, seq);
      });
    } else {
      if (hasHint) {
        this.showFlyingFruitsQuestionHint(q, seq);
      } else {
        this.showRandomMessage(this.messagePools.intro, 2400, "point");
      }
      if (soundUrl) {
        this.trackQuestionAudioTimer(
          this.time.delayedCall(350, () => {
            if (seq !== this.questionIntroSeq) return;
            this.playQuestionSound(soundUrl);
          })
        );
      }
    }

    const spawnPhaseDelay = soundUrl ? 700 : 350;
    this.trackQuestionAudioTimer(
      this.time.delayedCall(spawnPhaseDelay, () => {
        if (seq !== this.questionIntroSeq) return;
        this.beginQuestionSpawning();
      })
    );
  }

  private beginQuestionSpawning() {
    this.lockInput = false;
    this.input.enabled = true;
    this.netButton?.setVisible(true);
    this.startFfNetButtonPulse();
    this.startSpawning();
    const initial = this.mobile ? 2 : 3;
    for (let i = 0; i < initial; i += 1) {
      this.time.delayedCall(i * FF_FRUIT_INITIAL_SPAWN_STAGGER_MS, () => {
        if (this.lockInput || this.ending) return;
        this.spawnFruit();
      });
    }
  }

  protected override getLiveDashboardLaunchFields() {
    return {
      ...super.getLiveDashboardLaunchFields(),
      liveDashboardFlappyPassed: !this.ffGameFailedByNoLives,
    };
  }

  protected override getResultCorrectCount(): number {
    if (this.ffGameFailedByNoLives) {
      return Math.max(0, this.currentQuestionIndex);
    }
    return this.questions.length || Math.max(0, this.currentQuestionIndex + 1);
  }

  protected override getResultScoreLabel(): string | undefined {
    return this.ffGameFailedByNoLives ? "ไม่ผ่าน" : undefined;
  }

  private goToNextQuestion() {
    if (this.ending) return;
    this.reportRunstateQuestionCompleted(this.currentQuestionIndex + 1);
    const isLast = this.currentQuestionIndex >= this.questions.length - 1;
    if (isLast) {
      this.ffGameFailedByNoLives = false;
      this.ending = true;
      this.endGame();
      return;
    }
    this.currentQuestionIndex += 1;
    const nextIndex = this.currentQuestionIndex;
    const fadeMs = this.fadeOutCurrentFfQuestionHudBeforeChange();
    this.time.delayedCall(fadeMs + 40, () => {
      if (this.ending || nextIndex !== this.currentQuestionIndex) return;
      this.renderQuestion(nextIndex);
    });
  }

  protected override endGame() {
    this.ending = true;
    if (this.physics?.world) this.physics.world.pause();
    this.setBgmState("result");
    this.clearSceneForEndGameKeepBg();
    super.endGame();
  }

  private bindSwipeInput() {
    this.input.off("pointerdown");
    this.input.off("pointerup");
    this.input.off("pointermove");

    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (this.lockInput) return;
      if (this.ending) return;
      this.pointerDown = true;
      this.lastPointerPos = new Phaser.Math.Vector2(pointer.x, pointer.y);
    });

    this.input.on("pointerup", () => {
      this.resetSwipeState();
    });

    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      if (!this.pointerDown) return;
      if (this.lockInput) return;
      if (this.ending) return;
      if (!this.lastPointerPos) {
        this.lastPointerPos = new Phaser.Math.Vector2(pointer.x, pointer.y);
        return;
      }

      const from = this.lastPointerPos;
      const to = new Phaser.Math.Vector2(pointer.x, pointer.y);
      this.lastPointerPos = to;

      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const dist2 = dx * dx + dy * dy;
      if (dist2 < 6 * 6) return;

      this.spawnSwipeTrail(from, to);
      const angleDeg = Phaser.Math.RadToDeg(Phaser.Math.Angle.Between(from.x, from.y, to.x, to.y));
      const line = new Phaser.Geom.Line(from.x, from.y, to.x, to.y);
      for (const fruit of this.fruits) {
        if (fruit.sliced) continue;
        if (!fruit.body.active) continue;
        const radius = Math.max(18, fruit.body.displayWidth * 0.34);
        const circle = new Phaser.Geom.Circle(fruit.body.x, fruit.body.y, radius);
        if (Phaser.Geom.Intersects.LineToCircle(line, circle)) {
          this.sliceFruit(fruit, angleDeg);
        }
      }
    });
  }

  private spawnSwipeTrail(from: Phaser.Math.Vector2, to: Phaser.Math.Vector2) {
    const g = this.add.graphics().setDepth(1400);
    g.setBlendMode(Phaser.BlendModes.ADD);
    g.lineStyle(this.mobile ? 4 : 5, 0xffffff, 0.75);
    g.beginPath();
    g.moveTo(from.x, from.y);
    g.lineTo(to.x, to.y);
    g.strokePath();
    this.tweens.add({
      targets: g,
      alpha: 0,
      duration: 140,
      ease: "Cubic.easeOut",
      onComplete: () => g.destroy(),
    });
  }

  private startSpawning() {
    if (this.spawnEvent) return;
    this.spawnEvent = this.time.addEvent({
      delay: this.mobile ? FF_FRUIT_SPAWN_DELAY_MS.mobile : FF_FRUIT_SPAWN_DELAY_MS.desktop,
      loop: true,
      callback: () => {
        if (this.lockInput) return;
        if (this.ending) return;
        const maxActive = this.mobile ? 3 : 4;
        if (this.fruits.filter((f) => f.body.active && !f.sliced).length >= maxActive) return;
        this.spawnFruit();
      },
    });
  }

  private stopSpawning() {
    this.spawnEvent?.destroy();
    this.spawnEvent = undefined;
  }

  private addFfChoiceSpeaker(
    container: Phaser.GameObjects.Container,
    x: number,
    y: number,
    size: number,
    audioKey: string
  ): Phaser.GameObjects.Image {
    const speaker = this.add
      .image(x, y, HUD_VOLUME_TEXTURE_KEY)
      .setDisplaySize(size, size)
      .setDepth(20)
      .setInteractive({ useHandCursor: true });
    speaker.on(
      "pointerdown",
      (_p: Phaser.Input.Pointer, _lx: number, _ly: number, event: Phaser.Types.Input.EventData) => {
        event.stopPropagation();
        guardedScenePlayChoice(this, audioKey, 1);
      }
    );
    container.add(speaker);
    return speaker;
  }

  private buildFruitChoiceCard(
    choice: FlyingFruitsChoice,
    x: number,
    y: number,
    fruitSize: number,
    depth: number
  ): Phaser.GameObjects.Container {
    const mobile = this.mobile;
    const tc = mobile ? CHOCIE_CHOICE_TUNING.mobile : CHOCIE_CHOICE_TUNING.desktop;
    const ffOverlay = mobile ? FF_CHOICE_OVERLAY.mobile : FF_CHOICE_OVERLAY.desktop;
    const layoutTc = { ...tc, ...ffOverlay };
    const inner = fruitSize * ffOverlay.innerRatio;
    const bW = inner;
    const bH = inner;
    const container = this.add.container(x, y).setDepth(depth);

    const word = (choice.choice ?? "").trim();
    const imageUrl = typeof choice.image_choice === "string" ? choice.image_choice.trim() : "";
    const soundUrl = typeof choice.sound_choice === "string" ? choice.sound_choice.trim() : "";
    const resolvedImage = imageUrl ? this.resolveImageUrl(imageUrl) : "";
    const resolvedSound = soundUrl ? this.resolveSoundUrl(soundUrl) : "";
    const hasText = word.length > 0;
    const hasImage = !!resolvedImage && this.imageKeyByUrl.has(resolvedImage);
    const hasAudio = !!resolvedSound && this.soundKeyByUrl.has(resolvedSound);
    const imgKey = hasImage ? this.imageKeyByUrl.get(resolvedImage) : undefined;
    const audioKey = hasAudio ? this.soundKeyByUrl.get(resolvedSound) : undefined;
    const textRes = Math.min(3, typeof window !== "undefined" ? window.devicePixelRatio || 2 : 2);
    const speakerSize = ffOverlay.speakerSize;

    if (hasImage && imgKey) {
      const { frameW, frameH, frameCenterY, frameBottom, frameLeft } = resolveChocieChoiceImageFrameLayout(
        bH,
        bW,
        layoutTc,
        mobile,
        hasText,
        hasAudio,
        speakerSize
      );
      const pad = mobile ? 6 : 8;
      const frame = this.add.graphics().setDepth(8);
      frame.setPosition(0, frameCenterY);
      drawQuestionMediaFrameBox(frame, frameW, frameH);
      container.add(frame);

      const tex = this.textures.get(imgKey).getSourceImage() as { width: number; height: number };
      const fit = fitQuestionMediaContainSize(tex.width, tex.height, frameW - pad * 2, frameH - pad * 2);
      container.add(this.add.image(0, frameCenterY, imgKey).setDisplaySize(fit.imageW, fit.imageH).setDepth(9));

      if (hasText) {
        const pillPadX = mobile ? 8 : 10;
        const boxInnerW = getChocieInnerWidth(bW, mobile);
        const maxPillW = hasAudio
          ? Math.max(tc.textPillMinW, boxInnerW - speakerSize * 0.65)
          : boxInnerW;
        const { pillW, fontPx } = resolveChocieChoiceTextMetrics(
          word,
          mobile,
          pillPadX,
          tc.textPillMinW,
          maxPillW,
          {
            baseFont: mobile ? 15 : 20,
            minFont: mobile ? 12 : 14,
            maxFont: mobile ? 28 : 32,
          }
        );
        const overlay = computeChocieChoiceBoxBottomOverlayLayout(
          frameBottom,
          speakerSize,
          mobile,
          hasAudio,
          pillW,
          { imageTextGap: layoutTc.imageFrameGap, speakerPillOverlap: tc.speakerPillOverlap }
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
              ...chocieThaiGameTextStyle({ mobile, fontPx, tightBottom: true }),
            })
            .setOrigin(0.5, 0.5)
            .setDepth(12)
            .setResolution(textRes)
        );
        if (hasAudio && audioKey) {
          this.addFfChoiceSpeaker(container, overlay.speakerX, overlay.speakerY, overlay.speakerSize, audioKey);
        }
      } else if (hasAudio && audioKey) {
        this.addFfChoiceSpeaker(container, frameLeft + speakerSize * 0.28, frameBottom, speakerSize, audioKey);
      }
    } else if (hasText) {
      const pillH = mobile ? 34 : 40;
      const pillPadX = mobile ? 10 : 12;
      const boxInnerW = getChocieInnerWidth(bW, mobile);
      const boxCenterY = getChocieInnerCenterY(bH, layoutTc.labelBoxTopTrim, layoutTc.labelBoxBottomTrim);
      const fontOpts = {
        baseFont: mobile ? 18 : 24,
        minFont: mobile ? 14 : 18,
        maxFont: mobile ? 30 : 38,
      };

      if (hasAudio && audioKey) {
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
              ...chocieThaiGameTextStyle({ mobile, fontPx, tightBottom: true }),
            })
            .setOrigin(0.5, 0.5)
            .setDepth(11)
            .setResolution(textRes)
        );
        this.addFfChoiceSpeaker(container, layout.speakerX, layout.speakerY, layout.speakerSize, audioKey);
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
              ...chocieThaiGameTextStyle({ mobile, fontPx, tightBottom: true }),
            })
            .setOrigin(0.5, 0.5)
            .setDepth(11)
            .setResolution(textRes)
        );
      }
    } else if (hasAudio && audioKey) {
      const boxCenterY = getChocieInnerCenterY(bH, layoutTc.labelBoxTopTrim, layoutTc.labelBoxBottomTrim);
      this.addFfChoiceSpeaker(container, 0, boxCenterY, speakerSize, audioKey);
    }

    return container;
  }

  private spawnFruit() {
    const q = this.questions[this.currentQuestionIndex];
    if (!q) return;

    const choices = this.dedupeChoices(q.choices ?? []);
    const correctChoices = choices.filter(
      (c) => c.is_correct && this.remainingCorrectChoiceIds.has(c.id)
    );
    const wrongChoices = choices.filter((c) => !c.is_correct);

    const onScreen = this.activeChoiceKeysOnScreen();
    const canSpawnCorrect = correctChoices.some((c) => !onScreen.has(this.choiceIdentityKey(c)));
    const canSpawnWrong = wrongChoices.some((c) => !onScreen.has(this.choiceIdentityKey(c)));
    if (!canSpawnCorrect && !canSpawnWrong) return;

    let category = this.nextSpawnCategory(canSpawnCorrect, canSpawnWrong);
    let choice: FlyingFruitsChoice | undefined;

    if (category === "correct") {
      const picked = this.takeChoiceFromQueue(this.correctChoiceQueue, correctChoices);
      this.correctChoiceQueue = picked.queue;
      choice = picked.choice;
      if (!choice && wrongChoices.length > 0) {
        const wrongPick = this.takeChoiceFromQueue(this.wrongChoiceQueue, wrongChoices);
        this.wrongChoiceQueue = wrongPick.queue;
        choice = wrongPick.choice;
        category = choice ? "wrong" : "decoy";
      } else if (!choice) {
        category = "decoy";
      }
    } else if (category === "wrong") {
      const picked = this.takeChoiceFromQueue(this.wrongChoiceQueue, wrongChoices);
      this.wrongChoiceQueue = picked.queue;
      choice = picked.choice;
      if (!choice && correctChoices.length > 0) {
        const correctPick = this.takeChoiceFromQueue(this.correctChoiceQueue, correctChoices);
        this.correctChoiceQueue = correctPick.queue;
        choice = correctPick.choice;
        category = choice ? "correct" : "decoy";
      } else if (!choice) {
        category = "decoy";
      }
    }

    const isDecoy = category === "decoy" || !choice;
    const decoyKeys = FF_ITEM_FRUIT_KEYS.slice(5);
    const normalKeys = FF_ITEM_FRUIT_KEYS.slice(0, 5);
    const fruitKey = isDecoy
      ? decoyKeys[Phaser.Math.Between(0, decoyKeys.length - 1)]
      : normalKeys[Phaser.Math.Between(0, normalKeys.length - 1)];

    const { width: sw, height: sh } = this.scale;
    const ui = createHudScaleCtx(sw, sh, this.mobile);
    const size = ui.px(this.mobile ? 140 : 220);
    const { xMin, xMax, spawnY, height } = this.getSpawnAreaPx(size);
    const x = this.pickSpawnX(xMin, xMax, size);
    const y = spawnY;

    const body = this.physics.add.image(x, y, fruitKey).setDepth(6);
    const fruitSrc = this.textures.get(fruitKey).getSourceImage() as { width?: number; height?: number };
    const fruitSrcW = fruitSrc?.width ?? 1;
    const fruitSrcH = fruitSrc?.height ?? 1;
    const fruitScale = Math.min(size / fruitSrcW, size / fruitSrcH);
    body.setDisplaySize(Math.max(1, fruitSrcW * fruitScale), Math.max(1, fruitSrcH * fruitScale));
    const arcadeBody = body.body;
    if (arcadeBody) {
      arcadeBody.setSize(body.displayWidth * 0.8, body.displayHeight * 0.8, true);
    }
    const g = Math.max(1, Number(this.physics.world.gravity.y) || FF_FRUIT_GRAVITY);
    const apexMinY = height * (this.mobile ? 0.42 : 0.3);
    const apexMaxY = height * (this.mobile ? 0.55 : 0.45);
    const apexY = Phaser.Math.FloatBetween(apexMinY, apexMaxY);
    const rise = Math.max(50, y - apexY);
    const baseVy = -Math.sqrt(2 * g * rise);

    const playW = Math.max(1, xMax - xMin);
    const vxBase = Phaser.Math.Clamp(playW * 0.18, 90, 220) * FF_FRUIT_MOTION_SPEED;
    body.setVelocity(
      Phaser.Math.Between(-Math.floor(vxBase), Math.floor(vxBase)),
      baseVy * Phaser.Math.FloatBetween(0.92, 1.05)
    );
    body.setAngularVelocity(
      Phaser.Math.Between(-180, 180) * FF_FRUIT_MOTION_SPEED
    );

    let choiceCard: Phaser.GameObjects.Container | undefined;
    if (!isDecoy && choice) {
      choiceCard = this.buildFruitChoiceCard(choice, x, y, size, 7);
    }

    const fruit: FlyingFruitsFruitView = { choice, isDecoy, fruitKey, body, choiceCard, sliced: false };
    this.fruits.push(fruit);
  }

  private createParticleBurst(x: number, y: number, depth: number) {
    if (!this.textures.exists("star")) return;
    const particles = this.add.particles(x, y - 60, "star", {
      speed: { min: 100, max: 250 },
      angle: { min: 0, max: 360 },
      lifespan: 800,
      gravityY: 300,
      quantity: 15,
      emitting: false,
    });

    particles.explode(15);
    particles.setDepth(depth);

    this.time.delayedCall(1000, () => particles.destroy());
  }

  private showScorePlus(x: number, y: number, amount: number, depth: number) {
    const { width, height } = this.scale;
    const r = Math.max(30, Math.round(Math.min(width, height) * 0.06));

    const circle = this.add.circle(0, 0, r, 0xffffff, 0.95);
    const label = this.add
      .text(0, 0, amount > 0 ? `+${amount}` : `${amount}`, {
        fontSize: `${Math.round(r * 0.95)}px`,
        color: "#025B96",
        fontFamily: "Noto Sans Thai",
        fontStyle: "bold",
      })
      .setOrigin(0.5, 0.5);

    const container = this.add.container(x, y + 40, [circle, label]).setDepth(depth);
    container.setScale(0).setAlpha(0);

    this.tweens.chain({
      targets: container,
      tweens: [
        {
          y,
          scale: 1.2,
          alpha: 1,
          duration: 300,
          ease: "Back.easeOut",
        },
        {
          scale: 1.1,
          duration: 300,
          ease: "Sine.easeInOut",
          yoyo: true,
          repeat: 0,
        },
        {
          y: y - height * (this.mobile ? 0.12 : 0.2),
          x,
          scale: 0.95,
          alpha: 0,
          duration: 520,
          ease: "Sine.easeInOut",
          onComplete: () => container.destroy(true),
        },
      ],
    });
  }

  private showWrongHeartFx(x: number, y: number, depth: number) {
    if (!this.textures.exists("heart_flying_fruits")) return;
    const heart = this.add.image(x, y, "heart_flying_fruits").setOrigin(0.5, 0.5).setDepth(depth);
    const size = this.mobile ? 52 : 64;
    heart.setDisplaySize(size, size);
    heart.setAlpha(1);

    const baseX = heart.x;
    const baseY = heart.y;
    const baseScaleX = heart.scaleX;
    const baseScaleY = heart.scaleY;

    this.tweens.add({
      targets: heart,
      x: { from: baseX - 10, to: baseX + 10 },
      duration: 60,
      repeat: 5,
      yoyo: true,
      ease: "Sine.easeInOut",
    });

    this.tweens.add({
      targets: heart,
      scaleX: { from: baseScaleX * 0.9, to: baseScaleX * 1.18 },
      scaleY: { from: baseScaleY * 0.9, to: baseScaleY * 1.18 },
      duration: 100,
      yoyo: true,
      repeat: 1,
      ease: "Back.easeOut",
      easeParams: [2.4],
    });

    this.tweens.add({
      targets: heart,
      y: baseY - 72,
      alpha: 0,
      duration: 620,
      ease: "Cubic.easeOut",
      onComplete: () => heart.destroy(),
    });
  }

  private animateHeartLoss(lostIndex: number): Promise<void> {
    if (!this.hudHearts.length) return Promise.resolve();
    const hearts = this.hudHearts;
    const heart = hearts[lostIndex];
    if (!heart) return Promise.resolve();

    this.tweens.killTweensOf(heart);
    const baseX = heart.x;
    const baseY = heart.y;
    const baseScaleX = heart.scaleX;
    const baseScaleY = heart.scaleY;
    heart.setAlpha(1);
    heart.setPosition(baseX, baseY);

    return new Promise((resolve) => {
      const totalMs = 620;
      const shake = this.tweens.add({
        targets: heart,
        x: { from: baseX - 10, to: baseX + 10 },
        duration: 60,
        repeat: 5,
        yoyo: true,
        ease: "Sine.easeInOut",
      });

      const blink = this.tweens.add({
        targets: heart,
        alpha: { from: 1, to: 0.1 },
        duration: 80,
        yoyo: true,
        repeat: 6,
        ease: "Sine.easeInOut",
      });

      const pulse = this.tweens.add({
        targets: heart,
        scaleX: { from: baseScaleX, to: baseScaleX * 1.16 },
        scaleY: { from: baseScaleY, to: baseScaleY * 1.16 },
        duration: 80,
        yoyo: true,
        repeat: 3,
        ease: "Sine.easeInOut",
      });

      this.time.delayedCall(totalMs, () => {
        shake.stop();
        blink.stop();
        pulse.stop();
        this.tweens.killTweensOf(heart);
        heart.setPosition(baseX, baseY);
        heart.setScale(baseScaleX, baseScaleY);
        heart.setAlpha(0.25);
        resolve();
      });
    });
  }

  /** แตกผลไม้บนจอแบบมีเอฟเฟกต์ — ไม่คิดคะแนน/หัวใจ */
  private popFruitVisual(fruit: FlyingFruitsFruitView, slashAngleDeg: number = 0) {
    if (fruit.sliced) return;
    fruit.sliced = true;
    const arcadeBody = fruit.body.body;
    if (arcadeBody) arcadeBody.enable = false;

    const slash = this.add
      .image(fruit.body.x, fruit.body.y, "slash_flying_fruits")
      .setOrigin(0.5, 0.5)
      .setDepth(fruit.body.depth + 9)
      .setAlpha(0.92)
      .setAngle(slashAngleDeg);
    const slashSrc = this.textures.get("slash_flying_fruits").getSourceImage() as { width?: number; height?: number };
    const slashW = slashSrc?.width ?? 1;
    const slashH = slashSrc?.height ?? 1;
    const maxW = Math.max(1, fruit.body.displayWidth * 1.25);
    const maxH = Math.max(1, fruit.body.displayHeight * 1.25);
    const s = Math.min(maxW / slashW, maxH / slashH);
    slash.setDisplaySize(Math.max(1, slashW * s), Math.max(1, slashH * s));
    this.tweens.add({
      targets: slash,
      alpha: 0,
      scale: 1.08,
      duration: 220,
      ease: "Cubic.easeOut",
      onComplete: () => slash.destroy(),
    });

    const targets: Phaser.GameObjects.GameObject[] = [fruit.body];
    if (fruit.choiceCard) targets.push(fruit.choiceCard);
    this.tweens.add({
      targets,
      alpha: 0,
      scale: "+=0.18",
      duration: 140,
      ease: "Quad.easeOut",
      onComplete: () => this.destroyFruit(fruit),
    });
  }

  private async breakAllFruitsOnScreen(seq: number): Promise<void> {
    const onScreen = this.fruits.filter((f) => !f.sliced && f.body.active);
    if (!onScreen.length) return;
    this.playSfx("sfx_sparkle", 0.85);
    for (const fruit of onScreen) {
      this.popFruitVisual(fruit, Phaser.Math.Between(-50, 50));
    }
    await this.waitForFruitsToClear(seq, 4000);
  }

  private sliceFruit(fruit: FlyingFruitsFruitView, slashAngleDeg: number = 0) {
    if (fruit.sliced) return;
    fruit.sliced = true;
    const arcadeBody = fruit.body.body;
    if (arcadeBody) {
      arcadeBody.enable = false;
    }

    this.playSfx("sfx_sparkle", 1);
    const slash = this.add
      .image(fruit.body.x, fruit.body.y, "slash_flying_fruits")
      .setOrigin(0.5, 0.5)
      .setDepth(fruit.body.depth + 9)
      .setAlpha(0.92)
      .setAngle(slashAngleDeg);
    const slashSrc = this.textures.get("slash_flying_fruits").getSourceImage() as { width?: number; height?: number };
    const slashW = slashSrc?.width ?? 1;
    const slashH = slashSrc?.height ?? 1;
    const maxW = Math.max(1, fruit.body.displayWidth * 1.25);
    const maxH = Math.max(1, fruit.body.displayHeight * 1.25);
    const s = Math.min(maxW / slashW, maxH / slashH);
    slash.setDisplaySize(Math.max(1, slashW * s), Math.max(1, slashH * s));
    this.tweens.add({
      targets: slash,
      alpha: 0,
      scale: 1.08,
      duration: 220,
      ease: "Cubic.easeOut",
      onComplete: () => slash.destroy(),
    });

    const targets: Phaser.GameObjects.GameObject[] = [fruit.body];
    if (fruit.choiceCard) targets.push(fruit.choiceCard);

    this.tweens.add({
      targets,
      alpha: 0,
      scale: "+=0.18",
      duration: 140,
      ease: "Quad.easeOut",
      onComplete: () => this.destroyFruit(fruit),
    });

    const isCorrect = fruit.isDecoy ? false : Boolean(fruit.choice?.is_correct);
    if (isCorrect) {
      this.score += 10;
      this.questionScoreEarned += 10;
      this.refreshFlyingFruitsHud();
      this.playSfx("sfx_correct", 1);
      this.lastScoreChangeMs = Date.now();
      if (fruit.choice) this.remainingCorrectChoiceIds.delete(fruit.choice.id);
      this.showScorePlus(fruit.body.x, fruit.body.y, 10, fruit.body.depth + 12);
      this.createParticleBurst(fruit.body.x, fruit.body.y, fruit.body.depth + 11);
      this.showRandomMessage(this.messagePools.correct, 1400, "clap");

      if (this.remainingCorrectChoiceIds.size === 0) {
        this.clearQuestionVoicePlayback();
        this.lockInput = true;
        this.input.enabled = false;
        this.resetSwipeState();
        this.stopSpawning();
        const outroSeq = (this.questionOutroSeq += 1);
        void (async () => {
          await this.breakAllFruitsOnScreen(outroSeq);
          if (outroSeq !== this.questionOutroSeq) return;
          if (!this.sys.isActive()) return;
          if (this.ending) return;
          await this.playQuestionCompleteOutro();
          if (outroSeq !== this.questionOutroSeq) return;
          if (!this.sys.isActive()) return;
          if (this.ending) return;
          this.goToNextQuestion();
        })();
      }
      return;
    }

    const prevLife = this.lifePoints;
    this.lifePoints -= 1;
    this.playSfx("sfx_incorrect", 1);
    this.showWrongHeartFx(fruit.body.x, fruit.body.y, fruit.body.depth + 11);
    this.showRandomMessage(this.messagePools.wrong, 1600, "point");
    const lostIndex = Phaser.Math.Clamp(prevLife - 1, 0, this.maxLifePoints - 1);
    const shouldEnd = this.lifePoints <= 0;
    if (shouldEnd) {
      this.ffGameFailedByNoLives = true;
      this.lockInput = true;
      this.input.enabled = false;
      this.resetSwipeState();
      this.stopSpawning();
      this.pauseHudTime();
    }
    void this.animateHeartLoss(lostIndex).then(async () => {
      if (!this.sys.isActive()) return;
      this.updateHud();
      if (!shouldEnd) return;
      const seq = (this.questionOutroSeq += 1);
      await this.waitForFruitsToClear(seq, 6500);
      if (!this.sys.isActive()) return;
      if (this.ending) return;
      this.endGame();
    });
  }

  private destroyFruit(fruit: FlyingFruitsFruitView) {
    const idx = this.fruits.indexOf(fruit);
    if (idx >= 0) this.fruits.splice(idx, 1);
    this.clearFfNetOnFruitDestroyed(fruit);
    fruit.body.destroy();
    fruit.choiceCard?.destroy();
  }

  private clearFruits() {
    this.releaseAllFfNetFreezes();
    for (const fruit of this.fruits) {
      fruit.freezeTimer?.destroy();
      fruit.freezeTimer = undefined;
      fruit.iceOverlay?.destroy();
      this.destroyFfSnowflakeFx(fruit);
      fruit.body.destroy();
      fruit.choiceCard?.destroy();
    }
    this.fruits = [];
  }

  private cleanupOffscreenFruits() {
    const { width, height } = this.scale;
    const maxSize = this.fruits.reduce((m, f) => Math.max(m, f.body.displayWidth, f.body.displayHeight), 0);
    const margin = Math.max(180, Math.round(maxSize + 40));
    const toRemove: FlyingFruitsFruitView[] = [];
    for (const fruit of this.fruits) {
      if (!fruit.body.active) continue;
      const x = fruit.body.x;
      const y = fruit.body.y;
      if (x < -margin || x > width + margin || y > height + margin) {
        toRemove.push(fruit);
      }
    }
    for (const fruit of toRemove) this.destroyFruit(fruit);
  }

  private playQuestionSound(soundUrl?: string) {
    const raw = (soundUrl ?? "").trim();
    if (!raw) return;
    const resolved = this.resolveSoundUrl(raw);
    const key = this.soundKeyByUrl.get(resolved);
    if (!key) return;
    if (!this.cache.audio.exists(key)) return;
    guardedScenePlayQuestion(this, key, 1);
  }

  private trackQuestionAudioTimer(ev: Phaser.Time.TimerEvent) {
    this.questionAudioTimers.push(ev);
  }

  private cancelQuestionAudioTimers() {
    for (const ev of this.questionAudioTimers) ev?.destroy();
    this.questionAudioTimers = [];
  }

  private stopFfQuestionVoices() {
    const keys = new Set<string>();
    for (const q of this.questions) {
      for (const raw of [q.sound_question, q.sound_hint]) {
        const resolved = this.resolveSoundUrl((raw ?? "").trim());
        if (!resolved) continue;
        const key = this.soundKeyByUrl.get(resolved);
        if (key) keys.add(key);
      }
    }
    for (const key of keys) {
      this.sound.stopByKey(key);
    }
  }

  private clearQuestionVoicePlayback() {
    this.cancelQuestionAudioTimers();
    this.stopFfQuestionVoices();
  }


  private ensureHudTimer() {
    if (this.hudTimerEvent) return;
    this.hudTimerEvent = this.time.addEvent({
      delay: 250,
      loop: true,
      callback: () => this.updateHud(),
    });
  }

  private updateHud() {
    const elapsed = this.getHudElapsedSeconds();
    this.hudTimeText?.setText(this.formatHudElapsedTime());
    this.refreshFlyingFruitsHud();
    this.updateTimedMessages(elapsed);
    this.updateTickingByRemaining(elapsed);
  }

  private updateTimedMessages(elapsedSeconds: number) {
    if (!this.hudStarted) return;
    if (!this.gameStarted) return;
    const now = Date.now();
    const canShowMessage = now - this.lastMessageShownMs >= 2600;

    for (const sec of this.messageMilestonesSec) {
      if (elapsedSeconds < sec) continue;
      if (this.milestoneShown.has(sec)) continue;
      this.milestoneShown.add(sec);
      if (sec === 15 || sec === 30 || sec === 45) this.playSfx("sfx_alert_warning", 1);
      if (sec === 60 || sec === 90) this.playSfx("sfx_alert_danger", 1);
      this.triggerTimeUiMilestone(sec);
      const pool = this.messagePools.time[sec] ?? [];
      if (canShowMessage) this.showRandomMessage(pool, 2400, "point");
      return;
    }

    if (canShowMessage && !this.idleNoScoreMessageShown && this.lastScoreChangeMs > 0 && now - this.lastScoreChangeMs >= 15_000) {
      this.idleNoScoreMessageShown = true;
      this.showRandomMessage(this.messagePools.idleNoScore15, 2200, "point");
    } else if (canShowMessage && !this.idleNoScoreMessageShown && this.lastScoreChangeMs > 0 && now - this.lastScoreChangeMs >= 5_000) {
      this.idleNoScoreMessageShown = true;
      this.showRandomMessage(this.messagePools.idleNoScore5, 2200, "point");
    }
  }

  private triggerTimeUiMilestone(sec: number) {
    if (!this.hudTimeText) return;

    if (sec === 15) {
      this.startTimeFlash(0xfff2b3, 3, false);
      return;
    }

    if (sec === 30 || sec === 45) {
      this.startTimeFlash(0xffb74d, 3, false);
      return;
    }

    if (sec === 60) {
      this.startTimeFlash(0xFF0076, 3, false);
    }

    if (sec === 90) {
      if (this.timeRedLoopActive) return;
      this.startTimeFlash(0xFF0076, 1, true);
    }
  }

  private startTimeFlash(color: number, flashes: number, loop: boolean) {
    if (!this.hudTimeText) return;

    this.timeFlashEvent?.destroy();
    this.timeFlashEvent = undefined;
    this.tweens.killTweensOf(this.hudTimeText);
    this.hudTimeText.setAlpha(0.25);
    this.timeRedLoopActive = loop;
    const seq = (this.timeFlashSeq += 1);

    const baseColor = "#2e84c8";
    const flashColor = this.colorToCss(color);
    this.hudTimeText.setColor(flashColor);

    const duration = loop ? 260 : 140;
    const safeFlashes = Math.max(1, Math.floor(flashes));
    const repeat = loop ? -1 : safeFlashes * 2 - 2;

    this.timeFlashEvent = this.time.addEvent({
      delay: duration,
      loop: loop,
      repeat: loop ? 0 : repeat,
      callback: () => {
        if (seq !== this.timeFlashSeq) return;
        if (!this.hudTimeText) return;
        const nextAlpha = this.hudTimeText.alpha < 0.9 ? 1 : 0.25;
        this.hudTimeText.setAlpha(nextAlpha);
      },
    });

    if (loop) return;

    const totalMs = duration * (repeat + 1) + 40;
    this.time.delayedCall(totalMs, () => {
      if (seq !== this.timeFlashSeq) return;
      if (!this.hudTimeText) return;
      if (!this.timeRedLoopActive) {
        this.hudTimeText.setAlpha(1);
        this.hudTimeText.setColor(baseColor);
      }
      this.timeFlashEvent?.destroy();
      this.timeFlashEvent = undefined;
    });
  }

  private colorToCss(value: number) {
    const safe = Math.max(0, Math.min(0xffffff, Math.floor(value)));
    return `#${safe.toString(16).padStart(6, "0")}`;
  }

  private updateTickingByRemaining(elapsedSeconds: number) {
    if (!this.gameStarted) return;
    if (!this.hudStarted) {
      this.stopTicking();
      return;
    }
    if (this.bgmState !== "game") {
      this.stopTicking();
      return;
    }

    const next: "normal" | "danger" = elapsedSeconds >= 90 ? "danger" : "normal";
    if (this.tickingState === next) return;
    this.tickingState = next;

    this.stopTickingAudio();

    const key = next === "normal" ? "bgm_clock_ticking_normal" : "bgm_clock_ticking_danger";
    if (!this.cache.audio.exists(key)) return;

    this.tickingSoundKey = key;
    const volume = 0.3;
    const playOnce = () => {
      if (!this.sys.isActive()) return;
      if (!this.gameStarted) return;
      if (!this.hudStarted) return;
      if (this.bgmState !== "game") return;
      if (this.tickingSoundKey !== key) return;
      guardedScenePlay(this, key, volume, "background");
    };

    playOnce();
    this.tickingEvent = this.time.addEvent({
      delay: 1000,
      loop: true,
      callback: playOnce,
    });
  }

  private async preloadQuestionImageTextures(payload: FlyingFruitsPayload): Promise<void> {
    const rawPaths =
      payload.questions
        ?.flatMap((q) => [
          q.image_question,
          q.image_hint,
          ...(q.choices?.map((c) => c.image_choice) ?? []),
        ])
        .filter((v): v is string => typeof v === "string" && v.trim().length > 0) ?? [];

    const urls = rawPaths.map((p) => this.resolveImageUrl(p)).filter(Boolean);
    const uniqueUrls = Array.from(new Set(urls));

    const toLoad: Array<{ key: string; url: string }> = [];
    for (const url of uniqueUrls) {
      if (this.imageKeyByUrl.has(url)) continue;
      const key = `question_img_${this.imageKeySeq++}`;
      this.imageKeyByUrl.set(url, key);
      if (!this.textures.exists(key)) {
        toLoad.push({ key, url });
      }
    }

    if (toLoad.length === 0) return;

    this.load.setCORS("anonymous");

    await new Promise<void>((resolve) => {
      const onComplete = () => {
        this.load.off(Phaser.Loader.Events.COMPLETE, onComplete);
        resolve();
      };
      this.load.once(Phaser.Loader.Events.COMPLETE, onComplete);

      for (const item of toLoad) {
        this.load.image(item.key, item.url);
      }
      this.load.start();
    });
  }

  private async preloadQuestionSoundAudio(payload: FlyingFruitsPayload): Promise<void> {
    const rawPaths =
      payload.questions
        ?.flatMap((q) => [
          q.sound_question,
          q.sound_hint,
          ...(q.choices?.map((c) => c.sound_choice) ?? []),
        ])
        .filter((v): v is string => typeof v === "string" && v.trim().length > 0) ?? [];

    const urls = rawPaths.map((p) => this.resolveSoundUrl(p)).filter(Boolean);
    const uniqueUrls = Array.from(new Set(urls));

    const toLoad: Array<{ key: string; url: string }> = [];
    for (const url of uniqueUrls) {
      if (this.soundKeyByUrl.has(url)) continue;
      const key = `question_sound_${this.soundKeySeq++}`;
      this.soundKeyByUrl.set(url, key);
      if (!this.cache.audio.exists(key)) {
        toLoad.push({ key, url });
      }
    }

    if (toLoad.length === 0) return;

    this.load.setCORS("anonymous");

    await new Promise<void>((resolve) => {
      const onComplete = () => {
        this.load.off(Phaser.Loader.Events.COMPLETE, onComplete);
        resolve();
      };
      this.load.once(Phaser.Loader.Events.COMPLETE, onComplete);

      for (const item of toLoad) {
        this.load.audio(item.key, item.url);
      }
      this.load.start();
    });
  }

  private resolveSoundUrl(pathOrUrl: string): string {
    const raw = pathOrUrl.trim();
    if (!raw) return "";
    const normalized = raw.toLowerCase();
    if (normalized === "null" || normalized === "undefined") return "";
    if (/^https?:\/\//i.test(raw)) return raw;
    return `${API_BASE_URL}${raw}`;
  }

  private resolveImageUrl(pathOrUrl: string): string {
    const raw = pathOrUrl.trim();
    if (!raw) return "";
    if (/^https?:\/\//i.test(raw)) return raw;
    return `${API_BASE_URL}${raw}`;
  }

  private createIntroDecor(worldWidth: number, worldHeight: number) {
    const centerX = worldWidth / 2;
    const centerY = worldHeight / 3;

    const title = this.add.image(centerX, centerY, FF_HOME_LOGO_KEY).setDepth(4);
    title.setAlpha(0);

    this.introDecor = { title, animated: false };

    this.layoutIntroDecor(worldWidth, worldHeight);
  }

  private layoutIntroDecor(worldWidth: number, worldHeight: number) {
    const decor = this.introDecor;
    if (!decor) return;

    const centerX = worldWidth / 2;
    const centerY = worldHeight / 3;
    
    const titleSrc = this.textures.get(FF_HOME_LOGO_KEY).getSourceImage() as { width?: number; height?: number };
    const titleW = titleSrc?.width ?? 1;
    const titleH = titleSrc?.height ?? 1;
    const titleMaxW = worldWidth * (this.mobile ? 0.9 : 0.8);
    const titleMaxH = worldHeight * (this.mobile ? 0.3 : 0.25);
    const titleScale = Math.min(titleMaxW / titleW, titleMaxH / titleH);

    this.tweens.killTweensOf(decor.title);

    const titleX = centerX;
    const titleY = this.mobile ? centerY - worldHeight * 0.1 : centerY - worldHeight * 0.1;

    decor.title.setScale(titleScale);
    decor.animated = true;
    decor.title.setPosition(titleX, titleY).setAlpha(1);
    this.startIntroLogoSwing(decor.title);
  }

  private startIntroLogoSwing(title: Phaser.GameObjects.Image) {
    this.tweens.killTweensOf(title);
    title.setAngle(0);
    this.tweens.add({
      targets: title,
      angle: { from: -3.5, to: 3.5 },
      duration: 900,
      ease: "Sine.easeInOut",
      yoyo: true,
      repeat: -1,
    });
  }

  private destroyIntroDecor() {
    const decor = this.introDecor;
    this.introDecor = undefined;
    if (!decor) return;
    this.tweens.killTweensOf(decor.title);
    decor.title.destroy();
  }

  private playSfx(key: string, volume: number) {
    guardedScenePlay(this, key, volume);
  }

  private playVoice(key: string, volume: number) {
    guardedScenePlayVoice(this, key, volume);
  }

  private resolveMediaUrl(pathOrUrl?: string | null): string {
    const raw = (pathOrUrl ?? "").trim();
    if (!raw) return "";
    if (/^https?:\/\//i.test(raw)) return raw;
    return `${API_BASE_URL}${raw}`;
  }

  private createTeacherHintUI() {
    if (this.teacherHintUI) return;
    this.teacherHintUI = new TeacherHintUI(this, {
      mobile: this.mobile,
      depth: 2600,
      messageDepth: 2650,
      onNotificationSfx: () => this.playSfx("sfx_notification_message", 1),
    });
    this.teacherHintUI.create("standby", true);
  }

  private hasFlyingFruitsQuestionHint(q: FlyingFruitsQuestion): boolean {
    const hint = (q.hint ?? "").trim();
    const imgUrl = this.resolveMediaUrl(q.image_hint);
    const imgKey = imgUrl && this.imageKeyByUrl.has(imgUrl) ? this.imageKeyByUrl.get(imgUrl) : undefined;
    return !!(hint || (imgKey && this.textures.exists(imgKey)));
  }

  private playFlyingFruitsHintSound(soundHint?: string | null, soundQuestion?: string | null) {
    const sh = this.resolveMediaUrl(soundHint);
    const sq = this.resolveMediaUrl(soundQuestion);
    if (!sh || (sq && sh === sq)) return;
    const key = this.soundKeyByUrl.get(sh);
    if (key && this.cache.audio.exists(key)) {
      guardedScenePlayQuestion(this, key, 1);
    }
  }

  private showFlyingFruitsQuestionHint(q: FlyingFruitsQuestion, introSeq?: number) {
    if (!this.teacherHintUI) this.createTeacherHintUI();
    const hint = (q.hint ?? "").trim();
    const imgUrl = this.resolveMediaUrl(q.image_hint);
    const imgKey =
      imgUrl && this.imageKeyByUrl.has(imgUrl) ? (this.imageKeyByUrl.get(imgUrl) as string) : undefined;
    const imgReady = !!(imgKey && this.textures.exists(imgKey));

    this.trackQuestionAudioTimer(
      this.time.delayedCall(600, () => {
        if (introSeq !== undefined && introSeq !== this.questionIntroSeq) return;
        this.playFlyingFruitsHintSound(q.sound_hint, q.sound_question);
      })
    );
    if (!hint && !imgReady) return;

    this.teacherHintUI?.presentHint({
      text: hint,
      hintTextureKey: imgReady ? imgKey : undefined,
      durationMs: 5200,
      teacherState: "point",
    });
  }

  private showRandomMessage(pool: readonly string[], durationMs?: number, teacherStateWhileVisible?: TeacherState) {
    const safePool = Array.isArray(pool) ? pool : [];
    if (safePool.length === 0) return;
    const id = Phaser.Utils.Array.GetRandom(safePool);
    const entry = this.messageCatalog[id];
    if (!entry) return;
    this.showMessage(entry.text, durationMs, entry.voice, teacherStateWhileVisible);
  }

  private showMessage(
    text: string,
    durationMs: number = 2000,
    voiceKey?: string,
    teacherStateWhileVisible?: TeacherState
  ) {
    const clean = (text ?? "").trim();
    if (!clean) return;
    if (!this.teacherHintUI) this.createTeacherHintUI();
    if (!this.teacherHintUI) return;

    this.lastMessageShownMs = Date.now();
    this.teacherHintUI.present({
      text: clean,
      durationMs,
      teacherState: teacherStateWhileVisible,
      resetHintBeforeShow: true,
    });
    if (voiceKey) this.playVoice(voiceKey, 1);
  }

  private hideMessage() {
    this.teacherHintUI?.hide();
  }

  protected onGameAudioSettingsChanged(): void {
    const s = this.bgmState;
    if (!s) return;
    this.bgmState = null;
    this.setBgmState(s);
  }

  private setBgmState(next: "start" | "game" | "result") {
    if (this.bgmState === next) return;
    this.bgmState = next;

    this.stopTicking();
    this.stopAndDestroySound(this.bgmStartSound);
    this.bgmStartSound = undefined;
    this.stopAndDestroySound(this.bgmGameSound);
    this.bgmGameSound = undefined;
    this.stopAndDestroySound(this.bgmResultSound);
    this.bgmResultSound = undefined;

    if (!canPlayGameAudio("background")) return;

    const key = next === "start" ? "bgm_start" : next === "game" ? "bgm_game_scene" : "bgm_result";
    if (!this.cache.audio.exists(key)) return;
    const volume = GAME_BGM_VOLUME;
    const sound = this.sound.add(key, { loop: true, volume });
    sound.play();
    if (next === "start") this.bgmStartSound = sound;
    if (next === "game") this.bgmGameSound = sound;
    if (next === "result") this.bgmResultSound = sound;
  }

  private stopAllAudio() {
    this.bgmState = null;
    this.stopTicking();
    this.stopAndDestroySound(this.bgmStartSound);
    this.bgmStartSound = undefined;
    this.stopAndDestroySound(this.bgmGameSound);
    this.bgmGameSound = undefined;
    this.stopAndDestroySound(this.bgmResultSound);
    this.bgmResultSound = undefined;
  }

  private stopTicking() {
    this.tickingState = null;
    this.stopTickingAudio();
  }
    
  private stopTickingAudio() {
    this.tickingSoundKey = null;
    this.tickingEvent?.destroy();
    this.tickingEvent = undefined;
    this.sound.stopByKey("bgm_clock_ticking_normal");
    this.sound.stopByKey("bgm_clock_ticking_danger");
  }
    
  private stopAndDestroySound(sound?: Phaser.Sound.BaseSound) {
    if (!sound) return;
    if (sound.isPlaying) sound.stop();
    sound.destroy();
  }

  private openHowToPopup() {
    const { width, height } = this.scale;
  
    const destroyPopup = () => {
      const popup = this.tutorialPopup;
      this.tutorialPopup = undefined;
      popup?.title.destroy();
      popup?.howtoplay.destroy();
      popup?.startButton.destroy();
      if (popup) {
        this.input.enabled = popup.restoreInputEnabled;
        this.lockInput = popup.restoreLockInput;
      }
      this.input.setDefaultCursor("default");
      this.input.manager.canvas.style.cursor = "default";
    };
  
    if (this.tutorialPopup) destroyPopup();
    
    const restoreInputEnabled = this.input.enabled;
    const restoreLockInput = this.lockInput;
    this.input.enabled = true;
    this.lockInput = true;
    this.input.setDefaultCursor("default");
    this.input.manager.canvas.style.cursor = "default";
    this.destroyIntroDecor();
  
    const fitTo = (key: string, maxW: number, maxH: number) => {
      const src = this.textures.get(key).getSourceImage() as { width?: number; height?: number };
      const w = src?.width ?? 1;
      const h = src?.height ?? 1;
      const s = Math.min(maxW / w, maxH / h);
      return { w: Math.max(1, w * s), h: Math.max(1, h * s) };
    };
  
    const titleIconSize = fitTo(FF_HOME_LOGO_KEY, this.mobile ? width * 0.75 : width * 0.30, this.mobile ? height * 0.25 : height * 0.3);
    const title = this.add.image(width / 2, this.mobile ? height / 6 : height / 8, FF_HOME_LOGO_KEY).setDepth(3001);
    title.setDisplaySize(titleIconSize.w, titleIconSize.h);
  
    const howToMaxH = this.mobile ? height * 0.62 : height * 0.58;
    const howToSize = fitTo(this.mobile ? "howtoplay_flying_fruits_mobile" : "howtoplay_flying_fruits", this.mobile ? width * 0.92 : width * 0.88, howToMaxH);
    const howToY = this.mobile ? height / 2 - height * 0.055 : height / 2 + Math.max(12, height * 0.03);
    const howtoplay = this.add.image(width / 2, howToY, this.mobile ? "howtoplay_flying_fruits_mobile" : "howtoplay_flying_fruits").setDepth(3003);
    howtoplay.setDisplaySize(howToSize.w, howToSize.h);
  
    const btnMaxW = Math.min(260, width * (0.40));
    const btnSize = fitTo("btn_start_flying_fruits", btnMaxW, height * 0.16);
    const btnY = Math.min(height - btnSize.h / 2 - 24, howToY + howToSize.h / 2 + btnSize.h / 2 + Math.max(14, height * 0.03));
    const startButton = this.add.image(width / 2, btnY, "btn_start_flying_fruits").setDepth(3004);
    startButton.setDisplaySize(btnSize.w, btnSize.h);
    startButton.setInteractive({ useHandCursor: true });
    startButton.once("pointerdown", () => {
      this.playSfx("sfx_click_default", 1);
      startButton.disableInteractive();
      destroyPopup();
      if (this.scene.isActive("HomeScene")) this.scene.stop("HomeScene");
    });
  
    this.tutorialPopup = {
      title,
      howtoplay,
      startButton,
      restoreInputEnabled,
      restoreLockInput,
    };
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => destroyPopup());
  }
}
