import Phaser from "phaser";
import { BaseGameScene } from "../../core/scenes/BaseGameScene";
import {
  BG_HUD_TEXTURE_KEY,
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
  preloadHudAssets,
} from "../../core/hud/gameHudLayout";
import {
  createPhaserQuestionProgressHud,
  getQuestionProgressLabel,
  layoutPhaserQuestionProgressAtSlot,
  type PhaserQuestionProgressHud,
} from "../../core/hud/questionProgressHud";
import type { HomeActionPayload } from "../../core/scenes/HomeScene";
import { isMobileLayout } from "../../utils/device";
import { maybeShuffleChoices } from "../../utils/shuffleAnswer";
import {
  isShortMobileViewport,
  isTinyMobileViewport,
  mobileCompactPx,
} from "../../utils/mobileLayout";
import { createHudScaleCtx, type HudScaleCtx } from "../../utils/desktopUiScale";
import { TeacherHintUI } from "../../core/teacher/TeacherHintUI";
import type { TeacherState } from "../../core/teacher/TeacherAssistant";
import { API_BASE_URL } from "../../core/api";
import { createThaiTextElement, estimateThaiTextLineCount } from "../../utils/thaiText";
import {
  drawQuestionMediaFrameBox,
  drawQuestionMediaOverlayTextPill,
  fitQuestionMediaContainSize,
} from "../../utils/questionHudMedia";
import {
  canPlayGameAudio,
  GAME_BGM_VOLUME,
  guardedScenePlay,
  guardedScenePlayChoice,
  guardedScenePlayQuestion,
  guardedScenePlayQuestionThen,
  guardedScenePlayVoice,
} from "../../core/audio/sceneAudio";

const GSQ_BGM_KEYS = {
  start: "gsq_bgm_start",
  game: "gsq_bgm_game_scene",
  result: "gsq_bgm_result",
} as const;

type GameShowQuizChoice = {
  id: number;
  id_question_multiple: number;
  choice: string;
  is_correct: boolean;
  sound_choice: string;
  image_choice: string;
}

type GameShowQuizQuestion = {
  id: number;
  id_game_info: number;
  no: number;
  question: string;
  sound_question: string;
  image_question: string;
  hint: string;
  sound_hint: string;
  image_hint: string;
  shuffle_answer?: boolean | string | number | null;
  choices: GameShowQuizChoice[];
};

type GameShowQuizPayload = {
  game_info: {
    id: number;
    uuid: string;
    exercise_name: string;
    subject: string;
    question_type: string;
    game_type: string;
    thumbnail: string;
    question_category_id: number;
    other_image: string;
    suggestion: string;
  };
  questions: GameShowQuizQuestion[];
}

interface ParallaxObject {
  image: Phaser.GameObjects.Image;
  layerId: string;
}

interface LayerConfig {
  yRatio: number;
  speed: number;
  spacing: number;
  depth: number;
}

type LayerConfigMap = Record<string, LayerConfig>;
type AssetScaleMap = Record<string, number>;

type QuizQuestionState = {
  id: number;
  no: number;
  question: string;
  sound_question: string;
  image_question: string;
  hint: string;
  sound_hint: string;
  image_hint: string;
  choices: GameShowQuizChoice[];
  /** คำตอบที่ถูกทั้งหมดของข้อนี้ (อาจมากกว่า 1) */
  correctChoiceIds: number[];
};

type ChoiceRowUI = {
  container: Phaser.GameObjects.Container;
  pickZone: Phaser.GameObjects.Zone;
  bg: Phaser.GameObjects.Graphics;
  imageFrame?: Phaser.GameObjects.Graphics;
  circleBg: Phaser.GameObjects.Graphics;
  letterText: Phaser.GameObjects.Text;
  dom: Phaser.GameObjects.DOMElement;
  inner: HTMLElement;
  volumeBtn?: Phaser.GameObjects.Image;
  image?: Phaser.GameObjects.Image;
  choiceId: number;
  isCorrect: boolean;
  eliminated: boolean;
  disabled: boolean;
  soundKey: string | null;
  width: number;
  height: number;
  pillW: number;
  pillH: number;
};

type GsqChoiceOverlayLayout = {
  speakerX: number;
  speakerY: number;
  speakerSize: number;
  pillLeft: number;
  pillTop: number;
  pillW: number;
  pillH: number;
  textCenterX: number;
  textCenterY: number;
};

const GSQ_CHOICE_LETTER_COLOR = "#0092D7";
const GSQ_CHOICE_GRID_GAP_SCALE = 0.8;

const GSQ_CHOICE_TUNING = {
  mobile: {
    speakerSize: 34,
    pillH: 32,
    pillHImage: 28,
    pillPadX: 8,
    pillMinW: 64,
    imageFrameSize: 200,
    fontBase: 15,
    fontMin: 12,
    fontMax: 22,
  },
  desktop: {
    speakerSize: 40,
    pillH: 36,
    pillHImage: 32,
    pillPadX: 10,
    pillMinW: 76,
    imageFrameSize: 200,
    fontBase: 18,
    fontMin: 13,
    fontMax: 26,
  },
} as const;

function gsqChoiceVisualLen(text: string): number {
  return text.replace(/\s+/g, "").replace(/[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/g, "").length;
}

function resolveGsqChoicePillMetrics(
  text: string,
  minW: number,
  maxW: number,
  fontOpts: { base: number; min: number; max: number }
): { pillW: number; fontPx: number } {
  const len = gsqChoiceVisualLen(text);
  const grow = Phaser.Math.Clamp((len - 2) / 14, 0, 1);
  const pillW = Phaser.Math.Clamp(Phaser.Math.Linear(minW, maxW, grow), minW, maxW);
  let fontDelta = 0;
  if (len <= 2) fontDelta = 6;
  else if (len <= 5) fontDelta = 3;
  else if (len <= 10) fontDelta = 0;
  else if (len <= 16) fontDelta = -2;
  else fontDelta = -4;
  const fontPx = Phaser.Math.Clamp(fontOpts.base + fontDelta, fontOpts.min, fontOpts.max);
  return { pillW, fontPx };
}

function resolveGsqChoiceImageFrameLayout(
  contentW: number,
  rowH: number,
  pillH: number,
  speakerSize: number,
  frameSizePx: number,
  px: (n: number) => number,
  hasText: boolean,
  hasSound: boolean
): {
  frameW: number;
  frameH: number;
  frameCenterY: number;
  frameBottom: number;
  frameTop: number;
} {
  const pillExtend = hasText ? pillH / 2 : hasSound ? speakerSize / 2 : 0;
  const maxByRow = Math.max(px(72), rowH - pillExtend - px(6));
  let frameW = Math.min(px(frameSizePx), contentW, maxByRow);
  const frameH = frameW;

  const totalBlockH = frameH + pillExtend;
  const frameTop = -totalBlockH / 2;
  const frameCenterY = frameTop + frameH / 2;
  const frameBottom = frameTop + frameH;

  return { frameW, frameH, frameCenterY, frameBottom, frameTop };
}

function computeGsqChoiceBottomOverlayLayout(
  anchorY: number,
  speakerSize: number,
  hasSound: boolean,
  pillW: number,
  pillH: number
): GsqChoiceOverlayLayout {
  const pillTop = anchorY - pillH / 2;
  if (hasSound) {
    const overlap = speakerSize * 0.35;
    const totalW = pillW + speakerSize - overlap;
    const groupLeft = -totalW / 2;
    const speakerX = groupLeft + speakerSize / 2;
    const pillLeft = groupLeft + speakerSize - overlap;
    return {
      speakerX,
      speakerY: anchorY,
      speakerSize,
      pillLeft,
      pillTop,
      pillW,
      pillH,
      textCenterX: pillLeft + pillW / 2,
      textCenterY: anchorY,
    };
  }
  return {
    speakerX: 0,
    speakerY: 0,
    speakerSize: 0,
    pillLeft: -pillW / 2,
    pillTop,
    pillW,
    pillH,
    textCenterX: 0,
    textCenterY: anchorY,
  };
}

function computeGsqChoiceInlineLayout(
  pillW: number,
  pillH: number,
  speakerSize: number,
  centerY: number,
  hasSound: boolean
): GsqChoiceOverlayLayout {
  if (!hasSound) {
    return {
      speakerX: 0,
      speakerY: 0,
      speakerSize: 0,
      pillLeft: -pillW / 2,
      pillTop: centerY - pillH / 2,
      pillW,
      pillH,
      textCenterX: 0,
      textCenterY: centerY,
    };
  }
  const overlap = speakerSize * 0.35;
  const totalW = pillW + speakerSize - overlap;
  const groupLeft = -totalW / 2;
  const speakerX = groupLeft + speakerSize / 2;
  const pillLeft = groupLeft + speakerSize - overlap;
  const pillTop = centerY - pillH / 2;
  return {
    speakerX,
    speakerY: centerY,
    speakerSize,
    pillLeft,
    pillTop,
    pillW,
    pillH,
    textCenterX: pillLeft + pillW / 2,
    textCenterY: centerY,
  };
}

type LifelineKey = "freeze" | "fiftyFifty" | "twoChance" | "pass";

const GSQ_HUD_MAX_LIVES = 3;
type LifelineButtonUI = {
  key: LifelineKey;
  image: Phaser.GameObjects.Image;
  available: boolean;
};

type QuizPanelUI = {
  bg: Phaser.GameObjects.Graphics;
  itemsBg: Phaser.GameObjects.Graphics;
  quizNoUnderline: Phaser.GameObjects.Graphics;
};

type QuizUIState = {
  container: Phaser.GameObjects.Container;
  panel: QuizPanelUI;
  quizNoDom: Phaser.GameObjects.DOMElement;
  quizNoInner: HTMLElement;
  questionBox: Phaser.GameObjects.Graphics;
  questionDom: Phaser.GameObjects.DOMElement;
  questionInner: HTMLElement;
  questionImage?: Phaser.GameObjects.Image;
  questionVolumeBtn?: Phaser.GameObjects.Image;
  choicesContainer: Phaser.GameObjects.Container;
  lifelineContainer: Phaser.GameObjects.Container;
  lifelineButtons: LifelineButtonUI[];
};

const getLayerConfigs = (isMobile: boolean): LayerConfigMap => ({
  "front": { yRatio: 0.7, speed: isMobile ? 5 : 8, spacing: isMobile ? 600 : 600, depth: 120 },
  "back0": { yRatio: isMobile ? 0.445 : 0.45, speed: isMobile ? 2.5 : 4, spacing: isMobile ? 600 : 600, depth: 40 },
  "back1": { yRatio: isMobile ? 0.4265 : 0.4315, speed: isMobile ? 1.2 : 2, spacing: isMobile ? 1000 : 1500, depth: 30 },
  "back2": { yRatio: isMobile ? 0.4 : 0.4, speed: isMobile ? 0.6 : 1, spacing: isMobile ? 800 : 1000, depth: 20 },
  "back3": { yRatio: isMobile ? 0.595 : 0.6, speed: isMobile ? 0.3 : 0.5, spacing: isMobile ? 400 : 600, depth: 10 },
});

const getAssetScales = (isMobile: boolean): AssetScaleMap => ({
  "bush": isMobile ? 0.075 : 0.1,
  "tree_green_double": isMobile ? 0.125 : 0.15,
  "bus_stop": isMobile ? 0.125 : 0.15,
  "traffic_sign": isMobile ? 0.175 : 0.2,
  "tree_blue_double": isMobile ? 0.075 : 0.1,
  "tree_green_quad": isMobile ? 0.125 : 0.15,
  "giant_swing": isMobile ? 0.125 : 0.15,
  "temple": isMobile ? 0.125 : 0.15,
  "gate": isMobile ? 0.125 : 0.15,
  "pattaya": isMobile ? 0.125 : 0.15,
  "city": isMobile ? 0.175 : 0.2,
  "mountain": isMobile ? 0.175 : 0.2,
  "cloud_left": isMobile ? 0.125 : 0.15,
  "cloud_right": isMobile ? 0.125 : 0.15,
});

export default class GameShowQuizGameScene extends BaseGameScene {
  private imageKeyByUrl = new Map<string, string>();
  private imageKeySeq = 0;
  private soundKeyByUrl = new Map<string, string>();
  private soundKeySeq = 0;

  private bgmState: "start" | "game" | "result" | null = null;
  private bgmStartSound?: Phaser.Sound.BaseSound;
  private bgmGameSound?: Phaser.Sound.BaseSound;
  private bgmResultSound?: Phaser.Sound.BaseSound;

  private tickingState: "normal" | "danger" | null = null;
  private tickingEvent?: Phaser.Time.TimerEvent;
  private tickingSoundKey: string | null = null;

  private pendingPayload?: GameShowQuizPayload;

  private teacherHintUI?: TeacherHintUI;

  private lockInput = false;
  private startRequested = false;
  private assetsReady = false;
  private gameStarted = false;

  private frozenHudElapsedSec: number | null = null;
  private hudTimerEvent?: Phaser.Time.TimerEvent;
  private hudStartMs = 0;
  private hudStarted = false;
  private hudElapsedAccumSec = 0;

  private statsHudContainer?: Phaser.GameObjects.Container;
  private timeUI?: {
    bg: Phaser.GameObjects.Image;
    labelIcon: Phaser.GameObjects.Image;
    text: Phaser.GameObjects.Text;
  };
  private scoreUI?: {
    bg: Phaser.GameObjects.Image;
    labelText: Phaser.GameObjects.Text;
    text: Phaser.GameObjects.Text;
  };
  private livesUI?: {
    bg: Phaser.GameObjects.Image;
    hearts: Phaser.GameObjects.Image[];
  };
  private gsqQuestionProgress?: PhaserQuestionProgressHud;
  private gsqHudLives = GSQ_HUD_MAX_LIVES;
  private gsqGameFailedByNoLives = false;
  private parallaxGameplayMul = 1;
  private endCutsceneActive = false;
  private gsqGameIntroShown = false;
  private lastMessageShownMs = 0;
  private lastScoreChangeMs = 0;
  private idleNoScoreMessageShown = false;
  private readonly messageMilestonesSec = [15, 30, 45, 60, 90];
  private milestoneShown = new Set<number>();
  private questionMessageFlags: { idle15Shown: boolean; item30Shown: boolean; time50Shown: boolean } = {
    idle15Shown: false,
    item30Shown: false,
    time50Shown: false,
  };
  private readonly messageCatalog: Record<string, { text: string; voice?: string }> = {
    game_intro: {
      text: "คุณคือรถสองแถวสีแดง คำตอบที่ถูกจะทำให้เราไปไกลขึ้น",
    },
    intro_a: { text: "พร้อมยัง ไปเริ่มกันเลย!" },
    intro_b: { text: "ข้อนี้ไม่ยาก ลองดูนะ!" },
    intro_c: { text: "ตั้งใจฟังคำถามดี ๆ นะ" },
    intro_d: { text: "มาเก็บคะแนนกัน!" },
    intro_e: { text: "ข้อต่อไปมาแล้ว!"},
    intro_f: { text: "ดูดี ๆ ข้อนี้มีหลอกนะ"},
    intro_g: { text: "ลองคิดก่อนตอบน้า!"},
    intro_h: { text: "ข้อใหม่มาแล้ว สู้ ๆ!"},
    
    idle_a: { text: "เลือกคำตอบได้เลย" },
    idle_b: { text: "รีบหน่อย เวลากำลังเดินนะ" },
    idle_c: { text: "ลองดูตัวเลือกดี ๆ" },
    idle_d: { text: "ฟังคำถามอีกครั้งก็ได้นะ" },
    
    time_50_a: { text: "เร็ว ๆ เวลาใกล้หมดแล้ว!" },
    time_50_b: { text: "อีกนิดเดียว รีบตอบเลย!" },
    time_50_c: { text: "ไม่ทันแล้วน้า รีบเลย!" },
    time_50_d: { text: "ตัดสินใจเลย!" },

    item_a: { text: "ลองใช้ 50:50 ไหม?" },
    item_b: { text: "ถ้าไม่แน่ใจ กด PASS ก่อนได้" },
    item_c: { text: "ใช้ FREEZE ช่วยหยุดเวลาก็ได้นะ" },
    item_d: { text: "2 CHANCE ก็ช่วยได้นะ!" },
  
    correct_a: { text: "เร่งเครื่องไปเลย!" },
    correct_b: { text: "พุ่งทะยาน!" },
    correct_c: { text: "เก่งมาก!" },
    
    wrong_a: { text: "อุ๊ย! ติดไฟแดงซะแล้ว" },
    wrong_b: { text: "ลองเช็คเครื่องอีกทีนะ" },
    wrong_c: { text: "เบรกตัวโก่งเลย!" },

    two_chance_a: { text: "ไม่เป็นไร ลองใหม่อีกครั้งนะ" },
    two_chance_b: { text: "ยังมีโอกาสอีกครั้ง" },
    two_chance_c: { text: "เกือบถูกแล้วเชียว" },
  
    done_a: { text: "จบแล้ว เก่งมาก!" },
    done_b: { text: "ทำได้ดีเลยนะ!" },
    done_c: { text: "ลองอีกรอบไหม รอบหน้าดีกว่าเดิมแน่!" },
    done_d: { text: "สุดยอด ไปทำคะแนนให้สูงกว่านี้กัน!" },
  };
    
  private readonly messagePools = {
    intro: ["intro_a", "intro_b", "intro_c", "intro_d", "intro_e", "intro_f", "intro_g", "intro_h"],
    idle: ["idle_a", "idle_b", "idle_c", "idle_d"],
    time: {
      50: ["time_50_a", "time_50_b", "time_50_c", "time_50_d"],
    } as Record<number, string[]>,
    item: ["item_a", "item_c", "item_d"],
    correct: ["correct_a", "correct_b", "correct_c"],
    wrong: ["wrong_a", "wrong_b", "wrong_c"],
    two_chance: ["two_chance_a", "two_chance_b", "two_chance_c"],
    done: ["done_a", "done_b", "done_c", "done_d"],
  };
  private timeFlashEvent?: Phaser.Time.TimerEvent;
  private timeFlashSeq = 0;
  private timeBoxColor = 0xffffff;
  private timeRedLoopActive = false;
  private timeTextBaseColor = "#0092D7";
  private scoreTextBaseColor = "#0092D7";
  private scoreFlashSeq = 0;
  private static readonly LIFELINE_SCORE_COST = 2;
  private hudTimeFontSize: string | null = null;
  private quizPanelFlashSeq = 0;

  private introDecor?: {
    overlay: Phaser.GameObjects.Rectangle;
    lawn: Phaser.GameObjects.Rectangle;
    icon: Phaser.GameObjects.Image;
    truck: Phaser.GameObjects.Image;
    tuktuk: Phaser.GameObjects.Image;
    flagLeft: Phaser.GameObjects.Image;
    flagRight: Phaser.GameObjects.Image;
  };

  private parallaxLayers: {
    tileSprites: { [key: string]: Phaser.GameObjects.TileSprite };
    objects: ParallaxObject[];
  } = {
    tileSprites: {},
    objects: [],
  };

  private tutorialPopup?: {
    overlay: Phaser.GameObjects.Rectangle;
    lawn: Phaser.GameObjects.Rectangle;
    title?: Phaser.GameObjects.Image;
    howtoplay: Phaser.GameObjects.Image;
    startButton: Phaser.GameObjects.Image;
    restoreInputEnabled: boolean;
    restoreLockInput: boolean;
  };

  private questionImagePreview?: Phaser.GameObjects.Container;
  private questionImagePreviewDomVisibility = new Map<Phaser.GameObjects.DOMElement, boolean>();

  private mobile = false;

  private questions: QuizQuestionState[] = [];
  private numberOfQuestions = 0;
  private currentQuestionIndex = 0;
  /** คำตอบที่ถูกของข้อปัจจุบันที่ยังต้องเลือกให้ครบ */
  private remainingCorrectChoiceIds = new Set<number>();
  private correctAnswers = 0;
  
  private lifeLines: {
    freeze: boolean;
    fiftyFifty: boolean;
    twoChance: boolean;
    pass: boolean;
  } = {
    freeze: true,
    fiftyFifty: true,
    twoChance: true,
    pass: false,
  };

  private questionTimerEvent?: Phaser.Time.TimerEvent;
  private questionTimeRemainingMs = 60_000;
  private questionTimerLastTickMs = 0;
  private questionTimerPaused = false;
  private freezeResumeEvent?: Phaser.Time.TimerEvent;

  private eliminatedChoiceIds = new Set<number>();
  private twoChanceArmed = false;
  private twoChanceWrongUsed = false;
  private questionSoundKey: string | null = null;
  private questionFlowToken = 0;
  private questionAudioTimers: Phaser.Time.TimerEvent[] = [];

  private quizUI?: QuizUIState;
  private preservedQuizPanelBg?: Phaser.GameObjects.Graphics;

  private choiceUIs: ChoiceRowUI[] = [];
  private questionTimerUI?: {
    container: Phaser.GameObjects.Container;
    box: Phaser.GameObjects.Graphics;
    barBg: Phaser.GameObjects.Graphics;
    barFill: Phaser.GameObjects.Graphics;
    layout?: { w: number; h: number };
  };
  private questionTimerUiOnResize?: () => void;
  private detachHomeSceneShutdown?: () => void;


  constructor() {
    super("game-show-quiz");
  }

  preload() {
    this.load.image("bg_game_show", "assets/flip-cards/bg_flip_cards.png");
    this.load.image("bg_game_show_mobile", "assets/flip-cards/bg_flip_cards_mobile.png");
    if (!this.textures.exists("star")) {
      this.load.image("star", "assets/flip-cards/star.png");
    }
    this.load.image("gsq_btn_start_tutorial", "assets/game-show-quiz/btn_start_tutorial.png");
    this.load.image("gsq_logo", "assets/game-show-quiz/logo.png");
    this.load.image("gsq_howtoplay", "assets/game-show-quiz/howtoplay.png");
    this.load.image("gsq_howtoplay_mobile", "assets/game-show-quiz/howtoplay_mobile.png");

    this.load.image("bus_stop", "assets/game-show-quiz/bus_stop.png");
    this.load.image("bush", "assets/game-show-quiz/bush.png");
    this.load.image("city", "assets/game-show-quiz/city.png");
    this.load.image("cloud_left", "assets/game-show-quiz/cloud_left.png");
    this.load.image("cloud_right", "assets/game-show-quiz/cloud_right.png");
    this.load.image("gate", "assets/game-show-quiz/gate.png");
    this.load.image("giant_swing", "assets/game-show-quiz/giant_swing.png");
    this.load.image("lawn", "assets/game-show-quiz/lawn.png");
    this.load.image("mountain", "assets/game-show-quiz/mountain.png");
    this.load.image("pattaya", "assets/game-show-quiz/pattaya.png");
    this.load.image("road", "assets/game-show-quiz/road.png");
    this.load.image("temple", "assets/game-show-quiz/temple.png");
    this.load.image("traffic_sign", "assets/game-show-quiz/traffic_sign.png");
    this.load.image("tree_blue_double", "assets/game-show-quiz/tree_blue_double.png");
    this.load.image("tree_green_double", "assets/game-show-quiz/tree_green_double.png");
    this.load.image("tree_green_quad", "assets/game-show-quiz/tree_green_quad.png");
    this.load.image("truck", "assets/game-show-quiz/truck.png");
    this.load.image("truck_home", "assets/game-show-quiz/truck_home.png");
    this.load.image("tuktuk", "assets/game-show-quiz/tuktuk.png");
    this.load.image("gsq_heart_icon", "assets/flappy-bird/heart.png");
    preloadHudAssets(this);

    this.load.image("btn_item_fifty_fifty", "assets/game-show-quiz/btn_item_fifty_fifty.png");
    this.load.image("btn_item_freeze", "assets/game-show-quiz/btn_item_freeze.png");
    this.load.image("btn_item_pass", "assets/game-show-quiz/btn_item_pass.png");
    this.load.image("btn_item_two_chance", "assets/game-show-quiz/btn_item_two_chance.png");

    this.load.image("icon", "assets/game-show-quiz/icon.png");
    this.load.image("flag_left", "assets/game-show-quiz/chequered_flag_left.png");
    this.load.image("flag_right", "assets/game-show-quiz/chequered_flag_right.png");

    this.load.audio(GSQ_BGM_KEYS.game, "assets/sound/game-show-quiz/bgm_game.mp3");
    this.load.audio(GSQ_BGM_KEYS.result, "assets/sound/game-show-quiz/bgm_result.mp3");
    this.load.audio(GSQ_BGM_KEYS.start, "assets/sound/game-show-quiz/bgm_start.mp3");

    this.load.audio("sfx_coin_collect", "assets/sound/sfx_coin_collect.mp3");
    this.load.audio("sfx_pop", "assets/sound/sfx_pop.mp3");
    this.load.audio("sfx_correct", "assets/sound/sfx_correct_anagram.mp3");
    this.load.audio("sfx_incorrect", "assets/sound/sfx_incorrect_flip_cards.mp3");
    this.load.audio("sfx_notification_message", "assets/sound/sfx_notification_message_flip_cards.mp3");
    this.load.audio("sfx_bubble", "assets/sound/sfx_bubble.mp3");

    TeacherHintUI.preload(this);
  }

  async create() {
    super.create();
    this.mobile = isMobileLayout();
    this.scene.launch("HomeScene", {

      gameKey: this.scene.key,
      ui: {
        startButtonPath: "assets/game-show-quiz/btn_start.png",
        howToButtonPath: "assets/game-show-quiz/btn_howto.png",
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
    this.pendingPayload = undefined;
    this.frozenHudElapsedSec = null;
    this.hudElapsedAccumSec = 0;
    this.hudTimerEvent?.destroy();
    this.hudTimerEvent = undefined;
    this.hudStarted = false;
    this.hudStartMs = 0;
    this.destroyStatsHud();
    this.gsqHudLives = GSQ_HUD_MAX_LIVES;
    this.gsqGameFailedByNoLives = false;
    this.parallaxGameplayMul = 1;
    this.endCutsceneActive = false;
    this.gsqGameIntroShown = false;
    this.teacherHintUI?.destroy();
    this.teacherHintUI = undefined;
    this.lastMessageShownMs = 0;
    this.lastScoreChangeMs = 0;
    this.idleNoScoreMessageShown = false;
    this.milestoneShown.clear();
    this.timeFlashEvent?.destroy();
    this.timeFlashEvent = undefined;
    this.timeFlashSeq = 0;
    this.timeBoxColor = 0xffffff;
    this.timeRedLoopActive = false;
    this.tickingState = null;
    this.questions = [];
    this.numberOfQuestions = 0;
    this.currentQuestionIndex = 0;
    this.correctAnswers = 0;
    this.lifeLines = { freeze: true, fiftyFifty: true, twoChance: true, pass: false };
    this.questionTimeRemainingMs = 60_000;
    this.questionTimerLastTickMs = 0;
    this.questionTimerPaused = false;
    this.eliminatedChoiceIds.clear();
    this.twoChanceArmed = false;
    this.twoChanceWrongUsed = false;
    this.stopQuestionTimer();
    this.freezeResumeEvent?.destroy();
    this.freezeResumeEvent = undefined;
    this.destroyQuizUI();
    this.destroyQuestionTimerUi();

    const { width, height } = this.scale;
    const worldWidth = width;
    const worldHeight = height;

    this.cameras.main.setBounds(0, 0, worldWidth, worldHeight);
    this.cameras.main.setScroll(0, 0);
    this.cameras.main.setBackgroundColor("#000000");

    const background = this.add.image(0, 0, this.mobile ? "bg_game_show_mobile" : "bg_game_show").setOrigin(0, 0).setDepth(0);
    background.setDisplaySize(worldWidth, worldHeight);

    this.createParallaxLayers(worldWidth, worldHeight);
    this.destroyIntroDecor();
    this.createIntroDecor(worldWidth, worldHeight);

    const onResize = (gameSize: Phaser.Structs.Size) => {
      const w = gameSize.width;
      const h = gameSize.height;
      this.cameras.main.setBounds(0, 0, w, h);
      this.resetMainCamera();
      background.setDisplaySize(w, h);
      this.layoutParallaxLayers(w, h);
      this.layoutIntroDecor(w, h);
    };
    const onHomeSceneShutdown = () => {
      // Ignore late HomeScene shutdown callbacks while this scene is no longer running
      // (e.g. transitioning to the next game in sequence mode).
      if (this.sys.settings.status !== Phaser.Scenes.RUNNING) return;
      this.destroyIntroDecor(false);
      if (!this.teacherHintUI) {
        this.createTeacherHintUI();
      } else {
        this.teacherHintUI.assistant.setCompact(true, 600);
      }
      this.startRequested = true;
      this.setBgmState("game");
      this.tryStartGame();
    };
    homeScene.events.once(Phaser.Scenes.Events.SHUTDOWN, onHomeSceneShutdown);
    this.detachHomeSceneShutdown = () => {
      homeScene.events.off(Phaser.Scenes.Events.SHUTDOWN, onHomeSceneShutdown);
      this.detachHomeSceneShutdown = undefined;
    };
    this.scale.on(Phaser.Scale.Events.RESIZE, onResize);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, onResize);
      this.detachHomeSceneShutdown?.();
      this.destroyParallaxLayers();
      this.stopAllAudio();
    });

    try {
      const payload = await this.fetchGameShowQuizData();
      this.pendingPayload = payload;
      await this.preloadQuestionImageTextures(payload);
      await this.preloadQuestionSoundAudio(payload);
      this.assetsReady = true;
      this.tryStartGame();
    } catch (error) {
      console.error("Failed to load game show quiz data:", error);
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

  private async fetchGameShowQuizData(): Promise<GameShowQuizPayload> {
    if (this.injectedPayload) {
      return this.injectedPayload as unknown as GameShowQuizPayload;
    }
    throw new Error("Missing injected payload for scene: game-show-quiz");
  }

  private async preloadQuestionImageTextures(payload: GameShowQuizPayload): Promise<void> {
    const rawPaths =
      payload.questions
        ?.flatMap((q) => [
          q.image_question,
          q.image_hint,
          ...(q.choices?.map((c) => c.image_choice) ?? []),
        ])
        .filter((v): v is string => typeof v === "string" && this.isValidSoundPath(v)) ?? [];
  
    const urls = rawPaths.map((p) => this.resolveImageUrl(p)).filter(Boolean);
    const uniqueUrls = Array.from(new Set(urls));
  
    const toLoad: Array<{ key: string; url: string }> = [];
    for (const url of uniqueUrls) {
      if (this.imageKeyByUrl.has(url)) continue;
      const key = `gsq_question_img_${this.imageKeySeq++}`;
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
  
  private async preloadQuestionSoundAudio(payload: GameShowQuizPayload): Promise<void> {
    const rawPaths =
      payload.questions
        ?.flatMap((q) => [
          q.sound_question,
          q.sound_hint,
          ...(q.choices?.map((c) => c.sound_choice) ?? []),
        ])
        .filter((v): v is string => typeof v === "string" && this.isValidSoundPath(v)) ?? [];
  
    const urls = rawPaths.map((p) => this.resolveSoundUrl(p)).filter(Boolean);
    const uniqueUrls = Array.from(new Set(urls));
  
    const toLoad: Array<{ key: string; url: string }> = [];
    for (const url of uniqueUrls) {
      if (this.soundKeyByUrl.has(url)) continue;
      const key = `gsq_question_sound_${this.soundKeySeq++}`;
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

  private canManageBgm(): boolean {
    const status = this.sys.settings.status;
    // CREATING/RUNNING — allow home BGM during create(); block after shutdown.
    return status === Phaser.Scenes.CREATING || status === Phaser.Scenes.RUNNING;
  }

  private setBgmState(next: "start" | "game" | "result") {
    if (!this.canManageBgm()) return;
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

    const preferredKey =
      next === "start" ? GSQ_BGM_KEYS.start : next === "game" ? GSQ_BGM_KEYS.game : GSQ_BGM_KEYS.result;
    const legacyKey = next === "start" ? "bgm_start" : next === "game" ? "bgm_game_scene" : "bgm_result";
    const key = this.cache.audio.exists(preferredKey)
      ? preferredKey
      : this.cache.audio.exists(legacyKey)
        ? legacyKey
        : null;
    if (!key) return;
    const volume = GAME_BGM_VOLUME;
    const sound = this.sound.add(key, { loop: true, volume });
    sound.play();
    if (next === "start") this.bgmStartSound = sound;
    if (next === "game") this.bgmGameSound = sound;
    if (next === "result") this.bgmResultSound = sound;
  }

  protected onGameAudioSettingsChanged(): void {
    if (!this.canManageBgm()) return;
    const s = this.bgmState;
    if (!s) return;
    this.bgmState = null;
    this.setBgmState(s);
  }

  private playSfx(key: string, volume: number) {
    guardedScenePlay(this, key, volume);
  }

  private playVoice(key: string, volume: number) {
    guardedScenePlayVoice(this, key, volume);
  }

  private playQuestionAudio(key: string, volume: number) {
    guardedScenePlayQuestion(this, key, volume);
  }

  private stopQuestionVoices() {
    for (const key of new Set(this.soundKeyByUrl.values())) {
      this.sound.stopByKey(key);
    }
  }

  private stopGameShowQuizQuestionVoices() {
    for (const q of this.questions) {
      const sq = this.getSoundKeyForPath(q.sound_question);
      const sh = this.getSoundKeyForPath(q.sound_hint);
      if (sq) this.sound.stopByKey(sq);
      if (sh) this.sound.stopByKey(sh);
    }
  }

  private trackQuestionAudioTimer(ev: Phaser.Time.TimerEvent) {
    this.questionAudioTimers.push(ev);
  }

  private cancelQuestionAudioTimers() {
    for (const ev of this.questionAudioTimers) ev?.destroy();
    this.questionAudioTimers = [];
  }

  private bumpQuestionFlowToken() {
    this.questionFlowToken += 1;
    this.cancelQuestionAudioTimers();
    this.stopGameShowQuizQuestionVoices();
    return this.questionFlowToken;
  }

  private playChoiceAudio(key: string, volume: number) {
    guardedScenePlayChoice(this, key, volume);
  }

  private tweenOnce(config: Phaser.Types.Tweens.TweenBuilderConfig): Promise<void> {
    return new Promise<void>((resolve) => {
      const originalOnComplete = config.onComplete;
      const originalOnStop = (config as unknown as { onStop?: (...args: any[]) => any }).onStop;
      let resolved = false;
      const resolveOnce = () => {
        if (resolved) return;
        resolved = true;
        resolve();
      };
      const wrappedOnComplete = (...args: any[]) => {
        if (typeof originalOnComplete === "function") (originalOnComplete as any).apply(null, args);
        resolveOnce();
      };
      const wrappedOnStop = (...args: any[]) => {
        if (typeof originalOnStop === "function") (originalOnStop as any).apply(null, args);
        resolveOnce();
      };
      this.tweens.add({ ...config, onComplete: wrappedOnComplete, onStop: wrappedOnStop } as any);
    });
  }

  private resetPerQuestionMessages() {
    this.questionMessageFlags = { idle15Shown: false, item30Shown: false, time50Shown: false };
  }

  private getAvailableItemMessagePool(): string[] {
    const pool = this.messagePools.item;
    if (!Array.isArray(pool) || pool.length === 0) return [];
    return pool.filter((id) => {
      if (id === "item_a") return this.lifeLines.fiftyFifty;
      if (id === "item_b") return this.lifeLines.pass;
      if (id === "item_c") return this.lifeLines.freeze;
      if (id === "item_d") return this.lifeLines.twoChance;
      return true;
    });
  }

  private updatePerQuestionMessagesByElapsed(elapsedMs: number) {
    if (!this.gameStarted) return;
    if (!this.questionTimerEvent) return;
    if (this.questionTimerPaused) return;
    if (elapsedMs < 0) return;

    const safeElapsedMs = Math.floor(elapsedMs);
    if (!this.questionMessageFlags.idle15Shown && safeElapsedMs >= 15_000) {
      this.questionMessageFlags.idle15Shown = true;
      this.showRandomMessage(this.messagePools.idle, 2000, "point");
    }

    if (!this.questionMessageFlags.item30Shown && safeElapsedMs >= 30_000) {
      this.questionMessageFlags.item30Shown = true;
      const pool = this.getAvailableItemMessagePool();
      this.showRandomMessage(pool, 2000, "point");
    }

    if (!this.questionMessageFlags.time50Shown && safeElapsedMs >= 50_000) {
      this.questionMessageFlags.time50Shown = true;
      const pool = this.messagePools.time[50] ?? [];
      this.showRandomMessage(pool, 2000, "point");
    }
  }

  private ensureImageButtonFx(image: Phaser.GameObjects.Image) {
    if (image.getData("btnFxBound")) return;
    image.setData("btnFxBound", true);
    image.setData("btnFxBaseScaleX", image.scaleX);
    image.setData("btnFxBaseScaleY", image.scaleY);
    image.setData("btnFxHovering", false);

    const animateScale = (scaleFactor: number) => {
      const baseX = image.getData("btnFxBaseScaleX");
      const baseY = image.getData("btnFxBaseScaleY");
      const sx = typeof baseX === "number" ? baseX : image.scaleX;
      const sy = typeof baseY === "number" ? baseY : image.scaleY;
      this.tweens.killTweensOf(image);
      this.tweens.add({
        targets: image,
        scaleX: sx * scaleFactor,
        scaleY: sy * scaleFactor,
        duration: 120,
        ease: "Sine.easeOut",
      });
    };

    image.on("pointerover", () => {
      image.setData("btnFxHovering", true);
      animateScale(1.05);
      image.setTint(0xf2f2f2);
    });

    image.on("pointerout", () => {
      image.setData("btnFxHovering", false);
      animateScale(1);
      image.clearTint();
    });

    image.on("pointerdown", () => {
      animateScale(0.98);
    });

    image.on("pointerup", () => {
      const hovering = !!image.getData("btnFxHovering");
      animateScale(hovering ? 1.05 : 1);
    });
  }

  private animateLifelineGlow(image: Phaser.GameObjects.Image) {
    this.tweens.killTweensOf(image);
    const baseX = image.getData("btnFxBaseScaleX");
    const baseY = image.getData("btnFxBaseScaleY");
    const sx = typeof baseX === "number" ? baseX : image.scaleX;
    const sy = typeof baseY === "number" ? baseY : image.scaleY;

    this.tweens.add({
      targets: image,
      scaleX: sx * 1.08,
      scaleY: sy * 1.08,
      duration: 140,
      yoyo: true,
      repeat: 1,
      ease: "Sine.easeInOut",
    });
  }

  private flashQuizPanelBg() {
    const ui = this.quizUI;
    if (!ui) return;
    const { width, height } = this.scale;
    const panelHeight = height * 0.575;
    const panelTop = height - panelHeight;

    const seq = (this.quizPanelFlashSeq += 1);
    const glow = this.add.graphics();
    glow.fillStyle(0xffffff, 1);
    glow.fillRect(0, panelTop, width, panelHeight);
    glow.setAlpha(0);
    glow.setDepth(ui.container.depth + 2);
    ui.container.add(glow);

    this.tweens.add({
      targets: glow,
      alpha: { from: 0, to: 0.28 },
      duration: 80,
      yoyo: true,
      repeat: 2,
      ease: "Sine.easeInOut",
      onComplete: () => {
        if (seq !== this.quizPanelFlashSeq) return;
        glow.destroy();
      },
      onStop: () => {
        glow.destroy();
      },
    });
  }

  private ensureChoiceButtonFx(choiceUi: ChoiceRowUI) {
    const container = choiceUi.container;
    const target = choiceUi.pickZone;
    if (target.getData("choiceFxBound")) return;
    target.setData("choiceFxBound", true);
    container.setData("choiceFxBaseScaleX", container.scaleX);
    container.setData("choiceFxBaseScaleY", container.scaleY);
    container.setData("choiceFxBaseX", container.x);
    container.setData("choiceFxHovering", false);
    container.setData("choiceFxAnimating", false);

    const animateScale = (scaleFactor: number) => {
      const baseX = container.getData("choiceFxBaseScaleX");
      const baseY = container.getData("choiceFxBaseScaleY");
      const sx = typeof baseX === "number" ? baseX : container.scaleX;
      const sy = typeof baseY === "number" ? baseY : container.scaleY;
      this.tweens.killTweensOf(container);
      this.tweens.add({
        targets: container,
        scaleX: sx * scaleFactor,
        scaleY: sy * scaleFactor,
        duration: 120,
        ease: "Cubic.easeOut",
      });
    };

    const canHover = () =>
      !this.lockInput &&
      this.input.enabled &&
      !choiceUi.disabled &&
      !choiceUi.eliminated &&
      !container.getData("choiceFxAnimating") &&
      container.alpha >= 0.99;

    target.on("pointerover", () => {
      if (!canHover()) {
        container.setData("choiceFxHovering", false);
        return;
      }
      container.setData("choiceFxHovering", true);
      const ui = this.quizUI;
      ui?.choicesContainer.bringToTop(container);
      animateScale(1.04);
    });

    target.on("pointerout", () => {
      container.setData("choiceFxHovering", false);
      if (!canHover()) return;
      animateScale(1);
    });

    target.on("pointerdown", () => {
      if (!canHover()) return;
      animateScale(0.99);
    });

    target.on("pointerup", () => {
      if (!canHover()) return;
      const hovering = !!container.getData("choiceFxHovering");
      animateScale(hovering ? 1.04 : 1);
    });
  }

  private async animateChoiceCorrect(ui: ChoiceRowUI): Promise<void> {
    const container = ui.container;
    if (!container.active) return;
    if (container.getData("choiceFxAnimating")) return;
    container.setData("choiceFxAnimating", true);
    this.tweens.killTweensOf(container);

    const baseX = container.getData("choiceFxBaseX");
    const baseY = container.y;
    if (typeof baseX === "number") container.x = baseX;
    container.setData("choiceFxBaseY", baseY);

    const baseScaleX = container.getData("choiceFxBaseScaleX");
    const baseScaleY = container.getData("choiceFxBaseScaleY");
    const sx = typeof baseScaleX === "number" ? baseScaleX : container.scaleX;
    const sy = typeof baseScaleY === "number" ? baseScaleY : container.scaleY;

    await this.tweenOnce({
      targets: container,
      y: baseY - (this.mobile ? 10 : 12),
      scaleX: sx * 1.06,
      scaleY: sy * 1.06,
      duration: 140,
      ease: "Back.easeOut",
    });
    if (!this.sys.isActive() || !container.active) return;
    await this.tweenOnce({
      targets: container,
      y: baseY,
      scaleX: sx,
      scaleY: sy,
      duration: 180,
      ease: "Sine.easeInOut",
    });
    if (!container.active) return;
    container.setData("choiceFxAnimating", false);
  }

  private async animateChoiceWrongShake(ui: ChoiceRowUI): Promise<void> {
    const container = ui.container;
    if (!container.active) return;
    if (container.getData("choiceFxAnimating")) return;
    container.setData("choiceFxAnimating", true);
    this.tweens.killTweensOf(container);

    const baseX = typeof container.getData("choiceFxBaseX") === "number" ? (container.getData("choiceFxBaseX") as number) : container.x;
    const baseScaleX = container.getData("choiceFxBaseScaleX");
    const baseScaleY = container.getData("choiceFxBaseScaleY");
    const sx = typeof baseScaleX === "number" ? baseScaleX : container.scaleX;
    const sy = typeof baseScaleY === "number" ? baseScaleY : container.scaleY;
    container.x = baseX;
    container.setScale(sx, sy);

    await this.tweenOnce({
      targets: container,
      x: { from: baseX - (this.mobile ? 6 : 8), to: baseX + (this.mobile ? 6 : 8) },
      duration: 60,
      yoyo: true,
      repeat: 4,
      ease: "Sine.easeInOut",
    });
    if (!container.active) return;
    container.x = baseX;
    container.setScale(sx, sy);
    container.setData("choiceFxAnimating", false);
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

  private stopAllAudio() {
    this.bgmState = null;
    this.detachHomeSceneShutdown?.();
    this.stopTicking();
    this.stopQuestionVoices();
    this.stopAndDestroySound(this.bgmStartSound);
    this.bgmStartSound = undefined;
    this.stopAndDestroySound(this.bgmGameSound);
    this.bgmGameSound = undefined;
    this.stopAndDestroySound(this.bgmResultSound);
    this.bgmResultSound = undefined;
    for (const key of Object.values(GSQ_BGM_KEYS)) {
      this.sound.stopByKey(key);
    }
    // Legacy shared keys from older builds — stop if still playing.
    for (const key of ["bgm_start", "bgm_game_scene", "bgm_result"]) {
      this.sound.stopByKey(key);
    }
  }

  private stopAndDestroySound(sound?: Phaser.Sound.BaseSound) {
    if (!sound) return;
    this.tweens.killTweensOf(sound);
    try {
      if (sound.isPlaying) sound.stop();
    } catch {}
    try {
      sound.destroy();
    } catch {}
  }

  protected override getLiveDashboardLaunchFields() {
    return {
      ...super.getLiveDashboardLaunchFields(),
      liveDashboardFlappyPassed: this.isGsqPerfectPass(),
    };
  }

  protected override getResultCorrectCount(): number {
    return this.correctAnswers;
  }

  protected override getResultScoreLabel(): string | undefined {
    return this.isGsqPerfectPass() ? undefined : "ไม่ผ่าน";
  }

  private isGsqPerfectPass(): boolean {
    return (
      !this.gsqGameFailedByNoLives &&
      this.numberOfQuestions > 0 &&
      this.correctAnswers === this.numberOfQuestions
    );
  }

  protected override onBeforeEndGame() {
    if (this.frozenHudElapsedSec == null) {
      this.frozenHudElapsedSec = this.getHudElapsedSeconds();
    }
    this.setBgmState("result");
    this.input.enabled = false;
    this.lockInput = true;
    this.stopQuestionTimer();
    this.freezeResumeEvent?.destroy();
    this.freezeResumeEvent = undefined;
    this.destroyQuizUI({ keepPanelBg: true });
    this.destroyQuestionTimerUi();

    this.hudTimerEvent?.destroy();
    this.hudTimerEvent = undefined;
    this.hudStarted = false;
    this.hudStartMs = 0;
    this.hudElapsedAccumSec = 0;

    this.destroyStatsHud();
    this.gsqHudLives = GSQ_HUD_MAX_LIVES;
    this.gsqGameFailedByNoLives = false;
    this.parallaxGameplayMul = 1;
    this.endCutsceneActive = false;
    this.teacherHintUI?.destroy();
    this.teacherHintUI = undefined;
    this.stopTicking();
  }

  private destroyIntroDecor(all: boolean = true) {
    const decor = this.introDecor;
    if (!decor) return;
    this.tweens.killTweensOf(decor.overlay);
    if (all) {
      this.tweens.killTweensOf(decor.lawn);
      this.tweens.killTweensOf(decor.truck);
      this.tweens.killTweensOf(decor.tuktuk);
    }
    this.tweens.killTweensOf(decor.icon);
    this.tweens.killTweensOf(decor.flagLeft);
    this.tweens.killTweensOf(decor.flagRight);
    if (all) {
      decor.overlay.destroy();
      decor.lawn.destroy();
      decor.icon.destroy();
      decor.flagLeft.destroy();
      decor.flagRight.destroy();
      decor.truck.destroy();
      decor.tuktuk.destroy();
      this.introDecor = undefined;
      return;
    }

    decor.overlay.setVisible(false);
    decor.icon.setVisible(false);
    decor.flagLeft.setVisible(false);
    decor.flagRight.setVisible(false);
    this.introDecor = decor;
  }

  private createIntroDecor(worldWidth: number, worldHeight: number) {
    const centerX = worldWidth / 2;
    const centerY = worldHeight / 3;

    const icon = this.add.image(centerX, centerY, "icon").setDepth(3002);
    const flagLeft = this.add.image(centerX, centerY, "flag_left").setDepth(3001);
    const flagRight = this.add.image(centerX, centerY, "flag_right").setDepth(3001);

    const truck = this.add.image(centerX, centerY, "truck_home").setDepth(100);
    const tuktuk = this.add.image(centerX, centerY, "tuktuk").setDepth(90);

    const overlay = this.add.rectangle(0, 0, worldWidth, worldHeight, 0x000000, 0.34)
      .setOrigin(0)
      .setDepth(3000);

    const lawn = this.add.rectangle(0, 0, worldWidth, this.mobile ? worldHeight * 0.6 : worldHeight * 0.6, 0xBDDA6D, 1)
      .setOrigin(0)
      .setDepth(3);

    this.introDecor = { overlay, lawn, icon, truck, tuktuk, flagLeft, flagRight, };
    this.layoutIntroDecor(worldWidth, worldHeight);
  }

  private getGsqTruckTextureKey() {
    return this.gameStarted ? "truck" : "truck_home";
  }

  private layoutIntroDecor(worldWidth: number, worldHeight: number) {
    const decor = this.introDecor;
    if (!decor) return;

    const shiftY = this.gameStarted ? (this.mobile ? -worldHeight * 0.35 : -worldHeight * 0.3) : 0;
    const centerX = worldWidth / 2;
    const centerY = worldHeight / 3;

    const iconSrc = this.textures.get("icon").getSourceImage() as { width?: number; height?: number };
    const iconW = iconSrc?.width ?? 1;
    const iconH = iconSrc?.height ?? 1;
    const iconMaxW = worldWidth * (this.mobile ? 0.9 : 0.3);
    const iconMaxH = worldHeight * (this.mobile ? 0.45 : 0.5);
    const iconScale = Math.min(iconMaxW / iconW, iconMaxH / iconH);

    const flagLeftSrc = this.textures.get("flag_left").getSourceImage() as { width?: number; height?: number };
    const flagLeftIconW = flagLeftSrc?.width ?? 1;
    const flagLeftIconH = flagLeftSrc?.height ?? 1;
    const flagLeftIconMaxW = worldWidth * (this.mobile ? 0.2 : 0.1);
    const flagLeftIconMaxH = worldHeight * (this.mobile ? 0.1 : 0.15);
    const flagLeftIconScale = Math.min(flagLeftIconMaxW / flagLeftIconW, flagLeftIconMaxH / flagLeftIconH);

    const flagRightSrc = this.textures.get("flag_right").getSourceImage() as { width?: number; height?: number };
    const flagRightIconW = flagRightSrc?.width ?? 1;
    const flagRightIconH = flagRightSrc?.height ?? 1;
    const flagRightIconMaxW = worldWidth * (this.mobile ? 0.2 : 0.1);
    const flagRightIconMaxH = worldHeight * (this.mobile ? 0.1 : 0.15);
    const flagRightIconScale = Math.min(flagRightIconMaxW / flagRightIconW, flagRightIconMaxH / flagRightIconH);

    const truckTextureKey = this.getGsqTruckTextureKey();
    if (decor.truck.texture.key !== truckTextureKey) {
      decor.truck.setTexture(truckTextureKey);
    }
    const truckSrc = this.textures.get(truckTextureKey).getSourceImage() as { width?: number; height?: number };
    const truckW = truckSrc?.width ?? 1;
    const truckH = truckSrc?.height ?? 1;
    const truckMaxW = worldWidth * (this.mobile ? 0.4 : 0.3);
    const truckMaxH = worldHeight * (this.mobile ? 0.25 : 0.2);
    const truckScale = Math.min(truckMaxW / truckW, truckMaxH / truckH);

    const tuktukSrc = this.textures.get("tuktuk").getSourceImage() as { width?: number; height?: number };
    const tuktukW = tuktukSrc?.width ?? 1;
    const tuktukH = tuktukSrc?.height ?? 1;
    const tuktukMaxW = worldWidth * (this.mobile ? 0.3 : 0.3);
    const tuktukMaxH = worldHeight * (this.mobile ? 0.15 : 0.15);
    const tuktukScale = Math.min(tuktukMaxW / tuktukW, tuktukMaxH / tuktukH);

    const targetWidth = worldWidth;
    const targetHeight = this.mobile ? worldHeight * 0.6 : worldHeight * 0.6;

    decor.lawn.width = targetWidth;
    decor.lawn.height = targetHeight;

    const posX = 0;
    const posY = worldHeight - targetHeight;

    decor.lawn.setPosition(posX, posY + shiftY);
    const iconX = centerX;
    const iconY = (this.mobile ? centerY - worldHeight * 0.05 : centerY - worldHeight * 0.05) + shiftY;

    decor.icon.setScale(iconScale);
    decor.icon.setPosition(iconX, iconY);
    decor.flagLeft
      .setPosition(
        this.mobile ? centerX - worldWidth * 0.325 : centerX - worldWidth * 0.105,
        (this.mobile ? centerY + worldHeight * 0.06 : centerY + worldHeight * 0.06) + shiftY
      )
      .setScale(flagLeftIconScale);
    decor.flagRight
      .setPosition(
        this.mobile ? centerX + worldWidth * 0.325 : centerX + worldWidth * 0.105,
        (this.mobile ? centerY + worldHeight * 0.06 : centerY + worldHeight * 0.06) + shiftY
      )
      .setScale(flagRightIconScale);
    const truckY = (this.mobile ? centerY + worldHeight * 0.25 : centerY + worldHeight * 0.2) + shiftY;
    const tuktukY = (this.mobile ? centerY + worldHeight * 0.125 : centerY + worldHeight * 0.1) + shiftY;
    decor.truck.setDepth(101);
    decor.tuktuk.setDepth(90);
    decor.truck.setScale(truckScale);
    decor.tuktuk.setScale(tuktukScale);

    if (this.gameStarted) {
      decor.truck.setPosition(centerX - worldWidth * (this.mobile ? 0.028 : 0.024), truckY);
      const truckRearX = decor.truck.x - decor.truck.displayWidth * 0.38;
      decor.tuktuk.setPosition(truckRearX - decor.tuktuk.displayWidth * 0.48, tuktukY);
    } else {
      decor.truck.setPosition(
        this.mobile ? centerX - worldWidth * 0.1 : centerX - worldWidth * 0.105,
        truckY
      );
      const truckRearX = decor.truck.x - decor.truck.displayWidth * 0.34;
      decor.tuktuk.setPosition(truckRearX - decor.tuktuk.displayWidth * 0.45, tuktukY);
    }
  }

  private destroyParallaxLayers() {
    Object.values(this.parallaxLayers.tileSprites).forEach(sprite => sprite.destroy());
    this.parallaxLayers.objects.forEach(obj => obj.image.destroy());
    this.parallaxLayers.tileSprites = {};
    this.parallaxLayers.objects = [];
  }

  private createParallaxLayers(worldWidth: number, worldHeight: number) {
    // Road (Mid) - Keeping it as TileSprite for ground continuity
    this.parallaxLayers.tileSprites["road"] = this.add.tileSprite(0, 0, worldWidth, 0, "road").setOrigin(0, 1).setDepth(50);
    this.parallaxLayers.tileSprites["road_top"] = this.add.tileSprite(0, 0, worldWidth, 0, "road").setOrigin(0, 1).setDepth(49);

    // Individual Layers (Back 2, Back 1, Back 0, Front)
    const layers = [
      { id: "back3", keys: ["cloud_left", "cloud_right"] },
      { id: "back2", keys: ["city", "mountain"] },
      { id: "back1", keys: ["giant_swing", "temple", "gate", "pattaya"] },
      { id: "back0", keys: ["bus_stop", "traffic_sign", "tree_blue_double", "tree_green_quad"] },
      { id: "front", keys: ["bush", "tree_green_double"] },
    ];

    const currentLayerConfigs = getLayerConfigs(this.mobile);

    layers.forEach(layer => {
      const config = currentLayerConfigs[layer.id];
      layer.keys.forEach((key, i) => {
        const x = worldWidth + (i * config.spacing);
        const obj = this.add.image(x, 0, key).setOrigin(0.5, 1).setDepth(config.depth);
        
        if (key.includes("cloud")) {
          obj.setOrigin(0.5, 0);
        }
        
        this.parallaxLayers.objects.push({ image: obj, layerId: layer.id });
      });
    });

    this.layoutParallaxLayers(worldWidth, worldHeight);
  }

  private layoutParallaxLayers(worldWidth: number, worldHeight: number) {
    const groundY = worldHeight;
    const shiftY = this.gameStarted ? (this.mobile ? -worldHeight * 0.35 : -worldHeight * 0.3) : 0;
    const roadHeight = worldHeight * (this.mobile ? 0.1 : 0.1);

    Object.entries(this.parallaxLayers.tileSprites).forEach(([key, sprite]) => {
      const tex = sprite.texture.getSourceImage() as { width: number; height: number };
      
      let scale = 1;
      let targetWidth = worldWidth;
      if (key === "road" || key === "road_top") {
        scale = roadHeight / tex.height;
        targetWidth = worldWidth / scale;
        const yOffset = key === 
        "road_top" ? 
          this.mobile ? worldHeight / 2 - roadHeight * 0.5 : worldHeight / 2 - roadHeight * 0.5 
          : this.mobile ? worldHeight / 2 - roadHeight * 1.75 : worldHeight / 2 - roadHeight * 1.75;
        sprite.setPosition(0, groundY - yOffset + shiftY);
      }

      sprite.width = targetWidth;
      sprite.setScale(scale);
    });

    const currentLayerConfigs = getLayerConfigs(this.mobile);
    const currentAssetScales = getAssetScales(this.mobile);

    this.parallaxLayers.objects.forEach(obj => {
      const config = currentLayerConfigs[obj.layerId];
      const assetKey = obj.image.texture.key;
      const assetScale = currentAssetScales[assetKey] || 1;
      
      const tex = obj.image.texture.getSourceImage() as { width: number; height: number };
      
      const targetHeight = worldHeight * assetScale;
      const scale = targetHeight / tex.height;
      
      obj.image.setScale(scale);
      
      if (assetKey.includes("cloud")) {
        obj.image.y = worldHeight * (assetKey === "cloud_left" ? 0.05 : 0.1) + shiftY;
      } else {
        obj.image.y = groundY * config.yRatio + shiftY;
      }
    });
  }

  update() {
    const roadStep = 6 * this.parallaxGameplayMul;
    if (this.parallaxLayers.tileSprites["road"]) this.parallaxLayers.tileSprites["road"].tilePositionX += roadStep;
    if (this.parallaxLayers.tileSprites["road_top"]) this.parallaxLayers.tileSprites["road_top"].tilePositionX += roadStep;

    const worldWidth = this.scale.width;

    const currentLayerConfigs = getLayerConfigs(this.mobile);
    const layerIds = Object.keys(currentLayerConfigs);

    layerIds.forEach(layerId => {
      const config = currentLayerConfigs[layerId];
      const layerObjects = this.parallaxLayers.objects.filter(o => o.layerId === layerId);
      
      layerObjects.forEach(obj => {
        obj.image.x -= config.speed * this.parallaxGameplayMul;

        if (obj.image.x < -obj.image.displayWidth) {
          let rightmostX = worldWidth;
          layerObjects.forEach(other => {
            if (other.image.x > rightmostX) {
              rightmostX = other.image.x;
            }
          });
          
          obj.image.x = rightmostX + config.spacing;
        }
      });
    });
  }

  private tryStartGame() {
    if (this.gameStarted) return;
    if (!this.startRequested) return;
    if (!this.assetsReady) return;
    if (!this.pendingPayload) return;

    this.gameStarted = true;
    this.createTimeContainer();
    this.createHeartsHud();
    this.createQuestionTimerUi();
    this.score = 0;
    this.ensureHudTimer();
    this.updateHud();
    this.layoutParallaxLayers(this.scale.width, this.scale.height);
    this.layoutIntroDecor(this.scale.width, this.scale.height);
    this.totalQuestions = this.countRunstateQuestions(this.pendingPayload);
    this.reportRunstateStart();
    this.playStartCutscene(this.pendingPayload);
  }

  private quizUiOnResize?: () => void;

  private resetMainCamera() {
    const cam = this.cameras.main;
    const { width, height } = this.scale;
    cam.stopFollow();
    cam.setZoom(1);
    cam.centerOn(width / 2, height / 2);
  }

  /** คงกล้องนิ่ง — ไม่ pan/zoom ตาม cutscene */
  private cameraFocus(_x: number, _y: number, _zoom: number, _duration: number, onComplete: () => void) {
    this.resetMainCamera();
    onComplete();
  }

  private playStartCutscene(payload: GameShowQuizPayload) {
    this.resetMainCamera();
    this.layoutIntroDecor(this.scale.width, this.scale.height);
    this.buildGame(payload);
  }

  private playEndCutscene(reason: "lastWin" | "lastFail") {
    if (reason === "lastWin") {
      void this.playWinOvertakeCutscene();
      return;
    }
    void this.playFailOvertakeCutscene();
  }

  private prepareEndCutsceneView() {
    this.input.enabled = false;
    this.lockInput = true;
    this.stopQuestionTimer();
    this.teacherHintUI?.hideImmediate();
    this.destroyQuizUI();
    this.destroyQuestionTimerUi();
    this.statsHudContainer?.setVisible(false);
    this.gsqQuestionProgress?.bg.setVisible(false);
    this.gsqQuestionProgress?.text.setVisible(false);
  }

  private syncGsqVehicleOvertakeDepth(
    truck: Phaser.GameObjects.Image,
    tuktuk: Phaser.GameObjects.Image
  ) {
    const truckFrontX = truck.x + truck.displayWidth * 0.16;
    const tuktukFrontX = tuktuk.x + tuktuk.displayWidth * 0.16;
    if (tuktukFrontX > truckFrontX) {
      tuktuk.setDepth(102);
      truck.setDepth(90);
      return;
    }
    truck.setDepth(101);
    tuktuk.setDepth(90);
  }

  private async playWinOvertakeCutscene() {
    if (!this.sys.isActive()) return;
    if (this.endCutsceneActive) return;
    this.endCutsceneActive = true;
    this.prepareEndCutsceneView();

    const decor = this.introDecor;
    const truck = decor?.truck;
    const tuktuk = decor?.tuktuk;
    if (!truck || !tuktuk) {
      this.endCutsceneActive = false;
      this.endGame();
      return;
    }

    const { width } = this.scale;
    truck.setVisible(true);
    tuktuk.setVisible(true);
    this.syncGsqVehicleOvertakeDepth(truck, tuktuk);
    this.tweens.killTweensOf(truck);
    this.tweens.killTweensOf(tuktuk);

    const passX = tuktuk.x + tuktuk.displayWidth * 0.42 + truck.displayWidth * 0.38;
    const exitX = width + truck.displayWidth * 0.7;
    const tuktukDriftX = tuktuk.x + width * 0.05;
    const syncDepth = () => this.syncGsqVehicleOvertakeDepth(truck, tuktuk);
    this.parallaxGameplayMul = 2.4;

    try {
      await Promise.all([
        this.tweenOnce({
          targets: tuktuk,
          x: tuktukDriftX,
          duration: 1050,
          ease: "Sine.easeOut",
          onUpdate: syncDepth,
        }),
        this.tweenOnce({
          targets: truck,
          x: passX,
          duration: 820,
          ease: "Cubic.easeIn",
          onUpdate: syncDepth,
        }),
      ]);
      if (!this.sys.isActive()) return;

      await this.tweenOnce({
        targets: truck,
        x: exitX,
        duration: 620,
        ease: "Cubic.easeIn",
        onUpdate: syncDepth,
      });
    } finally {
      this.parallaxGameplayMul = 1;
      this.endCutsceneActive = false;
      if (this.sys.isActive()) {
        this.endGame();
      }
    }
  }

  private async playFailOvertakeCutscene() {
    if (!this.sys.isActive()) return;
    if (this.endCutsceneActive) return;
    this.endCutsceneActive = true;
    this.prepareEndCutsceneView();

    const decor = this.introDecor;
    const truck = decor?.truck;
    const tuktuk = decor?.tuktuk;
    if (!truck || !tuktuk) {
      this.endCutsceneActive = false;
      this.endGame();
      return;
    }

    const { width } = this.scale;
    truck.setVisible(true);
    tuktuk.setVisible(true);
    this.tweens.killTweensOf(truck);
    this.tweens.killTweensOf(tuktuk);

    const truckAheadX = truck.x + truck.displayWidth * 0.22;
    const tuktukBehindX =
      truckAheadX - truck.displayWidth * 0.38 - tuktuk.displayWidth * 0.42;
    truck.setPosition(truckAheadX, truck.y);
    tuktuk.setPosition(tuktukBehindX, tuktuk.y);
    this.syncGsqVehicleOvertakeDepth(truck, tuktuk);

    const passX = truck.x + truck.displayWidth * 0.42 + tuktuk.displayWidth * 0.38;
    const exitX = width + tuktuk.displayWidth * 0.7;
    const truckDriftX = truck.x + width * 0.05;
    const syncDepth = () => this.syncGsqVehicleOvertakeDepth(truck, tuktuk);
    this.parallaxGameplayMul = 2.4;

    try {
      await Promise.all([
        this.tweenOnce({
          targets: truck,
          x: truckDriftX,
          duration: 1050,
          ease: "Sine.easeOut",
          onUpdate: syncDepth,
        }),
        this.tweenOnce({
          targets: tuktuk,
          x: passX,
          duration: 820,
          ease: "Cubic.easeIn",
          onUpdate: syncDepth,
        }),
      ]);
      if (!this.sys.isActive()) return;

      await this.tweenOnce({
        targets: tuktuk,
        x: exitX,
        duration: 620,
        ease: "Cubic.easeIn",
        onUpdate: syncDepth,
      });
    } finally {
      this.parallaxGameplayMul = 1;
      this.endCutsceneActive = false;
      if (this.sys.isActive()) {
        this.endGame();
      }
    }
  }

  private playFailedByLivesCutscene() {
    this.playEndCutscene("lastFail");
  }

  private gsqLoseLife() {
    this.gsqHudLives = Math.max(0, this.gsqHudLives - 1);
    this.refreshGsqHudHearts();
    if (this.gsqHudLives <= 0) {
      this.gsqGameFailedByNoLives = true;
    }
  }

  private continueAfterWrongAnswer() {
    this.showRandomMessage(this.messagePools.wrong, 2000, "point");
    const isLast = this.currentQuestionIndex >= this.numberOfQuestions - 1;
    this.time.delayedCall(480, () => {
      if (!this.sys.isActive()) return;
      if (isLast) {
        this.finishQuizAfterQuestions();
        return;
      }
      this.goToNextQuestion();
    });
  }

  private finishQuizAfterQuestions() {
    this.freezeHudTime();
    this.stopQuestionTimer();
    if (this.isGsqPerfectPass()) {
      this.showRandomMessage(this.messagePools.done, 2200, "clap");
      this.time.delayedCall(1100, () => this.playEndCutscene("lastWin"));
      return;
    }
    this.showRandomMessage(this.messagePools.done, 2000, "point");
    this.time.delayedCall(1100, () => this.playEndCutscene("lastFail"));
  }

  /** runstate ใช้จำนวนข้อใหญ่ที่เล่นได้จริง (ไม่ใช่จำนวน choice/blank) */
  private countRunstateQuestions(payload: GameShowQuizPayload): number {
    const rawQuestions = payload.questions?.filter((q) => q && Array.isArray(q.choices)) ?? [];
    let total = 0;
    for (const q of rawQuestions) {
      const rawChoices = q.choices?.filter((c) => c && c.id != null) ?? [];
      if (rawChoices.length < 2) continue;
      const correctChoiceIds = rawChoices.filter((c) => !!c.is_correct).map((c) => c.id);
      if (correctChoiceIds.length === 0) continue;
      total += 1;
    }
    return total;
  }

  private buildGame(payload: GameShowQuizPayload) {
    const rawQuestions = payload.questions?.filter((q) => q && Array.isArray(q.choices)) ?? [];
    const normalized: QuizQuestionState[] = [];
    for (const q of rawQuestions) {
      const rawChoices = q.choices?.filter((c) => c && c.id != null) ?? [];
      if (rawChoices.length < 2) continue;
      const correct = rawChoices.filter((c) => !!c.is_correct);
      const correctChoiceIds = correct.map((c) => c.id);
      if (correctChoiceIds.length === 0) continue;
      normalized.push({
        id: q.id,
        no: q.no,
        question: q.question,
        sound_question: q.sound_question,
        image_question: q.image_question,
        hint: q.hint,
        sound_hint: q.sound_hint,
        image_hint: q.image_hint,
        choices: maybeShuffleChoices(rawChoices, q.shuffle_answer),
        correctChoiceIds,
      });
    }

    this.questions = normalized;
    this.numberOfQuestions = normalized.length;
    this.totalQuestions = this.numberOfQuestions;
    this.currentQuestionIndex = 0;
    this.correctAnswers = 0;
    this.score = 0;
    this.lastScoreChangeMs = Date.now();
    this.idleNoScoreMessageShown = false;
    this.gsqHudLives = GSQ_HUD_MAX_LIVES;
    this.gsqGameFailedByNoLives = false;
    this.parallaxGameplayMul = 1;
    this.endCutsceneActive = false;
    this.gsqGameIntroShown = false;
    this.refreshGsqHudHearts();

    this.lifeLines = { freeze: true, fiftyFifty: true, twoChance: true, pass: false };
    this.eliminatedChoiceIds.clear();
    this.twoChanceArmed = false;
    this.twoChanceWrongUsed = false;
    this.stopQuestionTimer();
    this.freezeResumeEvent?.destroy();
    this.freezeResumeEvent = undefined;

    this.destroyQuizUI();

    if (this.numberOfQuestions <= 0) {
      this.showMessage("ไม่พบข้อมูลคำถาม", 1800, undefined, "point");
      this.time.delayedCall(700, () => this.endGame());
      return;
    }

    this.hudElapsedAccumSec = 0;
    this.frozenHudElapsedSec = null;
    this.hudStarted = true;
    this.hudStartMs = Date.now();
    this.milestoneShown.clear();

    this.createQuizUI();
    this.quizUI?.container.setVisible(false);
    this.showGsqGameIntroThenFirstQuestion();
  }

  private showGsqGameIntroThenFirstQuestion() {
    this.lockInput = true;
    this.input.enabled = false;
    this.pauseHudTime();

    const intro = this.messageCatalog.game_intro;
    const text = intro?.text ?? "คุณคือรถสองแถวสีแดง คำตอบที่ถูกจะทำให้เราไปไกลขึ้น";
    const durationMs = 4800;

    this.playSfx("sfx_bubble", 1);
    this.showMessage(text, durationMs, intro?.voice, "point");
    this.gsqGameIntroShown = true;

    this.time.delayedCall(durationMs + 240, () => {
      if (!this.sys.isActive()) return;
      this.renderQuestion(0);
    });
  }

  private hideQuestionImagePreview() {
    this.questionImagePreview?.destroy(true);
    this.questionImagePreview = undefined;
    this.questionImagePreviewDomVisibility.forEach((wasVisible, dom) => {
      if (dom.active) dom.setVisible(wasVisible);
    });
    this.questionImagePreviewDomVisibility.clear();
  }

  private showQuestionImagePreview(textureKey: string) {
    this.hideQuestionImagePreview();
    if (!this.textures.exists(textureKey)) return;

    // DOM elements inside Phaser containers are not present directly in the
    // scene display list. Hide the known quiz labels explicitly so the browser's
    // DOM layer cannot render them over the canvas preview.
    const previewCoveredDomElements = [
      this.quizUI?.quizNoDom,
      this.quizUI?.questionDom,
      ...this.choiceUIs.map((choice) => choice.dom),
    ];
    previewCoveredDomElements.forEach((dom) => {
      if (!dom || this.questionImagePreviewDomVisibility.has(dom)) return;
      this.questionImagePreviewDomVisibility.set(dom, dom.visible);
      dom.setVisible(false);
    });

    const { width, height } = this.scale;
    const overlay = this.add
      .rectangle(0, 0, width, height, 0x000000, 0.76)
      .setOrigin(0, 0)
      .setInteractive({ useHandCursor: true });
    const panel = this.add
      .rectangle(width / 2, height / 2, width * 0.92, height * 0.76, 0xffffff, 1)
      .setStrokeStyle(3, 0x3d9bbd, 1);
    const preview = this.add.image(width / 2, height / 2, textureKey).setOrigin(0.5);
    const src = preview.texture.getSourceImage() as { width?: number; height?: number };
    const sourceW = src?.width ?? 1;
    const sourceH = src?.height ?? 1;
    const scale = Math.min((width * 0.84) / sourceW, (height * 0.66) / sourceH);
    preview.setDisplaySize(Math.max(1, sourceW * scale), Math.max(1, sourceH * scale));
    const close = this.add
      .text(width * 0.91, height * 0.14, "×", {
        fontFamily: "Arial, sans-serif",
        fontSize: this.mobile ? "38px" : "46px",
        fontStyle: "bold",
        color: "#ffffff",
        backgroundColor: "#0092D7",
        padding: { left: 12, right: 12, top: 2, bottom: 4 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    const container = this.add
      .container(0, 0, [overlay, panel, preview, close])
      .setDepth(5000)
      .setScrollFactor(0);
    overlay.on("pointerdown", () => this.hideQuestionImagePreview());
    close.on("pointerdown", () => this.hideQuestionImagePreview());
    this.questionImagePreview = container;
  }

  private destroyQuizUI(options?: { keepPanelBg?: boolean }) {
    this.hideQuestionImagePreview();
    if (this.quizUiOnResize) {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.quizUiOnResize);
      this.quizUiOnResize = undefined;
    }
    this.stopQuestionTimer();
    this.freezeResumeEvent?.destroy();
    this.freezeResumeEvent = undefined;
    this.choiceUIs.forEach((ui) => ui.container.destroy(true));
    this.choiceUIs = [];
    if (!options?.keepPanelBg) {
      this.preservedQuizPanelBg?.destroy();
      this.preservedQuizPanelBg = undefined;
    }

    const ui = this.quizUI;
    if (ui && options?.keepPanelBg) {
      ui.container.remove(ui.panel.bg, false);
      this.preservedQuizPanelBg?.destroy();
      this.preservedQuizPanelBg = ui.panel.bg;
      this.preservedQuizPanelBg.setDepth(ui.container.depth);
      this.add.existing(this.preservedQuizPanelBg);
    }

    ui?.container.destroy(true);
    this.quizUI = undefined;
  }

  private destroyQuestionTimerUi() {
    if (this.questionTimerUiOnResize) {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.questionTimerUiOnResize);
      this.questionTimerUiOnResize = undefined;
    }
    this.questionTimerUI?.container.destroy(true);
    this.questionTimerUI = undefined;
  }

  private createQuestionTimerUi() {
    this.destroyQuestionTimerUi();
    const container = this.add.container(0, 0).setDepth(1210);
    const box = this.add.graphics();
    const barBg = this.add.graphics();
    const barFill = this.add.graphics();
    container.add([box, barBg, barFill]);
    this.questionTimerUI = { container, box, barBg, barFill };
    this.layoutQuestionTimerUi();
    this.updateQuestionTimerUi();

    const onResize = () => this.layoutQuestionTimerUi();
    this.questionTimerUiOnResize = onResize;
    this.scale.on(Phaser.Scale.Events.RESIZE, onResize);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroyQuestionTimerUi());
  }

  private layoutQuestionTimerUi() {
    const ui = this.questionTimerUI;
    if (!ui) return;
    const { width, height } = this.scale;

    const timerBoxY = this.mobile ? height / 2 - height * 0.175 : height / 2 - height * 0.1;
    const screenPadding = this.mobile ? 15 : 30;
    const timerBoxW = (width - screenPadding * 2) * 0.3;
    const timerBoxH = this.mobile ? height * 0.025 : height * 0.035;
    const pad = this.mobile ? 2 : 3;
    const barW = Math.max(1, timerBoxW - pad * 2);
    const barH = Math.max(1, timerBoxH - pad * 2);
    const timerRadius = barH / 2;
    const barRadius = barH / 2;

    ui.container.setPosition(width / 2, timerBoxY);

    ui.box.clear();
    ui.box.fillStyle(0xffffff, 1);
    ui.box.fillRoundedRect(-timerBoxW / 2, -timerBoxH / 2, timerBoxW, timerBoxH, timerRadius);

    ui.layout = { w: barW, h: barH };

    ui.barBg.clear();
    ui.barBg.fillStyle(0xCFCFCF, 1);
    ui.barBg.fillRoundedRect(-barW / 2, -barH / 2, barW, barH, barRadius);

    this.updateQuestionTimerUi();
  }

  private createQuizUI() {
    this.destroyQuizUI();
    const container = this.add.container(0, 0).setDepth(1200);

    const panelBg = this.add.graphics();
    const itemsBg = this.add.graphics();
    const quizNoUnderline = this.add.graphics();
    const quizNoPlaceholder = document.createElement("div");
    const quizNoDom = this.add.dom(0, 0, quizNoPlaceholder).setOrigin(0.5, 0.5);
    const quizNoInner = document.createElement("div");
    const questionBox = this.add.graphics();
    const questionPlaceholder = document.createElement("div");
    const questionDom = this.add.dom(0, 0, questionPlaceholder).setOrigin(0.5, 0.5);
    const questionInner = document.createElement("div");

    const choicesContainer = this.add.container(0, 0);
    const lifelineContainer = this.add.container(0, 0);
    const lifelineButtons = this.createLifelineButtons(lifelineContainer);

    container.add([panelBg, itemsBg, quizNoUnderline, quizNoDom, questionBox, questionDom, choicesContainer, lifelineContainer]);
    this.quizUI = {
      container,
      panel: { bg: panelBg, itemsBg, quizNoUnderline },
      quizNoDom,
      quizNoInner,
      questionBox,
      questionDom,
      questionInner,
      choicesContainer,
      lifelineContainer,
      lifelineButtons,
    };

    this.layoutQuizUI();
    this.updateLifelineButtons();

    const onResize = () => this.layoutQuizUI();
    this.quizUiOnResize = onResize;
    this.scale.on(Phaser.Scale.Events.RESIZE, onResize);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroyQuizUI());
  }

  private createLifelineButtons(container: Phaser.GameObjects.Container): LifelineButtonUI[] {
    const mk = (key: LifelineKey, textureKey: string): LifelineButtonUI => {
      const image = this.add.image(0, 0, textureKey).setOrigin(0.5).setDepth(1201);
      image.setInteractive({ useHandCursor: true });
      this.ensureImageButtonFx(image);
      image.on("pointerdown", () => {
        if (!this.gameStarted) return;
        if (this.lockInput) return;
        if (!this.input.enabled) return;
        const before = { ...this.lifeLines };
        if (key === "freeze") this.useFreeze();
        if (key === "fiftyFifty") this.useFiftyFifty();
        if (key === "twoChance") this.useTwoChance();

        const after = this.lifeLines;
        const used =
          (key === "freeze" && before.freeze && !after.freeze) ||
          (key === "fiftyFifty" && before.fiftyFifty && !after.fiftyFifty) ||
          (key === "twoChance" && before.twoChance && !after.twoChance);
        if (used) {
          this.deductLifelineScore();
          this.animateLifelineGlow(image);
          this.flashQuizPanelBg();
        }
      });
      container.add(image);
      return { key, image, available: true };
    };
    return [
      mk("freeze", "btn_item_freeze"),
      mk("fiftyFifty", "btn_item_fifty_fifty"),
      mk("twoChance", "btn_item_two_chance"),
    ];
  }

  private deductLifelineScore() {
    this.score -= GameShowQuizGameScene.LIFELINE_SCORE_COST;
    this.lastScoreChangeMs = Date.now();
    this.updateHud();
  }

  private layoutQuizUI() {
    const ui = this.quizUI;
    if (!ui) return;
    if (this.mobile) {
      this.layoutQuizUIMobile(ui);
      return;
    }
    const { width, height } = this.scale;
    const ds = createHudScaleCtx(width, height, false);
    const panelHeight = height * Phaser.Math.Linear(0.5, 0.575, ds.scale);
    const panelTop = height - panelHeight;
    ui.container.setPosition(0, 0);

    ui.panel.bg.clear();
    ui.panel.bg.fillStyle(0x7CCCE9, 0.92);
    ui.panel.bg.fillRect(0, panelTop, width, panelHeight);

    const col1W = width * 0.15;
    const col2W = width * 0.7;
    const col3W = width * 0.15;
    const col1X = 0;
    const col2X = col1X + col1W;
    const col3X = col2X + col2W;
    const col1CenterX = col1X + col1W / 2;
    const col2CenterX = col2X + col2W / 2;
    const col3CenterX = col3X + col3W / 2;

    const padX = ds.px(16);
    const padY = ds.px(16);

    const itemsBoxX = col3X;
    const itemsBoxY = panelTop;
    const itemsBoxW = col3W;
    const itemsBoxH = panelHeight;

    ui.panel.itemsBg.clear();
    ui.panel.itemsBg.fillStyle(0xF6E748, 1);
    ui.panel.itemsBg.fillRect(itemsBoxX, itemsBoxY, itemsBoxW, itemsBoxH);

    ui.panel.itemsBg.lineStyle(4, 0x3D9BBD, 1); 
    ui.panel.itemsBg.lineBetween(itemsBoxX, itemsBoxY, itemsBoxX, itemsBoxY + itemsBoxH);

    const quizLabel = (ui.quizNoInner.textContent ?? "").trim() || "QUIZ : 1";
    const quizFontSizePx = ds.px(48);
    const quizDiv = createThaiTextElement(quizLabel, {
      width: Math.floor(col1W - padX * 2),
      height: Math.floor(panelHeight * 0.2),
      fontSize: `${quizFontSizePx}px`,
      color: "#FFFFFF",
      align: "center",
      padding: 0,
      maxLines: 1,
      minFontSizePx: quizFontSizePx,
    });
    const quizInner = quizDiv.firstElementChild as HTMLElement | null;
    if (quizInner) {
      quizInner.style.fontWeight = "900";
      quizInner.style.lineHeight = "1.4";
      quizInner.style.fontStyle = "italic";
      quizInner.style.textShadow = "0px 3px 0px rgba(0,0,0,0.25)";
    }
    ui.container.remove(ui.quizNoDom, true);
    const quizDomY = panelTop + padY + ds.px(54);
    const quizDom = this.add.dom(col1CenterX, quizDomY, quizDiv).setOrigin(0.5, 0.5);
    quizDom.pointerEvents = "none";
    ui.quizNoDom = quizDom;
    ui.quizNoInner = quizInner ?? ui.quizNoInner;
    ui.container.add(quizDom);

    ui.panel.quizNoUnderline.clear();
    ui.panel.quizNoUnderline.lineStyle(this.mobile ? 4 : 10, 0xF6E748, 0.95);
    const lineW = Math.max(1, quizFontSizePx * 4.5);
    const lineX1 = col1CenterX - lineW / 2;
    const lineX2 = col1CenterX + lineW / 2;
    const lineY = quizDomY + ds.px(35);
    ui.panel.quizNoUnderline.lineBetween(lineX1, lineY, lineX2, lineY);

    const quizContentW = Math.max(ds.px(520), Math.round(col2W - ds.px(20)));
    const questionBoxW = quizContentW;
    const questionBoxH = panelHeight * 0.2;
    const questionRadius = ds.px(22);
    const questionY = panelTop + padY + panelHeight * 0.1;

    ui.questionBox.clear();
    ui.questionBox.fillStyle(0xffffff, 0);
    ui.questionBox.fillRoundedRect(-questionBoxW / 2, -questionBoxH / 2, questionBoxW, questionBoxH, questionRadius);
    ui.questionBox.lineStyle(4, 0xFFFFFF, 1);
    ui.questionBox.strokeRoundedRect(-questionBoxW / 2, -questionBoxH / 2, questionBoxW, questionBoxH, questionRadius);
    ui.questionBox.setPosition(col2CenterX, questionY);

    const questionPad = this.mobile ? 10 : 14;
    const questionGap = this.mobile ? 10 : 12;
    const hasQuestionImage = !!ui.questionImage;
    const hasQuestionSound = !!this.questionSoundKey;
    const questionImageW = hasQuestionImage ? questionBoxH * 0.78 : 0;
    const questionSoundW = hasQuestionSound ? questionBoxH * 0.44 : 0;
    const questionLeadingW =
      (hasQuestionImage ? questionImageW : 0) +
      (hasQuestionImage && hasQuestionSound ? questionGap : 0) +
      (hasQuestionSound ? questionSoundW : 0);
    const questionTextW =
      questionBoxW -
      questionPad * 2 -
      questionLeadingW -
      (questionLeadingW > 0 ? questionGap : 0);

    const questionText = (ui.questionInner.textContent ?? "").trim() || "คำถาม";
    const questionDiv = createThaiTextElement(questionText, {
      width: Math.floor(Math.max(1, questionTextW)),
      height: questionBoxH,
      fontSize: ds.font(32),
      color: "#FFFFFF",
      align: "center",
      padding: questionPad,
      maxLines: 3,
      minFontSizePx: 14,
    });
    questionDiv.style.setProperty("position", "relative", "important");
    questionDiv.style.setProperty("display", "block", "important");
    questionDiv.style.setProperty("height", `${questionBoxH}px`, "important");
    const questionInner = questionDiv.firstElementChild as HTMLElement | null;
    if (questionInner) {
      questionInner.style.fontWeight = "800";
      questionInner.style.lineHeight = "1.4";
      questionInner.style.width = "100%";
      questionInner.style.position = "absolute";
      questionInner.style.left = "0";
      questionInner.style.right = "0";
      questionInner.style.top = "50%";
      questionInner.style.transform = "translateY(-50%)";
    }
    ui.container.remove(ui.questionDom, true);
    const textLeftX =
      col2CenterX -
      questionBoxW / 2 +
      questionPad +
      questionLeadingW +
      (questionLeadingW > 0 ? questionGap : 0);
    const textRightX = col2CenterX + questionBoxW / 2 - questionPad;
    const textCenterX = (textLeftX + textRightX) / 2;
    const qDom = this.add
      .dom(textCenterX - questionTextW / 2, questionY - questionBoxH / 2, questionDiv)
      .setOrigin(0, 0);
    qDom.pointerEvents = "none";
    ui.questionDom = qDom;
    ui.questionInner = questionInner ?? ui.questionInner;
    ui.container.add(qDom);

    if (ui.questionImage) {
      const maxW = Math.max(1, questionImageW);
      const maxH = questionBoxH * 1;
      const src = ui.questionImage.texture.getSourceImage() as { width?: number; height?: number };
      const w = src?.width ?? 1;
      const h = src?.height ?? 1;
      const s = Math.min(maxW / w, maxH / h);
      ui.questionImage.setDisplaySize(Math.max(1, w * s), Math.max(1, h * s));
      ui.questionImage.setPosition(
        col2CenterX - questionBoxW / 2 + questionPad + questionImageW / 2,
        questionY
      );
      ui.questionImage.setVisible(true);
    }

    if (ui.questionVolumeBtn) {
      if (hasQuestionSound) {
        ui.questionVolumeBtn.setVisible(true);
        ui.questionVolumeBtn.setInteractive({ useHandCursor: true });
        const src = ui.questionVolumeBtn.texture.getSourceImage() as { width?: number; height?: number };
        const w = src?.width ?? 1;
        const h = src?.height ?? 1;
        const maxW = Math.max(1, questionSoundW);
        const maxH = questionBoxH * 0.68;
        const s = Math.min(maxW / w, maxH / h);
        ui.questionVolumeBtn.setDisplaySize(Math.max(1, w * s), Math.max(1, h * s));
        const soundX =
          col2CenterX -
          questionBoxW / 2 +
          questionPad +
          (hasQuestionImage ? questionImageW + questionGap : 0) +
          questionSoundW / 2;
        ui.questionVolumeBtn.setPosition(soundX, questionY);
        this.ensureGsqSpeakerBtnFx(ui.questionVolumeBtn);
      } else {
        ui.questionVolumeBtn.setVisible(false);
        ui.questionVolumeBtn.disableInteractive();
      }
    }

    this.layoutGsqDesktopChoices(col2CenterX, quizContentW, questionY, questionBoxH, panelTop, panelHeight, padY, ds);

    const btnSizeW = Math.min(col3W * 0.8, ds.px(200));
    const btnSizeH = ds.px(72);
    const gapY = ds.px(28);

    const totalButtonsH = (btnSizeH * ui.lifelineButtons.length) + (gapY * (ui.lifelineButtons.length - 1));
    const lifelineStartY = itemsBoxY + (itemsBoxH / 2) - (totalButtonsH / 2) + (btnSizeH / 2);
    
    ui.lifelineContainer.setPosition(col3CenterX, lifelineStartY);
    ui.lifelineButtons.forEach((b, idx) => {
      const src = b.image.texture.getSourceImage() as { width?: number; height?: number };
      const srcW = src?.width ?? 1;
      const srcH = src?.height ?? 1;
      const scale = Math.min(btnSizeW / srcW, btnSizeH / srcH);
      const drawW = Math.max(1, srcW * scale);
      const drawH = Math.max(1, srcH * scale);
      b.image.setPosition(0, idx * (btnSizeH + gapY));
      b.image.setDisplaySize(drawW, drawH);
      b.image.setData("btnFxBaseScaleX", b.image.scaleX);
      b.image.setData("btnFxBaseScaleY", b.image.scaleY);
    });
  }

  private layoutQuizUIMobile(ui: QuizUIState) {
    const { width, height } = this.scale;
    const shortMobile = isShortMobileViewport(height, width);
    const tinyMobile = isTinyMobileViewport(height, width);
    ui.container.setPosition(0, 0);
    ui.choicesContainer.setPosition(0, 0);
    ui.lifelineContainer.setPosition(0, 0);

    const quizAreaH = Math.round(height * (tinyMobile ? 0.58 : shortMobile ? 0.54 : 0.5));
    const lifelineAreaH = Math.round(height * (tinyMobile ? 0.11 : shortMobile ? 0.12 : 0.15));
    const panelTop = height - quizAreaH;
    const panelHeight = quizAreaH;
    const lifelineAreaTop = Math.max(0, panelTop - lifelineAreaH);
    const padX = 4;
    const padY = tinyMobile ? 4 : shortMobile ? 6 : 8;
    const sectionGap = tinyMobile ? 4 : shortMobile ? 6 : 8;

    ui.panel.bg.clear();
    ui.panel.bg.fillStyle(0x7CCCE9, 0.92);
    ui.panel.bg.fillRect(0, panelTop, width, panelHeight);

    ui.panel.itemsBg.clear();
    ui.panel.itemsBg.fillStyle(0xF6E748, 1);
    ui.panel.itemsBg.fillRect(0, lifelineAreaTop, width, lifelineAreaH);
    ui.panel.itemsBg.lineStyle(4, 0x3D9BBD, 1);
    ui.panel.itemsBg.lineBetween(0, lifelineAreaTop + lifelineAreaH, width, lifelineAreaTop + lifelineAreaH);

    const quizLabel = (ui.quizNoInner.textContent ?? "").trim() || "QUIZ : 1";
    const quizFontSizePx = 14;
    const quizLabelH = Math.round(height * 0.05);
    const quizAreaW = Math.round(width * 0.32);
    const quizDiv = createThaiTextElement(quizLabel, {
      width: Math.floor(quizAreaW),
      height: quizLabelH,
      fontSize: `${quizFontSizePx}px`,
      color: "#FFFFFF",
      align: "left",
      padding: 0,
      maxLines: 1,
      minFontSizePx: quizFontSizePx,
    });
    const quizInner = quizDiv.firstElementChild as HTMLElement | null;
    if (quizInner) {
      quizInner.style.fontWeight = "900";
      quizInner.style.lineHeight = "1.4";
      quizInner.style.fontStyle = "italic";
      quizInner.style.textShadow = "0px 3px 0px rgba(0,0,0,0.25)";
    }
    ui.container.remove(ui.quizNoDom, true);
    const quizDomX = padX + quizAreaW / 2;
    const quizDomY = panelTop + padY + quizLabelH / 2;
    const quizDom = this.add.dom(quizDomX, quizDomY, quizDiv).setOrigin(0.5, 0.5);
    quizDom.pointerEvents = "none";
    ui.quizNoDom = quizDom;
    ui.quizNoInner = quizInner ?? ui.quizNoInner;
    ui.container.add(quizDom);

    ui.panel.quizNoUnderline.clear();
    ui.panel.quizNoUnderline.lineStyle(4, 0xF6E748, 0.95);
    const lineW = quizAreaW * 0.55;
    const lineX1 = padX;
    const lineX2 = padX + lineW;
    const lineY = quizDomY + quizLabelH / 2 + 4;
    ui.panel.quizNoUnderline.lineBetween(lineX1, lineY, lineX2, lineY);

    // Keep the question below the Quiz label. Previously image questions were
    // shifted upward and their border covered the label/underline on mobile.
    const quizContentShiftY = 0;

    const lifelineGapX = 14;
    const lifelineGapY = 2;
    const lifelinePadding = 6;
    const lifelineCount = ui.lifelineButtons.length;
    if (lifelineCount === 3) {
      const btnMaxW = (width - padX * 2 - lifelineGapX * 2) / 3;
      const btnMaxH = lifelineAreaH - lifelinePadding * 2;
      const gridW = btnMaxW * 3 + lifelineGapX * 2;
      const gridLeftX = (width - gridW) / 2;
      const lifelineCenterY = lifelineAreaTop + lifelineAreaH / 2;
      ui.lifelineButtons.forEach((b, idx) => {
        const x = gridLeftX + btnMaxW / 2 + idx * (btnMaxW + lifelineGapX);
        const y = lifelineCenterY;
        const src = b.image.texture.getSourceImage() as { width?: number; height?: number };
        const srcW = src?.width ?? 1;
        const srcH = src?.height ?? 1;
        const scale = Math.min(btnMaxW / srcW, btnMaxH / srcH);
        const drawW = Math.max(1, srcW * scale);
        const drawH = Math.max(1, srcH * scale);
        b.image.setPosition(x, y);
        b.image.setDisplaySize(drawW, drawH);
        b.image.setData("btnFxBaseScaleX", b.image.scaleX);
        b.image.setData("btnFxBaseScaleY", b.image.scaleY);
      });
    } else {
    const btnMaxW = (width - padX * 2 - lifelineGapX) / 2;
    const btnMaxH = (lifelineAreaH - (lifelinePadding * 2) - lifelineGapY) / 2;;
    const gridW = btnMaxW * 2 + lifelineGapX;
    const gridLeftX = (width - gridW) / 2;
    const gridTotalH = btnMaxH * 2 + lifelineGapY;
    const lifelineTopY = lifelineAreaTop + (lifelineAreaH - gridTotalH) / 2;
    ui.lifelineButtons.forEach((b, idx) => {
      const col = idx % 2;
      const row = Math.floor(idx / 2);
      const x = gridLeftX + btnMaxW / 2 + col * (btnMaxW + lifelineGapX);
      const y = lifelineTopY + btnMaxH / 2 + row * (btnMaxH + lifelineGapY);
      const src = b.image.texture.getSourceImage() as { width?: number; height?: number };
      const srcW = src?.width ?? 1;
      const srcH = src?.height ?? 1;
      const scale = Math.min(btnMaxW / srcW, btnMaxH / srcH);
      const drawW = Math.max(1, srcW * scale);
      const drawH = Math.max(1, srcH * scale);
      b.image.setPosition(x, y);
      b.image.setDisplaySize(drawW, drawH);
      b.image.setData("btnFxBaseScaleX", b.image.scaleX);
      b.image.setData("btnFxBaseScaleY", b.image.scaleY);
    });
    }

    const questionBoxW = Math.max(1, width - padX * 4);
    const questionPad = 8;
    const questionGap = 8;
    const hasQuestionImage = !!ui.questionImage;
    const hasQuestionSound = !!this.questionSoundKey;
    const questionText = (ui.questionInner.textContent ?? "").trim() || "คำถาม";
    const baseQuestionBoxH = Math.round(panelHeight * (tinyMobile ? 0.08 : shortMobile ? 0.09 : 0.1));
    const estimateLeadingW =
      (hasQuestionImage ? baseQuestionBoxH * 0.78 : 0) +
      (hasQuestionImage && hasQuestionSound ? questionGap : 0) +
      (hasQuestionSound ? baseQuestionBoxH * 0.44 : 0);
    const estimateTextW =
      questionBoxW - questionPad * 2 - estimateLeadingW - (estimateLeadingW > 0 ? questionGap : 0);
    const questionLineCount = this.measureThaiLineCount(questionText, estimateTextW, 18, 1.4);
    const maxQuestionBoxH = Math.max(
      baseQuestionBoxH,
      Math.round(panelHeight * (tinyMobile ? 0.18 : shortMobile ? 0.21 : 0.24))
    );
    const questionBoxH =
      questionLineCount <= 1
        ? baseQuestionBoxH
        : Phaser.Math.Clamp(
            Math.round(baseQuestionBoxH + (questionLineCount - 1) * 18 * 1.4 + 10),
            baseQuestionBoxH,
            maxQuestionBoxH
          );
    const questionImageW = hasQuestionImage ? questionBoxH * 0.78 : 0;
    const questionSoundW = hasQuestionSound ? questionBoxH * 0.44 : 0;
    const questionLeadingW =
      (hasQuestionImage ? questionImageW : 0) +
      (hasQuestionImage && hasQuestionSound ? questionGap : 0) +
      (hasQuestionSound ? questionSoundW : 0);
    const questionTextW =
      questionBoxW - questionPad * 2 - questionLeadingW - (questionLeadingW > 0 ? questionGap : 0);
    const questionRadius = 8;
    const quizContentTopY = lineY + sectionGap - quizContentShiftY;
    const questionTopY = quizContentTopY;
    const questionY = questionTopY + questionBoxH / 2;

    ui.questionBox.clear();
    ui.questionBox.fillStyle(0xffffff, 0);
    ui.questionBox.fillRoundedRect(-questionBoxW / 2, -questionBoxH / 2, questionBoxW, questionBoxH, questionRadius);
    ui.questionBox.lineStyle(2, 0xFFFFFF, 1);
    ui.questionBox.strokeRoundedRect(-questionBoxW / 2, -questionBoxH / 2, questionBoxW, questionBoxH, questionRadius);
    ui.questionBox.setPosition(width / 2, questionY);

    if (ui.questionImage) {
      const maxW = Math.max(1, questionImageW);
      const maxH = questionBoxH;
      const src = ui.questionImage.texture.getSourceImage() as { width?: number; height?: number };
      const w = src?.width ?? 1;
      const h = src?.height ?? 1;
      const s = Math.min(maxW / w, maxH / h);
      ui.questionImage.setDisplaySize(Math.max(1, w * s), Math.max(1, h * s));
      ui.questionImage.setPosition(
        width / 2 - questionBoxW / 2 + questionPad + questionImageW / 2,
        questionY
      );
      ui.questionImage.setVisible(true);
    }

    const questionDiv = createThaiTextElement(questionText, {
      width: Math.floor(Math.max(1, questionTextW)),
      height: questionBoxH,
      fontSize: "14px",
      color: "#FFFFFF",
      align: "center",
      padding: questionPad,
      maxLines: 3,
      minFontSizePx: 14,
    });
    questionDiv.style.setProperty("position", "relative", "important");
    questionDiv.style.setProperty("display", "block", "important");
    questionDiv.style.setProperty("height", `${questionBoxH}px`, "important");
    const questionInner = questionDiv.firstElementChild as HTMLElement | null;
    if (questionInner) {
      questionInner.style.fontWeight = "800";
      questionInner.style.lineHeight = "1.4";
      questionInner.style.width = "100%";
      questionInner.style.position = "absolute";
      questionInner.style.left = "0";
      questionInner.style.right = "0";
      questionInner.style.top = "50%";
      questionInner.style.transform = "translateY(-50%)";
    }
    ui.container.remove(ui.questionDom, true);
    const textLeftX =
      width / 2 - questionBoxW / 2 + questionPad + questionLeadingW + (questionLeadingW > 0 ? questionGap : 0);
    const textRightX = width / 2 + questionBoxW / 2 - questionPad;
    const textCenterX = (textLeftX + textRightX) / 2;
    const qDom = this.add
      .dom(textCenterX - questionTextW / 2, questionY - questionBoxH / 2, questionDiv)
      .setOrigin(0, 0);
    qDom.pointerEvents = "none";
    ui.questionDom = qDom;
    ui.questionInner = questionInner ?? ui.questionInner;
    ui.container.add(qDom);

    if (ui.questionVolumeBtn) {
      if (hasQuestionSound) {
        ui.questionVolumeBtn.setVisible(true);
        ui.questionVolumeBtn.setInteractive({ useHandCursor: true });
        const src = ui.questionVolumeBtn.texture.getSourceImage() as { width?: number; height?: number };
        const w = src?.width ?? 1;
        const h = src?.height ?? 1;
        const maxW = Math.max(1, questionSoundW);
        const maxH = questionBoxH * 0.68;
        const s = Math.min(maxW / w, maxH / h);
        ui.questionVolumeBtn.setDisplaySize(Math.max(1, w * s), Math.max(1, h * s));
        const soundX =
          width / 2 -
          questionBoxW / 2 +
          questionPad +
          (hasQuestionImage ? questionImageW + questionGap : 0) +
          questionSoundW / 2;
        ui.questionVolumeBtn.setPosition(soundX, questionY);
        this.ensureGsqSpeakerBtnFx(ui.questionVolumeBtn);
      } else {
        ui.questionVolumeBtn.setVisible(false);
        ui.questionVolumeBtn.disableInteractive();
      }
    }

    const choiceCount = this.choiceUIs.length;
    const hasImageChoices = this.choiceUIs.some((c) => !!c.image);
    const choiceGapY = hasImageChoices
      ? -8
      : Math.max(
          2,
          Math.round((tinyMobile ? 4 : shortMobile ? 6 : 8) * GSQ_CHOICE_GRID_GAP_SCALE)
        );
    const questionChoicesGap = hasImageChoices
      ? mobileCompactPx(2, height, width)
      : Math.max(mobileCompactPx(24, height, width), Math.round(panelHeight * 0.07));
    const choicesTop = questionY + questionBoxH / 2 + questionChoicesGap;
    const bottomInnerPad = Math.round(Phaser.Math.Clamp(panelHeight * 0.02, 4, 12));
    const bubbleReserve = this.getGsqChoicesBottomReservePx();
    const choicesBottom = Math.min(
      panelTop + panelHeight - padY - bottomInnerPad - bubbleReserve,
      height - bubbleReserve
    );
    const choicesH = Math.max(1, choicesBottom - choicesTop);
    const choiceRows = Math.max(1, Math.ceil(choiceCount / 2));
    const choiceGapX = Math.max(4, Math.round(10 * GSQ_CHOICE_GRID_GAP_SCALE));
    const choiceGridW = Math.max(1, Math.round((width - padX * 2) * (1 - (1 - GSQ_CHOICE_GRID_GAP_SCALE) * 0.5)));
    const baseRowH = Math.min(
      Math.floor((choicesH - choiceGapY * Math.max(0, choiceRows - 1)) / choiceRows),
      Math.round(panelHeight * (tinyMobile ? 0.16 : shortMobile ? 0.19 : 0.22))
    );
    const rowH = Math.max(tinyMobile ? 36 : shortMobile ? 42 : 48, baseRowH);
    const textRowH = Math.max(tinyMobile ? 40 : shortMobile ? 44 : 48, Math.round(rowH * 0.94));
    // Keep image choices readable without letting their rows grow into the
    // teacher/menu area on short mobile screens.
    const imageRowH = Math.max(
      tinyMobile ? 104 : shortMobile ? 112 : 124,
      Math.round(rowH * 1.35)
    );
    const rowHeights: number[] = new Array(choiceRows).fill(textRowH);
    this.choiceUIs.forEach((choiceUi, i) => {
      if (!choiceUi.image) return;
      const rowIndex = Math.floor(i / 2);
      rowHeights[rowIndex] = Math.max(rowHeights[rowIndex] ?? textRowH, imageRowH);
    });
    let totalChoicesH =
      rowHeights.reduce((sum, h) => sum + h, 0) + choiceGapY * Math.max(0, choiceRows - 1);
    // Text-only rows may still compress on very short screens. Image rows use
    // the fixed mobile height above so their two rows remain separated.
    if (totalChoicesH > choicesH && !hasImageChoices) {
      const scaleDown = choicesH / totalChoicesH;
      for (let r = 0; r < rowHeights.length; r += 1) {
        rowHeights[r] = Math.max(tinyMobile ? 36 : 40, Math.round(rowHeights[r] * scaleDown));
      }
    }
    const rowCenters: number[] = [];
    let accTop = choicesTop;
    for (let r = 0; r < choiceRows; r += 1) {
      const rh = rowHeights[r] ?? textRowH;
      rowCenters[r] = accTop + rh / 2;
      accTop += rh + choiceGapY;
    }
    const cellW = Math.max(1, (choiceGridW - choiceGapX) / 2);
    const gridLeftX = (width - choiceGridW) / 2 + cellW / 2;

    this.choiceUIs.forEach((choiceUi, i) => {
      const col = i % 2;
      const rowIndex = Math.floor(i / 2);
      const rh = rowHeights[rowIndex] ?? textRowH;
      const x = gridLeftX + col * (cellW + choiceGapX);
      const y = rowCenters[rowIndex] ?? choicesTop + rh / 2;

      choiceUi.container.setPosition(x, y);
      choiceUi.container.setData("choiceFxBaseX", x);
      choiceUi.container.setData("choiceFxBaseY", y);
      this.ensureChoiceButtonFx(choiceUi);
      this.layoutGsqChoiceCard(choiceUi, cellW, rh, {
        mobile: true,
        px: (n) => mobileCompactPx(n, height, width),
      });
      choiceUi.container.setData("choiceFxBaseScaleX", choiceUi.container.scaleX);
      choiceUi.container.setData("choiceFxBaseScaleY", choiceUi.container.scaleY);
      this.resetGsqChoiceContainerHover(choiceUi);
    });
  }

  private renderQuestion(index: number) {
    const ui = this.quizUI;
    if (!ui) return;
    ui.container.setVisible(true);
    const q = this.questions[index];
    if (!q) {
      this.endGame();
      return;
    }

    const flowToken = this.bumpQuestionFlowToken();

    this.currentQuestionIndex = index;
    this.refreshGsqQuestionProgressHud();

    this.syncGameAudioFromQuestion(q);

    this.lockInput = true;
    this.input.enabled = false;
    this.pauseHudTime();
    this.stopQuestionTimer();
    this.freezeResumeEvent?.destroy();
    this.freezeResumeEvent = undefined;
    this.eliminatedChoiceIds.clear();
    this.twoChanceArmed = false;
    this.twoChanceWrongUsed = false;
    this.resetPerQuestionMessages();
    this.remainingCorrectChoiceIds = new Set(q.correctChoiceIds);

    ui.quizNoInner.textContent = `QUIZ : ${q.no || index + 1}`;
    ui.questionInner.textContent = q.question || "คำถาม";
    this.hideQuestionImagePreview();
    const imgKey = this.getImageKeyForPath(q.image_question);
    if (imgKey) {
      if (ui.questionImage) ui.questionImage.destroy();
      ui.questionImage = this.add.image(0, 0, imgKey).setDepth(1201).setOrigin(0.5);
      if (this.mobile) {
        ui.questionImage.setInteractive({ useHandCursor: true });
        ui.questionImage.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
          (pointer.event as unknown as { stopPropagation?: () => void } | undefined)?.stopPropagation?.();
          this.showQuestionImagePreview(imgKey);
        });
      }
      ui.container.add(ui.questionImage);
      ui.container.bringToTop(ui.questionImage);
    } else if (ui.questionImage) {
      ui.questionImage.destroy();
      ui.questionImage = undefined;
    }
    this.questionSoundKey = this.getSoundKeyForPath(q.sound_question);
    if (this.questionSoundKey) {
      if (!ui.questionVolumeBtn) {
        ui.questionVolumeBtn = this.add.image(0, 0, HUD_VOLUME_TEXTURE_KEY).setOrigin(0.5, 0.5).setDepth(1203);
        ui.questionVolumeBtn.setInteractive({ useHandCursor: true });
        ui.questionVolumeBtn.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
          (pointer.event as unknown as { stopPropagation?: () => void } | undefined)?.stopPropagation?.();
          if (!this.questionSoundKey) return;
          this.playQuestionAudio(this.questionSoundKey, 1);
        });
        this.ensureGsqSpeakerBtnFx(ui.questionVolumeBtn);
        ui.container.add(ui.questionVolumeBtn);
        ui.container.bringToTop(ui.questionVolumeBtn);
      }
      ui.questionVolumeBtn.setTexture(HUD_VOLUME_TEXTURE_KEY);
      ui.questionVolumeBtn.setInteractive({ useHandCursor: true });
      ui.questionVolumeBtn.setVisible(true);
      this.ensureGsqSpeakerBtnFx(ui.questionVolumeBtn);
    } else if (ui.questionVolumeBtn) {
      this.tweens.killTweensOf(ui.questionVolumeBtn);
      ui.questionVolumeBtn.setVisible(false);
      ui.questionVolumeBtn.disableInteractive();
      ui.questionVolumeBtn.setAlpha(0);
    }

    this.choiceUIs.forEach((c) => c.container.destroy(true));
    this.choiceUIs = [];

    const choices = q.choices ?? [];
    const letterByIndex = ["ก.", "ข.", "ค.", "ง.", "จ.", "ฉ.", "ช.", "ซ."];
    for (const [choiceIndex, c] of choices.entries()) {
      const bg = this.add.graphics();
      const imageFrame = this.add.graphics().setDepth(1199);
      const circleBg = this.add.graphics();
      const letterFontPx = this.mobile ? 28 : 40;
      const letterText = this.add.text(0, 0, letterByIndex[choiceIndex] ?? String(choiceIndex + 1), {
        fontSize: `${letterFontPx}px`,
        color: GSQ_CHOICE_LETTER_COLOR,
        fontFamily: "Noto Sans Thai",
        fontStyle: "bold",
      }).setOrigin(0.5, 0.5).setDepth(1203);
      this.styleGsqChoiceLetterText(letterText, letterFontPx, false);
      const placeholder = document.createElement("div");
      const dom = this.add.dom(0, 0, placeholder).setOrigin(0.5, 0.5);
      const inner = document.createElement("div");
      inner.textContent = c.choice || "";
      const soundKey = this.getSoundKeyForPath(c.sound_choice);
      const imageKey = this.getImageKeyForPath(c.image_choice);
      const choiceImage = imageKey ? this.add.image(0, 0, imageKey).setOrigin(0.5, 0.5).setDepth(1200) : undefined;
      const volumeBtn = soundKey
        ? this.add.image(0, 0, HUD_VOLUME_TEXTURE_KEY).setOrigin(0.5, 0.5).setDepth(1204)
        : undefined;
      if (volumeBtn && soundKey) {
        this.bindGsqChoiceVolumeBtn(volumeBtn, soundKey);
      }
      const pickZone = this.add.zone(0, 0, 1, 1);
      pickZone.setDepth(1202);
      pickZone.on("pointerdown", () => this.onChoicePicked(c.id));
      const row = this.add.container(0, 0);
      const rowChildren: Phaser.GameObjects.GameObject[] = [bg, imageFrame, circleBg];
      if (choiceImage) rowChildren.push(choiceImage);
      rowChildren.push(dom, letterText, pickZone);
      if (volumeBtn) rowChildren.push(volumeBtn);
      row.add(rowChildren);
      row.setData("choiceId", c.id);
      ui.choicesContainer.add(row);
      const rowUi: ChoiceRowUI = {
        container: row,
        pickZone,
        bg,
        imageFrame,
        circleBg,
        letterText,
        dom,
        inner,
        volumeBtn,
        image: choiceImage,
        choiceId: c.id,
        isCorrect: !!c.is_correct,
        eliminated: false,
        disabled: false,
        soundKey,
        width: 1,
        height: 1,
        pillW: 1,
        pillH: 1,
      };
      this.choiceUIs.push(rowUi);
    }

    this.layoutQuizUI();
    this.updateLifelineButtons();

    this.playSfx("sfx_bubble", 1);
    const hasHint = this.hasGameShowQuizQuestionHint(q);
    const shKey = this.getSoundKeyForPath(q.sound_hint);
    const sqKey = this.getSoundKeyForPath(q.sound_question);
    const hintHasSound = !!shKey && (!sqKey || shKey !== sqKey);
    const deferHintForQuestion = !!this.questionSoundKey && hasHint && hintHasSound;

    if (hasHint && !deferHintForQuestion) {
      this.showGameShowQuizQuestionHint(q);
      this.trackQuestionAudioTimer(
        this.time.delayedCall(600, () => {
          if (flowToken !== this.questionFlowToken) return;
          this.playGameShowQuizHintSound(q);
        })
      );
    } else if (!hasHint && index > 0) {
      this.showRandomMessage(this.messagePools.intro, 2000, "point");
    }

    const { height } = this.scale;
    const questionFromOffsetY = Math.max(18, Math.round(height * (this.mobile ? 0.08 : 0.06)));
    const questionDuration = 800;
    const choiceStagger = 220;
    const choiceDuration = 320;
    const startTimerExtraDelay = 550;

    const questionObjs: Array<Phaser.GameObjects.GameObject | undefined> = [
      ui.questionBox,
      ui.questionDom,
      ui.questionImage,
      ...(this.questionSoundKey ? [ui.questionVolumeBtn] : []),
    ];

    questionObjs.forEach((obj) => {
      if (!obj) return;
      this.tweens.killTweensOf(obj);
      const y = (obj as unknown as { y?: number }).y;
      if (typeof y === "number") (obj as unknown as { y: number }).y = y + questionFromOffsetY;
      (obj as unknown as { alpha?: number }).alpha = 0;
      (obj as unknown as { visible?: boolean }).visible = true;
    });

    questionObjs.forEach((obj) => {
      if (!obj) return;
      const targetY = (obj as unknown as { y: number }).y - questionFromOffsetY;
      this.tweens.add({
        targets: obj,
        y: targetY,
        alpha: 1,
        duration: questionDuration,
        ease: "Cubic.easeOut",
      });
    });

    const afterQuestionMs = 320;
    this.resetAllGsqChoiceHovers();
    this.choiceUIs.forEach((choiceUi, idx) => {
      const baseY = choiceUi.container.y;
      this.tweens.killTweensOf(choiceUi.container);
      choiceUi.container.setScale(1, 1);
      choiceUi.container.setData("choiceFxBaseScaleX", 1);
      choiceUi.container.setData("choiceFxBaseScaleY", 1);
      choiceUi.container.setData("choiceFxHovering", false);
      choiceUi.container.setAlpha(0);
      choiceUi.container.setY(baseY + (this.mobile ? 14 : 18));
      this.tweens.add({
        targets: choiceUi.container,
        alpha: 1,
        y: baseY,
        duration: choiceDuration,
        delay: afterQuestionMs + idx * choiceStagger,
        ease: "Cubic.easeOut",
        onComplete: () => {
          this.resetGsqChoiceContainerHover(choiceUi);
        },
      });
    });

    this.trackQuestionAudioTimer(
      this.time.delayedCall(questionDuration, () => {
        if (!this.sys.isActive()) return;
        if (flowToken !== this.questionFlowToken) return;
        if (!this.questionSoundKey) return;
        if (deferHintForQuestion) {
          // เสียงโจทย์เล่นจบก่อน แล้วค่อยขึ้นคำใบ้ + เสียงคำใบ้
          guardedScenePlayQuestionThen(this, this.questionSoundKey, 1, () => {
            if (!this.sys.isActive()) return;
            if (flowToken !== this.questionFlowToken) return;
            this.showGameShowQuizQuestionHint(q);
            this.trackQuestionAudioTimer(
              this.time.delayedCall(150, () => {
                if (flowToken !== this.questionFlowToken) return;
                this.playGameShowQuizHintSound(q);
              })
            );
          });
        } else {
          this.playQuestionAudio(this.questionSoundKey, 1);
        }
      })
    );

    const totalChoicesMs =
      this.choiceUIs.length > 0
        ? afterQuestionMs + (this.choiceUIs.length - 1) * choiceStagger + choiceDuration
        : afterQuestionMs;

    this.time.delayedCall(totalChoicesMs + startTimerExtraDelay, () => {
      if (!this.sys.isActive()) return;
      if (flowToken !== this.questionFlowToken) return;
      this.questionTimeRemainingMs = 60_000;
      this.questionTimerPaused = false;
      this.questionTimerLastTickMs = Date.now();
      this.startQuestionTimer();
      this.resumeHudTime();
      this.resetAllGsqChoiceHovers();
      this.lockInput = false;
      this.input.enabled = true;
      this.choiceUIs.forEach((choiceUi) => this.syncGsqChoicePickZoneInteractivity(choiceUi));
    });
  }

  private onChoicePicked(choiceId: number) {
    if (this.lockInput) return;
    if (!this.input.enabled) return;
    const question = this.questions[this.currentQuestionIndex];
    if (!question) return;
    const ui = this.choiceUIs.find((c) => c.choiceId === choiceId);
    if (!ui) return;
    if (ui.eliminated || ui.disabled) return;

    this.cancelQuestionAudioTimers();
    this.stopGameShowQuizQuestionVoices();

    this.lockInput = true;
    this.input.enabled = false;
    this.playSfx("sfx_pop", 1);
    this.pauseHudTime();

    const isCorrect =
      ui.isCorrect ||
      question.correctChoiceIds.includes(choiceId) ||
      this.remainingCorrectChoiceIds.has(choiceId);
    if (isCorrect) {
      this.playSfx("sfx_correct", 1);
      ui.disabled = true;
      this.drawChoiceBackground(ui, "correct");
      ui.volumeBtn?.disableInteractive();
      ui.volumeBtn?.setAlpha(0.45);
      if (ui.soundKey) this.playChoiceAudio(ui.soundKey, 1);
      this.remainingCorrectChoiceIds.delete(choiceId);

      if (this.remainingCorrectChoiceIds.size > 0) {
        this.resumeHudTime();
        this.lockInput = false;
        this.input.enabled = true;
        return;
      }

      this.stopQuestionTimer();
      const award = 10;
      const decor = this.introDecor;
      const { width, height } = this.scale;
      const truck = decor?.truck;
      const burstX = truck?.x ?? width / 2;
      const burstY = truck?.y ?? height / 2;
      const depth = (truck?.depth ?? 100) + 4;
      const isLast = this.currentQuestionIndex >= this.numberOfQuestions - 1;

      this.bumpQuestionFlowToken();

      void (async () => {
        await this.animateChoiceCorrect(ui);
        if (!this.sys.isActive()) return;

        this.createParticleBurst(burstX, burstY, depth);
        this.score += award;
        this.correctAnswers += 1;
        this.lastScoreChangeMs = Date.now();
        this.updateHud();
        if (!this.sys.isActive()) return;

        if (isLast) {
          this.finishQuizAfterQuestions();
          return;
        }
        this.showRandomMessage(this.messagePools.correct, 1800, "clap");
        this.time.delayedCall(450, () => this.goToNextQuestion());
      })();
      return;
    }

    ui.disabled = true;
    this.drawChoiceBackground(ui, "wrong");
    ui.volumeBtn?.disableInteractive();
    ui.volumeBtn?.setAlpha(0.45);
    if (ui.soundKey) this.playChoiceAudio(ui.soundKey, 1);

    void (async () => {
      this.playSfx("sfx_incorrect", 1);
      await this.animateChoiceWrongShake(ui);
      if (!this.sys.isActive()) return;

      if (this.twoChanceArmed && !this.twoChanceWrongUsed) {
        this.twoChanceWrongUsed = true;
        this.twoChanceArmed = false;
        this.updateLifelineButtons();
        this.showRandomMessage(this.messagePools.two_chance, 1800, "point");
        this.time.delayedCall(250, () => {
          this.resumeHudTime();
          this.lockInput = false;
          this.input.enabled = true;
        });
        return;
      }

      this.bumpQuestionFlowToken();
      this.stopQuestionTimer();
      this.gsqLoseLife();
      if (!this.sys.isActive()) return;

      if (this.gsqGameFailedByNoLives) {
        this.time.delayedCall(320, () => this.playFailedByLivesCutscene());
        return;
      }
      this.continueAfterWrongAnswer();
    })();
  }

  private goToNextQuestion() {
    this.reportRunstateQuestionCompleted(this.currentQuestionIndex + 1);
    this.currentQuestionIndex += 1;
    if (this.currentQuestionIndex >= this.numberOfQuestions) {
      this.finishQuizAfterQuestions();
      return;
    }
    this.renderQuestion(this.currentQuestionIndex);
  }

  private startQuestionTimer() {
    this.stopQuestionTimer();
    this.questionTimerLastTickMs = Date.now();
    this.questionTimerPaused = false;
    this.updateQuestionTimerUi();
    this.questionTimerEvent = this.time.addEvent({
      delay: 200,
      loop: true,
      callback: () => this.tickQuestionTimer(),
    });
    this.updateTickingByQuestionTimer();
  }

  private stopQuestionTimer() {
    this.questionTimerEvent?.destroy();
    this.questionTimerEvent = undefined;
    this.stopTicking();
  }

  private pauseQuestionTimer() {
    this.questionTimerPaused = true;
    this.stopTicking();
  }

  private resumeQuestionTimer() {
    this.questionTimerPaused = false;
    this.questionTimerLastTickMs = Date.now();
    this.updateTickingByQuestionTimer();
  }

  private tickQuestionTimer() {
    if (!this.gameStarted) return;
    if (this.questionTimerPaused) return;
    const now = Date.now();
    const dt = Math.max(0, now - this.questionTimerLastTickMs);
    this.questionTimerLastTickMs = now;
    this.questionTimeRemainingMs = Math.max(0, this.questionTimeRemainingMs - dt);
    this.updateQuestionTimerUi();
    this.updatePerQuestionMessagesByElapsed(60_000 - this.questionTimeRemainingMs);
    this.updateTickingByQuestionTimer();
    if (this.questionTimeRemainingMs <= 0) {
      this.onQuestionTimeout();
    }
  }

  private updateTickingByQuestionTimer() {
    this.stopTicking();
  }

  private updateQuestionTimerUi() {
    const ui = this.questionTimerUI;
    if (!ui) return;
    const layout = ui.layout;
    if (!layout) return;
    const ratio = Phaser.Math.Clamp(this.questionTimeRemainingMs / 60_000, 0, 1);
    const remainingSec = Math.ceil(this.questionTimeRemainingMs / 1000);

    const color =
      remainingSec > 30 ? 0x40DA6E : remainingSec > 10 ? 0xEDD734 : 0xED5034;
    const w = layout.w;
    const h = layout.h;
    const fillW = h + ((w - h) * ratio);
    const radius = h / 2;

    ui.barFill.clear();
    ui.barFill.fillStyle(color, 1);
    ui.barFill.fillRoundedRect(-w / 2, -h / 2, fillW, h, radius);
  }

  private onQuestionTimeout() {
    if (this.lockInput && this.gsqGameFailedByNoLives) return;
    this.lockInput = true;
    this.input.enabled = false;
    this.bumpQuestionFlowToken();
    this.stopQuestionTimer();
    this.showMessage("หมดเวลา", 1800, undefined, "point");

    void (async () => {
      this.playSfx("sfx_incorrect", 1);
      this.gsqLoseLife();
      if (!this.sys.isActive()) return;
      if (this.gsqGameFailedByNoLives) {
        this.time.delayedCall(320, () => this.playFailedByLivesCutscene());
        return;
      }
      this.continueAfterWrongAnswer();
    })();
  }

  private useTwoChance() {
    if (!this.lifeLines.twoChance) return;
    if (this.twoChanceArmed) return;
    this.playSfx("sfx_coin_collect", 1);
    this.lifeLines.twoChance = false;
    this.twoChanceArmed = true;
    this.twoChanceWrongUsed = false;
    this.updateLifelineButtons();
    this.showMessage("เปิดโอกาสสองครั้งแล้ว", 1600, undefined, "point");
  }

  private usePass() {
    if (!this.lifeLines.pass) return;
    this.playSfx("sfx_coin_collect", 1);
    this.lifeLines.pass = false;
    this.updateLifelineButtons();
    this.lockInput = true;
    this.input.enabled = false;
    this.bumpQuestionFlowToken();
    this.stopQuestionTimer();
    this.showMessage("ผ่านข้อนี้แล้ว", 1400, undefined, "point");
    this.time.delayedCall(500, () => {
      const isLast = this.currentQuestionIndex >= this.numberOfQuestions - 1;
      if (isLast) {
        this.finishQuizAfterQuestions();
        return;
      }
      this.goToNextQuestion();
    });
  }

  private useFreeze() {
    if (!this.lifeLines.freeze) return;
    if (this.questionTimerPaused) return;
    this.playSfx("sfx_coin_collect", 1);
    this.lifeLines.freeze = false;
    this.updateLifelineButtons();
    this.pauseQuestionTimer();
    this.showMessage("หยุดเวลา 10 วินาที", 1400, undefined, "point");
    this.freezeResumeEvent?.destroy();
    this.freezeResumeEvent = this.time.delayedCall(10_000, () => this.resumeQuestionTimer());
  }

  private useFiftyFifty() {
    if (!this.lifeLines.fiftyFifty) return;
    const q = this.questions[this.currentQuestionIndex];
    const correctIdSet = new Set(q?.correctChoiceIds ?? []);
    const candidates = this.choiceUIs.filter((c) => {
      if (correctIdSet.has(c.choiceId)) return false;
      if (c.isCorrect) return false;
      return !c.eliminated;
    });
    if (this.choiceUIs.length <= 2 || candidates.length <= 1) {
      this.showMessage("ใช้ 50/50 ไม่ได้", 1400, undefined, "point");
      return;
    }

    this.playSfx("sfx_coin_collect", 1);
    const keepWrong = Phaser.Utils.Array.GetRandom(candidates);
    candidates.forEach((c) => {
      if (c.choiceId === keepWrong.choiceId) return;
      c.eliminated = true;
      c.disabled = true;
      c.pickZone.disableInteractive();
      c.container.disableInteractive();
      this.drawChoiceBackground(c, "disabled");
      c.volumeBtn?.disableInteractive();
      c.volumeBtn?.setAlpha(0.45);
      const domNode = c.dom.node as HTMLElement | null;
      if (domNode) {
        domNode.style.opacity = "0.55";
        domNode.style.filter = "grayscale(0.9)";
        domNode.style.pointerEvents = "none";
      }
      this.eliminatedChoiceIds.add(c.choiceId);
    });

    this.lifeLines.fiftyFifty = false;
    this.updateLifelineButtons();
    this.showMessage("ตัดตัวเลือกเหลือ 2 ข้อแล้ว", 1500, undefined, "point");
  }

  private updateLifelineButtons() {
    const ui = this.quizUI;
    if (!ui) return;
    ui.lifelineButtons.forEach((b) => {
      const available =
        b.key === "fiftyFifty"
          ? this.lifeLines.fiftyFifty
          : b.key === "freeze"
          ? this.lifeLines.freeze
          : b.key === "pass"
          ? this.lifeLines.pass
          : this.lifeLines.twoChance;
      b.available = available;
      this.tweens.killTweensOf(b.image);
      b.image.clearTint();
      const baseX = b.image.getData("btnFxBaseScaleX");
      const baseY = b.image.getData("btnFxBaseScaleY");
      const sx = typeof baseX === "number" ? baseX : b.image.scaleX;
      const sy = typeof baseY === "number" ? baseY : b.image.scaleY;
      b.image.setScale(sx, sy);
      b.image.setAlpha(available ? 1 : 0.35);
      if (available) {
        b.image.setInteractive({ useHandCursor: true });
      } else {
        b.image.disableInteractive();
      }
    });
  }

  private getGsqChoicesBottomReservePx(): number {
    const q = this.questions[this.currentQuestionIndex];
    const hintText = (q?.hint ?? "").trim();
    const imgKey = q ? this.getImageKeyForPath(q.image_hint) : null;
    const hasHintImage = !!(imgKey && this.textures.exists(imgKey));
    const hasChoiceImages = this.choiceUIs.some((c) => !!c.image);
    const safetyGap = this.mobile
      ? hasHintImage && hasChoiceImages
        ? mobileCompactPx(30, this.scale.height, this.scale.width)
        : mobileCompactPx(20, this.scale.height, this.scale.width)
      : undefined;

    return TeacherHintUI.measureBottomReservePx(this, this.mobile, {
      hintText,
      hintTextureKey: imgKey,
      safetyGap,
    });
  }

  private layoutGsqChoiceCard(
    choiceUi: ChoiceRowUI,
    cellW: number,
    rowH: number,
    opts: { mobile: boolean; px: (n: number) => number }
  ) {
    const { mobile, px } = opts;
    const tc = mobile ? GSQ_CHOICE_TUNING.mobile : GSQ_CHOICE_TUNING.desktop;
    const label = (choiceUi.inner.textContent ?? "").trim() || "ตัวเลือก";
    const hasImage = !!choiceUi.image;
    const hasSound = !!choiceUi.soundKey && !!choiceUi.volumeBtn;
    const hasText = label.length > 0;

    const circleSize = this.scaleGsqChoiceCircleSize(
      px(hasImage ? (mobile ? 34 : 40) : mobile ? 40 : 46)
    );
    const circleGap = px(hasImage ? (mobile ? 4 : 6) : mobile ? 10 : 12);
    const circleOverlap = hasImage ? Math.round(circleSize * 0.16) : 0;
    const groupLeftX = -cellW / 2;
    const circleCenterX = groupLeftX + circleSize / 2;
    const soundLeadGap = hasSound && hasImage ? Math.round(tc.speakerSize * 0.2) : 0;
    const contentLeftX = groupLeftX + circleSize - circleOverlap + circleGap + soundLeadGap;
    const contentW = Math.max(px(40), cellW - (contentLeftX - groupLeftX) - px(2));

    choiceUi.container.setData("circleSize", circleSize);

    const pillH = hasImage ? tc.pillHImage : tc.pillH;

    let overlay: GsqChoiceOverlayLayout;
    let hitLeft = groupLeftX;
    let hitW = cellW;
    let hitTop = -rowH / 2;
    let hitBottom = rowH / 2;
    let pillW = 0;
    let fontPx: number = tc.fontBase;
    const showTextPill = !hasImage || hasText;

    if (hasImage) {
      const tex = choiceUi.image?.texture.getSourceImage() as { width?: number; height?: number } | undefined;
      const texW = tex?.width;
      const texH = tex?.height;
      const { frameW, frameH, frameCenterY, frameBottom, frameTop } = resolveGsqChoiceImageFrameLayout(
        contentW,
        rowH,
        pillH,
        tc.speakerSize,
        mobile ? Math.min(tc.imageFrameSize, 82) : tc.imageFrameSize,
        px,
        hasText,
        hasSound
      );
      const frameCenterX = contentLeftX + frameW / 2;

      const maxPillW = hasText
        ? hasSound
          ? Math.max(tc.pillMinW, Math.min(contentW, frameW + tc.speakerSize * 0.15))
          : Math.max(tc.pillMinW, Math.min(contentW, frameW))
        : tc.pillMinW;
      if (hasText) {
        const metrics = resolveGsqChoicePillMetrics(label, tc.pillMinW, maxPillW, {
          base: tc.fontBase,
          min: tc.fontMin,
          max: tc.fontMax,
        });
        pillW = metrics.pillW;
        fontPx = metrics.fontPx;
      }

      const pillAnchorY = hasText ? frameBottom : frameCenterY;
      overlay = hasText
        ? computeGsqChoiceBottomOverlayLayout(pillAnchorY, tc.speakerSize, hasSound, pillW, pillH)
        : {
            speakerX: frameCenterX,
            speakerY: frameBottom,
            speakerSize: hasSound ? tc.speakerSize : 0,
            pillLeft: frameCenterX,
            pillTop: frameBottom,
            pillW: 0,
            pillH: 0,
            textCenterX: frameCenterX,
            textCenterY: frameBottom,
          };
      if (hasText) {
        overlay = {
          ...overlay,
          pillLeft: overlay.pillLeft + frameCenterX,
          textCenterX: overlay.textCenterX + frameCenterX,
          speakerX: hasSound ? overlay.speakerX + frameCenterX : 0,
        };
      } else if (hasSound) {
        overlay = {
          ...overlay,
          speakerX: frameCenterX,
          speakerY: frameBottom,
        };
      }

      choiceUi.circleBg.setPosition(circleCenterX, pillAnchorY);
      choiceUi.letterText.setPosition(circleCenterX, pillAnchorY);

      if (!choiceUi.imageFrame) {
        choiceUi.imageFrame = this.add.graphics().setDepth(1200);
        choiceUi.container.add(choiceUi.imageFrame);
      }
      choiceUi.imageFrame.clear();
      choiceUi.imageFrame.setPosition(frameCenterX, frameCenterY);
      choiceUi.imageFrame.setVisible(true);
      drawQuestionMediaFrameBox(choiceUi.imageFrame, frameW, frameH, 1);

      if (choiceUi.image) {
        const fit = fitQuestionMediaContainSize(
          texW ?? 1,
          texH ?? 1,
          frameW - px(10),
          frameH - px(10)
        );
        choiceUi.image.setDisplaySize(fit.imageW, fit.imageH);
        choiceUi.image.setPosition(frameCenterX, frameCenterY);
        choiceUi.image.setVisible(true);
        choiceUi.image.setDepth(1200);
      }

      hitTop = frameTop;
      hitBottom = hasText ? overlay.pillTop + pillH : frameBottom + (hasSound ? tc.speakerSize / 2 : 0);
      hitLeft = Math.min(circleCenterX - circleSize / 2, hasText ? overlay.pillLeft : frameCenterX - frameW / 2);
      hitW = Math.max(
        cellW,
        frameCenterX + frameW / 2 - hitLeft,
        hasText
          ? overlay.pillLeft + pillW + (hasSound ? tc.speakerSize * 0.35 : 0) - hitLeft
          : frameCenterX + frameW / 2 - hitLeft
      );
    } else {
      const maxPillW = hasSound
        ? Math.max(tc.pillMinW, contentW - tc.speakerSize * 0.55)
        : contentW;
      const metrics = resolveGsqChoicePillMetrics(label, tc.pillMinW, maxPillW, {
        base: tc.fontBase,
        min: tc.fontMin,
        max: tc.fontMax,
      });
      pillW = metrics.pillW;
      fontPx = metrics.fontPx;

      const base = computeGsqChoiceInlineLayout(pillW, pillH, tc.speakerSize, 0, hasSound);
      if (hasSound) {
        const pillLeft = contentLeftX + tc.speakerSize - tc.speakerSize * 0.35;
        overlay = {
          ...base,
          pillLeft,
          textCenterX: pillLeft + pillW / 2,
          speakerX: contentLeftX + tc.speakerSize / 2,
        };
      } else {
        overlay = {
          ...base,
          pillLeft: contentLeftX,
          textCenterX: contentLeftX + pillW / 2,
        };
      }

      choiceUi.circleBg.setPosition(circleCenterX, 0);
      choiceUi.letterText.setPosition(circleCenterX, 0);

      choiceUi.imageFrame?.setVisible(false);
      choiceUi.image?.setVisible(false);

      hitLeft = Math.min(circleCenterX - circleSize / 2, overlay.pillLeft);
      hitW = Math.max(
        cellW,
        overlay.pillLeft + pillW + (hasSound ? tc.speakerSize * 0.35 : 0) - hitLeft
      );
      hitTop = overlay.pillTop;
      hitBottom = overlay.pillTop + pillH;
    }

    choiceUi.pillW = pillW;
    choiceUi.pillH = pillH;
    choiceUi.width = pillW;
    choiceUi.height = pillH;

    if (showTextPill) {
      choiceUi.bg.setVisible(true);
      choiceUi.bg.setDepth(1202);
      choiceUi.bg.setPosition(overlay.pillLeft + pillW / 2, overlay.pillTop + pillH / 2);
      this.drawChoiceBackground(choiceUi);

      const textBoxW = Math.max(1, pillW - tc.pillPadX * 2 - (hasSound ? tc.speakerSize * 0.42 : 0));
      const div = createThaiTextElement(hasText ? label : "ตัวเลือก", {
        width: Math.floor(textBoxW),
        height: Math.floor(pillH),
        fontSize: `${fontPx}px`,
        color: "#4E4E4E",
        align: "center",
        padding: 0,
        maxLines: hasImage ? 2 : 1,
        minFontSizePx: tc.fontMin,
      });
      const inner = div.firstElementChild as HTMLElement | null;
      if (inner) {
        inner.style.fontWeight = "800";
        inner.style.lineHeight = "1.35";
        inner.style.width = "100%";
        inner.style.position = "absolute";
        inner.style.left = "0";
        inner.style.right = "0";
        inner.style.top = "50%";
        inner.style.transform = "translateY(-50%)";
      }
      div.style.setProperty("position", "relative", "important");
      div.style.setProperty("display", "block", "important");
      div.style.setProperty("height", `${Math.floor(pillH)}px`, "important");
      choiceUi.container.remove(choiceUi.dom, true);
      const dom = this.add.dom(overlay.textCenterX, overlay.textCenterY, div).setOrigin(0.5, 0.5);
      dom.setDepth(1203);
      this.disableGsqChoiceDomPointer(dom);
      choiceUi.dom = dom;
      choiceUi.inner = inner ?? choiceUi.inner;
      choiceUi.container.add(dom);
      dom.setVisible(true);
    } else {
      choiceUi.bg.clear();
      choiceUi.bg.setVisible(false);
      choiceUi.dom.setVisible(false);
      this.drawChoiceBackground(choiceUi);
    }

    this.layoutGsqChoiceVolumeBtn(
      choiceUi,
      overlay.speakerX,
      overlay.speakerY,
      hasSound ? tc.speakerSize : 0
    );

    const hitH = Math.max(1, hitBottom - hitTop);
    this.syncGsqChoiceHitArea(choiceUi, hitLeft, hitTop + hitH / 2, hitW, hitH);
    choiceUi.imageFrame?.setDepth(1199);
    choiceUi.image?.setDepth(1200);
    choiceUi.bg.setDepth(1202);
    choiceUi.dom.setDepth(1203);
    choiceUi.pickZone.setDepth(1204);
    choiceUi.container.bringToTop(choiceUi.bg);
    choiceUi.container.bringToTop(choiceUi.dom);
    choiceUi.container.bringToTop(choiceUi.letterText);
    if (choiceUi.volumeBtn?.visible) choiceUi.container.bringToTop(choiceUi.volumeBtn);
  }

  private layoutGsqDesktopChoices(
    col2CenterX: number,
    quizContentW: number,
    questionY: number,
    questionBoxH: number,
    panelTop: number,
    panelHeight: number,
    padY: number,
    ds: HudScaleCtx
  ) {
    const choiceCount = this.choiceUIs.length;
    if (choiceCount === 0) return;

    const gridGapX = Math.max(ds.px(12), Math.round(ds.px(22) * GSQ_CHOICE_GRID_GAP_SCALE));
    const gridGapY = Math.max(ds.px(8), Math.round(ds.px(12) * GSQ_CHOICE_GRID_GAP_SCALE));
    const gridTotalW = Math.max(1, Math.round(quizContentW * (1 - (1 - GSQ_CHOICE_GRID_GAP_SCALE) * 0.5)));
    const cellW = Math.max(1, (gridTotalW - gridGapX) / 2);
    const gridLeftX = col2CenterX - gridTotalW / 2;
    const rows = Math.max(1, Math.ceil(choiceCount / 2));
    const hasImageChoices = this.choiceUIs.some((c) => !!c.image);
    const topGap = hasImageChoices ? ds.px(24) : ds.px(28);
    const gridTop = questionY + questionBoxH / 2 + topGap;
    const bubbleReserve = this.getGsqChoicesBottomReservePx();
    const { height } = this.scale;
    const gridBottom = Math.min(panelTop + panelHeight - padY - bubbleReserve, height - bubbleReserve);
    const textRowH = ds.px(72);
    const imageRowH = ds.px(220);

    const rowHeights: number[] = new Array(rows).fill(textRowH);
    this.choiceUIs.forEach((choiceUi, i) => {
      if (!choiceUi.image) return;
      const rowIndex = Math.floor(i / 2);
      rowHeights[rowIndex] = Math.max(rowHeights[rowIndex] ?? textRowH, imageRowH);
    });

    let totalGridH =
      rowHeights.reduce((sum, h) => sum + h, 0) + gridGapY * Math.max(0, rows - 1);
    const availH = Math.max(1, gridBottom - gridTop);
    if (totalGridH > availH) {
      const scaleDown = availH / totalGridH;
      for (let r = 0; r < rowHeights.length; r += 1) {
        rowHeights[r] = Math.max(ds.px(56), Math.round(rowHeights[r] * scaleDown));
      }
    }

    const rowCenters: number[] = [];
    let accTop = gridTop;
    for (let r = 0; r < rows; r += 1) {
      const rowH = rowHeights[r] ?? textRowH;
      rowCenters[r] = accTop + rowH / 2;
      accTop += rowH + gridGapY;
    }

    this.choiceUIs.forEach((choiceUi, i) => {
      const col = i % 2;
      const rowIndex = Math.floor(i / 2);
      const rowH = rowHeights[rowIndex] ?? textRowH;
      const x = gridLeftX + cellW / 2 + col * (cellW + gridGapX);
      const y = rowCenters[rowIndex] ?? gridTop + rowH / 2;

      choiceUi.container.setPosition(x, y);
      choiceUi.container.setData("choiceFxBaseX", x);
      choiceUi.container.setData("choiceFxBaseY", y);
      this.ensureChoiceButtonFx(choiceUi);
      this.layoutGsqChoiceCard(choiceUi, cellW, rowH, { mobile: false, px: ds.px.bind(ds) });
      choiceUi.container.setData("choiceFxBaseScaleX", choiceUi.container.scaleX);
      choiceUi.container.setData("choiceFxBaseScaleY", choiceUi.container.scaleY);
      this.resetGsqChoiceContainerHover(choiceUi);
    });
  }

  private measureThaiLineCount(text: string, widthPx: number, fontSizePx: number, lineHeight: number) {
    if (typeof document === "undefined") return 1;
    const el = document.createElement("div");
    el.textContent = text;
    el.style.position = "fixed";
    el.style.left = "-9999px";
    el.style.top = "0";
    el.style.visibility = "hidden";
    el.style.boxSizing = "border-box";
    el.style.margin = "0";
    el.style.padding = "0";
    el.style.width = `${Math.max(1, Math.floor(widthPx))}px`;
    el.style.fontFamily = '"Noto Sans Thai",sans-serif';
    el.style.fontSize = `${fontSizePx}px`;
    el.style.lineHeight = String(lineHeight);
    el.style.wordWrap = "break-word";
    el.style.overflowWrap = "break-word";
    document.body.appendChild(el);
    const h = el.scrollHeight;
    document.body.removeChild(el);
    const lhPx = Math.max(1, fontSizePx * lineHeight);
    return Phaser.Math.Clamp(Math.round((h + 1) / lhPx), 1, 5);
  }

  private bindGsqChoiceVolumeBtn(btn: Phaser.GameObjects.Image, soundKey: string) {
    if (btn.getData("gsqVolumeBound")) return;
    btn.setData("gsqVolumeBound", true);
    btn.on("pointerdown", (pointer: Phaser.Input.Pointer, _lx: number, _ly: number, event?: Event) => {
      event?.stopPropagation();
      (pointer.event as Event | undefined)?.stopPropagation?.();
      this.playChoiceAudio(soundKey, 1);
    });
  }

  private resetAllGsqChoiceHovers() {
    this.choiceUIs.forEach((choiceUi) => this.resetGsqChoiceContainerHover(choiceUi));
  }

  private resetGsqChoiceContainerHover(choiceUi?: ChoiceRowUI) {
    if (!choiceUi) return;
    const container = choiceUi.container;
    container.setData("choiceFxHovering", false);
    const baseX = container.getData("choiceFxBaseScaleX");
    const baseY = container.getData("choiceFxBaseScaleY");
    const sx = typeof baseX === "number" ? baseX : container.scaleX;
    const sy = typeof baseY === "number" ? baseY : container.scaleY;
    this.tweens.killTweensOf(container);
    container.setScale(sx, sy);
  }

  private refreshGsqSpeakerBtnFxBase(btn: Phaser.GameObjects.Image) {
    btn.setData("btnFxBaseScaleX", btn.scaleX);
    btn.setData("btnFxBaseScaleY", btn.scaleY);
  }

  private ensureGsqSpeakerBtnFx(btn: Phaser.GameObjects.Image, choiceUi?: ChoiceRowUI) {
    btn.setTexture(HUD_VOLUME_TEXTURE_KEY);
    btn.setData("gsqSpeakerChoiceUi", choiceUi);
    this.refreshGsqSpeakerBtnFxBase(btn);

    if (btn.getData("gsqSpeakerFxBound")) return;
    btn.setData("gsqSpeakerFxBound", true);
    btn.setData("btnFxHovering", false);

    const animateScale = (scaleFactor: number) => {
      const baseX = btn.getData("btnFxBaseScaleX");
      const baseY = btn.getData("btnFxBaseScaleY");
      const sx = typeof baseX === "number" ? baseX : btn.scaleX;
      const sy = typeof baseY === "number" ? baseY : btn.scaleY;
      this.tweens.killTweensOf(btn);
      this.tweens.add({
        targets: btn,
        scaleX: sx * scaleFactor,
        scaleY: sy * scaleFactor,
        duration: 120,
        ease: "Sine.easeOut",
      });
    };

    const linkedChoiceUi = () => btn.getData("gsqSpeakerChoiceUi") as ChoiceRowUI | undefined;

    btn.on("pointerover", (_pointer: Phaser.Input.Pointer, _lx: number, _ly: number, event?: Event) => {
      event?.stopPropagation();
      this.resetGsqChoiceContainerHover(linkedChoiceUi());
      btn.setData("btnFxHovering", true);
      animateScale(1.12);
    });

    btn.on("pointerout", (_pointer: Phaser.Input.Pointer, _lx: number, _ly: number, event?: Event) => {
      event?.stopPropagation();
      btn.setData("btnFxHovering", false);
      animateScale(1);
    });

    btn.on("pointerdown", (_pointer: Phaser.Input.Pointer, _lx: number, _ly: number, event?: Event) => {
      event?.stopPropagation();
      animateScale(1.06);
    });

    btn.on("pointerup", (_pointer: Phaser.Input.Pointer, _lx: number, _ly: number, event?: Event) => {
      event?.stopPropagation();
      const hovering = !!btn.getData("btnFxHovering");
      animateScale(hovering ? 1.12 : 1);
    });
  }

  private disableGsqChoiceDomPointer(dom: Phaser.GameObjects.DOMElement) {
    dom.pointerEvents = "none";
    dom.disableInteractive();
    const node = dom.node as HTMLElement | null;
    if (node) node.style.pointerEvents = "none";
  }

  /** hit area เฉพาะวงกลม+กรอบตัวเลือก — ไม่รวมลำโพงด้านนอก */
  private syncGsqChoiceHitArea(
    choiceUi: ChoiceRowUI,
    hitLeft: number,
    hitCenterY: number,
    hitW: number,
    hitH: number
  ) {
    const w = Math.max(1, hitW);
    const h = Math.max(1, hitH);
    const zone = choiceUi.pickZone;
    zone.setPosition(hitLeft + w / 2, hitCenterY);
    zone.setSize(w, h);
    choiceUi.container.disableInteractive();
    zone.removeInteractive();
    this.syncGsqChoicePickZoneInteractivity(choiceUi);
  }

  private syncGsqChoicePickZoneInteractivity(choiceUi: ChoiceRowUI) {
    const zone = choiceUi.pickZone;
    if (choiceUi.disabled || choiceUi.eliminated || this.lockInput || !this.input.enabled) {
      zone.disableInteractive();
      this.resetGsqChoiceContainerHover(choiceUi);
      return;
    }
    zone.setInteractive({ useHandCursor: true });
    if (zone.input) zone.input.cursor = "pointer";
  }

  private layoutGsqChoiceVolumeBtn(
    choiceUi: ChoiceRowUI,
    iconCenterX: number,
    iconCenterY: number,
    iconSize: number
  ) {
    const btn = choiceUi.volumeBtn;
    if (!btn) return;
    if (!choiceUi.soundKey) {
      btn.setVisible(false);
      btn.disableInteractive();
      return;
    }
    btn.setVisible(true);
    const src = btn.texture.getSourceImage() as { width: number; height: number };
    const srcW = src.width || 1;
    const srcH = src.height || 1;
    const ratio = Math.min(iconSize / srcW, iconSize / srcH);
    btn.setPosition(iconCenterX, iconCenterY);
    btn.setDisplaySize(Math.max(1, srcW * ratio), Math.max(1, srcH * ratio));
    btn.setDepth(1204);
    if (!choiceUi.disabled && !choiceUi.eliminated) {
      btn.setInteractive({ useHandCursor: true });
      btn.setAlpha(1);
    } else {
      btn.disableInteractive();
      btn.setAlpha(0.45);
    }
    this.ensureGsqSpeakerBtnFx(btn, choiceUi);
    choiceUi.container.bringToTop(btn);
  }

  private scaleGsqChoiceCircleSize(baseSize: number): number {
    return Math.round(baseSize * 1.3);
  }

  private drawGsqChoiceLetterCircle(
    g: Phaser.GameObjects.Graphics,
    circleSize: number,
    state: "normal" | "correct" | "wrong" | "disabled"
  ) {
    const r = circleSize / 2;
    const circleFill =
      state === "correct" ? 0x1B8F2A : state === "wrong" ? 0xD01F1F : state === "disabled" ? 0xB0B0B0 : 0xF6E748;
    const ringColor =
      state === "correct" ? 0x0F6B1A : state === "wrong" ? 0x9A1717 : state === "disabled" ? 0x8A8A8A : 0xE5C12E;
    const ringW = Math.max(2, Math.round(r * 0.08));

    g.clear();
    if (state === "normal") {
      g.fillStyle(0xD4A800, 0.18);
      g.fillCircle(0, 2, r + 1);
      g.fillStyle(0xFFE566, 1);
      g.fillCircle(0, 0, r);
      g.fillStyle(0xFFF08A, 1);
      g.fillCircle(0, -r * 0.12, r * 0.86);
    } else {
      g.fillStyle(circleFill, 1);
      g.fillCircle(0, 0, r);
      if (state !== "disabled") {
        g.fillStyle(0xffffff, 0.18);
        g.fillCircle(0, -r * 0.18, r * 0.55);
      }
    }

    g.lineStyle(ringW, ringColor, state === "disabled" ? 0.85 : 1);
    g.strokeCircle(0, 0, r - ringW / 2);
  }

  private styleGsqChoiceLetterText(
    text: Phaser.GameObjects.Text,
    fontSizePx: number,
    disabled: boolean
  ) {
    text.setFontSize(fontSizePx);
    if (disabled) {
      text.setColor("#ECECEC");
      text.setStroke("#9A9A9A", Math.max(2, Math.round(fontSizePx * 0.06)));
      text.setShadow(0, 1, "#B0B0B0", 0, true, true);
      return;
    }
    text.setColor(GSQ_CHOICE_LETTER_COLOR);
    const strokeW = Math.max(2, Math.round(fontSizePx * 0.08));
    text.setStroke("#FFFFFF", strokeW);
    text.setShadow(0, 2, "rgba(0, 80, 140, 0.28)", 2, true, true);
  }

  private drawChoiceBackground(ui: ChoiceRowUI, forcedState?: "normal" | "correct" | "wrong" | "disabled") {
    const state = forcedState ?? (ui.eliminated || ui.disabled ? "disabled" : "normal");
    const w = Math.max(0, ui.pillW || ui.width || 0);
    const h = Math.max(0, ui.pillH || ui.height || 0);
    const radius = Math.min(this.mobile ? 10 : 12, h / 2);
    ui.bg.clear();

    if (state === "normal" && w > 0 && h > 0) {
      drawQuestionMediaOverlayTextPill(ui.bg, -w / 2, -h / 2, w, h, radius, this.mobile ? 2 : 3);
    } else if (w > 0 && h > 0) {
      const boxFill =
        state === "correct" ? 0xD7F5DD : state === "wrong" ? 0xFFE0E0 : 0xF2F2F2;
      const boxStroke =
        state === "correct" ? 0x1B8F2A : state === "wrong" ? 0xD01F1F : 0xB0B0B0;
      ui.bg.fillStyle(boxFill, 1);
      ui.bg.fillRoundedRect(-w / 2, -h / 2, w, h, radius);
      ui.bg.lineStyle(state === "disabled" ? 2 : 3, boxStroke, 1);
      ui.bg.strokeRoundedRect(-w / 2, -h / 2, w, h, radius);
    }

    const circleSize = Number(ui.container.getData("circleSize")) || 0;
    if (circleSize > 0) {
      this.drawGsqChoiceLetterCircle(ui.circleBg, circleSize, state);

      const letterFontPx = Math.max(18, Math.round(circleSize * 0.5));
      this.styleGsqChoiceLetterText(ui.letterText, letterFontPx, state === "disabled");
      ui.container.bringToTop(ui.letterText);
    }
  }

  private isValidSoundPath(pathOrUrl?: string | null): boolean {
    const raw = String(pathOrUrl ?? "").trim();
    if (!raw) return false;
    const normalized = raw.toLowerCase();
    return normalized !== "null" && normalized !== "undefined";
  }

  private getSoundKeyForPath(pathOrUrl?: string | null): string | null {
    if (!this.isValidSoundPath(pathOrUrl)) return null;
    const url = this.resolveSoundUrl(String(pathOrUrl).trim());
    if (!url) return null;
    const key = this.soundKeyByUrl.get(url);
    if (key && this.cache.audio.exists(key)) return key;
    return null;
  }

  private getImageKeyForPath(pathOrUrl: string): string | null {
    const raw = (pathOrUrl ?? "").trim();
    if (!raw) return null;
    const url = this.resolveImageUrl(raw);
    const key = this.imageKeyByUrl.get(url);
    if (key && this.textures.exists(key)) return key;
    return null;
  }

  private destroyStatsHudPills() {
    this.gsqQuestionProgress?.bg.destroy();
    this.gsqQuestionProgress?.text.destroy();
    this.gsqQuestionProgress = undefined;
    this.scoreUI?.bg.destroy();
    this.scoreUI?.labelText.destroy();
    this.scoreUI?.text.destroy();
    this.scoreUI = undefined;
    this.livesUI?.bg.destroy();
    this.livesUI?.hearts.forEach((heart) => heart.destroy());
    this.livesUI = undefined;
  }

  private destroyStatsHud() {
    this.destroyStatsHudPills();
    this.timeUI?.bg.destroy();
    this.timeUI?.labelIcon.destroy();
    this.timeUI?.text.destroy();
    this.timeUI = undefined;
    this.statsHudContainer?.destroy(true);
    this.statsHudContainer = undefined;
  }

  private ensureStatsHudContainer(): Phaser.GameObjects.Container {
    if (this.statsHudContainer) return this.statsHudContainer;
    const container = this.add.container(0, -150).setDepth(3100);
    this.statsHudContainer = container;
    const onResize = () => this.layoutGsqHudStats();
    this.scale.on(Phaser.Scale.Events.RESIZE, onResize);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, onResize);
    });
    this.tweens.add({
      targets: container,
      y: 0,
      duration: 600,
      ease: "Back.easeOut",
      easeParams: [3.5],
    });
    return container;
  }

  private getGsqHudLayout() {
    const { width, height } = this.scale;
    const ui = createHudScaleCtx(width, height, this.mobile);
    const metrics = getGameHudRowMetrics({
      mobile: this.mobile,
      width,
      height,
      px: ui.px.bind(ui),
      maxLives: GSQ_HUD_MAX_LIVES,
      hasProgress: true,
      hasLives: true,
    });
    const slots = getGameHudPillSlots(0, 0, width, metrics, {
      hasProgress: true,
      hasLives: true,
      mobile: this.mobile,
    });
    return { ui, metrics, slots };
  }

  private layoutGsqHudStats() {
    const { ui, metrics, slots } = this.getGsqHudLayout();
    const rowY = slots.rowY;
    const labelPad = ui.px(this.mobile ? 12 : 18);
    const valuePad = ui.px(this.mobile ? 12 : 18);
    const heartSize = ui.px(this.mobile ? 22 : 28);
    const heartGap = ui.px(this.mobile ? 2 : 4);
    const livesPadLeft = ui.px(this.mobile ? 12 : 16);

    if (this.timeUI) {
      layoutPhaserTimeValuePill({
        scene: this,
        bg: this.timeUI.bg,
        icon: this.timeUI.labelIcon,
        value: this.timeUI.text,
        cx: slots.timeCx,
        cy: rowY,
        pillW: metrics.timeW,
        pillH: metrics.pillH,
        valueText: this.formatElapsedSeconds(this.getHudElapsedSeconds()),
        labelPadLeft: labelPad,
        valuePadRight: valuePad,
        iconSize: getHudTimeIconSize(this.mobile, ui.px.bind(ui)),
        fontDigits: metrics.fontDigits,
      });
    }

    if (this.scoreUI) {
      layoutPhaserLabelValuePill({
        scene: this,
        bg: this.scoreUI.bg,
        label: this.scoreUI.labelText,
        value: this.scoreUI.text,
        cx: slots.scoreCx,
        cy: rowY,
        pillW: metrics.scoreW,
        pillH: metrics.pillH,
        labelText: "คะแนน",
        valueText: String(this.score),
        labelPadLeft: labelPad,
        valuePadRight: valuePad,
        fontLabel: metrics.fontLabel,
        fontDigits: metrics.fontDigits,
      });
    }

    if (this.livesUI && slots.livesCx != null) {
      layoutPhaserHeartsPill({
        bg: this.livesUI.bg,
        hearts: this.livesUI.hearts,
        cx: slots.livesCx,
        cy: rowY,
        pillW: metrics.livesW,
        pillH: metrics.pillH,
        heartSize,
        heartGap,
        padLeft: livesPadLeft,
      });
    }

    if (this.gsqQuestionProgress) {
      layoutPhaserQuestionProgressAtSlot({
        scene: this,
        hud: this.gsqQuestionProgress,
        slots,
        metrics,
        label: this.getGsqQuestionProgressLabel(),
      });
    }
  }

  private createHeartsHud() {
    this.destroyStatsHudPills();
    const { width, height } = this.scale;
    const ui = createHudScaleCtx(width, height, this.mobile);
    const metrics = getGameHudRowMetrics({
      mobile: this.mobile,
      width,
      height,
      px: ui.px.bind(ui),
      maxLives: GSQ_HUD_MAX_LIVES,
      hasProgress: true,
      hasLives: true,
    });
    const container = this.ensureStatsHudContainer();
    const hudTextRes = Math.min(3, typeof window !== "undefined" ? window.devicePixelRatio || 2 : 2);

    const scoreBg = this.add.image(0, 0, BG_HUD_TEXTURE_KEY).setOrigin(0.5);
    const scoreLabel = this.add
      .text(0, 0, "คะแนน", { font: metrics.fontLabel, color: HUD_LABEL_COLOR })
      .setOrigin(0, 0.5)
      .setResolution(hudTextRes);
    const scoreText = this.add
      .text(0, 0, String(this.score), {
        font: metrics.fontDigits,
        color: HUD_VALUE_COLOR,
      })
      .setOrigin(1, 0.5)
      .setResolution(hudTextRes);
    container.add([scoreBg, scoreLabel, scoreText]);
    this.scoreUI = { bg: scoreBg, labelText: scoreLabel, text: scoreText };

    const livesBg = this.add.image(0, 0, BG_HUD_TEXTURE_KEY).setOrigin(0.5);
    container.add(livesBg);
    const hearts: Phaser.GameObjects.Image[] = [];
    for (let i = 0; i < GSQ_HUD_MAX_LIVES; i += 1) {
      const heart = this.add.image(0, 0, "gsq_heart_icon").setOrigin(0.5);
      hearts.push(heart);
      container.add(heart);
    }
    this.livesUI = { bg: livesBg, hearts };

    this.gsqQuestionProgress = createPhaserQuestionProgressHud(this, 3101, {
      mobile: this.mobile,
      width,
      px: ui.px.bind(ui),
      resolution: hudTextRes,
    });
    container.add(this.gsqQuestionProgress.bg);
    container.add(this.gsqQuestionProgress.text);

    this.layoutHearts();
    this.refreshGsqHudHearts();
  }

  private layoutHearts() {
    this.layoutGsqHudStats();
  }

  private getGsqQuestionProgressLabel(): string {
    const total = this.numberOfQuestions || this.questions.length || this.totalQuestions || 0;
    if (total <= 0) return "";
    return getQuestionProgressLabel(total, { questionIndex0: this.currentQuestionIndex });
  }

  private refreshGsqQuestionProgressHud() {
    this.layoutGsqHudStats();
  }

  private refreshGsqHudHearts() {
    if (!this.livesUI) return;
    for (let i = 0; i < this.livesUI.hearts.length; i += 1) {
      const alive = i < this.gsqHudLives;
      this.livesUI.hearts[i]?.setAlpha(alive ? 1 : 0.25);
    }
    this.scoreUI?.text.setText(String(this.score));
    this.refreshGsqQuestionProgressHud();
  }

  private createTimeContainer() {
    const container = this.ensureStatsHudContainer();
    const { width, height } = this.scale;
    const ui = createHudScaleCtx(width, height, this.mobile);
    const metrics = getGameHudRowMetrics({
      mobile: this.mobile,
      width,
      height,
      px: ui.px.bind(ui),
      maxLives: GSQ_HUD_MAX_LIVES,
      hasProgress: true,
      hasLives: true,
    });
    const hudTextRes = Math.min(3, typeof window !== "undefined" ? window.devicePixelRatio || 2 : 2);
    const bg = this.add.image(0, 0, BG_HUD_TEXTURE_KEY).setOrigin(0.5);
    const labelIcon = this.add
      .image(0, 0, HUD_HOURGLASS_TEXTURE_KEY)
      .setOrigin(0.5);
    const digitsText = this.add
      .text(0, 0, "00:00", { font: metrics.fontDigits, color: HUD_VALUE_COLOR })
      .setOrigin(1, 0.5)
      .setResolution(hudTextRes);
    container.add([bg, labelIcon, digitsText]);
    this.timeUI = { bg, labelIcon, text: digitsText };
    this.layoutTime();
    this.updateHud();
  }

  private layoutTime() {
    this.layoutGsqHudStats();
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
    if (this.timeUI) {
      this.timeUI.text.setText(this.formatElapsedSeconds(elapsed));
    }
    if (this.scoreUI) {
      this.scoreUI.text.setText(String(this.score));
    }
    this.layoutGsqHudStats();
  }

  private getHudElapsedSeconds() {
    if (this.frozenHudElapsedSec != null) return this.frozenHudElapsedSec;
    const base = this.hudElapsedAccumSec;
    if (!this.hudStarted) return base;
    return base + (Date.now() - this.hudStartMs) / 1000;
  }

  private pauseHudTime() {
    if (this.frozenHudElapsedSec != null) return;
    if (!this.hudStarted) return;
    this.hudElapsedAccumSec += (Date.now() - this.hudStartMs) / 1000;
    this.hudStarted = false;
    this.updateHud();
  }

  private resumeHudTime() {
    if (this.frozenHudElapsedSec != null) return;
    if (this.hudStarted) return;
    this.hudStartMs = Date.now();
    this.hudStarted = true;
    this.updateHud();
  }

  private freezeHudTime() {
    if (this.frozenHudElapsedSec != null) return;
    if (this.hudStarted) this.hudElapsedAccumSec += (Date.now() - this.hudStartMs) / 1000;
    this.frozenHudElapsedSec = this.hudElapsedAccumSec;
    this.hudStarted = false;
    this.updateHud();
  }

  private formatElapsedSeconds(seconds: number) {
    const safe = Math.max(0, Math.floor(seconds));
    const mm = Math.floor(safe / 60);
    const ss = safe % 60;
    return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
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

    if (canShowMessage && !this.idleNoScoreMessageShown && this.lastScoreChangeMs > 0 && now - this.lastScoreChangeMs >= 8_000) {
      this.idleNoScoreMessageShown = true;
      this.showRandomMessage(this.messagePools.idle, 2200, "point");
    }
  }

  private triggerTimeUiMilestone(sec: number) {
    if (!this.timeUI) return;

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
    if (!this.timeUI) return;

    this.timeFlashEvent?.destroy();
    this.timeFlashEvent = undefined;
    this.tweens.killTweensOf(this.timeUI.text);
    this.tweens.killTweensOf(this.timeUI.labelIcon);

    this.timeUI.text.setAlpha(0.35);
    this.timeUI.labelIcon.setAlpha(0.35);
    this.timeRedLoopActive = loop;
    const seq = (this.timeFlashSeq += 1);

    const flashCss = this.colorToCss(color);
    this.timeUI.text.setColor(flashCss);
    this.timeUI.labelIcon.setTint(color);

    const duration = loop ? 260 : 140;
    const safeFlashes = Math.max(1, Math.floor(flashes));
    const repeat = loop ? -1 : safeFlashes * 2 - 2;

    const pulse = () => {
      if (seq !== this.timeFlashSeq || !this.timeUI) return;
      const next = this.timeUI.text.alpha < 0.9 ? 1 : 0.35;
      this.timeUI.text.setAlpha(next);
      this.timeUI.labelIcon.setAlpha(next);
    };

    this.timeFlashEvent = this.time.addEvent({
      delay: duration,
      loop,
      repeat: loop ? 0 : repeat,
      callback: pulse,
    });

    if (loop) return;

    const totalMs = duration * (repeat + 1) + 40;
    this.time.delayedCall(totalMs, () => {
      if (seq !== this.timeFlashSeq) return;
      if (!this.timeUI) return;
      if (!this.timeRedLoopActive) {
        this.timeUI.text.setAlpha(1);
        this.timeUI.text.setColor(HUD_VALUE_COLOR);
        this.timeUI.labelIcon.setAlpha(1);
        this.timeUI.labelIcon.clearTint();
      }
      this.timeFlashEvent?.destroy();
      this.timeFlashEvent = undefined;
    });
  }
  
  private colorToCss(value: number) {
    const safe = Math.max(0, Math.min(0xffffff, Math.floor(value)));
    return `#${safe.toString(16).padStart(6, "0")}`;
  }
  
  private createTeacherHintUI() {
    if (this.teacherHintUI) return;
    this.teacherHintUI = new TeacherHintUI(this, {
      mobile: this.mobile,
      depth: 1400,
      messageDepth: 1500,
      // Keep the teacher present without covering the lower-left answer on the
      // compact two-row mobile choice grid.
      smallHeightRatioMobile: 0.17,
      bottomMarginMobile: -8,
      onNotificationSfx: () => this.playSfx("sfx_notification_message", 1),
    });
    this.teacherHintUI.create("standby", true);
  }

  private hasGameShowQuizQuestionHint(q: QuizQuestionState): boolean {
    const hint = (q.hint ?? "").trim();
    const imgKey = this.getImageKeyForPath(q.image_hint);
    return !!(hint || (imgKey && this.textures.exists(imgKey)));
  }

  private playGameShowQuizHintSound(q: QuizQuestionState) {
    const sh = this.getSoundKeyForPath(q.sound_hint);
    const sq = this.getSoundKeyForPath(q.sound_question);
    if (!sh || (sq && sh === sq)) return;
    this.playQuestionAudio(sh, 1);
  }

  private showGameShowQuizQuestionHint(q: QuizQuestionState) {
    if (!this.teacherHintUI) this.createTeacherHintUI();
    const hint = (q.hint ?? "").trim();
    const imgKey = this.getImageKeyForPath(q.image_hint);
    const imgReady = !!(imgKey && this.textures.exists(imgKey));
    if (!hint && !imgReady) return;

    this.playGameShowQuizHintSound(q);
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

  private openHowToPopup() {
    const { width, height } = this.scale;

    const restoreIntroDecor = () => {
      const decor = this.introDecor;
      if (!decor) return;
      decor.overlay.setVisible(true);
      decor.lawn.setVisible(true);
      decor.icon.setVisible(true);
      decor.flagLeft.setVisible(true);
      decor.flagRight.setVisible(true);
      decor.truck.setVisible(true);
      decor.tuktuk.setVisible(true);
    };

    const hideIntroDecor = () => {
      const decor = this.introDecor;
      if (!decor) return;
      decor.overlay.setVisible(false);
      decor.lawn.setVisible(false);
      decor.icon.setVisible(false);
      decor.flagLeft.setVisible(false);
      decor.flagRight.setVisible(false);
      decor.truck.setVisible(false);
      decor.tuktuk.setVisible(false);
    };

    const destroyPopup = () => {
      const popup = this.tutorialPopup;
      this.tutorialPopup = undefined;
      popup?.overlay?.destroy();
      popup?.title?.destroy();
      popup?.howtoplay.destroy();
      popup?.startButton.destroy();
      popup?.lawn?.destroy();
      if (popup) {
        this.input.enabled = popup.restoreInputEnabled;
        this.lockInput = popup.restoreLockInput;
      }
      this.input.setDefaultCursor("default");
      this.input.manager.canvas.style.cursor = "default";
      restoreIntroDecor();
    };

    if (this.tutorialPopup) destroyPopup();

    const restoreInputEnabled = this.input.enabled;
    const restoreLockInput = this.lockInput;
    this.input.enabled = true;
    this.lockInput = true;
    this.input.setDefaultCursor("default");
    this.input.manager.canvas.style.cursor = "default";
    hideIntroDecor();

    const fitTo = (key: string, maxW: number, maxH: number) => {
      const src = this.textures.get(key).getSourceImage() as { width?: number; height?: number };
      const w = src?.width ?? 1;
      const h = src?.height ?? 1;
      const s = Math.min(maxW / w, maxH / h);
      return { w: Math.max(1, w * s), h: Math.max(1, h * s) };
    };

    const overlay = this.add.rectangle(0, 0, width, height, 0x000000, 0.34)
      .setOrigin(0)
      .setDepth(3000);

    const lawn = this.add.rectangle(0, 0, width, this.mobile ? height * 0.6 : height * 0.6, 0xBDDA6D, 1)
      .setOrigin(0)
      .setDepth(3);
    
    lawn.setPosition(0, height * 0.4);

    let title: Phaser.GameObjects.Image | undefined;
    if (this.mobile) {
      const titleIconSize = fitTo("gsq_logo", width * 0.3, height * 0.25);
      title = this.add.image(width / 2, height / 10, "gsq_logo").setDepth(3001);
      title.setDisplaySize(titleIconSize.w, titleIconSize.h);
    }
      
    const howToMaxH = this.mobile ? height * 0.62 : height * 0.75;
    const howToMaxW = this.mobile ? width * 0.92 : width * 0.82;
    const howToSize = fitTo(this.mobile ? "gsq_howtoplay_mobile" : "gsq_howtoplay", howToMaxW, howToMaxH);
    const howToY = this.mobile ? height / 2 + height * 0.035 : height / 2 - Math.max(12, height * 0.03);
    const howtoplay = this.add.image(width / 2, howToY, this.mobile ? "gsq_howtoplay_mobile" : "gsq_howtoplay").setDepth(3003);
    howtoplay.setDisplaySize(howToSize.w, howToSize.h);
      
    const btnMaxW = Math.min(260, width * (0.40));
    const btnSize = fitTo("gsq_btn_start_tutorial", btnMaxW, height * 0.16);
    const btnY = Math.min(height - btnSize.h / 2 - 24, howToY + howToSize.h / 2 + btnSize.h / 2 + Math.max(14, height * 0.03));
    const startButton = this.add.image(width / 2, btnY - (this.mobile ? height * 0.05 : 0), "gsq_btn_start_tutorial").setDepth(3004);
    startButton.setDisplaySize(btnSize.w, btnSize.h);
    startButton.setInteractive({ useHandCursor: true });
    startButton.once("pointerdown", () => {
      this.playSfx("sfx_click_default", 1);
      startButton.disableInteractive();
      destroyPopup();
      if (this.scene.isActive("HomeScene")) this.scene.stop("HomeScene");
    });
      
    this.tutorialPopup = {
      overlay,
      lawn,
      title,
      howtoplay,
      startButton,
      restoreInputEnabled,
      restoreLockInput,
    };
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => destroyPopup());
  }
}
