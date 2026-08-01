import Phaser from "phaser";
import { BaseGameScene } from "../../core/scenes/BaseGameScene";
import type { HomeActionPayload } from "../../core/scenes/HomeScene";

export default class FindTheMatchGameScene extends BaseGameScene {
  constructor() {
    super("find-the-match");
  }

  create() {
    super.create();
    this.scene.launch("HomeScene", {
      gameKey: this.scene.key,
      ui: {
        startButtonPath: "assets/flip-cards/btn_start.png",
        howToButtonPath: "assets/flip-cards/btn_howto.png",
        startButtonWidth: 320,   
       howToButtonWidth: 260,
         
  
  
    // startButtonWidth: 320,
    // startButtonHeight: 96,
      },
    });
    this.scene.bringToTop("HomeScene");

    const homeScene = this.scene.get("HomeScene");
    const onHomeAction = (payload: HomeActionPayload) => {
      if (payload.gameKey !== this.scene.key) return;
      if (payload.action === "howto") {
        this.events.emit("howto");
        console.log(`[${this.scene.key}] howto clicked`);
        this.openHowToPopup(); // sample howto
      return;
      }
    };
    homeScene.events.on("home-action", onHomeAction);

    this.input.enabled = false;
    homeScene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      homeScene.events.off("home-action", onHomeAction);
      this.input.enabled = true;
    });

    const { width, height } = this.scale;

    this.add
      .text(width / 2, height / 2, "Find The Match", {
        font: '500 32px "Noto Sans Thai", sans-serif',
        color: "#00ff00",
      })
      .setOrigin(0.5);

    this.input.once("pointerdown", () => {
      this.score = 10;
      this.endGame();  
    });
  }

  private openHowToPopup() {
    const { width, height } = this.scale;
  
    const dim = this.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.6).setDepth(3000);
    const panel = this.add.rectangle(width / 2, height / 2, width * 0.8, height * 0.6, 0xffffff).setDepth(3001);
  
    const closeText = this.add
      .text(width / 2, height * 0.75, "ปิด", {
        font: '500 32px "Noto Sans Thai", sans-serif',
        color: "#000",
      })
      .setOrigin(0.5)
      .setDepth(3002)
      .setInteractive({ useHandCursor: true });
  
    closeText.once("pointerdown", () => {
      dim.destroy();
      panel.destroy();
      closeText.destroy();
    });
  }
}
