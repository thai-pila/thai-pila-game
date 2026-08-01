import Phaser from "phaser";
import { API_BASE_URL } from "../../core/api";
import { BaseGameScene } from "../../core/scenes/BaseGameScene";
import {
  getGameHudPillSlots,
  getGameHudRowMetrics,
  getHudTimeIconSize,
  HUD_HOURGLASS_TEXTURE_KEY,
  HUD_LABEL_COLOR,
  HUD_VALUE_COLOR,
  HUD_VOLUME_TEXTURE_KEY,
  hasHudCenterLabel,
  getHudSuggestionLabel,
  layoutPhaserHudSuggestion,
  applyPhaserHudQuestionText,
  getHudCenterTextFont,
  getHudCenterTextMaxFontPx,
  HUD_QUESTION_TEXT_COLOR,
  layoutPhaserHeartsPill,
  layoutPhaserLabelValuePill,
  layoutPhaserTimeValuePill,
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
import { getHomeSceneButtonKeys, type HomeActionPayload } from "../../core/scenes/HomeScene";
import { TeacherHintUI } from "../../core/teacher/TeacherHintUI";
import type { TeacherState } from "../../core/teacher/TeacherAssistant";
import { createHudScaleCtx } from "../../utils/desktopUiScale";
import { isMobileLayout } from "../../utils/device";
import { coerceShuffleAnswer } from "../../utils/shuffleAnswer";
import { ensureNotoSansThaiLoopedReady } from "../../utils/notoThaiFont";
import {
  CHOCIE_CHOICE_TUNING,
  chocieThaiGameTextStyle,
  computeChocieChoiceBoxBottomOverlayLayout,
  computeChocieChoiceTextSoundLayout,
  getChocieInnerBottom,
  getChocieInnerCenterY,
  getChocieInnerWidth,
  resolveChocieChoiceImageFrameLayout,
  resolveChocieChoiceTextMetrics,
} from "../../utils/chocieChoiceLayout";
import {
  computeQuestionMediaLayout,
  drawQuestionMediaFrameBox,
  drawQuestionMediaOverlayTextPill,
  fitQuestionMediaContainSize,
  getQuestionMediaFrameRadius,
  getQuestionMediaCenterYBelowAnchor,
  getQuestionMediaFrameHalfH,
  getQuestionMediaFrameTargetW,
  resolveQuestionHudTextPillBox,
} from "../../utils/questionHudMedia";
import {
  canPlayGameAudio,
  GAME_BGM_VOLUME_FADE,
  guardedScenePlay,
  guardedScenePlayChoice,
  guardedScenePlayQuestion,
  guardedScenePlayQuestionThen,
} from "../../core/audio/sceneAudio";

const GAMEPLAY_BG = "#CAFEEA";
const MAX_LIVES = 3;
/** ระยะเวลาที่ choice หนึ่งชุดต้องลอยพ้นจอ — ช่วยกำหนด timer "ตอบไม่ทัน" */
const CHOICE_TRAVEL_DURATION_MS = 13000;
/** ความไวตามเมาส์/นิ้ว — ค่ามาก = ตัวละครตามเร็วขึ้น */
const FLAPPY_POINTER_FOLLOW_LERP = 0.16;
const HUD_QUESTION_FLASH_COLOR = "#e53e3e";
/** ซ้อนทับเล็กน้อยเพื่อลบรอยต่อภาพ parallax */
const PARALLAX_OVERLAP_PX = 1;
const FLAPPY_VOLUME_RED_TEXTURE_KEY = "flappy_volume_red";

const FLAPPY_TEACHER_WARN_LINES = [
  "เหลือหัวใจไม่เยอะแล้วนะ",
  "ระวังหน่อย",
  "อย่าชนผิดอีกน๊า",
  "ตั้งสติดีๆ",
] as const;

const FLAPPY_TEACHER_CORRECT_LINES = ["สุดยอดเลย", "เก่งมากๆ", "ทำได้ดีมาก"] as const;

/** เปิดด้วย `?debugFlappyHitbox=1` — วาดกรอบ hitbox ตัวละคร/choice + physics debug */
function isFlappyHitboxDebugEnabled(): boolean {
  return (
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("debugFlappyHitbox") === "1"
  );
}

/** สัดส่วน hitbox ตัวละครเทียบ frame (origin 0.5) */
const FLAPPY_CHAR_HIT_W_RATIO = 0.62;
const FLAPPY_CHAR_HIT_H_RATIO = 0.56;

/** โครง payload จาก API (เทียบกับ response ของเกม flappy_bird) — โหลดผ่าน injectedPayload เหมือน situation */
type FlappyBirdChoice = {
  id: number;
  id_question_multiple?: number;
  choice: string;
  is_correct: boolean | number | string;
  sound_choice?: string | null;
  image_choice?: string | null;
};

type FlappyBirdQuestion = {
  id: number;
  id_game_info?: number;
  no: number;
  question: string;
  hint?: string | null;
  sound_question?: string | null;
  image_question?: string | null;
  sound_hint?: string | null;
  image_hint?: string | null;
  shuffle_answer?: boolean | string | number | null;
  choices: FlappyBirdChoice[];
};

type FlappyBirdPayload = {
  source?: "game";
  game_info: {
    uuid?: string;
    uuid_newgen?: string;
    exercise_name?: string;
    suggestion?: string | null;
  };
  questions: FlappyBirdQuestion[];
  situation_assets?: unknown[];
};

/** เลื่อนแบบสอง tile ต่อกันไม่มีช่องว่าง — cellW = ความกว้างหนึ่งชุด */
type ParallaxTileTrack = {
  tileA: Phaser.GameObjects.Container;
  tileB: Phaser.GameObjects.Container;
  cellW: number;
  speedPxPerSec: number;
};

type CloudParallax = {
  img: Phaser.GameObjects.Image;
  speedPxPerSec: number;
};

/** Phaser GameObject ที่ใช้กับ physics body แบบ arcade — ขยายชนิดเพื่อให้ TS รู้จัก body */
type ChoiceSprite = Phaser.GameObjects.Container & {
  body: Phaser.Physics.Arcade.Body;
};

type FlappyChoiceGlowRegion = {
  left: number;
  top: number;
  width: number;
  height: number;
  radius: number;
};

type ActiveChoice = {
  sprite: ChoiceSprite;
  choice: FlappyBirdChoice;
  questionIndex: number;
  resolved: boolean;
  speaker?: Phaser.GameObjects.Image;
  audioKey?: string;
  centerAutoPlayed?: boolean;
  prevScreenX?: number;
  centerGlowGfx?: Phaser.GameObjects.Graphics;
  centerGlowTimer?: Phaser.Time.TimerEvent;
  centerGlowPhase?: number;
};

type FlappyChoiceAudioJob = {
  entry: ActiveChoice;
  speaker?: Phaser.GameObjects.Image;
  key: string;
  /** เล่นอัตโนมัติตอน choice ผ่านกลางจอ — แสดง glow + ลำโพงแดง */
  centerHighlight?: boolean;
};

type ActiveQuestion = {
  questionIndex: number;
  question: FlappyBirdQuestion;
  remainingChoices: ActiveChoice[];
  spawnedCount: number;
  resolved: boolean;
  /** คำตอบที่ถูกที่ยังต้องชนให้ครบก่อนจบข้อ */
  remainingCorrectIds: Set<number>;
  timeoutEvent?: Phaser.Time.TimerEvent;
};

export default class FlappyBirdGameScene extends BaseGameScene {
  private mobile = false;
  private character?: Phaser.GameObjects.Image;
  private characterIdleTweens: Phaser.Tweens.Tween[] = [];
  private tutorialPopup?: {
    overlay: Phaser.GameObjects.Rectangle;
    howToImage: Phaser.GameObjects.Image;
    startButton: Phaser.GameObjects.Image;
    restoreSceneInputEnabled: boolean;
    restoreHomeInputEnabled: boolean;
  };

  private teacherHintUI?: TeacherHintUI;
  private lastTeacherWarnAt = 0;
  private countdownLabel?: Phaser.GameObjects.Text;
  private hudRoot?: Phaser.GameObjects.Container;
  private hudTimeText?: Phaser.GameObjects.Text;
  private hudTimerEvent?: Phaser.Time.TimerEvent;
  /** เริ่มจับเวลาเมื่อขึ้นคำถามข้อแรกเท่านั้น (ไม่นับช่วง intro / นับ 3-2-1) */
  private hudElapsedRunning = false;
  private hudHearts: Phaser.GameObjects.Image[] = [];
  private hudQuestionProgress?: PhaserQuestionProgressHud;
  private hudScoreBg?: Phaser.GameObjects.Image;
  private hudScoreLabel?: Phaser.GameObjects.Text;
  private hudScoreText?: Phaser.GameObjects.Text;
  private hudTimeBg?: Phaser.GameObjects.Image;
  private hudTimeIcon?: Phaser.GameObjects.Image;
  private hudLivesBg?: Phaser.GameObjects.Image;
  private hudTitlePill?: Phaser.GameObjects.Graphics;
  private hudTitleText?: Phaser.GameObjects.Text;
  private hudTitleDom?: Phaser.GameObjects.DOMElement;
  private hudExerciseTitle = "";
  private hudSuggestionY = 0;
  private hudSuggestionH = 0;
  private hudQuestionPill?: Phaser.GameObjects.Graphics;
  private hudQuestionText?: Phaser.GameObjects.Text;
  private hudQuestionDom?: Phaser.GameObjects.DOMElement;
  private hudQuestionSpeakerBtn?: Phaser.GameObjects.Image;
  private hudQuestionImageBorder?: Phaser.GameObjects.Graphics;
  private hudQuestionImage?: Phaser.GameObjects.Image;
  private hudQuestionContainerW = 0;
  private hudQuestionMinW = 0;
  private hudQuestionMaxW = 0;
  private hudQuestionLeftX = 0;
  private hudQuestionRightX = 0;
  private hudQuestionTitleH = 0;
  private hudQuestionTitleY = 0;
  private hudQuestionMediaCenterX = 0;
  private hudQuestionMediaCenterY = 0;
  /** ขอบบนขั้นต่ำของโซนสุ่ม choice (ต้องอยู่ต่ำกว่ากรอบคำถาม) */
  private choiceSpawnMinY = 0;
  /** ขอบล่างแถว HUD บน (เวลา/หัวใจ) — เพดานการบินห้ามทับส่วนนี้ */
  private hudTopBarBottomY = 0;
  /** ตำแหน่ง Y กลางตัวละครต่ำสุด — ห้ามบินสูงกว่านี้ (ไม่ทับ HUD) */
  private characterFlightMinY = 0;
  /** ตำแหน่ง Y กลางตัวละครสูงสุด — ห้ามบินต่ำกว่าขอบล่างจอ */
  private characterFlightMaxY = 0;
  private hitboxDebugGfx?: Phaser.GameObjects.Graphics;
  private hudScoreTargetX = 0;
  private hudScoreTargetY = 0;
  private questionFlashSeq = 0;
  private questionFlashTween?: Phaser.Tweens.Tween;

  private parallaxTracks: ParallaxTileTrack[] = [];
  private parallaxClouds: CloudParallax[] = [];
  private parallaxActive = false;
  private gameplayActive = false;
  private endingRun = false;

  private getFlappySafeArea(): Phaser.Geom.Rectangle {
    return this.getSafeAreaRect(this.mobile ? 9 / 16 : 16 / 9);
  }
  // BGM (home/gameplay/end) — เปลี่ยน track ตาม phase ของเกม
  private bgmCurrent?: Phaser.Sound.BaseSound;
  private bgmCurrentKey?: string;
  private distanceForScore = 0;
  /** ข้อมูลเกมจาก API — ได้จาก init({ payload }) เหมือน situation */
  private flappyPayload?: FlappyBirdPayload;

  private lives = MAX_LIVES;
  private gameFailedByNoLives = false;
  private questionQueue: number[] = [];
  private flappyTotalQuestions = 0;
  private activeQuestion?: ActiveQuestion;
  private activeChoices: ActiveChoice[] = [];
  private flappyChoiceAudioBusy = false;
  private flappyChoiceAudioQueue: FlappyChoiceAudioJob[] = [];
  private flappyChoicePlayingSound?: Phaser.Sound.BaseSound;
  private flappyChoicePlayingSpeaker?: Phaser.GameObjects.Image;
  private flappyChoicePlayingEntry?: ActiveChoice;
  private correctCount = 0;
  /** จำนวนข้อที่ทำครบแล้ว — ใช้แสดงหน้า Result (ไม่ใช่คะแนน) */
  private completedQuestionCount = 0;
  /** เก็บ choice ที่ตอบผิดไปแล้วรายข้อ (ถามซ้ำจะไม่แสดงตัวเดิม) */
  private eliminatedChoiceIdsByQuestion = new Map<number, Set<number>>();
  /** คำตอบที่ถูกที่ตอบไปแล้วรายข้อ (วนข้อซ้ำจะไม่ spawn ซ้ำ — ได้คะแนนไปแล้ว) */
  private answeredCorrectChoiceIdsByQuestion = new Map<number, Set<number>>();
  /** key ของ audio ของแต่ละ choice/question — ใช้สำหรับเล่นซ้ำ */
  private audioKeyByUrl = new Map<string, string>();
  /** texture key ของรูปตัวเลือกที่โหลดเข้ามาแล้ว */
  private textureKeyByUrl = new Map<string, string>();

  constructor() {
    super({
      key: "flappy-bird",
      physics: {
        default: "arcade",
        arcade: {
          gravity: { x: 0, y: 1050 },
          debug: isFlappyHitboxDebugEnabled(),
        },
      },
    });
  }

  protected override getLiveDashboardLaunchFields() {
    return {
      ...super.getLiveDashboardLaunchFields(),
      /** true = จบครบทุกข้อ (ไม่หมดชีวิตกลางทาง) — ใช้กรอง POST live-dashboard */
      liveDashboardFlappyPassed: !this.gameFailedByNoLives,
    };
  }

  preload() {
    if (!this.textures.exists("flappy_howto_mobile")) {
      this.load.image("flappy_howto_mobile", "assets/flappy-bird/howto_mobile.png");
    }
    if (!this.textures.exists("flappy_howto_desktop")) {
      this.load.image("flappy_howto_desktop", "assets/flappy-bird/howto_desktop.png");
    }
    if (!this.cache.audio.exists("sfx_click_default")) {
      this.load.audio("sfx_click_default", "assets/sound/ui/click.mp3");
    }
    if (!this.cache.audio.exists("sfx_notification_message")) {
      this.load.audio("sfx_notification_message", "assets/sound/sfx_notification_message_flip_cards.mp3");
    }
    if (!this.cache.audio.exists("flappy_bgm_home")) {
      this.load.audio("flappy_bgm_home", "assets/sound/flappy-bird/home.mp3");
    }
    if (!this.cache.audio.exists("flappy_bgm_gameplay")) {
      this.load.audio("flappy_bgm_gameplay", "assets/sound/flappy-bird/gameplay.mp3");
    }
    if (!this.cache.audio.exists("flappy_bgm_end")) {
      this.load.audio("flappy_bgm_end", "assets/sound/flappy-bird/end.mp3");
    }
    if (!this.cache.audio.exists("flappy_sfx_correct")) {
      this.load.audio("flappy_sfx_correct", "assets/sound/flappy-bird/correct.mp3");
    }
    if (!this.cache.audio.exists("flappy_sfx_wrong")) {
      this.load.audio("flappy_sfx_wrong", "assets/sound/flappy-bird/wrong.mp3");
    }
    if (!this.cache.audio.exists("flappy_sfx_fly")) {
      this.load.audio("flappy_sfx_fly", "assets/sound/flappy-bird/fly.mp3");
    }
    if (!this.cache.audio.exists("sfx_quiz")) {
      this.load.audio("sfx_quiz", "assets/sound/SFX_quiz.mp3");
    }
    if (!this.cache.audio.exists("sfx_countnum")) {
      this.load.audio("sfx_countnum", "assets/sound/countnum.mp3");
    }
    TeacherHintUI.preload(this);
    if (!this.textures.exists("flappy_char_home")) {
      this.load.image("flappy_char_home", "assets/flappy-bird/character/home.png");
    }
    if (!this.textures.exists("flappy_char_idle")) {
      this.load.image("flappy_char_idle", "assets/flappy-bird/character/idel.png");
    }
    if (!this.textures.exists("flappy_char_up")) {
      this.load.image("flappy_char_up", "assets/flappy-bird/character/up.png");
    }
    if (!this.textures.exists("flappy_char_wrong")) {
      this.load.image("flappy_char_wrong", "assets/flappy-bird/character/wrong.png");
    }
    if (!this.textures.exists("flappy_char_correct")) {
      this.load.image("flappy_char_correct", "assets/flappy-bird/character/correct.png");
    }
    if (!this.textures.exists("coin_icon")) {
      this.load.image("coin_icon", "assets/common/coin_icon.png");
    }
    preloadHudAssets(this);
    if (!this.textures.exists(FLAPPY_VOLUME_RED_TEXTURE_KEY)) {
      this.load.image(FLAPPY_VOLUME_RED_TEXTURE_KEY, "assets/common/volume_red.png");
    }

    if (!this.textures.exists("flappy_bg_cloud")) {
      this.load.image("flappy_bg_cloud", "assets/flappy-bird/Background/cloud.png");
    }
    if (!this.textures.exists("flappy_bg_mountain")) {
      this.load.image("flappy_bg_mountain", "assets/flappy-bird/Background/mountain.png");
    }
    if (!this.textures.exists("flappy_bg_wall1")) {
      this.load.image("flappy_bg_wall1", "assets/flappy-bird/Background/wall1.png");
    }
    if (!this.textures.exists("flappy_bg_wall2")) {
      this.load.image("flappy_bg_wall2", "assets/flappy-bird/Background/wall2.png");
    }
    if (!this.textures.exists("flappy_bg_floor")) {
      this.load.image("flappy_bg_floor", "assets/flappy-bird/Background/floor.png");
    }
    if (!this.textures.exists("flappy_bg_foreground")) {
      this.load.image("flappy_bg_foreground", "assets/flappy-bird/Background/foreground.png");
    }

    if (!this.textures.exists("flappy_choice_bg")) {
      this.load.image("flappy_choice_bg", "assets/flappy-bird/chicebg.png");
    }
    if (!this.textures.exists("flappy_heart_icon")) {
      this.load.image("flappy_heart_icon", "assets/flappy-bird/heart.png");
    }
    if (!this.textures.exists("flappy_q_image_border")) {
      this.load.image("flappy_q_image_border", "assets/flappy-bird/q_image_border.png");
    }
    if (!this.textures.exists("flappy_star_fx")) {
      this.load.image("flappy_star_fx", "assets/flip-cards/star.png");
    }
  }

  async create() {
    super.create();
    this.mobile = isMobileLayout();
    /** หน้า Home ใช้ sub-pixel เพื่อให้ tween ตัวละครเนียน ไม่กระตุก */
    this.cameras.main.roundPixels = false;

    let payload: FlappyBirdPayload;
    try {
      payload = await this.fetchFlappyBirdData();
    } catch (error) {
      console.error("Failed to load flappy bird data:", error);
      this.cameras.main.setBackgroundColor(GAMEPLAY_BG);
      this.add
        .text(this.scale.width / 2, this.scale.height / 2, "โหลดข้อมูลเกมไม่สำเร็จ", {
          font: `700 36px "Noto Sans Thai", sans-serif`,
          color: "#ffffff",
          backgroundColor: "#b02a37",
          padding: { x: 16, y: 10 },
        })
        .setOrigin(0.5)
        .setDepth(2000);
      return;
    }

    this.flappyPayload = payload;
    this.totalQuestions = payload.questions?.length ?? 0;

    try {
      await this.preloadQuestionAssets(payload);
    } catch (err) {
      console.warn("[flappy-bird] preload question assets failed:", err);
    }

    this.cameras.main.setBackgroundColor(GAMEPLAY_BG);
    this.buildParallaxWorld();
    this.parallaxActive = true;

    this.playBgm("flappy_bgm_home");

    this.scene.launch("HomeScene", {
      gameKey: this.scene.key,
      ui: {
        startButtonPath: "assets/flappy-bird/btn_start.png",
        howToButtonPath: "assets/flappy-bird/btn_howto.png",
        homeLogoPath: "assets/flappy-bird/logo.png",
        homeLogoKey: "flappy_bird_home_logo",
        homeLogoWidth: this.mobile ? 320 : 400,
        homeLogoYRatio: this.mobile ? 0.25 : 0.25,
        startButtonWidth: this.mobile ? 220 : 280,
        howToButtonWidth: this.mobile ? 180 : 200,
        startButtonYRatio: this.mobile ? 0.65 : 0.64,
        howToButtonYRatio: this.mobile ? 0.76 : 0.78,
        minButtonGapPx: this.mobile ? 22 : 18,
      },
    });
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

    const safe = this.getFlappySafeArea();
    const baseY = safe.y + safe.height * 0.48;
    const character = this.add
      .image(safe.x + safe.width / 2, baseY, "flappy_char_home")
      .setOrigin(0.5)
      .setDepth(100);
    this.character = character;
    this.applyCharacterVisualScale();

    this.startCharacterFloating(character.x, character.y);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.stopCharacterFloating();
      this.teardownGameplayInput();
      this.destroyFlappyTeacherAndMessage();
      this.destroyFlappyHitboxDebugGfx();
      this.stopBgm(0);
    });
  }

  update(_time: number, delta: number) {
    if (this.parallaxActive) {
      this.updateParallax(delta);
    }
    if (this.gameplayActive && this.character) {
      this.updateCharacterPointerFollow(delta);
      this.updateChoiceCollisions();
      this.drawFlappyHitboxDebug();
    } else if (isFlappyHitboxDebugEnabled()) {
      this.hitboxDebugGfx?.clear();
    }
  }

  private async beginGameplayAfterHome(): Promise<void> {
    await ensureNotoSansThaiLoopedReady();
    this.endingRun = false;
    this.cameras.main.setBackgroundColor(GAMEPLAY_BG);
    this.startTime = 0;
    this.hudElapsedRunning = false;
    this.score = 0;
    this.distanceForScore = 0;

    const exerciseName = getHudSuggestionLabel(this.flappyPayload?.game_info.suggestion);
    this.createTopHud(exerciseName, this.mobile);

    const safe = this.getFlappySafeArea();
    const width = safe.width;
    const height = safe.height;
    const character = this.character;
    if (character) {
      this.stopCharacterFloating();
      const baseY = safe.y + height * 0.5;
      const targetX = Math.max(
        safe.x + character.displayWidth * 0.58 + width * 0.06,
        safe.x + width * 0.18
      );
      character.setAngle(0);
      this.tweens.add({
        targets: character,
        x: targetX,
        y: baseY,
        duration: 520,
        ease: "Cubic.easeOut",
        onComplete: () => {
          void this.runFlappyPreGameIntroThenStart();
        },
      });
    } else {
      void this.runFlappyPreGameIntroThenStart();
    }
  }

  private buildParallaxWorld() {
    this.destroyParallaxWorld();
    const { width, height: h } = this.scale;
 
    const mountainH = h * 0.5;
    const mountainBottomY = h * 0.9;

    const wallH = h * 0.4;
    const wallBottomY = h* 0.9;

    const floorH = h * 0.3;
    const floorBottomY = h;

    const fgH = h * 0.2;
    const fgBottomY = h*1.05;

    const cloudCount = Math.min(42, Math.max(16, Math.round(width / 28)));
    for (let i = 0; i < cloudCount; i += 1) {
      const img = this.add
        .image(
          Phaser.Math.Between(-80, width + 120),
          Phaser.Math.Between(h * 0.03, h * 0.52),
          "flappy_bg_cloud"
        )
        .setScrollFactor(0)
        .setDepth(Phaser.Math.Between(4, 12))
        .setAlpha(Phaser.Math.FloatBetween(0.45, 0.95));
      const sc = Phaser.Math.FloatBetween(0.32, 1.12);
      img.setScale(sc);
      if (Math.random() < 0.45) img.setFlipX(true);
      this.parallaxClouds.push({
        img,
        speedPxPerSec: Phaser.Math.FloatBetween(10, 26),
      });
    }

    this.pushTwoTileTrack(() => this.buildMirroredPairCell("flappy_bg_mountain", mountainH), 32, 14, mountainBottomY);
    this.pushTwoTileTrack(() => this.buildWallGateCell(wallH), 58, 24, wallBottomY);
    this.pushTwoTileTrack(() => this.buildMirroredPairCell("flappy_bg_floor", floorH), 118, 36, floorBottomY);
    this.pushTwoTileTrack(() => this.buildMirroredPairCell("flappy_bg_foreground", fgH), 155, 46, fgBottomY);
  }

  /** mountain / floor / foreground: ชิ้น + ชิ้นพลิก X ต่อกันยาว ลดรอยต่อกลางจอ */
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

  /** wall1 ซ้าย + wall2 ขวา แนวเดียวกัน (ขอบชิด) */
  private buildWallGateCell(displayH: number): { container: Phaser.GameObjects.Container; cellW: number } {
    const { width } = this.scale;
    const t1 = this.textures.get("flappy_bg_wall1").getSourceImage() as { width: number; height: number };
    const t2 = this.textures.get("flappy_bg_wall2").getSourceImage() as { width: number; height: number };
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
    const w1 = this.add.image(0, 0, "flappy_bg_wall1").setOrigin(0, 1).setDisplaySize(tw1, displayH);
    const w2 = this.add
      .image(tw1 - PARALLAX_OVERLAP_PX, 0, "flappy_bg_wall2")
      .setOrigin(0, 1)
      .setDisplaySize(tw2, displayH);
    c.add([w1, w2]);
    return { container: c, cellW: tw1 + tw2 - PARALLAX_OVERLAP_PX };
  }

  private pushTwoTileTrack(
    buildCell: () => { container: Phaser.GameObjects.Container; cellW: number },
    speedPxPerSec: number,
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
      speedPxPerSec,
    });
  }

  private updateParallax(delta: number) {
    const dt = delta / 1000;
    const safe = this.getFlappySafeArea();
    const width = safe.width;
    const height = safe.height;

    for (const c of this.parallaxClouds) {
      c.img.x -= c.speedPxPerSec * dt;
      if (c.img.x < -c.img.displayWidth - 40) {
        c.img.x = width + Phaser.Math.Between(30, 200);
        c.img.y = Phaser.Math.Between(height * 0.03, height * 0.52);
        c.img.setAlpha(Phaser.Math.FloatBetween(0.45, 0.95));
        c.speedPxPerSec = Phaser.Math.FloatBetween(10, 26);
      }
    }

    let fastest = 0;
    for (const track of this.parallaxTracks) {
      const dx = track.speedPxPerSec * dt;
      fastest = Math.max(fastest, track.speedPxPerSec);
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

    if (this.gameplayActive) {
      this.distanceForScore += fastest * dt;
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

  private startFlappyGameplay() {
    const character = this.character;
    if (!character) return;

    this.playBgm("flappy_bgm_gameplay");
    this.reportRunstateStart();
    character.setTexture("flappy_char_idle");
    this.applyCharacterVisualScale();
    character.setAngle(0);

    /** ปิด roundPixels — บนมือถือ + FIT การปัดพิกเซลทำให้ HUD/ภาพดูเบลอ */
    this.cameras.main.roundPixels = false;
    this.gameplayActive = true;
    this.physics.add.existing(character, false);
    const body = character.body as Phaser.Physics.Arcade.Body;
    body.setAllowGravity(false);
    body.setGravityY(0);
    body.setCollideWorldBounds(true);
    body.setBounce(0);
    body.setDrag(0, 0);
    body.setVelocity(0, 0);
    body.setMaxVelocity(600, 600);
    this.refreshCharacterPhysicsBody();
    this.refreshCharacterFlightBounds();

    this.input.enabled = true;

    this.beginQuestionFlow();
  }

  /** บินตามเมาส์/นิ้วค้างแล้วลากขึ้น–ลง แบบ airplane game */
  private updateCharacterPointerFollow(delta: number) {
    const character = this.character;
    if (!character) return;
    const body = character.body as Phaser.Physics.Arcade.Body | undefined;
    if (!body) return;

    const pointer = this.input.activePointer;
    let targetY: number | null = null;
    if (pointer.isDown) targetY = pointer.y;

    if (targetY == null) {
      body.setVelocity(0, 0);
      character.setAngle(Phaser.Math.Linear(character.angle, 0, 0.12));
      return;
    }

    const minY = this.characterFlightMinY > 0 ? this.characterFlightMinY : character.displayHeight * 0.5;
    const maxY =
      this.characterFlightMaxY > minY
        ? this.characterFlightMaxY
        : this.scale.height - character.displayHeight * 0.5;
    const clampedY = Phaser.Math.Clamp(targetY, minY, maxY);
    const lerp = 1 - Math.pow(1 - FLAPPY_POINTER_FOLLOW_LERP, delta / 16.667);
    const prevY = character.y;
    const nextY = Phaser.Math.Linear(character.y, clampedY, lerp);
    character.setY(nextY);
    body.setVelocity(0, 0);
    body.reset(character.x, character.y);

    const dy = nextY - prevY;
    if (dy < -0.8) {
      if (character.texture.key !== "flappy_char_up") {
        character.setTexture("flappy_char_up");
        this.applyCharacterVisualScale();
        this.refreshCharacterPhysicsBody();
      }
    } else if (dy > 0.8) {
      if (character.texture.key !== "flappy_char_idle") {
        character.setTexture("flappy_char_idle");
        this.applyCharacterVisualScale();
        this.refreshCharacterPhysicsBody();
      }
    }
    const tilt = Phaser.Math.Clamp(dy * 2.8, -28, 72);
    character.setAngle(Phaser.Math.Linear(character.angle, tilt, 0.18));
  }

  private teardownGameplayInput() {
    // pointer follow อ่านจาก update() — ไม่ต้องลงทะเบียน listener แยก
  }

  private triggerGameOver() {
    if (!this.gameplayActive || this.endingRun) return;
    this.endingRun = true;
    this.gameplayActive = false;
    this.teardownGameplayInput();
    this.playBgm("flappy_bgm_end");
    const character = this.character;
    if (character && character.active) {
      const body = character.body as Phaser.Physics.Arcade.Body | undefined;
      if (body) {
        body.setAllowGravity(false);
        body.setVelocity(0, 0);
      }
      character.setAngle(0);
      character.setTexture(this.gameFailedByNoLives ? "flappy_char_wrong" : "flappy_char_home");
      this.applyCharacterVisualScale();
      /** ตอนจบให้นกยังลอยอยู่เหมือนหน้า Home ใต้ overlay Result */
      this.startCharacterFloating(character.x, character.y);
    }
    this.endGame();
  }

  private formatElapsedTime(): string {
    if (!this.hudElapsedRunning) return "0:00";
    const elapsedSec = Math.max(0, Math.floor((Date.now() - this.startTime) / 1000));
    const min = Math.floor(elapsedSec / 60);
    const sec = elapsedSec % 60;
    return `${min}:${sec.toString().padStart(2, "0")}`;
  }

  private getFlappyHudLayout() {
    const safe = this.getFlappySafeArea();
    const ui = createHudScaleCtx(safe.width, safe.height, this.mobile);
    const metrics = getGameHudRowMetrics({
      mobile: this.mobile,
      width: safe.width,
      height: safe.height,
      px: ui.px.bind(ui),
      maxLives: MAX_LIVES,
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

  private layoutFlappyHudStats() {
    const { safe, ui, metrics, slots } = this.getFlappyHudLayout();
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
        label: this.getFlappyQuestionProgressLabel(),
        font: metrics.fontProgress,
      });
    }

    this.hudTopBarBottomY = rowY + metrics.pillH / 2;
    this.hudScoreTargetX = slots.scoreCx + metrics.scoreW / 2 - valuePad;
    this.hudScoreTargetY = rowY;

    this.layoutFlappySuggestionHud();
  }

  private layoutFlappySuggestionHud() {
    if (!this.hudTitlePill || !this.hudTitleText) return;

    const mobile = this.mobile;
    const { safe, ui, metrics, slots } = this.getFlappyHudLayout();
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

    this.hudSuggestionY = titleY;
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
    this.hudSuggestionH = suggestionLayout.height;

    this.hudQuestionMaxW = box.width;
  }

  private getFlappyQuestionAnchorY(): number {
    const { safe, ui, slots } = this.getFlappyHudLayout();
    const baseY = safe.y + slots.questionY;
    if (!hasHudCenterLabel(this.hudExerciseTitle)) return baseY;
    return this.hudSuggestionY + this.hudSuggestionH + ui.px(this.mobile ? 14 : 18);
  }

  private createTopHud(exerciseName: string, mobile: boolean) {
    this.destroyTopHud();

    const title = getHudSuggestionLabel(exerciseName);
    this.hudExerciseTitle = title;
    const showSuggestion = hasHudCenterLabel(title);

    const { safe, ui, metrics, slots } = this.getFlappyHudLayout();
    const w = safe.width;
    const h = safe.height;
    const rowY = safe.y + slots.rowY;
    const titleH = metrics.questionH;
    const titleMinW = slots.questionMaxW * 0.65;
    const titleY = safe.y + slots.questionY;
    const hudDepth = 2000;
    const labelPad = ui.px(mobile ? 12 : 18);
    const valuePad = ui.px(mobile ? 12 : 18);
    const hudTextRes = Math.min(3, typeof window !== "undefined" ? window.devicePixelRatio || 2 : 2);

    this.hudTopBarBottomY = rowY + metrics.pillH / 2;

    const hud = this.add.container(0, 0).setScrollFactor(0).setDepth(hudDepth);
    this.hudRoot = hud;

    const fontHudQuestion = getHudCenterTextFont(ui.px.bind(ui), mobile);

    const suggestionPill = this.add.graphics().setScrollFactor(0);
    hud.add(suggestionPill);
    this.hudTitlePill = suggestionPill;

    this.hudTitleText = this.add
      .text(0, 0, "", {
        font: fontHudQuestion,
        color: "#333333",
        align: "center",
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setResolution(hudTextRes);
    hud.add(this.hudTitleText);

    this.layoutFlappySuggestionHud();

    const questionPill = this.add.graphics().setScrollFactor(0);
    hud.add(questionPill);
    this.hudQuestionPill = questionPill;

    this.hudQuestionMinW = mobile ? safe.width * 0.74 : titleMinW;
    if (!this.hudQuestionMaxW) {
      this.hudQuestionMaxW = mobile ? safe.width * 0.9 : slots.questionMaxW;
    }
    this.hudQuestionTitleH = titleH;
    this.hudQuestionTitleY = showSuggestion
      ? this.hudSuggestionY + this.hudSuggestionH + ui.px(mobile ? 14 : 18)
      : titleY;

    const kwFrameHalfH = getQuestionMediaFrameHalfH(mobile, ui.px.bind(ui), w, true, h);
    this.hudQuestionMediaCenterX = slots.questionCenterX;
    this.hudQuestionMediaCenterY = getQuestionMediaCenterYBelowAnchor(
      this.hudQuestionTitleY + titleH,
      kwFrameHalfH,
      mobile,
      ui.px.bind(ui)
    );
    this.choiceSpawnMinY = this.hudQuestionTitleY + titleH + ui.px(mobile ? 24 : 30);
    this.refreshCharacterFlightBounds();

    const textPadX = ui.px(mobile ? 12 : 16);
    const textPadY = ui.px(mobile ? 10 : 8);
    const questionWrapPad = ui.px(mobile ? 56 : 96);
    const questionWrapMin = ui.px(mobile ? 40 : 56);
    this.hudQuestionText = this.add
      .text(slots.questionCenterX, this.hudQuestionTitleY + titleH / 2, "", {
        font: fontHudQuestion,
        color: HUD_QUESTION_TEXT_COLOR,
        wordWrap: {
          width: Math.max(questionWrapMin, slots.questionMaxW - questionWrapPad),
        },
        align: "center",
        padding: { x: textPadX, y: textPadY },
        lineSpacing: mobile ? 3 : 2,
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setResolution(hudTextRes);
    hud.add(this.hudQuestionText);
    this.setFlappyCenterQuestionHudVisible(false);

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
    hud.add([this.hudTimeBg, this.hudTimeIcon, this.hudTimeText]);

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

    const totalQuestions = this.flappyPayload?.questions?.length ?? 0;
    this.flappyTotalQuestions = totalQuestions;
    this.totalQuestions = totalQuestions;
    this.hudQuestionProgress = createPhaserQuestionProgressHud(this, hudDepth + 2, {
      mobile,
      width: safe.width,
      px: ui.px.bind(ui),
      resolution: hudTextRes,
    });
    hud.add(this.hudQuestionProgress.bg);
    hud.add(this.hudQuestionProgress.text);

    this.layoutFlappyHudStats();

    this.hudTimerEvent = this.time.addEvent({
      delay: 250,
      loop: true,
      callback: () => {
        this.hudTimeText?.setText(this.formatElapsedTime());
        this.layoutFlappyHudStats();
      },
    });

    this.refreshHudLives();
  }

  private refreshHudLives() {
    for (let i = 0; i < this.hudHearts.length; i += 1) {
      const alive = i < this.lives;
      this.hudHearts[i].setAlpha(alive ? 1 : 0.25);
    }
    this.refreshHudScoreCounter();
  }

  /** อัปเดตเลขคะแนนใน HUD */
  private refreshHudScoreCounter() {
    this.layoutFlappyHudStats();
  }

  private getFlappyQuestionProgressLabel(): string {
    const total = this.flappyTotalQuestions || this.flappyPayload?.questions?.length || 0;
    if (total <= 0) return "";
    if (!this.gameplayActive) {
      return getQuestionProgressLabel(total, { gameplayActive: false });
    }
    if (this.activeQuestion) {
      return this.formatQuestionProgressLabel(total - this.questionQueue.length, total);
    }
    if (this.questionQueue.length === 0) {
      return this.formatQuestionProgressLabel(total, total);
    }
    return this.formatQuestionProgressLabel(Math.max(1, total - this.questionQueue.length), total);
  }

  private refreshFlappyQuestionProgressHud() {
    this.layoutFlappyHudStats();
  }

  /** อัปเดต HUD ของคำถาม: text + รูปคำถาม (ถ้ามี) + ปุ่มลำโพง */
  /** กล่องคำถามกลางจอ — แสดงเมื่อมีโจทย์เท่านั้น */
  private setFlappyCenterQuestionHudVisible(visible: boolean) {
    this.hudQuestionPill?.setVisible(visible);
    this.hudQuestionText?.setVisible(visible);
    this.hudQuestionDom?.setVisible(visible);
    this.hudQuestionImageBorder?.setVisible(visible);
    this.hudQuestionImage?.setVisible(visible);
    this.hudQuestionSpeakerBtn?.setVisible(visible);
  }

  private setHudQuestion(
    text: string,
    hasSound: boolean,
    onSpeakerTap?: () => void,
    questionImageUrl?: string
  ) {
    if (!this.hudQuestionText) return;
    if (!hasHudCenterLabel(text)) {
      this.setFlappyCenterQuestionHudVisible(false);
      return;
    }
    this.setFlappyCenterQuestionHudVisible(true);
    const safe = this.getFlappySafeArea();
    const { slots, metrics } = this.getFlappyHudLayout();
    const ui = createHudScaleCtx(safe.width, safe.height, this.mobile);
    this.hudQuestionTitleY = this.getFlappyQuestionAnchorY();
    const minLeft = this.mobile ? safe.x + metrics.leftPad : slots.timeRight + metrics.questionGap;
    const maxRight = this.mobile ? safe.x + safe.width - metrics.leftPad : slots.statsLeftEdge - metrics.questionGap;
    const maxAllowedW = Math.max(1, maxRight - minLeft);
    const effectiveMaxW = Math.min(this.hudQuestionMaxW, maxAllowedW);
    const pillPadX = ui.px(this.mobile ? 12 : 16);
    const pill = resolveQuestionHudTextPillBox({
      text: text.trim(),
      mobile: this.mobile,
      px: ui.px.bind(ui),
      centerX: slots.questionCenterX,
      topY: this.hudQuestionTitleY,
      minW: this.hudQuestionMinW,
      maxW: effectiveMaxW,
      pillPadX,
      basePillH: this.hudQuestionTitleH,
      fontPx: getHudCenterTextMaxFontPx(ui.px.bind(ui), this.mobile),
      maxLines: 2,
    });
    const box = resolveCenteredQuestionBox({
      centerX: slots.questionCenterX,
      desiredW: pill.width,
      minW: this.hudQuestionMinW,
      maxW: this.hudQuestionMaxW,
      minLeft,
      maxRight,
    });
    const titleH = pill.height;
    const nextLeft = box.left;
    const textCenterX = box.centerX;

    this.hudQuestionPill?.clear();
    this.hudQuestionPill?.fillStyle(0xffffff, 0.92);
    this.hudQuestionPill?.lineStyle(2, 0xd9e8e5, 1);
    this.hudQuestionPill?.fillRoundedRect(nextLeft, this.hudQuestionTitleY, box.width, titleH, 14);
    this.hudQuestionPill?.strokeRoundedRect(nextLeft, this.hudQuestionTitleY, box.width, titleH, 14);

    this.hudQuestionContainerW = box.width;
    this.hudQuestionLeftX = nextLeft;
    this.hudQuestionRightX = nextLeft + box.width;
    this.hudQuestionMediaCenterX = textCenterX;

    const kwFrameHalfH = getQuestionMediaFrameHalfH(
      this.mobile,
      ui.px.bind(ui),
      safe.width,
      true,
      safe.height
    );
    this.hudQuestionMediaCenterY = getQuestionMediaCenterYBelowAnchor(
      this.hudQuestionTitleY + titleH,
      kwFrameHalfH,
      this.mobile,
      ui.px.bind(ui)
    );
    this.choiceSpawnMinY = this.hudQuestionTitleY + titleH + ui.px(this.mobile ? 24 : 30);
    this.refreshCharacterFlightBounds();

    const wrapW = pill.wrapWidth;
    const textPadX = ui.px(this.mobile ? 12 : 16);
    const textPadY = ui.px(this.mobile ? 10 : 8);
    const wrapPadX = ui.px(this.mobile ? 56 : 96);
    const hudTextRes = Math.min(3, typeof window !== "undefined" ? window.devicePixelRatio || 2 : 2);
    this.hudQuestionDom =
      applyPhaserHudQuestionText({
        scene: this,
        text: this.hudQuestionText,
        dom: this.hudQuestionDom,
        parent: this.hudRoot,
        content: text,
        centerX: textCenterX,
        centerY: this.hudQuestionTitleY + titleH / 2,
        fontPx: pill.fontPx ?? getHudCenterTextMaxFontPx(ui.px.bind(ui), this.mobile),
        boxWidth: box.width,
        wrapWidth: wrapW,
        wrapPadX,
        textPadX,
        textPadY,
        resolution: hudTextRes,
        mobile: this.mobile,
        depth: 2002,
        lineSpacing: this.mobile ? 3 : 2,
      }) ?? this.hudQuestionDom;

    this.hudQuestionSpeakerBtn?.destroy();
    this.hudQuestionSpeakerBtn = undefined;
    this.hudQuestionImage?.destroy();
    this.hudQuestionImage = undefined;
    this.hudQuestionImageBorder?.destroy();
    this.hudQuestionImageBorder = undefined;

    const questionImgKey =
      questionImageUrl && this.textureKeyByUrl.has(questionImageUrl)
        ? this.textureKeyByUrl.get(questionImageUrl)
        : undefined;

    const hasImage = !!(questionImgKey && this.textures.exists(questionImgKey));
    const imgTex =
      hasImage && questionImgKey
        ? (this.textures.get(questionImgKey).getSourceImage() as { width?: number; height?: number })
        : undefined;
    const layout = computeQuestionMediaLayout({
      mobile: this.mobile,
      px: ui.px.bind(ui),
      screenWidth: safe.width,
      screenHeight: safe.height,
      mediaCenterX: this.hudQuestionMediaCenterX,
      mediaCenterY: this.hudQuestionMediaCenterY,
      hasImage,
      hasSound,
      imageTexW: imgTex?.width,
      imageTexH: imgTex?.height,
    });

    if (layout) {
      const border = this.add.graphics().setScrollFactor(0).setDepth(2001);
      drawQuestionMediaFrameBox(border, layout.frameW, layout.frameH);
      border.setPosition(this.hudQuestionMediaCenterX, this.hudQuestionMediaCenterY);
      this.hudRoot?.add(border);
      this.hudQuestionImageBorder = border;

      if (layout.showImage && questionImgKey) {
        const qImg = this.add
          .image(layout.imageCenterX, layout.imageCenterY, questionImgKey)
          .setDisplaySize(layout.imageW, layout.imageH)
          .setScrollFactor(0)
          .setDepth(2002);
        this.hudRoot?.add(qImg);
        this.hudQuestionImage = qImg;
      }

      this.choiceSpawnMinY =
        this.hudQuestionMediaCenterY + layout.frameH / 2 + ui.px(this.mobile ? 18 : 24);
      this.refreshCharacterFlightBounds();
    }

    if (!hasSound || !layout) return;

    const btn = this.add
      .image(layout.speakerX, layout.speakerY, HUD_VOLUME_TEXTURE_KEY)
      .setDisplaySize(layout.speakerSize, layout.speakerSize)
      .setScrollFactor(0)
      .setDepth(2003)
      .setInteractive({ useHandCursor: true });
    btn.on("pointerdown", () => {
      this.tweens.add({
        targets: btn,
        scale: { from: btn.scale, to: btn.scale * 0.88 },
        yoyo: true,
        duration: 90,
      });
      onSpeakerTap?.();
    });
    this.hudQuestionSpeakerBtn = btn;
    this.hudRoot?.add(btn);
  }

  private stopHudQuestionFlashFx() {
    this.questionFlashSeq += 1;
    if (this.questionFlashTween) {
      this.questionFlashTween.stop();
      this.questionFlashTween = undefined;
    }
    this.hudQuestionText?.setColor(HUD_QUESTION_TEXT_COLOR);
  }

  /** กระพริบคำถามแดง + เสียงแจ้งเตือนเมื่อเปลี่ยนข้อ */
  private playNewQuestionAlertFx() {
    if (!this.hudQuestionText) return;
    this.stopHudQuestionFlashFx();
    const seq = this.questionFlashSeq;
    this.playSfx("sfx_quiz", 0.85);

    const phase = { on: 0 };
    this.questionFlashTween = this.tweens.add({
      targets: phase,
      on: 1,
      duration: 180,
      yoyo: true,
      repeat: 3,
      ease: "Sine.easeInOut",
      onUpdate: () => {
        if (seq !== this.questionFlashSeq || !this.hudQuestionText) return;
        this.hudQuestionText.setColor(phase.on > 0.5 ? HUD_QUESTION_FLASH_COLOR : HUD_QUESTION_TEXT_COLOR);
      },
      onComplete: () => {
        if (seq !== this.questionFlashSeq) return;
        this.questionFlashTween = undefined;
        this.hudQuestionText?.setColor(HUD_QUESTION_TEXT_COLOR);
      },
      onStop: () => {
        if (seq !== this.questionFlashSeq) return;
        this.questionFlashTween = undefined;
        this.hudQuestionText?.setColor(HUD_QUESTION_TEXT_COLOR);
      },
    });
  }

  private destroyTopHud() {
    this.stopHudQuestionFlashFx();
    this.hudTimerEvent?.destroy();
    this.hudTimerEvent = undefined;
    this.hudQuestionSpeakerBtn?.destroy();
    this.hudQuestionSpeakerBtn = undefined;
    this.hudQuestionImage?.destroy();
    this.hudQuestionImage = undefined;
    this.hudQuestionImageBorder?.destroy();
    this.hudQuestionImageBorder = undefined;
    this.hudRoot?.destroy(true);
    this.hudRoot = undefined;
    this.hudTimeText = undefined;
    this.hudTimeBg = undefined;
    this.hudTimeIcon = undefined;
    this.hudScoreBg = undefined;
    this.hudScoreLabel = undefined;
    this.hudScoreText = undefined;
    this.hudLivesBg = undefined;
    this.hudTitlePill = undefined;
    this.hudTitleText = undefined;
    this.hudTitleDom = undefined;
    this.hudExerciseTitle = "";
    this.hudQuestionText = undefined;
    this.hudQuestionDom = undefined;
    this.hudHearts = [];
    this.hudQuestionProgress = undefined;
    this.hudScoreTargetX = 0;
    this.hudScoreTargetY = 0;
    this.hudTopBarBottomY = 0;
  }

  private applyCharacterVisualScale() {
    const character = this.character;
    if (!character) return;
    const src = character.texture.getSourceImage() as { width?: number; height?: number };
    const srcH = src?.height ?? 1;
    const { height } = this.scale;
    const targetH = this.mobile ? height * 0.14 : height * 0.2;
    character.setScale(targetH / srcH);
  }

  private refreshCharacterPhysicsBody() {
    const character = this.character;
    if (!character?.body) return;
    const body = character.body as Phaser.Physics.Arcade.Body;
    const frameW = character.width;
    const frameH = character.height;
    body.setSize(frameW * FLAPPY_CHAR_HIT_W_RATIO, frameH * FLAPPY_CHAR_HIT_H_RATIO, true);
  }

  private ensureFlappyHitboxDebugGfx() {
    if (!isFlappyHitboxDebugEnabled()) return;
    if (this.hitboxDebugGfx?.active) return;
    this.hitboxDebugGfx = this.add
      .graphics()
      .setScrollFactor(0)
      .setDepth(10000);
  }

  private destroyFlappyHitboxDebugGfx() {
    this.hitboxDebugGfx?.destroy();
    this.hitboxDebugGfx = undefined;
  }

  /** วาดกรอบ hitbox — เขียว=ตัวละคร, แดง=sprite bounds, ฟ้า=choice */
  private drawFlappyHitboxDebug() {
    if (!isFlappyHitboxDebugEnabled()) {
      this.destroyFlappyHitboxDebugGfx();
      return;
    }
    this.ensureFlappyHitboxDebugGfx();
    const gfx = this.hitboxDebugGfx;
    if (!gfx) return;
    gfx.clear();

    const character = this.character;
    if (character?.body) {
      const body = character.body as Phaser.Physics.Arcade.Body;
      gfx.lineStyle(2, 0x22c55e, 1);
      gfx.strokeRect(body.x, body.y, body.width, body.height);
      const bounds = character.getBounds();
      gfx.lineStyle(1, 0xef4444, 0.75);
      gfx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
    }

    for (const entry of this.activeChoices) {
      if (entry.resolved) continue;
      const body = entry.sprite.body as Phaser.Physics.Arcade.Body | undefined;
      if (!body) continue;
      gfx.lineStyle(1, 0x38bdf8, 0.9);
      gfx.strokeRect(body.x, body.y, body.width, body.height);
    }
  }

  /** จำกัดเพดานการบิน — ตัวละครไม่ทับแถว HUD บน (เวลา/หัวใจ) */
  private refreshCharacterFlightBounds() {
    const character = this.character;
    const safe = this.getFlappySafeArea();
    const width = safe.width;
    const height = safe.height;
    const ui = createHudScaleCtx(width, height, this.mobile);
    const pad = ui.px(this.mobile ? 4 : 6);
    const hudTopBottom =
      this.hudTopBarBottomY > 0
        ? this.hudTopBarBottomY
        : safe.y + ui.px(this.mobile ? 12 : 18) + ui.px(this.mobile ? 42 : 50);
    const halfH = character ? character.displayHeight * 0.5 : ui.px(36);
    const bottomPad = ui.px(this.mobile ? 8 : 12);
    this.characterFlightMinY = hudTopBottom + halfH + pad;
    this.characterFlightMaxY = safe.y + height - halfH - bottomPad;

    if (!this.gameplayActive || !character?.body) return;
    const topBound = Math.max(0, this.characterFlightMinY - halfH);
    const bottomBound = Math.max(topBound + 80, this.characterFlightMaxY + halfH);
    this.physics.world.setBounds(safe.x, topBound, width, bottomBound - topBound);
    if (character.y < this.characterFlightMinY) {
      character.y = this.characterFlightMinY;
    } else if (character.y > this.characterFlightMaxY) {
      character.y = this.characterFlightMaxY;
    }
    const body = character.body as Phaser.Physics.Arcade.Body;
    body.setVelocity(0, 0);
    body.reset(character.x, character.y);
  }

  private startCharacterFloating(centerX: number, centerY: number) {
    this.stopCharacterFloating();
    const character = this.character;
    if (!character) return;

    character.setPosition(centerX, centerY);
    const bob = this.tweens.add({
      targets: character,
      y: centerY - 22,
      duration: 880,
      ease: "Sine.easeInOut",
      yoyo: true,
      repeat: -1,
    });
    /** ตัดการแกว่งมุมตอนหน้า Home เพื่อลดอาการภาพสั่น */
    this.characterIdleTweens.push(bob);
  }

  private stopCharacterFloating() {
    this.characterIdleTweens.forEach((t) => t.stop());
    this.characterIdleTweens = [];
  }

  protected override onBeforeEndGame() {
    this.destroyFlappyHitboxDebugGfx();
    this.destroyHowToPopup();
    this.destroyTopHud();
    this.destroyFlappyTeacherAndMessage();
    this.teardownGameplayInput();
    this.clearActiveQuestion();
    this.gameplayActive = false;
    /** ให้ฉากหลังวิ่งต่อใต้หน้า Result */
    this.parallaxActive = true;
    /** หน้า Result แสดงจำนวนข้อที่ทำได้/ทั้งหมด */
    // totalQuestions ยังใช้ getRunstateQuestionTotal() ผ่าน flappyTotalQuestions
    /**
     * คงฉากไว้ด้านหลัง ResultScene เพื่อให้พื้นหลังหน้าจบเหมือนหน้าเกม
     * (ResultScene จะมี overlay ดำครอบบางส่วนเอง)
     */
  }

  protected override getRunstateQuestionTotal(): number {
    return (
      this.totalQuestions ??
      this.flappyTotalQuestions ??
      this.flappyPayload?.questions?.length ??
      0
    );
  }

  protected override getResultCorrectCount(): number {
    return this.completedQuestionCount;
  }

  protected override getResultScoreLabel(): string | undefined {
    return this.gameFailedByNoLives ? "ไม่ผ่าน" : undefined;
  }

  private playSfx(key: string, volume = 1) {
    guardedScenePlay(this, key, volume);
  }

  protected onGameAudioSettingsChanged(): void {
    const key = this.bgmCurrentKey;
    const bgm = this.bgmCurrent;

    if (!canPlayGameAudio("background")) {
      if (bgm) this.stopBgm(0);
      return;
    }

    if (!key) return;

    if (bgm?.isPlaying) {
      this.killBgmTweens(bgm);
      try {
        (bgm as Phaser.Sound.WebAudioSound).setVolume(GAME_BGM_VOLUME_FADE);
      } catch {}
      return;
    }

    this.playBgm(key);
  }

  /** หยุด tween volume ก่อน destroy — กัน WebAudio gain=null ตอน tween ยังรันอยู่ */
  private killBgmTweens(sound?: Phaser.Sound.BaseSound) {
    if (!sound) return;
    this.tweens.killTweensOf(sound);
  }

  private destroyBgmSound(sound?: Phaser.Sound.BaseSound) {
    if (!sound) return;
    this.killBgmTweens(sound);
    try {
      if (sound.isPlaying) sound.stop();
    } catch {}
    try {
      sound.destroy();
    } catch {}
  }

  private fadeOutAndDestroyBgm(sound: Phaser.Sound.BaseSound, fadeMs: number) {
    this.killBgmTweens(sound);
    if (fadeMs <= 0 || !sound.isPlaying) {
      this.destroyBgmSound(sound);
      return;
    }
    this.tweens.add({
      targets: sound,
      volume: 0,
      duration: fadeMs,
      onComplete: () => this.destroyBgmSound(sound),
    });
  }

  /** เปลี่ยน BGM (fade out ของเดิม → fade in ของใหม่). ถ้าเล่นอยู่แล้วจะไม่ทำซ้ำ */
  private playBgm(key: string, volume = GAME_BGM_VOLUME_FADE, fadeMs = 420) {
    if (!canPlayGameAudio("background")) {
      this.stopBgm(0);
      return;
    }
    if (this.bgmCurrentKey === key && this.bgmCurrent?.isPlaying) return;

    const oldBgm = this.bgmCurrent;
    this.bgmCurrent = undefined;
    this.bgmCurrentKey = undefined;
    if (oldBgm) this.fadeOutAndDestroyBgm(oldBgm, fadeMs);

    if (!this.cache.audio.exists(key)) return;
    const next = this.sound.add(key, { loop: true, volume: 0 });
    next.play();
    this.bgmCurrent = next;
    this.bgmCurrentKey = key;
    this.tweens.add({
      targets: next,
      volume,
      duration: fadeMs,
      onComplete: () => {
        if (this.bgmCurrent !== next) return;
        try {
          if (next.isPlaying) next.setVolume(volume);
        } catch {}
      },
    });
  }

  private stopBgm(fadeMs = 300) {
    const old = this.bgmCurrent;
    this.bgmCurrent = undefined;
    this.bgmCurrentKey = undefined;
    if (!old) return;
    this.fadeOutAndDestroyBgm(old, fadeMs);
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

    const safe = this.getFlappySafeArea();
    const width = safe.width;
    const height = safe.height;
    const howToKey = this.mobile ? "flappy_howto_mobile" : "flappy_howto_desktop";
    this.textures.get(howToKey).setFilter(Phaser.Textures.FilterMode.LINEAR);

    const overlay = this.add
      .rectangle(width / 2, height / 2, width, height, 0x000000, 0.55)
      .setScrollFactor(0)
      .setDepth(3500)
      .setInteractive();

    const source = this.textures.get(howToKey).getSourceImage() as { width?: number; height?: number };
    const srcW = source?.width ?? 1;
    const srcH = source?.height ?? 1;
    const imageMaxW = this.mobile ? width * 0.98 : width * 0.82;
    const imageMaxH = this.mobile ? height * 0.82 : height * 0.68;
    const imageScale = Math.min(imageMaxW / srcW, imageMaxH / srcH);
    const howToW = Math.max(1, srcW * imageScale);
    const howToH = Math.max(1, srcH * imageScale);
    const howToY = height * (this.mobile ? 0.45 : 0.42);
    const howToImage = this.add.image(width / 2, howToY, howToKey).setScrollFactor(0).setDepth(3501);
    howToImage.setDisplaySize(howToW, howToH);

    const { startKey: homeStartKey } = getHomeSceneButtonKeys(this.scene.key);
    const startButton = this.add
      .image(width / 2, Math.min(height - 38, howToY + howToH / 2 + (this.mobile ? 34 : 54)), homeStartKey)
      .setScrollFactor(0)
      .setDepth(3502);
    const startTex = startButton.texture.getSourceImage() as { width?: number; height?: number };
    const startW = startTex?.width ?? 1;
    const startH = startTex?.height ?? 1;
    const startMaxW = this.mobile ? width * 0.44 : Math.min(220, width * 0.28);
    const startScale = Math.min(startMaxW / startW, 1);
    startButton.setDisplaySize(Math.max(1, startW * startScale), Math.max(1, startH * startScale));
    startButton.setInteractive({ useHandCursor: true });
    startButton.once("pointerdown", () => {
      this.playSfx("sfx_click_default");
      this.destroyHowToPopup();
      if (this.scene.isActive("HomeScene")) this.scene.stop("HomeScene");
    });

    this.tutorialPopup = {
      overlay,
      howToImage,
      startButton,
      restoreSceneInputEnabled,
      restoreHomeInputEnabled,
    };

    if (this.mobile) {
      let isZoomed = false;
      const baseScaleX = howToImage.scaleX;
      const baseScaleY = howToImage.scaleY;
      const baseX = howToImage.x;
      const baseY = howToImage.y;
      const zoomScale = 1.35;
      const clampZoomPosition = (targetX: number, targetY: number) => {
        const halfW = (srcW * baseScaleX * zoomScale) / 2;
        const halfH = (srcH * baseScaleY * zoomScale) / 2;
        const minX = width - halfW;
        const maxX = halfW;
        const minY = height - halfH;
        const maxY = halfH;
        return {
          x: Phaser.Math.Clamp(targetX, minX, maxX),
          y: Phaser.Math.Clamp(targetY, minY, maxY),
        };
      };

      howToImage.setInteractive({ useHandCursor: true, draggable: true });
      this.input.setDraggable(howToImage, true);

      let pointerDownAt = 0;
      let dragMoved = false;
      howToImage.on("pointerdown", () => {
        pointerDownAt = this.time.now;
        dragMoved = false;
      });
      howToImage.on("drag", (_pointer: Phaser.Input.Pointer, dragX: number, dragY: number) => {
        if (!isZoomed) return;
        dragMoved = true;
        const p = clampZoomPosition(dragX, dragY);
        howToImage.setPosition(p.x, p.y);
      });
      howToImage.on("pointerup", () => {
        const isTap = this.time.now - pointerDownAt < 220 && !dragMoved;
        if (!isTap) return;
        isZoomed = !isZoomed;
        if (isZoomed) {
          this.tweens.add({
            targets: howToImage,
            scaleX: baseScaleX * zoomScale,
            scaleY: baseScaleY * zoomScale,
            duration: 180,
            ease: "Quad.easeOut",
          });
          startButton.setAlpha(0.45);
        } else {
          this.tweens.add({
            targets: howToImage,
            x: baseX,
            y: baseY,
            scaleX: baseScaleX,
            scaleY: baseScaleY,
            duration: 180,
            ease: "Quad.easeOut",
          });
          startButton.setAlpha(1);
        }
      });
    }
  }

  private destroyHowToPopup() {
    const popup = this.tutorialPopup;
    this.tutorialPopup = undefined;
    popup?.overlay.destroy();
    popup?.howToImage.destroy();
    popup?.startButton.destroy();
    if (popup) {
      this.input.enabled = popup.restoreSceneInputEnabled;
      const homeScene = this.scene.get("HomeScene");
      if (homeScene?.input && this.scene.isActive("HomeScene")) {
        homeScene.input.enabled = popup.restoreHomeInputEnabled;
      }
    }
  }

  /** เหมือน situation: ใช้ payload ที่ main ส่งมาตอน start scene — ไม่อ่านจากไฟล์ local */
  private async fetchFlappyBirdData(): Promise<FlappyBirdPayload> {
    if (this.injectedPayload) {
      return this.injectedPayload as unknown as FlappyBirdPayload;
    }
    throw new Error("Missing injected payload for scene: flappy-bird");
  }

  private resolveUrl(pathOrUrl?: string | null): string {
    const raw = (pathOrUrl ?? "").trim();
    if (!raw) return "";
    const normalized = raw.toLowerCase();
    if (normalized === "null" || normalized === "undefined") return "";
    if (/^https?:\/\//i.test(raw)) return raw;
    return `${API_BASE_URL}${raw}`;
  }

  /** เสียงคำถามหลัก: ใช้ sound_question ก่อน แล้ว fallback ไป sound_hint */
  private getQuestionVoiceUrl(question: FlappyBirdQuestion): string {
    return this.resolveUrl(question.sound_question) || this.resolveUrl(question.sound_hint);
  }

  /** รูปคำถามหลัก: ใช้ image_question ก่อน แล้ว fallback ไป image_hint */
  private getQuestionImageUrl(question: FlappyBirdQuestion): string {
    return this.resolveUrl(question.image_question) || this.resolveUrl(question.image_hint);
  }

  /** preload เสียง/รูปของทุกข้อ — เรียกหลังได้ payload ก่อนเริ่มเล่นจริง */
  private async preloadQuestionAssets(payload: FlappyBirdPayload): Promise<void> {
    const audioJobs: Array<{ key: string; url: string }> = [];
    const imageJobs: Array<{ key: string; url: string }> = [];

    const registerAudio = (raw?: string | null) => {
      const url = this.resolveUrl(raw);
      if (!url || this.audioKeyByUrl.has(url)) return;
      const key = `flappy_audio_${this.audioKeyByUrl.size}`;
      this.audioKeyByUrl.set(url, key);
      if (!this.cache.audio.exists(key)) audioJobs.push({ key, url });
    };
    const registerImage = (raw?: string | null) => {
      const url = this.resolveUrl(raw);
      if (!url || this.textureKeyByUrl.has(url)) return;
      const key = `flappy_tex_${this.textureKeyByUrl.size}`;
      this.textureKeyByUrl.set(url, key);
      if (!this.textures.exists(key)) imageJobs.push({ key, url });
    };

    for (const q of payload.questions ?? []) {
      registerAudio(q.sound_question);
      registerAudio(q.sound_hint);
      registerImage(q.image_question);
      registerImage(q.image_hint);
      for (const c of q.choices ?? []) {
        registerAudio(c.sound_choice);
        registerImage(c.image_choice);
      }
    }

    if (!audioJobs.length && !imageJobs.length) return;

    for (const a of audioJobs) this.load.audio(a.key, a.url);
    for (const i of imageJobs) this.load.image(i.key, i.url);

    await new Promise<void>((resolve) => {
      const onComplete = () => {
        this.load.off(Phaser.Loader.Events.COMPLETE, onComplete);
        resolve();
      };
      this.load.once(Phaser.Loader.Events.COMPLETE, onComplete);
      this.load.start();
    });
  }

  /** เรียกครั้งเดียวตอนเริ่ม gameplay — เริ่มข้อแรก */
  private beginQuestionFlow() {
    const total = this.flappyPayload?.questions?.length ?? 0;
    if (!total) return;
    this.flappyTotalQuestions = total;
    this.totalQuestions = total;
    this.lives = MAX_LIVES;
    this.gameFailedByNoLives = false;
    this.correctCount = 0;
    this.completedQuestionCount = 0;
    this.score = 0;
    this.eliminatedChoiceIdsByQuestion.clear();
    this.answeredCorrectChoiceIdsByQuestion.clear();
    this.refreshHudLives();
    this.refreshHudScoreCounter();
    this.questionQueue = Array.from({ length: total }, (_, i) => i);
    this.startNextQuestion();
  }

  private startHudElapsedTimerIfNeeded() {
    if (this.hudElapsedRunning) return;
    this.hudElapsedRunning = true;
    this.startTime = Date.now();
    this.hudTimeText?.setText(this.formatElapsedTime());
  }

  private startNextQuestion() {
    this.clearActiveQuestion(true);

    if (!this.gameplayActive) return;
    if (this.lives <= 0) return;

    const payload = this.flappyPayload;
    if (!payload) return;

    if (!this.questionQueue.length) {
      this.completeAllQuestions();
      return;
    }

    const questionIndex = this.questionQueue.shift() as number;
    const question = payload.questions[questionIndex];
    if (!question) return;

    this.startHudElapsedTimerIfNeeded();

    this.syncGameAudioFromQuestion(question);

    const questionVoiceUrl = this.getQuestionVoiceUrl(question);
    const questionImageUrl = this.getQuestionImageUrl(question);
    const hasSoundQuestion = !!questionVoiceUrl;
    this.setHudQuestion(
      question.question ?? "",
      hasSoundQuestion,
      () => {
        this.playUrlAudio(questionVoiceUrl);
      },
      questionImageUrl
    );

    const answeredCorrect =
      this.answeredCorrectChoiceIdsByQuestion.get(questionIndex) ?? new Set<number>();
    const remainingCorrectIds = new Set(
      (question.choices ?? [])
        .filter((c) => this.isChoiceCorrect(c) && !answeredCorrect.has(c.id))
        .map((c) => c.id)
    );

    if (remainingCorrectIds.size === 0) {
      this.time.delayedCall(0, () => this.startNextQuestion());
      return;
    }

    this.playNewQuestionAlertFx();

    this.activeQuestion = {
      questionIndex,
      question,
      remainingChoices: [],
      spawnedCount: 0,
      resolved: false,
      remainingCorrectIds,
    };
    this.refreshFlappyQuestionProgressHud();

    const sqUrl = this.resolveUrl(question.sound_question);
    const shUrl = this.resolveUrl(question.sound_hint);
    const hintHasSound = !!shUrl && !!sqUrl && shUrl !== sqUrl;

    if (hasSoundQuestion && hintHasSound) {
      // เสียงโจทย์เล่นจบก่อน แล้วค่อยขึ้นคำใบ้ + เสียงคำใบ้
      this.spawnChoicesForActiveQuestion();
      const qKey = this.audioKeyByUrl.get(questionVoiceUrl);
      guardedScenePlayQuestionThen(this, qKey, 1, () => {
        if (!this.sys.isActive()) return;
        this.showFlappyQuestionHintBubble(question);
        this.time.delayedCall(150, () => this.playFlappyHintSound(question));
      });
    } else {
      if (hasSoundQuestion) {
        this.playUrlAudio(questionVoiceUrl);
      }
      this.spawnChoicesForActiveQuestion();
      this.showFlappyQuestionHintBubble(question);
      this.time.delayedCall(600, () => this.playFlappyHintSound(question));
    }
  }

  private playFlappyHintSound(question: FlappyBirdQuestion) {
    const sq = this.resolveUrl(question.sound_question);
    const sh = this.resolveUrl(question.sound_hint);
    if (!sh || (sq && sh === sq)) return;
    this.playUrlAudio(question.sound_hint);
  }

  /** สุ่มลำดับ choice แล้ว spawn ทีละตัวให้ลอยเข้ามาจากขวา */
  private spawnChoicesForActiveQuestion() {
    const active = this.activeQuestion;
    if (!active) return;
    const eliminated = this.eliminatedChoiceIdsByQuestion.get(active.questionIndex);
    const answeredCorrect = this.answeredCorrectChoiceIdsByQuestion.get(active.questionIndex);
    const isAlreadyScoredCorrect = (c: FlappyBirdChoice) =>
      !!answeredCorrect?.has(c.id) && this.isChoiceCorrect(c);
    let choices = [...(active.question.choices ?? [])].filter(
      (c) => !eliminated?.has(c.id) && !isAlreadyScoredCorrect(c)
    );
    /** กันเคสผิดปกติ: ถ้าถูกคัดจนหมด ให้ fallback กลับทั้งชุด (ยกเว้นที่ตอบถูกไปแล้ว) */
    if (!choices.length) {
      this.eliminatedChoiceIdsByQuestion.delete(active.questionIndex);
      choices = [...(active.question.choices ?? [])].filter((c) => !isAlreadyScoredCorrect(c));
    }
    if (coerceShuffleAnswer(active.question.shuffle_answer)) {
      Phaser.Utils.Array.Shuffle(choices);
    }

    const safe = this.getFlappySafeArea();
    const width = safe.width;
    const height = safe.height;
    /** ขยับช่วงของ choice — เพิ่ม maxY ลงต่ำขึ้นให้ไม่โล่ง */
    const minY = Math.max(safe.y + height * 0.22, this.choiceSpawnMinY);
    const maxY = safe.y + height * 0.82;
    const safeMinY = Math.min(minY, maxY - 4);
    const minGapY = height * 0.16;

    /** สุ่ม Y โดยพยายามไม่ให้ใกล้กันเกิน minGapY (ถ้าหาที่ไม่ได้ใน 12 ครั้ง ก็ใช้ค่าล่าสุด) */
    const pickY = (others: number[]): number => {
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const y = Phaser.Math.Between(safeMinY, maxY);
        if (others.every((other) => Math.abs(other - y) >= minGapY)) return y;
      }
      return Phaser.Math.Between(safeMinY, maxY);
    };

   
    const xStride = Math.max(width * 0.28, 220);
    const usedY: number[] = [];

    choices.forEach((choice, idx) => {
      const y = pickY(usedY);
      usedY.push(y);
      const spawnX = safe.x + width + 120 + idx * xStride + Phaser.Math.Between(-40, 60);
      const sprite = this.buildChoiceSprite(choice, spawnX, y);
      const entry: ActiveChoice = {
        sprite,
        choice,
        questionIndex: active.questionIndex,
        resolved: false,
        speaker: sprite.getData("flappySpeaker") as Phaser.GameObjects.Image | undefined,
        audioKey: sprite.getData("flappyAudioKey") as string | undefined,
        centerAutoPlayed: false,
      };
      this.activeChoices.push(entry);
      active.remainingChoices.push(entry);
      active.spawnedCount += 1;

      /** ลอยขึ้นลงกว้างขึ้น ให้เด็กต้องบังคับตัวละครตามอย่างสนุก */
      const bobAmp = Phaser.Math.Between(38, 62);
      const bobDur = Phaser.Math.Between(900, 1400);
      this.tweens.add({
        targets: sprite,
        y: { from: sprite.y - bobAmp, to: sprite.y + bobAmp },
        duration: bobDur,
        ease: "Sine.easeInOut",
        yoyo: true,
        repeat: -1,
      });
    });

    /** timer "ตอบไม่ทัน": รอ choice ตัวสุดท้ายลอยพ้นจอ */
    const lastSpawnExtraMs =
      ((choices.length - 1) * xStride / Math.max(1, width + 240)) * CHOICE_TRAVEL_DURATION_MS;
    active.timeoutEvent = this.time.delayedCall(CHOICE_TRAVEL_DURATION_MS + lastSpawnExtraMs + 400, () => {
      if (active.resolved) return;
      this.handleQuestionTimeout(active);
    });
  }

  private addFlappyChoiceSpeaker(
    container: ChoiceSprite,
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
    speaker.setData("baseScale", speaker.scaleX);
    container.setData("flappySpeaker", speaker);
    container.setData("flappyAudioKey", audioKey);
    speaker.on(
      "pointerdown",
      (_p: Phaser.Input.Pointer, _lx: number, _ly: number, event: Phaser.Types.Input.EventData) => {
        event.stopPropagation();
        const key = container.getData("flappyAudioKey") as string | undefined;
        if (!key) return;
        const entry = this.activeChoices.find((c) => c.sprite === container);
        if (!entry || entry.resolved) return;
        this.enqueueFlappyChoiceAudio({ entry, speaker, key });
      }
    );
    container.add(speaker);
    return speaker;
  }

  private buildChoiceSprite(choice: FlappyBirdChoice, x: number, y: number): ChoiceSprite {
    const mobile = this.mobile;
    const tc = mobile ? CHOCIE_CHOICE_TUNING.mobile : CHOCIE_CHOICE_TUNING.desktop;
    const bgKey = "flappy_choice_bg";
    const bgTex = this.textures.get(bgKey).getSourceImage() as { width: number; height: number };
    const ui = createHudScaleCtx(this.scale.width, this.scale.height, mobile);
    const cardW = ui.px(tc.wMax);
    const container = this.add.container(x, y).setDepth(80) as ChoiceSprite;
    const bgScale = cardW / Math.max(1, bgTex.width);
    const bg = this.add.image(0, 0, bgKey).setScale(bgScale);
    container.add(bg);
    const bW = bg.displayWidth;
    const bH = bg.displayHeight;

    const word = (choice.choice ?? "").trim();
    const imgUrl = this.resolveUrl(choice.image_choice);
    const audioUrl = this.resolveUrl(choice.sound_choice);
    const hasText = word.length > 0;
    const hasImage = !!imgUrl && this.textureKeyByUrl.has(imgUrl);
    const hasAudio = !!audioUrl && this.audioKeyByUrl.has(audioUrl);
    const imgKey = hasImage ? (this.textureKeyByUrl.get(imgUrl) as string) : undefined;
    const audioKey = hasAudio ? (this.audioKeyByUrl.get(audioUrl) as string) : undefined;
    const textRes = Math.min(3, typeof window !== "undefined" ? window.devicePixelRatio || 2 : 2);
    const speakerSize = tc.speakerSize;
    const boxBottom = getChocieInnerBottom(bH, tc.labelBoxBottomTrim);

    let hitTop = -bH / 2;
    let hitBottom = bH / 2;
    let hitW = bW;
    const glowRegions: FlappyChoiceGlowRegion[] = [];

    if (hasImage && imgKey) {
      const {
        frameW,
        frameH,
        frameCenterY,
        frameBottom,
        frameLeft,
      } = resolveChocieChoiceImageFrameLayout(bH, bW, tc, mobile, hasText, hasAudio, speakerSize);
      const pad = mobile ? 6 : 8;

      const frame = this.add.graphics().setDepth(8);
      frame.setPosition(0, frameCenterY);
      drawQuestionMediaFrameBox(frame, frameW, frameH);
      container.add(frame);

      const tex = this.textures.get(imgKey).getSourceImage() as { width: number; height: number };
      const fit = fitQuestionMediaContainSize(tex.width, tex.height, frameW - pad * 2, frameH - pad * 2);
      container.add(this.add.image(0, frameCenterY, imgKey).setDisplaySize(fit.imageW, fit.imageH).setDepth(9));
      glowRegions.push({
        left: -frameW / 2,
        top: frameCenterY - frameH / 2,
        width: frameW,
        height: frameH,
        radius: getQuestionMediaFrameRadius(frameW),
      });

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
          { imageTextGap: tc.imageFrameGap, speakerPillOverlap: tc.speakerPillOverlap }
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
        glowRegions.push({
          left: overlay.pillLeft,
          top: overlay.pillTop,
          width: overlay.pillW,
          height: overlay.pillH,
          radius: mobile ? 8 : 10,
        });
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
          this.addFlappyChoiceSpeaker(
            container,
            overlay.speakerX,
            overlay.speakerY,
            overlay.speakerSize,
            audioKey
          );
        }

        hitTop = frameCenterY - frameH / 2;
        hitBottom = boxBottom;
        hitW = Math.max(bW, frameW, overlay.pillW + (hasAudio ? speakerSize * 0.65 : 0));
      } else if (hasAudio && audioKey) {
        this.addFlappyChoiceSpeaker(container, frameLeft + speakerSize * 0.28, frameBottom, speakerSize, audioKey);
        hitTop = frameCenterY - frameH / 2;
        hitBottom = boxBottom;
        hitW = Math.max(bW, frameW);
      } else {
        hitTop = frameCenterY - frameH / 2;
        hitBottom = boxBottom;
        hitW = Math.max(bW, frameW);
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
        glowRegions.push({
          left: layout.pillLeft,
          top: layout.pillTop,
          width: layout.pillW,
          height: layout.pillH,
          radius: mobile ? 10 : 12,
        });
        container.add(
          this.add
            .text(layout.textCenterX, layout.textCenterY, word, {
              ...chocieThaiGameTextStyle({ mobile, fontPx, tightBottom: true }),
            })
            .setOrigin(0.5, 0.5)
            .setDepth(11)
            .setResolution(textRes)
        );
        this.addFlappyChoiceSpeaker(
          container,
          layout.speakerX,
          layout.speakerY,
          layout.speakerSize,
          audioKey
        );
        hitW = Math.max(bW, layout.pillW + layout.speakerSize * 0.65);
        hitTop = layout.pillTop;
        hitBottom = layout.pillTop + layout.pillH;
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
        glowRegions.push({
          left: pillLeft,
          top: pillTop,
          width: pillW,
          height: pillH,
          radius: mobile ? 10 : 12,
        });
        container.add(
          this.add
            .text(0, boxCenterY, word, {
              ...chocieThaiGameTextStyle({ mobile, fontPx, tightBottom: true }),
            })
            .setOrigin(0.5, 0.5)
            .setDepth(11)
            .setResolution(textRes)
        );
        hitW = Math.max(bW, pillW);
        hitTop = pillTop;
        hitBottom = pillTop + pillH;
      }
    } else if (hasAudio && audioKey) {
      const boxCenterY = getChocieInnerCenterY(bH, tc.labelBoxTopTrim, tc.labelBoxBottomTrim);
      this.addFlappyChoiceSpeaker(container, 0, boxCenterY, speakerSize, audioKey);
      hitTop = boxCenterY - speakerSize / 2;
      hitBottom = boxCenterY + speakerSize / 2;
      hitW = Math.max(bW, speakerSize);
    }

    this.physics.add.existing(container);
    const body = container.body as Phaser.Physics.Arcade.Body;
    body.setAllowGravity(false);
    const colW = hitW;
    const colH = hitBottom - hitTop;
    body.setSize(colW, colH);
    body.setOffset(-colW / 2, hitTop);

    const travelDist = this.scale.width + bW + 240;
    const vx = Math.round(-travelDist / (CHOICE_TRAVEL_DURATION_MS / 1000));
    body.setVelocity(vx, 0);

    container.setData("flappyChoiceGlowRegions", glowRegions);
    return container;
  }

  private setFlappyChoiceSpeakerTexture(speaker: Phaser.GameObjects.Image, textureKey: string) {
    const w = speaker.displayWidth;
    const h = speaker.displayHeight;
    speaker.setTexture(textureKey);
    speaker.setDisplaySize(w, h);
    speaker.setData("baseScale", speaker.scaleX);
  }

  private getFlappyChoiceGlowIntensity(entry: ActiveChoice, phase: number): number {
    const playing = this.flappyChoicePlayingEntry === entry && this.flappyChoicePlayingSound?.isPlaying;
    if (!playing) return 0.5 + 0.5 * Math.sin(phase);

    const slow = 0.5 + 0.5 * Math.sin(phase);
    const mid = 0.5 + 0.5 * Math.sin(phase * 2.6 + 0.4);
    const fast = 0.5 + 0.5 * Math.sin(phase * 5.1 + 1.1);
    return Phaser.Math.Clamp(0.32 + 0.38 * slow + 0.22 * mid + 0.18 * fast, 0.28, 1);
  }

  private drawFlappyChoiceAudioGlow(
    gfx: Phaser.GameObjects.Graphics,
    regions: FlappyChoiceGlowRegion[],
    intensity: number
  ) {
    gfx.clear();
    if (!regions.length) return;

    const layers = [
      { expand: 14, width: 16, color: 0xff3d5a, alpha: 0.1 },
      { expand: 9, width: 11, color: 0xff4f68, alpha: 0.16 },
      { expand: 5, width: 7, color: 0xff6278, alpha: 0.24 },
      { expand: 2, width: 4, color: 0xff7b8c, alpha: 0.34 },
    ];

    for (const region of regions) {
      for (const layer of layers) {
        const expand = layer.expand * intensity;
        gfx.lineStyle(layer.width, layer.color, layer.alpha * intensity);
        gfx.strokeRoundedRect(
          region.left - expand,
          region.top - expand,
          region.width + expand * 2,
          region.height + expand * 2,
          Math.min(region.radius + expand * 0.4, (region.height + expand * 2) / 2)
        );
      }
    }
  }

  private startFlappyChoiceCenterHighlight(entry: ActiveChoice) {
    this.stopFlappyChoiceCenterHighlight(entry);
    const sprite = entry.sprite;
    if (!sprite?.active) return;

    const glowRegions =
      (sprite.getData("flappyChoiceGlowRegions") as FlappyChoiceGlowRegion[] | undefined) ?? [];
    if (!glowRegions.length) return;

    const glow = this.add.graphics().setDepth(7);
    sprite.add(glow);
    entry.centerGlowGfx = glow;
    entry.centerGlowPhase = 0;

    if (entry.speaker?.active) {
      this.setFlappyChoiceSpeakerTexture(entry.speaker, FLAPPY_VOLUME_RED_TEXTURE_KEY);
    }

    const redraw = () => {
      if (!entry.centerGlowGfx?.active || !sprite.active) {
        this.stopFlappyChoiceCenterHighlight(entry);
        return;
      }
      entry.centerGlowPhase = (entry.centerGlowPhase ?? 0) + 0.2;
      const intensity = this.getFlappyChoiceGlowIntensity(entry, entry.centerGlowPhase);
      this.drawFlappyChoiceAudioGlow(entry.centerGlowGfx, glowRegions, intensity);
    };

    redraw();
    entry.centerGlowTimer = this.time.addEvent({
      delay: 45,
      loop: true,
      callback: redraw,
    });
  }

  private stopFlappyChoiceCenterHighlight(entry: ActiveChoice) {
    entry.centerGlowTimer?.remove(false);
    entry.centerGlowTimer = undefined;
    entry.centerGlowGfx?.destroy();
    entry.centerGlowGfx = undefined;
    entry.centerGlowPhase = undefined;
    if (entry.speaker?.active) {
      this.setFlappyChoiceSpeakerTexture(entry.speaker, HUD_VOLUME_TEXTURE_KEY);
    }
  }

  private startFlappySpeakerPulse(speaker: Phaser.GameObjects.Image) {
    this.stopFlappySpeakerPulse(speaker);
    const baseScale =
      (speaker.getData("baseScale") as number | undefined) ?? speaker.scaleX;
    speaker.setData("baseScale", baseScale);
    this.tweens.add({
      targets: speaker,
      scale: { from: baseScale, to: baseScale * 1.18 },
      duration: 320,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });
  }

  private stopFlappySpeakerPulse(speaker?: Phaser.GameObjects.Image) {
    if (!speaker?.active) return;
    this.tweens.killTweensOf(speaker);
    const baseScale = speaker.getData("baseScale") as number | undefined;
    if (baseScale) speaker.setScale(baseScale);
  }

  private stopFlappyChoiceAudioForEntry(entry: ActiveChoice) {
    this.flappyChoiceAudioQueue = this.flappyChoiceAudioQueue.filter((job) => job.entry !== entry);
    this.stopFlappyChoiceCenterHighlight(entry);
    if (this.flappyChoicePlayingEntry !== entry) return;

    if (this.flappyChoicePlayingSound) {
      try {
        this.flappyChoicePlayingSound.stop();
        this.flappyChoicePlayingSound.destroy();
      } catch {
        /* noop */
      }
      this.flappyChoicePlayingSound = undefined;
    }
    if (this.flappyChoicePlayingSpeaker?.active) {
      this.stopFlappySpeakerPulse(this.flappyChoicePlayingSpeaker);
    }
    this.flappyChoicePlayingSpeaker = undefined;
    this.flappyChoicePlayingEntry = undefined;
    this.flappyChoiceAudioBusy = false;
    this.pumpFlappyChoiceAudioQueue();
  }

  private enqueueFlappyChoiceAudio(job: FlappyChoiceAudioJob) {
    if (!job.key || !canPlayGameAudio("choice")) return;
    this.flappyChoiceAudioQueue.push(job);
    this.pumpFlappyChoiceAudioQueue();
  }

  private pumpFlappyChoiceAudioQueue() {
    if (this.flappyChoiceAudioBusy) return;
    while (this.flappyChoiceAudioQueue.length > 0) {
      const job = this.flappyChoiceAudioQueue.shift()!;
      if (job.entry.resolved) continue;
      if (!this.cache.audio.exists(job.key)) continue;
      this.flappyChoiceAudioBusy = true;
      if (job.centerHighlight) this.startFlappyChoiceCenterHighlight(job.entry);
      if (job.speaker?.active) this.startFlappySpeakerPulse(job.speaker);

      this.sound.stopByKey(job.key);
      const sound = this.sound.add(job.key, { volume: 1 });
      this.flappyChoicePlayingSound = sound;
      this.flappyChoicePlayingSpeaker = job.speaker;
      this.flappyChoicePlayingEntry = job.entry;

      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        if (job.speaker?.active) this.stopFlappySpeakerPulse(job.speaker);
        if (job.centerHighlight) this.stopFlappyChoiceCenterHighlight(job.entry);
        try {
          sound.destroy();
        } catch {
          /* noop */
        }
        if (this.flappyChoicePlayingSound === sound) this.flappyChoicePlayingSound = undefined;
        if (this.flappyChoicePlayingSpeaker === job.speaker) {
          this.flappyChoicePlayingSpeaker = undefined;
        }
        if (this.flappyChoicePlayingEntry === job.entry) {
          this.flappyChoicePlayingEntry = undefined;
        }
        this.flappyChoiceAudioBusy = false;
        this.pumpFlappyChoiceAudioQueue();
      };

      sound.once("complete", finish);
      sound.play();
      const durationMs = sound.duration && sound.duration > 0 ? sound.duration * 1000 : 3000;
      this.time.delayedCall(durationMs + 200, finish);
      return;
    }
  }

  private stopFlappyChoiceAudioPipeline() {
    this.flappyChoiceAudioQueue = [];
    if (this.flappyChoicePlayingEntry) {
      this.stopFlappyChoiceCenterHighlight(this.flappyChoicePlayingEntry);
    }
    if (this.flappyChoicePlayingSound) {
      try {
        this.flappyChoicePlayingSound.stop();
        this.flappyChoicePlayingSound.destroy();
      } catch {
        /* noop */
      }
      this.flappyChoicePlayingSound = undefined;
    }
    if (this.flappyChoicePlayingSpeaker?.active) {
      this.stopFlappySpeakerPulse(this.flappyChoicePlayingSpeaker);
    }
    this.flappyChoicePlayingSpeaker = undefined;
    this.flappyChoicePlayingEntry = undefined;
    this.flappyChoiceAudioBusy = false;
  }

  private updateChoiceCenterAutoPlay(entry: ActiveChoice, centerX: number) {
    if (entry.resolved || !entry.audioKey || entry.centerAutoPlayed) return;
    const x = entry.sprite.x;
    const prevX = entry.prevScreenX ?? x + 80;
    entry.prevScreenX = x;
    const crossedCenter = prevX > centerX && x <= centerX;
    if (!crossedCenter) return;
    entry.centerAutoPlayed = true;
    this.enqueueFlappyChoiceAudio({
      entry,
      speaker: entry.speaker?.active ? entry.speaker : undefined,
      key: entry.audioKey,
      centerHighlight: true,
    });
  }

  private playUrlAudio(raw?: string | null, kind: "question" | "choice" = "question") {
    const url = this.resolveUrl(raw);
    if (!url) return;
    const key = this.audioKeyByUrl.get(url);
    if (!key) return;
    if (kind === "choice") guardedScenePlayChoice(this, key, 1);
    else guardedScenePlayQuestion(this, key, 1);
  }

  /** ตรวจชนตัวละครกับ choice — เรียกใน update() */
  private updateChoiceCollisions() {
    const character = this.character;
    if (!character || !this.gameplayActive) return;
    const charBody = character.body as Phaser.Physics.Arcade.Body | undefined;
    if (!charBody) return;

    const safe = this.getFlappySafeArea();
    const centerX = safe.x + safe.width / 2;

    for (let i = this.activeChoices.length - 1; i >= 0; i -= 1) {
      const entry = this.activeChoices[i];
      if (entry.resolved) continue;
      /** snap ตำแหน่งให้ตรงพิกเซล เพื่อลดอาการตัวอักษรสั่นตอนเคลื่อนที่ */
      entry.sprite.x = Math.round(entry.sprite.x);
      entry.sprite.y = Math.round(entry.sprite.y);
      this.updateChoiceCenterAutoPlay(entry, centerX);
      const body = entry.sprite.body as Phaser.Physics.Arcade.Body;
      if (
        Phaser.Geom.Intersects.RectangleToRectangle(
          charBody as unknown as Phaser.Geom.Rectangle,
          body as unknown as Phaser.Geom.Rectangle
        )
      ) {
        this.onCharacterHitChoice(entry);
        continue;
      }
      /** ลอยพ้นซ้ายจอ — ถ้ายังไม่ครบคำตอบที่ถูก ให้ข้อนี้กลับมาท้ายคิว */
      if (entry.sprite.x < -120) {
        this.removeChoice(entry);
        const activeQ = this.activeQuestion;
        if (activeQ) this.checkFlappyQuestionExhausted(activeQ);
      }
    }
  }

  private checkFlappyQuestionExhausted(active: ActiveQuestion) {
    if (active.resolved) return;
    if (active.remainingChoices.length > 0) return;
    if (active.remainingCorrectIds.size > 0) {
      this.deferFlappyQuestionForRetry(active);
    }
  }

  /** ตอบถูกไม่ครบ / พลาด choice ที่ถูก — คิวข้อนี้ไว้ท้ายรอบ แล้วไปข้อถัดไป */
  private deferFlappyQuestionForRetry(active: ActiveQuestion) {
    if (active.resolved) return;
    active.resolved = true;
    if (active.timeoutEvent) {
      active.timeoutEvent.remove(false);
      active.timeoutEvent = undefined;
    }
    this.questionQueue.push(active.questionIndex);
    this.clearActiveQuestion();
    this.time.delayedCall(400, () => this.startNextQuestion());
  }

  private completeFlappyQuestion(active: ActiveQuestion, hitSprite: ChoiceSprite, hitX: number, hitY: number) {
    if (active.resolved) return;
    active.resolved = true;
    this.answeredCorrectChoiceIdsByQuestion.delete(active.questionIndex);
    if (active.timeoutEvent) {
      active.timeoutEvent.remove(false);
      active.timeoutEvent = undefined;
    }
    const gained = Math.max(1, active.spawnedCount);
    this.score += gained;
    this.completedQuestionCount += 1;
    this.refreshHudScoreCounter();
    this.reportRunstateQuestionCompleted(active.questionIndex + 1);
    this.showFlappyTeacherCorrectPraise();
    this.flyChoicesToScore(active, hitSprite, gained, hitX, hitY);
  }

  private onSingleFlappyCorrectHit(active: ActiveQuestion, entry: ActiveChoice) {
    entry.resolved = true;
    active.remainingCorrectIds.delete(entry.choice.id);
    const scored = this.answeredCorrectChoiceIdsByQuestion.get(active.questionIndex) ?? new Set<number>();
    scored.add(entry.choice.id);
    this.answeredCorrectChoiceIdsByQuestion.set(active.questionIndex, scored);
    this.correctCount += 1;
    this.score += 1;
    this.refreshHudScoreCounter();

    const { x, y } = entry.sprite;
    this.flashChoice(entry.sprite, 0x9be8a4);
    this.createCorrectStarBurst(x, y - 40);
    this.tweens.add({
      targets: entry.sprite,
      alpha: 0,
      scale: { from: entry.sprite.scale, to: 0.5 },
      duration: 280,
      ease: "Cubic.easeIn",
      onComplete: () => this.removeChoice(entry, true),
    });

    if (active.remainingCorrectIds.size === 0) {
      this.completeFlappyQuestion(active, entry.sprite, x, y);
    }
  }

  private onCharacterHitChoice(entry: ActiveChoice) {
    const active = this.activeQuestion;
    if (!active || active.resolved || entry.resolved) return;
    if (active.questionIndex !== entry.questionIndex) return;

    this.stopFlappyChoiceAudioForEntry(entry);

    if (this.isChoiceCorrect(entry.choice)) {
      guardedScenePlay(this, "flappy_sfx_correct", 0.72, "choice");
      this.onSingleFlappyCorrectHit(active, entry);
    } else {
      guardedScenePlay(this, "flappy_sfx_wrong", 0.9, "choice");
      entry.resolved = true;
      this.deductScoreOnWrongAnswer(entry.sprite.x, entry.sprite.y - 40);
      this.markChoiceEliminated(active.questionIndex, entry.choice.id);
      this.flashChoice(entry.sprite, 0xf2a0a0);
      this.tweens.add({
        targets: entry.sprite,
        alpha: 0,
        duration: 220,
        onComplete: () => this.removeChoice(entry, true),
      });
      this.loseLife();
      if (this.lives <= 0 || this.endingRun) {
        if (!this.endingRun) this.clearActiveQuestion();
        return;
      }
      if (this.hasFlappyCorrectChoiceStillReachable(active)) {
        return;
      }
      this.failQuestion(active);
    }
  }

  /** ยังมีคำตอบที่ถูกลอยอยู่ฝั่งขวาของนก — เด็กยังชนได้ */
  private hasFlappyCorrectChoiceStillReachable(active: ActiveQuestion): boolean {
    const character = this.character;
    if (!character?.active) return false;
    const birdX = character.x;
    const passMargin = Math.max(24, character.displayWidth * 0.25);

    for (const choiceEntry of active.remainingChoices) {
      if (choiceEntry.resolved) continue;
      if (!active.remainingCorrectIds.has(choiceEntry.choice.id)) continue;
      if (choiceEntry.sprite.x >= birdX - passMargin) return true;
    }
    return false;
  }

  /** ตอบถูกแล้วให้ choice ที่ยังอยู่ทั้งหมดวิ่งเข้าคะแนน แล้วค่อยไปข้อถัดไป */
  private flyChoicesToScore(
    active: ActiveQuestion,
    hitSprite: ChoiceSprite,
    gained: number,
    startX: number,
    startY: number
  ) {
    const targetX = this.hudScoreTargetX || this.scale.width - 36;
    const targetY = this.hudScoreTargetY || 36;
    const flyings = active.remainingChoices.filter((c) => c.sprite.active);
    this.flashChoice(hitSprite, 0x9be8a4);
    this.createCorrectStarBurst(startX, startY);
    this.time.delayedCall(120, () => {
      this.playScoreGainFx(gained, startX, startY, targetX, targetY);
    });
    if (!flyings.length) {
      this.time.delayedCall(120, () => this.advanceAfterAnswer(true));
      return;
    }

    let done = 0;
    for (const item of flyings) {
      item.resolved = true;
      this.flashChoice(item.sprite, 0x9be8a4);
      const body = item.sprite.body as Phaser.Physics.Arcade.Body | undefined;
      body?.setEnable(false);
      this.tweens.add({
        targets: item.sprite,
        x: targetX,
        y: targetY,
        scale: { from: item.sprite.scale, to: 0.26 },
        alpha: 0,
        duration: Phaser.Math.Between(360, 520),
        ease: "Cubic.easeIn",
        onComplete: () => {
          this.removeChoice(item, true);
          done += 1;
          if (done >= flyings.length) {
            this.time.delayedCall(120, () => this.advanceAfterAnswer(true));
          }
        },
      });
    }
  }

  /** effect ดาวแบบ flip-cards โผล่ที่ข้อถูกก่อน */
  private createCorrectStarBurst(x: number, y: number) {
    if (!this.textures.exists("flappy_star_fx")) return;
    const particles = this.add.particles(x, y - 40, "flappy_star_fx", {
      speed: { min: 160, max: 360 },
      angle: { min: 0, max: 360 },
      lifespan: 950,
      gravityY: 340,
      quantity: 30,
      scale: { start: this.mobile ? 0.3 : 0.4, end: 0 },
      emitting: false,
    });
    particles.setDepth(3200);
    particles.explode(30);

    /** ระลอกสอง ทำให้เอฟเฟกต์ดูอลังขึ้น */
    this.time.delayedCall(110, () => {
      if (!particles.active) return;
      particles.explode(18, x + Phaser.Math.Between(-18, 18), y - Phaser.Math.Between(35, 55));
    });
    this.time.delayedCall(1200, () => particles.destroy());
  }

  /** +คะแนน ลอยตามหลังเอฟเฟกต์ดาว แล้ววิ่งเข้าคะแนน */
  private playScoreGainFx(gained: number, startX: number, startY: number, targetX: number, targetY: number) {
    const mobile = this.mobile;
    const burstRing = this.add.circle(startX, startY, mobile ? 18 : 24, 0xffffff, 0.38).setDepth(3190);
    this.tweens.add({
      targets: burstRing,
      scale: { from: 0.4, to: 2.1 },
      alpha: { from: 0.45, to: 0 },
      duration: 260,
      ease: "Cubic.easeOut",
      onComplete: () => burstRing.destroy(),
    });

    const plus = this.add
      .text(startX + (mobile ? 10 : 14), startY - (mobile ? 12 : 16), `+${gained}`, {
        font: `900 ${mobile ? 40 : 56}px "Noto Sans Thai", sans-serif`,
        color: "#0f8ed8",
        stroke: "#ffffff",
        strokeThickness: mobile ? 8 : 10,
      })
      .setOrigin(0.5)
      .setDepth(3200)
      .setScale(0.45)
      .setAlpha(0);
    this.tweens.add({
      targets: plus,
      scale: 1.24,
      alpha: 1,
      y: plus.y - (mobile ? 16 : 22),
      duration: 180,
      ease: "Back.Out",
      onComplete: () => {
        this.tweens.add({
          targets: plus,
          x: targetX,
          y: targetY,
          scale: 0.62,
          alpha: 0,
          duration: 460,
          ease: "Cubic.easeIn",
          onComplete: () => {
            plus.destroy();
            if (this.hudScoreText) {
              this.tweens.add({
                targets: this.hudScoreText,
                scale: { from: 1, to: 1.34 },
                yoyo: true,
                duration: 150,
              });
              this.tweens.add({
                targets: this.hudScoreText,
                alpha: { from: 1, to: 0.15 },
                yoyo: true,
                repeat: 2,
                duration: 70,
                ease: "Sine.easeInOut",
                onComplete: () => this.hudScoreText?.setAlpha(1),
              });
            }
          },
        });
      },
    });
  }

  private deductScoreOnWrongAnswer(startX: number, startY: number) {
    this.score = Math.max(0, this.score - 1);
    this.refreshHudScoreCounter();
    const targetX = this.hudScoreTargetX || this.scale.width - 36;
    const targetY = this.hudScoreTargetY || 36;
    this.playScoreLossFx(startX, startY, targetX, targetY);
  }

  /** -คะแนน ลอยแล้ววิ่งเข้า HUD คะแนน */
  private playScoreLossFx(startX: number, startY: number, targetX: number, targetY: number) {
    const mobile = this.mobile;
    const minus = this.add
      .text(startX + (mobile ? 10 : 14), startY - (mobile ? 12 : 16), "-1", {
        font: `900 ${mobile ? 40 : 56}px "Noto Sans Thai", sans-serif`,
        color: "#ff0076",
        stroke: "#ffffff",
        strokeThickness: mobile ? 8 : 10,
      })
      .setOrigin(0.5)
      .setDepth(3200)
      .setScale(0.45)
      .setAlpha(0);
    this.tweens.add({
      targets: minus,
      scale: 1.12,
      alpha: 1,
      y: minus.y - (mobile ? 10 : 14),
      duration: 160,
      ease: "Back.Out",
      onComplete: () => {
        this.tweens.add({
          targets: minus,
          x: targetX,
          y: targetY,
          scale: 0.62,
          alpha: 0,
          duration: 420,
          ease: "Cubic.easeIn",
          onComplete: () => {
            minus.destroy();
            if (this.hudScoreText) {
              this.tweens.add({
                targets: this.hudScoreText,
                scale: { from: 1, to: 1.22 },
                yoyo: true,
                duration: 140,
              });
            }
          },
        });
      },
    });
  }

  private markChoiceEliminated(questionIndex: number, choiceId: number) {
    const set = this.eliminatedChoiceIdsByQuestion.get(questionIndex) ?? new Set<number>();
    set.add(choiceId);
    this.eliminatedChoiceIdsByQuestion.set(questionIndex, set);
  }

  /** รองรับค่าจริงของ API ที่อาจส่ง is_correct เป็น boolean/number/string */
  private isChoiceCorrect(choice: FlappyBirdChoice): boolean {
    const value = choice.is_correct;
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value === 1;
    const normalized = String(value).trim().toLowerCase();
    return normalized === "true" || normalized === "1";
  }

  private flashChoice(sprite: ChoiceSprite, tint: number) {
    sprite.iterate((child: Phaser.GameObjects.GameObject) => {
      if (child instanceof Phaser.GameObjects.Image) {
        child.setTint(tint);
      }
      return true;
    });
  }

  private handleQuestionTimeout(active: ActiveQuestion) {
    if (active.resolved || !this.gameplayActive) return;
    if (active.remainingCorrectIds.size === 0) return;
    this.loseLife();
    this.failQuestion(active);
  }

  private failQuestion(active: ActiveQuestion) {
    if (active.resolved) return;
    if (this.lives <= 0) {
      this.clearActiveQuestion();
      if (!this.endingRun) this.triggerGameOver();
      return;
    }
    /** ถ้ายังไม่ตาย ข้อที่ยังไม่ผ่านต้องวนกลับมาจนกว่าจะตอบถูก */
    active.resolved = true;
    if (active.timeoutEvent) {
      active.timeoutEvent.remove(false);
      active.timeoutEvent = undefined;
    }
    this.questionQueue.push(active.questionIndex);
    this.time.delayedCall(700, () => this.startNextQuestion());
  }

  private advanceAfterAnswer(_correct: boolean) {
    this.startNextQuestion();
  }

  private loseLife() {
    this.lives = Math.max(0, this.lives - 1);
    this.refreshHudLives();
    if (this.lives > 0 && this.lives < MAX_LIVES) {
      this.maybeFlappyTeacherWarnAfterLifeLost();
    }
    if (this.lives <= 0) {
      this.gameFailedByNoLives = true;
      this.triggerGameOver();
    }
  }

  private completeAllQuestions() {
    this.gameFailedByNoLives = false;
    this.triggerGameOver();
  }

  private removeChoice(entry: ActiveChoice, alreadyResolved = false) {
    this.stopFlappyChoiceCenterHighlight(entry);
    if (!alreadyResolved) entry.resolved = true;
    const idx = this.activeChoices.indexOf(entry);
    if (idx >= 0) this.activeChoices.splice(idx, 1);
    const active = this.activeQuestion;
    if (active) {
      const aidx = active.remainingChoices.indexOf(entry);
      if (aidx >= 0) active.remainingChoices.splice(aidx, 1);
    }
    entry.sprite.destroy(true);
  }

  private createFlappyTeacherUiIfNeeded() {
    if (this.teacherHintUI) return;

    this.teacherHintUI = new TeacherHintUI(this, {
      mobile: this.mobile,
      depth: 2600,
      messageDepth: 2650,
      onNotificationSfx: () => this.playSfx("sfx_notification_message", 0.55),
    });
    this.teacherHintUI.create("standby", true);
  }

  private destroyFlappyTeacherAndMessage() {
    this.countdownLabel?.destroy();
    this.countdownLabel = undefined;
    this.teacherHintUI?.destroy();
    this.teacherHintUI = undefined;
  }

  private flappyShowTeacherMessage(
    text: string,
    durationMs = 2800,
    teacherState?: "point" | "clap"
  ) {
    this.createFlappyTeacherUiIfNeeded();
    const clean = (text ?? "").trim();
    if (!clean) return;
    this.teacherHintUI?.present({
      text: clean,
      durationMs,
      teacherState,
      resetHintBeforeShow: true,
    });
  }

  private hideFlappyTeacherMessage() {
    this.teacherHintUI?.hide();
  }

  private async runFlappyPreGameIntroThenStart(): Promise<void> {
    this.createFlappyTeacherUiIfNeeded();
    this.input.enabled = false;

    const stepMs = 3400;
    const lines = [
      "บินไปชนคำตอบที่ถูกนะ",
      "ถ้าเจอคำที่ไม่ใช่ อย่าชนเด็ดขาด",
      "ตอบถูกจะได้คะแนนเพิ่ม ตอบผิดจะเสียคะแนน",
    ];

    const wait = (ms: number) =>
      new Promise<void>((resolve) => {
        this.time.delayedCall(ms, () => resolve());
      });

    for (const line of lines) {
      this.flappyShowTeacherMessage(line, stepMs, "point");
      await wait(stepMs);
    }

    this.hideFlappyTeacherMessage();
    await this.runFlappyCountdown321();
    this.startFlappyGameplay();
  }

  private runFlappyCountdown321(): Promise<void> {
    return new Promise((resolve) => {
      const { width, height } = this.scale;
      const cx = width / 2;
      const cy = height * 0.48;
      const labels = ["3", "2", "1"];
      let i = 0;
      const showNext = () => {
        this.countdownLabel?.destroy();
        if (i >= labels.length) {
          this.countdownLabel = undefined;
          resolve();
          return;
        }
        this.playSfx("sfx_countnum", 0.9);
        const t = this.add
          .text(cx, cy, labels[i], {
            fontFamily: "Noto Sans Thai, sans-serif",
            fontSize: this.mobile ? "120px" : "160px",
            color: "#ffffff",
            stroke: "#0b6fa6",
            strokeThickness: this.mobile ? 10 : 14,
          })
          .setOrigin(0.5)
          .setDepth(4000)
          .setScrollFactor(0);
        this.countdownLabel = t;
        t.setScale(0.4);
        t.setAlpha(0);
        this.tweens.add({
          targets: t,
          scale: 1,
          alpha: 1,
          duration: 220,
          ease: "Back.easeOut",
          onComplete: () => {
            this.tweens.add({
              targets: t,
              scale: 1.12,
              alpha: 0,
              duration: 420,
              delay: 280,
              ease: "Cubic.easeIn",
              onComplete: () => {
                t.destroy();
                i += 1;
                this.time.delayedCall(80, showNext);
              },
            });
          },
        });
      };
      showNext();
    });
  }

  private maybeFlappyTeacherWarnAfterLifeLost() {
    if (!this.gameplayActive) return;
    if (this.lives <= 0 || this.lives >= MAX_LIVES) return;
    if (this.time.now - this.lastTeacherWarnAt < 4200) return;
    const line = Phaser.Utils.Array.GetRandom([...FLAPPY_TEACHER_WARN_LINES]);
    this.lastTeacherWarnAt = this.time.now;
    this.flappyShowTeacherMessage(line, 2600, "point");
  }

  private showFlappyTeacherCorrectPraise() {
    if (!this.gameplayActive) return;
    this.createFlappyTeacherUiIfNeeded();
    const line = Phaser.Utils.Array.GetRandom([...FLAPPY_TEACHER_CORRECT_LINES]);
    this.flappyShowTeacherMessage(line, 2600, "clap");
  }

  private showFlappyQuestionHintBubble(question: FlappyBirdQuestion) {
    this.createFlappyTeacherUiIfNeeded();
    const hint = (question.hint ?? "").trim();
    const imgUrl = this.resolveUrl(question.image_hint);
    const imgKey =
      imgUrl && this.textureKeyByUrl.has(imgUrl) ? (this.textureKeyByUrl.get(imgUrl) as string) : undefined;
    const imgReady = !!(imgKey && this.textures.exists(imgKey));
    if (!hint && !imgReady) return;

    this.teacherHintUI?.presentHint({
      text: hint,
      hintTextureKey: imgReady ? imgKey : undefined,
      durationMs: 5200,
      teacherState: "point",
    });
  }

  private clearActiveQuestion(withDrop = false) {
    if (this.activeQuestion?.timeoutEvent) {
      this.activeQuestion.timeoutEvent.remove(false);
    }
    this.stopFlappyChoiceAudioPipeline();
    const staleChoices = [...this.activeChoices];
    this.activeQuestion = undefined;
    this.activeChoices = [];
    for (const entry of staleChoices) {
      if (!withDrop) {
        this.removeChoice(entry, true);
        continue;
      }
      const sprite = entry.sprite;
      if (!sprite.active) continue;
      const body = sprite.body as Phaser.Physics.Arcade.Body | undefined;
      body?.setEnable(false);
      this.tweens.add({
        targets: sprite,
        y: sprite.y + (this.mobile ? 170 : 230),
        angle: Phaser.Math.Between(-12, 12),
        alpha: 0,
        duration: 300,
        ease: "Quad.easeIn",
        onComplete: () => {
          if (sprite.active) sprite.destroy(true);
        },
      });
    }
  }
}

