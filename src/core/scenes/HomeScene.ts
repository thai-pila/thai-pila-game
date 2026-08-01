import Phaser from "phaser";
import { guardedScenePlay } from "../audio/sceneAudio";
import { setSequenceBarLayout } from "../../utils/sequenceHudDom";
import type { BaseGameScene } from "./BaseGameScene";

export type HomeActionType = "start" | "howto";

export type HomeActionPayload = {
  action: HomeActionType;
  gameKey: string;
};

export type HomeSceneUIConfig = {
  startButtonPath?: string;
  startButtonKey?: string;
  howToButtonPath?: string;
  howToButtonKey?: string;
  startButtonWidth?: number;
  startButtonHeight?: number;
  howToButtonWidth?: number;
  howToButtonHeight?: number;
  startButtonYRatio?: number;
  howToButtonYRatio?: number;
  minButtonGapPx?: number;
  homeLogoPath?: string;
  homeLogoKey?: string;
  homeLogoWidth?: number;
  homeLogoYRatio?: number;
  homeLogoSwingAngle?: number;
  homeLogoSwingDurationMs?: number;
  homeQuestionLogoPath?: string;
  homeQuestionLogoKey?: string;
  homeQuestionLogoWidth?: number;
  homeQuestionLogoOffsetX?: number;
  homeQuestionLogoOffsetY?: number;
  /** false = กดวิธีเล่นแล้วไม่ซ่อนปุ่มเริ่ม/วิธีเล่น (ให้เกมแสดงโอเวอร์เองแล้วปิดได้) — ค่าเริ่มต้น true */
  howtoHidesHomeButtons?: boolean;
};

export type HomeSceneData = {
  gameKey: string;
  ui?: HomeSceneUIConfig;
};

export function getHomeSceneButtonKeys(gameKey: string, ui?: HomeSceneUIConfig) {
  return {
    startKey: ui?.startButtonKey ?? `${gameKey}_home_btn_start`,
    howToKey: ui?.howToButtonKey ?? `${gameKey}_home_btn_howto`,
  };
}

export class HomeScene extends Phaser.Scene {
  private launchData: HomeSceneData = { gameKey: "" };

  constructor() {
    super("HomeScene");
  }

  init(data: HomeSceneData) {
    this.launchData = data ?? { gameKey: "" };
  }

  preload() {
    const ui = this.launchData.ui;
    const gameKey = this.launchData.gameKey;
    const { startKey, howToKey } = getHomeSceneButtonKeys(gameKey, ui);

    if (!this.textures.exists(startKey)) {
      this.load.image(startKey, ui?.startButtonPath ?? "assets/home/btn_start.png");
    }

    if (!this.textures.exists(howToKey)) {
      this.load.image(howToKey, ui?.howToButtonPath ?? "assets/home/btn_howto.png");
    }
    if (ui?.homeLogoPath) {
      const logoKey = ui.homeLogoKey ?? `${this.scene.key}_home_logo`;
      if (!this.textures.exists(logoKey)) {
        this.load.image(logoKey, ui.homeLogoPath);
      }
    }
    if (ui?.homeQuestionLogoPath) {
      const questionLogoKey = ui.homeQuestionLogoKey ?? `${this.scene.key}_home_question_logo`;
      if (!this.textures.exists(questionLogoKey)) {
        this.load.image(questionLogoKey, ui.homeQuestionLogoPath);
      }
    }
    if (!this.cache.audio.exists("sfx_click_default")) {
      this.load.audio("sfx_click_default", "assets/sound/ui/click.mp3");
    }

  }

  create(data: HomeSceneData) {
    const { width, height } = this.scale;
    const ui = data?.ui ?? this.launchData.ui;
    const gameKey = data?.gameKey ?? this.launchData.gameKey;

    const gameScene = this.scene.get(gameKey) as BaseGameScene | undefined;
    const seqCtx = gameScene?.getSequenceContext?.();
    if (seqCtx?.isSequence && seqCtx.exerciseNames?.length) {
      setSequenceBarLayout("fixed", seqCtx);
    } else {
      setSequenceBarLayout("off");
    }

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      const latestGameScene = this.scene.get(gameKey) as BaseGameScene | undefined;
      const latestSeqCtx = latestGameScene?.getSequenceContext?.();
      if (latestSeqCtx?.isSequence && latestSeqCtx.exerciseNames?.length) {
        setSequenceBarLayout("gameplay-peek", latestSeqCtx);
      }
    });

    this.cameras.main.setBackgroundColor("rgba(0,0,0,0)");

    const { startKey, howToKey } = getHomeSceneButtonKeys(gameKey, ui);

    const centerX = width / 2;
    const startY = height * (ui?.startButtonYRatio ?? 0.66);
    const howToY = height * (ui?.howToButtonYRatio ?? 0.79);
    const logoKey = ui?.homeLogoKey ?? `${this.scene.key}_home_logo`;
    const questionLogoKey = ui?.homeQuestionLogoKey ?? `${this.scene.key}_home_question_logo`;

    if (ui?.homeLogoPath && this.textures.exists(logoKey)) {
      const logoY = height * (ui.homeLogoYRatio ?? 0.47);
      const baseLogo = this.add
        .image(centerX, logoY, logoKey)
        .setOrigin(0.5)
        .setDepth(999);
      this.applyButtonSize(baseLogo, ui.homeLogoWidth);

      const swingAngle = ui.homeLogoSwingAngle ?? 1.2;
      const swingDuration = ui.homeLogoSwingDurationMs ?? 700;
      this.tweens.add({
        targets: baseLogo,
        angle: { from: -swingAngle, to: swingAngle },
        duration: swingDuration,
        ease: "Sine.easeInOut",
        yoyo: true,
        repeat: -1,
      });

      if (ui?.homeQuestionLogoPath && this.textures.exists(questionLogoKey)) {
        const questionLogo = this.add
          .image(
            centerX + (ui.homeQuestionLogoOffsetX ?? 120),
            logoY + (ui.homeQuestionLogoOffsetY ?? 10),
            questionLogoKey
          )
          .setOrigin(0.5)
          .setDepth(1000);
        this.applyButtonSize(questionLogo, ui.homeQuestionLogoWidth);
        this.tweens.add({
          targets: questionLogo,
          angle: { from: -12, to: 12 },
          duration: 360,
          ease: "Sine.easeInOut",
          yoyo: true,
          repeat: -1,
        });
      }
    }

    const btnStart = this.textures.exists(startKey)
      ? this.add.image(centerX, startY, startKey).setOrigin(0.5).setDepth(1000).setInteractive({ useHandCursor: true })
      : this.add
          .text(centerX, startY, "เริ่มเกม", {
            font: '500 56px "Noto Sans Thai", sans-serif',
            color: "#ffffff",
            backgroundColor: "#2b8a3e",
            padding: { x: 24, y: 12 },
          })
          .setOrigin(0.5)
          .setDepth(1000)
          .setInteractive({ useHandCursor: true });

    const btnHowTo = this.textures.exists(howToKey)
      ? this.add.image(centerX, howToY, howToKey).setOrigin(0.5).setDepth(1000).setInteractive({ useHandCursor: true })
      : this.add
          .text(centerX, howToY, "วิธีเล่น", {
            font: '500 44px "Noto Sans Thai", sans-serif',
            color: "#ffffff",
            backgroundColor: "#3da8b3",
            padding: { x: 24, y: 12 },
          })
          .setOrigin(0.5)
          .setDepth(1000)
          .setInteractive({ useHandCursor: true });

    if (btnStart instanceof Phaser.GameObjects.Image) {
      this.applyButtonSize(btnStart, ui?.startButtonWidth, ui?.startButtonHeight);
    }

    if (btnHowTo instanceof Phaser.GameObjects.Image) {
      this.applyButtonSize(btnHowTo, ui?.howToButtonWidth, ui?.howToButtonHeight);
    }

    if (btnStart instanceof Phaser.GameObjects.Image && btnHowTo instanceof Phaser.GameObjects.Image) {
      const isShortScreen = height <= 760;
      const minGap = ui?.minButtonGapPx ?? (isShortScreen ? 24 : 18);
      const currentGap = btnHowTo.y - btnStart.y - (btnStart.displayHeight + btnHowTo.displayHeight) / 2;
      if (currentGap < minGap) {
        btnHowTo.setY(btnHowTo.y + (minGap - currentGap));
      }
    }

    this.attachButtonHover(btnStart);
    this.attachButtonHover(btnHowTo);

    btnStart.once("pointerdown", () => {
      this.playClickSfx();
      const gameScene = this.scene.get(gameKey);
      gameScene?.events.emit("home-dismissed-for-play");
      this.events.emit("home-action", { action: "start", gameKey } as HomeActionPayload);
      this.scene.stop("HomeScene");
    });

    btnHowTo.on("pointerdown", () => {
      this.playClickSfx();
      if (ui?.howtoHidesHomeButtons !== false) {
        btnStart.disableInteractive().setVisible(false);
        btnHowTo.disableInteractive().setVisible(false);
      }
      this.events.emit("home-action", { action: "howto", gameKey } as HomeActionPayload);
    });
  }

  private playClickSfx() {
    guardedScenePlay(this, "sfx_click_default", 1);
  }

  private applyButtonSize(button: Phaser.GameObjects.Image, targetWidth?: number, targetHeight?: number) {
    if (!targetWidth && !targetHeight) return;

    const tex = button.texture.getSourceImage() as HTMLImageElement;
    const texW = tex?.naturalWidth || tex?.width || 1;
    const texH = tex?.naturalHeight || tex?.height || 1;
    const ratio = texW / texH;

    if (targetWidth && targetHeight) {
      button.setDisplaySize(targetWidth, targetHeight);
      return;
    }

    if (targetWidth) {
      button.setDisplaySize(targetWidth, targetWidth / ratio);
      return;
    }

    if (targetHeight) {
      button.setDisplaySize(targetHeight * ratio, targetHeight);
    }
  }

  private attachButtonHover(button: Phaser.GameObjects.Image | Phaser.GameObjects.Text) {
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
      if (button instanceof Phaser.GameObjects.Image) {
        button.setTint(0xf2f2f2);
      } else {
        button.setAlpha(0.95);
      }
    });

    button.on("pointerout", () => {
      animateScale(1);
      if (button instanceof Phaser.GameObjects.Image) {
        button.clearTint();
      } else {
        button.setAlpha(1);
      }
    });

    button.on("pointerdown", () => {
      animateScale(0.98);
    });

    button.on("pointerup", () => {
      animateScale(1.05);
    });
  }
}
