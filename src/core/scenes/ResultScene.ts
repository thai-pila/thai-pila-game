import Phaser from "phaser";
import { guardedScenePlay } from "../audio/sceneAudio";
import { isMobileLayout } from "../../utils/device";
import { hideSequenceHudDom } from "../../utils/sequenceHudDom";
import { postLiveDashboardIfEligible } from "../liveDashboard";
import { sequenceGameRequiresPass } from "../sequenceRules";
export type ResultSceneData = {
  score: number;
  scoreLabel?: string;
  scoreLabelColor?: string;
  time: number;
  gameKey: string;
  total?: number;
  sequence?: {
    index: number;
    total: number;
    isSequence: boolean;
    exerciseNames?: string[];
    sequenceInfoExerciseName?: string;
    sequenceUuid?: string;
  };
  /** `game_info.uuid` เท่านั้น (ไม่ใช้ uuid_newgen) — ส่งเป็น `uuid_game_info` ใน live-dashboard */
  liveDashboardGameUuid?: string;
  liveDashboardSequenceUuid?: string | null;
  /** flappy-bird: ต้องเป็น true (เล่นจบครบข้อ) ถึงจะส่ง live-dashboard */
  liveDashboardFlappyPassed?: boolean;
  resultBgPath?: string;
  replayBtnPath?: string;
  logoPath?: string;
  logoKey?: string;
  panelOffsetY?: number;
  scoreLabelYRatio?: number;
  scoreLabelYRatioWithLogo?: number;
  scoreBoxYRatio?: number;
  scoreBoxYRatioWithLogo?: number;
  timeLabelYRatio?: number;
  timeBoxYRatio?: number;
  replayButtonYRatio?: number;
  /** โหมดทดสอบจาก URL (?debugResult=1): ปุ่มเล่นอีกครั้งแค่ปิด Result ไม่ restart เกม */
  resultPreview?: boolean;
};

/** ฐานเลย์เอาต์หน้าผลลัพธ์บนเดสก์ท็อป — จอเล็กกว่านี้ให้ย่อการ์ด/ตัวอักษรตามสัดส่วน */
const DESKTOP_RESULT_LAYOUT_WIDTH = 1920;
const DESKTOP_RESULT_LAYOUT_HEIGHT = 1080;

type ResultUiConfig = {
  resultBgPath?: string;
  replayBtnPath?: string;
  logoPath?: string;
  logoKey?: string;
  panelOffsetY?: number;
  logoTopGap?: number;
  /** ความกว้างโลโก้ไม่เกิน cardW × ค่านี้ — ความสูงคำนวณตามอัตราส่วนรูป */
  logoMaxWidthRatio?: number;
  scoreLabelYRatio?: number;
  scoreLabelYRatioWithLogo?: number;
  scoreBoxYRatio?: number;
  scoreBoxYRatioWithLogo?: number;
  timeLabelYRatio?: number;
  timeBoxYRatio?: number;
  replayButtonYRatio?: number;
};

type ResultUiGameDefaults = ResultUiConfig & {
  logoMaxWidthRatioMobile?: number;
  logoMaxWidthRatioDesktop?: number;
};

export class ResultScene extends Phaser.Scene {
  private launchData?: ResultSceneData;

  constructor() {
    super("ResultScene");
  }

  init(data: ResultSceneData) {
    this.launchData = data;
  }

  preload() {
    this.load.image("result_bg_default", "assets/result/result_bg.png");
    this.load.image("result_replay_btn_default", "assets/result/replay_btn.png");
    this.load.image("result_next_btn_default", "assets/result/nextbtn.png");
    this.load.image("result_resultbtn_default", "assets/result/resultbtn.png");
    this.load.image("result_leaderboard_btn", "assets/result/leaderboard_btn.png");
    if (!this.textures.exists("result_star_fx")) {
      this.load.image("result_star_fx", "assets/flip-cards/star.png");
    }
    if (!this.cache.audio.exists("sfx_level_complete")) {
      this.load.audio("sfx_level_complete", "assets/sound/sfx_level_complete.mp3");
    }

    const gameKey = this.launchData?.gameKey;
    if (!gameKey) return;

    const uiConfig = this.getResultUiConfig(gameKey, this.launchData, isMobileLayout());
    const dynamicResultBgKey = this.getResultBgTextureKey(gameKey);
    const dynamicReplayBtnKey = this.getReplayBtnTextureKey(gameKey);
    const dynamicLogoKey = this.getLogoTextureKey(gameKey, uiConfig.logoKey);

    if (uiConfig.resultBgPath && !this.textures.exists(dynamicResultBgKey)) {
      this.load.image(dynamicResultBgKey, uiConfig.resultBgPath);
    }
    if (uiConfig.replayBtnPath && !this.textures.exists(dynamicReplayBtnKey)) {
      this.load.image(dynamicReplayBtnKey, uiConfig.replayBtnPath);
    }
    if (uiConfig.logoPath && !this.textures.exists(dynamicLogoKey)) {
      this.load.image(dynamicLogoKey, uiConfig.logoPath);
    }
  }

  create(data: ResultSceneData) {
    const isSequenceMode = data.sequence?.isSequence === true;
    if (!isSequenceMode) {
      void postLiveDashboardIfEligible(this.game, data);
    }

    if (data.gameKey === "situation" && this.cache.audio.exists("sfx_level_complete")) {
      guardedScenePlay(this, "sfx_level_complete", 1);
    }
    /** แถบ sequence แสดงเฉพาะ Home + หน้าเล่นเกม — ไม่แสดงบน Result */
    hideSequenceHudDom();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      hideSequenceHudDom();
    });

    const { width, height } = this.scale;
    const mobile = isMobileLayout();
    const desktopResultScale = mobile
      ? 1
      : Phaser.Math.Clamp(
          Math.min(width / DESKTOP_RESULT_LAYOUT_WIDTH, height / DESKTOP_RESULT_LAYOUT_HEIGHT),
          0.65,
          1
        );
    const panelObjects: Phaser.GameObjects.GameObject[] = [];
    const addToPanel = <T extends Phaser.GameObjects.GameObject>(obj: T): T => {
      panelObjects.push(obj);
      return obj;
    };

  
    this.cameras.main.setScroll(0, 0);
    this.cameras.main.setBounds(0, 0, width, height);
    this.cameras.main.setBackgroundColor("rgba(0,0,0,0)");
 
    this.add
      .rectangle(width / 2, height / 2, width, height, 0x000000, 0.55)
      .setDepth(10);
 
    const uiConfig = this.getResultUiConfig(data.gameKey, data, mobile);
    const bgTextureKey = this.resolveResultBgTextureKey(data.gameKey, uiConfig);
    const isSequence = data.sequence?.isSequence === true;
    const seq = data.sequence;
    const isLastInSequence = isSequence && seq != null && seq.index >= seq.total - 1;
    const failedByResultLabel = (data.scoreLabel ?? "").trim() === "ไม่ผ่าน";
    const mustReplayToContinue =
      isSequence &&
      !isLastInSequence &&
      sequenceGameRequiresPass(data.gameKey) &&
      (data.liveDashboardFlappyPassed === false || failedByResultLabel);
    const useNextInSequence = isSequence && !isLastInSequence && !mustReplayToContinue;
    const replayTextureKey = mustReplayToContinue
      ? this.resolveReplayBtnTextureKey(data.gameKey, uiConfig)
      : useNextInSequence
        ? "result_next_btn_default"
        : isLastInSequence && isSequence
          ? "result_resultbtn_default"
          : this.resolveReplayBtnTextureKey(data.gameKey, uiConfig);
    const logoTextureKey = this.resolveLogoTextureKey(data.gameKey, uiConfig);
    const hasLogo = logoTextureKey != null;

    const panelOffsetY = uiConfig.panelOffsetY ?? 50;
    const tex = this.textures.get(bgTextureKey).getSourceImage() as HTMLImageElement;
    const texW = tex?.naturalWidth || tex?.width || 400;
    const texH = tex?.naturalHeight || tex?.height || 580;
    const maxCardWByHeight = height * 0.92 * (texW / texH);
    const targetCardW = mobile ? width * 0.94 : width * 0.86;
    const maxCardW = mobile
      ? Math.min(Math.round(width * 0.96), 720)
      : Math.round(420 * desktopResultScale);
    const cardW = Math.min(targetCardW, maxCardW, maxCardWByHeight);
    const cardH = (texH / texW) * cardW;
    const cx = width / 2;
    const cy = height / 2 + panelOffsetY;
    const cardTop = cy - cardH / 2;
    this.createResultParticles(cx, cy, cardW, cardH, desktopResultScale);

    
    addToPanel(
      this.add
      .image(cx, cy, bgTextureKey)
      .setDisplaySize(cardW, cardH)
      .setDepth(11)
    );

    const s = cardW / (mobile ? 460 : 400);
    if (hasLogo && logoTextureKey) {
      const logoTex = this.textures.get(logoTextureKey).getSourceImage() as HTMLImageElement;
      const logoTexW = logoTex?.naturalWidth || logoTex?.width || 300;
      const logoTexH = logoTex?.naturalHeight || logoTex?.height || 100;
      const logoTopGap = uiConfig.logoTopGap ?? 8;
      const topMargin = mobile ? 12 : 18;
      const logoMaxW = cardW * (uiConfig.logoMaxWidthRatio ?? (mobile ? 0.7 : 1));
      const logoMaxH = Math.max(1, cardTop - logoTopGap - topMargin);
      const logoScale = Math.min(logoMaxW / logoTexW, logoMaxH / logoTexH);
      const logoW = logoTexW * logoScale;
      const logoH = logoTexH * logoScale;
      const logoY = cardTop - logoTopGap - logoH / 2;
      addToPanel(
        this.add
          .image(cx, logoY, logoTextureKey)
          .setDisplaySize(logoW, logoH)
          .setDepth(12)
      );
    }

    const boxW = cardW * (mobile ? 0.70 : 0.62);
    const boxH = Math.round(50 * s);
 
    
    const scoreLabelYRatio = hasLogo
      ? (uiConfig.scoreLabelYRatioWithLogo ?? 0.25)
      : (uiConfig.scoreLabelYRatio ?? 0.27);
    const scoreBoxYRatio = hasLogo
      ? (uiConfig.scoreBoxYRatioWithLogo ?? 0.35)
      : (uiConfig.scoreBoxYRatio ?? 0.35);
    const scoreLabelY = cardTop + cardH * scoreLabelYRatio;
    const scoreBoxY = cardTop + cardH * scoreBoxYRatio;
    const scoreLabelText = (data.scoreLabel ?? "").trim() || "จำนวนข้อที่ทำได้";
    const scoreLabelColor =
      data.scoreLabelColor ?? (scoreLabelText === "ไม่ผ่าน" ? "#ef4444" : "#0092d7");
    const formattedTime = this.formatResultTime(data.time);

    addToPanel(
      this.add
      .text(cx, scoreLabelY, scoreLabelText, {
        fontSize: `${Math.round(24 * s)}px`,
        color: scoreLabelColor,
        fontFamily: "Noto Sans Thai",
        padding: { top: Math.round(8 * s), bottom: Math.round(4 * s) },
      })
      .setOrigin(0.5)
      .setDepth(12)
    );

    addToPanel(
      this.add
      .graphics()
      .setDepth(12)
      .fillStyle(0xdbeafe, 1)
      .fillRoundedRect(cx - boxW / 2, scoreBoxY - boxH / 2, boxW, boxH, boxH / 2)
    );

    const showTotalSuffix =
      scoreLabelText !== "ไม่ผ่าน" &&
      data.total != null &&
      Number(data.total) > 0;
    const scoreText = showTotalSuffix ? `${data.score}/${data.total}` : `${data.score}`;
    addToPanel(
      this.add
      .text(cx, scoreBoxY, scoreText, {
        fontSize: `${Math.round(24 * s)}px`,
        color: "#0092d7",
        fontFamily: "Noto Sans Thai",
        fontStyle: "bold",
      })
      .setOrigin(0.5)
      .setDepth(13)
    );

 
    const timeLabelY = cardTop + cardH * (uiConfig.timeLabelYRatio ?? 0.45);
    const timeBoxY = cardTop + cardH * (uiConfig.timeBoxYRatio ?? 0.55);

    addToPanel(
      this.add
      .text(cx, timeLabelY, "เวลาทั้งหมด", {
        fontSize: `${Math.round(24 * s)}px`,
        color: "#0092d7",
        fontFamily: "Noto Sans Thai",
        padding: { top: Math.round(8 * s), bottom: Math.round(4 * s) },
      })
      .setOrigin(0.5)
      .setDepth(12)
    );

    addToPanel(
      this.add
      .graphics()
      .setDepth(12)
      .fillStyle(0xdbeafe, 1)
      .fillRoundedRect(cx - boxW / 2, timeBoxY - boxH / 2, boxW, boxH, boxH / 2)
    );

    addToPanel(
      this.add
      .text(cx, timeBoxY, formattedTime, {
        fontSize: `${Math.round(22 * s)}px`,
        color: "#0092d7",
        fontFamily: "Noto Sans Thai",
        fontStyle: "bold",
      })
      .setOrigin(0.5)
      .setDepth(13)
    );

  
    const btnW = cardW * (mobile ? 0.78 : 0.74);
    const rpTex = this.textures.get(replayTextureKey).getSourceImage() as HTMLImageElement;
    const rpTexW = rpTex?.naturalWidth || rpTex?.width || 360;
    const rpTexH = rpTex?.naturalHeight || rpTex?.height || 100;
    const replayBtnH = (rpTexH / rpTexW) * btnW;

    let btn2Y = cardTop + cardH * (uiConfig.replayButtonYRatio ?? 0.72);
    const bottomPadding = cardH * 0.05;
    const bottomLimit = cardTop + cardH - bottomPadding;
    const overflow = btn2Y + replayBtnH / 2 - bottomLimit;
    if (overflow > 0) {
      btn2Y -= overflow;
    }

  
    const replayBtn = addToPanel(
      this.add
      .image(cx, btn2Y, replayTextureKey)
      .setDisplaySize(btnW, replayBtnH)
      .setDepth(12)
      .setInteractive({ useHandCursor: true })
    );

    replayBtn.on("pointerdown", () => {
      replayBtn.disableInteractive();

      if (data.resultPreview === true) {
        this.scene.stop("ResultScene");
        console.log("[ResultScene] resultPreview — ปิดแล้ว (ไม่มี scene เกมให้ restart)");
        return;
      }

      if (isSequence) {
        this.sound.stopAll();
        const targetScene = this.scene.get(data.gameKey);
        if (mustReplayToContinue) {
          targetScene.events.emit("sequence-next", {
            sceneKey: data.gameKey,
            replayCurrentGame: true,
          });
          return;
        }
        if (isLastInSequence) {
          targetScene.events.emit("sequence-next", {
            sceneKey: data.gameKey,
            score: data.score,
            total: data.total,
            time: data.time,
            showSequenceSummary: true,
          });
          return;
        }
        targetScene.events.emit("sequence-next", {
          sceneKey: data.gameKey,
          score: data.score,
          total: data.total,
          time: data.time,
        });
        return;
      }

      const targetScene = this.scene.get(data.gameKey);
      targetScene.events.once(Phaser.Scenes.Events.CREATE, () => {
        this.scene.stop("ResultScene");
      });

      targetScene.scene.restart();
    });

    const enterOffsetY = mobile ? -120 : Math.round(-150 * desktopResultScale);
    panelObjects.forEach((obj) => {
      const target = obj as unknown as { y: number; alpha: number };
      target.y += enterOffsetY;
      target.alpha = 0;
    });
    this.tweens.add({
      targets: panelObjects,
      y: `+=${Math.abs(enterOffsetY)}`,
      alpha: 1,
      duration: 620,
      ease: "Cubic.easeOut",
      stagger: 16,
    });
  }

  private formatResultTime(timeInSeconds: number): string {
    const safeSeconds = Math.max(0, Math.floor(timeInSeconds));
    const m = Math.floor(safeSeconds / 60);
    const s = safeSeconds % 60;
    return `${m}:${s.toString().padStart(2, "0")} นาที`;
  }

  private createResultParticles(
    cardCenterX: number,
    cardCenterY: number,
    cardWidth: number,
    cardHeight: number,
    desktopDecorScale = 1
  ) {
    const { width, height } = this.scale;
    const mobile = isMobileLayout();
    const ringX = cardWidth * (mobile ? 0.9 : 1.02);
    const ringY = cardHeight * (mobile ? 0.98 : 1.08);
    const emitterCount = mobile ? 10 : 14;
    const positions: Array<{ x: number; y: number; angleMin: number; angleMax: number }> = [];
    for (let i = 0; i < emitterCount; i += 1) {
      const t = (i / emitterCount) * Math.PI * 2;
      const px = cardCenterX + Math.cos(t) * ringX;
      const py = cardCenterY + Math.sin(t) * ringY;
      const outwardDeg = Phaser.Math.RadToDeg(t);
      positions.push({
        x: Phaser.Math.Clamp(px, 20, width - 20),
        y: Phaser.Math.Clamp(py, 20, height - 20),
        angleMin: outwardDeg - 26,
        angleMax: outwardDeg + 26,
      });
    }

    positions.forEach((pos, index) => {
      const emitter = this.add.particles(pos.x, pos.y, "result_star_fx", {
        speed: { min: 18, max: 65 },
        angle: { min: pos.angleMin, max: pos.angleMax },
        lifespan: { min: 1300, max: 2400 },
        scale: {
          onEmit: () => Phaser.Math.FloatBetween(0.18, 0.42),
          onUpdate: (_p, _k, t, value) => Math.max(0.05, value * (1 - t * 0.8)),
        },
        alpha: { start: 0.95, end: 0 },
        quantity: 1,
        frequency: Phaser.Math.Between(85, 145) + index * 6,
        blendMode: Phaser.BlendModes.ADD,
      });
      emitter.setDepth(10.7);
    });

    positions.forEach((pos, index) => {
      const burstEmitter = this.add.particles(pos.x, pos.y, "result_star_fx", {
        speed: { min: 22, max: 78 },
        angle: { min: pos.angleMin, max: pos.angleMax },
        lifespan: { min: 900, max: 1800 },
        scale: {
          onEmit: () => Phaser.Math.FloatBetween(0.12, 0.28),
          onUpdate: (_p, _k, t, value) => Math.max(0.04, value * (1 - t * 0.92)),
        },
        alpha: { start: 0.8, end: 0 },
        quantity: 2,
        frequency: Phaser.Math.Between(170, 260) + index * 8,
        blendMode: Phaser.BlendModes.ADD,
      });
      burstEmitter.setDepth(10.72);
    });

    const heroBaseSize = mobile ? 62 : Math.max(48, Math.round(88 * desktopDecorScale));
    const heroStars = [
      { x: cardCenterX - cardWidth * 0.48, y: cardCenterY - cardHeight * 0.58, size: heroBaseSize + 14 },
      { x: cardCenterX + cardWidth * 0.5, y: cardCenterY - cardHeight * 0.52, size: heroBaseSize + 8 },
      { x: cardCenterX - cardWidth * 0.62, y: cardCenterY - cardHeight * 0.08, size: heroBaseSize + 4 },
      { x: cardCenterX + cardWidth * 0.6, y: cardCenterY + cardHeight * 0.1, size: heroBaseSize },
      { x: cardCenterX - cardWidth * 0.42, y: cardCenterY + cardHeight * 0.56, size: heroBaseSize + 12 },
      { x: cardCenterX + cardWidth * 0.44, y: cardCenterY + cardHeight * 0.58, size: heroBaseSize + 16 },
      { x: cardCenterX - cardWidth * 0.06, y: cardCenterY - cardHeight * 0.66, size: heroBaseSize + 10 },
      { x: cardCenterX + cardWidth * 0.04, y: cardCenterY + cardHeight * 0.68, size: heroBaseSize + 6 },
    ];

    heroStars.forEach((item, index) => {
      const safeX = Phaser.Math.Clamp(item.x, 26, width - 26);
      const safeY = Phaser.Math.Clamp(item.y, 26, height - 26);
      const star = this.add
        .image(safeX, safeY, "result_star_fx")
        .setDisplaySize(item.size, item.size)
        .setAlpha(0.8)
        .setDepth(10.75);
      this.tweens.add({
        targets: star,
        alpha: { from: 0.38, to: 1 },
        scale: { from: 0.7, to: 1.14 },
        duration: 1150 + index * 90,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
        delay: index * 120,
      });
    });
  }

  private getResultUiConfig(
    gameKey: string,
    data?: ResultSceneData,
    mobileLayout = isMobileLayout()
  ): ResultUiConfig {
    const gameDefaults: Record<string, ResultUiGameDefaults> = {
      "flip-cards": {
        resultBgPath: "assets/flip-cards/result_bg.png",
        replayBtnPath: "assets/flip-cards/replay_btn.png",
        logoPath: "assets/flip-cards/icon_result.png",
        logoTopGap: 8,
        logoMaxWidthRatioMobile: 0.72,
        logoMaxWidthRatioDesktop: 0.86,
      },
      anagram: {
        resultBgPath: "assets/anagram/result_bg.png",
        replayBtnPath: "assets/anagram/replay_btn.png",
        logoPath: "assets/anagram/icon_howtoplay_anagram.png",
        logoTopGap: 8,
        logoMaxWidthRatioMobile: 0.72,
        logoMaxWidthRatioDesktop: 0.86,
      },
      "whack-a-mole": {
        resultBgPath: "assets/whack-a-mole/result_bg.png",
        replayBtnPath: "assets/whack-a-mole/replay_btn.png",
        logoPath: "assets/whack-a-mole/icon_howtoplay_whack_a_mole.png",
        logoTopGap: 8,
        logoMaxWidthRatioMobile: 0.72,
        logoMaxWidthRatioDesktop: 0.86,
      },
      situation: {
        logoPath: "assets/situation/logo.png",
        logoTopGap: 10,
        logoMaxWidthRatioMobile: 0.82,
        logoMaxWidthRatioDesktop: 1.2,
      },
      "flying-fruits": {
        resultBgPath: "assets/flying-fruits/result_bg.png",
        replayBtnPath: "assets/flying-fruits/replay_btn.png",
        logoPath: "assets/flying-fruits/icon_flying_fruits.png",
        logoTopGap: 8,
        logoMaxWidthRatioMobile: 0.72,
        logoMaxWidthRatioDesktop: 0.86,
      },
      "game-show-quiz": {
        logoPath: "assets/game-show-quiz/logo.png",
        logoTopGap: 12,
        logoMaxWidthRatioMobile: 0.72,
        logoMaxWidthRatioDesktop: 0.88,
        panelOffsetY: 56,
      },
      "flappy-bird": {
        logoPath: "assets/flappy-bird/logo.png",
        logoTopGap: 10,
        logoMaxWidthRatioMobile: 0.92,
        logoMaxWidthRatioDesktop: 0.98,
      },
      "find-the-match": {
        logoPath: "assets/find-the-match/logo.png",
        logoTopGap: 10,
        logoMaxWidthRatioMobile: 0.92,
        logoMaxWidthRatioDesktop: 0.98,
      },
      "complete-the-sentence": {
        logoPath: "assets/complete-the-sentence/logo.png",
        logoTopGap: 10,
        logoMaxWidthRatioMobile: 0.72,
        logoMaxWidthRatioDesktop: 0.86,
      },
    };

    const defaults = gameDefaults[gameKey] ?? {};
    const logoMaxWidthRatio =
      (mobileLayout ? defaults.logoMaxWidthRatioMobile : defaults.logoMaxWidthRatioDesktop) ??
      defaults.logoMaxWidthRatio;

    return {
      resultBgPath: data?.resultBgPath ?? defaults.resultBgPath,
      replayBtnPath: data?.replayBtnPath ?? defaults.replayBtnPath,
      logoPath: data?.logoPath ?? defaults.logoPath,
      logoKey: data?.logoKey ?? defaults.logoKey,
      panelOffsetY: data?.panelOffsetY ?? defaults.panelOffsetY,
      logoTopGap: defaults.logoTopGap,
      logoMaxWidthRatio,
      scoreLabelYRatio: data?.scoreLabelYRatio ?? defaults.scoreLabelYRatio,
      scoreLabelYRatioWithLogo: data?.scoreLabelYRatioWithLogo ?? defaults.scoreLabelYRatioWithLogo,
      scoreBoxYRatio: data?.scoreBoxYRatio ?? defaults.scoreBoxYRatio,
      scoreBoxYRatioWithLogo: data?.scoreBoxYRatioWithLogo ?? defaults.scoreBoxYRatioWithLogo,
      timeLabelYRatio: data?.timeLabelYRatio ?? defaults.timeLabelYRatio,
      timeBoxYRatio: data?.timeBoxYRatio ?? defaults.timeBoxYRatio,
      replayButtonYRatio: data?.replayButtonYRatio ?? defaults.replayButtonYRatio,
    };
  }

  private getResultBgTextureKey(gameKey: string): string {
    return `result_bg_${gameKey}`;
  }

  private getReplayBtnTextureKey(gameKey: string): string {
    return `result_replay_btn_${gameKey}`;
  }

  private getLogoTextureKey(gameKey: string, customKey?: string): string {
    return customKey ?? `result_logo_${gameKey}`;
  }

  private resolveResultBgTextureKey(gameKey: string, uiConfig: ResultUiConfig): string {
    const dynamicKey = this.getResultBgTextureKey(gameKey);
    if (uiConfig.resultBgPath && this.textures.exists(dynamicKey)) {
      return dynamicKey;
    }
    return "result_bg_default";
  }

  private resolveReplayBtnTextureKey(gameKey: string, uiConfig: ResultUiConfig): string {
    const dynamicKey = this.getReplayBtnTextureKey(gameKey);
    if (uiConfig.replayBtnPath && this.textures.exists(dynamicKey)) {
      return dynamicKey;
    }
    return "result_replay_btn_default";
  }

  private resolveLogoTextureKey(gameKey: string, uiConfig: ResultUiConfig): string | null {
    if (!uiConfig.logoPath) return null;
    const dynamicKey = this.getLogoTextureKey(gameKey, uiConfig.logoKey);
    if (this.textures.exists(dynamicKey)) return dynamicKey;
    return null;
  }
}
