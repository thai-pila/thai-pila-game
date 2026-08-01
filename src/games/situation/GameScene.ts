import Phaser from "phaser";
import { API_BASE_URL } from "../../core/api";
import { isKnowLearningAgentDevHostname, shouldSkipKnowLearningAgentsFromUrl } from "../../core/agentEnvironment";
import { BaseGameScene } from "../../core/scenes/BaseGameScene";
import {
  preloadHudProcess,
} from "../../core/hud/questionProgressHud";
import { HUD_VOLUME_TEXTURE_KEY, preloadHudVolume, getHudSuggestionLabel, hasHudCenterLabel, layoutHudIconPreserveAspect, applyHudStatDomText, getHudStatFont, getHudStatFontPx, getHudCenterTextMaxFontPx, HUD_VALUE_COLOR } from "../../core/hud/gameHudLayout";
import { createThaiTextElement, createThaiTextSpan, estimateThaiTextLineCount, measureThaiSpanHeight } from "../../utils/thaiText";
import { getHomeSceneButtonKeys, type HomeActionPayload } from "../../core/scenes/HomeScene";
import { TeacherHintUI } from "../../core/teacher/TeacherHintUI";
import { createHudScaleCtx } from "../../utils/desktopUiScale";
import { isMobileLayout } from "../../utils/device";
import { maybeShuffleChoices } from "../../utils/shuffleAnswer";
import { ensureNotoSansThaiLoopedReady } from "../../utils/notoThaiFont";
import {
  canPlayGameAudio,
  GAME_BGM_VOLUME,
  guardedScenePlay,
  guardedScenePlayChoice,
  guardedScenePlayQuestion,
} from "../../core/audio/sceneAudio";

type SituationChoice = {
  id: number;
  choice: string;
  is_correct: boolean;
  sound_choice?: string | null;
  image_choice?: string | null;
};

type SituationQuestion = {
  id: number;
  no: number;
  question: string;
  question_position: string;
  hint?: string | null;
  sound_question?: string | null;
  image_question?: string | null;
  sound_hint?: string | null;
  image_hint?: string | null;
  shuffle_answer?: boolean | string | number | null;
  choices: SituationChoice[];
};

type SituationPayload = {
  game_info: {
    uuid?: string;
    uuid_newgen?: string;
    other_image: string;
    exercise_name?: string;
    suggestion?: string | null;
  };
  questions: SituationQuestion[];
};

type PositionRatio = {
  x: number;
  y: number;
};

type ChoiceRowUI = {
  row: Phaser.GameObjects.Container;
  bg: Phaser.GameObjects.Graphics;
  dom: Phaser.GameObjects.DOMElement;
  choiceId: number;
  isCorrect: boolean;
  isEliminated: boolean;
  width: number;
  height: number;
  volumeBtn?: Phaser.GameObjects.Image;
  soundChoice?: string | null;
  choiceImage?: Phaser.GameObjects.Image;
  choiceMagnifyBtn?: Phaser.GameObjects.Image;
  choiceImageKey?: string;
  choiceImageFit?: { w: number; h: number };
  choiceImagePad?: number;
  choiceMagnifySize?: number;
};

const SITUATION_MAGNIFY_TEXTURE_KEY = "common_magnifying";
const SITUATION_QUESTION_ICON_KEY = "situation_question_icon";
const SITUATION_END_GAME_KEY = "situation_end_game";

type SituationLayoutAabb = { left: number; right: number; top: number; bottom: number };

type SituationQuestionLayout = {
  anchorX: number;
  anchorY: number;
  choiceDirection: 1 | -1;
  rowStartOffset: number;
  choiceWidth: number;
  choiceHeight: number;
  choiceGap: number;
  choicesCount: number;
  questionWidth: number;
  questionHeight: number;
  questionIconSize: number;
  iconBadgeSize: number;
  questionImageOuterW?: number;
};

type SituationRunstate = {
  gameKey?: string;
  gameUuid?: string;
  startedAt?: string;
  startedAtMs?: number;
  correctAnswers?: Array<{
    questionIndex: number;
    questionId: number;
    questionNo: number;
    answeredAt: string;
    elapsedMs: number;
  }>;
  reference?: {
    dashboard?: string;
  };
};

type AgentModule = {
  default: {
    state: (scope: string) => Promise<unknown>;
  };
};

const BG_TEXTURE_KEY = "situation_bg";
const BASE_BG_WIDTH = 3840;
const BASE_BG_HEIGHT = 1080;
const DESKTOP_VIEWPORT_WIDTH = 1920;
/** ใช้เป็นฐานสัดส่วน UI โจทย์บนเดสก์ท็อป — เล็กกว่านี้ให้ย่อกล่อง/ตัวอักษร */
const DESKTOP_VIEWPORT_HEIGHT = 1080;

function parsePosition(position: string): PositionRatio {
  try {
    const parsed = JSON.parse(position) as PositionRatio;
    return { x: parsed.x, y: parsed.y };
  } catch {
    return { x: 0, y: 0 };
  }
}

const SITUATION_QUESTION_MAX_LINES = 2;
/** ตอบถูกครบ 2 ข้อติดกัน (ไม่นับหลายตัวเลือกในข้อเดียว) → ได้โล่ 1 อัน */
const SITUATION_COMBO_CORRECT_STREAK = 2;
/** ตอบผิด → เพิ่มเวลา (ไม่หักคะแนน) */
const SITUATION_WRONG_TIME_PENALTY_SEC = 5;

function resolveSituationQuestionFontPx(
  question: string,
  wrapWidth: number,
  baseFontPx: number,
  minFontPx: number,
  maxLines: number,
  lineHeight: number
): number {
  let fontPx = baseFontPx;
  while (
    fontPx > minFontPx &&
    estimateThaiTextLineCount(question, {
      width: wrapWidth,
      fontSizePx: fontPx,
      fontWeight: 700,
      lineHeight,
    }) > maxLines
  ) {
    fontPx -= 1;
  }
  return fontPx;
}

export default class SituationGameScene extends BaseGameScene {
  private readonly initialCoinScore = 10;
  private answered = new Set<number>();
  /** ข้อไหนยังต้องเลือกคำตอบที่ถูกให้ครบ (choice id ที่เหลือ) */
  private remainingCorrectByQuestion = new Map<number, Set<number>>();
  private situationQuestionCount = 0;
  /** มีข้อที่ต้องเลือกถูกมากกว่า 1 ตัวเลือก — ใช้ตัดสิน auto จบ vs ปุ่มจบเกม */
  private situationManualEndRequired = false;
  private endGameButton?: Phaser.GameObjects.Image;
  private situationEndingGame = false;
  private correctStreak = 0;
  private shieldCount = 0;
  private hudTimeText?: Phaser.GameObjects.Text;
  private hudScoreText?: Phaser.GameObjects.Text;
  private hudShieldText?: Phaser.GameObjects.Text;
  private hudRoot?: Phaser.GameObjects.Container;
  private hudTimerEvent?: Phaser.Time.TimerEvent;
  private hudScoreNumX = 0;
  private hudScoreNumY = 0;
  private hudScoreTargetX = 0;
  private hudScoreTargetY = 0;
  private hudShieldTargetX = 0;
  private hudShieldTargetY = 0;
  private hudTimeTargetX = 0;
  private hudTimeTargetY = 0;
  private questionUIs: Array<{
    question: SituationQuestion;
    questionCard: Phaser.GameObjects.Container;
    choiceRows: Phaser.GameObjects.Container[];
    choiceRowsMeta: ChoiceRowUI[];
    questionBg: Phaser.GameObjects.Graphics;
    questionIconRoot: Phaser.GameObjects.Container;
    questionIcon: Phaser.GameObjects.Image;
    iconBadge: Phaser.GameObjects.Image;
    questionIconIdleTweens?: Phaser.Tweens.Tween[];
    questionWidth: number;
    questionHeight: number;
    questionDom: Phaser.GameObjects.DOMElement;
    questionVolumeBtn?: Phaser.GameObjects.Image;
    questionImage?: Phaser.GameObjects.Image;
    questionMagnifyBtn?: Phaser.GameObjects.Image;
    questionImageHitZone?: Phaser.GameObjects.Zone;
    choiceDoms: Phaser.GameObjects.DOMElement[];
    /** ใช้คำนวณทับกับข้ออื่น (คำถาม + กล่อง choice) */
    layout: SituationQuestionLayout;
  }> = [];
  private balloonHints: Phaser.GameObjects.DOMElement[] = [];
  private balloonTweens: Phaser.Tweens.Tween[] = [];
  private activeQuestionIndex: number | null = null;
  private activeQuestionEnterMs = 0;
  private questionStayDurationMs = new Map<number, number>();
  private notAnsweredShownSteps = new Map<number, number>();
  private notAnsweredTimerEvent?: Phaser.Time.TimerEvent;
  private balloonTargetQuestionIndex: number | null = null;
  private wrongAttemptsByQuestion = new Map<number, number>();
  private situationImageLightbox?: {
    backdrop: Phaser.GameObjects.Rectangle;
    image: Phaser.GameObjects.Image;
  };
  /** ปิดการลากพื้นหลังชั่วคราวตอนเปิดรูปใหญ่ */
  private situationCameraDragEnabled = true;
  private teacherHintUI?: TeacherHintUI;
  private mobile = false;
  /** โหลดเสียง/รูปคำใบ้และสื่อข้อ (เหมือน flappy-bird) */
  private situationAudioKeyByUrl = new Map<string, string>();
  private situationTextureKeyByUrl = new Map<string, string>();
  private lastMessageShownMs = 0;
  private bgmHomeSound?: Phaser.Sound.BaseSound;
  private bgmGameSound?: Phaser.Sound.BaseSound;
  private tutorialPopup?: {
    overlay: Phaser.GameObjects.Rectangle;
    howToImage: Phaser.GameObjects.Image;
    startButton: Phaser.GameObjects.Image;
    restoreSceneInputEnabled: boolean;
    restoreHomeInputEnabled: boolean;
  };
  private runstateScope?: string;
  private runstate?: SituationRunstate;
  private agentStateLoader?: Promise<AgentModule["default"] | null>;
  private readonly enableAgentState =
    typeof window !== "undefined" && !isKnowLearningAgentDevHostname();
  private readonly messageCatalog: Record<string, string> = {
    stage_start_1: "มาดูกันว่าคุณจำตอนนี้ได้ไหม",
    stage_start_2: "ข้อนี้ต้องสังเกตดี ๆ นะ",
    stage_start_3: "อย่าเพิ่งรีบตอบ ลองดูตัวละครก่อน",
    stage_start_4: "ข้อนี้เกี่ยวกับเหตุการณ์สำคัญเลยล่ะ",
    not_answered_1: "ลองดูจากภาพประกอบได้มั้ย",
    not_answered_2: "คิดถึงเหตุการณ์ก่อนหน้านี้ดูสิ",
    not_answered_3: "มีตัวช่วยในฉากอยู่เหมือนกันนะ",
    not_answered_4: "ดูดี ๆ คำตอบอาจอยู่ใกล้ตัวละครนี่เอง",
    correct_1: "เก่งมาก ตอบได้ตรงเลย!",
    correct_2: "ใช่เลย ข้อนี้ถูกต้อง",
    correct_3: "แม่นมาก ข้อนี้ผ่านสบายๆ",
    correct_4: "เยี่ยมเลย คุณจำเนื้อเรื่องได้ดีมาก",
    wrong_1: "อุ๊ย ยังไม่ใช่นะ",
    wrong_2: "ลองคิดจากเหตุการณ์ในตอนนี้อีกนิด",
    wrong_3: "เกือบแล้ว ลองดูตัวละครประกอบอีกครั้ง",
    wrong_4: "ไม่เป็นไร ข้อนี้มีหลอกนิดหน่อย",
  };
  private readonly messagePools = {
    stageStart: ["stage_start_1", "stage_start_2", "stage_start_3", "stage_start_4"],
    notAnswered: ["not_answered_1", "not_answered_2", "not_answered_3", "not_answered_4"],
    correct: ["correct_1", "correct_2", "correct_3", "correct_4"],
    wrong: ["wrong_1", "wrong_2", "wrong_3", "wrong_4"],
  };

  constructor() {
    super("situation");
  }

  preload() {
    if (!this.textures.exists("coin_icon")) {
      this.load.image("coin_icon", "assets/common/coin_icon.png");
    }
    if (!this.textures.exists("time_bg")) {
      this.load.image("time_bg", "assets/common/time_bg.png");
    }
    if (!this.textures.exists("hud_hourglass")) {
      this.load.image("hud_hourglass", "assets/common/hourglass.png");
    }
    if (!this.textures.exists("score_bg")) {
      this.load.image("score_bg", "assets/common/score_bg.png");
    }
    preloadHudProcess(this);
    preloadHudVolume(this);
    if (!this.textures.exists(SITUATION_MAGNIFY_TEXTURE_KEY)) {
      this.load.image(SITUATION_MAGNIFY_TEXTURE_KEY, "assets/common/magnifying.png");
    }
    if (!this.textures.exists("situation_badge")) {
      this.load.image("situation_badge", "assets/situation/badge.png");
    }
    if (!this.textures.exists(SITUATION_QUESTION_ICON_KEY)) {
      this.load.image(SITUATION_QUESTION_ICON_KEY, "assets/situation/question-icon.png");
    }
    if (!this.textures.exists(SITUATION_END_GAME_KEY)) {
      this.load.image(SITUATION_END_GAME_KEY, "assets/situation/end_game.png");
    }
    if (!this.textures.exists("fx_star")) {
      this.load.image("fx_star", "assets/flip-cards/star.png");
    }
    if (!this.textures.exists("situation_shield")) {
      this.load.image("situation_shield", "assets/situation/shield.png");
    }
    if (!this.textures.exists("situation_circle")) {
      this.load.image("situation_circle", "assets/situation/cicle.png");
    }
    if (!this.textures.exists("situation_balloon")) {
      this.load.image("situation_balloon", "assets/situation/balloon.png");
    }
    if (!this.textures.exists("situation_howto_mobile")) {
      this.load.image("situation_howto_mobile", "assets/situation/howto_mobile.png");
    }
    if (!this.textures.exists("situation_howto_desktop")) {
      this.load.image("situation_howto_desktop", "assets/situation/howto_desktop.png");
    }
    if (!this.cache.audio.exists("sfx_correct")) {
      this.load.audio("sfx_correct", "assets/sound/sfx_correct_flip_cards.mp3");
    }
    if (!this.cache.audio.exists("sfx_incorrect")) {
      this.load.audio("sfx_incorrect", "assets/sound/sfx_incorrect_flip_cards.mp3");
    }
    if (!this.cache.audio.exists("sfx_notification_message")) {
      this.load.audio("sfx_notification_message", "assets/sound/sfx_notification_message_flip_cards.mp3");
    }
    if (!this.cache.audio.exists("bgm_home_music")) {
      this.load.audio("bgm_home_music", "assets/sound/situation/bgm_home_music.mp3");
    }
    if (!this.cache.audio.exists("bgm_game_music")) {
      this.load.audio("bgm_game_music", "assets/sound/situation/bgm_game_music.mp3");
    }
    if (!this.cache.audio.exists("sfx_win_combo")) {
      this.load.audio("sfx_win_combo", "assets/sound/sfx_win_combo.mp3");
    }
    if (!this.cache.audio.exists("sfx_shield_achievement")) {
      this.load.audio("sfx_shield_achievement", "assets/sound/sfx_shield_achievement.mp3");
    }
    if (!this.cache.audio.exists("sfx_shield_destroy")) {
      this.load.audio("sfx_shield_destroy", "assets/sound/sfx_shield_destroy.mp3");
    }
    if (!this.cache.audio.exists("sfx_pop")) {
      this.load.audio("sfx_pop", "assets/sound/sfx_pop.mp3");
    }
    if (!this.cache.audio.exists("sfx_coin_collect")) {
      this.load.audio("sfx_coin_collect", "assets/sound/sfx_coin_collect.mp3");
    }
    if (!this.cache.audio.exists("sfx_bonus")) {
      this.load.audio("sfx_bonus", "assets/sound/sfx_bonus.mp3");
    }
    TeacherHintUI.preload(this);
  }

  async create() {
    super.create();
    this.mobile = isMobileLayout();
    this.score = this.initialCoinScore;
    this.correctStreak = 0;
    this.shieldCount = 0;
    this.activeQuestionIndex = null;
    this.activeQuestionEnterMs = 0;
    this.questionStayDurationMs.clear();
    this.notAnsweredShownSteps.clear();
    this.balloonTargetQuestionIndex = null;
    this.wrongAttemptsByQuestion.clear();
    this.scene.launch("HomeScene", {
      gameKey: this.scene.key,
      ui: {
        startButtonPath: "assets/situation/btn_start.png",
        howToButtonPath: "assets/situation/btn_howto.png",
        homeLogoPath: "assets/situation/logo.png",
        homeLogoKey: "situation_home_logo",
        homeLogoWidth: this.mobile ? 400 : 560,
        homeLogoYRatio: this.mobile ? 0.4 :0.3,
        homeQuestionLogoPath: "assets/situation/question-logo.png",
        homeQuestionLogoKey: "situation_home_question_logo",
        homeQuestionLogoWidth: this.mobile ? 62 : 96,
        homeQuestionLogoOffsetX: this.mobile ? 155 : 200,
        homeQuestionLogoOffsetY: this.mobile ? 40 : 60,
        startButtonWidth: this.mobile ? 248 : 300,
        howToButtonWidth: this.mobile ? 208 : 240,
        startButtonYRatio: this.mobile ? 0.64 : 0.66,
        howToButtonYRatio: this.mobile ? 0.78 : 0.79,
        minButtonGapPx: this.mobile ? 26 : 18,
  
      },
    });
    this.scene.bringToTop("HomeScene");
    this.setBgmState("home");

    const homeScene = this.scene.get("HomeScene");
    const onHomeAction = (payload: HomeActionPayload) => {
      if (payload.gameKey !== this.scene.key) return;
      if (payload.action === "howto") {
        this.events.emit("howto");
        this.openHowToPopup();
        console.log(`[${this.scene.key}] howto clicked`);
      }
    };
    homeScene.events.on("home-action", onHomeAction);

    this.input.enabled = false;
    this.answered.clear();
    this.remainingCorrectByQuestion.clear();
    this.situationManualEndRequired = false;
    this.situationEndingGame = false;
    this.endGameButton = undefined;
    this.questionUIs = [];

    let payload: SituationPayload;
    try {
      payload = await this.fetchSituationData();
      this.initSituationEndGameRules(payload);
      await this.preloadSituationHintAssets(payload);
      const imageUrl = `${API_BASE_URL}${payload.game_info.other_image}`;
      await this.loadBackgroundTexture(imageUrl);
    } catch (error) {
      console.error("Failed to load situation data:", error);
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

    const { width, height } = this.scale;
    const layoutViewportWidth = this.mobile ? width : Math.min(DESKTOP_VIEWPORT_WIDTH, width);
    const background = this.add.image(0, 0, BG_TEXTURE_KEY).setOrigin(0, 0);

    const textureSource = this.textures.get(BG_TEXTURE_KEY).getSourceImage() as {
      width: number;
      height: number;
    };

    const scaleToHeight = height / textureSource.height;
    background.setScale(scaleToHeight);

    const worldWidth = textureSource.width * scaleToHeight;
    const worldHeight = textureSource.height * scaleToHeight;

    this.cameras.main.setBounds(0, 0, worldWidth, worldHeight);
    this.cameras.main.setScroll(0, 0);
    this.cameras.main.setBackgroundColor("#000000");

    this.totalQuestions = payload.questions.length;

    
    homeScene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      homeScene.events.off("home-action", onHomeAction);
      console.log("HomeScene stopped → input enabled");
      void (async () => {
        await this.ensureHudFontReady();
        this.buildQuestionUI(scaleToHeight, worldWidth, worldHeight, layoutViewportWidth, this.mobile, payload);
        this.setBgmState("game");
        this.syncGameAudioFromQuestion(payload.questions?.[0]);
        this.startTime = Date.now();
        const runstateUuid = payload.game_info.uuid_newgen ?? payload.game_info.uuid;
        void this.initSituationRunstate(runstateUuid);
        this.reportRunstateStart();
        const sitInfo = payload.game_info;
        const sitTitle = getHudSuggestionLabel(sitInfo.suggestion);
        this.createTopHud(sitTitle, this.mobile);
        if (this.situationManualEndRequired) {
          this.createSituationEndGameButton();
        }
        this.createAdvisorAndMessageUI();
        this.updateHudScore();
        this.updateHudShield();
        this.showRandomMessage(this.messagePools.stageStart, 2600);
        this.input.enabled = true;
        this.startNotAnsweredTimer();
        this.showQuestionIconsOnly();

        const dragState = { active: false, lastX: 0 };

        this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
          if (!this.situationCameraDragEnabled) return;
          dragState.active = true;
          dragState.lastX = pointer.x;
        });

        this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
          if (!this.situationCameraDragEnabled) return;
          if (!dragState.active || !pointer.isDown) return;

          const dx = pointer.x - dragState.lastX;
          dragState.lastX = pointer.x;

          const maxScrollX = Math.max(0, worldWidth - width);
          this.cameras.main.scrollX = Phaser.Math.Clamp(this.cameras.main.scrollX - dx, 0, maxScrollX);
        });

        this.input.on("pointerup", () => {
          dragState.active = false;
        });
      })();
    });
  }

  /** โหมดเริ่มต้น — แสดงเฉพาะ question-icon ทุกข้อ */
  private showQuestionIconsOnly() {
    this.questionUIs.forEach((qUi, idx) => {
      qUi.questionIconRoot.setVisible(true);
      qUi.iconBadge.setVisible(this.answered.has(idx));
      this.collapseQuestionToIconOnly(idx);
    });
    this.applyProximityQuestionTextVisibility();
    this.refreshQuestionIconIdleFx();
  }

  /** จัด question-icon กับ badge ให้อยู่ข้างกัน ไม่ซ้อนทับ */
  private layoutQuestionIconSideBySide(
    questionIcon: Phaser.GameObjects.Image,
    iconBadge: Phaser.GameObjects.Image,
    questionIconSize: number,
    iconBadgeSize: number,
    showBadge: boolean
  ) {
    const gap = Math.max(4, Math.round(questionIconSize * 0.1));
    if (!showBadge) {
      questionIcon.setPosition(0, 0);
      iconBadge.setPosition(questionIconSize / 2 + gap + iconBadgeSize / 2, 0);
      return;
    }
    const totalWidth = questionIconSize + gap + iconBadgeSize;
    questionIcon.setPosition(-totalWidth / 2 + questionIconSize / 2, 0);
    iconBadge.setPosition(totalWidth / 2 - iconBadgeSize / 2, 0);
  }

  private layoutQuestionIconRow(qUi: (typeof this.questionUIs)[number]) {
    this.layoutQuestionIconSideBySide(
      qUi.questionIcon,
      qUi.iconBadge,
      qUi.layout.questionIconSize,
      qUi.layout.iconBadgeSize,
      qUi.iconBadge.visible
    );
  }

  /** ย้าย icon — ปิดอยู่บนจุดในฉาก / เปิดอยู่นอกกล่องโจทย์ (ไม่ทับข้อความ) */
  private repositionQuestionIcon(
    qUi: (typeof this.questionUIs)[number],
    expanded: boolean
  ) {
    const { anchorX, anchorY, questionHeight, questionIconSize, choiceDirection } = qUi.layout;
    const gap = Math.max(8, Math.round(questionIconSize * 0.18));
    if (!expanded) {
      qUi.questionIconRoot.setPosition(anchorX, anchorY);
      return;
    }
    const iconY =
      choiceDirection === 1
        ? anchorY - questionHeight / 2 - questionIconSize / 2 - gap
        : anchorY + questionHeight / 2 + questionIconSize / 2 + gap;
    qUi.questionIconRoot.setPosition(anchorX, iconY);
  }

  private stopQuestionIconIdleFx(questionIndex: number) {
    const qUi = this.questionUIs[questionIndex];
    if (!qUi) return;
    qUi.questionIconIdleTweens?.forEach((tween) => tween.stop());
    qUi.questionIconIdleTweens = undefined;
    qUi.questionIcon.setAngle(0);
    qUi.questionIcon.setDisplaySize(qUi.layout.questionIconSize, qUi.layout.questionIconSize);
    this.layoutQuestionIconRow(qUi);
  }

  private startQuestionIconIdleFx(questionIndex: number) {
    const qUi = this.questionUIs[questionIndex];
    if (!qUi || this.isQuestionExpanded(questionIndex)) return;

    this.stopQuestionIconIdleFx(questionIndex);
    const icon = qUi.questionIcon;
    const baseScaleX = icon.scaleX;
    const baseScaleY = icon.scaleY;

    const swing = this.tweens.add({
      targets: icon,
      angle: 10,
      duration: 700,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });
    const pulse = this.tweens.add({
      targets: icon,
      scaleX: baseScaleX * 1.12,
      scaleY: baseScaleY * 1.12,
      duration: 820,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });
    qUi.questionIconIdleTweens = [swing, pulse];
  }

  private refreshQuestionIconIdleFx() {
    this.questionUIs.forEach((_qUi, idx) => {
      if (!this.isQuestionExpanded(idx)) {
        this.startQuestionIconIdleFx(idx);
      } else {
        this.stopQuestionIconIdleFx(idx);
      }
    });
  }

  /** ซ่อนกล่องโจทย์+ตัวเลือก — เหลือแค่ question-icon */
  private collapseQuestionToIconOnly(questionIndex: number) {
    const qUi = this.questionUIs[questionIndex];
    if (!qUi) return;
    qUi.questionCard.setVisible(false);
    this.setSituationDomVisible(qUi.questionDom, false);
    qUi.questionVolumeBtn?.setVisible(false);
    qUi.questionImage?.setVisible(false);
    qUi.questionMagnifyBtn?.setVisible(false);
    qUi.questionImageHitZone?.setVisible(false);
    qUi.choiceRows.forEach((row) => row.setVisible(false));
    qUi.choiceDoms.forEach((dom) => this.setSituationDomVisible(dom, false));
    qUi.questionIconRoot.setVisible(true);
    qUi.iconBadge.setVisible(this.answered.has(questionIndex));
    this.layoutQuestionIconRow(qUi);
    this.repositionQuestionIcon(qUi, false);
    this.startQuestionIconIdleFx(questionIndex);
  }

  /** เปิดโจทย์+ตัวเลือกของข้อที่เลือก */
  private expandQuestionWithChoices(questionIndex: number) {
    const qUi = this.questionUIs[questionIndex];
    if (!qUi) return;
    this.stopQuestionIconIdleFx(questionIndex);
    qUi.questionCard.setVisible(true);
    this.setSituationDomVisible(qUi.questionDom, true);
    qUi.questionVolumeBtn?.setVisible(true);
    qUi.questionImage?.setVisible(true);
    qUi.questionMagnifyBtn?.setVisible(true);
    qUi.questionImageHitZone?.setVisible(true);
    qUi.choiceRows.forEach((row) => row.setVisible(true));
    qUi.choiceDoms.forEach((dom, idx) => {
      this.setSituationDomVisible(dom, qUi.choiceRows[idx]?.visible ?? false);
    });
    this.repositionQuestionIcon(qUi, true);
  }

  /** ปิดข้ออื่นทั้งหมด — เหลือแค่ question-icon */
  private hideOtherQuestionCards(keepIndex: number) {
    this.questionUIs.forEach((qUi, idx) => {
      qUi.questionIconRoot.setVisible(true);
      if (idx === keepIndex) return;
      this.collapseQuestionToIconOnly(idx);
    });
  }

  private isQuestionExpanded(questionIndex: number): boolean {
    const qUi = this.questionUIs[questionIndex];
    if (!qUi?.questionCard.visible) return false;
    return qUi.choiceRows.some((row) => row.visible);
  }

  protected override onBeforeEndGame() {
    this.stopNotAnsweredTimer();
    this.flushActiveQuestionStayDuration();
    this.destroyHowToPopup();
    this.hideSituationImageLightbox();
    if (this.mobile) {
      this.destroySituationTopHud();
    } else {
      this.hudTimerEvent?.destroy();
      this.hudTimerEvent = undefined;
      this.hudTimeText?.destroy();
      this.hudTimeText = undefined;
      this.hudScoreText?.destroy();
      this.hudScoreText = undefined;
      this.hudShieldText?.destroy();
      this.hudShieldText = undefined;
    }
    if (this.mobile) {
      this.teacherHintUI?.destroy();
      this.teacherHintUI = undefined;
    }
    this.balloonTweens.forEach((tween) => tween.stop());
    this.balloonTweens = [];
    this.balloonHints.forEach((hint) => hint.destroy());
    this.balloonHints = [];
    this.endGameButton?.destroy();
    this.endGameButton = undefined;

    this.questionUIs.forEach((ui, idx) => {
      this.stopQuestionIconIdleFx(idx);
      ui.questionIconRoot.destroy(true);
      ui.questionCard.destroy(true);
      ui.choiceRows.forEach((row) => row.destroy(true));
    });
    this.questionUIs = [];
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
    const howToKey = this.mobile ? "situation_howto_mobile" : "situation_howto_desktop";
    this.textures.get(howToKey).setFilter(Phaser.Textures.FilterMode.LINEAR);
    const overlay = this.add
      .rectangle(width / 2, height / 2, width, height, 0x000000, 0.55)
      .setScrollFactor(0)
      .setDepth(3500);

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

  private buildQuestionUI(
    scale: number,
    worldWidth: number,
    worldHeight: number,
    viewportWidth: number,
    mobile: boolean,
    payload: SituationPayload
  ) {
    const shortMobile = mobile && this.scale.height <= 760;
    /** จอมือถือเล็กมาก — ลดทั้งกรอบโจทย์และขนาดตัวอักษร (ปรับเกณฑ์ได้ที่บรรทัดนี้) */
    const tinyMobile = mobile && (this.scale.height <= 640 || viewportWidth <= 380);

    const desktopUiScale = !mobile
      ? Phaser.Math.Clamp(
          Math.min(viewportWidth / DESKTOP_VIEWPORT_WIDTH, this.scale.height / DESKTOP_VIEWPORT_HEIGHT),
          0.62,
          1
        )
      : 1;
    const desktopQuestionW = Math.round(420 * desktopUiScale);
    const desktopQuestionH = Math.round(112 * desktopUiScale);
    const desktopChoiceH = Math.round(48 * desktopUiScale);
    const desktopChoiceGap = Math.max(4, Math.round(8 * desktopUiScale));
    const desktopRowGap = Math.max(12, Math.round(20 * desktopUiScale));

    const horizontalMargin = mobile ? (shortMobile ? 24 : 32) : 24;
    const verticalMargin = mobile ? (shortMobile ? 20 : 32) : 24;
    const mobileQuestionMaxW = tinyMobile ? 520 : shortMobile ? 640 : 680;
    const questionWidth = Math.min(mobile ? mobileQuestionMaxW : desktopQuestionW, viewportWidth - horizontalMargin * 2);
    const choiceWidth = Math.min(mobile ? mobileQuestionMaxW : desktopQuestionW, viewportWidth - horizontalMargin * 2);
    const choiceHeight = mobile ? (tinyMobile ? 50 : shortMobile ? 58 : 72) : desktopChoiceH;
    const choiceGap = mobile ? (tinyMobile ? 10 : shortMobile ? 12 : 18) : desktopChoiceGap;
    const questionMinHeight = mobile ? (tinyMobile ? 84 : shortMobile ? 96 : 112) : desktopQuestionH;
    const choiceRowGap = mobile ? (tinyMobile ? 12 : shortMobile ? 14 : 22) : desktopRowGap;
    const speakerPad = mobile ? (tinyMobile ? 10 : shortMobile ? 12 : 14) : Math.max(10, Math.round(12 * desktopUiScale));
    const speakerSize = mobile
      ? tinyMobile
        ? 36
        : shortMobile
          ? 42
          : 48
      : Math.max(36, Math.round(44 * desktopUiScale));

    this.situationQuestionCount = payload.questions.length;

    for (const [questionIndex, item] of payload.questions.entries()) {
      const choices = maybeShuffleChoices(item.choices, item.shuffle_answer);
      const correctIds = choices.filter((c) => c.is_correct).map((c) => c.id);
      this.remainingCorrectByQuestion.set(questionIndex, new Set(correctIds));

      const position = parsePosition(item.question_position);
      const rawAnchorX = position.x * BASE_BG_WIDTH * scale;
      const rawAnchorY = position.y * BASE_BG_HEIGHT * scale;

      const choicesCount = choices.length;
      const choicesBlockHeight = choicesCount * choiceHeight + (choicesCount - 1) * choiceGap;

      const cardMetrics = this.resolveSituationQuestionCardMetrics({
        mobile,
        tinyMobile,
        shortMobile,
        desktopUiScale,
        questionWidth,
        questionMinHeight,
        question: item.question,
        soundQuestion: item.sound_question,
        imageQuestion: item.image_question,
        speakerSize,
        speakerPad,
        choiceHeight,
        choiceRowGap,
      });
      const {
        questionHeight,
        rowStartOffset,
        questionImageGap,
        questionImageOuterW,
        questionImageKey,
        questionImageFit,
        questionImageReserve,
        questionSoundReserve,
        questionTextWidth,
        questionTextHeight,
        questionFittedFontPx,
        questionWrapWidth,
        questionTextPadding,
        questionDomY,
      } = cardMetrics;

      const minAnchorX = questionWidth / 2 + horizontalMargin;
      const maxAnchorX = worldWidth - questionWidth / 2 - horizontalMargin;
      const anchorX = Phaser.Math.Clamp(rawAnchorX, minAnchorX, maxAnchorX);

      const canExpandDown =
        rawAnchorY + rowStartOffset + choicesBlockHeight - choiceGap + choiceHeight / 2 <=
        worldHeight - verticalMargin;
      const choiceDirection = canExpandDown ? 1 : -1;

      const minAnchorY = questionHeight / 2 + verticalMargin;
      const maxAnchorY = worldHeight - questionHeight / 2 - verticalMargin;
      const anchorY = Phaser.Math.Clamp(rawAnchorY, minAnchorY, maxAnchorY);

      const questionIconSize = mobile
        ? tinyMobile
          ? 48
          : shortMobile
            ? 56
            : 64
        : Math.round(72 * desktopUiScale);
      const iconBadgeSize = mobile
        ? tinyMobile
          ? 28
          : shortMobile
            ? 32
            : 36
        : Math.round(40 * desktopUiScale);
      const questionIconRoot = this.add.container(anchorX, anchorY).setDepth(22);
      const questionIcon = this.add
        .image(0, 0, SITUATION_QUESTION_ICON_KEY)
        .setDisplaySize(questionIconSize, questionIconSize)
        .setInteractive({ useHandCursor: true });
      const iconBadge = this.add
        .image(0, 0, "situation_badge")
        .setDisplaySize(iconBadgeSize, iconBadgeSize)
        .setVisible(false);
      this.layoutQuestionIconSideBySide(
        questionIcon,
        iconBadge,
        questionIconSize,
        iconBadgeSize,
        false
      );
      questionIconRoot.add([questionIcon, iconBadge]);

      const questionCard = this.add.container(anchorX, anchorY).setDepth(20).setVisible(false);
      const questionHitZone = this.add
        .zone(0, 0, questionWidth, questionHeight)
        .setInteractive({ useHandCursor: true });

      const questionBg = this.add.graphics();
      this.drawQuestionBackground(questionBg, questionWidth, questionHeight, "normal");

      let questionImage: Phaser.GameObjects.Image | undefined;
      let questionMagnifyBtn: Phaser.GameObjects.Image | undefined;
      let questionImageHitZone: Phaser.GameObjects.Zone | undefined;
      if (questionImageKey && questionImageFit) {
        const questionImagePad = mobile
          ? tinyMobile
            ? 6
            : shortMobile
              ? 8
              : 10
          : Math.max(6, Math.round(8 * desktopUiScale));
        const questionImageXAdj = questionWidth / 2 - questionImagePad - questionImageFit.w / 2;
        const magnifySize = mobile
          ? tinyMobile
            ? 18
            : shortMobile
              ? 20
              : 22
          : Math.max(20, Math.round(24 * desktopUiScale));
        const cardImage = this.createSituationCardImage(
          questionImageKey,
          questionImageXAdj,
          0,
          questionImageFit.w,
          questionImageFit.h,
          magnifySize,
          9,
          false
        );
        questionImage = cardImage.image.setVisible(false);
        questionMagnifyBtn = cardImage.magnifyBtn.setVisible(false);

        questionImageHitZone = this.add
          .zone(
            questionImageXAdj + magnifySize * 0.08,
            magnifySize * 0.04,
            questionImageFit.w + magnifySize * 0.55,
            questionImageFit.h + magnifySize * 0.45
          )
          .setInteractive({ useHandCursor: true })
          .setDepth(11)
          .setVisible(false);
        questionImageHitZone.on(
          "pointerdown",
          (pointer: Phaser.Input.Pointer, _lx: number, _ly: number, event?: Event) => {
            event?.stopPropagation();
            (pointer.event as Event | undefined)?.stopPropagation?.();
            this.showSituationImageLightbox(questionImageKey);
          }
        );
      }

      const questionDomX = (questionSoundReserve - questionImageReserve) / 2;
      const questionDiv = document.createElement("div");
      questionDiv.style.cssText = [
        `width:${questionTextWidth}px`,
        `height:${questionTextHeight}px`,
        "display:flex",
        "align-items:center",
        "justify-content:center",
        "text-align:center",
        "margin:0",
        "padding:0",
        "box-sizing:border-box",
        `padding:0 ${questionTextPadding}px`,
      ].join(";");
      questionDiv.appendChild(
        createThaiTextSpan(item.question, {
          fontSizePx: questionFittedFontPx,
          color: "#111111",
          fontWeight: 700,
          textAlign: "center",
          maxWidthPx: questionWrapWidth,
          pointerEventsNone: true,
        })
      );
      const questionDom = this.add
        .dom(questionDomX, questionDomY, questionDiv)
        .setOrigin(0.5, 0.5)
        .setDepth(2)
        .setScrollFactor(1);
      this.setSituationDomVisible(questionDom, false);
      this.setSituationDomPointerThrough(questionDom);

      let questionVolumeBtn: Phaser.GameObjects.Image | undefined;
      if (this.situationHasAudio(item.sound_question)) {
        questionVolumeBtn = this.createSituationSpeakerButton(
          -questionWidth / 2 - speakerSize * 0.22,
          0,
          speakerSize,
          5,
          () => this.playSituationUrlAudio(item.sound_question)
        );
      }

      questionHitZone.setDepth(6);
      const questionCardChildren: Phaser.GameObjects.GameObject[] = [questionBg, questionDom];
      if (questionImage) questionCardChildren.push(questionImage);
      if (questionMagnifyBtn) questionCardChildren.push(questionMagnifyBtn);
      questionCardChildren.push(questionHitZone);
      if (questionVolumeBtn) {
        questionVolumeBtn.setDepth(8);
        questionCardChildren.push(questionVolumeBtn);
      }
      if (questionImageHitZone) questionCardChildren.push(questionImageHitZone);
      questionCard.add(questionCardChildren);

      const choiceImagePad = mobile
        ? tinyMobile
          ? 6
          : shortMobile
            ? 8
            : 10
        : Math.max(6, Math.round(8 * desktopUiScale));
      const choiceImageGap = mobile ? 6 : 8;
      const uniformChoiceSpeakerReserve = choices.some((c) =>
        this.situationHasAudio(c.sound_choice)
      )
        ? speakerSize * 0.65 + speakerPad
        : 0;
      let maxChoiceImageReserve = 0;
      for (const c of choices) {
        const key = this.situationTextureKeyFor(c.image_choice);
        if (!key) continue;
        const maxImgH = choiceHeight - choiceImagePad * 2;
        const maxImgW = Math.min(Math.round(maxImgH * 1.35), Math.round(choiceWidth * 0.3));
        const fit = this.computeSituationImageFitSize(key, maxImgW, maxImgH);
        maxChoiceImageReserve = Math.max(
          maxChoiceImageReserve,
          fit.w + choiceImagePad + choiceImageGap
        );
      }

      const questionRows: Phaser.GameObjects.Container[] = [];
      const choiceRowsMeta: ChoiceRowUI[] = [];
      const choiceDoms: Phaser.GameObjects.DOMElement[] = [];
      choices.forEach((choice, index) => {
      
        const sortedIndex = choiceDirection === -1 ? choices.length - 1 - index : index;
        const rowY = anchorY + choiceDirection * (rowStartOffset + sortedIndex * (choiceHeight + choiceGap));

        const choiceBg = this.add.graphics();
        this.drawChoiceBackground(choiceBg, choiceWidth, choiceHeight, "normal");

        const choiceLabel = `${index + 1}. ${choice.choice}`;
        const choiceTextInset = mobile
          ? tinyMobile
            ? 14
            : shortMobile
              ? 18
              : 24
          : Math.max(14, Math.round(24 * desktopUiScale));
        const choiceTextYOffset = mobile ? (tinyMobile ? 12 : 15) : Math.max(6, Math.round(10 * desktopUiScale));
        const hasChoiceSound = this.situationHasAudio(choice.sound_choice);
        const choiceSpeakerReserve = uniformChoiceSpeakerReserve;
        let choiceImageReserve = maxChoiceImageReserve;
        let choiceImage: Phaser.GameObjects.Image | undefined;
        let choiceMagnifyBtn: Phaser.GameObjects.Image | undefined;
        let choiceImageFit: { w: number; h: number } | undefined;
        let choiceMagnifySize = 0;
        const choiceImageKey = this.situationTextureKeyFor(choice.image_choice);
        if (choiceImageKey) {
          const maxImgH = choiceHeight - choiceImagePad * 2;
          const maxImgW = Math.min(Math.round(maxImgH * 1.35), Math.round(choiceWidth * 0.3));
          choiceImageFit = this.computeSituationImageFitSize(choiceImageKey, maxImgW, maxImgH);
          const choiceImageX = choiceWidth / 2 - choiceImagePad - choiceImageFit.w / 2;
          choiceMagnifySize = mobile
            ? tinyMobile
              ? 16
              : shortMobile
                ? 18
                : 20
            : Math.max(18, Math.round(22 * desktopUiScale));
          const cardImage = this.createSituationCardImage(
            choiceImageKey,
            choiceImageX,
            0,
            choiceImageFit.w,
            choiceImageFit.h,
            choiceMagnifySize,
            2,
            false
          );
          choiceImage = cardImage.image;
          choiceMagnifyBtn = cardImage.magnifyBtn;
        }
        const choiceDiv = createThaiTextElement(choiceLabel, {
          width: choiceWidth - choiceSpeakerReserve - choiceImageReserve,
          height: choiceHeight,
          fontSize: mobile
            ? tinyMobile
              ? "18px"
              : shortMobile
                ? "22px"
                : "26px"
            : `${Math.max(12, Math.round(18 * desktopUiScale))}px`,
          color: "#222222",
          align: "left",
          padding: choiceTextInset,
          lineHeight: 1.2,
          safePaddingYPx: 2,
        });
        const choiceDom = this.add
          .dom(-choiceWidth / 2 + choiceSpeakerReserve, -choiceHeight / 2 + choiceTextYOffset, choiceDiv)
          .setOrigin(0, 0)
          .setDepth(1)
          .setScrollFactor(1);
        this.setSituationDomVisible(choiceDom, false);
        this.setSituationDomPointerThrough(choiceDom);
        choiceDoms.push(choiceDom);

        const rowChildren: Phaser.GameObjects.GameObject[] = [choiceBg, choiceDom];
        if (choiceImage) rowChildren.push(choiceImage);
        if (choiceMagnifyBtn) rowChildren.push(choiceMagnifyBtn);
        const row = this.add.container(anchorX, rowY, rowChildren).setDepth(20);
        row.setSize(choiceWidth, choiceHeight);
        row.setInteractive({ useHandCursor: true });
        row.setVisible(false);

        let choiceVolumeBtn: Phaser.GameObjects.Image | undefined;
        if (hasChoiceSound) {
          choiceVolumeBtn = this.createSituationSpeakerButton(
            -choiceWidth / 2 - speakerSize * 0.22,
            0,
            speakerSize,
            8,
            () => this.playSituationChoiceAudio(choice.sound_choice)
          );
          row.add(choiceVolumeBtn);
        }

        questionRows.push(row);
        const rowMeta: ChoiceRowUI = {
          row,
          bg: choiceBg,
          dom: choiceDom,
          choiceId: choice.id,
          isCorrect: choice.is_correct,
          isEliminated: false,
          width: choiceWidth,
          height: choiceHeight,
          volumeBtn: choiceVolumeBtn,
          soundChoice: choice.sound_choice,
          choiceImage,
          choiceMagnifyBtn,
          choiceImageKey: choiceImageKey ?? undefined,
          choiceImageFit,
          choiceImagePad,
          choiceMagnifySize: choiceMagnifySize || undefined,
        };
        choiceRowsMeta.push(rowMeta);

        row.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
          if (rowMeta.isEliminated) return;
          if (
            rowMeta.choiceImageKey &&
            rowMeta.choiceImageFit &&
            rowMeta.choiceImagePad != null &&
            rowMeta.choiceMagnifySize &&
            this.isSituationPointerOnChoiceRowImage(
              row,
              pointer,
              choiceWidth,
              rowMeta.choiceImageFit,
              rowMeta.choiceImagePad,
              rowMeta.choiceMagnifySize
            )
          ) {
            pointer.event?.stopPropagation();
            (pointer.event as Event | undefined)?.stopPropagation?.();
            this.showSituationImageLightbox(rowMeta.choiceImageKey);
            return;
          }
          if (!choice.is_correct) {
            if (this.answered.has(questionIndex)) return;
            this.playSfx("sfx_incorrect");
            this.drawChoiceBackground(choiceBg, choiceWidth, choiceHeight, "wrong");

            this.drawQuestionBackground(questionBg, questionWidth, questionHeight, "wrong");

            // ตอบผิดให้รีเซ็ตคอมโบทันที ต้องเริ่มนับใหม่จาก 1
            this.correctStreak = 0;
            const wrongCount = (this.wrongAttemptsByQuestion.get(questionIndex) ?? 0) + 1;
            this.wrongAttemptsByQuestion.set(questionIndex, wrongCount);
            if (
              wrongCount >= 1 &&
              !this.answered.has(questionIndex) &&
              this.activeQuestionIndex === questionIndex
            ) {
              this.showBalloonHint(questionIndex);
            }
            if (this.hasSituationQuestionHintContent(item)) {
              this.showSituationQuestionHintBubble(item);
            } else {
              this.showRandomMessage(this.messagePools.wrong, 1900, "point");
            }
            this.playSituationWrongChoiceShake(row);
            if (this.shieldCount > 0) {
              this.shieldCount -= 1;
              this.playShieldConsumeFx(row);
            } else {
              this.adjustSituationTimerSeconds(SITUATION_WRONG_TIME_PENALTY_SEC, true);
            }

            this.time.delayedCall(220, () => {
              if (!row.active || this.answered.has(questionIndex)) return;
              if (rowMeta.isEliminated) {
                this.drawChoiceBackground(choiceBg, choiceWidth, choiceHeight, "disabled");
              } else {
                this.drawChoiceBackground(choiceBg, choiceWidth, choiceHeight, "normal");
              }

              this.refreshQuestionFocusStyles();
            });
            return;
          }

          const remaining = this.remainingCorrectByQuestion.get(questionIndex);
          if (!remaining?.has(choice.id)) return;

          remaining.delete(choice.id);
          row.disableInteractive();
          rowMeta.isEliminated = true;
          this.drawChoiceBackground(choiceBg, choiceWidth, choiceHeight, "correct");
          this.disableSituationSpeaker(rowMeta.volumeBtn);
          this.playSfx("sfx_correct");

          const questionAlreadyPassed = this.answered.has(questionIndex);
          const awardScore = !questionAlreadyPassed;

          if (awardScore) {
            this.correctStreak += 1;
            const coinGain = 1;
            this.score += coinGain;
            this.playCorrectAnswerFx(row, coinGain);

            this.answered.add(questionIndex);
            this.drawQuestionBackground(questionBg, questionWidth, questionHeight, "correct");
            void this.trackCorrectAnswer(questionIndex, item);
            this.reportRunstateQuestionCompleted(questionIndex + 1);
            this.wrongAttemptsByQuestion.set(questionIndex, 0);
            this.releaseBalloonHintsOnCorrect();
            this.showRandomMessage(this.messagePools.correct, 1900, "clap");
            iconBadge.setVisible(true).setScale(0.7);
            this.layoutQuestionIconSideBySide(
              questionIcon,
              iconBadge,
              questionIconSize,
              iconBadgeSize,
              true
            );
            this.playSfx("sfx_bonus");
            this.tweens.add({
              targets: iconBadge,
              scale: 1,
              duration: 220,
              ease: "Back.easeOut",
            });
            if (
              this.correctStreak >= SITUATION_COMBO_CORRECT_STREAK &&
              this.correctStreak % SITUATION_COMBO_CORRECT_STREAK === 0
            ) {
              this.correctStreak = 0;
              this.shieldCount += 1;
              this.emitShieldGainFx(questionCard);
              this.updateHudShield(1);
              this.playSfx("sfx_win_combo");
            }
            this.tryFinishSituationWhenAllCorrect();
          } else {
            this.playCorrectAnswerFx(row, 0);
          }

          if (remaining.size > 0) {
            return;
          }

          questionRows.forEach((r) => r.disableInteractive());
          choiceRowsMeta.forEach((meta) => this.disableSituationSpeaker(meta.volumeBtn));
          this.disableSituationSpeaker(questionVolumeBtn);
          this.collapseChoicesAfterCorrect(questionIndex);
        });
      });

      const handleQuestionIconToggle = (
        pointer: Phaser.Input.Pointer,
        _localX?: number,
        _localY?: number,
        event?: Event
      ) => {
        event?.stopPropagation();
        (pointer.event as Event | undefined)?.stopPropagation?.();

        const isExpanded = this.isQuestionExpanded(questionIndex);
        const openingCurrent = !isExpanded;
        const baseDepth = 20;
        const activeDepth = 120;

        if (openingCurrent) {
          this.setActiveQuestion(questionIndex);
          this.collapseOtherQuestionChoices(questionIndex);
          if (this.balloonHints.length > 0) {
            this.balloonTargetQuestionIndex = questionIndex;
          }
          this.hideOtherQuestionCards(questionIndex);
          this.expandQuestionWithChoices(questionIndex);
        } else {
          this.setActiveQuestion(null);
          this.collapseQuestionToIconOnly(questionIndex);
        }

        this.refreshQuestionFocusStyles();
        this.questionUIs.forEach((ui, idx) => {
          const isActive = idx === questionIndex && this.isQuestionExpanded(questionIndex);
          ui.questionCard.setDepth(isActive ? activeDepth : baseDepth);
          ui.questionIconRoot.setDepth(isActive ? activeDepth + 6 : 22);
          ui.questionBg.setDepth(isActive ? activeDepth : baseDepth);
          ui.choiceRows.forEach((row) => row.setDepth(isActive ? activeDepth : baseDepth));
          ui.questionDom.setDepth(isActive ? activeDepth : baseDepth);
          ui.questionVolumeBtn?.setDepth(isActive ? activeDepth + 1 : 8);
          ui.questionImage?.setDepth(isActive ? activeDepth + 3 : 9);
          ui.questionMagnifyBtn?.setDepth(isActive ? activeDepth + 4 : 10);
          ui.questionImageHitZone?.setDepth(isActive ? activeDepth + 5 : 11);
          ui.choiceDoms.forEach((dom) => dom.setDepth(isActive ? activeDepth : baseDepth));
        });
        this.applyProximityQuestionTextVisibility();

        if (openingCurrent) {
          if (this.hasSituationQuestionHintContent(item)) {
            this.showSituationQuestionHintBubble(item);
          }
          const wrongCount = this.wrongAttemptsByQuestion.get(questionIndex) ?? 0;
          if (!this.answered.has(questionIndex) && wrongCount >= 1) {
            this.showBalloonHint(questionIndex);
          }
        }
      };

      questionIcon.on("pointerdown", handleQuestionIconToggle);

      questionHitZone.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
        const questionImagePad = mobile
          ? tinyMobile
            ? 6
            : shortMobile
              ? 8
              : 10
          : Math.max(6, Math.round(8 * desktopUiScale));
        if (
          questionImageKey &&
          questionImageFit &&
          this.isSituationPointerOnQuestionImage(
            questionCard,
            pointer,
            questionWidth,
            questionImageFit,
            questionImagePad,
            mobile
              ? tinyMobile
                ? 18
                : shortMobile
                  ? 20
                  : 22
              : Math.max(20, Math.round(24 * desktopUiScale))
          )
        ) {
          pointer.event?.stopPropagation();
          (pointer.event as Event | undefined)?.stopPropagation?.();
          this.showSituationImageLightbox(questionImageKey);
        }
      });

      this.questionUIs.push({
        question: item,
        questionCard,
        choiceRows: questionRows,
        choiceRowsMeta,
        questionBg,
        questionIconRoot,
        questionIcon,
        iconBadge,
        questionWidth,
        questionHeight,
        questionDom,
        questionVolumeBtn,
        questionImage,
        questionMagnifyBtn,
        questionImageHitZone,
        choiceDoms,
        layout: {
          anchorX,
          anchorY,
          choiceDirection: choiceDirection as 1 | -1,
          rowStartOffset,
          choiceWidth,
          choiceHeight,
          choiceGap,
          choicesCount,
          questionWidth,
          questionHeight,
          questionImageOuterW,
          questionIconSize,
          iconBadgeSize,
        },
      });
    }
    this.refreshQuestionFocusStyles();
    this.refreshQuestionIconIdleFx();
  }

  private layoutSituationHudStatDomTexts() {
    const ui = createHudScaleCtx(this.scale.width, this.scale.height, this.mobile);
    const fontPx = getHudStatFontPx(ui.px.bind(ui), this.mobile);
    if (this.hudTimeText) {
      applyHudStatDomText({
        scene: this,
        anchor: this.hudTimeText,
        text: this.formatElapsedTime(),
        x: this.hudTimeTargetX,
        y: this.hudTimeTargetY,
        fontPx,
        color: HUD_VALUE_COLOR,
        originX: 1,
        originY: 0.5,
      });
    }
    if (this.hudScoreText) {
      applyHudStatDomText({
        scene: this,
        anchor: this.hudScoreText,
        text: `${this.score}`,
        x: this.hudScoreNumX,
        y: this.hudScoreNumY,
        fontPx,
        color: HUD_VALUE_COLOR,
        originX: 1,
        originY: 0.5,
      });
    }
  }

  private updateHudScore(delta = 0) {
    if (!this.hudScoreText) return;
    this.layoutSituationHudStatDomTexts();
    if (delta === 0) return;

    const popScale = Math.min(1 + 0.12 + Math.abs(delta) * 0.06, 1.35);
    const scoreDom = this.hudScoreText.getData("hudStatDom") as Phaser.GameObjects.DOMElement | undefined;
    const flashTarget = scoreDom ?? this.hudScoreText;
    this.tweens.killTweensOf(flashTarget);
    flashTarget.setScale(1);
    const baseColor = HUD_VALUE_COLOR;
    const flashColor = delta > 0 ? HUD_VALUE_COLOR : "#e14d4d";
    const valueSpan = scoreDom?.node?.querySelector?.("span") as HTMLSpanElement | null;
    if (valueSpan) valueSpan.style.color = flashColor;
    this.tweens.add({
      targets: flashTarget,
      scaleX: popScale,
      scaleY: popScale,
      duration: 120,
      ease: "Quad.easeOut",
      yoyo: true,
      hold: 30,
      onComplete: () => {
        flashTarget.setScale(1);
        if (valueSpan) valueSpan.style.color = baseColor;
      },
    });
  }

  private updateHudShield(delta = 0) {
    if (!this.hudShieldText) return;
    this.hudShieldText.setText(`${this.shieldCount}`);
    if (delta === 0) return;

    const popScale = Math.min(1 + 0.12 + Math.abs(delta) * 0.06, 1.35);
    this.tweens.killTweensOf(this.hudShieldText);
    this.hudShieldText.setScale(1);
    const baseColor = "#ffffff";
    const flashColor = "#ffffff";
    this.hudShieldText.setColor(flashColor);
    this.tweens.add({
      targets: this.hudShieldText,
      scaleX: popScale,
      scaleY: popScale,
      duration: 120,
      ease: "Quad.easeOut",
      yoyo: true,
      hold: 30,
      onComplete: () => {
        this.hudShieldText?.setScale(1);
        this.hudShieldText?.setColor(baseColor);
      },
    });
  }

  private playCorrectAnswerFx(row: Phaser.GameObjects.Container, coinGain: number) {
    const camera = this.cameras.main;
    const startX = row.x - camera.scrollX;
    const startY = row.y - camera.scrollY;
    const fxDepth = 2600;
    const mobile = isMobileLayout();

    const halo = this.add
      .circle(startX, startY, mobile ? 56 : 64, 0xffffff, 0.3)
      .setScrollFactor(0)
      .setDepth(fxDepth);
    this.tweens.add({
      targets: halo,
      scale: mobile ? 1.25 : 2,
      alpha: 0,
      duration: 450,
      ease: "Quad.easeOut",
      onComplete: () => halo.destroy(),
    });

    const particles = this.add.particles(startX, startY - (mobile ? 42 : 60), "fx_star", {
      speed: { min: 100, max: 250 },
      angle: { min: 0, max: 360 },
      lifespan: 800,
      gravityY: 1000,
      quantity: 15,
      emitting: false,
      tint: [0xffffff, 0xfff6b0, 0xfff2d8],
      blendMode: Phaser.BlendModes.NORMAL,
    });
    particles.setScrollFactor(0).setDepth(fxDepth + 1);
 
    particles.explode(15);
    this.time.delayedCall(1200, () => {
      this.tweens.add({
        targets: particles,
        alpha: 0,
        duration: 420,
        ease: "Quad.easeOut",
        onComplete: () => particles.destroy(),
      });
    });

    if (coinGain <= 0 || !this.hudScoreText) {
      if (coinGain > 0) this.updateHudScore();
      return;
    }

    const flyCoin = this.add
      .image(startX, startY, "coin_icon")
      .setDisplaySize(mobile ? 34 : 40, mobile ? 34 : 40)
      .setScrollFactor(0)
      .setDepth(fxDepth + 3);
    const flyPlus = this.add
      .text(startX + (mobile ? 16 : 20), startY + (mobile ? 2 : 0), `+${coinGain}`, {
        font: mobile
          ? `700 48px "Noto Sans Thai", sans-serif`
          : `700 58px "Noto Sans Thai", sans-serif`,
        color: "#3cff67",
        stroke: "#1f7a28",
        strokeThickness: mobile ? 8 : 9,
      })
      .setOrigin(0, 0.5)
      .setScrollFactor(0)
      .setDepth(fxDepth + 3);

    this.tweens.add({
      targets: [flyCoin, flyPlus],
      scale: { from: 1, to: mobile ? 1.95 : 2.15 },
      duration: 180,
      ease: "Back.easeOut",
      yoyo: true,
      hold: 90,
      onComplete: () => {
        this.tweens.add({
          targets: [flyCoin, flyPlus],
          x: this.hudScoreTargetX,
          y: this.hudScoreTargetY,
          scale: { from: 1.18, to: 0.62 },
          duration: 640,
          ease: "Sine.easeInOut",
          onComplete: () => {
            flyCoin.destroy();
            flyPlus.destroy();
            this.emitHudCoinBurst(coinGain);
            this.playSfx("sfx_coin_collect");
            this.updateHudScore(coinGain);
          },
        });
      },
    });
  }

  private playSituationWrongChoiceShake(row: Phaser.GameObjects.Container) {
    const baseX = row.x;
    const mobile = isMobileLayout();
    this.tweens.add({
      targets: row,
      x: baseX + (mobile ? 8 : 10),
      duration: 48,
      yoyo: true,
      repeat: 3,
      ease: "Sine.easeInOut",
      onComplete: () => row.setX(baseX),
    });
  }

  private playShieldConsumeFx(row: Phaser.GameObjects.Container) {
    this.playSfx("sfx_shield_destroy");
    const camera = this.cameras.main;
    const startX = row.x - camera.scrollX;
    const startY = row.y - camera.scrollY;
    const fxDepth = 2600;
    const mobile = isMobileLayout();

    const centerX = startX;
    const centerY = startY;
    const shieldSize = mobile ? 92 : 122;
    const texFrame = this.textures.getFrame("situation_shield");
    const texWidth = texFrame?.cutWidth ?? 2;
    const texHeight = texFrame?.cutHeight ?? 2;
    const halfWidth = Math.floor(texWidth / 2);

    const shieldLeft = this.add
      .image(centerX, centerY, "situation_shield")
      .setDisplaySize(shieldSize, shieldSize)
      .setOrigin(1, 0.5)
      .setCrop(0, 0, halfWidth, texHeight)
      .setScrollFactor(0)
      .setDepth(fxDepth + 3);
    const shieldRight = this.add
      .image(centerX, centerY, "situation_shield")
      .setDisplaySize(shieldSize, shieldSize)
      .setOrigin(0, 0.5)
      .setCrop(halfWidth, 0, texWidth - halfWidth, texHeight)
      .setScrollFactor(0)
      .setDepth(fxDepth + 3);

    this.tweens.add({
      targets: shieldLeft,
      x: centerX - (mobile ? 56 : 72),
      y: centerY + (mobile ? 18 : 26),
      angle: -22,
      alpha: 0,
      duration: 620,
      ease: "Back.easeIn",
    });
    this.tweens.add({
      targets: shieldRight,
      x: centerX + (mobile ? 56 : 72),
      y: centerY + (mobile ? 18 : 26),
      angle: 22,
      alpha: 0,
      duration: 620,
      ease: "Back.easeIn",
      onComplete: () => {
        shieldLeft.destroy();
        shieldRight.destroy();
      },
    });
    this.updateHudShield(-1);
  }

  private emitShieldGainFx(questionCard: Phaser.GameObjects.Container) {
    const camera = this.cameras.main;
    const startX = questionCard.x - camera.scrollX + questionCard.width / 2 - 20;
    const startY = questionCard.y - camera.scrollY - questionCard.height / 2 + 18;
    const mobile = isMobileLayout();
    const fxDepth = 2600;

    if (!this.hudShieldText) return;

    const flyShield = this.add
      .image(startX, startY, "situation_shield")
      .setDisplaySize(mobile ? 34 : 32, mobile ? 34 : 32)
      .setScrollFactor(0)
      .setDepth(fxDepth + 3);
    this.tweens.add({
      targets: [flyShield],
      scale: { from: 0.5, to: mobile ? 0.65 : 0.75 },
      duration: 180,
      ease: "Back.easeOut",
      yoyo: true,
      hold: 90,
      onComplete: () => {
        this.tweens.add({
          targets: [flyShield],
          x: this.hudShieldTargetX,
          y: this.hudShieldTargetY,
          scale: { from: 0.3, to: 0.3 },
          duration: 640,
          ease: "Sine.easeInOut",
          onComplete: () => {
            flyShield.destroy();
          },
        });
      },
    });
  }

  private emitHudCoinBurst(coinGain = 1) {
    const burst = this.add.particles(this.hudScoreTargetX, this.hudScoreTargetY, "coin_icon", {
      speed: { min: 80, max: 130 },
      angle: { min: 0, max: 360 },
      lifespan: { min: 260, max: 420 },
      quantity: 0,
      scale: {
        onEmit: () => Phaser.Math.FloatBetween(0.12, 0.28),
        onUpdate: (_p, _k, t, value) => Math.max(0.3, value * (1 - t)),
      },
      rotate: { min: 0, max: 360 },
      gravityY: 0,
      emitting: false,
      blendMode: Phaser.BlendModes.NORMAL,
    });
    burst.setScrollFactor(0).setDepth(2605);
    burst.explode(coinGain >= 2 ? 20 : 15);
    this.time.delayedCall(800, () => {
      this.tweens.add({
        targets: burst,
        alpha: 0,
        duration: 180,
        ease: "Quad.easeOut",
        onComplete: () => burst.destroy(),
      });
    });
  }

  private formatElapsedTime(): string {
    const elapsedSec = Math.max(0, Math.floor((Date.now() - this.startTime) / 1000));
    const min = Math.floor(elapsedSec / 60);
    const sec = elapsedSec % 60;
    return `${min}:${sec.toString().padStart(2, "0")}`;
  }

  /** ปรับเวลาที่แสดงบน HUD — ค่าบวก = เพิ่มเวลา (โทษ), ค่าลบ = ลดเวลา (โบนัส combo) */
  private adjustSituationTimerSeconds(deltaSeconds: number, showHudFx = false) {
    if (!deltaSeconds) return;
    this.startTime -= deltaSeconds * 1000;
    this.hudTimeText?.setText(this.formatElapsedTime());
    if (showHudFx) {
      this.playSituationTimerDeltaFx(deltaSeconds);
    }
  }

  private playSituationTimerDeltaFx(deltaSeconds: number) {
    if (!this.hudTimeText || !deltaSeconds) return;
    const mobile = this.mobile;
    const hudDepth = 2605;
    const anchorX = this.hudTimeTargetX + (mobile ? 10 : 14);
    const anchorY = this.hudTimeTargetY;
    const isPenalty = deltaSeconds > 0;
    const label = isPenalty ? `+${Math.abs(deltaSeconds)}` : `-${Math.abs(deltaSeconds)}`;

    const fx = this.add
      .text(anchorX, anchorY, label, {
        font: mobile
          ? `700 24px "Noto Sans Thai", sans-serif`
          : `700 30px "Noto Sans Thai", sans-serif`,
        color: isPenalty ? "#ff4c4c" : "#2ecc71",
        stroke: isPenalty ? "#7a1f1f" : "#1f6b3a",
        strokeThickness: mobile ? 5 : 6,
      })
      .setOrigin(0, 0.5)
      .setScrollFactor(0)
      .setDepth(hudDepth);

    this.tweens.add({
      targets: fx,
      y: anchorY - (mobile ? 12 : 16),
      alpha: 0,
      scale: { from: 1, to: 0.88 },
      duration: 920,
      ease: "Sine.easeOut",
      onComplete: () => fx.destroy(),
    });
  }

  private createTopHud(exerciseName: string, mobile: boolean) {
    this.destroySituationTopHud();
    const showTitle = hasHudCenterLabel(exerciseName);
    const w = this.scale.width;
    const ui = createHudScaleCtx(w, this.scale.height, mobile);
    const leftPad = mobile ? 14 : 24;
    const topPad = mobile ? 12 : 18;
    const timeBgW = mobile ? 128 : 180;
    const timeBgH = mobile ? 42 : 50;
    const scoreBgW = mobile ? 110 : 150;
    const scoreBgH = mobile ? 42 : 50;
    const titleW = mobile ? Math.max(220, w - leftPad * 2) : 540;
    let titleH = mobile ? 40 : timeBgH;
    const titleY = mobile ? topPad + timeBgH + 10 : topPad;
    const hudDepth = 2000;
    const titlePaddingX = mobile ? 16 : 20;
    const titlePaddingY = mobile ? 8 : 12;

    const fontHudDigits = getHudStatFont(ui.px.bind(ui), mobile);
    const titleFontPx = getHudCenterTextMaxFontPx(ui.px.bind(ui), mobile);
    const fontHudTitle = `700 ${titleFontPx}px "Noto Sans Thai", sans-serif`;
    const fontHudShield = mobile
      ? `700 ${ui.px(13)}px "Noto Sans Thai", sans-serif`
      : `700 ${ui.px(17)}px "Noto Sans Thai", sans-serif`;

    const timeIconSize = mobile ? 22 : 28;
    const timeIconPad = mobile ? 14 : 24;

    const hud = this.add.container(0, 0).setScrollFactor(0).setDepth(hudDepth);
    this.hudRoot = hud;

    const centerX = w / 2;
    const titlePill = this.add.graphics();
    if (showTitle && typeof document !== "undefined") {
      const maxTextW = titleW - titlePaddingX * 2;
      const textH = measureThaiSpanHeight(exerciseName, {
        fontSizePx: titleFontPx,
        fontWeight: 700,
        textAlign: "center",
        maxWidthPx: maxTextW,
      });
      titleH = Math.max(titleH, Math.ceil(textH + titlePaddingY * 2));
      const span = createThaiTextSpan(exerciseName, {
        fontSizePx: titleFontPx,
        color: "#333333",
        fontWeight: 700,
        textAlign: "center",
        maxWidthPx: maxTextW,
        pointerEventsNone: true,
      });
      titlePill.fillStyle(0xffffff, 0.5);
      titlePill.lineStyle(2, 0xd9e8e5, 0.5);
      titlePill.fillRoundedRect(centerX - titleW / 2, titleY, titleW, titleH, 10);
      titlePill.strokeRoundedRect(centerX - titleW / 2, titleY, titleW, titleH, 10);
      const dom = this.add
        .dom(centerX, titleY + titleH / 2, span)
        .setOrigin(0.5, 0.5);
      dom.pointerEvents = "none";
      hud.add([titlePill, dom]);
    } else if (showTitle) {
      titlePill.fillStyle(0xffffff, 0.5);
      titlePill.lineStyle(2, 0xd9e8e5, 0.5);
      titlePill.fillRoundedRect(centerX - titleW / 2, titleY, titleW, titleH, 10);
      titlePill.strokeRoundedRect(centerX - titleW / 2, titleY, titleW, titleH, 10);
      const titleText = this.add
        .text(centerX, titleY + titleH / 2, exerciseName, {
          font: fontHudTitle,
          color: "#333333",
          wordWrap: { width: titleW - titlePaddingX * 2, useAdvancedWrap: true },
          align: "center",
        })
        .setOrigin(0.5);
      hud.add([titlePill, titleText]);
    } else {
      titlePill.setVisible(false);
      hud.add(titlePill);
    }

    hud.add(
      this.add
        .image(leftPad + timeBgW / 2, topPad + timeBgH / 2, "time_bg")
        .setDisplaySize(timeBgW, timeBgH)
    );
    const timeIconX = leftPad + timeIconPad + timeIconSize / 2;
    const timeIconY = topPad + timeBgH / 2;
    const timeIcon = this.add
      .image(timeIconX, timeIconY, "hud_hourglass")
      .setOrigin(0.5);
    layoutHudIconPreserveAspect(timeIcon, timeIconX, timeIconY, timeIconSize);
    this.hudTimeTargetX = leftPad + timeBgW - (mobile ? 16 : 24);
    this.hudTimeTargetY = topPad + timeBgH / 2;
    this.hudTimeText = this.add
      .text(this.hudTimeTargetX, this.hudTimeTargetY, this.formatElapsedTime(), {
        font: fontHudDigits,
        color: HUD_VALUE_COLOR,
      })
      .setOrigin(1, 0.5);

    const shieldBgSize = mobile ? 40 : 50;
    const shieldGap = mobile ? 8 : 14;
    const scoreX = w - leftPad - scoreBgW;
    const scoreHudY = topPad + scoreBgH / 2;
    const shieldBgX = scoreX - shieldGap - shieldBgSize / 2;

    hud.add(
      this.add
        .image(scoreX + scoreBgW / 2, scoreHudY, "score_bg")
        .setDisplaySize(scoreBgW, scoreBgH)
    );
    hud.add(
      this.add
        .image(shieldBgX, scoreHudY, "situation_circle")
        .setDisplaySize(shieldBgSize, shieldBgSize)
    );

    const coinHudX = scoreX + (mobile ? 22 : 30);
    this.hudScoreTargetX = coinHudX;
    this.hudScoreTargetY = scoreHudY;

    const scoreNumX = scoreX + scoreBgW - (mobile ? 18 : 26);
    this.hudScoreNumX = scoreNumX;
    this.hudScoreNumY = scoreHudY;
    this.hudScoreText = this.add
      .text(scoreNumX, scoreHudY, `${this.score}`, {
        font: fontHudDigits,
        color: HUD_VALUE_COLOR,
      })
      .setOrigin(1, 0.5);

    this.hudShieldTargetX = shieldBgX;
    this.hudShieldTargetY = scoreHudY;
    this.hudShieldText = this.add
      .text(this.hudShieldTargetX, this.hudShieldTargetY, `${this.shieldCount}`, {
        font: fontHudShield,
        color: "#ffffff",
        stroke: "#2e84c8",
        strokeThickness: mobile ? 4 : 5,
      })
      .setOrigin(0.5);

    hud.add([
      timeIcon,
      this.add
        .image(coinHudX, scoreHudY, "coin_icon")
        .setDisplaySize(mobile ? 30 : 50, mobile ? 30 : 50),
      this.add
        .image(shieldBgX, scoreHudY, "situation_shield")
        .setDisplaySize(mobile ? 22 : 32, mobile ? 22 : 32),
      this.hudTimeText,
      this.hudScoreText,
      this.hudShieldText,
    ]);

    this.layoutSituationHudStatDomTexts();

    this.hudTimerEvent = this.time.addEvent({
      delay: 250,
      loop: true,
      callback: () => {
        this.layoutSituationHudStatDomTexts();
      },
    });
  }

  private destroySituationTopHud() {
    this.hudTimerEvent?.destroy();
    this.hudTimerEvent = undefined;
    this.hudRoot?.destroy(true);
    this.hudRoot = undefined;
    this.hudTimeText = undefined;
    this.hudScoreText = undefined;
    this.hudShieldText = undefined;
  }

  private createAdvisorAndMessageUI() {
    this.teacherHintUI?.destroy();
    this.teacherHintUI = new TeacherHintUI(this, {
      mobile: this.mobile,
      onNotificationSfx: () => this.playSfx("sfx_notification_message"),
    });
    this.teacherHintUI.create();
  }

  private showRandomMessage(
    pool: readonly string[],
    durationMs = 2000,
    teacherStateWhileVisible?: "point" | "clap"
  ) {
    const now = Date.now();
    if (now - this.lastMessageShownMs < 900) return;
    const safePool = Array.isArray(pool) ? pool : [];
    if (safePool.length === 0) return;
    const id = Phaser.Utils.Array.GetRandom(safePool);
    const text = this.messageCatalog[id];
    if (!text) return;
    this.showMessage(text, durationMs, teacherStateWhileVisible);
  }

  private resolveUrl(pathOrUrl?: string | null): string {
    const raw = (pathOrUrl ?? "").trim();
    if (!raw) return "";
    const normalized = raw.toLowerCase();
    if (normalized === "null" || normalized === "undefined") return "";
    if (/^https?:\/\//i.test(raw)) return raw;
    return `${API_BASE_URL}${raw}`;
  }

  private hasSituationQuestionHintContent(question: SituationQuestion): boolean {
    const hint = (question.hint ?? "").trim();
    const imgUrl = this.resolveUrl(question.image_hint);
    const imgKey =
      imgUrl && this.situationTextureKeyByUrl.has(imgUrl)
        ? (this.situationTextureKeyByUrl.get(imgUrl) as string)
        : undefined;
    return !!(hint || imgKey);
  }

  private showSituationQuestionHintBubble(question: SituationQuestion) {
    if (!this.teacherHintUI) {
      this.createAdvisorAndMessageUI();
    }
    if (!this.teacherHintUI) return;

    const hint = (question.hint ?? "").trim();
    const imgUrl = this.resolveUrl(question.image_hint);
    const imgKey =
      imgUrl && this.situationTextureKeyByUrl.has(imgUrl)
        ? (this.situationTextureKeyByUrl.get(imgUrl) as string)
        : undefined;

    const sq = this.resolveUrl(question.sound_question);
    const sh = this.resolveUrl(question.sound_hint);
    if (sh && (!sq || sh !== sq)) {
      this.time.delayedCall(600, () => this.playSituationUrlAudio(question.sound_hint));
    }

    if (!hint && !imgKey) return;

    const imgReady = !!(imgKey && this.textures.exists(imgKey));
    if (!hint && !imgReady) {
      this.showRandomMessage(this.messagePools.wrong, 1900, "point");
      return;
    }

    this.lastMessageShownMs = Date.now();
    this.teacherHintUI.presentHint({
      text: hint,
      hintTextureKey: imgKey,
      durationMs: 5200,
      teacherState: "point",
    });
  }

  private playSituationUrlAudio(raw?: string | null) {
    const url = this.resolveUrl(raw);
    if (!url) return;
    const key = this.situationAudioKeyByUrl.get(url);
    if (!key || !this.cache.audio.exists(key)) return;
    guardedScenePlayQuestion(this, key, 1);
  }

  private playSituationChoiceAudio(raw?: string | null) {
    const url = this.resolveUrl(raw);
    if (!url) return;
    const key = this.situationAudioKeyByUrl.get(url);
    if (!key || !this.cache.audio.exists(key)) return;
    guardedScenePlayChoice(this, key, 1);
  }

  private situationHasAudio(raw?: string | null): boolean {
    const url = this.resolveUrl(raw);
    if (!url) return false;
    const key = this.situationAudioKeyByUrl.get(url);
    return !!(key && this.cache.audio.exists(key));
  }

  private situationTextureKeyFor(raw?: string | null): string | undefined {
    const url = this.resolveUrl(raw);
    if (!url) return undefined;
    const key = this.situationTextureKeyByUrl.get(url);
    if (!key || !this.textures.exists(key)) return undefined;
    return key;
  }

  private computeSituationImageFitSize(
    textureKey: string,
    maxW: number,
    maxH: number
  ): { w: number; h: number } {
    const tex = this.textures.get(textureKey).getSourceImage() as { width: number; height: number };
    const ratio = tex.width / Math.max(1, tex.height);
    let w = maxW;
    let h = w / ratio;
    if (h > maxH) {
      h = maxH;
      w = h * ratio;
    }
    return { w: Math.max(1, w), h: Math.max(1, h) };
  }

  private resolveSituationQuestionCardMetrics(params: {
    mobile: boolean;
    tinyMobile: boolean;
    shortMobile: boolean;
    desktopUiScale: number;
    questionWidth: number;
    questionMinHeight: number;
    question: string;
    soundQuestion?: string | null;
    imageQuestion?: string | null;
    speakerSize: number;
    speakerPad: number;
    choiceHeight: number;
    choiceRowGap: number;
  }) {
    const {
      mobile,
      tinyMobile,
      shortMobile,
      desktopUiScale,
      questionWidth,
      questionMinHeight,
      question,
      soundQuestion,
      imageQuestion,
      speakerSize,
      speakerPad,
      choiceHeight,
      choiceRowGap,
    } = params;

    const questionSoundReserve = this.situationHasAudio(soundQuestion)
      ? speakerSize * 0.65 + speakerPad
      : 0;
    const questionFontSizePx = mobile
      ? tinyMobile
        ? 18
        : 22
      : Math.max(14, Math.round(24 * desktopUiScale));
    const questionMinFontSizePx = mobile
      ? tinyMobile
        ? 12
        : shortMobile
          ? 13
          : 14
      : Math.max(12, Math.round(14 * desktopUiScale));
    const questionTextPadding = mobile
      ? tinyMobile
        ? 6
        : shortMobile
          ? 8
          : 12
      : Math.max(6, Math.round(12 * desktopUiScale));
    const questionInnerPadTop = mobile
      ? tinyMobile
        ? 10
        : shortMobile
          ? 11
          : 12
      : Math.max(10, Math.round(12 * desktopUiScale));
    const questionInnerPadBottom = mobile
      ? tinyMobile
        ? 14
        : shortMobile
          ? 16
          : 18
      : Math.max(16, Math.round(20 * desktopUiScale));
    const questionImagePad = mobile
      ? tinyMobile
        ? 6
        : shortMobile
          ? 8
          : 10
      : Math.max(6, Math.round(8 * desktopUiScale));
    const questionImageGap = mobile ? 6 : 8;
    const lineHeight = 1.25;

    const questionImageKey = this.situationTextureKeyFor(imageQuestion);
    let questionImageFit: { w: number; h: number } | undefined;
    let questionImageReserve = 0;
    const questionImageOuterW = 0;
    const questionImageMaxH = mobile
      ? tinyMobile
        ? 52
        : shortMobile
          ? 58
          : 64
      : Math.max(58, Math.round(68 * desktopUiScale));

    if (questionImageKey) {
      const maxImgW = questionImageMaxH;
      questionImageFit = this.computeSituationImageFitSize(questionImageKey, maxImgW, questionImageMaxH);
      questionImageReserve = questionImageFit.w + questionImagePad + questionImageGap;
    }

    const questionTextWidth = questionWidth - questionSoundReserve - questionImageReserve;
    const wrapWidth = Math.max(40, questionTextWidth - questionTextPadding * 2);
    const fittedFontPx = resolveSituationQuestionFontPx(
      question,
      wrapWidth,
      questionFontSizePx,
      questionMinFontSizePx,
      SITUATION_QUESTION_MAX_LINES,
      lineHeight
    );
    const fittedLineCount = Math.min(
      SITUATION_QUESTION_MAX_LINES,
      estimateThaiTextLineCount(question, {
        width: wrapWidth,
        fontSizePx: fittedFontPx,
        fontWeight: 700,
        lineHeight,
      })
    );
    const textBlockH = Math.ceil(fittedFontPx * lineHeight * fittedLineCount);
    const contentH = textBlockH + questionInnerPadTop + questionInnerPadBottom;
    const imageBarH = questionImageFit ? questionImageFit.h + questionImagePad * 2 : 0;
    const speakerMinH = questionSoundReserve > 0 ? speakerSize + 8 : 0;
    const questionHeight = Math.max(questionMinHeight, contentH, imageBarH, speakerMinH);
    const questionTextHeight = textBlockH;
    const questionDomY = (questionInnerPadTop - questionInnerPadBottom) / 2;
    const rowStartOffset = questionHeight / 2 + choiceHeight / 2 + choiceRowGap;

    return {
      questionHeight,
      rowStartOffset,
      questionImageGap,
      questionImageOuterW,
      questionImageReserve,
      questionSoundReserve,
      questionImageKey,
      questionImageFit,
      questionTextWidth,
      questionTextHeight,
      questionFittedFontPx: fittedFontPx,
      questionWrapWidth: wrapWidth,
      questionTextPadding,
      questionDomY,
    };
  }

  private createSituationSpeakerButton(
    x: number,
    y: number,
    size: number,
    depth: number,
    onPlay: () => void
  ): Phaser.GameObjects.Image {
    const btn = this.add
      .image(x, y, HUD_VOLUME_TEXTURE_KEY)
      .setDisplaySize(size, size)
      .setDepth(depth)
      .setInteractive({ useHandCursor: true });
    btn.on("pointerdown", (pointer: Phaser.Input.Pointer, _lx: number, _ly: number, event?: Event) => {
      event?.stopPropagation();
      (pointer.event as Event | undefined)?.stopPropagation?.();
      onPlay();
    });
    return btn;
  }

  private createSituationCardImage(
    textureKey: string,
    centerX: number,
    centerY: number,
    fitW: number,
    fitH: number,
    magnifySize: number,
    depth: number,
    enableInput = true
  ): { image: Phaser.GameObjects.Image; magnifyBtn: Phaser.GameObjects.Image } {
    const image = this.add.image(centerX, centerY, textureKey).setDisplaySize(fitW, fitH).setDepth(depth);
    const magnifyX = centerX + fitW / 2 - magnifySize * 0.28;
    const magnifyY = centerY - fitH / 2 + magnifySize * 0.28;
    const magnifyBtn = this.add
      .image(magnifyX, magnifyY, SITUATION_MAGNIFY_TEXTURE_KEY)
      .setDisplaySize(magnifySize, magnifySize)
      .setDepth(depth + 1);

    if (enableInput) {
      image.setInteractive({ useHandCursor: true });
      magnifyBtn.setInteractive({ useHandCursor: true });
      const openLightbox = (
        pointer: Phaser.Input.Pointer,
        _lx: number,
        _ly: number,
        event?: Event
      ) => {
        event?.stopPropagation();
        (pointer.event as Event | undefined)?.stopPropagation?.();
        this.showSituationImageLightbox(textureKey);
      };
      image.on("pointerdown", openLightbox);
      magnifyBtn.on("pointerdown", openLightbox);
    }

    return { image, magnifyBtn };
  }

  private showSituationImageLightbox(textureKey: string) {
    if (!this.textures.exists(textureKey)) return;
    this.hideSituationImageLightbox(false);
    this.hideSituationDomLayersForLightbox();
    this.situationCameraDragEnabled = false;

    const w = this.scale.width;
    const h = this.scale.height;
    const depth = 3600;

    const backdrop = this.add
      .rectangle(w / 2, h / 2, w + 8, h + 8, 0x000000, 0.72)
      .setScrollFactor(0)
      .setDepth(depth)
      .setInteractive({ useHandCursor: true });
    backdrop.on("pointerdown", () => this.hideSituationImageLightbox());

    const maxW = w * 0.88;
    const maxH = h * 0.82;
    const fit = this.computeSituationImageFitSize(textureKey, maxW, maxH);
    const img = this.add
      .image(w / 2, h / 2, textureKey)
      .setDisplaySize(fit.w, fit.h)
      .setScrollFactor(0)
      .setDepth(depth + 1)
      .setInteractive({ useHandCursor: true });
    img.on("pointerdown", (pointer: Phaser.Input.Pointer, _lx: number, _ly: number, event?: Event) => {
      event?.stopPropagation();
      (pointer.event as Event | undefined)?.stopPropagation?.();
    });

    this.situationImageLightbox = { backdrop, image: img };
  }

  private hideSituationImageLightbox(restoreDom = true) {
    const hadLightbox = !!this.situationImageLightbox;
    this.situationImageLightbox?.backdrop.destroy();
    this.situationImageLightbox?.image.destroy();
    this.situationImageLightbox = undefined;
    this.situationCameraDragEnabled = true;
    if (hadLightbox && restoreDom) {
      this.restoreSituationDomLayersAfterLightbox();
    }
  }

  /** Phaser DOM อยู่เหนือ canvas — ซ่อนข้อความชั่วคราวตอนเปิดรูปใหญ่ */
  private hideSituationDomLayersForLightbox() {
    this.questionUIs.forEach((ui) => {
      this.setSituationDomVisible(ui.questionDom, false);
      ui.choiceDoms.forEach((dom) => this.setSituationDomVisible(dom, false));
    });
    this.balloonHints.forEach((hint) => this.setSituationDomVisible(hint, false));
  }

  private restoreSituationDomLayersAfterLightbox() {
    this.applyProximityQuestionTextVisibility();
    this.questionUIs.forEach((ui) => {
      ui.choiceDoms.forEach((dom, idx) => {
        this.setSituationDomVisible(dom, ui.choiceRows[idx]?.visible ?? false);
      });
    });
    this.balloonHints.forEach((hint) => this.setSituationDomVisible(hint, true));
  }

  private situationLocalPointHitsCardImage(
    localX: number,
    localY: number,
    imageCenterX: number,
    imageCenterY: number,
    imageFit: { w: number; h: number },
    magnifySize: number,
    pad = 10
  ): boolean {
    const halfW = imageFit.w / 2 + pad;
    const halfH = imageFit.h / 2 + pad;
    const inImage =
      localX >= imageCenterX - halfW &&
      localX <= imageCenterX + halfW &&
      localY >= imageCenterY - halfH &&
      localY <= imageCenterY + halfH;
    if (inImage) return true;

    const magnifyX = imageCenterX + imageFit.w / 2 - magnifySize * 0.28;
    const magnifyY = imageCenterY - imageFit.h / 2 + magnifySize * 0.28;
    const magnifyR = magnifySize * 0.62 + pad;
    const dx = localX - magnifyX;
    const dy = localY - magnifyY;
    return dx * dx + dy * dy <= magnifyR * magnifyR;
  }

  private isSituationPointerOnQuestionImage(
    card: Phaser.GameObjects.Container,
    pointer: Phaser.Input.Pointer,
    questionWidth: number,
    imageFit: { w: number; h: number },
    imagePad: number,
    magnifySize: number
  ): boolean {
    const local = card.getLocalPoint(pointer.worldX, pointer.worldY);
    const cx = questionWidth / 2 - imagePad - imageFit.w / 2;
    return this.situationLocalPointHitsCardImage(local.x, local.y, cx, 0, imageFit, magnifySize);
  }

  private isSituationPointerOnChoiceRowImage(
    row: Phaser.GameObjects.Container,
    pointer: Phaser.Input.Pointer,
    choiceWidth: number,
    imageFit: { w: number; h: number },
    imagePad: number,
    magnifySize: number
  ): boolean {
    const local = row.getLocalPoint(pointer.worldX, pointer.worldY);
    const cx = choiceWidth / 2 - imagePad - imageFit.w / 2;
    return this.situationLocalPointHitsCardImage(local.x, local.y, cx, 0, imageFit, magnifySize);
  }

  private disableSituationSpeaker(btn?: Phaser.GameObjects.Image) {
    if (!btn) return;
    btn.disableInteractive();
    btn.setAlpha(0.45);
  }

  private setSituationDomVisible(dom: Phaser.GameObjects.DOMElement | undefined, visible: boolean) {
    if (!dom) return;
    dom.setVisible(visible);
    const node = dom.node as HTMLElement | undefined;
    if (!node) return;
    node.style.display = visible ? "" : "none";
    node.style.visibility = visible ? "" : "hidden";
  }

  /** DOM ทับ canvas — ปล่อยให้กดรูป/โซนด้านล่างได้ */
  private setSituationDomPointerThrough(dom: Phaser.GameObjects.DOMElement | undefined) {
    if (!dom) return;
    const node = dom.node as HTMLElement | undefined;
    if (!node) return;
    node.style.pointerEvents = "none";
  }

  private async preloadSituationHintAssets(payload: SituationPayload): Promise<void> {
    const audioJobs: Array<{ key: string; url: string }> = [];
    const imageJobs: Array<{ key: string; url: string }> = [];

    const registerAudio = (raw?: string | null) => {
      const url = this.resolveUrl(raw);
      if (!url || this.situationAudioKeyByUrl.has(url)) return;
      const key = `situation_audio_${this.situationAudioKeyByUrl.size}`;
      this.situationAudioKeyByUrl.set(url, key);
      if (!this.cache.audio.exists(key)) audioJobs.push({ key, url });
    };
    const registerImage = (raw?: string | null) => {
      const url = this.resolveUrl(raw);
      if (!url || this.situationTextureKeyByUrl.has(url)) return;
      const key = `situation_tex_${this.situationTextureKeyByUrl.size}`;
      this.situationTextureKeyByUrl.set(url, key);
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

    this.load.setCORS("anonymous");
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

  private drawChoiceBackground(
    choiceBg: Phaser.GameObjects.Graphics,
    width: number,
    height: number,
    mode: "normal" | "correct" | "wrong" | "disabled"
  ) {
    choiceBg.clear();
    if (mode === "correct") {
      choiceBg.fillStyle(0xdaffba, 1);
      choiceBg.lineStyle(2, 0x5fd91d, 1);
    } else if (mode === "wrong") {
      choiceBg.fillStyle(0xffd5d5, 1);
      choiceBg.lineStyle(2, 0xf26666, 1);
    } else if (mode === "disabled") {
      choiceBg.fillStyle(0xe3e3e3, 0.98);
      choiceBg.lineStyle(2, 0xbfbfbf, 1);
    } else {
      choiceBg.fillStyle(0xffffff, 0.98);
      choiceBg.lineStyle(2, 0xdddddd, 1);
    }
    choiceBg.fillRoundedRect(-width / 2, -height / 2, width, height, 18);
    choiceBg.strokeRoundedRect(-width / 2, -height / 2, width, height, 18);
  }

  private drawQuestionBackground(
    questionBg: Phaser.GameObjects.Graphics,
    width: number,
    height: number,
    mode: "normal" | "focus" | "correct" | "wrong"
  ) {
    questionBg.clear();
    if (mode === "correct") {
      questionBg.fillStyle(0xdaffba, 1);
      questionBg.lineStyle(2, 0x5fd91d, 1);
    } else if (mode === "wrong") {
      questionBg.fillStyle(0xffd5d5, 1);
      questionBg.lineStyle(2, 0xf26666, 1);
    } else if (mode === "focus") {
      questionBg.fillStyle(0xfff8d7, 0.98);
      questionBg.lineStyle(3, 0xf2c84b, 1);
    } else {
      questionBg.fillStyle(0xffffff, 0.98);
      questionBg.lineStyle(2, 0xdedede, 1);
    }
    questionBg.fillRoundedRect(-width / 2, -height / 2, width, height, 22);
    questionBg.strokeRoundedRect(-width / 2, -height / 2, width, height, 22);
  }

  private refreshQuestionFocusStyles() {
    this.questionUIs.forEach((ui, idx) => {
      if (this.answered.has(idx)) return;
      const mode = this.activeQuestionIndex === idx ? "focus" : "normal";
      this.drawQuestionBackground(ui.questionBg, ui.questionWidth, ui.questionHeight, mode);
    });
  }

  private initSituationEndGameRules(payload: SituationPayload) {
    this.situationManualEndRequired = payload.questions.some(
      (question) => question.choices.filter((choice) => choice.is_correct).length > 1
    );
  }

  private allSituationQuestionsAnswered(): boolean {
    return this.situationQuestionCount > 0 && this.answered.size >= this.situationQuestionCount;
  }

  private createSituationEndGameButton() {
    this.endGameButton?.destroy();
    const { width, height } = this.scale;
    const ui = createHudScaleCtx(width, height, this.mobile);
    const margin = this.mobile ? ui.px(14) : ui.px(20);
    const btnW = this.mobile ? ui.px(132) : ui.px(168);
    const btnH = this.mobile ? ui.px(52) : ui.px(64);
    const x = width - margin - btnW / 2;
    const y = height - margin - btnH / 2;

    const button = this.add
      .image(x, y, SITUATION_END_GAME_KEY)
      .setDisplaySize(btnW, btnH)
      .setScrollFactor(0)
      .setDepth(2800)
      .setVisible(false)
      .setInteractive({ useHandCursor: true });

    button.on("pointerdown", (pointer: Phaser.Input.Pointer, _lx: number, _ly: number, event?: Event) => {
      event?.stopPropagation();
      (pointer.event as Event | undefined)?.stopPropagation?.();
      if (!this.allSituationQuestionsAnswered()) return;
      if (this.situationEndingGame) return;
      this.situationEndingGame = true;
      this.endGame();
    });

    this.endGameButton = button;
    this.updateSituationEndGameButtonVisibility();
  }

  private updateSituationEndGameButtonVisibility() {
    if (!this.endGameButton || !this.situationManualEndRequired) return;
    this.endGameButton.setVisible(this.allSituationQuestionsAnswered());
  }

  private tryFinishSituationWhenAllCorrect() {
    if (this.situationQuestionCount <= 0) return;
    if (!this.allSituationQuestionsAnswered()) return;

    if (this.situationManualEndRequired) {
      this.updateSituationEndGameButtonVisibility();
      return;
    }

    this.time.delayedCall(500, () => {
      this.endGame();
    });
  }

  private collapseChoicesAfterCorrect(questionIndex: number) {
    const ui = this.questionUIs[questionIndex];
    if (!ui) return;
    ui.choiceRows.forEach((row) => {
      row.setVisible(false);
      row.disableInteractive();
    });
    ui.choiceDoms.forEach((dom) => {
      this.setSituationDomVisible(dom, false);
      const node = dom.node as HTMLElement | undefined;
      if (node) {
        node.style.pointerEvents = "none";
      }
    });
    this.setActiveQuestion(null);
    this.collapseQuestionToIconOnly(questionIndex);
    this.applyProximityQuestionTextVisibility();
  }

  private inflateSituationAabb(a: SituationLayoutAabb, pad: number): SituationLayoutAabb {
    return {
      left: a.left - pad,
      right: a.right + pad,
      top: a.top - pad,
      bottom: a.bottom + pad,
    };
  }

  private situationAabbOverlaps(a: SituationLayoutAabb, b: SituationLayoutAabb): boolean {
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  }

  /** กล่องข้อความคำถาม (ไม่รวมตัวเลือก) — ใช้ตรวจว่าข้ออื่นทับพื้นที่ที่เปิดตัวเลือกอยู่หรือไม่ */
  private getSituationQuestionCardAabb(layout: SituationQuestionLayout): SituationLayoutAabb {
    const hw = layout.questionWidth / 2;
    const hh = layout.questionHeight / 2;
    return {
      left: layout.anchorX - hw,
      right: layout.anchorX + hw,
      top: layout.anchorY - hh,
      bottom: layout.anchorY + hh,
    };
  }

  /** พื้นที่จริงเมื่อเปิดตัวเลือก = กล่องคำถาม + แถวตัวเลือกทั้งหมด */
  private getSituationExpandedChoicesAabb(layout: SituationQuestionLayout): SituationLayoutAabb {
    const {
      anchorX,
      anchorY,
      choiceDirection,
      rowStartOffset,
      choiceWidth,
      choiceHeight,
      choiceGap,
      choicesCount,
      questionWidth,
      questionHeight,
    } = layout;
    const imageOuter = layout.questionImageOuterW ?? 0;
    const halfQw = questionWidth / 2;
    const halfQh = questionHeight / 2;
    let minX = anchorX - halfQw;
    let maxX = anchorX + halfQw + imageOuter;
    let minY = anchorY - halfQh;
    let maxY = anchorY + halfQh;
    const halfCw = choiceWidth / 2;
    const halfCh = choiceHeight / 2;
    for (let index = 0; index < choicesCount; index++) {
      const sortedIndex = choiceDirection === -1 ? choicesCount - 1 - index : index;
      const rowY =
        anchorY + choiceDirection * (rowStartOffset + sortedIndex * (choiceHeight + choiceGap));
      minX = Math.min(minX, anchorX - halfCw);
      maxX = Math.max(maxX, anchorX + halfCw);
      minY = Math.min(minY, rowY - halfCh);
      maxY = Math.max(maxY, rowY + halfCh);
    }
    return { left: minX, right: maxX, top: minY, bottom: maxY };
  }

  /**
   * เมื่อมีข้อที่เปิด choice อยู่ — ซ่อนกล่องคำถาม (พื้นหลัง)+ข้อความ และ badge ของข้ออื่นที่ทับพื้นที่คำถาม+ตัวเลือกของข้อนั้น
   */
  private applyProximityQuestionTextVisibility() {
    const OVERLAP_PAD = 14;

    const openIndices: number[] = [];
    this.questionUIs.forEach((ui, idx) => {
      if (ui.choiceRows[0]?.visible) openIndices.push(idx);
    });

    const expandedRegions = openIndices.map((openIdx) =>
      this.inflateSituationAabb(
        this.getSituationExpandedChoicesAabb(this.questionUIs[openIdx].layout),
        OVERLAP_PAD
      )
    );

    this.questionUIs.forEach((ui, j) => {
      const setQuestionChromeVisible = (show: boolean) => {
        ui.questionBg.setVisible(show);
        this.setSituationDomVisible(ui.questionDom, show);
        ui.questionVolumeBtn?.setVisible(show);
        ui.questionImage?.setVisible(show);
        ui.questionMagnifyBtn?.setVisible(show);
        ui.questionImageHitZone?.setVisible(show);
      };

      if (!ui.questionCard.visible) {
        setQuestionChromeVisible(false);
        return;
      }
      if (openIndices.length === 0) {
        setQuestionChromeVisible(true);
        return;
      }
      const questionTextBox = this.getSituationQuestionCardAabb(ui.layout);
      let hideForOverlap = false;
      for (let k = 0; k < openIndices.length; k++) {
        const openIdx = openIndices[k];
        if (openIdx === j) continue;
        if (this.situationAabbOverlaps(questionTextBox, expandedRegions[k])) {
          hideForOverlap = true;
          break;
        }
      }
      setQuestionChromeVisible(!hideForOverlap);
    });
  }

  /** ปิด choice ของทุกข้อยกเว้นข้อที่กำลังกด — ใช้ได้ทั้ง desktop / mobile */
  private collapseOtherQuestionChoices(keepIndex: number) {
    this.questionUIs.forEach((ui, idx) => {
      if (idx === keepIndex) return;
      ui.choiceRows.forEach((row) => row.setVisible(false));
      ui.choiceDoms.forEach((dom) => this.setSituationDomVisible(dom, false));
    });
  }

  private showBalloonHint(questionIndex: number) {
    if (this.balloonTargetQuestionIndex === questionIndex && this.balloonHints.length > 0) {
      return;
    }
    this.hideBalloonHint();
    this.balloonTargetQuestionIndex = questionIndex;

    const { width, height } = this.scale;
    const option = {
      cost: 2,
      x: Phaser.Math.Between(Math.floor(width * 0.3), Math.floor(width * 0.7)),
      y: Phaser.Math.Between(Math.floor(height * 0.34), Math.floor(height * 0.46)),
    };
    const balloonDom = this.createBalloonOption(option.cost, option.x, option.y);
    this.balloonHints.push(balloonDom);

    const fromLeft = Phaser.Math.Between(0, 1) === 0;
    const startX = fromLeft ? -120 : width + 120;
    const startY = Phaser.Math.Between(Math.floor(height * 0.24), Math.floor(height * 0.46));
    balloonDom.setPosition(startX, startY);

    this.time.delayedCall(0, () => {
      if (!balloonDom.active) return;
      this.balloonTweens.push(
        this.tweens.add({
          targets: balloonDom,
          x: option.x,
          y: option.y + Phaser.Math.Between(-8, 8),
          duration: Phaser.Math.Between(1900, 2800),
          ease: "Sine.easeInOut",
        })
      );
    });

    this.time.delayedCall(Phaser.Math.Between(1800, 2600), () => {
      this.startBalloonWander(balloonDom);
    });
  }

  private startBalloonWander(balloonDom: Phaser.GameObjects.DOMElement) {
    if (!balloonDom.active) return;
    const { width, height } = this.scale;
    const nextX = Phaser.Math.Between(Math.floor(width * 0.12), Math.floor(width * 0.88));
    const nextY = Phaser.Math.Between(Math.floor(height * 0.28), Math.floor(height * 0.5));
    const duration = Phaser.Math.Between(2600, 4200);
    const driftTween = this.tweens.add({
      targets: balloonDom,
      x: nextX,
      y: nextY,
      angle: Phaser.Math.Between(-6, 6),
      duration,
      ease: "Sine.easeInOut",
      onComplete: () => {
        this.startBalloonWander(balloonDom);
      },
    });
    this.balloonTweens.push(driftTween);
  }

  private createBalloonOption(coinCost: number, x: number, y: number): Phaser.GameObjects.DOMElement {
    const targetWidth = this.mobile ? 126 : 164;
    const targetHeight = this.mobile ? 168 : 220;
    const coinSize = this.mobile ? 20 : 24;
    const labelTopFont = this.mobile ? 20 : 24;
    const labelBottomFont = this.mobile ? 20 : 24;
    const root = document.createElement("div");
    root.style.width = `${targetWidth}px`;
    root.style.height = `${targetHeight}px`;
    root.style.position = "relative";
    root.style.display = "flex";
    root.style.flexDirection = "column";
    root.style.alignItems = "center";
    root.style.justifyContent = "center";
    root.style.backgroundImage = "url('assets/situation/balloon.png')";
    root.style.backgroundSize = "contain";
    root.style.backgroundPosition = "center";
    root.style.backgroundRepeat = "no-repeat";
    root.style.pointerEvents = "auto";
    root.style.cursor = "pointer";
    root.style.zIndex = "9999";
    root.style.userSelect = "none";

    const topRow = document.createElement("div");
    topRow.style.display = "flex";
    topRow.style.alignItems = "center";
    topRow.style.justifyContent = "center";
    topRow.style.gap = this.mobile ? "4px" : "6px";
    topRow.style.marginTop = this.mobile ? "35px" : "35px";

    const topLabel = document.createElement("span");
    topLabel.textContent = `ใช้ ${coinCost}`;
    topLabel.style.fontFamily = '"Noto Sans Thai", sans-serif';
    topLabel.style.fontWeight = "700";
    topLabel.style.fontSize = `${labelTopFont}px`;
    topLabel.style.color = "#ffffff";
    topLabel.style.lineHeight = "1";
    topLabel.style.textShadow = "0 0 0 #0560a7, 2px 0 #0560a7, -2px 0 #0560a7, 0 2px #0560a7, 0 -2px #0560a7";

    const coin = document.createElement("img");
    coin.src = "assets/common/coin_icon.png";
    coin.alt = "coin";
    coin.style.width = `${coinSize}px`;
    coin.style.height = `${coinSize}px`;
    coin.style.display = "block";

    const bottomLabel = document.createElement("div");
    bottomLabel.textContent = "ตัดตัวเลือก";
    bottomLabel.style.marginTop = this.mobile ? "14px" : "18px";
    bottomLabel.style.fontFamily = '"Noto Sans Thai", sans-serif';
    bottomLabel.style.fontWeight = "700";
    bottomLabel.style.fontSize = `${labelBottomFont}px`;
    bottomLabel.style.color = "#ffffff";
    bottomLabel.style.lineHeight = "1";
    bottomLabel.style.textAlign = "center";
    bottomLabel.style.textShadow = "0 0 0 #0560a7, 2px 0 #0560a7, -2px 0 #0560a7, 0 2px #0560a7, 0 -2px #0560a7";

    topRow.append(topLabel, coin);
    root.append(topRow, bottomLabel);

    const balloonDom = this.add.dom(x, y, root).setOrigin(0.5).setScrollFactor(0).setDepth(10000);
    balloonDom.addListener("click");
    balloonDom.on("click", () => {
      if (!this.useBalloonEliminateChoice(coinCost)) return;
      this.consumeBalloonOption(balloonDom);
    });
    return balloonDom;
  }

  private consumeBalloonOption(balloonDom: Phaser.GameObjects.DOMElement) {
    this.playSfx("sfx_pop");
    this.tweens.killTweensOf(balloonDom);
    const idx = this.balloonHints.indexOf(balloonDom);
    if (idx >= 0) {
      this.balloonHints.splice(idx, 1);
    }
    const node = balloonDom.node as HTMLElement | null;
    if (node) {
      node.style.pointerEvents = "none";
    }
    const popRing = this.add
      .circle(balloonDom.x, balloonDom.y, this.mobile ? 24 : 30, 0xffffff, 0.35)
      .setScrollFactor(0)
      .setDepth(10010);
    this.tweens.add({
      targets: popRing,
      scale: this.mobile ? 2 : 2.4,
      alpha: 0,
      duration: 260,
      ease: "Cubic.easeOut",
      onComplete: () => popRing.destroy(),
    });
    this.tweens.add({
      targets: balloonDom,
      scaleX: 1.14,
      scaleY: 1.14,
      alpha: 0,
      duration: 230,
      ease: "Back.easeIn",
      onComplete: () => {
        balloonDom.destroy();
        if (this.balloonHints.length === 0) {
          this.balloonTargetQuestionIndex = null;
        }
      },
    });
  }

  private releaseBalloonHintsOnCorrect() {
    if (this.balloonHints.length === 0) {
      this.balloonTargetQuestionIndex = null;
      return;
    }
    const activeHints = [...this.balloonHints];
    this.balloonHints = [];
    this.balloonTweens.forEach((tween) => tween.stop());
    this.balloonTweens = [];
    activeHints.forEach((hint, index) => {
      const node = hint.node as HTMLElement | null;
      if (node) {
        node.style.pointerEvents = "none";
      }
      this.tweens.add({
        targets: hint,
        y: hint.y - (this.mobile ? 170 : 220),
        x: hint.x + Phaser.Math.Between(-22, 22),
        alpha: 0,
        duration: 780 + index * 140,
        ease: "Cubic.easeIn",
        onComplete: () => hint.destroy(),
      });
    });
    this.balloonTargetQuestionIndex = null;
  }

  private hideBalloonHint() {
    this.balloonTweens.forEach((tween) => tween.stop());
    this.balloonTweens = [];
    this.balloonHints.forEach((hint) => hint.destroy());
    this.balloonHints = [];
    this.balloonTargetQuestionIndex = null;
  }

  private startNotAnsweredTimer() {
    this.stopNotAnsweredTimer();
    this.notAnsweredTimerEvent = this.time.addEvent({
      delay: 1000,
      loop: true,
      callback: () => this.tickNotAnsweredPrompt(),
    });
  }

  private stopNotAnsweredTimer() {
    this.notAnsweredTimerEvent?.destroy();
    this.notAnsweredTimerEvent = undefined;
  }

  private setActiveQuestion(questionIndex: number | null) {
    if (this.activeQuestionIndex === questionIndex) return;
    this.flushActiveQuestionStayDuration();
    this.activeQuestionIndex = questionIndex;
    this.activeQuestionEnterMs = Date.now();
  }

  private flushActiveQuestionStayDuration() {
    if (this.activeQuestionIndex === null) return;
    const elapsedMs = Math.max(0, Date.now() - this.activeQuestionEnterMs);
    const prev = this.questionStayDurationMs.get(this.activeQuestionIndex) ?? 0;
    this.questionStayDurationMs.set(this.activeQuestionIndex, prev + elapsedMs);
    this.activeQuestionEnterMs = Date.now();
  }

  private tickNotAnsweredPrompt() {
    const questionIndex = this.activeQuestionIndex;
    if (questionIndex === null) return;
    if (this.answered.has(questionIndex)) return;

    const accumulatedMs = this.questionStayDurationMs.get(questionIndex) ?? 0;
    const activeMs = Math.max(0, Date.now() - this.activeQuestionEnterMs);
    const totalMs = accumulatedMs + activeMs;
    const totalSteps = Math.floor(totalMs / 10000);
    const shownSteps = this.notAnsweredShownSteps.get(questionIndex) ?? 0;

    if (totalSteps <= shownSteps) return;
    this.notAnsweredShownSteps.set(questionIndex, totalSteps);
    this.showRandomMessage(this.messagePools.notAnswered, 2200, "point");
  }

  private useBalloonEliminateChoice(coinCost: number): boolean {
    if (this.balloonTargetQuestionIndex === null) return false;
    if (this.answered.has(this.balloonTargetQuestionIndex)) return false;
    if (this.score < coinCost) {
      this.showMessage("เหรียญไม่พอใช้บอลลูนช่วย", 1600, "point");
      return false;
    }
    const candidates: ChoiceRowUI[] = [];
    const targetUI = this.questionUIs[this.balloonTargetQuestionIndex];
    targetUI?.choiceRowsMeta.forEach((meta) => {
      if (meta.isCorrect) return;
      if (meta.isEliminated) return;
      candidates.push(meta);
    });
    if (candidates.length === 0) return false;
    const eliminateCount = Math.min(coinCost, candidates.length);
    const pickedRows = Phaser.Utils.Array.Shuffle([...candidates]).slice(0, eliminateCount);
    pickedRows.forEach((picked) => {
      picked.isEliminated = true;
      picked.row.disableInteractive();
      this.disableSituationSpeaker(picked.volumeBtn);
      this.drawChoiceBackground(picked.bg, picked.width, picked.height, "disabled");
      const domNode = picked.dom.node as HTMLElement | null;
      if (domNode) {
        domNode.style.opacity = "0.55";
        domNode.style.filter = "grayscale(0.9)";
        domNode.style.pointerEvents = "none";
      }
      picked.choiceImage?.setAlpha(0.55);
      picked.choiceMagnifyBtn?.setAlpha(0.55);
    });
    this.score -= coinCost;
    this.updateHudScore(-coinCost);
    this.wrongAttemptsByQuestion.set(this.balloonTargetQuestionIndex, 0);
    this.showMessage(`บอลลูนช่วยตัดตัวเลือกผิด ${eliminateCount} ข้อแล้ว`, 1800, "point");
    return true;
  }

  private showMessage(text: string, durationMs = 2000, teacherStateWhileVisible?: "point" | "clap") {
    const clean = (text ?? "").trim();
    if (!clean || !this.teacherHintUI) return;

    this.lastMessageShownMs = Date.now();
    this.teacherHintUI.present({
      text: clean,
      durationMs,
      teacherState: teacherStateWhileVisible,
      resetHintBeforeShow: true,
    });
  }

  private playSfx(key: string, volume = 1) {
    guardedScenePlay(this, key, volume);
  }

  protected onGameAudioSettingsChanged(): void {
    if (this.bgmGameSound?.isPlaying || this.bgmHomeSound?.isPlaying) {
      const onGame = Boolean(this.bgmGameSound?.isPlaying);
      this.stopAndDestroySound(this.bgmHomeSound);
      this.bgmHomeSound = undefined;
      this.stopAndDestroySound(this.bgmGameSound);
      this.bgmGameSound = undefined;
      this.setBgmState(onGame ? "game" : "home");
    }
  }

  private setBgmState(next: "home" | "game") {
    if (next === "home") {
      this.stopAndDestroySound(this.bgmGameSound);
      this.bgmGameSound = undefined;
      if (!canPlayGameAudio("background")) return;
      if (!this.bgmHomeSound && this.cache.audio.exists("bgm_home_music")) {
        this.bgmHomeSound = this.sound.add("bgm_home_music", { loop: true, volume: GAME_BGM_VOLUME });
        this.bgmHomeSound.play();
      }
      return;
    }

    this.stopAndDestroySound(this.bgmHomeSound);
    this.bgmHomeSound = undefined;
    if (!canPlayGameAudio("background")) return;
    if (!this.bgmGameSound && this.cache.audio.exists("bgm_game_music")) {
      this.bgmGameSound = this.sound.add("bgm_game_music", { loop: true, volume: GAME_BGM_VOLUME });
      this.bgmGameSound.play();
    }
  }

  private stopAndDestroySound(sound?: Phaser.Sound.BaseSound) {
    if (!sound) return;
    if (sound.isPlaying) sound.stop();
    sound.destroy();
  }

  private stopAllAudio() {
    this.stopAndDestroySound(this.bgmHomeSound);
    this.bgmHomeSound = undefined;
    this.stopAndDestroySound(this.bgmGameSound);
    this.bgmGameSound = undefined;
  }

  private hideMessage() {
    this.teacherHintUI?.hide();
  }

  private async ensureHudFontReady(): Promise<void> {
    await ensureNotoSansThaiLoopedReady();
  }

  protected override getResultCorrectCount(): number {
    return this.answered.size;
  }

  private async fetchSituationData(): Promise<SituationPayload> {
    if (this.injectedPayload) {
      return this.injectedPayload as unknown as SituationPayload;
    }
    throw new Error("Missing injected payload for scene: situation");
  }

  private async initSituationRunstate(gameUuid?: string) {
    if (!gameUuid) {
      console.warn("[situation][agent-state] missing game uuid");
      return;
    }

    try {
      const scope = `runstate-${gameUuid}`;
    
      this.runstateScope = scope;
      const agent = await this.getAgentStateApi();
      if (!agent) {
        console.warn("[situation][agent-state] unavailable");
        return;
      }
      const runstate = (await agent.state(scope)) as SituationRunstate;
      if (!runstate.correctAnswers) runstate.correctAnswers = [];

      runstate.gameKey = this.scene.key;
      runstate.gameUuid = gameUuid;
      runstate.startedAt = new Date(this.startTime).toISOString();
      runstate.startedAtMs = this.startTime;
      runstate.correctAnswers = [];
      runstate.reference = {
        ...(runstate.reference ?? {}),
        dashboard: "https://thaipilacreate.eef.or.th/live-monitor",
      };

      this.runstate = runstate;
      console.log("[situation][agent-state] initialized", {
        scope,
        startedAt: runstate.startedAt,
        gameUuid,
      });
    } catch (error) {
      console.warn("[situation][agent-state] init failed", error);
    }
  }

  private async getAgentStateApi(): Promise<AgentModule["default"] | null> {
    if (shouldSkipKnowLearningAgentsFromUrl()) {
      return null;
    }
    if (!this.enableAgentState) {
      return null;
    }
    if (!this.agentStateLoader) {
      this.agentStateLoader = import("@knowlearning/agents")
        .then((module) => module.default)
        .catch((error) => {
          console.warn("[situation][agent-state] import failed", error);
          return null;
        });
    }
    return this.agentStateLoader;
  }

  private async trackCorrectAnswer(questionIndex: number, question: SituationQuestion) {
    try {
      const runstate = this.runstate;
      if (!runstate || !this.runstateScope) return;

      if (!runstate.correctAnswers) runstate.correctAnswers = [];
      const now = Date.now();
      runstate.correctAnswers.push({
        questionIndex,
        questionId: question.id,
        questionNo: question.no,
        answeredAt: new Date(now).toISOString(),
        elapsedMs: Math.max(0, now - this.startTime),
      });

      const latest = runstate.correctAnswers[runstate.correctAnswers.length - 1];
      console.log("[situation][agent-state] tracked-correct", {
        scope: this.runstateScope,
        totalCorrect: runstate.correctAnswers.length,
        latest,
      });
    } catch (error) {
      console.warn("[situation][agent-state] track correct failed", error);
    }
  }

  private async loadBackgroundTexture(imageUrl: string): Promise<void> {
    this.load.setCORS("anonymous");

    if (this.textures.exists(BG_TEXTURE_KEY)) {
      this.textures.remove(BG_TEXTURE_KEY);
    }

    await new Promise<void>((resolve, reject) => {
      this.load.image(BG_TEXTURE_KEY, imageUrl);
      this.load.once(Phaser.Loader.Events.COMPLETE, () => resolve());
      this.load.once(Phaser.Loader.Events.FILE_LOAD_ERROR, () => reject(new Error(`Image load failed: ${imageUrl}`)));
      this.load.start();
    });
  }
}
