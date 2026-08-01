import Phaser from "phaser";
import { API_BASE_URL } from "../../core/api";
import { BaseGameScene } from "../../core/scenes/BaseGameScene";
import type { HomeActionPayload } from "../../core/scenes/HomeScene";
import { TeacherState } from "../../core/teacher/TeacherAssistant";
import { TeacherHintUI } from "../../core/teacher/TeacherHintUI";
import {
  canPlayGameAudio,
  GAME_BGM_VOLUME,
  guardedScenePlay,
  guardedScenePlayQuestion,
  guardedScenePlayQuestionThen,
  guardedScenePlayVoice,
} from "../../core/audio/sceneAudio";
import { createHudScaleCtx } from "../../utils/desktopUiScale";
import { isMobileLayout } from "../../utils/device";
import {
  getMobileCompactUiScale,
  mobileCompactPx,
} from "../../utils/mobileLayout";
import { createThaiTextElement, createThaiTextSpan } from "../../utils/thaiText";
import {
  createDomProgressHudPill,
  getDomTimeHudPillValueColor,
  getQuestionProgressLabel,
  layoutGameHudStatsDomRow,
  setDomLabelValueHudPillValue,
  setDomProgressHudPillLabel,
  setDomTimeHudPillValue,
  tweenHudContainerDropIn,
  type DomHudPill,
} from "../../core/hud/questionProgressHud";
import {
  BG_HUD_TEXTURE_KEY,
  getGameHudPillSlots,
  getGameHudRowMetrics,
  getHudStatFontSize,
  hasHudCenterLabel,
  getHudSuggestionLabel,
  getHudCenterTextMaxFontPx,
  HUD_VOLUME_TEXTURE_KEY,
  preloadHudAssets,
} from "../../core/hud/gameHudLayout";
import {
  computeQuestionMediaLayout,
  drawQuestionMediaFrameBox,
  getQuestionMediaCenterYBelowAnchor,
  getQuestionMediaFrameHalfH,
  getQuestionMediaFrameTargetW,
} from "../../utils/questionHudMedia";

type AnagramQuestion = {
  id: number;
  id_game_info: number;
  no: number;
  word: string;
  swap_word: string[];
  hint: string;
  sound_word: string;
  image_word: string;
  sound_hint: string;
  image_hint: string;
  sound_swap_word: string;
  image_swap_word: string;
};

type AnagramPayload = {
  game_info: {
    id: number;
    uuid: string;
    exercise_name: string;
    description?: string;
    subject: string;
    question_type: string;
    game_type: string;
    thumbnail: string;
    question_category_id: number;
    other_image: string;
    suggestion: string;
  };
  questions: AnagramQuestion[];
}

type QuestionGameState = {
  word: string;
  swap_word: string[];
  length: number;
  numberOfCorrectWords: number;
  hadWrong: boolean;
}

type AnagramTokenView = {
  value: string;
  container: Phaser.GameObjects.Container;
  bg: Phaser.GameObjects.Image;
  border: Phaser.GameObjects.Graphics;
  label: Phaser.GameObjects.Text;
  homeX: number;
  homeY: number;
  dragOffsetX: number;
  dragOffsetY: number;
  locked: boolean;
};

type AnagramSlotView = {
  expected: string;
  container: Phaser.GameObjects.Container;
  dropZone: Phaser.GameObjects.Zone;
  box: Phaser.GameObjects.Graphics;
  occupiedBy?: AnagramTokenView;
};

export default class AnagramGameScene extends BaseGameScene {
  private lockInput = false;
  private startRequested = false;
  private assetsReady = false;
  private gameStarted = false;
  private pendingPayload?: AnagramPayload;
  private frozenHudElapsedSec: number | null = null;
  private endCutsceneHappyMonkey?: Phaser.GameObjects.Image;
  private endCutsceneRunning = false;
  private showScore = 0;
  private hudElapsedAccumSec = 0;

  private getAnagramSafeArea(): Phaser.Geom.Rectangle {
    return this.getSafeAreaRect(this.mobile ? 9 / 16 : 16 / 9);
  }

  private hudTimerEvent?: Phaser.Time.TimerEvent;
  private hudStartMs = 0;
  private hudStarted = false;
  private titleUI?: {
    container: Phaser.GameObjects.Container;
    box: Phaser.GameObjects.Graphics;
    dom: Phaser.GameObjects.DOMElement;
    title: string;
  };
  private timeUI?: {
    container: Phaser.GameObjects.Container;
    bg: Phaser.GameObjects.Image;
    dom: Phaser.GameObjects.DOMElement;
    inner: HTMLElement;
  };
  private scoreUI?: {
    container: Phaser.GameObjects.Container;
    bg: Phaser.GameObjects.Image;
    dom: Phaser.GameObjects.DOMElement;
    inner: HTMLElement;
  };
  private questionProgressUI?: DomHudPill;
  private teacherHintUI?: TeacherHintUI;
  private rawQuestions: AnagramQuestion[] = [];
  private anagramAudioByUrl = new Map<string, string>();
  private anagramTexByUrl = new Map<string, string>();
  private wordPromptUI?: {
    container: Phaser.GameObjects.Container;
    imageBorder?: Phaser.GameObjects.Graphics;
    image?: Phaser.GameObjects.Image;
    speakerBtn?: Phaser.GameObjects.Image;
  };
  /** พื้นที่ใต้ HUD ที่กินโดยรูป/กรอบคำถาม (px) */
  private wordPromptReservePx = 0;
  private lastMessageShownMs = 0;
  private lastScoreChangeMs = 0;
  private idleNoScoreMessageShown = false;
  private readonly messageMilestonesSec = [15, 30, 45, 60, 90];
  private milestoneShown = new Set<number>();
  private readonly messageCatalog: Record<string, { text: string; voice?: string }> = {
    intro_a: { text: "เรียงตัวอักษรให้เป็นคำที่ถูกต้องนะ!" },
    intro_b: { text: "ลองสลับดูสิ คำตอบอยู่ไม่ไกลแล้ว!" },
    intro_c: { text: "ดูตัวอักษรดี ๆ แล้วเรียงให้ถูกน้า" },
    intro_d: { text: "มาช่วยกันเรียงคำกันเลย!" },
  
    idle_a: { text: "ลองหยิบตัวอักษรสักตัวมาวางดูไหม" },
    idle_b: { text: "เริ่มจากตัวที่คุ้นที่สุดก่อนก็ได้" },
    idle_c: { text: "ลองสลับตำแหน่งดูนะ!" },
  
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
  
    correct_all_a: { text: "เก่งมาก ผ่านแล้ว!" },
    correct_all_b: { text: "สุดยอด ไปคำต่อไปกัน!" },
    correct_all_c: { text: "เรียงคำเก่งมากเลย!" },
    correct_all_d: { text: "พร้อมลุยข้อต่อไปไหม?" },

    correct_a: { text: "มาถูกทางแล้ว!" },
    correct_b: { text: "ใช่เลย!" },
    correct_c: { text: "เก่งมาก!" },
    correct_d: { text: "เป๊ะ!" },
  
    wrong_a: { text: "ไม่เป็นไร ลองใหม่อีกครั้งนะ" },
    wrong_b: { text: "เกือบถูกแล้วเชียว สู้ ๆ" },
    wrong_c: { text: "หายใจเข้าลึก ๆ ลองใหม่ ๆ" },

    done_a: { text: "สุดยอด คุณผ่านบททดสอบทั้งหมดแล้ว!" },
    done_b: { text: "เกมจบแล้ว คุณทำได้ยอดเยี่ยมมาก!" },
    done_c: { text: "เก่งมากที่สุด พิชิตครบทุกด่านแล้ว!" },
  };
  
  private readonly messagePools = {
    intro: ["intro_a", "intro_b", "intro_c", "intro_d"],
    idle: ["idle_a", "idle_b", "idle_c"],
    time: {
      15: ["time_15_a", "time_15_b", "time_15_c"],
      30: ["time_30_a", "time_30_b"],
      45: ["time_45_a", "time_45_b"],
      60: ["time_60_a", "time_60_b", "time_60_c"],
      90: ["time_90_a"],
    } as Record<number, string[]>,
    correctAll: ["correct_all_a", "correct_all_b", "correct_all_c", "correct_all_d"],
    correct: ["correct_a", "correct_b", "correct_c", "correct_d"],
    wrong: ["wrong_a", "wrong_b", "wrong_c"],
    done: ["done_a", "done_b", "done_c"],
  };
  private timeFlashEvent?: Phaser.Time.TimerEvent;
  private timeFlashSeq = 0;
  private timeBoxColor = 0xffffff;
  private timeRedLoopActive = false;
  private timeTextBaseColor = "#0092D7";
  private scoreTextBaseColor = "#0092D7";
  private scoreFlashSeq = 0;
  private hudTimeFontSize: string | null = null;
  private bgmState: "start" | "game" | "result" | null = null;
  private tickingState: "normal" | "danger" | null = null;
  private bgmStartSound?: Phaser.Sound.BaseSound;
  private bgmGameSound?: Phaser.Sound.BaseSound;
  private bgmResultSound?: Phaser.Sound.BaseSound;
  private tickingNormalSound?: Phaser.Sound.BaseSound;
  private tickingDangerSound?: Phaser.Sound.BaseSound;
  private tickingEvent?: Phaser.Time.TimerEvent;
  private tickingSoundKey: string | null = null;
  private introDecor?: {
    title: Phaser.GameObjects.Image;
    monkey: Phaser.GameObjects.Image;
    banana: Phaser.GameObjects.Image;
    bgBanana: Phaser.GameObjects.Image;
  };
  private tutorialPopup?: {
    title: Phaser.GameObjects.Image;
    howtoplay: Phaser.GameObjects.Image;
    startButton: Phaser.GameObjects.Image;
    restoreInputEnabled: boolean;
    restoreLockInput: boolean;
  };

  private numberOfQuestions = 0;
  private currentQuestionIndex = 0;
  private correctWords = 0;
  private questions: QuestionGameState[] = [];
  private playArea?: {
    container: Phaser.GameObjects.Container;
    topBox: Phaser.GameObjects.Graphics;
    bottomBox: Phaser.GameObjects.Graphics;
    bottomTitle: Phaser.GameObjects.Image;
  };
  private topSlots: AnagramSlotView[] = [];
  private tokens: AnagramTokenView[] = [];
  private hoveringSlotIndex: number | null = null;
  private bridgeUI?: Phaser.GameObjects.Image;

  private mobile = false;

  constructor() {
    super("anagram");
  }

  preload() {
    this.load.image("bg_anagram_mobile", "assets/anagram/bg_anagram_mobile.png");
    this.load.image("bg_anagram", "assets/anagram/bg_anagram.png");
    this.load.image("banana", "assets/anagram/banana.png");
    this.load.image("bg_banana", "assets/anagram/bg_banana.png");
    if (!this.textures.exists("star")) {
      this.load.image("star", "assets/flip-cards/star.png");
    }
    this.load.image("anagram_btn_start", "assets/anagram/btn_start.png");
    this.load.image("anagram_howtoplay", "assets/anagram/howtoplay_anagram.png");
    this.load.image("anagram_icon_howtoplay", "assets/anagram/icon_howtoplay_anagram.png");
    this.load.image("anagram_main_icon", "assets/anagram/main_icon_anagram.png");
    this.load.image("monkey_idle", "assets/anagram/monkey_idle.png");
    this.load.image("monkey_happy", "assets/anagram/monkey_happy.png");
    this.load.image("bg_swap_word", "assets/anagram/bg_swap_word.png");
    this.load.image("title_swap_word", "assets/anagram/title_swap_word.png");
    this.load.image("bridge", "assets/anagram/bridge.png");

    this.load.audio("bgm_game_scene", "assets/sound/whack-a-mole/bgm_game_scene_whack_a_mole.mp3");
    this.load.audio("bgm_result", "assets/sound/whack-a-mole/bgm_result_whack_a_mole.mp3");
    this.load.audio("bgm_start", "assets/sound/whack-a-mole/bgm_start_whack_a_mole.mp3");
    this.load.audio("bgm_clock_ticking_normal", "assets/sound/flip-cards/bgm_clock_ticking_normal_flip_cards.mp3");
    this.load.audio("bgm_clock_ticking_danger", "assets/sound/flip-cards/bgm_clock_ticking_danger_flip_cards.mp3");
    this.load.audio("sfx_alert_danger", "assets/sound/sfx_alert_danger_flip_cards.mp3");
    this.load.audio("sfx_alert_warning", "assets/sound/sfx_alert_warning_flip_cards.mp3");
    this.load.audio("sfx_all_correct", "assets/sound/sfx_correct_flip_cards.mp3");
    this.load.audio("sfx_correct", "assets/sound/sfx_correct_anagram.mp3");
    this.load.audio("sfx_incorrect", "assets/sound/sfx_incorrect_flip_cards.mp3");
    this.load.audio("sfx_notification_message", "assets/sound/sfx_notification_message_flip_cards.mp3");
    this.load.audio("sfx_level_up", "assets/sound/sfx_level_complete.mp3");
    this.load.audio("sfx_click", "assets/sound/sfx_pop.mp3");
    TeacherHintUI.preload(this);
    preloadHudAssets(this);
  }

  async create() {
    super.create();
    this.mobile = isMobileLayout();
    this.scene.launch("HomeScene", {
      gameKey: this.scene.key,
      ui: {
        startButtonPath: "assets/anagram/btn_start.png",
        howToButtonPath: "assets/anagram/btn_howto.png",
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
    this.bridgeUI?.destroy();
    this.bridgeUI = undefined;
    this.endCutsceneHappyMonkey?.destroy();
    this.endCutsceneHappyMonkey = undefined;
    this.endCutsceneRunning = false;
    this.frozenHudElapsedSec = null;
    this.hudElapsedAccumSec = 0;
    this.hudTimerEvent?.destroy();
    this.hudTimerEvent = undefined;
    this.hudStarted = false;
    this.hudStartMs = 0;
    this.titleUI?.container.destroy(true);
    this.titleUI = undefined;
    if (this.timeUI) this.tweens.killTweensOf(this.timeUI.dom);
    this.timeUI?.container.destroy(true);
    this.timeUI = undefined;
    if (this.scoreUI) this.tweens.killTweensOf(this.scoreUI.dom);
    this.scoreUI?.container.destroy(true);
    this.scoreUI = undefined;
    if (this.questionProgressUI) this.tweens.killTweensOf(this.questionProgressUI.dom);
    this.questionProgressUI?.container.destroy(true);
    this.questionProgressUI = undefined;
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

    this.numberOfQuestions = 0;
    this.currentQuestionIndex = 0;
    this.correctWords = 0;
    this.questions = [];
    this.showScore = 0;

    const { width, height } = this.scale;

    const worldWidth = width;
    const worldHeight = height;

    this.cameras.main.setBounds(0, 0, worldWidth, worldHeight);
    this.cameras.main.setScroll(0, 0);
    this.cameras.main.setBackgroundColor("#000000");

    const background = this.add.image(0, 0, this.mobile ? "bg_anagram_mobile" : "bg_anagram").setOrigin(0, 0).setDepth(0);
    background.setDisplaySize(worldWidth, worldHeight);

    this.destroyIntroDecor();
    this.createIntroDecor(worldWidth, worldHeight);

    const onResize = (gameSize: Phaser.Structs.Size) => {
      const w = gameSize.width;
      const h = gameSize.height;
      this.cameras.main.setBounds(0, 0, w, h);
      background.setDisplaySize(w, h);
      this.layoutIntroDecor(w, h);
      this.layoutTitle();
      this.layoutTime();
      this.layoutScore();
      const raw = this.rawQuestions[this.currentQuestionIndex];
      if (raw) this.layoutWordPrompt(raw);
      this.layoutAnagramBoard();
    };
    this.scale.on(Phaser.Scale.Events.RESIZE, onResize);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, onResize);
      this.stopAllAudio();
    });

    this.scene.get("HomeScene").events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (this.introDecor) this.introDecor.title.setVisible(false);
      if (!this.teacherHintUI) {
        this.teacherHintUI = new TeacherHintUI(this, {
          mobile: this.mobile,
          depth: 1,
          messageDepth: 1500,
          onNotificationSfx: () => this.playSfx("sfx_notification_message", 1),
        });
        this.teacherHintUI.create();
      } else {
        this.teacherHintUI.assistant.setCompact(true, 600);
      }
      this.startRequested = true;
      this.setBgmState("game");
      this.tryStartGame();
    });

    try {
      const payload = await this.fetchAnagramData();
      this.pendingPayload = payload;
      this.assetsReady = true;
      this.tryStartGame();
    } catch (error) {
      console.error("Failed to load anagram data:", error);
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

  private async fetchAnagramData(): Promise<AnagramPayload> {
    let rawPayload;

    if (this.injectedPayload) {
      rawPayload = this.injectedPayload;
    } else {
      throw new Error("Missing injected payload for scene: anagram");
    }

    const transformedQuestions = rawPayload.questions.map((q) => ({
      ...q,
      swap_word: typeof q.swap_word === 'string' ? JSON.parse(q.swap_word) : q.swap_word,
    }));

    return {
      ...rawPayload,
      questions: transformedQuestions,
    } as AnagramPayload;
  }

  protected override getResultCorrectCount(): number {
    return Math.max(0, this.currentQuestionIndex + 1);
  }

  protected override endGame() {
    // คงพฤติกรรมเวลาเดิม: ถ้าฟรีซเวลา HUD แล้ว ให้ Result ใช้เวลานั้น
    if (this.frozenHudElapsedSec != null) {
      this.startTime = Date.now() - this.frozenHudElapsedSec * 1000;
    }
    super.endGame();
  }

  protected override onBeforeEndGame() {
    this.setBgmState("result");
    this.input.enabled = false;
    this.lockInput = true;
    this.hudTimerEvent?.destroy();
    this.hudTimerEvent = undefined;
    this.titleUI?.container.destroy(true);
    this.titleUI = undefined;
    if (this.timeUI) this.tweens.killTweensOf(this.timeUI.dom);
    this.timeUI?.container.destroy(true);
    this.timeUI = undefined;
    if (this.scoreUI) this.tweens.killTweensOf(this.scoreUI.dom);
    this.scoreUI?.container.destroy(true);
    this.scoreUI = undefined;
    if (this.questionProgressUI) this.tweens.killTweensOf(this.questionProgressUI.dom);
    this.questionProgressUI?.container.destroy(true);
    this.questionProgressUI = undefined;
    this.teacherHintUI?.destroy();
    this.teacherHintUI = undefined;
    this.rawQuestions = [];
    this.anagramAudioByUrl.clear();
    this.anagramTexByUrl.clear();
    this.timeFlashEvent?.destroy();
    this.timeFlashEvent = undefined;
    this.timeBoxColor = 0xffffff;
    this.timeRedLoopActive = false;
    this.timeFlashSeq = 0;
    this.destroyAnagramBoard();
  }

  private tryStartGame() {
    if (this.gameStarted) return;
    if (!this.startRequested) return;
    if (!this.assetsReady) return;
    if (!this.pendingPayload) return;

    this.gameStarted = true;
    const gameInfo = this.pendingPayload.game_info;
    const titleText = getHudSuggestionLabel(gameInfo.suggestion);
    if (hasHudCenterLabel(titleText)) {
      this.createTitleContainer(titleText);
    }
    this.createTimeContainer();
    this.createScoreContainer();
    this.createQuestionProgressContainer();
    this.hudStarted = false;
    this.hudStartMs = 0;
    this.hudElapsedAccumSec = 0;
    this.correctWords = 0;
    this.score = 0;
    this.showScore = 0;
    this.ensureHudTimer();
    this.updateHud();
    this.lockInput = true;
    this.input.enabled = false;

    this.totalQuestions = this.countAnagramQuestions(this.pendingPayload);
    this.reportRunstateStart();
    this.playStartCutscene(this.pendingPayload);
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

  protected onGameAudioSettingsChanged(): void {
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

  private stopTicking() {
    this.tickingState = null;
    this.stopTickingAudio();
  }

  private stopTickingAudio() {
    this.tickingSoundKey = null;
    this.tickingEvent?.destroy();
    this.tickingEvent = undefined;
    this.stopAndDestroySound(this.tickingNormalSound);
    this.tickingNormalSound = undefined;
    this.stopAndDestroySound(this.tickingDangerSound);
    this.tickingDangerSound = undefined;
  }

  private stopAndDestroySound(sound?: Phaser.Sound.BaseSound) {
    if (!sound) return;
    if (sound.isPlaying) sound.stop();
    sound.destroy();
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

  private cameraFocus(x: number, y: number, zoom: number, duration: number, onComplete: () => void) {
    const cam = this.cameras.main;
    let remaining = 2;
    const done = () => {
      remaining -= 1;
      if (remaining > 0) return;
      onComplete();
    };
    cam.once(Phaser.Cameras.Scene2D.Events.PAN_COMPLETE, done);
    cam.once(Phaser.Cameras.Scene2D.Events.ZOOM_COMPLETE, done);
    cam.pan(x, y, duration, "Sine.easeInOut");
    cam.zoomTo(zoom, duration, "Sine.easeInOut");
  }

  private createBridgeOverlay() {
    const { width, height } = this.scale;
    const existing = this.bridgeUI;
    const bridge = existing && existing.active ? existing : this.add.image(width / 2, height / 1.8, "bridge").setOrigin(0.5, 0.5).setAlpha(0);
    const maxW = this.mobile ? width * 0.7 : width * 0.86;
    const maxH = this.mobile ? height * 0.25 : height * 0.45;
    const size = this.fitTexture("bridge", maxW, maxH);
    bridge.setDisplaySize(size.w, size.h);
    bridge.setPosition(width / 2, this.mobile ? height * 0.78 : height / 1.8);
    bridge.setData("baseScale", bridge.scaleX);
    bridge.setDepth(3000);
    this.bridgeUI = bridge;
    return bridge;
  }

  private hideBridgeOverlay(onComplete: () => void) {
    const bridge = this.bridgeUI;
    if (!bridge) {
      onComplete();
      return;
    }
    this.tweens.killTweensOf(bridge);
    this.time.delayedCall(500, () => {
      if (!this.bridgeUI) {
        onComplete();
        return;
      }
      this.tweens.add({
        targets: bridge,
        alpha: 0.35,
        duration: 200,
        ease: "Sine.easeInOut",
        yoyo: true,
        repeat: 2,
        onComplete: () => {
          this.tweens.add({
            targets: bridge,
            alpha: 0,
            duration: 300,
            ease: "Cubic.easeIn",
            onComplete: () => {
              bridge.destroy();
              this.bridgeUI = undefined;
              onComplete();
            },
          });
        },
      });
    });
  }

  private playStartCutscene(payload: AnagramPayload) {
    const cam = this.cameras.main;
    const { width, height } = this.scale;
    cam.stopFollow();
    cam.setZoom(1);
    cam.centerOn(width / 2, height / 2);
    cam.setScroll(0, 0);
    void this.buildGame(payload);
  }

  private showBridgeHold(onComplete: () => void) {
    const bridge = this.createBridgeOverlay();
    const baseScale = Number(bridge.getData("baseScale")) || bridge.scaleX || 1;
    bridge.setScale(baseScale * 0.94);
    this.tweens.add({
      targets: bridge,
      alpha: 1,
      scale: baseScale,
      duration: 500,
      ease: "Cubic.easeOut",
      onComplete,
    });
  }

  private playEndCutscene(onComplete: () => void) {
    if (this.endCutsceneRunning) return;
    this.endCutsceneRunning = true;

    const decor = this.introDecor;
    if (!decor) {
      this.endCutsceneRunning = false;
      onComplete();
      return;
    }

    const cam = this.cameras.main;
    const { width, height } = this.scale;
    cam.stopFollow();
    cam.setZoom(1);
    cam.centerOn(width / 2, height / 2);
    cam.setScroll(0, 0);

    this.tweens.killTweensOf(decor.title);
    this.tweens.killTweensOf(decor.monkey);
    this.tweens.killTweensOf(decor.banana);
    this.tweens.killTweensOf(decor.bgBanana);
    decor.title.setVisible(false);
    this.endCutsceneHappyMonkey?.destroy();
    this.endCutsceneHappyMonkey = undefined;

    const completeOnce = () => {
      if (!this.sys.isActive()) return;
      this.endCutsceneRunning = false;
      onComplete();
    };

    this.time.delayedCall(600, () => {
      if (!this.sys.isActive()) return;

      const monkey = decor.monkey;
      monkey.setVisible(true).setAlpha(1).setTexture("monkey_idle");
      const baseY = monkey.y;
      const walkTargetX = decor.banana.x - monkey.displayWidth * 0.12;
      const walkDuration = 980;

      const walkBounce = this.tweens.add({
        targets: monkey,
        y: baseY - (this.mobile ? 8 : 10),
        duration: 110,
        ease: "Sine.easeInOut",
        yoyo: true,
        repeat: -1,
      });

      this.tweens.add({
        targets: monkey,
        x: walkTargetX,
        duration: walkDuration,
        ease: "Sine.easeInOut",
        onComplete: () => {
          walkBounce.stop();
          monkey.y = baseY;
          monkey.setTexture("monkey_happy");
          this.playSfx("sfx_level_up", 1);

          const floatDy = height * (this.mobile ? 0.12 : 0.2);
          this.tweens.add({
            targets: [decor.bgBanana, decor.banana],
            y: `-=${floatDy}`,
            duration: 1600,
            ease: "Sine.easeInOut",
            onComplete: () => this.time.delayedCall(220, completeOnce),
          });
        },
      });
    });
  }

  private transitionToNextQuestionDecor(onComplete: () => void) {
    const decor = this.introDecor;
    if (!decor) {
      onComplete();
      return;
    }
    const { width, height } = this.scale;

    const banana = decor.banana;
    const bgBanana = decor.bgBanana;
    const happy = this.endCutsceneHappyMonkey;

    const exitTargets: Phaser.GameObjects.GameObject[] = [banana, bgBanana];
    if (happy) exitTargets.push(happy);

    const exitDistance = width * 0.75;
    this.tweens.killTweensOf(exitTargets);
    this.tweens.add({
      targets: exitTargets,
      x: `+=${exitDistance}`,
      alpha: 0,
      duration: 520,
      ease: "Sine.easeInOut",
      onComplete: () => {
        if (!this.sys.isActive()) return;

        if (this.endCutsceneHappyMonkey) {
          this.endCutsceneHappyMonkey.destroy();
          this.endCutsceneHappyMonkey = undefined;
        }

        const bananaBaseX = Number(banana.getData("baseX")) || width * 0.7;
        const bananaBaseY = Number(banana.getData("baseY")) || height * 0.5;
        const bananaBaseScale = Number(banana.getData("baseScale")) || banana.scale;

        const bgBaseX = Number(bgBanana.getData("baseX")) || bananaBaseX;
        const bgBaseY = Number(bgBanana.getData("baseY")) || bananaBaseY;
        const bgBaseScale = Number(bgBanana.getData("baseScale")) || bgBanana.scale;

        const monkey = decor.monkey;
        const monkeyBaseX = Number(monkey.getData("baseX")) || width * 0.3;
        const monkeyBaseY = Number(monkey.getData("baseY")) || height * 0.5;
        const monkeyBaseScale = Number(monkey.getData("baseScale")) || monkey.scale;

        const startOffsetX = width * 0.25;
        const startAboveY = -Math.max(80, banana.displayHeight * 0.8);
        banana.setPosition(bananaBaseX, startAboveY).setScale(bananaBaseScale).setAlpha(1).setVisible(true);
        bgBanana.setPosition(bgBaseX, startAboveY).setScale(bgBaseScale).setAlpha(1).setVisible(true);
        monkey.setPosition(-startOffsetX - width * 0.15, monkeyBaseY).setScale(monkeyBaseScale).setAlpha(1).setVisible(true);

        this.tweens.killTweensOf([banana, bgBanana, monkey]);
        this.tweens.add({
          targets: [banana, bgBanana],
          y: { from: banana.y, to: bananaBaseY },
          duration: 750,
          ease: "Back.easeOut",
          easeParams: [2.8],
          onComplete: () => {
            this.animateIntroDecor();
          },
        });
        this.tweens.add({
          targets: monkey,
          x: { from: monkey.x, to: monkeyBaseX },
          duration: 750,
          ease: "Back.easeOut",
          easeParams: [2.8],
          onComplete: () => {
            onComplete();
          },
        });
      },
    });
  }

  private destroyIntroDecor(keepMonkey = true) {
    const decor = this.introDecor;
    this.introDecor = undefined;
    if (!decor) return;
    this.tweens.killTweensOf(decor.title);
    decor.title.destroy();
    if (!keepMonkey) {
      this.tweens.killTweensOf(decor.monkey);
      this.tweens.killTweensOf(decor.banana);
      this.tweens.killTweensOf(decor.bgBanana);
      decor.bgBanana.destroy();
      decor.monkey.destroy();
      decor.banana.destroy();
    }
  }

  private createIntroDecor(worldWidth: number, worldHeight: number) {
    const centerX = worldWidth / 2;
    const centerY = worldHeight / 3;

    const title = this.add.image(centerX, centerY, "anagram_main_icon").setDepth(4);
    const monkey = this.add.image(centerX, centerY, "monkey_idle").setDepth(4);
    const banana = this.add.image(centerX, centerY, "banana").setDepth(4);
    const bgBanana = this.add.image(centerX, centerY, "bg_banana").setDepth(3);

    this.introDecor = { title, monkey, banana, bgBanana };

    this.layoutIntroDecor(worldWidth, worldHeight);
  }

  private layoutIntroDecor(worldWidth: number, worldHeight: number) {
    const decor = this.introDecor;
    if (!decor) return;

    const centerX = worldWidth / 2;
    const centerY = worldHeight / 3;

    const titleSrc = this.textures.get("anagram_main_icon").getSourceImage() as { width?: number; height?: number };
    const titleW = titleSrc?.width ?? 1;
    const titleH = titleSrc?.height ?? 1;
    const titleMaxW = worldWidth * (this.mobile ? 0.90 : 0.8);
    const titleMaxH = worldHeight * (this.mobile ? 0.30 : 0.6);
    const titleScale = Math.min(titleMaxW / titleW, titleMaxH / titleH);

    const bananaSrc = this.textures.get("banana").getSourceImage() as { width?: number; height?: number };
    const bananaW = bananaSrc?.width ?? 1;
    const bananaH = bananaSrc?.height ?? 1;
    const bananaMaxW = worldWidth * (this.mobile ? 0.5 : 0.5);
    const bananaMaxH = worldHeight * (this.mobile ? 0.075 : 0.125);
    const bananaScale = Math.min(bananaMaxW / bananaW, bananaMaxH / bananaH);

    const bgBananaSrc = this.textures.get("bg_banana").getSourceImage() as { width?: number; height?: number };
    const bgBananaW = bgBananaSrc?.width ?? 1;
    const bgBananaH = bgBananaSrc?.height ?? 1;
    const bgBananaMaxW = worldWidth * (this.mobile ? 0.7 : 0.7);
    const bgBananaMaxH = worldHeight * (this.mobile ? 0.15 : 0.25);
    const bgBananaScale = Math.min(bgBananaMaxW / bgBananaW, bgBananaMaxH / bgBananaH);

    const monkeySrc = this.textures.get("monkey_idle").getSourceImage() as { width?: number; height?: number };
    const monkeyW = monkeySrc?.width ?? 1;
    const monkeyH = monkeySrc?.height ?? 1;
    const monkeyMaxW = worldWidth * (this.mobile ? 0.7 : 0.7);
    const monkeyMaxH = worldHeight * (this.mobile ? 0.15 : 0.25);
    const monkeyScale = Math.min(monkeyMaxW / monkeyW, monkeyMaxH / monkeyH);

    const titleTargetX = centerX;
    const titleTargetY = this.mobile ? centerY : centerY - worldHeight * 0.075;
    const shouldDropTitle = decor.title.getData("dropInPlayed") !== true;
    decor.title.setScale(titleScale);
    if (shouldDropTitle) {
      decor.title.setData("dropInPlayed", true);
      decor.title.setPosition(titleTargetX, -Math.max(40, decor.title.displayHeight * 0.7));
      decor.title.setAlpha(0);
    } else {
      decor.title.setPosition(titleTargetX, titleTargetY);
      decor.title.setAlpha(1);
    }
    decor.monkey.setPosition(this.mobile ? centerX - worldWidth * 0.35 : centerX - worldWidth * 0.38, this.mobile ? centerY + worldHeight * 0.38 : centerY + worldHeight * 0.175).setScale(monkeyScale);
    decor.banana.setPosition(this.mobile ? centerX + worldWidth * 0.35 : centerX + worldWidth * 0.38, this.mobile ? centerY + worldHeight * 0.38 : centerY + worldHeight * 0.175).setScale(bananaScale);
    decor.bgBanana.setPosition(this.mobile ? centerX + worldWidth * 0.35 : centerX + worldWidth * 0.38, this.mobile ? centerY + worldHeight * 0.38 : centerY + worldHeight * 0.175).setScale(bgBananaScale);
    decor.monkey.setData("baseX", decor.monkey.x);
    decor.monkey.setData("baseY", decor.monkey.y);
    decor.monkey.setData("baseScale", monkeyScale);
    decor.banana.setData("baseX", decor.banana.x);
    decor.banana.setData("baseY", decor.banana.y);
    decor.banana.setData("baseScale", bananaScale);
    decor.bgBanana.setData("baseX", decor.bgBanana.x);
    decor.bgBanana.setData("baseY", decor.bgBanana.y);
    decor.bgBanana.setData("baseScale", bgBananaScale);

    this.tweens.killTweensOf(decor.title);
    this.tweens.killTweensOf(decor.monkey);
    this.tweens.killTweensOf(decor.banana);
    this.tweens.killTweensOf(decor.bgBanana);
    if (shouldDropTitle && decor.title.visible) {
      this.tweens.add({
        targets: decor.title,
        y: titleTargetY,
        alpha: 1,
        duration: this.mobile ? 650 : 800,
        ease: "Back.easeOut",
        easeParams: [3.2],
      });
    }
    this.animateIntroDecor();
  }

  private animateIntroDecor() {
    const decor = this.introDecor;
    if (!decor) return;

    this.tweens.killTweensOf(decor.banana);
    this.tweens.killTweensOf(decor.bgBanana);

    const bgBaseScale = Number(decor.bgBanana.getData("baseScale")) || decor.bgBanana.scale;
    decor.bgBanana.setScale(bgBaseScale);
    this.tweens.add({
      targets: decor.bgBanana,
      scale: bgBaseScale * (this.mobile ? 1.15 : 1.1),
      duration: this.mobile ? 1200 : 1400,
      ease: "Sine.easeInOut",
      yoyo: true,
      repeat: -1,
    });

    const bananaBaseX = Number(decor.banana.getData("baseX")) || decor.banana.x;
    const bananaBaseY = Number(decor.banana.getData("baseY")) || decor.banana.y;
    const bananaBaseScale = Number(decor.banana.getData("baseScale")) || decor.banana.scale;
    decor.banana.setPosition(bananaBaseX, bananaBaseY).setScale(bananaBaseScale).setAngle(0);
    this.tweens.add({
      targets: decor.banana,
      x: bananaBaseX + (this.mobile ? 12 : 20),
      y: bananaBaseY - (this.mobile ? 10 : 12),
      angle: this.mobile ? 5 : 5,
      duration: this.mobile ? 1200 : 1400,
      ease: "Sine.easeInOut",
      yoyo: true,
      repeat: -1,
    });
  }

  private createTitleContainer(title: string) {
    if (!hasHudCenterLabel(title)) return;
    this.titleUI?.container.destroy(true);
    const startY = -150;
    const container = this.add.container(0, startY).setDepth(10);
    const box = this.add.graphics();
    const placeholder = document.createElement("div");
    const dom = this.add.dom(0, 0, placeholder).setOrigin(0.5, 0.5);
    container.add([box, dom]);
    this.titleUI = { container, box, dom, title };
    this.layoutTitle();
    const targetY = container.y;
  
    container.y = startY;
  
    const onResize = () => this.layoutTitle();
    this.scale.on(Phaser.Scale.Events.RESIZE, onResize);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, onResize);
    });
    this.tweens.add({
      targets: container,
      y: targetY,
      duration: 600,
      ease: "Back.easeOut",
      easeParams: [3.5],
      delay: 0,
    });
  }
  
  private layoutTitle() {
    if (!this.titleUI) return;
    const safe = this.getAnagramSafeArea();
    const width = safe.width;
    const height = safe.height;
    const ui = createHudScaleCtx(width, height, this.mobile);
    const boxW = Math.min(width * (this.mobile ? 0.9 : 0.86), ui.px(900));
    const radius = ui.px(14);
    const paddingX = this.mobile ? 12 : ui.px(20);
    const paddingY = this.mobile ? 8 : ui.px(12);
    const fontPx = getHudCenterTextMaxFontPx(ui.px.bind(ui), this.mobile);
    const y = Math.max(this.mobile ? 48 : ui.px(54), height * (this.mobile ? 0.045 : 0.06));

    const mobileContentOffsetY = this.mobile ? mobileCompactPx(52, height, width) : 0;
    this.titleUI.container.setPosition(
      safe.x + width / 2,
      safe.y + (this.mobile ? y * 1.6 + mobileContentOffsetY : y)
    );

    const title = (this.titleUI.title ?? "").trim();
    if (!hasHudCenterLabel(title)) {
      this.titleUI.container.setVisible(false);
      return;
    }
    this.titleUI.container.setVisible(true);
    // แสดงข้อความเต็ม: ตัดบรรทัดได้อิสระ แล้วขยายกล่องให้พอดีกับเนื้อหา
    const span = createThaiTextSpan(title, {
      fontSizePx: fontPx,
      color: "#4E4E4E",
      fontWeight: 700,
      textAlign: "center",
      maxWidthPx: Math.floor(boxW - paddingX * 2),
      pointerEventsNone: true,
    });

    const measureWrap = document.createElement("div");
    measureWrap.style.cssText = "position:fixed;left:-9999px;top:-9999px;visibility:hidden;";
    measureWrap.appendChild(span);
    document.body.appendChild(measureWrap);
    const textH = span.offsetHeight;
    document.body.removeChild(measureWrap);

    const boxH = Math.max(this.mobile ? 38 : ui.px(48), Math.ceil(textH) + paddingY * 2);

    this.titleUI.box.clear();
    this.titleUI.box.fillStyle(0xffffff, 0.55);
    this.titleUI.box.fillRoundedRect(-boxW / 2, -boxH / 2, boxW, boxH, radius);

    this.titleUI.container.remove(this.titleUI.dom, true);
    const dom = this.add.dom(0, 0, span).setOrigin(0.5, 0.5);
    dom.pointerEvents = "none";
    this.titleUI.dom = dom;
    this.titleUI.container.add(dom);
  }

  private getAnagramHudLayout() {
    const safe = this.getAnagramSafeArea();
    const ui = createHudScaleCtx(safe.width, safe.height, this.mobile);
    const metrics = getGameHudRowMetrics({
      mobile: this.mobile,
      width: safe.width,
      height: safe.height,
      px: ui.px.bind(ui),
      hasProgress: true,
      hasLives: false,
    });
    const slots = getGameHudPillSlots(safe.x, safe.y, safe.width, metrics, {
      hasProgress: true,
      hasLives: false,
      mobile: this.mobile,
    });
    return { safe, ui, metrics, slots };
  }

  private createTimeContainer() {
    this.timeUI?.container.destroy(true);
    const startY = -150;
    const container = this.add.container(0, startY).setDepth(10);
    const bg = this.add.image(0, 0, BG_HUD_TEXTURE_KEY).setOrigin(0.5);
    const placeholder = document.createElement("div");
    const dom = this.add.dom(0, 0, placeholder).setOrigin(0.5, 0.5);
    container.add([bg, dom]);

    const inner = document.createElement("div");
    inner.textContent = "00:00";
    this.timeUI = { container, bg, dom, inner };
    this.layoutTime();
    this.updateHud();

    const targetY = container.y;
    container.y = startY;

    const onResize = () => this.layoutAnagramHudStats();
    this.scale.on(Phaser.Scale.Events.RESIZE, onResize);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, onResize);
    });
    this.tweens.add({
      targets: container,
      y: targetY,
      duration: 600,
      ease: "Back.easeOut",
      easeParams: [3.5],
      delay: 0,
    });
  }

  /** วาง time / score / progress บนแกน Y เดียวกัน — เรียกทุกครั้งที่ HUD อัปเดต */
  private layoutAnagramHudStats() {
    const { safe, ui, metrics, slots } = this.getAnagramHudLayout();
    const rowCenterY = safe.y + slots.rowY;

    layoutGameHudStatsDomRow({
      scene: this,
      mobile: this.mobile,
      metrics,
      slots,
      rowCenterY,
      px: ui.px.bind(ui),
      pills: {
        time: this.timeUI as DomHudPill | undefined,
        score: this.scoreUI as DomHudPill | undefined,
        progress: this.questionProgressUI,
      },
      timeText: this.formatElapsedSeconds(this.getHudElapsedSeconds()),
      scoreValue: String(this.showScore),
      progressLabel: this.getAnagramQuestionProgressLabel(),
      labelPad: ui.px(this.mobile ? 12 : 18),
      valuePad: ui.px(this.mobile ? 12 : 18),
    });
    if (this.timeUI) {
      this.hudTimeFontSize = getHudStatFontSize(ui.px.bind(ui), this.mobile);
    }
  }

  private layoutTime() {
    this.layoutAnagramHudStats();
  }

  private createScoreContainer() {
    this.scoreUI?.container.destroy(true);
    const startY = -150;
    const container = this.add.container(0, startY).setDepth(10);
    const bg = this.add.image(0, 0, BG_HUD_TEXTURE_KEY).setOrigin(0.5);
    const placeholder = document.createElement("div");
    const dom = this.add.dom(0, 0, placeholder).setOrigin(0.5, 0.5);
    container.add([bg, dom]);

    const inner = document.createElement("div");
    inner.textContent = "คะแนน 0";
    this.scoreUI = { container, bg, dom, inner };
    this.layoutScore();
    this.updateHud();

    const targetY = container.y;
    container.y = startY;

    const onResize = () => this.layoutAnagramHudStats();
    this.scale.on(Phaser.Scale.Events.RESIZE, onResize);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, onResize);
    });
    this.tweens.add({
      targets: container,
      y: targetY,
      duration: 600,
      ease: "Back.easeOut",
      easeParams: [3.5],
      delay: 0,
    });
  }

  private layoutScore() {
    this.layoutAnagramHudStats();
  }

  private getAnagramQuestionProgressLabel(): string {
    const total = this.numberOfQuestions || this.rawQuestions.length || this.totalQuestions || 0;
    if (total <= 0) return "";
    return getQuestionProgressLabel(total, { questionIndex0: this.currentQuestionIndex });
  }

  private createQuestionProgressContainer() {
    this.questionProgressUI?.container.destroy(true);
    const pill = createDomProgressHudPill(this, 10, this.getAnagramQuestionProgressLabel());
    this.questionProgressUI = pill;
    this.layoutAnagramHudStats();

    const { safe, slots } = this.getAnagramHudLayout();
    tweenHudContainerDropIn(this, pill.container, safe.y + slots.rowY);

    const onResize = () => this.layoutAnagramHudStats();
    this.scale.on(Phaser.Scale.Events.RESIZE, onResize);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, onResize);
    });
  }

  private updateHud() {
    const elapsed = this.getHudElapsedSeconds();
    const timeLabel = this.formatElapsedSeconds(elapsed);
    const scoreLabel = `คะแนน ${this.showScore}`;

    if (this.timeUI) {
      setDomTimeHudPillValue(this.timeUI, timeLabel);
    }
    if (this.scoreUI) {
      setDomLabelValueHudPillValue(this.scoreUI as DomHudPill, String(this.showScore));
    }
    if (this.questionProgressUI) {
      setDomProgressHudPillLabel(this.questionProgressUI, this.getAnagramQuestionProgressLabel());
    }
    this.updateTimedMessages(elapsed);
    this.updateTickingByElapsed(elapsed);
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
    this.stopTicking();
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
    this.hudTimerEvent?.destroy();
    this.hudTimerEvent = undefined;
    this.stopTicking();
    this.timeFlashEvent?.destroy();
    this.timeFlashEvent = undefined;
    this.timeRedLoopActive = false;
    this.timeFlashSeq += 1;
    if (this.timeUI) {
      this.tweens.killTweensOf(this.timeUI.dom);
      this.timeUI.dom.setAlpha(1);
      setDomTimeHudPillValue(
        this.timeUI,
        this.timeUI.inner.querySelector("span")?.textContent ?? "00:00",
        this.timeTextBaseColor
      );
    }
    this.updateHud();
  }

  private ensureHudTimer() {
    if (this.hudTimerEvent) return;
    this.hudTimerEvent = this.time.addEvent({
      delay: 250,
      loop: true,
      callback: () => this.updateHud(),
    });
  }

  private tweenOnce(config: Phaser.Types.Tweens.TweenBuilderConfig): Promise<void> {
    return new Promise<void>((resolve) => {
      const originalOnComplete = config.onComplete;
      const originalOnStop = (config as any).onStop as undefined | ((...args: any[]) => any);
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

  private animateScoreTextFlash(): Promise<void> {
    if (!this.scoreUI) return Promise.resolve();
    const seq = (this.scoreFlashSeq += 1);
    const baseColor = (this.scoreUI.inner?.style?.color || "").trim() || this.scoreTextBaseColor;
    const flashColor = "#FF8EC0";
    if (this.scoreUI.inner) {
      this.scoreUI.inner.style.color = flashColor;
    }

    return this.tweenOnce({
      targets: this.scoreUI.dom,
      alpha: { from: 1, to: 0.25 },
      duration: 80,
      yoyo: true,
      repeat: 5,
      ease: "Sine.easeInOut",
      onStop: () => {
        if (seq !== this.scoreFlashSeq) return;
        if (!this.scoreUI) return;
        this.scoreUI.dom.setAlpha(1);
        if (this.scoreUI.inner) {
          this.scoreUI.inner.style.color = baseColor;
        }
      },
      onComplete: () => {
        if (seq !== this.scoreFlashSeq) return;
        if (!this.scoreUI) return;
        this.scoreUI.dom.setAlpha(1);
        if (this.scoreUI.inner) {
          this.scoreUI.inner.style.color = baseColor;
        }
      },
    });
  }

  private animateScoreTextBlink(flashColor: number): Promise<void> {
    if (!this.scoreUI) return Promise.resolve();
    const seq = (this.scoreFlashSeq += 1);
    const baseColor = (this.scoreUI.inner?.style?.color || "").trim() || this.scoreTextBaseColor;
    const flashCss = this.colorToCss(flashColor);

    if (this.scoreUI.inner) {
      this.scoreUI.inner.style.color = flashCss;
    }

    return this.tweenOnce({
      targets: this.scoreUI.dom,
      alpha: { from: 1, to: 0.2 },
      duration: 70,
      yoyo: true,
      repeat: 6,
      ease: "Sine.easeInOut",
      onStop: () => {
        if (seq !== this.scoreFlashSeq) return;
        if (!this.scoreUI) return;
        this.scoreUI.dom.setAlpha(1);
        if (this.scoreUI.inner) {
          this.scoreUI.inner.style.color = baseColor;
        }
      },
      onComplete: () => {
        if (seq !== this.scoreFlashSeq) return;
        if (!this.scoreUI) return;
        this.scoreUI.dom.setAlpha(1);
        if (this.scoreUI.inner) {
          this.scoreUI.inner.style.color = baseColor;
        }
      },
    });
  }

  private async animateScoreHud(): Promise<void> {
    if (!this.scoreUI) return;

    this.tweens.killTweensOf(this.scoreUI.container);
    this.tweens.killTweensOf(this.scoreUI.dom);
    const baseX = this.scoreUI.container.getData("baseX");
    const baseY = this.scoreUI.container.getData("baseY");
    const originalX = typeof baseX === "number" ? baseX : this.scoreUI.container.x;
    const originalY = typeof baseY === "number" ? baseY : this.scoreUI.container.y;
    this.scoreUI.container.setPosition(originalX, originalY);
    this.scoreUI.dom.setAlpha(1);

    await Promise.all([
      this.tweenOnce({
        targets: this.scoreUI.container,
        y: { from: originalY, to: originalY - 15 },
        duration: 100,
        yoyo: true,
        ease: "Back.easeOut",
      }),
      this.tweenOnce({
        targets: this.scoreUI.container,
        scale: { from: 1, to: 1.1 },
        duration: 150,
        yoyo: true,
        ease: "Quad.easeOut",
      }),
      this.animateScoreTextFlash(),
    ]);

    if (!this.scoreUI) return;
    this.scoreUI.container.setPosition(originalX, originalY);
    this.scoreUI.container.setScale(1);
    this.scoreUI.dom.setAlpha(1);
  }

  private async animateScoreHudWrong(): Promise<void> {
    if (!this.scoreUI) return;

    this.tweens.killTweensOf(this.scoreUI.container);
    this.tweens.killTweensOf(this.scoreUI.dom);
    const baseX = this.scoreUI.container.getData("baseX");
    const baseY = this.scoreUI.container.getData("baseY");
    const originalX = typeof baseX === "number" ? baseX : this.scoreUI.container.x;
    const originalY = typeof baseY === "number" ? baseY : this.scoreUI.container.y;
    this.scoreUI.container.setPosition(originalX, originalY);
    this.scoreUI.dom.setAlpha(1);

    await Promise.all([
      this.tweenOnce({
        targets: this.scoreUI.container,
        x: { from: originalX - 10, to: originalX + 10 },
        duration: 60,
        yoyo: true,
        repeat: 4,
        ease: "Sine.easeInOut",
      }),
      this.animateScoreTextBlink(0xff0076),
    ]);

    if (!this.scoreUI) return;
    this.scoreUI.container.setPosition(originalX, originalY);
    this.scoreUI.container.setScale(1);
    this.scoreUI.dom.setAlpha(1);
  }

  private showScoreFlyText(text: string, startX?: number, startY?: number, colorCss?: string, mode: "toHud" | "up" = "toHud"): Promise<void> {
    const { width, height } = this.scale;
    const x = typeof startX === "number" ? startX : width / 2;
    const y = typeof startY === "number" ? startY : height / 2;
    const r = Math.max(30, Math.round(Math.min(width, height) * 0.06));

    const circle = this.add.circle(0, 0, r, 0xffffff, 0.95);
    const label = this.add
      .text(0, 0, text, {
        fontSize: `${Math.round(r * 0.95)}px`,
        color: (colorCss ?? "#025B96").trim() || "#025B96",
        fontFamily: "Noto Sans Thai",
        fontStyle: "bold",
      })
      .setOrigin(0.5);

    const container = this.add.container(x, y + 40, [circle, label]).setDepth(2000);
    container.setScale(0).setAlpha(0);

    const targetX = this.scoreUI?.container.x ?? width;
    const targetY = this.scoreUI?.container.y ?? 0;

    return new Promise<void>((resolve) => {
      this.tweens.chain({
        targets: container,
        tweens: [
          {
            y: y,
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
            ...(mode === "up"
              ? {
                  y: y - height * (this.mobile ? 0.12 : 0.2),
                  x,
                  scale: 0.95,
                  alpha: 0,
                  duration: 520,
                  ease: "Sine.easeInOut",
                }
              : {
                  y: targetY,
                  x: targetX,
                  scale: 0.2,
                  alpha: 0,
                  duration: 600,
                  ease: "Expo.easeIn",
                }),
            onComplete: () => {
              container.destroy(true);
              resolve();
            },
          },
        ],
      });
    });
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

  private onScoreIncreased() {
    this.lastScoreChangeMs = Date.now();
    this.idleNoScoreMessageShown = false;
  }

  private onScoreDecreased() {
    this.lastScoreChangeMs = Date.now();
    this.idleNoScoreMessageShown = false;
  }

  private playMonkeyJump(durationMs: number): Promise<void> {
    const decor = this.introDecor;
    const monkey = decor?.monkey;
    if (!monkey) return Promise.resolve();

    const safeMs = Math.max(0, Math.floor(durationMs));
    if (safeMs <= 0) return Promise.resolve();

    this.tweens.killTweensOf(monkey);
    const baseY = monkey.y;
    const baseScale = monkey.scale;

    const jumpUp = this.mobile ? 16 : 20;
    const hopDuration = this.mobile ? 140 : 150;
    const cycleMs = hopDuration * 2;
    const repeat = Math.max(0, Math.ceil(safeMs / cycleMs) - 1);

    const yTween = this.tweens.add({
      targets: monkey,
      y: baseY - jumpUp,
      duration: hopDuration,
      ease: "Sine.easeOut",
      yoyo: true,
      repeat,
    });

    const scaleTween = this.tweens.add({
      targets: monkey,
      scale: baseScale * 1.04,
      duration: hopDuration,
      ease: "Sine.easeOut",
      yoyo: true,
      repeat,
    });

    return new Promise<void>((resolve) => {
      this.time.delayedCall(safeMs, () => {
        yTween.stop();
        scaleTween.stop();
        if (!monkey.active) {
          resolve();
          return;
        }
        monkey.y = baseY;
        monkey.setScale(baseScale);
        resolve();
      });
    });
  }

  private async awardQuestionScore(): Promise<void> {
    if (!this.sys.isActive()) return;
    const question = this.questions[this.currentQuestionIndex];
    if (!question) return;
    this.playSfx("sfx_all_correct", 1);

    const centerX = this.scale.width / 2;
    const centerY = this.scale.height / 2;
    const base = Math.max(0, Math.floor(question.length));
    const isPerfect = !question.hadWrong;
    const award = isPerfect ? base * 2 : base;
    if (award <= 0) return;

    const scoreToHudMs = 1200;
    const scoreUpMs = 1120;
    const scoreHudMs = 960;
    const totalMs = (isPerfect ? scoreUpMs : 0) + scoreToHudMs + scoreHudMs;
    const jumpDone = this.playMonkeyJump(totalMs);

    const scoreDone = (async () => {
      if (isPerfect) {
        await this.showScoreFlyText("x2", centerX, centerY, "#025B96", "up");
        if (!this.sys.isActive()) return;
      }

      this.score += award;
      this.onScoreIncreased();
      const plusDone = this.showScoreFlyText(`+${award}`, centerX, centerY, "#025B96");
      this.createParticleBurst(centerX, centerY, 2010);

      await plusDone;
      if (!this.sys.isActive()) return;
      this.showScore = this.score;
      this.updateHud();
      await this.animateScoreHud();
    })();

    await Promise.all([jumpDone, scoreDone]);
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

  private updateTickingByElapsed(elapsedSeconds: number) {
    void elapsedSeconds;
    this.stopTickingAudio();
    this.tickingState = null;
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
    this.tweens.killTweensOf(this.timeUI.dom);
    this.timeUI.dom.setAlpha(0.25);
    this.timeRedLoopActive = loop;
    const seq = (this.timeFlashSeq += 1);

    const baseColor = getDomTimeHudPillValueColor(this.timeUI);
    const flashColor = this.colorToCss(color);
    setDomTimeHudPillValue(
      this.timeUI,
      this.timeUI.inner.querySelector("span")?.textContent ?? "00:00",
      flashColor
    );

    const duration = loop ? 260 : 140;
    const safeFlashes = Math.max(1, Math.floor(flashes));
    const repeat = loop ? -1 : safeFlashes * 2 - 2;

    this.timeFlashEvent = this.time.addEvent({
      delay: duration,
      loop: loop,
      repeat: loop ? 0 : repeat,
      callback: () => {
        if (seq !== this.timeFlashSeq) return;
        if (!this.timeUI) return;
        const nextAlpha = this.timeUI.dom.alpha < 0.9 ? 1 : 0.25;
        this.timeUI.dom.setAlpha(nextAlpha);
      },
    });

    if (loop) return;

    const totalMs = duration * (repeat + 1) + 40;
    this.time.delayedCall(totalMs, () => {
      if (seq !== this.timeFlashSeq) return;
      if (!this.timeUI) return;
      if (!this.timeRedLoopActive) {
        this.timeUI.dom.setAlpha(1);
        const timeText = this.timeUI.inner.querySelector("span")?.textContent ?? "00:00";
        setDomTimeHudPillValue(this.timeUI, timeText, baseColor);
      }
      this.timeFlashEvent?.destroy();
      this.timeFlashEvent = undefined;
    });
  }

  private colorToCss(value: number) {
    const safe = Math.max(0, Math.min(0xffffff, Math.floor(value)));
    return `#${safe.toString(16).padStart(6, "0")}`;
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

    this.lastMessageShownMs = Date.now();
    if (voiceKey) this.playVoice(voiceKey, 1);

    this.teacherHintUI?.present({
      text: clean,
      durationMs,
      teacherState: teacherStateWhileVisible,
    });
  }

  private hideMessage() {
    this.teacherHintUI?.hide();
  }

  private countAnagramQuestions(payload: AnagramPayload): number {
    return payload.questions?.filter((q) => q.swap_word && q.id != null).length ?? 0;
  }

  private async buildGame(payload: AnagramPayload) {
    const raw = payload.questions?.filter((q) => q.swap_word && q.id != null) ?? [];

    this.numberOfQuestions = raw.length;
    this.totalQuestions = this.numberOfQuestions;
    this.rawQuestions = raw;
    this.questions = raw.map((q) => ({
      word: q.word,
      swap_word: q.swap_word,
      length: q.swap_word.length,
      numberOfCorrectWords: 0,
      hadWrong: false,
    }));
    this.currentQuestionIndex = 0;
    this.correctWords = 0;

    if (this.numberOfQuestions <= 0) {
      this.showMessage("ไม่พบข้อมูลคำถาม", 1800, undefined, "point");
      this.time.delayedCall(500, () => this.endGame());
      return;
    }

    await this.loadAnagramDynamicAssets(raw);

    this.input.enabled = true;
    this.lockInput = false;
    this.hudElapsedAccumSec = 0;
    this.frozenHudElapsedSec = null;
    this.hudStarted = true;
    this.hudStartMs = Date.now();
    this.lastScoreChangeMs = Date.now();
    this.idleNoScoreMessageShown = false;

    this.createAnagramBoard();
    this.layoutAnagramHudStats();
    this.renderQuestion(this.currentQuestionIndex);
    const firstQuestion = this.rawQuestions[0];
    if (!firstQuestion || !this.hasAnagramQuestionHint(firstQuestion)) {
      this.showRandomMessage(this.messagePools.intro, 2500, "point");
    }
  }

  private createAnagramBoard() {
    this.destroyAnagramBoard();
    const container = this.add.container(0, 0).setDepth(1200);
    const topBox = this.add.graphics();
    const bottomBox = this.add.graphics();
    const bottomTitle = this.add.image(0, 0, "title_swap_word").setOrigin(0.5, 0.5);
    container.add([topBox, bottomBox, bottomTitle]);
    this.playArea = { container, topBox, bottomBox, bottomTitle };
    this.layoutAnagramBoard();
  }

  private destroyAnagramBoard() {
    this.clearQuestionViews();
    this.playArea?.container.destroy(true);
    this.playArea = undefined;
  }

  private clearQuestionViews() {
    this.destroyWordPrompt();
    for (const slot of this.topSlots) {
      slot.container.destroy(true);
      slot.dropZone.destroy(true);
    }
    this.topSlots = [];
    for (const token of this.tokens) {
      token.container.destroy(true);
    }
    this.tokens = [];
    this.hoveringSlotIndex = null;
  }

  private resolveAssetUrl(raw?: string | null): string | undefined {
    if (!raw) return undefined;
    const t = String(raw).trim();
    if (!t) return undefined;
    if (/^https?:\/\//i.test(t)) return t;
    return `${API_BASE_URL}/${t.replace(/^\//, "")}`;
  }

  private async loadAnagramDynamicAssets(questions: AnagramQuestion[]): Promise<void> {
    const audioJobs: { key: string; url: string }[] = [];
    const imageJobs: { key: string; url: string }[] = [];

    const regAudio = (raw?: string | null) => {
      const url = this.resolveAssetUrl(raw);
      if (!url || this.anagramAudioByUrl.has(url)) return;
      const key = `anagram_audio_${this.anagramAudioByUrl.size}`;
      this.anagramAudioByUrl.set(url, key);
      if (!this.cache.audio.exists(key)) audioJobs.push({ key, url });
    };
    const regImage = (raw?: string | null) => {
      const url = this.resolveAssetUrl(raw);
      if (!url || this.anagramTexByUrl.has(url)) return;
      const key = `anagram_tex_${this.anagramTexByUrl.size}`;
      this.anagramTexByUrl.set(url, key);
      if (!this.textures.exists(key)) imageJobs.push({ key, url });
    };

    for (const q of questions) {
      regAudio(q.sound_word);
      regAudio(q.sound_hint);
      regImage(q.image_word);
      regImage(q.image_hint);
    }

    if (!audioJobs.length && !imageJobs.length) return;
    for (const a of audioJobs) this.load.audio(a.key, a.url);
    for (const i of imageJobs) this.load.image(i.key, i.url);

    await new Promise<void>((resolve) => {
      this.load.once(Phaser.Loader.Events.COMPLETE, resolve);
      this.load.start();
    });
  }

  private getAnagramTexKey(raw?: string | null): string | undefined {
    const url = this.resolveAssetUrl(raw);
    if (!url) return undefined;
    const key = this.anagramTexByUrl.get(url);
    return key && this.textures.exists(key) ? key : undefined;
  }

  private playAnagramUrlAudio(raw?: string | null, volume = 1) {
    const url = this.resolveAssetUrl(raw);
    if (!url) return;
    const key = this.anagramAudioByUrl.get(url);
    if (!key) return;
    guardedScenePlayQuestion(this, key, volume);
  }

  private hasAnagramQuestionHint(q: AnagramQuestion): boolean {
    const hint = (q.hint ?? "").trim();
    const imgKey = this.getAnagramTexKey(q.image_hint);
    const shUrl = this.resolveAssetUrl(q.sound_hint);
    const swUrl = this.resolveAssetUrl(q.sound_word);
    const hasHintSound = !!shUrl && shUrl !== swUrl;
    return !!(hint || imgKey || hasHintSound);
  }

  private playAnagramHintSound(q: AnagramQuestion) {
    const sh = this.resolveAssetUrl(q.sound_hint);
    const sw = this.resolveAssetUrl(q.sound_word);
    if (!sh || (sw && sh === sw)) return;
    this.playAnagramUrlAudio(q.sound_hint, 1);
  }

  private showAnagramQuestionHint(q: AnagramQuestion) {
    const hint = (q.hint ?? "").trim();
    const imgKey = this.getAnagramTexKey(q.image_hint);
    const shUrl = this.resolveAssetUrl(q.sound_hint);
    const swUrl = this.resolveAssetUrl(q.sound_word);
    const hasHintSound = !!shUrl && shUrl !== swUrl;

    if (!hint && !imgKey) {
      if (!hasHintSound) return;
      this.teacherHintUI?.present({
        text: "",
        durationMs: 4200,
        teacherState: "point",
        playNotificationSfx: true,
      });
      return;
    }

    this.teacherHintUI?.presentHint({
      text: hint,
      hintTextureKey: imgKey,
      durationMs: 5200,
      teacherState: "point",
    });
  }

  /** แสดงคำใบ้จาก server ตอนเริ่มแต่ละข้อ */
  private presentQuestionStartHint(q: AnagramQuestion) {
    if (!this.hasAnagramQuestionHint(q)) return;

    const soundWordUrl = this.resolveAssetUrl(q.sound_word);
    const qKey =
      soundWordUrl && this.anagramAudioByUrl.has(soundWordUrl)
        ? this.anagramAudioByUrl.get(soundWordUrl)
        : undefined;
    const shUrl = this.resolveAssetUrl(q.sound_hint);
    const hintHasSound = !!shUrl && shUrl !== soundWordUrl;

    if (qKey && hintHasSound) {
      guardedScenePlayQuestionThen(this, qKey, 1, () => {
        if (!this.sys.isActive()) return;
        this.showAnagramQuestionHint(q);
        this.time.delayedCall(200, () => this.playAnagramHintSound(q));
      });
      return;
    }

    if (qKey) this.playAnagramUrlAudio(q.sound_word, 1);
    this.showAnagramQuestionHint(q);
    this.time.delayedCall(600, () => this.playAnagramHintSound(q));
  }

  private destroyWordPrompt() {
    this.wordPromptUI?.container.destroy(true);
    this.wordPromptUI = undefined;
    this.wordPromptReservePx = 0;
  }

  /** ตำแหน่งกลางกรอบรูปคำถาม — ใต้ HUD */
  private getWordPromptMediaCenterY(ui = createHudScaleCtx(this.scale.width, this.scale.height, this.mobile)) {
    const frameHalfH = getQuestionMediaFrameHalfH(this.mobile, ui.px.bind(ui), this.scale.width, true, this.scale.height);
    return getQuestionMediaCenterYBelowAnchor(this.getHudSafeTop(), frameHalfH, this.mobile, ui.px.bind(ui));
  }

  private hideWordPrompt() {
    const ui = this.wordPromptUI;
    if (!ui?.container?.active || !ui.container.visible) return;
    this.wordPromptReservePx = 0;
    this.tweens.killTweensOf(ui.container);
    this.tweens.add({
      targets: ui.container,
      alpha: 0,
      scale: 0.92,
      duration: 180,
      ease: "Cubic.easeIn",
      onComplete: () => this.destroyWordPrompt(),
    });
  }

  private layoutWordPrompt(q: AnagramQuestion) {
    this.destroyWordPrompt();

    const imageKey = this.getAnagramTexKey(q.image_word);
    const soundUrl = this.resolveAssetUrl(q.sound_word);
    const hasSound = !!(soundUrl && this.anagramAudioByUrl.has(soundUrl));
    if (!imageKey && !hasSound) return;

    const { width } = this.scale;
    const ui = createHudScaleCtx(width, this.scale.height, this.mobile);
    const centerX = width / 2;
    const centerY = this.getWordPromptMediaCenterY(ui);
    const container = this.add.container(centerX, centerY).setDepth(12).setScrollFactor(0);

    const imgTex = imageKey
      ? (this.textures.get(imageKey).getSourceImage() as { width?: number; height?: number })
      : undefined;
    const layout = computeQuestionMediaLayout({
      mobile: this.mobile,
      px: ui.px.bind(ui),
      screenWidth: width,
      screenHeight: this.scale.height,
      mediaCenterX: 0,
      mediaCenterY: 0,
      hasImage: !!imageKey,
      hasSound,
      imageTexW: imgTex?.width,
      imageTexH: imgTex?.height,
    });
    if (!layout) return;

    const border = this.add.graphics();
    drawQuestionMediaFrameBox(border, layout.frameW, layout.frameH);
    container.add(border);

    let qImg: Phaser.GameObjects.Image | undefined;
    if (layout.showImage && imageKey) {
      qImg = this.add
        .image(layout.imageCenterX, layout.imageCenterY, imageKey)
        .setOrigin(0.5)
        .setDisplaySize(layout.imageW, layout.imageH);
      container.add(qImg);
    }

    this.wordPromptUI = { container, imageBorder: border, image: qImg };

    if (layout.showSound) {
      const btn = this.add
        .image(layout.speakerX, layout.speakerY, HUD_VOLUME_TEXTURE_KEY)
        .setDisplaySize(layout.speakerSize, layout.speakerSize)
        .setInteractive({ useHandCursor: true });
      btn.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
        (pointer.event as unknown as { stopPropagation?: () => void })?.stopPropagation?.();
        this.tweens.add({
          targets: btn,
          scale: { from: btn.scale, to: btn.scale * 0.88 },
          yoyo: true,
          duration: 90,
        });
        this.playAnagramUrlAudio(q.sound_word, 1);
      });
      container.add(btn);
      this.wordPromptUI.speakerBtn = btn;
    }

    const gapBelow = ui.px(this.mobile ? 10 : 14);
    this.wordPromptReservePx =
      centerY - this.getHudSafeTop() + layout.frameH / 2 + gapBelow;
  }

  private fitTexture(key: string, maxW: number, maxH: number) {
    const src = this.textures.get(key).getSourceImage() as { width?: number; height?: number };
    const w = src?.width ?? 1;
    const h = src?.height ?? 1;
    const s = Math.min(maxW / w, maxH / h);
    return { w: Math.max(1, w * s), h: Math.max(1, h * s) };
  }

  private drawSlotBox(box: Phaser.GameObjects.Graphics, tileW: number, tileH: number, mode: "normal" | "hover" | "correct") {
    const radius = this.mobile ? 8 : 12;
    const line = 0xD9B17D;
    const fill = mode === "correct" ? 0xDDF6D7 : mode === "hover" ? 0xA65206 : 0xFBE9CB;
    box.clear();
    box.fillStyle(fill, 1);
    box.lineStyle(this.mobile ? 2 : 4, line, 1);
    box.fillRoundedRect(-tileW / 2, -tileH / 2, tileW, tileH, radius);
    box.strokeRoundedRect(-tileW / 2, -tileH / 2, tileW, tileH, radius);
  }

  private drawTokenBorder(border: Phaser.GameObjects.Graphics, tileW: number, tileH: number, mode: "normal" | "correct" | "wrong") {
    const radius = this.mobile ? 4 : 8;
    border.clear();
    if (mode === "normal") return;
    const color = mode === "wrong" ? 0xFF4D4D : 0x5CE355;
    const lineWidth = mode === "correct" ? this.mobile ? 4 : 6 : this.mobile ? 2 : 4;
    border.lineStyle(lineWidth, color, 1);
    border.strokeRoundedRect(-tileW / 2, -tileH / 2, tileW, tileH, radius);
  }

  private bringToFront(obj: Phaser.GameObjects.GameObject) {
    const parent = this.playArea?.container;
    if (!parent) return;
    parent.bringToTop(obj);
  }

  private animateTokenHover(token: AnagramTokenView, hovering: boolean) {
    if (token.locked) return;
    if (token.container.getData("dragging")) return;
    if (token.container.getData("animating")) return;
    this.tweens.killTweensOf(token.container);
    if (hovering) this.bringToFront(token.container);
    this.tweens.add({
      targets: token.container,
      scale: hovering ? 1.06 : 1,
      duration: 120,
      ease: "Cubic.easeOut",
    });
  }

  private animateTokenReturn(token: AnagramTokenView) {
    this.tweens.killTweensOf(token.container);
    token.container.setData("animating", true);
    const count = Math.max(1, this.topSlots.length);
    const layout = this.getBoardLayout(count);
    this.drawTokenBorder(token.border, layout.tileW, layout.tileH, "normal");
    this.tweens.add({
      targets: token.container,
      x: token.homeX,
      y: token.homeY,
      scale: 1,
      duration: 260,
      ease: "Back.easeOut",
      easeParams: [2.6],
      onComplete: () => {
        token.container.setDepth(1220);
        token.container.setData("animating", false);
      },
    });
  }

  private animateWrongDrop(token: AnagramTokenView) {
    this.tweens.killTweensOf(token.container);
    token.container.setData("animating", true);
    const count = Math.max(1, this.topSlots.length);
    const layout = this.getBoardLayout(count);
    this.drawTokenBorder(token.border, layout.tileW, layout.tileH, "wrong");
    this.tweens.add({
      targets: token.container,
      x: token.container.x + (this.mobile ? 10 : 14),
      duration: 55,
      ease: "Sine.easeInOut",
      yoyo: true,
      repeat: 3,
      onComplete: () => this.animateTokenReturn(token),
    });
  }

  private snapTokenCorrect(token: AnagramTokenView, slot: AnagramSlotView) {
    this.tweens.killTweensOf(token.container);
    token.container.setData("animating", false);
    token.container.setDepth(1220);
    token.container.setPosition(slot.container.x, slot.container.y);
    token.container.setScale(1);
    const count = Math.max(1, this.topSlots.length);
    const layout = this.getBoardLayout(count);
    this.drawTokenBorder(token.border, layout.tileW, layout.tileH, "correct");
    this.drawSlotBox(slot.box, layout.tileW, layout.tileH, "correct");
  }

  private animateCorrectDrop(token: AnagramTokenView, slot: AnagramSlotView) {
    this.tweens.killTweensOf(token.container);
    token.container.setData("animating", true);
    token.container.setDepth(1225);
    const count = Math.max(1, this.topSlots.length);
    const layout = this.getBoardLayout(count);
    this.drawTokenBorder(token.border, layout.tileW, layout.tileH, "correct");
    this.drawSlotBox(slot.box, layout.tileW, layout.tileH, "correct");
    this.tweens.add({
      targets: token.container,
      x: slot.container.x,
      y: slot.container.y,
      duration: 220,
      ease: "Back.easeOut",
      easeParams: [2.8],
      onComplete: () => {
        token.container.setScale(1);
        this.tweens.add({
          targets: token.container,
          scale: 1.12,
          duration: 110,
          ease: "Cubic.easeOut",
          yoyo: true,
          onComplete: () => token.container.setData("animating", false),
        });
      },
    });
  }

  private animateQuestionIn() {
    if (!this.playArea) return;
    const offsetY = this.mobile ? 34 : 44;
    const introDepth = 1185;

    const introTargets: Phaser.GameObjects.GameObject[] = [];
    for (const slot of this.topSlots) {
      slot.container.setAlpha(0);
      slot.container.y += offsetY;
      slot.container.setScale(0.92);
      slot.container.setDepth(introDepth);
      introTargets.push(slot.container);
    }
    for (const token of this.tokens) {
      token.container.setAlpha(0);
      token.container.y += offsetY;
      token.container.setScale(0.92);
      token.container.setDepth(introDepth);
      token.container.setData("animating", true);
      introTargets.push(token.container);
    }

    const slotTweenTargets = this.topSlots.map((s) => s.container);
    const tokenTweenTargets = this.tokens.map((t) => t.container);

    this.tweens.add({
      targets: slotTweenTargets,
      alpha: 1,
      y: `-=${offsetY}`,
      scale: 1,
      duration: 320,
      ease: "Back.easeOut",
      easeParams: [2.4],
      delay: this.tweens.stagger(26, { start: 0 }),
      onComplete: () => {
        for (const slot of this.topSlots) {
          slot.container.setDepth(1210);
        }
      },
    });

    this.tweens.add({
      targets: tokenTweenTargets,
      alpha: 1,
      y: `-=${offsetY}`,
      scale: 1,
      duration: 360,
      ease: "Back.easeOut",
      easeParams: [2.6],
      delay: this.tweens.stagger(26, { start: 80 }),
      onComplete: () => {
        for (const token of this.tokens) {
          token.container.setDepth(1220);
          token.container.setData("animating", false);
        }
      },
    });
  }

  private animateQuestionOut(onComplete?: () => void) {
    if (!this.playArea) {
      onComplete?.();
      return;
    }
    const targets: Phaser.GameObjects.GameObject[] = [];
    const alphaOnly: Phaser.GameObjects.GameObject[] = [];
    this.playArea.topBox.setDepth(1201);
    this.playArea.bottomBox.setDepth(1201);
    this.playArea.bottomTitle.setDepth(1201);
    targets.push(this.playArea.topBox, this.playArea.bottomBox);
    alphaOnly.push(this.playArea.bottomTitle);
    for (const slot of this.topSlots) {
      this.tweens.killTweensOf(slot.container);
      slot.container.setDepth(1210);
      slot.dropZone.setActive(false);
      targets.push(slot.container);
    }
    for (const token of this.tokens) {
      this.tweens.killTweensOf(token.container);
      token.container.setData("animating", true);
      token.container.disableInteractive();
      targets.push(token.container);
    }
    let remaining = alphaOnly.length > 0 ? 2 : 1;
    const done = () => {
      remaining -= 1;
      if (remaining > 0) return;
      for (const token of this.tokens) {
        token.container.setData("animating", false);
      }
      onComplete?.();
    };
    this.tweens.add({
      targets,
      alpha: 0,
      scale: 0.96,
      duration: 500,
      ease: "Cubic.easeIn",
      onComplete: done,
    });
    if (alphaOnly.length > 0) {
      this.tweens.add({
        targets: alphaOnly,
        alpha: 0,
        duration: 500,
        ease: "Cubic.easeIn",
        onComplete: done,
      });
    }
  }

  private animateBridgeTransition(isLastQuestion: boolean, onComplete: () => void) {
    if (!this.playArea) {
      onComplete();
      return;
    }
    const bridge = this.createBridgeOverlay();
    this.tweens.killTweensOf(bridge);
    const baseScale = Number(bridge.getData("baseScale")) || bridge.scaleX || 1;

    const startTransition = () => {
      this.time.delayedCall(isLastQuestion ? 1200 : 1000, () => {
        if (!this.bridgeUI) {
          onComplete();
          return;
        }

        if (isLastQuestion) {
          this.tweens.add({
            targets: bridge,
            alpha: 0,
            duration: 460,
            ease: "Cubic.easeIn",
            onComplete: () => {
              bridge.destroy();
              this.bridgeUI = undefined;
              onComplete();
            },
          });
          return;
        }

        this.tweens.add({
          targets: bridge,
          alpha: 0.35,
          duration: 200,
          ease: "Sine.easeInOut",
          yoyo: true,
          repeat: 2,
          onComplete: () => {
            this.tweens.add({
              targets: bridge,
              alpha: 0,
              duration: 300,
              ease: "Cubic.easeIn",
              onComplete: () => {
                bridge.destroy();
                this.bridgeUI = undefined;
                onComplete();
              },
            });
          },
        });
      });
    };

    const alreadyVisible = bridge.alpha > 0.05;
    if (alreadyVisible) {
      bridge.setAlpha(1);
      bridge.setScale(baseScale);
      startTransition();
      return;
    }

    bridge.setAlpha(0);
    bridge.setScale(baseScale * 0.94);
    this.tweens.add({
      targets: bridge,
      alpha: 1,
      scale: baseScale,
      duration: 500,
      ease: "Cubic.easeOut",
      onComplete: startTransition,
    });
  }

  private getHudSafeTop() {
    const baseSafeTop = this.mobile ? 140 : 120;
    const padding = this.mobile ? 14 : 18;
    let maxBottom = 0;
    const candidates = [this.timeUI?.container, this.scoreUI?.container, this.titleUI?.container];
    for (const container of candidates) {
      if (!container || !container.active || !container.visible) continue;
      const b = container.getBounds();
      if (Number.isFinite(b.bottom)) maxBottom = Math.max(maxBottom, b.bottom);
    }
    return Math.max(baseSafeTop, Math.ceil(maxBottom + padding));
  }

  private getBoardLayout(count: number) {
    const safe = this.getAnagramSafeArea();
    const width = safe.width;
    const height = safe.height;
    const ui = createHudScaleCtx(width, height, this.mobile);
    const compact = this.mobile ? getMobileCompactUiScale(height, width) : 1;
    const maxPanelW = Math.floor(width * (this.mobile ? 0.94 : 0.9));
    const tileSize = this.mobile ? width * 0.13 * compact : ui.px(102);
    const tileW = tileSize;
    const tileH = tileSize;
    const gapX = this.mobile ? 8 : ui.px(22);
    const gapY = this.mobile ? 10 : ui.px(22);
    const paddingX = this.mobile ? 18 : ui.px(32);
    const paddingY = this.mobile ? 18 : ui.px(32);
    const betweenBoxesBase = this.mobile ? height * 0.075 : height * 0.1;

    const safeCount = Math.max(1, count);
    const maxCols = Math.max(1, Math.floor((maxPanelW - paddingX * 2 + gapX) / (tileW + gapX)));
    const cols = Math.max(1, Math.min(safeCount, maxCols));
    const rows = Math.max(1, Math.ceil(safeCount / cols));
    const panelW = Math.min(maxPanelW, cols * tileW + (cols - 1) * gapX + paddingX * 2);
    const gridH = rows * tileH + (rows - 1) * gapY;
    const panelH = gridH + paddingY * 2;

    const mobileBoardOffsetY = this.mobile ? mobileCompactPx(56, height, width) : 0;
    const safeTop =
      Math.max(safe.y, this.getHudSafeTop()) +
      this.wordPromptReservePx +
      mobileBoardOffsetY;
    const safeBottom = this.mobile ? mobileCompactPx(120, height, width) : 140;
    const maxBottom = safe.y + height - safeBottom;
    const minBetweenBoxes = this.mobile ? 16 : ui.px(24);
    let betweenBoxes = betweenBoxesBase;
    let topCenterY = safeTop + panelH / 2;
    let bottomCenterY = topCenterY + panelH + betweenBoxes;

    if (!this.mobile) {
      const availableH = Math.max(0, maxBottom - safeTop);
      const idealTotalH = panelH * 2 + betweenBoxes;
      if (idealTotalH > availableH) {
        const overflow = idealTotalH - availableH;
        betweenBoxes = Math.max(minBetweenBoxes, betweenBoxes - overflow);
      }
      const totalH = panelH * 2 + betweenBoxes;
      const offsetY = Math.max(0, (availableH - totalH) / 2);
      topCenterY = safeTop + offsetY + panelH / 2;
      bottomCenterY = topCenterY + panelH + betweenBoxes;
    } else {
      bottomCenterY = topCenterY + panelH + betweenBoxes;
      const bottomEdge = bottomCenterY + panelH / 2;
      if (bottomEdge > maxBottom) {
        const overflow = bottomEdge - maxBottom;
        betweenBoxes = Math.max(minBetweenBoxes, betweenBoxes - overflow);
        bottomCenterY = topCenterY + panelH + betweenBoxes;
      }
    }

    const startX = -panelW / 2 + paddingX + tileW / 2;
    const topStartY = topCenterY - panelH / 2 + paddingY + tileH / 2;
    const bottomStartY = bottomCenterY - panelH / 2 + paddingY + tileH / 2;

    return {
      safeX: safe.x,
      safeY: safe.y,
      width,
      height,
      panelW,
      panelH,
      topCenterY,
      bottomCenterY,
      tileW,
      tileH,
      gapX,
      gapY,
      cols,
      rows,
      startX,
      topStartY,
      bottomStartY,
    };
  }

  private layoutAnagramBoard() {
    if (!this.playArea) return;
    const safe = this.getAnagramSafeArea();
    const width = safe.width;
    const height = safe.height;
    const radius = this.mobile ? 20 : 24;

    this.playArea.container.setPosition(safe.x + width / 2, 0);

    const question = this.questions[this.currentQuestionIndex];
    const count = Math.max(1, question?.swap_word?.length ?? 1);
    const layout = this.getBoardLayout(count);

    this.playArea.topBox.clear();
    this.playArea.topBox.fillStyle(0xFCF2DD);
    this.playArea.topBox.lineStyle(4, 0xA65206, 1);
    this.playArea.topBox.fillRoundedRect(-layout.panelW / 2, layout.topCenterY - layout.panelH / 2, layout.panelW, layout.panelH, radius);
    this.playArea.topBox.strokeRoundedRect(-layout.panelW / 2, layout.topCenterY - layout.panelH / 2, layout.panelW, layout.panelH, radius);

    this.playArea.bottomBox.clear();
    this.playArea.bottomBox.fillStyle(0xFCF2DD);
    this.playArea.bottomBox.lineStyle(4, 0xD09258, 1);
    this.playArea.bottomBox.fillRoundedRect(-layout.panelW / 2, layout.bottomCenterY - layout.panelH / 2, layout.panelW, layout.panelH, radius);
    this.playArea.bottomBox.strokeRoundedRect(-layout.panelW / 2, layout.bottomCenterY - layout.panelH / 2, layout.panelW, layout.panelH, radius);

    const titleMaxW = this.mobile ? width * 0.6 : width * 0.4;
    const titleMaxH = this.mobile ? height * 0.075 : height * 0.1;
    const titleSize = this.fitTexture("title_swap_word", titleMaxW, titleMaxH);
    this.playArea.bottomTitle.setDisplaySize(titleSize.w, titleSize.h);
    this.playArea.bottomTitle.setPosition(0, layout.bottomCenterY - layout.panelH / 2 - titleSize.h * 0.25);

    const fullRowW = layout.cols * layout.tileW + (layout.cols - 1) * layout.gapX;
    const offsetForRow = (rowItemCount: number) => {
      const safe = Math.max(1, Math.min(layout.cols, Math.floor(rowItemCount)));
      const rowW = safe * layout.tileW + (safe - 1) * layout.gapX;
      return (fullRowW - rowW) / 2;
    };

    for (let i = 0; i < this.topSlots.length; i++) {
      const row = Math.floor(i / layout.cols);
      const col = i % layout.cols;
      const remaining = Math.max(0, count - row * layout.cols);
      const rowCount = Math.max(1, Math.min(layout.cols, remaining));
      const x = layout.startX + offsetForRow(rowCount) + col * (layout.tileW + layout.gapX);
      const y = layout.topStartY + row * (layout.tileH + layout.gapY);
      const slot = this.topSlots[i];
      slot.container.setPosition(x, y);
      slot.dropZone.setPosition(x, y);
      if (slot.occupiedBy) {
        slot.occupiedBy.container.setPosition(x, y);
      }
    }

    for (let i = 0; i < this.tokens.length; i++) {
      const row = Math.floor(i / layout.cols);
      const col = i % layout.cols;
      const remaining = Math.max(0, count - row * layout.cols);
      const rowCount = Math.max(1, Math.min(layout.cols, remaining));
      const x = layout.startX + offsetForRow(rowCount) + col * (layout.tileW + layout.gapX);
      const y = layout.bottomStartY + row * (layout.tileH + layout.gapY);
      const token = this.tokens[i];
      if (token.locked) continue;
      token.homeX = x;
      token.homeY = y;
      const dragging = Boolean(token.container.getData("dragging"));
      const animating = Boolean(token.container.getData("animating"));
      if (!dragging && !animating) {
        token.container.setPosition(x, y);
      }
    }

  }

  private renderQuestion(index: number) {
    if (!this.playArea) return;
    const question = this.questions[index];
    const raw = this.rawQuestions[index];
    if (!question) return;

    this.currentQuestionIndex = index;
    this.layoutAnagramHudStats();

    if (raw) this.syncGameAudioFromQuestion(raw);

    this.bridgeUI?.destroy();
    this.bridgeUI = undefined;
    this.playArea.topBox.setAlpha(1).setScale(1);
    this.playArea.bottomBox.setAlpha(1).setScale(1);
    this.playArea.bottomTitle.setAlpha(1).setScale(1);
    this.clearQuestionViews();
    question.numberOfCorrectWords = 0;

    const count = Math.max(1, question.swap_word.length);
    const layout = this.getBoardLayout(count);
    const tileW = layout.tileW;
    const tileH = layout.tileH;
    const fullRowW = layout.cols * tileW + (layout.cols - 1) * layout.gapX;
    const offsetForRow = (rowItemCount: number) => {
      const safe = Math.max(1, Math.min(layout.cols, Math.floor(rowItemCount)));
      const rowW = safe * tileW + (safe - 1) * layout.gapX;
      return (fullRowW - rowW) / 2;
    };

    const expectedTokens = this.resolveExpectedTokens(question.word, question.swap_word);

    for (let i = 0; i < count; i++) {
      const row = Math.floor(i / layout.cols);
      const col = i % layout.cols;
      const remaining = Math.max(0, count - row * layout.cols);
      const rowCount = Math.max(1, Math.min(layout.cols, remaining));
      const x = layout.startX + offsetForRow(rowCount) + col * (tileW + layout.gapX);
      const y = layout.topStartY + row * (tileH + layout.gapY);
      const dropPad = Math.floor(Math.min(tileW, tileH) * 0.35);
      const zone = this.add.zone(x, y, tileW + dropPad * 2, tileH + dropPad * 2).setDepth(1205);
      zone.setRectangleDropZone(tileW + dropPad * 2, tileH + dropPad * 2);
      zone.setData("slotIndex", i);
      const slotBox = this.add.graphics();
      this.drawSlotBox(slotBox, tileW, tileH, "normal");
      const slotContainer = this.add.container(x, y, [slotBox]).setDepth(1210);
      slotContainer.setSize(tileW, tileH);
      slotContainer.setScale(1);
      this.playArea.container.add([zone, slotContainer]);
      this.topSlots.push({ expected: expectedTokens[i] ?? "", container: slotContainer, dropZone: zone, box: slotBox });
    }

    const shuffledSwapWord = Phaser.Utils.Array.Shuffle([...question.swap_word]);
    for (let i = 0; i < count; i++) {
      const row = Math.floor(i / layout.cols);
      const col = i % layout.cols;
      const remaining = Math.max(0, count - row * layout.cols);
      const rowCount = Math.max(1, Math.min(layout.cols, remaining));
      const x = layout.startX + offsetForRow(rowCount) + col * (tileW + layout.gapX);
      const y = layout.bottomStartY + row * (tileH + layout.gapY);
      const value = shuffledSwapWord[i] ?? "";
      const tokenBg = this.add.image(0, 0, "bg_swap_word").setOrigin(0.5, 0.5);
      tokenBg.setDisplaySize(tileW, tileH);
      const tokenBorder = this.add.graphics();
      this.drawTokenBorder(tokenBorder, tileW, tileH, "normal");
      const label = this.add
        .text(0, 0, value, {
          fontSize: this.mobile ? "23px" : "36px",
          color: "#A45718",
          fontFamily: "Noto Sans Thai",
          fontStyle: "700",
          align: "center",
          padding: {
            top: 4,
            bottom: 8,
          }
        })
        .setOrigin(0.5, 0.5)
        .setLineSpacing(10)
        .setResolution(
          this.mobile
            ? Math.min(3, typeof window !== "undefined" ? window.devicePixelRatio || 2 : 2)
            : 1
        );
      const tokenContainer = this.add.container(x, y, [tokenBg, tokenBorder, label]).setDepth(1220);
      tokenContainer.setSize(tileW, tileH);
      tokenContainer.setScale(1);
      tokenContainer.setInteractive({ draggable: true, useHandCursor: true });
      this.input.setDraggable(tokenContainer, true);
      const token: AnagramTokenView = { value, container: tokenContainer, bg: tokenBg, border: tokenBorder, label, homeX: x, homeY: y, dragOffsetX: 0, dragOffsetY: 0, locked: false };
      tokenContainer.setData("anagramToken", token);
      tokenContainer.setData("dragging", false);
      tokenContainer.setData("animating", false);
      tokenContainer.on("pointerover", () => this.animateTokenHover(token, true));
      tokenContainer.on("pointerout", () => this.animateTokenHover(token, false));
      this.playArea.container.add(tokenContainer);
      this.tokens.push(token);
    }

    this.bindDragHandlers();

    if (raw) {
      this.layoutWordPrompt(raw);
    }
    this.layoutAnagramBoard();

    if (raw) {
      this.presentQuestionStartHint(raw);
    }

    this.animateQuestionIn();
  }

  private bindDragHandlers() {
    this.input.off("dragstart", this.onTokenDragStart, this);
    this.input.off("drag", this.onTokenDrag, this);
    this.input.off("drop", this.onTokenDrop, this);
    this.input.off("dragenter", this.onTokenDragEnter, this);
    this.input.off("dragleave", this.onTokenDragLeave, this);
    this.input.off("dragend", this.onTokenDragEnd, this);
    this.input.on("dragstart", this.onTokenDragStart, this);
    this.input.on("drag", this.onTokenDrag, this);
    this.input.on("drop", this.onTokenDrop, this);
    this.input.on("dragenter", this.onTokenDragEnter, this);
    this.input.on("dragleave", this.onTokenDragLeave, this);
    this.input.on("dragend", this.onTokenDragEnd, this);
  }

  private onTokenDragStart(
    pointer: Phaser.Input.Pointer,
    gameObject: Phaser.GameObjects.GameObject
  ) {
    const token = this.getTokenFromObject(gameObject);
    if (!token || token.locked) return;
    if (token.container.getData("animating")) return;
    this.playSfx("sfx_click", 1);
    token.container.setData("dragging", true);
    token.container.setData("animating", false);
    this.tweens.killTweensOf(token.container);
    token.container.setScale(1.06);
    const parent = this.playArea?.container;
    if (parent) {
      const m = parent.getWorldTransformMatrix();
      const local = new Phaser.Math.Vector2();
      m.applyInverse(pointer.x, pointer.y, local);
      token.dragOffsetX = token.container.x - local.x;
      token.dragOffsetY = token.container.y - local.y;
    }
    this.bringToFront(token.container);
  }

  private onTokenDrag(
    pointer: Phaser.Input.Pointer,
    gameObject: Phaser.GameObjects.GameObject,
    dragX: number,
    dragY: number
  ) {
    const token = this.getTokenFromObject(gameObject);
    if (!token || token.locked) return;
    const parent = this.playArea?.container;
    if (!parent) {
      token.container.setPosition(dragX, dragY);
      return;
    }
    const m = parent.getWorldTransformMatrix();
    const local = new Phaser.Math.Vector2();
    m.applyInverse(pointer.x, pointer.y, local);
    token.container.setPosition(local.x + token.dragOffsetX, local.y + token.dragOffsetY);
  }

  private resetHoverSlot() {
    const idx = this.hoveringSlotIndex;
    if (idx === null) return;
    const slot = this.topSlots[idx];
    if (slot && !slot.occupiedBy) {
      const count = Math.max(1, this.topSlots.length);
      const layout = this.getBoardLayout(count);
      this.drawSlotBox(slot.box, layout.tileW, layout.tileH, "normal");
      slot.container.setScale(1);
      slot.container.setDepth(1210);
    }
    this.hoveringSlotIndex = null;
  }

  private onTokenDragEnter(
    _pointer: Phaser.Input.Pointer,
    gameObject: Phaser.GameObjects.GameObject,
    dropZone: Phaser.GameObjects.GameObject
  ) {
    const token = this.getTokenFromObject(gameObject);
    if (!token || token.locked) return;
    const slotIndex = Number((dropZone as Phaser.GameObjects.GameObject).getData("slotIndex"));
    const slot = this.topSlots[slotIndex];
    if (!slot || slot.occupiedBy) return;
    this.resetHoverSlot();
    this.hoveringSlotIndex = slotIndex;
    const count = Math.max(1, this.topSlots.length);
    const layout = this.getBoardLayout(count);
    this.drawSlotBox(slot.box, layout.tileW, layout.tileH, "hover");
    this.tweens.killTweensOf(slot.container);
    this.tweens.add({
      targets: slot.container,
      scale: 1.04,
      duration: 120,
      ease: "Cubic.easeOut",
    });
  }

  private onTokenDragLeave(
    _pointer: Phaser.Input.Pointer,
    gameObject: Phaser.GameObjects.GameObject,
    dropZone: Phaser.GameObjects.GameObject
  ) {
    const token = this.getTokenFromObject(gameObject);
    if (!token || token.locked) return;
    const slotIndex = Number((dropZone as Phaser.GameObjects.GameObject).getData("slotIndex"));
    const slot = this.topSlots[slotIndex];
    if (!slot || slot.occupiedBy) return;
    if (this.hoveringSlotIndex !== slotIndex) return;
    const count = Math.max(1, this.topSlots.length);
    const layout = this.getBoardLayout(count);
    this.drawSlotBox(slot.box, layout.tileW, layout.tileH, "normal");
    this.tweens.killTweensOf(slot.container);
    this.tweens.add({
      targets: slot.container,
      scale: 1,
      duration: 120,
      ease: "Cubic.easeOut",
    });
    slot.container.setDepth(1210);
    this.hoveringSlotIndex = null;
  }

  private onTokenDrop(
    pointer: Phaser.Input.Pointer,
    gameObject: Phaser.GameObjects.GameObject,
    dropZone: Phaser.GameObjects.GameObject
  ) {
    const token = this.getTokenFromObject(gameObject);
    if (!token || token.locked) return;
    token.container.setData("dragging", false);
    this.resetHoverSlot();
    const slotIndex = Number((dropZone as Phaser.GameObjects.GameObject).getData("slotIndex"));
    const slot = this.topSlots[slotIndex];
    if (!slot || slot.occupiedBy) {
      this.animateTokenReturn(token);
      return;
    }
    const isCorrect = token.value === slot.expected;
    if (!isCorrect) {
      const raw = this.rawQuestions[this.currentQuestionIndex];
      if (raw && this.hasAnagramQuestionHint(raw)) {
        this.showAnagramQuestionHint(raw);
        this.time.delayedCall(200, () => this.playAnagramHintSound(raw));
      } else {
        this.showRandomMessage(this.messagePools.wrong, 2200, "point");
      }
      this.playSfx("sfx_incorrect", 1);
      const question = this.questions[this.currentQuestionIndex];
      if (question) question.hadWrong = true;
      this.score -= 1;
      this.onScoreDecreased();
      void (async () => {
        const minusDone = this.showScoreFlyText("-1", undefined, undefined, this.colorToCss(0xff0076));
        await minusDone;
        if (!this.sys.isActive()) return;
        this.showScore = this.score;
        this.updateHud();
        await this.animateScoreHudWrong();
      })();
      this.animateWrongDrop(token);
      return;
    }

    token.locked = true;
    slot.occupiedBy = token;
    token.container.disableInteractive();

    const question = this.questions[this.currentQuestionIndex];
    const willCompleteQuestion = question.numberOfCorrectWords + 1 >= question.length;

    if (willCompleteQuestion) {
      this.hideWordPrompt();
      this.playSfx("sfx_correct", 1);
      this.animateCorrectDrop(token, slot);
      this.lastScoreChangeMs = Date.now();
      this.idleNoScoreMessageShown = false;
      question.numberOfCorrectWords += 1;
      this.correctWords += 1;

      const isLastQuestion = this.currentQuestionIndex >= this.numberOfQuestions - 1;
      if (isLastQuestion) this.freezeHudTime();
      else this.pauseHudTime();
      this.lockInput = true;
      this.input.enabled = false;
      this.time.delayedCall(420, () => {
        void (async () => {
          await this.awardQuestionScore();
          if (!this.sys.isActive()) return;
          this.goToNextQuestion();
        })();
      });
      return;
    }

    this.snapTokenCorrect(token, slot);
    question.numberOfCorrectWords += 1;
    this.correctWords += 1;
    this.lastScoreChangeMs = Date.now();
    this.idleNoScoreMessageShown = false;
  }

  private onTokenDragEnd(
    _pointer: Phaser.Input.Pointer,
    gameObject: Phaser.GameObjects.GameObject,
    dropped: boolean
  ) {
    const token = this.getTokenFromObject(gameObject);
    if (!token || token.locked) return;
    token.container.setData("dragging", false);
    if (!dropped) this.animateTokenReturn(token);
  }

  private getTokenFromObject(gameObject: Phaser.GameObjects.GameObject): AnagramTokenView | undefined {
    if (!(gameObject instanceof Phaser.GameObjects.Container)) return undefined;
    return gameObject.getData("anagramToken") as AnagramTokenView | undefined;
  }

  private goToNextQuestion() {
    if (!this.gameStarted) return;
    this.reportRunstateQuestionCompleted(this.currentQuestionIndex + 1);
    const isLastQuestion = this.currentQuestionIndex >= this.numberOfQuestions - 1;
    if (isLastQuestion) {
      this.showRandomMessage(this.messagePools.done, 2200, "clap");
    } else {
      this.showRandomMessage(this.messagePools.correctAll, 2200, "clap");
    }
    this.lockInput = true;
    this.input.enabled = false;
    this.animateQuestionOut(() => {
      if (isLastQuestion) {
        this.showBridgeHold(() => {
          this.playEndCutscene(() => {
            this.endGame();
          });
        });
        return;
      }

      this.currentQuestionIndex += 1;
      this.renderQuestion(this.currentQuestionIndex);
      this.resumeHudTime();
      this.lockInput = false;
      this.input.enabled = true;
    });
  }

  private resolveExpectedTokens(word: string, sourceTokens: string[]): string[] {
    const cleanedWord = (word ?? "").trim();
    const tokens = sourceTokens.filter((t) => typeof t === "string" && t.trim().length > 0).map((t) => t.trim());
    if (tokens.length === 0) return [];
    if (tokens.join("") === cleanedWord) return tokens;

    const remaining = new Map<string, number>();
    for (const token of tokens) {
      remaining.set(token, (remaining.get(token) ?? 0) + 1);
    }
    const sorted = [...remaining.keys()].sort((a, b) => b.length - a.length);
    const result: string[] = [];
    let cursor = 0;

    while (cursor < cleanedWord.length) {
      const candidate = sorted.find((token) => (remaining.get(token) ?? 0) > 0 && cleanedWord.startsWith(token, cursor));
      if (!candidate) return tokens;
      result.push(candidate);
      remaining.set(candidate, (remaining.get(candidate) ?? 0) - 1);
      cursor += candidate.length;
    }

    if (result.length !== tokens.length) return tokens;
    return result;
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
    if (!this.introDecor) {
      this.createIntroDecor(width, height);
    } else {
      this.layoutIntroDecor(width, height);
    }
    if (this.introDecor) this.introDecor.title.setVisible(false);

    const fitTo = (key: string, maxW: number, maxH: number) => {
      const src = this.textures.get(key).getSourceImage() as { width?: number; height?: number };
      const w = src?.width ?? 1;
      const h = src?.height ?? 1;
      const s = Math.min(maxW / w, maxH / h);
      return { w: Math.max(1, w * s), h: Math.max(1, h * s) };
    };

    const titleIconSize = fitTo("anagram_icon_howtoplay", this.mobile ? width * 0.86 : width * 0.36, this.mobile ? height * 0.86 : height * 0.3);
    const title = this.add.image(width / 2, this.mobile ? height / 6 : height / 8, "anagram_icon_howtoplay").setDepth(3001);
    title.setDisplaySize(titleIconSize.w, titleIconSize.h);

    const howToMaxH = this.mobile ? height * 0.62 : height * 0.58;
    const howToSize = fitTo("anagram_howtoplay", this.mobile ? width * 0.92 : width * 0.88, howToMaxH);
    const howToY = this.mobile ? height / 2 - height * 0.055 : height / 2 + Math.max(12, height * 0.03);
    const howtoplay = this.add.image(width / 2, howToY, "anagram_howtoplay").setDepth(3003);
    howtoplay.setDisplaySize(howToSize.w, howToSize.h);

    const btnMaxW = Math.min(260, width * (0.40));
    const btnSize = fitTo("anagram_btn_start", btnMaxW, height * 0.16);
    const btnY = Math.min(height - btnSize.h / 2 - 24, howToY + howToSize.h / 2 + btnSize.h / 2 + Math.max(14, height * 0.03));
    const startButton = this.add.image(width / 2, btnY, "anagram_btn_start").setDepth(3004);
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
