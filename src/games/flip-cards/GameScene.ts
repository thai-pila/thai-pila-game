import Phaser from "phaser";
import { API_BASE_URL } from "../../core/api";
import { BaseGameScene } from "../../core/scenes/BaseGameScene";
import { createThaiTextElement, createThaiTextSpan, measureThaiTextWidth } from "../../utils/thaiText";
import { HomeActionPayload } from "../../core/scenes/HomeScene";
import { isMobileLayout } from "../../utils/device";
import { createHudScaleCtx } from "../../utils/desktopUiScale";
import {
  BG_HUD_TEXTURE_KEY,
  getGameHudPillSlots,
  getGameHudRowMetrics,
  HUD_VALUE_COLOR,
  hasHudCenterLabel,
  getHudSuggestionLabel,
  getHudCenterTextMaxFontPx,
  preloadBgHud,
  preloadHudVolume,
} from "../../core/hud/gameHudLayout";
import { layoutDomHudPill, layoutDomTimeHudPill, getDomTimeHudPillValueColor, layoutGameHudStatsDomRow, setDomLabelValueHudPillValue, setDomTimeHudPillValue, type DomHudPill } from "../../core/hud/questionProgressHud";
import { type TeacherState } from "../../core/teacher/TeacherAssistant";
import { TeacherHintUI } from "../../core/teacher/TeacherHintUI";
import {
  canPlayGameAudio,
  GAME_BGM_VOLUME,
  guardedScenePlay,
  guardedScenePlayQuestion,
  guardedScenePlayVoice,
} from "../../core/audio/sceneAudio";
import { drawQuestionMediaOverlayTextPill } from "../../utils/questionHudMedia";

type FlipCardQuestion = {
  id: number;
  id_game_info: number;
  no: number;
  keyword?: string | null;
  matching_word?: string | null;
  hint?: string | null;
  sound_keyword?: string | null;
  image_keyword?: string | null;
  sound_hint?: string | null;
  image_hint?: string | null;
  sound_matching_word?: string | null;
  image_matching_word?: string | null;
};

type FlipCardPayload = {
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
  questions: FlipCardQuestion[];
}


type MemoryCardFace = "keyword" | "matching_word";

type MemoryCardModel = {
  id: string;
  pairId: number;
  face: MemoryCardFace;
  text?: string;
  image?: string;
  sound?: string;
};

type MemoryCardView = {
  model: MemoryCardModel;
  container: Phaser.GameObjects.Container;
  visual: Phaser.GameObjects.Container;
  back: Phaser.GameObjects.Container;
  front: Phaser.GameObjects.Container;
  frontDomElements: Phaser.GameObjects.DOMElement[];
  frontBg: Phaser.GameObjects.Image;
  flipSeq: number;
  revealed: boolean;
  matched: boolean;
};

/** ฟอนต์คำตอบบนการ์ด — สั้นใหญ่ / ยาวเล็ก (แนวเดียวกับ find-the-match) */
const FLIP_CARD_ANSWER_TEXT_TUNING = {
  mobile: {
    fontTextOnly: 26,
    fontWithImage: 13,
    fontMinTextOnly: 11,
    fontMinWithImage: 10,
    fontMaxTextOnly: 38,
    fontMaxWithImage: 22,
  },
  desktop: {
    fontTextOnly: 44,
    fontWithImage: 32,
    fontMinTextOnly: 16,
    fontMinWithImage: 14,
    fontMaxTextOnly: 58,
    fontMaxWithImage: 44,
  },
} as const;

type FlipCardFaceLayout = {
  imageMaxH: number;
  pillH: number;
  pillW: number;
  speakerMaxH: number;
  gapY: number;
};

const FLIP_CARD_TEXT_PILL_HEIGHT = 75;

function resolveFlipCardFaceLayout(
  w: number,
  h: number,
  hasImage: boolean,
  hasText: boolean,
  hasSound: boolean
): FlipCardFaceLayout {
  const pillW = w * 0.86;
  const gapY = Math.max(4, Math.round(h * 0.022));
  const contentCount = (hasImage ? 1 : 0) + (hasText ? 1 : 0) + (hasSound ? 1 : 0);

  if (contentCount >= 3) {
    return {
      imageMaxH: h * 0.44,
      pillH: FLIP_CARD_TEXT_PILL_HEIGHT,
      pillW,
      speakerMaxH: h * 0.15,
      gapY,
    };
  }
  if (hasImage && hasText) {
    return {
      imageMaxH: h * 0.5,
      pillH: FLIP_CARD_TEXT_PILL_HEIGHT,
      pillW,
      speakerMaxH: 0,
      gapY,
    };
  }
  if (hasText && hasSound) {
    return {
      imageMaxH: 0,
      pillH: FLIP_CARD_TEXT_PILL_HEIGHT,
      pillW,
      speakerMaxH: h * 0.16,
      gapY,
    };
  }
  if (hasImage && hasSound) {
    return {
      imageMaxH: h * 0.56,
      pillH: 0,
      pillW,
      speakerMaxH: h * 0.16,
      gapY,
    };
  }
  if (hasImage) {
    return {
      imageMaxH: h * 0.62,
      pillH: 0,
      pillW,
      speakerMaxH: 0,
      gapY,
    };
  }
  return {
    imageMaxH: 0,
    pillH: FLIP_CARD_TEXT_PILL_HEIGHT,
    pillW,
    speakerMaxH: 0,
    gapY,
  };
}

export default class FlipCardsGameScene extends BaseGameScene {
    private cards: MemoryCardView[] = [];
    private revealedCards: MemoryCardView[] = [];
    private lockInput = false;
    private matchedPairs = 0;
    private totalPairs = 0;
    private imageKeyByUrl = new Map<string, string>();
    private imageKeySeq = 0;
    private soundKeyByUrl = new Map<string, string>();
    private soundKeySeq = 0;
    private startRequested = false;
    private assetsReady = false;
    private gameStarted = false;
    private pendingPayload?: FlipCardPayload;
    private hudTimerEvent?: Phaser.Time.TimerEvent;
    private hudStartMs = 0;
    private hudStarted = false;
    private titleUI?: {
        container: Phaser.GameObjects.Container;
        box: Phaser.GameObjects.Graphics;
        dom: Phaser.GameObjects.DOMElement;
        title: string;
    };
    private timeUI?: DomHudPill;
    private scoreUI?: DomHudPill;
    private teacherHintUI?: TeacherHintUI;
    private lastMessageShownMs = 0;
    private lastScoreChangeMs = 0;
    private idleNoScoreMessageShown = false;
    private readonly messageMilestonesSec = [15, 30, 45, 60];
    private milestoneShown = new Set<number>();
    private readonly messageCatalog: Record<string, { text: string; voice?: string }> = {
        intro_start: { text: "เริ่มเกมแล้ว! จับคู่ให้ถูกไว ๆ นะ" },
        intro_are_you_ready: { text: "พร้อมไหม มาจับคู่คำกันเลย", voice: "start_are_you_ready" },

        idle_try_one: { text: "ลองเลือกสักใบดูไหม เผื่อเจอคู่เลย", voice: "fifteen_delay_try_one" },
        idle_try_two_more: { text: "อย่าปล่อยเวลาไปนะ ลองเปิดอีกสองใบดู", voice: "fifteen_delay_try_two_more" },
        idle_hurry_up: { text: "เร่งอีกนิด เดี๋ยวก็เจอคู่แล้ว" },
        idle_pick_one: { text: "ใบไหนดีน้า ลองจิ้มดูได้เลย" },

        time_15_a: { text: "15 วินาทีผ่านไป เครื่องติดหรือยังนะ" },
        time_15_b: { text: "15 วินาทีแล้ว เริ่มจับทางได้ยังน้า" },
        time_15_c: { text: "เวลากำลังเดินนะ 15 วินาทีแล้ว" },
        time_30_a: { text: "30 วินาทีผ่านไป ไวกว่านี้ได้อีกนะ" },
        time_30_b: { text: "30 วินาทีแล้ว เร่งมือหน่อยคนเก่ง" },
        time_45_a: { text: "45 วินาทีแล้ว มีใบไหนคุ้นตาบ้างไหม" },
        time_45_b: { text: "45 วินาทีแล้ว ลองหาคำที่เหมือนกันนะ" },
        time_60_a: { text: "60 วินาทีแล้ว สู้ต่ออีกนิด!" },
        time_60_b: { text: "60 วินาทีแล้ว อย่าเพิ่งยอมน้า" },
        time_60_c: { text: "ครบนาทีแล้ว สู้ต่อ! ลุยกันเลย" },

        correct_perfect: { text: "เป๊ะมาก! จำแม่นสุด ๆ" },
        correct_sharp: { text: "ว้าว! สายตาแหลมคมมาก" },
        correct_keep_going: { text: "เก่งมาก ไปต่อเลย", voice: "correct_keep_going" },
        correct_found: { text: "สุดยอด! หาเจอจนได้" },

        wrong_try_again: { text: "ไม่เป็นไร ลองใหม่อีกครั้งนะ" },
        wrong_close: { text: "เกือบถูกแล้วเชียว สู้ ๆ" },
        wrong_breathe: { text: "หายใจเข้าลึก ๆ ลองใหม่ ๆ" },
    };

    private readonly messagePools = {
        intro: ["intro_start", "intro_are_you_ready"],
        idleNoScore15: ["idle_try_one", "idle_try_two_more", "idle_hurry_up", "idle_pick_one"],
        time: {
            15: ["time_15_a", "time_15_b", "time_15_c"],
            30: ["time_30_a", "time_30_b"],
            45: ["time_45_a", "time_45_b"],
            60: ["time_60_a", "time_60_b", "time_60_c"],
        } as Record<number, string[]>,
        correct: ["correct_perfect", "correct_sharp", "correct_keep_going", "correct_found"],
        wrong: ["wrong_try_again", "wrong_close", "wrong_breathe"],
    };
    private timeFlashEvent?: Phaser.Time.TimerEvent;
    private timeFlashSeq = 0;
    private timeBoxColor = 0xffffff;
    private timeRedLoopActive = false;
    private timeTextBaseColor = HUD_VALUE_COLOR;
    private scoreTextBaseColor = HUD_VALUE_COLOR;
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
        stars: Array<{
            obj: Phaser.GameObjects.Image;
            nx: number;
            ny: number;
            s: number;
            a0: number;
            a1: number;
            d: number;
            delay: number;
        }>;
        starBlue: Phaser.GameObjects.Image;
        starPink: Phaser.GameObjects.Image;
        starYellow: Phaser.GameObjects.Image;
        bgBlue: Phaser.GameObjects.Image;
        bgPink: Phaser.GameObjects.Image;
    };
    private tutorialPopup?: {
        titleBg: Phaser.GameObjects.Image;
        titleIcon: Phaser.GameObjects.Image;
        howToImage: Phaser.GameObjects.Image;
        startButton: Phaser.GameObjects.Image;
        restoreInputEnabled: boolean;
        restoreLockInput: boolean;
    };
    private mobile = false;

    constructor() {
        super("flip-cards");
    }

    preload() {
        this.load.image("bg_flip_cards", "assets/flip-cards/bg_flip_cards.png");
        this.load.image("bg_flip_cards_blue", "assets/flip-cards/bg_flip_cards_blue.png");
        this.load.image("bg_flip_cards_pink", "assets/flip-cards/bg_flip_cards_pink.png");
        this.load.image("question_flip_cards_blue", "assets/flip-cards/question_flip_cards_blue.png");
        this.load.image("question_flip_cards_pink", "assets/flip-cards/question_flip_cards_pink.png");
        this.load.image("btn_volumn_blue", "assets/flip-cards/btn_volumn_blue.png");
        this.load.image("btn_volumn_pink", "assets/flip-cards/btn_volumn_pink.png");
        this.load.image("star", "assets/flip-cards/star.png");
        this.load.image("star_blue", "assets/flip-cards/star_blue.png");
        this.load.image("star_pink", "assets/flip-cards/star_pink.png");
        this.load.image("star_yellow", "assets/flip-cards/star_yellow.png");
        this.load.image("main_icon", "assets/flip-cards/icon_flip_cards.png");
        preloadHudVolume(this);
        this.load.image("advicer_flip_cards", "assets/flip-cards/advicer_flip_cards.png");
        this.load.image("howtoplay_flip_cards", "assets/flip-cards/howtoplay_flip_cards.png");
        this.load.image("howtoplay_flip_cards_mobile", "assets/flip-cards/howtoplay_flip_cards_mobile.png");
        this.load.image("icon_tutorial_title", "assets/flip-cards/icon_tutorial_title.png");
        this.load.image("icon_tutorial_bg", "assets/flip-cards/icon_tutorial_bg.png");
        this.load.image("flip_cards_btn_start_tutorial", "assets/flip-cards/btn_start_tutorial.png");
        this.load.image("bg_flip_cards_mobile", "assets/flip-cards/bg_flip_cards_mobile.png");

        this.load.audio("bgm_clock_ticking_danger", "assets/sound/flip-cards/bgm_clock_ticking_danger_flip_cards.mp3");
        this.load.audio("bgm_clock_ticking_normal", "assets/sound/flip-cards/bgm_clock_ticking_normal_flip_cards.mp3");
        this.load.audio("bgm_game_scene", "assets/sound/flip-cards/bgm_game_scene_flip_cards.mp3");
        this.load.audio("bgm_result", "assets/sound/flip-cards/bgm_result_flip_cards.mp3");
        this.load.audio("bgm_start", "assets/sound/flip-cards/bgm_start_flip_cards.mp3");
        this.load.audio("sfx_alert_danger", "assets/sound/sfx_alert_danger_flip_cards.mp3");
        this.load.audio("sfx_alert_warning", "assets/sound/sfx_alert_warning_flip_cards.mp3");
        this.load.audio("sfx_click", "assets/sound/sfx_click_flip_cards.mp3");
        this.load.audio("sfx_correct", "assets/sound/sfx_correct_flip_cards.mp3");
        this.load.audio("sfx_incorrect", "assets/sound/sfx_incorrect_flip_cards.mp3");
        this.load.audio("sfx_notification_message", "assets/sound/sfx_notification_message_flip_cards.mp3");
        this.load.audio("sfx_shuffle", "assets/sound/sfx_shuffle_flip_cards.mp3");

        this.load.audio("correct_keep_going", "assets/sound/voice_over/correct_keep_going_flip_cards.mp3");
        this.load.audio("fifteen_delay_try_one", "assets/sound/voice_over/fifteen_delay_try_one_flip_cards.mp3");
        this.load.audio("fifteen_delay_try_two_more", "assets/sound/voice_over/fifteen_delay_try_two_more_flip_cards.mp3");
        this.load.audio("start_are_you_ready", "assets/sound/voice_over/start_are_you_ready_flip_cards.mp3");
        TeacherHintUI.preload(this);
        preloadBgHud(this);
    }

    async create() {
        super.create();
        this.mobile = isMobileLayout();
        this.scene.launch("HomeScene", {
            gameKey: this.scene.key,
            ui: {
                startButtonPath: "assets/flip-cards/btn_start.png",
                howToButtonPath: "assets/flip-cards/btn_howto.png",
                startButtonWidth: this.mobile ? 220 : 320, 
               howToButtonWidth: this.mobile ? 160 : 260,
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

        const { width, height } = this.scale;

        const worldWidth = width;
        const worldHeight = height;

        this.cameras.main.setBounds(0, 0, worldWidth, worldHeight);
        this.cameras.main.setScroll(0, 0);
        this.cameras.main.setBackgroundColor("#000000");

        const background = this.add.image(0, 0, this.mobile ? "bg_flip_cards_mobile" : "bg_flip_cards").setOrigin(0, 0).setDepth(0);
        background.setDisplaySize(worldWidth, worldHeight);

        this.destroyIntroDecor();
        this.createIntroDecor(worldWidth, worldHeight);

        const onResize = (gameSize: Phaser.Structs.Size) => {
            const w = gameSize.width;
            const h = gameSize.height;
            this.cameras.main.setBounds(0, 0, w, h);
            background.setDisplaySize(w, h);
            this.layoutIntroDecor(w, h);
        };
        this.scale.on(Phaser.Scale.Events.RESIZE, onResize);
        this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
            this.scale.off(Phaser.Scale.Events.RESIZE, onResize);
            this.stopAllAudio();
        });

        this.scene.get("HomeScene").events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
            this.destroyIntroDecor();
            if (!this.teacherHintUI) {
                this.teacherHintUI = new TeacherHintUI(this, {
                    mobile: this.mobile,
                    depth: 45,
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
            const payload = await this.fetchFlipCardData();
            this.pendingPayload = payload;
            await this.preloadCardImageTextures(payload);
            await this.preloadCardSoundAudio(payload);
            this.assetsReady = true;
            this.tryStartGame();
        } catch (error) {
            console.error("Failed to load flip cards data:", error);
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

    protected override getResultCorrectCount(): number {
        return this.matchedPairs;
    }

    protected override onBeforeEndGame() {
        this.setBgmState("result");
        this.input.enabled = false;
        this.lockInput = true;
        this.revealedCards = [];
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
        this.teacherHintUI?.destroy();
        this.teacherHintUI = undefined;
        this.timeFlashEvent?.destroy();
        this.timeFlashEvent = undefined;
        this.timeBoxColor = 0xffffff;
        this.timeRedLoopActive = false;
        this.timeFlashSeq = 0;
        this.cards.forEach((card) => card.container.destroy(true));
        this.cards = [];
    }

    private tryStartGame() {
        if (this.gameStarted) return;
        if (!this.startRequested) return;
        if (!this.assetsReady) return;
        if (!this.pendingPayload) return;

        this.gameStarted = true;
        const fcInfo = this.pendingPayload.game_info;
        const centerTitle = getHudSuggestionLabel(fcInfo.suggestion);
        if (hasHudCenterLabel(centerTitle)) {
            this.createTitleContainer(centerTitle);
        }
        this.createTimeContainer();
        this.createScoreContainer();
        this.hudStarted = false;
        this.hudStartMs = 0;
        this.matchedPairs = 0;
        this.score = 0;
        this.ensureHudTimer();
        this.updateHud();
        this.buildMemoryMatchingGame(this.pendingPayload);
        this.lockInput = true;
        this.input.enabled = false;
        this.reportRunstateStart();
        void this.runIntroRevealShuffleClose();
    }

    private sleep(ms: number): Promise<void> {
        return new Promise<void>((resolve) => {
            this.time.delayedCall(ms, () => resolve());
        });
    }

    private formatElapsedSeconds(seconds: number) {
        const safe = Math.max(0, Math.floor(seconds));
        const mm = Math.floor(safe / 60);
        const ss = safe % 60;
        return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
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
        const elapsed = this.hudStarted ? (Date.now() - this.hudStartMs) / 1000 : 0;
        const timeLabel = this.formatElapsedSeconds(elapsed);
        const scoreLabel = `คะแนน ${this.score}`;

        if (this.timeUI) {
            setDomTimeHudPillValue(this.timeUI, timeLabel);
        }
        if (this.scoreUI) {
            setDomLabelValueHudPillValue(this.scoreUI, String(this.score));
        }
        this.updateTimedMessages(elapsed);
        this.updateTickingByElapsed(elapsed);
    }

    private tweenCardsToPositions(
        cards: MemoryCardView[],
        positions: Array<{ x: number; y: number }>,
        duration: number,
        maxDelay: number = 100,
        ease: string = "Cubic.easeInOut",
    ): Promise<void> {
        return new Promise<void>((resolve) => {
            if (cards.length === 0) {
                resolve();
                return;
            }

            let remaining = cards.length;
            for (let i = 0; i < cards.length; i++) {
                const card = cards[i];
                const pos = positions[i];
                this.tweens.add({
                    targets: card.container,
                    x: pos.x,
                    y: pos.y,
                    duration,
                    delay: Phaser.Math.Between(0, maxDelay),
                    ease,
                    onComplete: () => {
                        remaining -= 1;
                        if (remaining <= 0) resolve();
                    },
                });
            }
        });
    }

    private async runIntroRevealShuffleClose() {
        if (!this.sys.isActive()) return;
        if (this.cards.length === 0) {
            this.lockInput = false;
            this.input.enabled = true;
            return;
        }

        this.revealedCards = [];
        this.lockInput = true;
        this.input.enabled = false;

        for (const card of this.cards) {
            this.tweens.killTweensOf(card.container);
            card.container.setScale(1);
            card.container.setDepth(5);
        }

        for (let i = 0; i < this.cards.length; i++) {
            const card = this.cards[i];
            card.revealed = true;
            this.flipCard(card, true);
            await this.sleep(35);
        }

        await this.sleep(450);
        this.playSfx("sfx_shuffle", 1);
        
        const positions = this.cards.map((c) => ({ x: c.container.x, y: c.container.y }));
        const shuffled1 = Phaser.Utils.Array.Shuffle([...positions]);
        await this.tweenCardsToPositions(this.cards, shuffled1, 400, 100);
        await this.sleep(100);
        const shuffled2 = Phaser.Utils.Array.Shuffle([...positions]);
        await this.tweenCardsToPositions(this.cards, shuffled2, 350, 80);
        await this.sleep(80);
        const shuffled3 = Phaser.Utils.Array.Shuffle([...positions]);
        await this.tweenCardsToPositions(this.cards, shuffled3, 300, 50);
        await this.sleep(50);
        const shuffled4 = Phaser.Utils.Array.Shuffle([...positions]);
        await this.tweenCardsToPositions(this.cards, shuffled4, 250, 30);
        await this.sleep(50);
        const shuffled5 = Phaser.Utils.Array.Shuffle([...positions]);
        await this.tweenCardsToPositions(this.cards, shuffled5, 350, 0, "Back.easeOut");
        await this.sleep(300);

        for (let i = 0; i < this.cards.length; i++) {
            const card = this.cards[i];
            card.revealed = false;
            this.flipCard(card, false);
            await this.sleep(28);
        }

        if (!this.sys.isActive()) return;
        this.hudStartMs = Date.now();
        this.hudStarted = true;
        this.updateHud();
        this.onGameplayStarted();
        this.lockInput = false;
        this.input.enabled = true;
    }

    private async preloadCardImageTextures(payload: FlipCardPayload): Promise<void> {
        const rawPaths = payload.questions
            ?.flatMap((q) => [q.image_keyword, q.image_matching_word])
            .filter((v): v is string => typeof v === "string" && v.trim().length > 0) ?? [];

        const urls = rawPaths.map((p) => this.resolveImageUrl(p)).filter(Boolean);
        const uniqueUrls = Array.from(new Set(urls));

        const toLoad: Array<{ key: string; url: string }> = [];
        for (const url of uniqueUrls) {
            if (this.imageKeyByUrl.has(url)) continue;
            const key = `flip_cards_img_${this.imageKeySeq++}`;
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
        this.pruneMissingFlipCardTextures();
    }

    private async preloadCardSoundAudio(payload: FlipCardPayload): Promise<void> {
        const rawPaths = payload.questions
            ?.flatMap((q) => [q.sound_keyword, q.sound_matching_word])
            .filter((v): v is string => typeof v === "string" && v.trim().length > 0) ?? [];

        const urls = rawPaths.map((p) => this.resolveSoundUrl(p)).filter(Boolean);
        const uniqueUrls = Array.from(new Set(urls));

        const toLoad: Array<{ key: string; url: string }> = [];
        for (const url of uniqueUrls) {
            if (this.soundKeyByUrl.has(url)) continue;
            const key = `flip_cards_snd_${this.soundKeySeq++}`;
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
        const raw = String(pathOrUrl).trim();
        if (!raw) return "";
        if (/^https?:\/\//i.test(raw)) {
            try {
                const url = new URL(raw);
                url.pathname = decodeURIComponent(url.pathname).replace(/\/{2,}/g, "/");
                return url.toString();
            } catch {
                return raw;
            }
        }
        const path = decodeURIComponent(raw).replace(/^\/+/, "");
        return `${API_BASE_URL}/${path}`;
    }

    private getFlipCardImageKey(imageUrl?: string | null): string | undefined {
        const url = imageUrl?.trim() ? this.resolveImageUrl(imageUrl) : "";
        if (!url) return undefined;
        const key = this.imageKeyByUrl.get(url);
        return key && this.textures.exists(key) ? key : undefined;
    }

    private hasFlipCardFaceContent(
        text?: string | null,
        image?: string | null,
        sound?: string | null
    ): boolean {
        if (hasHudCenterLabel(text)) return true;
        if ((image ?? "").trim().length > 0) return true;
        if ((sound ?? "").trim().length > 0) return true;
        return false;
    }

    private pruneMissingFlipCardTextures() {
        for (const [url, key] of this.imageKeyByUrl.entries()) {
            if (!this.textures.exists(key)) {
                this.imageKeyByUrl.delete(url);
                // eslint-disable-next-line no-console -- debug โหลดรูป flip-cards
                console.warn("[flip-cards] โหลดรูปไม่สำเร็จ", { url, key });
            }
        }
    }

    private playFlipSound(soundUrl?: string) {
        if (!soundUrl) return;
        const resolvedUrl = this.resolveSoundUrl(soundUrl);
        const key = this.soundKeyByUrl.get(resolvedUrl);
        if (!key) return;
        if (!this.cache.audio.exists(key)) return;
        guardedScenePlayQuestion(this, key, 1);
    }

    private buildMemoryMatchingGame(payload: FlipCardPayload) {
        this.syncGameAudioFromQuestion(payload.questions?.[0]);

        this.cards.forEach((c) => c.container.destroy(true));
        this.cards = [];
        this.revealedCards = [];
        this.lockInput = false;
        this.matchedPairs = 0;

        const questions =
            payload.questions?.filter(
                (q) =>
                    q.id != null &&
                    this.hasFlipCardFaceContent(q.keyword, q.image_keyword, q.sound_keyword) &&
                    this.hasFlipCardFaceContent(q.matching_word, q.image_matching_word, q.sound_matching_word)
            ) ?? [];
        this.totalPairs = questions.length;
        this.totalQuestions = this.totalPairs;

        const deck: MemoryCardModel[] = [];
        for (const q of questions) {
            const pairId = q.id;
            deck.push({
                id: `${pairId}:keyword`,
                pairId,
                face: "keyword",
                text: (q.keyword ?? "").trim(),
                image: (q.image_keyword ?? "").trim()
                    ? this.resolveImageUrl(q.image_keyword!)
                    : "",
                sound: (q.sound_keyword ?? "").trim() || undefined,
            });
            deck.push({
                id: `${pairId}:matching_word`,
                pairId,
                face: "matching_word",
                text: (q.matching_word ?? "").trim(),
                image: (q.image_matching_word ?? "").trim()
                    ? this.resolveImageUrl(q.image_matching_word!)
                    : "",
                sound: (q.sound_matching_word ?? "").trim() || undefined,
            });
        }

        Phaser.Utils.Array.Shuffle(deck);

        const { width, height } = this.scale;

        const topPadding = this.mobile ? height * 0.15 : Math.max(120, height * 0.16);
        const bottomPadding = this.mobile ? Math.min(8, height * 0.03) : Math.max(40, height * 0.06);
        const sidePadding = this.mobile ? Math.min(8, width * 0.03) : Math.max(24, width * 0.06);
        const gap = this.mobile ? Math.min(8, Math.min(width, height) * 0.012) : Math.max(14, Math.min(width, height) * 0.02);

        const availableW = Math.max(1, width - sidePadding * 2);
        const availableH = Math.max(1, height - topPadding - bottomPadding);
        const cardCount = deck.length;

        let cols = Math.ceil(cardCount / 2);
        if (this.mobile) {
            cols = Math.min(3, Math.max(2, cardCount));
        } else {
            cols = Math.max(2, Math.min(cols, 6));
        }
        const rows = Math.ceil(cardCount / cols);

        const cellW = Math.floor((availableW - gap * (cols - 1)) / cols);
        const cellH = Math.floor((availableH - gap * (rows - 1)) / rows);
        const finalCardSize = this.mobile ? Math.min(cellW, cellH) * 1.1 : Math.max(84, Math.min(cellW, cellH));

        const baseImage = this.textures.get("bg_flip_cards_blue").getSourceImage() as { width?: number; height?: number };
        const baseW = baseImage?.width ?? 1;
        const baseH = baseImage?.height ?? 1;
        const aspect = baseW / baseH;

        let finalCardW = this.mobile ? Math.round(cellW) : Math.max(1, Math.round(aspect >= 1 ? finalCardSize : finalCardSize * aspect));
        let finalCardH = this.mobile ? Math.round(finalCardW / aspect) : Math.max(1, Math.round(aspect >= 1 ? finalCardSize / aspect : finalCardSize));

        if (finalCardH > cellH) {
            const scaleDown = cellH / finalCardH;
            finalCardW *= scaleDown;
            finalCardH *= scaleDown;
        }

        if (this.mobile) {
            const mobileCardScale = 0.95;
            finalCardW = Math.max(1, Math.floor(finalCardW * mobileCardScale));
            finalCardH = Math.max(1, Math.floor(finalCardH * mobileCardScale));
        }

        const gridW = cols * finalCardW + gap * (cols - 1);
        const gridH = rows * finalCardH + gap * (rows - 1);
        const startX = (width - gridW) / 2 + finalCardW / 2;
        const startY = topPadding + (availableH - gridH) / 2 + finalCardH / 2;

        for (let i = 0; i < deck.length; i++) {
            const baseCol = i % cols;
            const col = this.mobile ? cols - 1 - baseCol : baseCol;
            const row = Math.floor(i / cols);
            const x = startX + col * (finalCardW + gap);
            const y = startY + row * (finalCardH + gap);
            const theme = deck[i].face === "keyword" ? "blue" : "pink";
            const view = this.createMemoryCard(x, y, finalCardW, finalCardH, deck[i], theme);
            this.cards.push(view);
        }
    }

    private createMemoryCard(
        x: number,
        y: number,
        w: number,
        h: number,
        model: MemoryCardModel,
        theme: "blue" | "pink",
    ): MemoryCardView {
        const backBgKey = theme === "blue" ? "bg_flip_cards_blue" : "bg_flip_cards_pink";
        const questionKey = theme === "blue" ? "question_flip_cards_blue" : "question_flip_cards_pink";
        const volumnKey = theme === "blue" ? "btn_volumn_blue" : "btn_volumn_pink";

        const backBg = this.add.image(0, 0, backBgKey).setDisplaySize(w, h);
        const question = this.add.image(0, 0, questionKey);
        const qSource = this.textures.get(questionKey).getSourceImage() as { width?: number; height?: number };
        const qW = qSource?.width ?? 1;
        const qH = qSource?.height ?? 1;
        const qMaxW = w * 0.34;
        const qMaxH = h * 0.34;
        const qScale = Math.min(qMaxW / qW, qMaxH / qH);
        question.setScale(qScale);
        const randomScaleOffset = Phaser.Math.Between(-0.05, 0.05);
        const randomDelay = Phaser.Math.Between(0, 1000);
        const randomAngle = Phaser.Math.Between(-5, 5);
        question.setScale(qScale * (1 + randomScaleOffset));
        this.tweens.add({
            targets: question,
            scale: {
                from: qScale * 0.9,
                to: qScale * 1.1,
            },
            angle: {
                from: randomAngle,
                to: -randomAngle,
            },
            duration: 600 + Phaser.Math.Between(0, 300),
            delay: randomDelay,
            yoyo: true,
            repeat: -1,
            ease: "Sine.inOut",
        });
        const back = this.add.container(0, 0, [backBg, question]);

        const frontBg = this.add.image(0, 0, backBgKey).setDisplaySize(w, h);
        const frontChildren: Phaser.GameObjects.GameObject[] = [frontBg];
        const frontDomElements: Phaser.GameObjects.DOMElement[] = [];

        const text = typeof model.text === "string" ? model.text : "";
        const imageUrl = typeof model.image === "string" ? model.image : "";
        const soundUrl = typeof model.sound === "string" ? model.sound : "";
        const hasText = hasHudCenterLabel(text);
        const imageTextureKey = imageUrl ? this.getFlipCardImageKey(imageUrl) : undefined;
        const hasImage = !!imageTextureKey;
        const resolvedSoundUrl = soundUrl.trim() ? this.resolveSoundUrl(soundUrl) : "";
        const soundKey = resolvedSoundUrl ? this.soundKeyByUrl.get(resolvedSoundUrl) : undefined;
        const hasSound = !!(soundKey && this.cache.audio.exists(soundKey));

        const layout = resolveFlipCardFaceLayout(w, h, hasImage, hasText, hasSound);
        const layoutItems: Array<{ obj: Phaser.GameObjects.GameObject; height: number }> = [];

        let imageObj: Phaser.GameObjects.Image | undefined;
        if (hasImage && imageTextureKey) {
            const maxImgW = layout.pillW * 0.96;
            const maxImgH = layout.imageMaxH;
            const img = this.add.image(0, 0, imageTextureKey);
            const source = this.textures.get(imageTextureKey).getSourceImage() as {
                width?: number;
                height?: number;
                naturalWidth?: number;
                naturalHeight?: number;
            };
            const sourceW = source?.naturalWidth ?? source?.width ?? 1;
            const sourceH = source?.naturalHeight ?? source?.height ?? 1;
            const scale = Math.min(maxImgW / sourceW, maxImgH / sourceH);
            img.setDisplaySize(Math.max(1, sourceW * scale), Math.max(1, sourceH * scale));
            imageObj = img;
            layoutItems.push({ obj: imageObj, height: imageObj.displayHeight });
        }

        let textDom: Phaser.GameObjects.DOMElement | undefined;
        let textPillGfx: Phaser.GameObjects.Graphics | undefined;
        if (hasText) {
            const adaptiveFontPx = this.resolveFlipCardAnswerFontPx(text, hasImage);
            const minFontPx = hasImage
                ? this.mobile
                    ? FLIP_CARD_ANSWER_TEXT_TUNING.mobile.fontMinWithImage
                    : FLIP_CARD_ANSWER_TEXT_TUNING.desktop.fontMinWithImage
                : this.mobile
                  ? FLIP_CARD_ANSWER_TEXT_TUNING.mobile.fontMinTextOnly
                  : FLIP_CARD_ANSWER_TEXT_TUNING.desktop.fontMinTextOnly;
            const pillPadX = Math.max(6, Math.round(layout.pillW * 0.06));
            const inner = createThaiTextElement(text, {
                width: Math.floor(layout.pillW - pillPadX * 2),
                height: Math.floor(layout.pillH),
                fontSize: `${adaptiveFontPx}px`,
                color: "#4E4E4E",
                align: "center",
                padding: 0,
                maxLines: 3,
                minFontSizePx: minFontPx,
                lineHeight: 1.25,
                safePaddingYPx: 2,
                allowEmergencyWordBreak: false,
            });
            const textInner = inner.firstElementChild as HTMLElement | null;
            if (textInner) {
                textInner.style.fontWeight = "700";
                textInner.style.lineHeight = "1.25";
            }
            inner.style.visibility = "hidden";
            inner.style.opacity = "0";
            inner.style.pointerEvents = "none";
            inner.dataset.flipCardDom = "text";
            const face = this.add.dom(0, 0).createFromHTML(inner.outerHTML);
            face.setOrigin(0.5, 0.5);
            face.pointerEvents = "none";
            this.setCardDomVisible(face, false);
            textDom = face;
            frontDomElements.push(face);

            textPillGfx = this.add.graphics();
            const pillRadius = Math.min(12, Math.round(layout.pillH * 0.28));
            drawQuestionMediaOverlayTextPill(
                textPillGfx,
                -layout.pillW / 2,
                -layout.pillH / 2,
                layout.pillW,
                layout.pillH,
                pillRadius,
                2
            );
            const textBlock = this.add.container(0, 0, [textPillGfx, textDom]);
            layoutItems.push({ obj: textBlock, height: layout.pillH });
        }

        let volumnBtn: Phaser.GameObjects.Image | undefined;
        if (hasSound && this.textures.exists(volumnKey)) {
            const btn = this.add.image(0, 0, volumnKey);
            const src = this.textures.get(volumnKey).getSourceImage() as { width?: number; height?: number };
            const srcW = src?.width ?? 1;
            const srcH = src?.height ?? 1;
            const maxW = w * 0.42;
            const maxH = layout.speakerMaxH || h * 0.18;
            const scale = Math.min(maxW / srcW, maxH / srcH);
            btn.setDisplaySize(Math.max(1, srcW * scale), Math.max(1, srcH * scale));
            btn.setInteractive({ useHandCursor: true });
            btn.on("pointerdown", (_pointer: Phaser.Input.Pointer, _lx: number, _ly: number, event: any) => {
                if (event?.stopPropagation) event.stopPropagation();
                this.playFlipSound(soundUrl);
            });
            volumnBtn = btn;
            layoutItems.push({ obj: volumnBtn, height: volumnBtn.displayHeight });
        }

        const totalHeight =
            layoutItems.reduce((sum, item) => sum + item.height, 0) +
            layout.gapY * Math.max(0, layoutItems.length - 1);
        let cursorY = -totalHeight / 2;

        for (const item of layoutItems) {
            cursorY += item.height / 2;
            (item.obj as Phaser.GameObjects.GameObject & { y?: number }).y = cursorY;
            cursorY += item.height / 2 + layout.gapY;
            frontChildren.push(item.obj);
        }

        const front = this.add.container(0, 0, frontChildren);
        front.setVisible(false);
        frontDomElements.forEach((dom) => this.setCardDomVisible(dom, false));

        const visual = this.add.container(0, 0, [back, front]).setDepth(5);
        const container = this.add.container(x, y, [visual]).setSize(w, h).setDepth(5);
        container.setInteractive({ useHandCursor: true });

        const view: MemoryCardView = {
            model,
            container,
            visual,
            back,
            front,
            frontDomElements,
            frontBg,
            flipSeq: 0,
            revealed: false,
            matched: false,
        };

        container.on("pointerover", () => {
            if (!this.input.enabled) return;
            if (this.lockInput) return;
            if (view.matched || view.revealed) return;
            this.tweens.killTweensOf(container);
            container.setDepth(10);
            this.tweens.add({
                targets: container,
                scale: 1.08,
                duration: 200,
                ease: 'Cubic.easeOut'
            });
        });

        container.on("pointerout", (pointer: Phaser.Input.Pointer) => {
            if (pointer.isDown) return;
            if (container.getData("pressTweenActive") === true) return;
            if (view.revealed) return;
            this.tweens.killTweensOf(container);
            this.tweens.add({
                targets: container,
                scale: 1,
                duration: 200,
                ease: 'Cubic.easeOut',
                onComplete: () => container.setDepth(5)
            });
        });

        container.on("pointerdown", () => {
            if (!this.input.enabled) return;
            if (this.lockInput) return;
            if (view.matched || view.revealed) return;
            this.playSfx("sfx_click", 1);
            container.setData("pressTweenActive", true);
            this.tweens.killTweensOf(container);
            this.tweens.add({
                targets: container,
                scale: 0.9,
                duration: 80,
                yoyo: true,
                onComplete: () => {
                    container.setScale(1);
                    container.setDepth(5);
                    container.setData("pressTweenActive", false);
                }
            });
            void this.handleCardReveal(view);
        });

        return view;
    }

    /** นับความยาวข้อความแบบที่ตาเห็น (ตัดช่องว่าง + วรรณยุกต์/สระ) */
    private setCardDomVisible(dom: Phaser.GameObjects.DOMElement, visible: boolean) {
        dom.setVisible(visible);
        const node = dom.node as HTMLElement | null;
        if (!node) return;
        const visibility = visible ? "visible" : "hidden";
        const opacity = visible ? "1" : "0";
        node.style.visibility = visibility;
        node.style.opacity = opacity;
        node.style.pointerEvents = "none";
        node.querySelectorAll<HTMLElement>("[data-flip-card-dom]").forEach((el) => {
            el.style.visibility = visibility;
            el.style.opacity = opacity;
            el.style.pointerEvents = "none";
        });
    }

    private getFlipCardVisualTextLen(text: string): number {
        return text.replace(/\s+/g, "").replace(/[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/g, "").length;
    }

    /** ฟอนต์คำตอบ — คำสั้นใหญ่ คำยาวเล็ก */
    private resolveFlipCardAnswerFontPx(text: string, hasImage: boolean): number {
        const tc = this.mobile ? FLIP_CARD_ANSWER_TEXT_TUNING.mobile : FLIP_CARD_ANSWER_TEXT_TUNING.desktop;
        const baseFont = hasImage ? tc.fontWithImage : tc.fontTextOnly;
        const fontMin = hasImage ? tc.fontMinWithImage : tc.fontMinTextOnly;
        const fontMax = hasImage ? tc.fontMaxWithImage : tc.fontMaxTextOnly;
        const visualTextLen = this.getFlipCardVisualTextLen(text);
        let fontDelta = 0;
        if (visualTextLen <= 2) fontDelta = this.mobile ? 8 : 12;
        else if (visualTextLen <= 4) fontDelta = this.mobile ? 5 : 8;
        else if (visualTextLen <= 7) fontDelta = this.mobile ? 2 : 4;
        else if (visualTextLen <= 10) fontDelta = 0;
        else if (visualTextLen <= 14) fontDelta = this.mobile ? -3 : -5;
        else fontDelta = this.mobile ? -6 : -10;
        return Phaser.Math.Clamp(baseFont + fontDelta, fontMin, fontMax);
    }

    private async handleCardReveal(card: MemoryCardView) {
        if (this.revealedCards.length >= 2) return;
        this.lockInput = true;
        card.revealed = true;
        this.playFlipSound(card.model.sound);
        await this.flipCard(card, true);
        this.revealedCards.push(card);

        if (this.revealedCards.length < 2) {
            this.lockInput = false;
            return;
        }

        this.lockInput = true;
        const [a, b] = this.revealedCards;
        const isMatch = a.model.pairId === b.model.pairId && a.model.id !== b.model.id;

        if (isMatch) {
            await this.handleMatch(a, b);
        } else {
            await this.handleMiss(a, b);
        }
    }

    private tweenOnce(config: Phaser.Types.Tweens.TweenBuilderConfig): Promise<void> {
        return new Promise<void>((resolve) => {
            const originalOnComplete = config.onComplete;
            const wrapped = (...args: any[]) => {
                if (typeof originalOnComplete === "function") (originalOnComplete as any).apply(null, args);
                resolve();
            };
            this.tweens.add({ ...config, onComplete: wrapped });
        });
    }

    private async handleMatch(a: MemoryCardView, b: MemoryCardView) {
        a.matched = true;
        b.matched = true;
        this.playSfx("sfx_correct", 1);

        this.showRandomMessage(this.messagePools.correct, undefined, "clap");

        const plusOneDone = this.showScorePlusOne();

        await this.sleep(60);

        const cardsDone = Promise.all(
            [a, b].map(async (card, index) => {
                this.tweens.killTweensOf(card.container);
                this.tweens.killTweensOf(card.visual);
                card.container.setScale(1);
                card.container.setDepth(20);
                card.frontBg.setTintFill(0xC9C3F9);

                await this.tweenOnce({
                    targets: card.container,
                    y: "-=80",
                    scale: 1.3,
                    angle: index === 0 ? -20 : 20,
                    duration: 400,
                    ease: "Back.easeOut",
                    delay: index * 50,
                    onStart: () => {
                        this.createParticleBurst(card.container.x, card.container.y);
                    },
                });

                await this.tweenOnce({
                    targets: card.container,
                    alpha: 0,
                    scale: 0.5,
                    y: "+=40",
                    duration: 500,
                    ease: "Cubic.easeIn",
                });

                card.container.destroy(true);
            })
        );

        await plusOneDone;
        this.matchedPairs += 1;
        this.score = this.matchedPairs;
        this.reportRunstateQuestionCompleted(this.matchedPairs);
        this.onScoreIncreased();
        this.updateHud();
        await this.animateScoreHud();

        await cardsDone;
        this.revealedCards = [];
        this.lockInput = false;
        if (this.matchedPairs >= this.totalPairs) {
            await this.sleep(500);
            this.endGame();
        }
    }

    private showScorePlusOne(): Promise<void> {
        const { width, height } = this.scale;
        const x = width / 2;
        const y = height / 2;
        const r = Math.max(30, Math.round(Math.min(width, height) * 0.06));

        const circle = this.add.circle(0, 0, r, 0xffffff, 0.95);
        const label = this.add
            .text(0, 0, "+1", {
                fontSize: `${Math.round(r * 0.95)}px`,
                color: "#025B96",
                fontFamily: "Noto Sans Thai",
                fontStyle: "bold",
            })
            .setOrigin(0.5);

        const container = this.add.container(x, y + 50, [circle, label]).setDepth(2000);
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
                        y: targetY,
                        x: targetX,
                        scale: 0.2,
                        alpha: 0,
                        duration: 600,
                        ease: "Expo.easeIn",
                        onComplete: () => {
                            container.destroy(true);
                            resolve();
                        },
                    },
                ],
            });
        });
    }

    private async animateScoreHud() {
        if (!this.scoreUI) return;

        this.tweens.killTweensOf(this.scoreUI.container);
        this.tweens.killTweensOf(this.scoreUI.dom);
        const originalX = this.scoreUI.container.x;
        this.scoreUI.dom.setAlpha(1);

        await Promise.all([
            this.tweenOnce({
                targets: this.scoreUI.container,
                y: { from: this.scoreUI.container.y, to: this.scoreUI.container.y - 15 },
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

        this.scoreUI.container.x = originalX;
        this.scoreUI.container.setScale(1);
        this.scoreUI.dom.setAlpha(1);
    }

    private async handleMiss(a: MemoryCardView, b: MemoryCardView) {
        this.playSfx("sfx_incorrect", 1);
        this.showRandomMessage(this.messagePools.wrong, undefined, "point");
        await this.sleep(80);

        await Promise.all(
            [a, b].map(async (card) => {
                this.tweens.killTweensOf(card.container);
                this.tweens.killTweensOf(card.visual);
                const originalX = card.container.x;
                card.frontBg.setTintFill(0xFF0076);
                await this.tweenOnce({
                    targets: card.container,
                    x: { from: originalX - 15, to: originalX + 15 },
                    duration: 60,
                    repeat: 3,
                    yoyo: true,
                    ease: "Sine.easeInOut",
                });
                card.container.x = originalX;
                card.frontBg.clearTint();
            })
        );

        await this.sleep(250);
        await Promise.all([
            (async () => {
                a.revealed = false;
                await this.flipCard(a, false);
            })(),
            (async () => {
                b.revealed = false;
                await this.flipCard(b, false);
            })(),
        ]);

        this.revealedCards = [];
        this.lockInput = false;
    }

    private createParticleBurst(x: number, y: number) {
        const particles = this.add.particles(x, y - 60, "star", {
            speed: { min: 100, max: 250 },
            angle: { min: 0, max: 360 },
            lifespan: 800,
            gravityY: 300,
            quantity: 15,
            emitting: false
        });

        particles.explode(15);
        particles.setDepth(25);

        this.time.delayedCall(1000, () => particles.destroy());
    }

    private flipCard(card: MemoryCardView, reveal: boolean): Promise<void> {
        const duration = 140;
        const seq = ++card.flipSeq;
        this.tweens.killTweensOf(card.visual);
        card.frontDomElements.forEach((dom) => this.setCardDomVisible(dom, false));
        return new Promise<void>((resolve) => {
            this.tweens.add({
                targets: card.visual,
                scaleX: 0,
                scaleY: 1.1,
                duration,
                ease: "Cubic.easeIn",
                onComplete: () => {
                    if (seq !== card.flipSeq) {
                        resolve();
                        return;
                    }
                    card.back.setVisible(!reveal);
                    card.front.setVisible(reveal);
                    this.tweens.add({
                        targets: card.visual,
                        scaleX: 1,
                        scaleY: 1,
                        duration,
                        ease: "Cubic.easeOut",
                        onComplete: () => {
                            if (seq !== card.flipSeq) {
                                resolve();
                                return;
                            }
                            if (reveal) {
                                card.frontDomElements.forEach((dom) => this.setCardDomVisible(dom, true));
                            }
                            resolve();
                        },
                    });
                },
            });
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
        const { width, height } = this.scale;
        const ui = createHudScaleCtx(width, height, this.mobile);
        const minBoxW = Math.min(width * (this.mobile ? 0.76 : 0.75), ui.px(680));
        const maxBoxW = Math.min(width * (this.mobile ? 0.96 : 0.9), ui.px(980));
        const radius = ui.px(14);
        const paddingX = this.mobile ? 7 : ui.px(18);
        const paddingY = this.mobile ? 5 : ui.px(12);
        const fontPx = this.mobile ? 16 : getHudCenterTextMaxFontPx(ui.px.bind(ui), false);
        const y = Math.max(this.mobile ? 48 : ui.px(54), height * (this.mobile ? 0.045 : 0.06));

        this.titleUI.container.setPosition(width / 2, this.mobile ? y * 1.75 : y);

        const title = (this.titleUI.title ?? "").trim();
        if (!hasHudCenterLabel(title)) {
            this.titleUI.container.setVisible(false);
            return;
        }
        this.titleUI.container.setVisible(true);

        const textW = measureThaiTextWidth(title, {
            fontSizePx: fontPx,
            fontWeight: 700,
        });
        const boxW = Phaser.Math.Clamp(
            Math.ceil(textW + paddingX * 2 + ui.px(28)),
            minBoxW,
            maxBoxW
        );
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

        const boxH = Math.max(this.mobile ? 38 : ui.px(60), Math.ceil(textH) + paddingY * 2);

        this.titleUI.container.remove(this.titleUI.dom, true);
        const dom = this.add.dom(0, 0, span).setOrigin(0.5, 0.5);
        dom.pointerEvents = "none";
        this.titleUI.dom = dom;

        this.titleUI.box.clear();
        this.titleUI.box.fillStyle(0xffffff, 0.55);
        this.titleUI.box.fillRoundedRect(-boxW / 2, -boxH / 2, boxW, boxH, radius);

        this.titleUI.container.add(dom);
    }

    private getFlipHudLayout() {
        const safe = new Phaser.Geom.Rectangle(0, 0, this.scale.width, this.scale.height);
        const ui = createHudScaleCtx(safe.width, safe.height, this.mobile);
        const metrics = getGameHudRowMetrics({
            mobile: this.mobile,
            width: safe.width,
            height: safe.height,
            px: ui.px.bind(ui),
            hasProgress: false,
            hasLives: false,
        });
        const slots = getGameHudPillSlots(safe.x, safe.y, safe.width, metrics, {
            hasProgress: false,
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

        const onResize = () => this.layoutTime();
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

    private layoutFlipHudStats() {
        const { safe, ui, metrics, slots } = this.getFlipHudLayout();
        const rowCenterY = safe.y + slots.rowY;
        const timeText = this.hudStarted
            ? this.formatElapsedSeconds((Date.now() - this.hudStartMs) / 1000)
            : "00:00";

        layoutGameHudStatsDomRow({
            scene: this,
            mobile: this.mobile,
            metrics,
            slots,
            rowCenterY,
            px: ui.px.bind(ui),
            pills: {
                time: this.timeUI,
                score: this.scoreUI,
            },
            timeText,
            scoreValue: String(this.score),
            labelPad: ui.px(this.mobile ? 12 : 18),
            valuePad: ui.px(this.mobile ? 12 : 18),
        });
    }

    private layoutTime() {
        this.layoutFlipHudStats();
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

        const onResize = () => this.layoutScore();
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
        this.layoutFlipHudStats();
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

    private showRandomMessage(pool: readonly string[], durationMs?: number, teacherStateWhileVisible?: TeacherState) {
        const safePool = Array.isArray(pool) ? pool : [];
        if (safePool.length === 0) return;
        const id = Phaser.Utils.Array.GetRandom(safePool);
        const entry = this.messageCatalog[id];
        if (!entry) return;
        this.showMessage(entry.text, durationMs, entry.voice, teacherStateWhileVisible);
    }

    private onGameplayStarted() {
        this.lastScoreChangeMs = Date.now();
        this.idleNoScoreMessageShown = false;
        this.milestoneShown.clear();
        this.showRandomMessage(this.messagePools.intro, 2500, "point");
    }

    private onScoreIncreased() {
        this.lastScoreChangeMs = Date.now();
        this.idleNoScoreMessageShown = false;
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
            if (sec === 15 || sec === 30) this.playSfx("sfx_alert_warning", 1);
            if (sec === 45) this.playSfx("sfx_alert_danger", 1);
            this.triggerTimeUiMilestone(sec);
            const pool = this.messagePools.time[sec] ?? [];
            if (canShowMessage) this.showRandomMessage(pool, 2400, "point");
            return;
        }

        if (canShowMessage && !this.idleNoScoreMessageShown && this.lastScoreChangeMs > 0 && now - this.lastScoreChangeMs >= 15_000) {
            this.idleNoScoreMessageShown = true;
            this.showRandomMessage(this.messagePools.idleNoScore15, 2200, "point");
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
        setDomTimeHudPillValue(this.timeUI, this.timeUI.inner.querySelector("span")?.textContent ?? "00:00", flashColor);

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
            if (this.timeRedLoopActive) return;
            this.startTimeFlash(0xFF0076, 1, true);
        }
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

    private colorToCss(value: number) {
        const safe = Math.max(0, Math.min(0xffffff, Math.floor(value)));
        return `#${safe.toString(16).padStart(6, "0")}`;
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

    private updateTickingByElapsed(elapsedSeconds: number) {
        void elapsedSeconds;
        // Disable countdown ticking audio entirely.
        this.stopTickingAudio();
        this.tickingState = null;
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

    private async fetchFlipCardData(): Promise<FlipCardPayload> {
        if (this.injectedPayload) {
            return this.injectedPayload as unknown as FlipCardPayload;
        }
        throw new Error("Missing injected payload for scene: flip-cards");
    }

    private openHowToPopup() {
        const { width, height } = this.scale;

        const destroyPopup = () => {
            const popup = this.tutorialPopup;
            this.tutorialPopup = undefined;
            popup?.titleBg.destroy();
            popup?.titleIcon.destroy();
            popup?.howToImage.destroy();
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

        const titleY = Math.max(70, height * (this.mobile ? 0.12 : 0.14));
        const titleBgSize = fitTo("icon_tutorial_bg", width * (this.mobile ? 0.74 : 0.62), height * 0.18);
        const titleBg = this.add.image(width / 2, titleY, "icon_tutorial_bg").setDepth(3001);
        titleBg.setDisplaySize(titleBgSize.w, titleBgSize.h);
        this.tweens.add({
            targets: titleBg,
            alpha: { from: 0.2, to: 1 },
            duration: 800,
            yoyo: true,
            repeat: -1,
            ease: "Sine.inOut",
        });

        const titleIconSize = fitTo("icon_tutorial_title", titleBgSize.w * 0.86, titleBgSize.h * 0.86);
        const titleIcon = this.add.image(width / 2, titleY, "icon_tutorial_title").setDepth(3002);
        titleIcon.setDisplaySize(titleIconSize.w, titleIconSize.h);

        const howToMaxH = this.mobile ? height * 0.62 : height * 0.58;
        const howToSize = fitTo(this.mobile ? "howtoplay_flip_cards_mobile" : "howtoplay_flip_cards", this.mobile ? width * 0.92 : width * 0.88, howToMaxH);
        const howToY = titleY + titleBgSize.h / 2 + howToSize.h / 2 + Math.max(12, height * 0.03);
        const howToImage = this.add.image(width / 2, howToY, this.mobile ? "howtoplay_flip_cards_mobile" : "howtoplay_flip_cards").setDepth(3003);
        howToImage.setDisplaySize(howToSize.w, howToSize.h);

        const btnMaxW = Math.min(260, width * (0.40));
        const btnSize = fitTo("flip_cards_btn_start_tutorial", btnMaxW, height * 0.16);
        const btnY = Math.min(height - btnSize.h / 2 - 24, howToY + howToSize.h / 2 + btnSize.h / 2 + Math.max(14, height * 0.03));
        const startButton = this.add.image(width / 2, btnY, "flip_cards_btn_start_tutorial").setDepth(3004);
        startButton.setDisplaySize(btnSize.w, btnSize.h);
        startButton.setInteractive({ useHandCursor: true });
        startButton.once("pointerdown", () => {
            startButton.disableInteractive();
            destroyPopup();
            if (this.scene.isActive("HomeScene")) this.scene.stop("HomeScene");
        });

        this.tutorialPopup = {
            titleBg,
            titleIcon,
            howToImage,
            startButton,
            restoreInputEnabled,
            restoreLockInput,
        };
        this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => destroyPopup());
    }

    private destroyIntroDecor() {
        const decor = this.introDecor;
        this.introDecor = undefined;
        if (!decor) return;
        for (const s of decor.stars) this.tweens.killTweensOf(s.obj);
        this.tweens.killTweensOf(decor.bgBlue);
        this.tweens.killTweensOf(decor.bgPink);
        this.tweens.killTweensOf(decor.starBlue);
        this.tweens.killTweensOf(decor.starPink);
        this.tweens.killTweensOf(decor.starYellow);
        this.tweens.killTweensOf(decor.title);
        for (const s of decor.stars) s.obj.destroy();
        decor.bgBlue.destroy();
        decor.bgPink.destroy();
        decor.starBlue.destroy();
        decor.starPink.destroy();
        decor.starYellow.destroy();
        decor.title.destroy();
    }

    private createIntroDecor(worldWidth: number, worldHeight: number) {
        const centerX = worldWidth / 2;
        const centerY = worldHeight / 3;

        const stars: Array<{
            obj: Phaser.GameObjects.Image;
            nx: number;
            ny: number;
            s: number;
            a0: number;
            a1: number;
            d: number;
            delay: number;
        }> = [];
        const nxMin = -0.35;
        const nxMax = 0.35;
        const nyMin = -0.22;
        const nyMax = 0.28;
        const minDist = 0.14;
        const minDist2 = minDist * minDist;
        const maxTries = 60;
        for (let i = 0; i < 15; i++) {
            let nx = 0;
            let ny = 0;
            for (let t = 0; t < maxTries; t++) {
                const candidateX = Phaser.Math.FloatBetween(nxMin, nxMax);
                const candidateY = Phaser.Math.FloatBetween(nyMin, nyMax);
                let ok = true;
                for (const prev of stars) {
                    const dx = candidateX - prev.nx;
                    const dy = candidateY - prev.ny;
                    if (dx * dx + dy * dy < minDist2) {
                        ok = false;
                        break;
                    }
                }
                if (ok) {
                    nx = candidateX;
                    ny = candidateY;
                    break;
                }
                if (t === maxTries - 1) {
                    nx = candidateX;
                    ny = candidateY;
                }
            }
            const s = Phaser.Math.FloatBetween(0.65, 0.95);
            const a0 = Phaser.Math.FloatBetween(0.30, 0.40);
            const a1 = Phaser.Math.FloatBetween(0.50, 0.60);
            const d = Phaser.Math.Between(1400, 2400);
            const delay = Phaser.Math.Between(0, 1200);
            const obj = this.add.image(centerX, centerY, "star").setDepth(1);
            stars.push({ obj, nx, ny, s, a0, a1, d, delay });
        }
        const bgBlue = this.add.image(centerX, centerY, "bg_flip_cards_blue").setDepth(2);
        const bgPink = this.add.image(centerX, centerY, "bg_flip_cards_pink").setDepth(2);
        const starBlue = this.add.image(centerX, centerY, "star_blue").setDepth(3);
        const starPink = this.add.image(centerX, centerY, "star_pink").setDepth(3);
        const starYellow = this.add.image(centerX, centerY, "star_yellow").setDepth(3);
        const title = this.add.image(centerX, centerY, "icon_tutorial_title").setDepth(4);

        this.introDecor = { title, stars, starBlue, starPink, starYellow, bgBlue, bgPink };
        this.layoutIntroDecor(worldWidth, worldHeight);
    }

    private layoutIntroDecor(worldWidth: number, worldHeight: number) {
        const decor = this.introDecor;
        if (!decor) return;

        const centerX = worldWidth / 2;
        const centerY = worldHeight / 3;

        const titleSrc = this.textures.get("icon_tutorial_title").getSourceImage() as { width?: number; height?: number };
        const titleW = titleSrc?.width ?? 1;
        const titleH = titleSrc?.height ?? 1;
        const titleMaxW = worldWidth * (this.mobile ? 0.78 : 0.8);
        const titleMaxH = worldHeight * (this.mobile ? 0.22 : 0.35);
        const titleScale = Math.min(titleMaxW / titleW, titleMaxH / titleH);

        const bgBlueSrc = this.textures.get("bg_flip_cards_blue").getSourceImage() as { width?: number; height?: number };
        const bgPinkSrc = this.textures.get("bg_flip_cards_pink").getSourceImage() as { width?: number; height?: number };
        const bgBlueW = bgBlueSrc?.width ?? 1;
        const bgBlueH = bgBlueSrc?.height ?? 1;
        const bgPinkW = bgPinkSrc?.width ?? 1;
        const bgPinkH = bgPinkSrc?.height ?? 1;
        const bgMaxW = worldWidth * (this.mobile ? 0.20 : 0.28);
        const bgMaxH = worldHeight * (this.mobile ? 0.18 : 0.26);
        const bgBlueScale = Math.min(bgMaxW / bgBlueW, bgMaxH / bgBlueH);
        const bgPinkScale = Math.min(bgMaxW / bgPinkW, bgMaxH / bgPinkH);

        const starSrc = this.textures.get("star").getSourceImage() as { width?: number; height?: number };
        const starW = starSrc?.width ?? 1;
        const starH = starSrc?.height ?? 1;
        const starMaxW = worldWidth * (this.mobile ? 0.06 : 0.045);
        const starMaxH = worldHeight * (this.mobile ? 0.045 : 0.035);
        const starScale = Math.min(starMaxW / starW, starMaxH / starH);

        const coloredStarSrc = this.textures.get("star_blue").getSourceImage() as { width?: number; height?: number };
        const cW = coloredStarSrc?.width ?? 1;
        const cH = coloredStarSrc?.height ?? 1;
        const coloredMaxW = worldWidth * (this.mobile ? 0.16 : 0.13);
        const coloredMaxH = worldHeight * (this.mobile ? 0.12 : 0.10);
        const coloredScale = Math.min(coloredMaxW / cW, coloredMaxH / cH);

        for (const s of decor.stars) {
            s.obj.setPosition(centerX + s.nx * worldWidth, centerY + s.ny * worldHeight).setScale(starScale * s.s);
        }
        decor.bgBlue.setPosition(centerX + worldWidth * 0.3, centerY + worldHeight * 0.05).setScale(bgBlueScale).setAngle(14);
        decor.bgPink.setPosition(centerX - worldWidth * 0.3, centerY + worldHeight * 0.05).setScale(bgPinkScale).setAngle(-14);

        decor.starBlue.setPosition(this.mobile ? centerX + worldWidth * 0.35 : centerX + worldWidth * 0.20, centerY - worldHeight * 0.12).setScale(coloredScale);
        decor.starPink.setPosition(this.mobile ? centerX - worldWidth * 0.4 : centerX - worldWidth * 0.2, this.mobile ? centerY - worldHeight * 0.08 : centerY - worldHeight * 0.02).setScale(coloredScale);
        decor.starYellow.setPosition(this.mobile ? centerX + worldWidth * 0.25 : centerX + worldWidth * 0.12, centerY + worldHeight * 0.15).setScale(coloredScale);

        decor.title.setPosition(centerX, centerY).setScale(titleScale);

        for (const s of decor.stars) this.tweens.killTweensOf(s.obj);
        this.tweens.killTweensOf(decor.bgBlue);
        this.tweens.killTweensOf(decor.bgPink);
        this.tweens.killTweensOf(decor.starBlue);
        this.tweens.killTweensOf(decor.starPink);
        this.tweens.killTweensOf(decor.starYellow);
        this.tweens.killTweensOf(decor.title);

        for (const s of decor.stars) {
            s.obj.setAlpha(s.a0);
            this.tweens.add({
                targets: s.obj,
                alpha: { from: s.a0, to: s.a1 },
                duration: s.d,
                delay: s.delay,
                yoyo: true,
                repeat: -1,
                ease: "Sine.inOut",
            });
        }
        if (!this.mobile) {
            this.tweens.add({
                targets: [decor.bgBlue, decor.bgPink],
                y: { from: centerY + worldHeight * 0.05 - 10, to: centerY + worldHeight * 0.05 + 10 },
                duration: 1500,
                yoyo: true,
                repeat: -1,
                ease: "Sine.inOut",
            });
        } else {
            this.tweens.add({
                targets: decor.bgBlue,
                y: { from: centerY - worldHeight * 0.1 - 10, to: centerY - worldHeight * 0.1 + 10 },
                duration: 1500,
                yoyo: true,
                repeat: -1,
                ease: "Sine.inOut",
            });
            this.tweens.add({
                targets: decor.bgPink,
                y: { from: centerY + worldHeight * 0.1 + 10, to: centerY + worldHeight * 0.1 - 10 },
                duration: 1500,
                yoyo: true,
                repeat: -1,
                ease: "Sine.inOut",
            });
        }
        this.tweens.add({
            targets: decor.starBlue,
            alpha: { from: 0.4, to: 1 },
            scale: coloredScale * 1.1,
            angle: { from: -8, to: 8 },
            duration: 950,
            yoyo: true,
            repeat: -1,
            ease: "Sine.inOut",
        });
        this.tweens.add({
            targets: decor.starPink,
            alpha: { from: 0.35, to: 1 },
            scale: coloredScale * 1.12,
            angle: { from: 10, to: -10 },
            duration: 1100,
            yoyo: true,
            repeat: -1,
            ease: "Sine.inOut",
        });
        this.tweens.add({
            targets: decor.starYellow,
            alpha: { from: 0.45, to: 1 },
            scale: coloredScale * 1.08,
            angle: { from: -12, to: 12 },
            duration: 1000,
            yoyo: true,
            repeat: -1,
            ease: "Sine.inOut",
        });
        this.tweens.add({
            targets: decor.title,
            scale: titleScale * 1.06,
            duration: 900,
            yoyo: true,
            repeat: -1,
            ease: "Sine.inOut",
        });
    }
}
