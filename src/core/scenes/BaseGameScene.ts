import Phaser from "phaser";
import type { GameSourcePayload } from "../api";
import {
  applyGameAudioFromQuestion,
  initGameAudioFromQuestions,
  setGameAudioMuted,
  subscribeGameAudioSettings,
  type GameAudioCategory,
  type SetGameAudioMutedOptions,
} from "../audio/GameAudioSettings";
import { destroyGameAudioMenu, mountGameAudioMenu } from "../audio/gameAudioMenuDom";
import {
  hideSequenceHudDom,
  refreshSequenceGameplayBar,
  setSequenceBarLayout,
} from "../../utils/sequenceHudDom";
import {
  reportRunstate,
  resolveRunstateScope,
  type RunstateScope,
} from "../agentRunstate";
import { formatQuestionProgress } from "../hud/questionProgressHud";

export interface SequenceContext {
  index: number;
  total: number;
  isSequence: boolean;
  /** ชื่อแต่ละเกมในลำดับ (exercise_name) — ใช้ stepper / ชื่อเกมปัจจุบัน */
  exerciseNames?: string[];
  /** มาจาก API `sequence_info.exercise_name` */
  sequenceInfoExerciseName?: string;
  /** UUID ของ sequence (uuid_newgen หรือ uuid) — runstate / agent scope */
  sequenceUuid?: string;
  /** `sequence_info.uuid` เท่านั้น — ส่ง live-dashboard */
  liveDashboardSequenceUuid?: string;
}

export interface BaseGameSceneInitData {
  gameKey?: string;
  /** payload ของเกมที่ main.ts/SequenceRunner ส่งให้ – ถ้าไม่มี scene จะ fallback ไป fetch เอง */
  payload?: GameSourcePayload;
  /** context สำหรับโหมดเล่นต่อเนื่อง */
  sequence?: SequenceContext;
}

export interface ResultSceneLaunchOverrides {
  resultBgPath?: string;
  replayBtnPath?: string;
  logoPath?: string;
  logoKey?: string;
  scoreLabelColor?: string;
  panelOffsetY?: number;
  scoreLabelYRatio?: number;
  scoreLabelYRatioWithLogo?: number;
  scoreBoxYRatio?: number;
  scoreBoxYRatioWithLogo?: number;
  timeLabelYRatio?: number;
  timeBoxYRatio?: number;
  replayButtonYRatio?: number;
}

export abstract class BaseGameScene extends Phaser.Scene {
  protected score = 0;
  protected startTime = 0;
  protected totalQuestions?: number;
  protected injectedPayload?: GameSourcePayload;
  protected sequenceContext?: SequenceContext;
  private audioMenuDisposer?: () => void;
  private audioSettingsDisposer?: () => void;

  init(data?: BaseGameSceneInitData) {
    this.injectedPayload = data?.payload;
    this.sequenceContext = data?.sequence;
    initGameAudioFromQuestions(data?.payload?.questions);
  }

  create() {
    this.score = 0;
    this.totalQuestions = undefined;
    this.startTime = Date.now();
    console.log(`Currently in game: ${this.scene.key}`);
    this.configureSequenceLayout();
    if (this.injectedPayload?.questions) {
      initGameAudioFromQuestions(this.injectedPayload.questions);
    }
    this.mountGameAudioControls();
  }

  /** เกมลูก override เมื่อผู้เล่นเปลี่ยนการตั้งค่าเสียง (เช่น เปิด BGM กลับ) */
  protected onGameAudioSettingsChanged(): void {}

  /**
   * นำ audio_* จากข้อคำถามใน JSON มาใช้ (เกมเรียกเมื่อเปลี่ยนข้อ)
   * ไม่ทับหมวดที่ผู้เล่นปรับจากเมนู hamburger แล้ว
   */
  protected syncGameAudioFromQuestion(question: unknown) {
    applyGameAudioFromQuestion(question);
    this.onGameAudioSettingsChanged();
  }

  /** ปิด/เปิดเสียงจาก UI ในเกม — sync กับเมนู hamburger */
  protected setGameAudioMutedFromGame(
    category: GameAudioCategory,
    muted: boolean,
    options?: SetGameAudioMutedOptions
  ) {
    setGameAudioMuted(category, muted, options);
    this.onGameAudioSettingsChanged();
  }

  private mountGameAudioControls() {
    this.teardownGameAudioControls();
    this.audioMenuDisposer = mountGameAudioMenu();
    this.audioSettingsDisposer = subscribeGameAudioSettings(() => {
      this.onGameAudioSettingsChanged();
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.teardownGameAudioControls, this);
  }

  private teardownGameAudioControls = () => {
    this.audioSettingsDisposer?.();
    this.audioSettingsDisposer = undefined;
    this.audioMenuDisposer?.();
    this.audioMenuDisposer = undefined;
    destroyGameAudioMenu();
  };

  /** ให้ HomeScene อ่าน context เพื่อแสดงแถบ sequence บน Home */
  getSequenceContext(): SequenceContext | undefined {
    return this.sequenceContext;
  }

  /** ข้อความ HUD เช่น `2/5` */
  protected formatQuestionProgressLabel(current: number, total: number): string {
    return formatQuestionProgress(current, total);
  }

  /**
   * หน้าเล่น: แถบแบบ peek — ลูกศรเหลืองขอบบน (desktop hover / mobile แตะ) (ไม่ย่อ canvas)
   */
  private configureSequenceLayout() {
    this.scale.off("resize", this.onSequenceScaleResize, this);
    this.events.off(Phaser.Scenes.Events.SHUTDOWN, this.onSequenceSceneShutdown, this);
    this.events.off("home-dismissed-for-play", this.onHomeDismissedForPlay, this);

    const ctx = this.sequenceContext;

    if (ctx?.isSequence && ctx.exerciseNames?.length) {
      setSequenceBarLayout("gameplay-peek", ctx);
      this.scale.on("resize", this.onSequenceScaleResize, this);
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onSequenceSceneShutdown, this);
      /** Home จะทับเป็นแถบแบบ fixed — เมื่อกดเริ่มเกมต้องสลับกลับเป็น peek (scene เกมไม่ได้สร้างใหม่) */
      this.events.on("home-dismissed-for-play", this.onHomeDismissedForPlay, this);
    } else {
      setSequenceBarLayout("off");
    }
  }

  private onHomeDismissedForPlay = () => {
    const ctx = this.sequenceContext;
    if (ctx?.isSequence && ctx.exerciseNames?.length) {
      setSequenceBarLayout("gameplay-peek", ctx);
    }
  };

  private onSequenceScaleResize = () => {
    refreshSequenceGameplayBar(this.sequenceContext);
  };

  private onSequenceSceneShutdown = () => {
    this.scale.off("resize", this.onSequenceScaleResize, this);
    this.events.off("home-dismissed-for-play", this.onHomeDismissedForPlay, this);
    this.teardownGameAudioControls();
    hideSequenceHudDom();
  };

  protected endGame() {
    const time = (Date.now() - this.startTime) / 1000;
    const runstateTotal = this.getRunstateQuestionTotal();
    this.onBeforeEndGame();
    this.reportRunstateEnd(time, runstateTotal);

    this.scene.launch("ResultScene", {
      score: this.getResultCorrectCount(),
      scoreLabel: this.getResultDisplayLabel(),
      time,
      gameKey: this.scene.key,
      total: this.getResultTotal(),
      sequence: this.sequenceContext,
      ...this.getResultSceneLaunchOverrides(),
      ...this.getLiveDashboardLaunchFields(),
    });
    this.scene.bringToTop("ResultScene");
  }

  protected onBeforeEndGame() {}

  // ─────────────────────────────────────────────────────────
  //  Agent runstate — เกมลูกเรียก 2 method ก็พอ (start / question)
  //  ส่วน end เรียกอัตโนมัติจาก endGame()
  // ─────────────────────────────────────────────────────────

  protected getRunstateScope(): RunstateScope | null {
    const gi = this.injectedPayload?.game_info;
    const sequenceUuid =
      this.sequenceContext?.isSequence === true ? (this.sequenceContext.sequenceUuid ?? null) : null;
    const gameUuid = gi?.uuid_newgen ?? gi?.uuid;
    return resolveRunstateScope({ sequenceUuid, gameUuid });
  }

  protected getRunstateGameUuid(): string | undefined {
    const gi = this.injectedPayload?.game_info;
    // แต่ละเกมใน sequence ใช้ uuid ของเกมย่อย (ไม่ใช่ uuid_newgen ระดับ sequence)
    return gi?.uuid ?? gi?.uuid_newgen;
  }

  /** sequence index ของเกมปัจจุบัน (0-based) */
  protected getRunstateGameIndex(): number | undefined {
    const ctx = this.sequenceContext;
    if (ctx?.isSequence !== true) return undefined;
    const idx = Math.floor(Number(ctx.index));
    if (!Number.isFinite(idx) || idx < 0) return undefined;
    return idx;
  }

  /** จำนวนข้อทั้งหมดสำหรับ runstate — เกมลูก override ถ้าใช้ field อื่น */
  protected getRunstateQuestionTotal(): number {
    return Math.max(0, Math.floor(this.totalQuestions ?? 0));
  }

  /** เรียกเมื่อกดเริ่มเล่นเกม (หลังจบ HomeScene/Intro) */
  reportRunstateStart(): void {
    const scope = this.getRunstateScope();
    if (!scope) return;
    const ctx = this.sequenceContext;
    const isSequenceFirstGame =
      ctx?.isSequence === true && ctx.index === 0;
    void reportRunstate({
      game: this.game,
      scope,
      gameKey: this.scene.key,
      gameUuid: this.getRunstateGameUuid(),
      gameIndex: this.getRunstateGameIndex(),
      score: this.getResultScore(),
      current: 0,
      total: this.getRunstateQuestionTotal(),
      phase: isSequenceFirstGame ? "allstart" : "start",
    });
  }

  /**
   * เรียกเมื่อ "ตอบถูกจนเปลี่ยนข้อ" — เกมลูกส่งเลขข้อที่เพิ่งจบ (1-indexed)
   * เช่น จบข้อแรก ส่ง `completedQuestionNumber = 1`
   */
  reportRunstateQuestionCompleted(completedQuestionNumber: number): void {
    const scope = this.getRunstateScope();
    if (!scope) return;
    void reportRunstate({
      game: this.game,
      scope,
      gameKey: this.scene.key,
      gameUuid: this.getRunstateGameUuid(),
      gameIndex: this.getRunstateGameIndex(),
      score: this.getResultScore(),
      current: completedQuestionNumber,
      total: this.getRunstateQuestionTotal(),
      phase: "progress",
    });
  }

  private reportRunstateEnd(totalTimeSec: number, totalOverride?: number): void {
    const scope = this.getRunstateScope();
    if (!scope) return;
    const ctx = this.sequenceContext;
    const isSequenceLastGame =
      ctx?.isSequence === true && ctx.total > 0 && ctx.index === ctx.total - 1;
    const total = totalOverride ?? this.getRunstateQuestionTotal();
    void reportRunstate({
      game: this.game,
      scope,
      gameKey: this.scene.key,
      gameUuid: this.getRunstateGameUuid(),
      gameIndex: this.getRunstateGameIndex(),
      score: this.getResultScore(),
      current: total,
      total,
      phase: isSequenceLastGame ? "allend" : "end",
      totalTimeSec,
    });
  }

  /** ข้อมูลส่ง live-dashboard — `uuid_game_info` ใช้ `game_info.uuid` เท่านั้น (ไม่ใช้ uuid_newgen) */
  protected getLiveDashboardLaunchFields(): {
    liveDashboardGameUuid?: string;
    liveDashboardSequenceUuid?: string | null;
    liveDashboardFlappyPassed?: boolean;
  } {
    const gi = this.injectedPayload?.game_info;
    const gameUuid = gi?.uuid;
    const seqUuid =
      this.sequenceContext?.isSequence === true
        ? (this.sequenceContext.liveDashboardSequenceUuid ??
          this.sequenceContext.sequenceUuid ??
          null)
        : null;
    return {
      ...(gameUuid ? { liveDashboardGameUuid: gameUuid } : {}),
      liveDashboardSequenceUuid: seqUuid,
    };
  }

  protected getResultScore(): number {
    return this.score;
  }

  /** จำนวนข้อที่ทำได้ — เกมลูก override ถ้าคะแนนไม่เท่ากับจำนวนข้อ */
  protected getResultCorrectCount(): number {
    return this.score;
  }

  /** จำนวนทั้งหมดที่ใช้แสดงบนหน้า Result เท่านั้น — ไม่เกี่ยวกับ agent runstate */
  protected getResultTotal(): number | undefined {
    return this.getRunstateQuestionTotal() || this.totalQuestions;
  }

  protected getResultScoreLabel(): string | undefined {
    return undefined;
  }

  /** ข้อความหัวข้อบนหน้าสรุป (default: จำนวนข้อที่ทำได้) */
  protected getResultDisplayLabel(): string | undefined {
    const custom = this.getResultScoreLabel();
    if (custom === "ไม่ผ่าน") return custom;
    return "จำนวนข้อที่ทำได้";
  }

  protected getResultSceneLaunchOverrides(): ResultSceneLaunchOverrides {
    return {};
  }

  /** ขนาด viewport จริงของ canvas (พิกเซลหน้าจอ) */
  protected getViewportRect(): Phaser.Geom.Rectangle {
    return new Phaser.Geom.Rectangle(0, 0, this.scale.width, this.scale.height);
  }

  /**
   * safe area สำหรับวาง HUD/gameplay โดยรักษาอัตราส่วนดีไซน์ไว้ตรงกลางจอ
   * - desktop ใช้ 16:9
   * - mobile ใช้ 9:16
   */
  protected getSafeAreaRect(
    designAspect: number,
    paddingPx = 0
  ): Phaser.Geom.Rectangle {
    const view = this.getViewportRect();
    const vw = Math.max(1, view.width);
    const vh = Math.max(1, view.height);
    const isMobileViewport = vh > vw;

    // มือถือ (portrait) ให้ใช้เต็ม viewport เพื่อลดปัญหาล้นล่าง/ขอบดำ
    // แล้วคุมตำแหน่งด้วย padding แทนการ letterbox ตามอัตราส่วนตายตัว
    if (isMobileViewport) {
      return new Phaser.Geom.Rectangle(
        paddingPx,
        paddingPx,
        Math.max(1, vw - paddingPx * 2),
        Math.max(1, vh - paddingPx * 2)
      );
    }

    const viewportAspect = vw / vh;

    let safeW = vw;
    let safeH = vh;
    if (viewportAspect > designAspect) {
      safeH = vh;
      safeW = safeH * designAspect;
    } else {
      safeW = vw;
      safeH = safeW / designAspect;
    }

    const x = (vw - safeW) / 2 + paddingPx;
    const y = (vh - safeH) / 2 + paddingPx;
    const w = Math.max(1, safeW - paddingPx * 2);
    const h = Math.max(1, safeH - paddingPx * 2);
    return new Phaser.Geom.Rectangle(x, y, w, h);
  }
}
