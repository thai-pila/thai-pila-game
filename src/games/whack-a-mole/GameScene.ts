import { BaseGameScene } from "../../core/scenes/BaseGameScene";
import { API_BASE_URL } from "../../core/api";
import { HomeActionPayload } from "../../core/scenes/HomeScene";
import { isMobileLayout } from "../../utils/device";
import { isShortMobileViewport, isTinyMobileViewport } from "../../utils/mobileLayout";
import { createHudScaleCtx } from "../../utils/desktopUiScale";
import { createThaiTextSpan } from "../../utils/thaiText";
import {
  getDomTimeHudPillValueColor,
  layoutGameHudStatsDomRow,
  setDomLabelValueHudPillValue,
  setDomTimeHudPillValue,
  type DomHudPill,
} from "../../core/hud/questionProgressHud";
import {
  BG_HUD_TEXTURE_KEY,
  getGameHudPillSlots,
  getGameHudRowMetrics,
  HUD_VALUE_COLOR,
  HUD_VOLUME_TEXTURE_KEY,
  hasHudCenterLabel,
  getHudSuggestionLabel,
  getHudCenterTextMaxFontPx,
  preloadHudAssets,
} from "../../core/hud/gameHudLayout";
import { measureThaiTextWidth } from "../../utils/thaiText";
import {
  drawQuestionMediaFrameBox,
  fitQuestionMediaContainSize,
} from "../../utils/questionHudMedia";
import { type TeacherState } from "../../core/teacher/TeacherAssistant";
import { TeacherHintUI } from "../../core/teacher/TeacherHintUI";
import {
  canPlayGameAudio,
  GAME_BGM_VOLUME,
  guardedScenePlay,
  guardedScenePlayQuestion,
  guardedScenePlayVoice,
} from "../../core/audio/sceneAudio";

type WhackAMoleQuestion = {
  id: number;
  id_game_info: number;
  no: number;
  correct_answer: string;
  wrong_answer: string;
  hint: string;
  sound_correct_answer: string;
  image_correct_answer: string;
  sound_hint: string;
  image_hint: string;
  sound_wrong_answer: string;
  image_wrong_answer: string;
};

type WhackAMolePayload = {
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
  questions: WhackAMoleQuestion[];
}


/** ฟอนต์ตัวเลือกบนหลุม — สั้นใหญ่ / ยาวเล็ก (แนวเดียวกับ flip-cards) */
const WAM_CHOICE_TEXT_TUNING = {
  mobile: {
    fontTextOnly: 28,
    fontWithImage: 14,
    fontMinTextOnly: 11,
    fontMinWithImage: 10,
    fontMaxTextOnly: 38,
    fontMaxWithImage: 22,
  },
  desktop: {
    fontTextOnly: 48,
    fontWithImage: 34,
    fontMinTextOnly: 16,
    fontMinWithImage: 14,
    fontMaxTextOnly: 58,
    fontMaxWithImage: 44,
  },
} as const;

/** ช้าลง 50% — เวลาฮิปโปอ้าปาก/แสดงตัวเลือกให้เด็กอ่านทัน */
const WAM_HIPPO_MOUTH_TIMING = {
  wiggleHalfMs: 240,
  previewPageBaseMs: 1800,
  previewPageMinMs: 240,
  previewSmileHoldMs: 1500,
  previewEndPauseMs: 180,
  spawnOpenDelayMs: 135,
  choiceVisibleMs: 3750,
} as const;

/** จัดรูป / ข้อความ / ลำโพงบนหน้าม้า — ตาม mockup ลูกค้า */
const WAM_CHOICE_LAYOUT = {
  mobile: {
    /** จุดกลางเนื้อหาบนหน้าม้า (เศษของ h, ค่าติดลบ = สูงขึ้น) */
    faceCenterY: -0.03,
    imageMaxW: 0.8,
    imageMaxH: 1.2,
    imageTextGap: 10,
    pillHFactor: 0.3,
    maxPillWFactor: 0.76,
    speakerSize: 30,
    speakerTextGap: 6,
  },
  desktop: {
    faceCenterY: -0.05,
    imageMaxW: 0.86,
    imageMaxH: 0.4,
    imageTextGap: 12,
    pillHFactor: 0.26,
    maxPillWFactor: 0.7,
    speakerSize: 40,
    speakerTextGap: 8,
  },
} as const;

export default class WhackAMoleGameScene extends BaseGameScene {
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
    private titleUI?: {
        container: Phaser.GameObjects.Container;
        box: Phaser.GameObjects.Graphics;
        dom: Phaser.GameObjects.DOMElement;
        title: string;
    };
    private timeUI?: DomHudPill;
    private scoreUI?: DomHudPill;
    private questionProgressUI?: DomHudPill;
    private teacherHintUI?: TeacherHintUI;
    private lastMessageShownMs = 0;
    private lastScoreChangeMs = 0;
    private idleNoScore5MessageShown = false;
    private idleNoScore15MessageShown = false;
    private readonly messageMilestonesSec = [15, 30, 45, 60];
    private milestoneShown = new Set<number>();
    private readonly messageCatalog: Record<string, { text: string; voice?: string }> = {
        intro_start_a: { text: "พร้อมไหม เริ่มตีได้เลย!" },
        intro_start_b: { text: "ตีคำที่ถูกต้องให้ไวเลยนะ!" },
        intro_start_c: { text: "ดูคำข้างบน แล้วรีบตีตัวที่ถูก!" },
        intro_start_d: { text: "มาลุ้นกัน ตีให้ไวเลย!" },

        idle_5_a: { text: "รีบเลือกเลย!" },
        idle_5_b: { text: "คิดออกไหม? ตีได้เลย!" },
        idle_5_c: { text: "ตัวที่ถูกอยู่ตรงไหนน้า?" },
        idle_5_d: { text: "ดูคำบนป้ายแล้วตีเลย!" },

        idle_15_a: { text: "อย่ารอช้าน้า รีบตีเลย!" },
        idle_15_b: { text: "ดูคำที่ตรงกับโจทย์นะ!" },
        idle_15_c: { text: "เวลาผ่านไปแล้ว รีบหน่อย!" },
        idle_15_d: { text: "ลองเลือกตัวที่น่าจะใช่ก่อน!" },

        time_15_a: { text: "15 วินาทีผ่านไป เครื่องติดหรือยังนะ" },
        time_15_b: { text: "15 วินาทีแล้ว เริ่มจับทางได้ยังน้า" },
        time_15_c: { text: "เวลากำลังเดินนะ 15 วินาทีแล้ว" },
        time_30_a: { text: "30 วินาทีผ่านไป ไวกว่านี้ได้อีกนะ" },
        time_30_b: { text: "30 วินาทีแล้ว เร่งมือหน่อยคนเก่ง" },
        time_45_a: { text: "45 วินาทีแล้ว เริ่มจับทางได้ยัง" },
        time_45_b: { text: "45 วินาทีแล้ว ลองตั้งใจดูคำบนป้ายดี ๆ" },
        time_60_a: { text: "60 วินาทีแล้ว สู้ต่ออีกนิด!" },
        time_60_b: { text: "60 วินาทีแล้ว อย่าเพิ่งยอมน้า" },
        time_60_c: { text: "ครบนาทีแล้ว สู้ต่อ! ลุยกันเลย" },

        correct_a: { text: "โดนเลย!" },
        correct_b: { text: "เก่งมาก!" },
        correct_c: { text: "ถูกต้อง!" },
        correct_d: { text: "แม่นมาก!" },
        correct_e: { text: "เยี่ยมเลย!" },
        correct_f: { text: "ตีได้ตรงเป๊ะ!" },

        wrong_a: { text: "อุ๊ย ยังไม่ใช่นะ" },
        wrong_b: { text: "ไม่เป็นไร ลองใหม่!" },
        wrong_c: { text: "เกือบแล้ว!" },
        wrong_d: { text: "ดูโจทย์อีกทีน้า" },
        wrong_e: { text: "ครั้งหน้าเอาใหม่!" },
    };
    private readonly messagePools = {
        intro: ["intro_start_a", "intro_start_b", "intro_start_c", "intro_start_d"],
        idleNoScore5: ["idle_5_a", "idle_5_b", "idle_5_c", "idle_5_d"],
        idleNoScore15: ["idle_15_a", "idle_15_b", "idle_15_c", "idle_15_d"],
        time: {
            15: ["time_15_a", "time_15_b", "time_15_c"],
            30: ["time_30_a", "time_30_b"],
            45: ["time_45_a", "time_45_b"],
            60: ["time_60_a", "time_60_b", "time_60_c"],
        } as Record<number, string[]>,
        correct: ["correct_a", "correct_b", "correct_c", "correct_d", "correct_e", "correct_f"],
        wrong: ["wrong_a", "wrong_b", "wrong_c", "wrong_d", "wrong_e"],
    };
    private timeFlashEvent?: Phaser.Time.TimerEvent;
    private timeFlashSeq = 0;
    private timeBoxColor = 0xffffff;
    private timeRedLoopActive = false;
    private timeTextBaseColor = HUD_VALUE_COLOR;
    private scoreTextBaseColor = HUD_VALUE_COLOR;
    private scoreFlashSeq = 0;
    private hudTimeFontSize: string | null = null;

    private tickingState: "normal" | "danger" | null = null;
    private tickingEvent?: Phaser.Time.TimerEvent;
    private tickingSoundKey: string | null = null;

    private introDecor?: {
        title: Phaser.GameObjects.Image;
        starBlue: Phaser.GameObjects.Image;
        starYellow: Phaser.GameObjects.Image;
        shootingStarBlue: Phaser.GameObjects.Image;
        shootingStarYellow: Phaser.GameObjects.Image;
        shootingStarPink: Phaser.GameObjects.Image;
        shootingStarGreen: Phaser.GameObjects.Image;
        vegetable1: Phaser.GameObjects.Image;
        vegetable2: Phaser.GameObjects.Image;
        hippoCried: Phaser.GameObjects.Image;
        hippoSmiled: Phaser.GameObjects.Image;
    };
    private introHippoSeq = 0;
    private introHippoCriedEvent?: Phaser.Time.TimerEvent;
    private introHippoSmiledEvent?: Phaser.Time.TimerEvent;
    private howToHippos?: { hippoCried: Phaser.GameObjects.Image; hippoSmiled: Phaser.GameObjects.Image };
    private introHippoScales?: { hippoCriedScale: number; hippoSmiledScale: number };

    private pendingPayload?: WhackAMolePayload;
    private correctItems: Array<{ id: number; text: string; image?: string; sound?: string }> = [];
    private wrongItems: Array<{ id: number; text: string; image?: string; sound?: string }> = [];
    private hitCorrectWords = new Set<string>();
    private scoreAnimInFlight: Promise<void> = Promise.resolve();
    private holes: Array<{ x: number; y: number }> = [];
    private holeRows: number[] = [];
    private holeSize?: { w: number; h: number };
    private holeSizeBasis?: { width: number; height: number };
    private holeViews: Array<{
        container: Phaser.GameObjects.Container;
        visual: Phaser.GameObjects.Container;
        back: Phaser.GameObjects.Container;
        front: Phaser.GameObjects.Container;
        backBg: Phaser.GameObjects.Image;
        frontBg: Phaser.GameObjects.Image;
        contentBox: Phaser.GameObjects.Graphics;
        imageFrame: Phaser.GameObjects.Graphics;
        speakerIcon: Phaser.GameObjects.Image;
        label: Phaser.GameObjects.Text;
        contentImage?: Phaser.GameObjects.Image;
    }> = [];
    private spawnEvent?: Phaser.Time.TimerEvent;
    private activeMoles = new Map<
        number,
        {
            view: {
                container: Phaser.GameObjects.Container;
                visual: Phaser.GameObjects.Container;
                back: Phaser.GameObjects.Container;
                front: Phaser.GameObjects.Container;
                backBg: Phaser.GameObjects.Image;
                frontBg: Phaser.GameObjects.Image;
                contentBox: Phaser.GameObjects.Graphics;
                speakerIcon: Phaser.GameObjects.Image;
                label: Phaser.GameObjects.Text;
                contentImage?: Phaser.GameObjects.Image;
            };
            isCorrect: boolean;
            id: number;
            text: string;
            opened: boolean;
            soundUrl: string;
            ttlEvent?: Phaser.Time.TimerEvent;
        }
    >();
    private tutorialPopup?: {
        titleIcon: Phaser.GameObjects.Image;
        howToImage: Phaser.GameObjects.Image;
        startButton: Phaser.GameObjects.Image;
        restoreInputEnabled: boolean;
        restoreLockInput: boolean;
    };
    private showScore = 0;

    private bgmState: "start" | "game" | "result" | null = null;
    private bgmStartSound?: Phaser.Sound.BaseSound;
    private bgmGameSound?: Phaser.Sound.BaseSound;
    private bgmResultSound?: Phaser.Sound.BaseSound;

    constructor() {
        super("whack-a-mole");
    }

    preload() {
        this.load.image("bg_whack_a_mole", "assets/whack-a-mole/bg_whack_a_mole.png");
        this.load.image("bg_whack_a_mole_mobile", "assets/whack-a-mole/bg_whack_a_mole_mobile.png");
        this.load.image("hippo_cried", "assets/whack-a-mole/hippo_cried.png");
        this.load.image("hippo_smiled", "assets/whack-a-mole/hippo_smiled.png");
        this.load.image("hippo_idle", "assets/whack-a-mole/hippo_idle.png");
        this.load.image("star", "assets/whack-a-mole/star.png");
        this.load.image("star_blue", "assets/whack-a-mole/star_blue.png");
        this.load.image("star_yellow", "assets/whack-a-mole/star_yellow.png");
        this.load.image("shooting_star_blue", "assets/whack-a-mole/shooting_star_blue.png");
        this.load.image("shooting_star_yellow", "assets/whack-a-mole/shooting_star_yellow.png");
        this.load.image("shooting_star_pink", "assets/whack-a-mole/shooting_star_pink.png");
        this.load.image("shooting_star_green", "assets/whack-a-mole/shooting_star_green.png");
        this.load.image("title", "assets/whack-a-mole/title.png");
        this.load.image("vegetable_1", "assets/whack-a-mole/vegetable_1.png");
        this.load.image("vegetable_2", "assets/whack-a-mole/vegetable_2.png");
        this.load.image("wam_howtoplay", "assets/whack-a-mole/howtoplay_whack_a_mole.png");
        this.load.image("wam_howtoplay_mobile", "assets/whack-a-mole/howtoplay_whack_a_mole_mobile.png");
        this.load.image("wam_icon_howtoplay", "assets/whack-a-mole/icon_howtoplay_whack_a_mole.png");
        this.load.image("wam_btn_start", "assets/whack-a-mole/btn_start.png");

        this.load.audio("bgm_game_scene", "assets/sound/whack-a-mole/bgm_game_scene_whack_a_mole.mp3");
        this.load.audio("bgm_result", "assets/sound/whack-a-mole/bgm_result_whack_a_mole.mp3");
        this.load.audio("bgm_start", "assets/sound/whack-a-mole/bgm_start_whack_a_mole.mp3");
        this.load.audio("sfx_alert_danger", "assets/sound/sfx_alert_danger_flip_cards.mp3");
        this.load.audio("sfx_alert_warning", "assets/sound/sfx_alert_warning_flip_cards.mp3");
        this.load.audio("sfx_correct", "assets/sound/sfx_correct_flip_cards.mp3");
        this.load.audio("sfx_incorrect", "assets/sound/sfx_incorrect_flip_cards.mp3");
        this.load.audio("sfx_notification_message", "assets/sound/sfx_notification_message_flip_cards.mp3");
        this.load.audio("sfx_whack_message", "assets/sound/sfx_whack.mp3");
        TeacherHintUI.preload(this);
        preloadHudAssets(this);
    }

    async create() {
        super.create();

        this.mobile = isMobileLayout();

        this.scene.launch("HomeScene", {
            gameKey: this.scene.key,
            ui: {
                startButtonPath: "assets/whack-a-mole/btn_start.png",
                startButtonKey: "whack_a_mole_btn_start",
                howToButtonPath: "assets/whack-a-mole/btn_howto.png",
                howToButtonKey: "whack_a_mole_btn_howto",
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
        this.ending = false;
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
        if (this.questionProgressUI) this.tweens.killTweensOf(this.questionProgressUI.dom);
        this.questionProgressUI?.container.destroy(true);
        this.questionProgressUI = undefined;

        this.stopSpawning();
        this.clearMoles();
        this.destroyHoleViews();
        this.holeSize = undefined;
        this.holeSizeBasis = undefined;
        this.correctItems = [];
        this.wrongItems = [];
        this.hitCorrectWords.clear();
        this.imageKeyByUrl.clear();
        this.imageKeySeq = 0;
        this.soundKeyByUrl.clear();
        this.soundKeySeq = 0;
        this.holes = [];
        this.holeRows = [];
        this.teacherHintUI?.destroy();
        this.teacherHintUI = undefined;
        this.lastMessageShownMs = 0;
        this.lastScoreChangeMs = 0;
        this.idleNoScore5MessageShown = false;
        this.idleNoScore15MessageShown = false;
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

        const background = this.add.image(0, 0, this.mobile ? "bg_whack_a_mole_mobile" : "bg_whack_a_mole").setOrigin(0, 0).setDepth(0);
        background.setDisplaySize(worldWidth, worldHeight);

        this.destroyIntroDecor();
        this.createIntroDecor(worldWidth, worldHeight);

        const onResize = (gameSize: Phaser.Structs.Size) => {
            const w = gameSize.width;
            const h = gameSize.height;
            this.cameras.main.setBounds(0, 0, w, h);
            background.setDisplaySize(w, h);
            this.layoutHoles();
        };
        this.scale.on(Phaser.Scale.Events.RESIZE, onResize);
        this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
            this.scale.off(Phaser.Scale.Events.RESIZE, onResize);
            this.stopAllAudio();
            this.stopSpawning();
            this.clearMoles();
            this.destroyHoleViews();
            this.teacherHintUI?.destroy();
            this.teacherHintUI = undefined;
        });
        
        this.scene.get("HomeScene").events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
            this.destroyIntroDecor();
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
            const payload = await this.fetchWhackAMoleData();
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

    // Before End Game - Whack A Mole
    protected override onBeforeEndGame() {
        this.setBgmState("result");
        this.input.enabled = false;
        this.stopSpawning();
        this.clearMoles();
        this.destroyHoleViews();
        this.stopTicking();
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
        this.timeFlashEvent?.destroy();
        this.timeFlashEvent = undefined;
        this.timeBoxColor = 0xffffff;
        this.timeRedLoopActive = false;
        this.timeFlashSeq = 0;
    }

    protected override getRunstateQuestionTotal(): number {
        /** runstate: 1 เกม = 1 ข้อ (ไม่แยกตามจำนวนคำตอบถูกใน mole) */
        return 1;
    }

    // Start Game - Whack A Mole
    private tryStartGame() {
        if (this.gameStarted) return;
        if (!this.startRequested) return;
        if (!this.assetsReady) return;
        if (!this.pendingPayload) return;

        this.gameStarted = true;
        const wamInfo = this.pendingPayload.game_info;
        const centerTitle = getHudSuggestionLabel(wamInfo.suggestion);
        if (hasHudCenterLabel(centerTitle)) {
            this.createTitleContainer(centerTitle);
        }
        this.lockInput = false;
        this.input.enabled = true;
        
        this.createTimeContainer();
        this.createScoreContainer();
        this.hudStarted = false;
        this.hudStartMs = 0;
        this.score = 0;
        this.showScore = 0;
        this.ensureHudTimer();
        this.updateHud();

        this.buildGame(this.pendingPayload);
        this.reportRunstateStart();
    }

    // How To Page - Whack A Mole
    private openHowToPopup() {
        const { width, height } = this.scale;
        const destroyPopup = () => {
            const popup = this.tutorialPopup;
            this.tutorialPopup = undefined;
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
        this.destroyIntroDecor(true);

        const fitTo = (key: string, maxW: number, maxH: number) => {
            const src = this.textures.get(key).getSourceImage() as { width?: number; height?: number };
            const w = src?.width ?? 1;
            const h = src?.height ?? 1;
            const s = Math.min(maxW / w, maxH / h);
            return { w: Math.max(1, w * s), h: Math.max(1, h * s) };
        };

        const titleIconSize = fitTo("wam_icon_howtoplay", this.mobile ? width * 0.86 : width * 0.36, this.mobile ? height * 0.86 : height * 0.2);
        const titleIcon = this.add.image(width / 2, this.mobile ? height / 6 : height / 8, "wam_icon_howtoplay").setDepth(3001);
        titleIcon.setDisplaySize(titleIconSize.w, titleIconSize.h);

        const howToMaxH = this.mobile ? height * 0.62 : height * 0.58;
        const howToSize = fitTo(this.mobile ? "wam_howtoplay_mobile" : "wam_howtoplay", this.mobile ? width * 0.92 : width * 0.88, howToMaxH);
        const howToY = height / 2 + Math.max(12, height * 0.03);
        const howToImage = this.add.image(width / 2, howToY, this.mobile ? "wam_howtoplay_mobile" : "wam_howtoplay").setDepth(3003);
        howToImage.setDisplaySize(howToSize.w, howToSize.h);

        const btnMaxW = Math.min(260, width * (0.40));
        const btnSize = fitTo("wam_btn_start", btnMaxW, height * 0.16);
        const btnY = Math.min(height - btnSize.h / 2 - 24, howToY + howToSize.h / 2 + btnSize.h / 2 + Math.max(14, height * 0.03));
        const startButton = this.add.image(width / 2, btnY, "wam_btn_start").setDepth(3004);
        startButton.setDisplaySize(btnSize.w, btnSize.h);
        startButton.setInteractive({ useHandCursor: true });
        startButton.once("pointerdown", () => {
            this.playSfx("sfx_click_default", 1);
            startButton.disableInteractive();
            destroyPopup();
            if (this.scene.isActive("HomeScene")) this.scene.stop("HomeScene");
        });

        this.tutorialPopup = {
            titleIcon,
            howToImage,
            startButton,
            restoreInputEnabled,
            restoreLockInput,
        };
        this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => destroyPopup());
    }

    private resolveSoundUrl(pathOrUrl: string): string {
        const raw = (pathOrUrl ?? "").trim();
        if (!raw) return "";
        const normalized = raw.toLowerCase();
        if (normalized === "null" || normalized === "undefined") return "";
        if (/^https?:\/\//i.test(raw)) return raw;
        return `${API_BASE_URL}${raw}`;
    }

    private resolveImageUrl(pathOrUrl: string): string {
        const raw = (pathOrUrl ?? "").trim();
        if (!raw) return "";
        if (/^https?:\/\//i.test(raw)) return raw;
        return `${API_BASE_URL}${raw}`;
    }

    private async preloadQuestionImageTextures(payload: WhackAMolePayload): Promise<void> {
        const rawPaths = payload.questions
            ?.flatMap((q) => [q.image_correct_answer, q.image_wrong_answer])
            .filter((v): v is string => typeof v === "string" && v.trim().length > 0) ?? [];

        const urls = rawPaths.map((p) => this.resolveImageUrl(p)).filter(Boolean);
        const uniqueUrls = Array.from(new Set(urls));

        const toLoad: Array<{ key: string; url: string }> = [];
        for (const url of uniqueUrls) {
            if (this.imageKeyByUrl.has(url)) continue;
            const key = `whack_a_mole_img_${this.imageKeySeq++}`;
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

    private async preloadQuestionSoundAudio(payload: WhackAMolePayload): Promise<void> {
        const rawPaths = payload.questions
            ?.flatMap((q) => [q.sound_correct_answer, q.sound_wrong_answer])
            .filter((v): v is string => typeof v === "string" && v.trim().length > 0) ?? [];

        const urls = rawPaths.map((p) => this.resolveSoundUrl(p)).filter(Boolean);
        const uniqueUrls = Array.from(new Set(urls));

        const toLoad: Array<{ key: string; url: string }> = [];
        for (const url of uniqueUrls) {
            if (this.soundKeyByUrl.has(url)) continue;
            const key = `whack_a_mole_snd_${this.soundKeySeq++}`;
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

    // Fetch Data - Whack A Mole
    private async fetchWhackAMoleData(): Promise<WhackAMolePayload> {
        if (this.injectedPayload) {
            return this.injectedPayload as unknown as WhackAMolePayload;
        }
        throw new Error("Missing injected payload for scene: whack-a-mole");
    }

    // Build Game - Whack A Mole
    private countWamQuestions(payload: WhackAMolePayload): number {
        const raw = payload.questions?.filter((q) => (q.correct_answer || q.wrong_answer) && q.id != null) ?? [];
        const texts = raw
            .map((q) => (q.correct_answer ?? "").trim())
            .filter((text) => text.length > 0);
        return new Set(texts).size;
    }

    private buildGame(payload: WhackAMolePayload) {
        this.syncGameAudioFromQuestion(payload.questions?.[0]);

        const raw = payload.questions?.filter((q) => (q.correct_answer || q.wrong_answer) && q.id != null) ?? [];

        const correctItems = raw
            .map((q) => ({
                id: q.id,
                text: (q.correct_answer ?? "").trim(),
                image: typeof q.image_correct_answer === "string" ? this.resolveImageUrl(q.image_correct_answer) : "",
                sound: typeof q.sound_correct_answer === "string" ? this.resolveSoundUrl(q.sound_correct_answer) : "",
            }))
            .filter((x) => x.text.length > 0);
        const wrongItems = raw
            .map((q) => ({
                id: q.id,
                text: (q.wrong_answer ?? "").trim(),
                image: typeof q.image_wrong_answer === "string" ? this.resolveImageUrl(q.image_wrong_answer) : "",
                sound: typeof q.sound_wrong_answer === "string" ? this.resolveSoundUrl(q.sound_wrong_answer) : "",
            }))
            .filter((x) => x.text.length > 0);

        this.correctItems = correctItems;
        this.wrongItems = wrongItems;
        this.hitCorrectWords.clear();
        this.score = 0;
        this.showScore = 0;
        this.totalQuestions = this.countWamQuestions(payload);
        this.layoutQuestionProgress();

        this.stopSpawning();
        this.clearMoles();
        this.layoutHoles();

        this.lockInput = true;
        this.input.enabled = false;
        void (async () => {
            await this.runIntroHippoWiggleOpenMouth();
            if (!this.sys.isActive()) return;
            this.lockInput = false;
            this.input.enabled = true;
            this.startSpawning();
            this.hudStartMs = Date.now();
            this.startTime = this.hudStartMs;
            this.hudStarted = true;
            this.updateHud();
            this.onGameplayStarted();
        })();
    }

    private layoutHoles() {
        const { width, height } = this.scale;
        const holes: Array<{ x: number; y: number }> = [];
        const rowsByHole: number[] = [];

        const marginX = width * (this.mobile ? 0.20 : 0.15);
        const left = marginX;
        const right = width - marginX;
        const availableW = Math.max(1, right - left);
        const centerX = left + availableW / 2;

        const answerCount = this.correctItems.length + this.wrongItems.length;
        const desiredHoleCount = Phaser.Math.Clamp(answerCount > 0 ? answerCount : 10, 2, 10);

        const getRowCounts = (count: number, mobile: boolean): number[] => {
            if (mobile) {
                if (count === 2) return [2];
                if (count === 4) return [2, 2];
                if (count === 6) return [3, 3];
                if (count === 8) return [3, 3, 2];
                if (count === 10) return [3, 3, 3, 1];
                return [3, 3, 3];
            }

            if (count === 2) return [2];
            if (count === 4) return [2, 2];
            if (count === 6) return [3, 3];
            if (count === 8) return [3, 2, 3];
            if (count === 10) return [3, 4, 3];
            return [3, 4, Math.max(0, count - 7)];
        };

        const getRowYs = (rowCount: number, mobile: boolean): number[] => {
            const { width, height } = this.scale;
            const shortMobile = mobile && isShortMobileViewport(height, width);
            const tinyMobile = mobile && isTinyMobileViewport(height, width);
            const topMarginY = mobile ? height * (tinyMobile ? 0.03 : shortMobile ? 0.04 : 0.05) : 0;
            const compress = tinyMobile ? 0.88 : shortMobile ? 0.94 : 1;
            const centerY = height * 0.5;
            const scaleY = (y: number) => centerY + (y - centerY) * compress;
            const base =
                rowCount <= 1
                    ? [height * 0.52]
                    : rowCount === 2
                      ? mobile
                          ? [height * 0.28, height * 0.57]
                          : [height * 0.33, height * 0.71]
                      : rowCount === 3
                        ? mobile
                            ? [height * 0.20, height * 0.46, height * 0.72]
                            : [height * 0.25, height * 0.52, height * 0.79]
                        : mobile
                          ? [height * 0.18, height * 0.38, height * 0.58, height * 0.76]
                          : [height * 0.18, height * 0.39, height * 0.65, height * 0.86];
            const scaled = mobile ? base.map(scaleY) : base;
            return topMarginY > 0 ? scaled.map((y) => y + topMarginY) : scaled;
        };

        const rowCounts = getRowCounts(desiredHoleCount, this.mobile);
        const ys = getRowYs(rowCounts.length, this.mobile);
        const maxCols = this.mobile ? 3 : 4;
        const deltaX = maxCols > 1 ? availableW / (maxCols - 1) : 0;

        for (let r = 0; r < rowCounts.length; r++) {
            const cols = rowCounts[r];
            let finalXs: number[];
            if (this.mobile && desiredHoleCount >= 8 && cols < 3) {
                finalXs = Array.from({ length: cols }, (_v, i) => right - i * deltaX);
            } else {
                const span = (cols - 1) * deltaX;
                const startX = centerX - span / 2;
                const xs = Array.from({ length: cols }, (_v, i) => startX + i * deltaX);
                finalXs = this.mobile ? [...xs].reverse() : xs;
            }
            for (let c = 0; c < cols; c++) {
                holes.push({ x: finalXs[c], y: ys[r] ?? height * 0.52 });
                rowsByHole.push(r);
            }
        }
        this.holes = holes;
        this.holeRows = rowsByHole;
        this.ensureHoleViews();
        this.positionHoleViews();
    }

    private destroyHoleViews() {
        for (const view of this.holeViews) {
            view.container.destroy(true);
        }
        this.holeViews = [];
    }

    private fitImageToBox(img: Phaser.GameObjects.Image, boxW: number, boxH: number) {
        const src = img.texture.getSourceImage() as { width?: number; height?: number };
        const srcW = src?.width ?? 1;
        const srcH = src?.height ?? 1;
        const s = Math.min(boxW / srcW, boxH / srcH);
        img.setDisplaySize(Math.max(1, srcW * s), Math.max(1, srcH * s));
    }

    /** ยึดขนาดจาก hippo_idle — ไม่ให้ hippo_smiled / hippo_cried ดูเล็กกว่าเพราะ padding ในไฟล์ต่างกัน */
    private fitHippoToHole(img: Phaser.GameObjects.Image, key: string, holeW: number, holeH: number) {
        img.setTexture(key);
        const ref = this.textures.get("hippo_idle").getSourceImage() as { width?: number; height?: number };
        const refW = ref?.width ?? 1;
        const refH = ref?.height ?? 1;
        const scale = Math.min(holeW / refW, holeH / refH);
        img.setDisplaySize(Math.max(1, Math.round(refW * scale)), Math.max(1, Math.round(refH * scale)));
    }

    private setHippoTexture(img: Phaser.GameObjects.Image, key: string, holeW: number, holeH: number) {
        this.fitHippoToHole(img, key, holeW, holeH);
    }

    private getHoleSize() {
        const { width, height } = this.scale;
        const basis = this.holeSizeBasis;
        if (this.holeSize && basis) {
            const dw = basis.width > 0 ? Math.abs(width - basis.width) / basis.width : 0;
            const dh = basis.height > 0 ? Math.abs(height - basis.height) / basis.height : 0;
            if (dw <= 0.2 && dh <= 0.2) return this.holeSize;
        }

        const w = this.mobile ? width * 0.25 : width * 0.20;
        const h = this.mobile ? height * 0.12 : height * 0.20;
        this.holeSize = { w, h };
        this.holeSizeBasis = { width, height };
        return this.holeSize;
    }

    private ensureHoleViews() {
        if (this.holes.length === 0) return;
        if (this.holeViews.length === this.holes.length) return;

        this.destroyHoleViews();
        const { w, h } = this.getHoleSize();
        const defaultFontPx = this.resolveWamChoiceFontPx("", false);

        for (let i = 0; i < this.holes.length; i++) {
            const backBg = this.add.image(0, 0, "hippo_idle");
            this.fitHippoToHole(backBg, "hippo_idle", w, h);
            const back = this.add.container(0, 0, [backBg]);

            const frontBg = this.add.image(0, 0, "hippo_smiled");
            this.fitHippoToHole(frontBg, "hippo_smiled", w, h);
            const contentBox = this.add.graphics();
            const imageFrame = this.add.graphics().setVisible(false);
            const speakerIcon = this.add
                .image(0, 0, HUD_VOLUME_TEXTURE_KEY)
                .setOrigin(0.5, 0.5)
                .setVisible(false);
            const label = this.add
                .text(0, 0, "", {
                    font: `700 ${defaultFontPx}px "Noto Sans Thai", sans-serif`,
                    color: "#AD6F0B",
                    align: "center",
                    wordWrap: { width: w * 0.74, useAdvancedWrap: true },
                    stroke: "#FFFFFF",
                    strokeThickness: this.mobile ? 3 : 4,
                })
                .setOrigin(0.5, 0.5);

            const front = this.add.container(0, 0, [frontBg, imageFrame, contentBox, label, speakerIcon]);
            front.setVisible(false);

            const visual = this.add.container(0, 0, [back, front]).setDepth(30);
            const container = this.add.container(0, 0, [visual]).setDepth(30);
            container.setSize(w, h);
            container.disableInteractive();

            const holeIndex = i;
            container.on("pointerdown", () => {
                if (!this.input.enabled) return;
                const active = this.activeMoles.get(holeIndex);
                if (!active || !active.opened) return;
                active.opened = false;
                active.view.container.disableInteractive();
                void this.handleMoleHit(holeIndex, active);
            });

            this.holeViews.push({
                container,
                visual,
                back,
                front,
                backBg,
                frontBg,
                contentBox,
                imageFrame,
                speakerIcon,
                label,
            });
        }
    }

    private positionHoleViews() {
        if (this.holeViews.length !== this.holes.length) return;

        const { w, h } = this.getHoleSize();

        for (let i = 0; i < this.holeViews.length; i++) {
            const view = this.holeViews[i];
            const pos = this.holes[i];
            view.container.setPosition(pos.x, pos.y);
            view.container.setScale(1);
            const active = this.activeMoles.get(i);
            const isOpened = !!active && active.opened;
            view.container.setDepth(isOpened ? 200 : 30);
            view.visual.setDepth(isOpened ? 200 : 30);
            this.fitHippoToHole(view.backBg, view.backBg.texture.key, w, h);
            this.fitHippoToHole(view.frontBg, view.frontBg.texture.key, w, h);

            const labelText = (view.label.text ?? "").trim();
            const hasContentImage = !!view.contentImage && view.contentImage.active;
            const soundUrl = (active?.soundUrl ?? (view.container.getData("wamPreviewSoundUrl") as string) ?? "").trim();
            const hasSound = !!soundUrl && !!this.soundKeyByUrl.get(soundUrl);

            this.layoutWamHoleChoice(view, w, h, {
                labelText,
                hasImage: hasContentImage,
                hasSound,
            });

            if (isOpened) {
                view.container.setInteractive({ useHandCursor: true });
            } else {
                view.container.disableInteractive();
            }
        }
    }

    private layoutWamHoleChoice(
        view: (typeof this.holeViews)[number],
        w: number,
        h: number,
        options: { labelText: string; hasImage: boolean; hasSound: boolean }
    ) {
        const { labelText, hasImage, hasSound } = options;
        const lc = this.mobile ? WAM_CHOICE_LAYOUT.mobile : WAM_CHOICE_LAYOUT.desktop;
        const fillColor = 0xeddec7;
        const strokeColor = 0xad6f0b;
        const faceCenterY = h * lc.faceCenterY;
        const pillH = Math.max(this.mobile ? 28 : 34, Math.floor(h * lc.pillHFactor));
        const pillPadX = this.mobile ? 10 : 12;
        const speakerSize = lc.speakerSize;
        const speakerGap = lc.speakerTextGap;
        const strokeW = this.mobile ? 3 : 4;

        const fontPx = this.resolveWamChoiceFontPx(labelText, hasImage);
        const fontSize = `${fontPx}px`;
        const tc = this.mobile ? WAM_CHOICE_TEXT_TUNING.mobile : WAM_CHOICE_TEXT_TUNING.desktop;
        const minFontPx = hasImage ? tc.fontMinWithImage : tc.fontMinTextOnly;
        const minPillW = this.mobile ? 52 : 68;
        const maxPillW = w * lc.maxPillWFactor;
        const textW = labelText
          ? measureThaiTextWidth(labelText, {
              fontSizePx: fontPx,
              fontWeight: 700,
              strokeWidthPx: strokeW,
            })
          : minPillW;
        const pillW = Phaser.Math.Clamp(textW + pillPadX * 2, minPillW, maxPillW);
        const rowW = hasSound ? speakerSize + speakerGap + pillW : pillW;
        const rowLeft = -rowW / 2;

        let textCenterY = faceCenterY;
        let contentTop = faceCenterY - pillH / 2;

        if (hasImage && view.contentImage) {
            const img = view.contentImage;
            const src = this.textures.get(img.texture.key).getSourceImage() as {
                width?: number;
                height?: number;
            };
            const srcW = src?.width ?? 1;
            const srcH = src?.height ?? 1;
            const maxFrameW = w * lc.imageMaxW;
            const maxFrameH = h * lc.imageMaxH;
            const framePad = this.mobile ? 6 : 8;
            const innerMaxW = Math.max(1, maxFrameW - framePad * 2);
            const innerMaxH = Math.max(1, maxFrameH - framePad * 2);
            const fit = fitQuestionMediaContainSize(srcW, srcH, innerMaxW, innerMaxH);
            const frameW = Math.min(maxFrameW, fit.imageW + framePad * 2);
            const frameH = Math.min(maxFrameH, fit.imageH + framePad * 2);

            const imageCenterY = faceCenterY;
            view.imageFrame.setVisible(true);
            view.imageFrame.setPosition(0, imageCenterY);
            drawQuestionMediaFrameBox(view.imageFrame, frameW, frameH, 1, 0xd8d8d8);

            img.setDisplaySize(fit.imageW, fit.imageH);
            img.setVisible(true);
            img.setPosition(0, imageCenterY);
            textCenterY = imageCenterY + frameH / 2 + lc.imageTextGap + pillH / 2;
            contentTop = imageCenterY - frameH / 2;
        } else {
            view.imageFrame.setVisible(false);
            view.imageFrame.clear();
            if (view.contentImage) {
                view.contentImage.setVisible(false);
            }
        }

        const pillLeft = hasSound ? rowLeft + speakerSize + speakerGap : -pillW / 2;
        const pillTop = textCenterY - pillH / 2;
        const radius = Math.max(6, Math.min(14, Math.floor(pillH * 0.3)));
        const lineW = Math.max(2, Math.floor(Math.min(w, h) * 0.025));

        view.contentBox.clear();
        if (labelText) {
            view.contentBox.fillStyle(fillColor, 1);
            view.contentBox.lineStyle(lineW, strokeColor, 1);
            view.contentBox.fillRoundedRect(pillLeft, pillTop, pillW, pillH, radius);
            view.contentBox.strokeRoundedRect(pillLeft, pillTop, pillW, pillH, radius);
            view.contentBox.setVisible(true);
        } else {
            view.contentBox.setVisible(false);
        }

        const wrapW = Math.floor(pillW - pillPadX * 2);
        if (this.mobile) {
            view.label.setStyle({
                font: `700 ${fontPx}px "Noto Sans Thai", sans-serif`,
                color: "#AD6F0B",
                wordWrap: { width: wrapW, useAdvancedWrap: true },
            });
        } else {
            view.label.setStyle({
                font: `700 ${fontPx}px "Noto Sans Thai", sans-serif`,
                color: "#AD6F0B",
                wordWrap: { width: 0, useAdvancedWrap: false },
            });
        }

        view.label.setPosition(pillLeft + pillW / 2, textCenterY);
        if (labelText) {
            view.label.setVisible(true);
            if (this.mobile) {
                this.fitLabelInContentBox(view.label, textCenterY, pillH, fontSize, "center", textCenterY, minFontPx);
            } else {
                this.fitDesktopSingleLineLabel(view.label, wrapW, fontSize, minFontPx);
            }
        } else {
            view.label.setVisible(false);
        }

        if (hasSound && labelText) {
            view.speakerIcon.setVisible(true);
            view.speakerIcon.setTexture(HUD_VOLUME_TEXTURE_KEY);
            view.speakerIcon.setPosition(rowLeft + speakerSize / 2, textCenterY);
            view.speakerIcon.setDisplaySize(speakerSize, speakerSize);
        } else {
            view.speakerIcon.setVisible(false);
        }

        const contentBottom = pillTop + pillH;
        view.container.setSize(Math.max(w, rowW + 16), Math.max(h * 0.92, contentBottom - contentTop + h * 0.22));
    }

    private getWamVisualTextLen(text: string): number {
        return text.replace(/\s+/g, "").replace(/[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/g, "").length;
    }

    private resolveWamChoiceFontPx(text: string, hasImage: boolean): number {
        const tc = this.mobile ? WAM_CHOICE_TEXT_TUNING.mobile : WAM_CHOICE_TEXT_TUNING.desktop;
        const baseFont = hasImage ? tc.fontWithImage : tc.fontTextOnly;
        const fontMin = hasImage ? tc.fontMinWithImage : tc.fontMinTextOnly;
        const fontMax = hasImage ? tc.fontMaxWithImage : tc.fontMaxTextOnly;
        const visualTextLen = this.getWamVisualTextLen(text);
        let fontDelta = 0;
        if (visualTextLen <= 2) fontDelta = this.mobile ? 8 : 12;
        else if (visualTextLen <= 4) fontDelta = this.mobile ? 5 : 8;
        else if (visualTextLen <= 7) fontDelta = this.mobile ? 2 : 4;
        else if (visualTextLen <= 10) fontDelta = 0;
        else if (visualTextLen <= 14) fontDelta = this.mobile ? -3 : -5;
        else fontDelta = this.mobile ? -6 : -10;
        return Phaser.Math.Clamp(baseFont + fontDelta, fontMin, fontMax);
    }

    private fitLabelInContentBox(
        label: Phaser.GameObjects.Text,
        boxY: number,
        boxH: number,
        baseFontSize: string,
        mode: "center" | "below",
        baseY: number,
        minFontPxOverride?: number
    ) {
        const basePx = Math.max(1, Math.floor(parseFloat(String(baseFontSize).replace("px", "")) || 1));
        const boxTop = boxY - boxH / 2 + Math.max(2, boxH * 0.06);
        const boxBottom = boxY + boxH / 2 - Math.max(2, boxH * 0.06);
        const availableH = boxBottom - boxTop;
        const minFontPx = minFontPxOverride ?? Math.max(10, Math.floor(basePx * 0.68));
        const fontAt = (px: number) => `700 ${px}px "Noto Sans Thai", sans-serif`;

        label.setStyle({ font: fontAt(basePx) });
        label.updateText();

        const measuredH = label.height;
        if (measuredH > availableH + 0.5) {
            const ratio = availableH / Math.max(1, measuredH);
            const nextPx = Math.max(minFontPx, Math.floor(basePx * ratio * 0.98));
            if (nextPx !== basePx) {
                label.setStyle({ font: fontAt(nextPx) });
                label.updateText();
            }
        }

        const finalH = label.height;
        const minY = boxTop + finalH * label.originY;
        const maxYFree = boxBottom - finalH * (1 - label.originY);

        if (mode === "center") {
            label.y = Phaser.Math.Clamp(baseY, minY, maxYFree);
            return;
        }

        const maxY = Math.min(baseY, maxYFree);
        label.y = minY <= maxY ? Phaser.Math.Clamp(baseY, minY, maxY) : baseY;
    }

    private fitDesktopSingleLineLabel(
        label: Phaser.GameObjects.Text,
        maxWidth: number,
        baseFontSize: string,
        minFontPxOverride?: number
    ) {
        const basePx = Math.max(1, Math.floor(parseFloat(String(baseFontSize).replace("px", "")) || 1));
        const minFontPx = minFontPxOverride ?? Math.max(10, Math.floor(basePx * 0.68));
        const fullText = label.text ?? "";
        const fontAt = (px: number) => `700 ${px}px "Noto Sans Thai", sans-serif`;

        label.setStyle({ font: fontAt(basePx), wordWrap: { width: 0, useAdvancedWrap: false } });
        label.updateText();

        if (label.width <= maxWidth + 0.5) return;

        const ratio = maxWidth / Math.max(1, label.width);
        const nextPx = Math.max(minFontPx, Math.floor(basePx * ratio * 0.98));
        if (nextPx !== basePx) {
            label.setStyle({ font: fontAt(nextPx) });
            label.updateText();
        }

        if (label.width <= maxWidth + 0.5) return;

        const overflowRatio = maxWidth / Math.max(1, label.width);
        const estimatedChars = Math.max(1, Math.floor(fullText.length * overflowRatio) - 1);
        const trimmed = fullText.slice(0, estimatedChars).trimEnd();
        label.setText(trimmed.length > 0 ? `${trimmed}…` : "…");
        label.updateText();

        if (label.width <= maxWidth + 0.5) return;

        const overflowRatio2 = maxWidth / Math.max(1, label.width);
        const estimatedChars2 = Math.max(1, Math.floor(estimatedChars * overflowRatio2) - 1);
        const trimmed2 = fullText.slice(0, estimatedChars2).trimEnd();
        label.setText(trimmed2.length > 0 ? `${trimmed2}…` : "…");
        label.updateText();
    }

    private resetHoleToIdle(holeIndex: number) {
        const view = this.holeViews[holeIndex];
        if (!view) return;
        const pos = this.holes[holeIndex];
        const { w, h } = this.getHoleSize();
        if (pos) view.container.setPosition(pos.x, pos.y);
        this.tweens.killTweensOf(view.container);
        this.tweens.killTweensOf(view.visual);
        view.container.setDepth(30);
        view.visual.setDepth(30);
        view.container.setScale(1);
        view.container.setAlpha(1);
        view.container.disableInteractive();
        this.setHippoTexture(view.backBg, "hippo_idle", w, h);
        this.setHippoTexture(view.frontBg, "hippo_smiled", w, h);
        view.contentImage?.destroy();
        view.contentImage = undefined;
        view.imageFrame.setVisible(false);
        view.imageFrame.clear();
        view.label.setText("");
        view.container.setData("wamPreviewSoundUrl", "");
        view.speakerIcon.setVisible(false);
        view.contentBox.setVisible(true);
        view.back.setVisible(true);
        view.front.setVisible(false);
    }

    // Stop Spawning - Whack A Mole
    private stopSpawning() {
        this.spawnEvent?.destroy();
        this.spawnEvent = undefined;
    }

    // Clear Moles - Whack A Mole
    private clearMoles() {
        for (const [holeIndex, m] of this.activeMoles.entries()) {
            m.ttlEvent?.destroy();
            m.view.contentImage?.destroy();
            m.view.contentImage = undefined;
            this.resetHoleToIdle(holeIndex);
        }
        this.activeMoles.clear();
    }

    private despawnActiveMole(holeIndex: number) {
        const active = this.activeMoles.get(holeIndex);
        if (!active) return;
        active.ttlEvent?.destroy();
        active.opened = false;
        active.view.container.disableInteractive();
        this.flipHole(active.view, false, () => {
            this.resetHoleToIdle(holeIndex);
            this.activeMoles.delete(holeIndex);
        });
    }

    private playSpawnSound(soundUrl?: string) {
        const resolvedUrl = (soundUrl ?? "").trim();
        if (!resolvedUrl) return;
        const key = this.soundKeyByUrl.get(resolvedUrl);
        if (!key) return;
        if (!this.cache.audio.exists(key)) return;
        guardedScenePlayQuestion(this, key, 1);
    }

    private sleep(ms: number): Promise<void> {
        return new Promise<void>((resolve) => {
            this.time.delayedCall(Math.max(0, Math.floor(ms)), () => resolve());
        });
    }

    private getHoleRowIndex(holeIndex: number) {
        return this.holeRows[holeIndex] ?? 0;
    }

    private async runIntroHippoWiggleOpenMouth() {
        if (!this.sys.isActive()) return;
        if (this.holes.length === 0) this.layoutHoles();
        this.ensureHoleViews();
        this.positionHoleViews();

        this.lockInput = true;
        this.input.enabled = false;

        const { w, h } = this.getHoleSize();
        for (let i = 0; i < this.holeViews.length; i++) {
            const view = this.holeViews[i];
            this.setHippoTexture(view.backBg, "hippo_idle", w, h);
            view.back.setVisible(true);
            view.front.setVisible(false);
            view.visual.setAngle(0);
            view.backBg.setAngle(0);
            view.frontBg.setAngle(0);
        }

        const maxRow = Math.max(1, this.holeRows.reduce((max, v) => Math.max(max, v + 1), 0));
        const wiggleAngle = 8;
        const rounds = 4;
        const repeats = rounds * 2 - 1;

        const rowTweens: Phaser.Tweens.Tween[] = [];
        for (let row = 0; row < maxRow; row++) {
            const targets = this.holeViews
                .map((v, idx) => ({ v, idx }))
                .filter((x) => this.getHoleRowIndex(x.idx) === row)
                .map((x) => x.v.backBg);

            if (targets.length === 0) continue;

            const startAngle = (row % 2 === 0 ? 1 : -1) * wiggleAngle;
            const tween = this.tweens.add({
                targets,
                angle: { from: startAngle, to: -startAngle },
                duration: WAM_HIPPO_MOUTH_TIMING.wiggleHalfMs,
                yoyo: true,
                repeat: repeats,
                ease: "Sine.easeInOut",
            });
            rowTweens.push(tween);
        }

        await new Promise<void>((resolve) => {
            if (rowTweens.length === 0) {
                resolve();
                return;
            }
            let remaining = rowTweens.length;
            for (const tween of rowTweens) {
                tween.setCallback("onComplete", () => {
                    remaining -= 1;
                    if (remaining <= 0) resolve();
                });
            }
        });

        if (!this.sys.isActive()) return;

        for (const view of this.holeViews) {
            view.backBg.setAngle(0);
        }

        const previewItems = [
            ...this.correctItems.map((x) => ({
                text: (x.text ?? "").trim(),
                imageUrl: (x.image ?? "").trim(),
                soundUrl: (x.sound ?? "").trim(),
            })),
            ...this.wrongItems.map((x) => ({
                text: (x.text ?? "").trim(),
                imageUrl: (x.image ?? "").trim(),
                soundUrl: (x.sound ?? "").trim(),
            })),
        ].filter((x) => x.text.length > 0);

        const uniquePreviewItems = Array.from(
            new Map(previewItems.map((x) => [`${x.text}__${x.imageUrl}`, x] as const)).values()
        );
        const showWordPreview = uniquePreviewItems.length > 0;

        if (!showWordPreview) {
            for (const view of this.holeViews) {
                this.setHippoTexture(view.backBg, "hippo_smiled", w, h);
            }
            await this.sleep(WAM_HIPPO_MOUTH_TIMING.previewSmileHoldMs);
            for (const view of this.holeViews) {
                this.setHippoTexture(view.backBg, "hippo_idle", w, h);
            }
        } else {
            const shuffled = Phaser.Utils.Array.Shuffle([...uniquePreviewItems]);
            const pageSize = Math.max(1, this.holeViews.length);
            const pages = Math.max(1, Math.ceil(shuffled.length / pageSize));
            const perPageMs = Math.max(
                WAM_HIPPO_MOUTH_TIMING.previewPageMinMs,
                Math.floor(WAM_HIPPO_MOUTH_TIMING.previewPageBaseMs / pages)
            );

            for (let page = 0; page < pages; page++) {
                const base = page * pageSize;
                for (let i = 0; i < this.holeViews.length; i++) {
                    const view = this.holeViews[i];
                    const item = shuffled[base + i];
                    if (!item) {
                        this.resetHoleToIdle(i);
                        continue;
                    }

                    this.resetHoleToIdle(i);
                    this.setHippoTexture(view.frontBg, "hippo_smiled", w, h);
                    view.label.setText(item.text).setVisible(true);
                    view.container.setData("wamPreviewSoundUrl", item.soundUrl ?? "");

                    const textureKey = this.imageKeyByUrl.get(item.imageUrl);
                    if (textureKey && this.textures.exists(textureKey)) {
                        const img = this.add.image(0, 0, textureKey);
                        view.front.addAt(img, 2);
                        view.contentImage = img;
                    }

                    this.flipHole(view, true);
                }

                this.positionHoleViews();
                await this.sleep(perPageMs);
            }

            for (let i = 0; i < this.holeViews.length; i++) {
                this.resetHoleToIdle(i);
            }
        }

        await this.sleep(WAM_HIPPO_MOUTH_TIMING.previewEndPauseMs);
    }

    private flipHole(
        view: {
            visual: Phaser.GameObjects.Container;
            back: Phaser.GameObjects.Container;
            front: Phaser.GameObjects.Container;
        },
        showFront: boolean,
        onComplete?: () => void
    ) {
        view.visual.setScale(1, 1);
        view.back.setVisible(!showFront);
        view.front.setVisible(showFront);
        if (typeof onComplete === "function") onComplete();
    }

    // Start Spawning - Whack A Mole
    private startSpawning() {
        this.stopSpawning();
        this.clearMoles();
        if (this.holes.length === 0) this.layoutHoles();
        this.ensureHoleViews();
        this.positionHoleViews();

        const spawnOnce = () => {
            if (!this.sys.isActive()) return;
            if (!this.gameStarted) return;
            if (!this.input.enabled) return;
            if (this.ending) return;

            const freeHoleIndices = this.holes
                .map((_h, idx) => idx)
                .filter((idx) => !this.activeMoles.has(idx));
            if (freeHoleIndices.length === 0) return;

            const holeIndex = Phaser.Utils.Array.GetRandom(freeHoleIndices);
            const availableCorrect = this.correctItems.filter((x) => !this.hitCorrectWords.has((x.text ?? "").trim()));
            if (availableCorrect.length === 0) return;
            const availableWrong = this.wrongItems;
            if (availableCorrect.length === 0 && availableWrong.length === 0) return;
            const shouldSpawnCorrect =
                availableCorrect.length > 0 &&
                (availableWrong.length === 0 || Math.random() < 0.6);

            let label = "-";
            let id = -1;
            let isCorrect = false;
            let imageUrl = "";
            let soundUrl = "";

            if (shouldSpawnCorrect) {
                const item = availableCorrect.length > 0 ? Phaser.Utils.Array.GetRandom(availableCorrect) : undefined;
                if (item) {
                    label = item.text;
                    id = item.id;
                    isCorrect = true;
                    imageUrl = (item.image ?? "").trim();
                    soundUrl = (item.sound ?? "").trim();
                }
            } else {
                if (availableWrong.length > 0) {
                    const item = Phaser.Utils.Array.GetRandom(availableWrong);
                    label = item.text;
                    id = item.id;
                    isCorrect = false;
                    imageUrl = (item.image ?? "").trim();
                    soundUrl = (item.sound ?? "").trim();
                } else {
                    const item = availableCorrect.length > 0 ? Phaser.Utils.Array.GetRandom(availableCorrect) : undefined;
                    if (item) {
                        label = item.text;
                        id = item.id;
                        isCorrect = true;
                        imageUrl = (item.image ?? "").trim();
                        soundUrl = (item.sound ?? "").trim();
                    }
                }
            }

            if (id < 0) return;

            const view = this.holeViews[holeIndex];
            if (!view) return;

            this.resetHoleToIdle(holeIndex);
            view.container.setDepth(30);
            view.label.setText(label).setVisible(true);

            view.contentImage?.destroy();
            view.contentImage = undefined;

            const textureKey = this.imageKeyByUrl.get(imageUrl);
            if (textureKey && this.textures.exists(textureKey)) {
                const img = this.add.image(0, 0, textureKey);
                view.front.addAt(img, 2);
                view.contentImage = img;
            }

            const despawn = () => {
                const active = this.activeMoles.get(holeIndex);
                if (!active) return;
                active.ttlEvent?.destroy();
                active.opened = false;
                active.view.container.disableInteractive();
                this.flipHole(active.view, false, () => {
                    this.resetHoleToIdle(holeIndex);
                    this.activeMoles.delete(holeIndex);
                });
            };

            const ttlEvent = this.time.delayedCall(WAM_HIPPO_MOUTH_TIMING.choiceVisibleMs, () => despawn());
            this.activeMoles.set(holeIndex, {
                view,
                isCorrect,
                id,
                text: label,
                opened: false,
                soundUrl,
                ttlEvent,
            });

            this.time.delayedCall(WAM_HIPPO_MOUTH_TIMING.spawnOpenDelayMs, () => {
                const active = this.activeMoles.get(holeIndex);
                if (!active) return;
                this.positionHoleViews();
                this.playSpawnSound(active.soundUrl);
                this.flipHole(active.view, true, () => {
                    active.opened = true;
                    active.view.container.setDepth(200);
                    active.view.visual.setDepth(200);
                    active.view.container.setInteractive({ useHandCursor: true });
                });
            });
        };

        spawnOnce();
        this.spawnEvent = this.time.addEvent({
            delay: 1200,
            loop: true,
            callback: spawnOnce,
        });
    }

    // Handle Mole Hit - Whack A Mole
    private async handleMoleHit(
        holeIndex: number,
        mole: {
            view: {
                container: Phaser.GameObjects.Container;
                visual: Phaser.GameObjects.Container;
                back: Phaser.GameObjects.Container;
                front: Phaser.GameObjects.Container;
                backBg: Phaser.GameObjects.Image;
                frontBg: Phaser.GameObjects.Image;
                contentBox: Phaser.GameObjects.Graphics;
                speakerIcon: Phaser.GameObjects.Image;
                label: Phaser.GameObjects.Text;
                contentImage?: Phaser.GameObjects.Image;
            };
            isCorrect: boolean;
            id: number;
            text: string;
            opened: boolean;
            soundUrl: string;
            ttlEvent?: Phaser.Time.TimerEvent;
        }
    ) {
        mole.ttlEvent?.destroy();
        if (this.ending) {
            this.flipHole(mole.view, false, () => {
                this.resetHoleToIdle(holeIndex);
                this.activeMoles.delete(holeIndex);
            });
            return;
        }
        this.playSfx("sfx_whack", 1);
        const word = (mole.text ?? "").trim() || (mole.view.label?.text ?? "").trim();

        if (mole.isCorrect) {
            this.playSfx("sfx_correct", 1);
            this.score += 10;
            if (word) {
                this.hitCorrectWords.add(word);
                const toRemove: number[] = [];
                for (const [idx, other] of this.activeMoles.entries()) {
                    if (idx === holeIndex) continue;
                    if (!other.isCorrect) continue;
                    const otherWord = (other.text ?? "").trim() || (other.view.label?.text ?? "").trim();
                    if (otherWord === word) toRemove.push(idx);
                }
                for (const idx of toRemove) this.despawnActiveMole(idx);
            }
            this.onScoreIncreased();
            const plusOneDone = this.showScorePlusOne(mole.view.container.x, mole.view.container.y);
            this.createParticleBurst(mole.view.container.x, mole.view.container.y, mole.view.container.depth + 4);
            this.showRandomMessage(this.messagePools.correct, undefined, "clap");
            this.tweens.add({
                targets: mole.view.container,
                y: "-=18",
                scale: 1.06,
                duration: 220,
                yoyo: true,
                ease: "Back.easeOut",
                onComplete: () => {
                    if (!this.sys.isActive()) return;
                    this.flipHole(mole.view, false, () => {
                        this.resetHoleToIdle(holeIndex);
                        this.activeMoles.delete(holeIndex);
                    });
                },
            });

            const scoreAnim = (async () => {
                await plusOneDone;
                if (!this.sys.isActive()) return;
                this.showScore += 10;
                this.updateHud();
                await this.animateScoreHud();
            })();
            this.scoreAnimInFlight = scoreAnim;
            await scoreAnim;
            if (this.totalQuestions != null && this.hitCorrectWords.size >= this.totalQuestions) {
                this.finishGame();
                return;
            }
            return;
        }

        this.playSfx("sfx_incorrect", 1);
        this.score -= 10;
        this.onScoreDecreased();
        const minusOneDone = this.showScoreMinusOne(mole.view.container.x, mole.view.container.y);

        const { w, h } = this.getHoleSize();
        this.setHippoTexture(mole.view.frontBg, "hippo_cried", w, h);
        mole.view.contentImage?.destroy();
        mole.view.contentImage = undefined;
        mole.view.contentBox.setVisible(false);
        mole.view.label.setVisible(false);
        this.showRandomMessage(this.messagePools.wrong, undefined, "point");
        const baseX = mole.view.container.x;
        this.tweens.add({
            targets: mole.view.container,
            x: { from: baseX - 12, to: baseX + 12 },
            duration: 60,
            repeat: 3,
            yoyo: true,
            ease: "Sine.easeInOut",
            onComplete: () => {
                if (!this.sys.isActive()) return;
                mole.view.container.x = baseX;
                this.flipHole(mole.view, false, () => {
                    this.resetHoleToIdle(holeIndex);
                    this.activeMoles.delete(holeIndex);
                });
            },
        });

        const scoreAnim = (async () => {
            await minusOneDone;
            if (!this.sys.isActive()) return;
            this.showScore -= 10;
            this.updateHud();
            await this.animateScoreHudWrong();
        })();
        this.scoreAnimInFlight = scoreAnim;
        await scoreAnim;
    }

    // Home Page - Whack A Mole
    private destroyIntroDecor(fromHowToPopup = false) {
        this.introHippoSeq++;
        this.introHippoCriedEvent?.destroy();
        this.introHippoCriedEvent = undefined;
        this.introHippoSmiledEvent?.destroy();
        this.introHippoSmiledEvent = undefined;

        const keepHippos = !this.mobile && fromHowToPopup;
        if (this.howToHippos) {
            this.tweens.killTweensOf(this.howToHippos.hippoCried);
            this.tweens.killTweensOf(this.howToHippos.hippoSmiled);
            this.howToHippos.hippoCried.destroy();
            this.howToHippos.hippoSmiled.destroy();
            this.howToHippos = undefined;
        }

        const decor = this.introDecor;
        this.introDecor = undefined;
        if (!decor) return;
        this.tweens.killTweensOf(decor.title);
        this.tweens.killTweensOf(decor.starBlue);
        this.tweens.killTweensOf(decor.starYellow);
        this.tweens.killTweensOf(decor.shootingStarBlue);
        this.tweens.killTweensOf(decor.shootingStarYellow);
        this.tweens.killTweensOf(decor.shootingStarPink);
        this.tweens.killTweensOf(decor.shootingStarGreen);
        this.tweens.killTweensOf(decor.vegetable1);
        this.tweens.killTweensOf(decor.vegetable2);
        this.tweens.killTweensOf(decor.hippoCried);
        this.tweens.killTweensOf(decor.hippoSmiled);
        decor.title.destroy();
        decor.starBlue.destroy();
        decor.starYellow.destroy();
        decor.shootingStarBlue.destroy();
        decor.shootingStarYellow.destroy();
        decor.shootingStarPink.destroy();
        decor.shootingStarGreen.destroy();
        decor.vegetable1.destroy();
        decor.vegetable2.destroy();

        if (keepHippos) {
            decor.hippoCried.setVisible(true).setAlpha(1);
            decor.hippoSmiled.setVisible(true).setAlpha(1);
            this.howToHippos = { hippoCried: decor.hippoCried, hippoSmiled: decor.hippoSmiled };
            const scales = this.introHippoScales;
            const hippoCriedScale = scales?.hippoCriedScale ?? decor.hippoCried.scaleX;
            const hippoSmiledScale = scales?.hippoSmiledScale ?? decor.hippoSmiled.scaleX;
            this.startIntroHippoAnimation(decor.hippoCried, decor.hippoSmiled, hippoCriedScale, hippoSmiledScale);
        } else {
            decor.hippoCried.destroy();
            decor.hippoSmiled.destroy();
        }
    }

    private createIntroDecor(worldWidth: number, worldHeight: number) {
        const centerX = worldWidth / 2;
        const centerY = worldHeight / 3;
    
        const hippoCried = this.add.image(centerX, centerY, "hippo_cried").setDepth(6);
        const hippoSmiled = this.add.image(centerX, centerY, "hippo_smiled").setDepth(6);
        const starBlue = this.add.image(centerX, centerY, "star_blue").setDepth(5);
        const starYellow = this.add.image(centerX, centerY, "star_yellow").setDepth(5);
        const shootingStarBlue = this.add.image(centerX, centerY, "shooting_star_blue").setDepth(2);
        const shootingStarYellow = this.add.image(centerX, centerY, "shooting_star_yellow").setDepth(2);
        const shootingStarPink = this.add.image(centerX, centerY, "shooting_star_pink").setDepth(2);
        const shootingStarGreen = this.add.image(centerX, centerY, "shooting_star_green").setDepth(2);
        const title = this.add.image(centerX, centerY, "title").setDepth(3);
        const vegetable1 = this.add.image(centerX, centerY, "vegetable_1").setDepth(4);
        const vegetable2 = this.add.image(centerX, centerY, "vegetable_2").setDepth(4);
    
        this.introDecor = { hippoCried, hippoSmiled, title, starBlue, starYellow, shootingStarBlue, shootingStarYellow, shootingStarPink, shootingStarGreen, vegetable1, vegetable2 };
        this.layoutIntroDecor(worldWidth, worldHeight);
    }

    private startIntroTitleZoomAnimation(title: Phaser.GameObjects.Image, baseScale: number) {
        this.tweens.killTweensOf(title);
        title.setScale(baseScale);
        this.tweens.add({
            targets: title,
            scale: baseScale * 1.08,
            duration: 900,
            yoyo: true,
            repeat: -1,
            ease: "Sine.easeInOut",
        });
    }

    private startIntroHippoAnimation(hippoCried: Phaser.GameObjects.Image, hippoSmiled: Phaser.GameObjects.Image, hippoCriedScale: number, hippoSmiledScale: number) {
        this.introHippoSeq++;
        this.introHippoCriedEvent?.destroy();
        this.introHippoCriedEvent = undefined;
        this.introHippoSmiledEvent?.destroy();
        this.introHippoSmiledEvent = undefined;

        const seq = this.introHippoSeq;
        let criedIsCried = true;
        let smiledIsSmiled = true;

        hippoCried.setAlpha(1).setVisible(true);
        hippoSmiled.setAlpha(1).setVisible(true);

        this.introHippoCriedEvent = this.time.addEvent({
            delay: 800,
            loop: true,
            callback: () => {
                if (seq !== this.introHippoSeq) return;
                if (!this.sys.isActive()) return;
                criedIsCried = !criedIsCried;
                if (criedIsCried) {
                    hippoCried.setTexture("hippo_cried").setScale(hippoCriedScale);
                } else {
                    hippoCried.setTexture("hippo_smiled").setScale(hippoSmiledScale);
                }
            },
        });
        this.introHippoSmiledEvent = this.time.addEvent({
            delay: 800,
            loop: true,
            callback: () => {
                if (seq !== this.introHippoSeq) return;
                if (!this.sys.isActive()) return;
                smiledIsSmiled = !smiledIsSmiled;
                if (smiledIsSmiled) {
                    hippoSmiled.setTexture("hippo_smiled").setScale(hippoSmiledScale);
                } else {
                    hippoSmiled.setTexture("hippo_cried").setScale(hippoCriedScale);
                }
            },
        });
    }

    private layoutIntroDecor(worldWidth: number, worldHeight: number) {
        const decor = this.introDecor;
        if (!decor) return;

        const centerX = worldWidth / 2;
        const centerY = worldHeight / 3;

        const hippoCriedSrc = this.textures.get("hippo_cried").getSourceImage() as { width?: number; height?: number };
        const hippoCriedW = hippoCriedSrc?.width ?? 1;
        const hippoCriedH = hippoCriedSrc?.height ?? 1;
        const hippoCriedMaxW = worldWidth * (this.mobile ? 0.68 : 0.7);
        const hippoCriedMaxH = worldHeight * (this.mobile ? 0.12 : 0.25);
        const hippoCriedScale = Math.min(hippoCriedMaxW / hippoCriedW, hippoCriedMaxH / hippoCriedH);

        const hippoSmiledSrc = this.textures.get("hippo_smiled").getSourceImage() as { width?: number; height?: number };
        const hippoSmiledW = hippoSmiledSrc?.width ?? 1;
        const hippoSmiledH = hippoSmiledSrc?.height ?? 1;
        const hippoSmiledMaxW = worldWidth * (this.mobile ? 0.68 : 0.7);
        const hippoSmiledMaxH = worldHeight * (this.mobile ? 0.12 : 0.25);
        const hippoSmiledScale = Math.min(hippoSmiledMaxW / hippoSmiledW, hippoSmiledMaxH / hippoSmiledH);
    
        const starBlueSrc = this.textures.get("star_blue").getSourceImage() as { width?: number; height?: number };
        const starBlueW = starBlueSrc?.width ?? 1;
        const starBlueH = starBlueSrc?.height ?? 1;
        const starBlueMaxW = worldWidth * (this.mobile ? 0.30 : 0.30);
        const starBlueMaxH = worldHeight * (this.mobile ? 0.025 : 0.06);
        const starBlueScale = Math.min(starBlueMaxW / starBlueW, starBlueMaxH / starBlueH);
    
        const starYellowSrc = this.textures.get("star_yellow").getSourceImage() as { width?: number; height?: number };
        const starYellowW = starYellowSrc?.width ?? 1;
        const starYellowH = starYellowSrc?.height ?? 1;
        const starYellowMaxW = worldWidth * (this.mobile ? 0.55 : 0.57);
        const starYellowMaxH = worldHeight * (this.mobile ? 0.09 : 0.12);
        const starYellowScale = Math.min(starYellowMaxW / starYellowW, starYellowMaxH / starYellowH);
    
        const shootingStarBlueSrc = this.textures.get("shooting_star_blue").getSourceImage() as { width?: number; height?: number };
        const shootingStarBlueW = shootingStarBlueSrc?.width ?? 1;
        const shootingStarBlueH = shootingStarBlueSrc?.height ?? 1;
        const shootingStarBlueMaxW = worldWidth * (this.mobile ? 0.54 : 0.56);
        const shootingStarBlueMaxH = worldHeight * (this.mobile ? 0.08 : 0.11);
        const shootingStarBlueScale = Math.min(shootingStarBlueMaxW / shootingStarBlueW, shootingStarBlueMaxH / shootingStarBlueH);
    
        const shootingStarYellowSrc = this.textures.get("shooting_star_yellow").getSourceImage() as { width?: number; height?: number };
        const shootingStarYellowW = shootingStarYellowSrc?.width ?? 1;
        const shootingStarYellowH = shootingStarYellowSrc?.height ?? 1;
        const shootingStarYellowMaxW = worldWidth * (this.mobile ? 0.55 : 0.57);
        const shootingStarYellowMaxH = worldHeight * (this.mobile ? 0.09 : 0.12);
        const shootingStarYellowScale = Math.min(shootingStarYellowMaxW / shootingStarYellowW, shootingStarYellowMaxH / shootingStarYellowH);
    
        const shootingStarPinkSrc = this.textures.get("shooting_star_pink").getSourceImage() as { width?: number; height?: number };
        const shootingStarPinkW = shootingStarPinkSrc?.width ?? 1;
        const shootingStarPinkH = shootingStarPinkSrc?.height ?? 1;
        const shootingStarPinkMaxW = worldWidth * (this.mobile ? 0.55 : 0.57);
        const shootingStarPinkMaxH = worldHeight * (this.mobile ? 0.09 : 0.12);
        const shootingStarPinkScale = Math.min(shootingStarPinkMaxW / shootingStarPinkW, shootingStarPinkMaxH / shootingStarPinkH);
    
        const shootingStarGreenSrc = this.textures.get("shooting_star_green").getSourceImage() as { width?: number; height?: number };
        const shootingStarGreenW = shootingStarGreenSrc?.width ?? 1;
        const shootingStarGreenH = shootingStarGreenSrc?.height ?? 1;
        const shootingStarGreenMaxW = worldWidth * (this.mobile ? 0.54 : 0.56);
        const shootingStarGreenMaxH = worldHeight * (this.mobile ? 0.08 : 0.11);
        const shootingStarGreenScale = Math.min(shootingStarGreenMaxW / shootingStarGreenW, shootingStarGreenMaxH / shootingStarGreenH);
    
        const titleSrc = this.textures.get("title").getSourceImage() as { width?: number; height?: number };
        const titleW = titleSrc?.width ?? 1;
        const titleH = titleSrc?.height ?? 1;
        const titleMaxW = worldWidth * (this.mobile ? 0.70 : 0.8);
        const titleMaxH = worldHeight * (this.mobile ? 0.28 : 0.35);
        const titleScale = Math.min(titleMaxW / titleW, titleMaxH / titleH);

        const vegetable1Src = this.textures.get("vegetable_1").getSourceImage() as { width?: number; height?: number };
        const vegetable1W = vegetable1Src?.width ?? 1;
        const vegetable1H = vegetable1Src?.height ?? 1;
        const vegetable1MaxW = worldWidth * (this.mobile ? 0.55 : 0.57);
        const vegetable1MaxH = worldHeight * (this.mobile ? 0.09 : 0.12);
        const vegetable1Scale = Math.min(vegetable1MaxW / vegetable1W, vegetable1MaxH / vegetable1H);

        const vegetable2Src = this.textures.get("vegetable_2").getSourceImage() as { width?: number; height?: number };
        const vegetable2W = vegetable2Src?.width ?? 1;
        const vegetable2H = vegetable2Src?.height ?? 1;
        const vegetable2MaxW = worldWidth * (this.mobile ? 0.55 : 0.57);
        const vegetable2MaxH = worldHeight * (this.mobile ? 0.09 : 0.12);
        const vegetable2Scale = Math.min(vegetable2MaxW / vegetable2W, vegetable2MaxH / vegetable2H);

        this.tweens.killTweensOf(decor.title);
        this.tweens.killTweensOf(decor.starBlue);
        this.tweens.killTweensOf(decor.starYellow);
        this.tweens.killTweensOf(decor.shootingStarBlue);
        this.tweens.killTweensOf(decor.shootingStarYellow);
        this.tweens.killTweensOf(decor.shootingStarPink);
        this.tweens.killTweensOf(decor.shootingStarGreen);
        this.tweens.killTweensOf(decor.vegetable1);
        this.tweens.killTweensOf(decor.vegetable2);
        this.tweens.killTweensOf(decor.hippoCried);
        this.tweens.killTweensOf(decor.hippoSmiled);

        const hippoCriedX = centerX + worldWidth * 0.3;
        const hippoCriedY = centerY + worldHeight * 0.15;
        const hippoSmiledX = centerX - worldWidth * 0.3;
        const hippoSmiledY = centerY + worldHeight * 0.15;
        const starBlueX = this.mobile ? centerX - worldWidth * 0.45 : centerX - worldWidth * 0.2;
        const starBlueY = this.mobile ? centerY - worldHeight * 0.2 : centerY - worldHeight * 0.1;
        const starYellowX = this.mobile ? centerX + worldWidth * 0.3 : centerX + worldWidth * 0.12;
        const starYellowY = this.mobile ? centerY - worldHeight * 0.025 : centerY + worldHeight * 0.1;
        const shootingStarBlueX = this.mobile ? centerX + worldWidth * 0.25 : centerX + worldWidth * 0.125;
        const shootingStarBlueY = this.mobile ? centerY - worldHeight * 0.23 : centerY - worldHeight * 0.2;
        const shootingStarYellowX = this.mobile ? centerX - worldWidth * 0.35 : centerX - worldWidth * 0.175;
        const shootingStarYellowY = this.mobile ? centerY - worldHeight * 0.255 : centerY - worldHeight * 0.225;
        const shootingStarPinkX = this.mobile ? centerX + worldWidth * 0.35 : centerX + worldWidth * 0.175;
        const shootingStarPinkY = this.mobile ? centerY - worldHeight * 0.23 : centerY - worldHeight * 0.175;
        const shootingStarGreenX = this.mobile ? centerX - worldWidth * 0.25 : centerX - worldWidth * 0.125;
        const shootingStarGreenY = this.mobile ? centerY - worldHeight * 0.255 : centerY - worldHeight * 0.225;
        const titleX = centerX;
        const titleY = this.mobile ? centerY - worldHeight * 0.1 : centerY;
        const vegetable1X = this.mobile ? centerX - worldWidth * 0.3 : centerX - worldWidth * 0.12;
        const vegetable1Y = this.mobile ? centerY - worldHeight * 0.025 : centerY + worldHeight * 0.1;
        const vegetable2X = this.mobile ? centerX + worldWidth * 0.4 : centerX + worldWidth * 0.18;
        const vegetable2Y = this.mobile ? centerY - worldHeight * 0.1 : centerY - worldHeight * 0.025;

        decor.hippoCried.setTexture("hippo_cried").setPosition(hippoCriedX, hippoCriedY).setScale(hippoCriedScale).setAlpha(1).setVisible(true);
        decor.hippoSmiled.setTexture("hippo_smiled").setPosition(hippoSmiledX, hippoSmiledY).setScale(hippoSmiledScale).setAlpha(1).setVisible(true);
        decor.title.setPosition(titleX, titleY).setScale(titleScale);

        const moveDuration = 650;
        const moveEase = "Back.easeOut";
        const moveEaseParams = [2.2];
        const moveFromCenter = (target: Phaser.GameObjects.Image, x: number, y: number) => {
            target.setPosition(centerX, centerY);
            this.tweens.add({
                targets: target,
                x,
                y,
                duration: moveDuration,
                ease: moveEase,
                easeParams: moveEaseParams,
            });
        };

        decor.starBlue.setScale(starBlueScale);
        decor.starYellow.setScale(starYellowScale);
        decor.shootingStarBlue.setScale(shootingStarBlueScale);
        decor.shootingStarYellow.setScale(shootingStarYellowScale);
        decor.shootingStarPink.setScale(shootingStarPinkScale);
        decor.shootingStarGreen.setScale(shootingStarGreenScale);
        decor.vegetable1.setScale(vegetable1Scale);
        decor.vegetable2.setScale(vegetable2Scale);

        moveFromCenter(decor.starBlue, starBlueX, starBlueY);
        moveFromCenter(decor.starYellow, starYellowX, starYellowY);
        moveFromCenter(decor.shootingStarBlue, shootingStarBlueX, shootingStarBlueY);
        moveFromCenter(decor.shootingStarYellow, shootingStarYellowX, shootingStarYellowY);
        moveFromCenter(decor.shootingStarPink, shootingStarPinkX, shootingStarPinkY);
        moveFromCenter(decor.shootingStarGreen, shootingStarGreenX, shootingStarGreenY);
        moveFromCenter(decor.vegetable1, vegetable1X, vegetable1Y);
        moveFromCenter(decor.vegetable2, vegetable2X, vegetable2Y);

        this.startIntroTitleZoomAnimation(decor.title, titleScale);

        this.introHippoScales = { hippoCriedScale, hippoSmiledScale };
        this.startIntroHippoAnimation(decor.hippoCried, decor.hippoSmiled, hippoCriedScale, hippoSmiledScale);
    }

    // Title UI - Whack A Mole
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
        const minBoxW = Math.min(width * (this.mobile ? 0.7 : 0.75), ui.px(680));
        const maxBoxW = Math.min(width * (this.mobile ? 0.94 : 0.9), ui.px(980));
        const radius = ui.px(14);
        const paddingX = this.mobile ? 8 : ui.px(18);
        const paddingY = this.mobile ? 8 : ui.px(12);
        const fontPx = getHudCenterTextMaxFontPx(ui.px.bind(ui), this.mobile);
        const y = Math.max(this.mobile ? 48 : ui.px(54), height * (this.mobile ? 0.045 : 0.06));
    
        this.titleUI.container.setPosition(width / 2, this.mobile ? y * 1.6 : y);
    
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

    private getWamHudLayout() {
        const safe = new Phaser.Geom.Rectangle(0, 0, this.scale.width, this.scale.height);
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

    // Time UI - Whack A Mole
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

    private layoutWamHudStats() {
        const { safe, ui, metrics, slots } = this.getWamHudLayout();
        const rowCenterY = safe.y + slots.rowY;
        const elapsed = this.hudStarted ? (Date.now() - this.hudStartMs) / 1000 : 0;

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
                progress: undefined,
            },
            timeText: this.formatElapsedSeconds(elapsed),
            scoreValue: String(this.score),
            labelPad: ui.px(this.mobile ? 12 : 18),
            valuePad: ui.px(this.mobile ? 12 : 18),
        });
    }

    private layoutTime() {
        this.layoutWamHudStats();
    }

    // Score UI - Whack A Mole
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
        this.layoutWamHudStats();
    }

    private layoutQuestionProgress() {
        this.layoutWamHudStats();
    }
    
    // Message UI - Whack A Mole
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
    
    private showRandomMessage(pool: string[], durationMs?: number, teacherStateWhileVisible?: TeacherState) {
        const safePool = Array.isArray(pool) ? pool : [];
        if (safePool.length === 0) return;
        const id = Phaser.Utils.Array.GetRandom(safePool);
        const entry = this.messageCatalog[id];
        if (!entry) return;
        this.showMessage(entry.text, durationMs, entry.voice, teacherStateWhileVisible);
    }
    
    private onGameplayStarted() {
        this.lastScoreChangeMs = Date.now();
        this.idleNoScore5MessageShown = false;
        this.idleNoScore15MessageShown = false;
        this.milestoneShown.clear();
        this.showRandomMessage(this.messagePools.intro, 2500, "point");
    }
    
    private onScoreIncreased() {
        this.lastScoreChangeMs = Date.now();
        this.idleNoScore5MessageShown = false;
        this.idleNoScore15MessageShown = false;
    }

    private onScoreDecreased() {
        this.lastScoreChangeMs = Date.now();
        this.idleNoScore5MessageShown = false;
        this.idleNoScore15MessageShown = false;
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

        if (canShowMessage && this.lastScoreChangeMs > 0) {
            const idleMs = now - this.lastScoreChangeMs;
            if (!this.idleNoScore15MessageShown && idleMs >= 15_000) {
                this.idleNoScore15MessageShown = true;
                this.idleNoScore5MessageShown = true;
                this.showRandomMessage(this.messagePools.idleNoScore15, 2200, "point");
                return;
            }
            if (!this.idleNoScore5MessageShown && idleMs >= 5_000) {
                this.idleNoScore5MessageShown = true;
                this.showRandomMessage(this.messagePools.idleNoScore5, 2200, "point");
            }
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
    
    private colorToCss(value: number) {
        const safe = Math.max(0, Math.min(0xffffff, Math.floor(value)));
        return `#${safe.toString(16).padStart(6, "0")}`;
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
        const scoreLabel = `คะแนน ${this.showScore}`;

        if (this.timeUI) {
            setDomTimeHudPillValue(this.timeUI, timeLabel);
        }
        if (this.scoreUI) {
            setDomLabelValueHudPillValue(this.scoreUI, String(this.showScore));
        }
        this.layoutQuestionProgress();
        this.updateTimedMessages(elapsed);
        this.updateTickingByElapsed(elapsed);
    }

    private formatElapsedSeconds(seconds: number) {
        const safe = Math.max(0, Math.floor(seconds));
        const mm = Math.floor(safe / 60);
        const ss = safe % 60;
        return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
    }

    private finishGame() {
        if (this.ending) return;
        this.ending = true;
        this.input.enabled = false;
        this.stopSpawning();
        this.stopTicking();
        void (async () => {
            await this.scoreAnimInFlight;
            if (!this.sys.isActive()) return;
            this.reportRunstateQuestionCompleted(1);
            this.endGame();
        })();
    }

    protected override getResultCorrectCount(): number {
        return this.hitCorrectWords.size;
    }

    protected override getResultTotal(): number | undefined {
        return Math.max(
            this.hitCorrectWords.size,
            this.correctItems.length,
            this.totalQuestions ?? 0,
        );
    }

    private updateTickingByElapsed(elapsedSeconds: number) {
        void elapsedSeconds;
        this.stopTickingAudio();
        this.tickingState = null;
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

    // animation for score plus one after correct
    private showScorePlusOne(startX?: number, startY?: number): Promise<void> {
        const { width, height } = this.scale;
        const x = typeof startX === "number" ? startX : width / 2;
        const y = typeof startY === "number" ? startY : height / 2;
        const r = Math.max(30, Math.round(Math.min(width, height) * 0.06));

        const circle = this.add.circle(0, 0, r, 0xffffff, 0.95);
        const label = this.add
            .text(0, 0, "+10", {
                fontSize: `${Math.round(r * 0.95)}px`,
                color: "#025B96",
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

    private showScoreMinusOne(startX?: number, startY?: number): Promise<void> {
        const { width, height } = this.scale;
        const x = typeof startX === "number" ? startX : width / 2;
        const y = typeof startY === "number" ? startY : height / 2;
        const r = Math.max(30, Math.round(Math.min(width, height) * 0.06));

        const circle = this.add.circle(0, 0, r, 0xffffff, 0.95);
        const label = this.add
            .text(0, 0, "-10", {
                fontSize: `${Math.round(r * 0.95)}px`,
                color: this.colorToCss(0xff0076),
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

    private createParticleBurst(x: number, y: number, depth: number) {
        const particles = this.add.particles(x, y - 60, "star", {
            speed: { min: 100, max: 250 },
            angle: { min: 0, max: 360 },
            lifespan: 800,
            gravityY: 300,
            quantity: 15,
            emitting: false
        });

        particles.explode(15);
        particles.setDepth(depth);

        this.time.delayedCall(1000, () => particles.destroy());
    }
}
