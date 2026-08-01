import Phaser from "phaser";

export type TeacherState = "standby" | "point" | "clap";

const TEACHER_STANDBY_SHEET_KEY = "teacher_standby_sheet";
const TEACHER_POINT_SHEET_KEY = "teacher_point_sheet";
const TEACHER_CLAP_SHEET_KEY = "teacher_clap_sheet";
const TEACHER_STANDBY_ANIM_KEY = "teacher_standby_anim";
const TEACHER_POINT_ANIM_KEY = "teacher_point_anim";
const TEACHER_CLAP_ANIM_KEY = "teacher_clap_anim";

type TeacherFrameRange = { start: number; end: number };

const TEACHER_STANDBY_RANGE: TeacherFrameRange = { start: 0, end: 9 };
const TEACHER_POINT_RANGE: TeacherFrameRange = { start: 0, end: 9 };

 
const TEACHER_FEET_LIFT_PX_DEFAULT = 25;
const TEACHER_FEET_LIFT_PX_MOBILE_DEFAULT = 10;
const TEACHER_FEET_Y_OFFSET_DESKTOP = 20;
const TEACHER_FEET_Y_OFFSET_MOBILE_DEFAULT = 32;

type TeacherLayout = {
  frameWidth: number;
  frameHeight: number;
  offsetX: number;
  offsetY: number;
};

const TEACHER_LAYOUTS: Record<TeacherState, TeacherLayout> = {
  standby: { frameWidth: 720, frameHeight: 720, offsetX: 0, offsetY: 0 },
  point: { frameWidth: 720, frameHeight: 720, offsetX: 0, offsetY: 0 },
  clap: { frameWidth: 720, frameHeight: 720, offsetX: 0, offsetY: 0 },
};

export type TeacherAssistantOptions = {
  mobile: boolean;
  depth?: number;
  leftMarginMobile?: number;
  leftMarginDesktop?: number;
  bottomMarginMobile?: number;
  bottomMarginDesktop?: number;
  largeHeightRatioMobile?: number;
  largeHeightRatioDesktop?: number;
  smallHeightRatioMobile?: number;
  smallHeightRatioDesktop?: number;
  /**
   * เดสก์ท็อป: วางครูซ้ายขวากล่องข้อความ (จุดกึ่งกลางแนวตั้งตรงกับกล่อง) แทนมุมล่างซ้าย
   * @default true
   */
  desktopBesideMessage?: boolean;
  /** จุดกึ่งกลางแนวนอนของกล่องข้อความ (สัดส่วนจากความกว้างจอ) — เกมที่กล่องอยู่กลางจอใช้ 0.5 */
  desktopPopupCenterXRatio?: number;
  /** ความกว้างกล่องข้อความสัดส่วน — ใช้คู่กับ desktopPopupMaxWidthPx */
  desktopPopupBoxWidthRatio?: number;
  desktopPopupMaxWidthPx?: number;
  desktopPopupBoxHeightPx?: number;
  /** ระยะจากขอบล่างจอถึงขอบล่างของกล่องข้อความ (ใช้คู่กับ boxHeight) */
  desktopPopupBottomMarginPx?: number;
  /** ระยะว่างระหว่างครูกับกล่อง */
  desktopBesideGapPx?: number;
  desktopMinEdgeMarginPx?: number;
  /**
   * วางครูชิดขอบซ้ายจอ (เช่น เกมที่กริดการ์ดกินพื้นที่กลางจนบังครู)
   * @default false
   */
  anchorLeftEdge?: boolean;
  /** ระยะห่างจากขอบซ้ายเมื่อ anchorLeftEdge (มือถือ) */
  leftEdgeInsetMobile?: number;
  /** ระยะห่างจากขอบซ้ายเมื่อ anchorLeftEdge (เดสก์ท็อป) */
  leftEdgeInsetDesktop?: number;
  /**
   * วางครูชิดขอบขวาจอ (เช่น เกมที่กริดการ์ดกินพื้นที่กลางจนบังครู)
   * @default false
   */
  anchorRightEdge?: boolean;
  /** ระยะห่างจากขอบขวาเมื่อ anchorRightEdge (มือถือ) */
  rightEdgeInsetMobile?: number;
  /** ระยะห่างจากขอบขวาเมื่อ anchorRightEdge (เดสก์ท็อป) */
  rightEdgeInsetDesktop?: number;
  /**
   * ระยะ "ยกขึ้น" ของครู (พิกเซล) — ตั้งให้ครูลอยพ้นขอบล่างไว้กันเท้าจมขอบ
   * - ค่าน้อย/0 = ครูชิดขอบล่างมากขึ้น
   * - ค่าลบ = ครูจมลงเลยขอบ (เห็นแค่บางส่วน)
   * @default 25 (เดสก์ท็อป) / 10 (มือถือ)
   */
  feetLiftPx?: number;
  /** ยกน้อยลงบนมือถือ — ครูไม่ลอยห่างขอบล่าง */
  feetLiftPxMobile?: number;
  /** จุดยืนของเท้าเทียบขอบล่างจอ (+ = จมลงเล็กน้อย) */
  mobileFeetYOffsetPx?: number;
};

export class TeacherAssistant {
  private readonly scene: Phaser.Scene;
  private readonly options: Required<TeacherAssistantOptions>;
  private sprite?: Phaser.GameObjects.Sprite;
  private compact = true;
  private currentState: TeacherState = "standby";

  static preload(scene: Phaser.Scene) {
    if (!scene.textures.exists(TEACHER_STANDBY_SHEET_KEY)) {
      scene.load.spritesheet(TEACHER_STANDBY_SHEET_KEY, "assets/common/teacher/idle_standby.png", {
        frameWidth: 720,
        frameHeight: 720,
      });
    }
    if (!scene.textures.exists(TEACHER_POINT_SHEET_KEY)) {
      scene.load.spritesheet(TEACHER_POINT_SHEET_KEY, "assets/common/teacher/point.png", {
        frameWidth: 720,
        frameHeight: 720,
      });
    }
    if (!scene.textures.exists(TEACHER_CLAP_SHEET_KEY)) {
      scene.load.spritesheet(TEACHER_CLAP_SHEET_KEY, "assets/common/teacher/clap.png", {
        frameWidth: 720,
        frameHeight: 720,
      });
    }
  }

  constructor(scene: Phaser.Scene, options: TeacherAssistantOptions) {
    this.scene = scene;
    this.options = {
      depth: 1,
      leftMarginMobile: 8,
      leftMarginDesktop: 14,
      bottomMarginMobile: 2,
      bottomMarginDesktop: 0,
      largeHeightRatioMobile: 0.30,
      largeHeightRatioDesktop: 0.40,
      smallHeightRatioMobile: 0.22,
      smallHeightRatioDesktop: 0.24,
      desktopBesideMessage: true,
      desktopPopupCenterXRatio: 0.5,
      desktopPopupBoxWidthRatio: 0.25,
      desktopPopupMaxWidthPx: 680,
      desktopPopupBoxHeightPx: 54,
      desktopPopupBottomMarginPx: 24,
      desktopBesideGapPx: 20,
      desktopMinEdgeMarginPx: 10,
      anchorLeftEdge: false,
      leftEdgeInsetMobile: 12,
      leftEdgeInsetDesktop: 14,
      anchorRightEdge: false,
      rightEdgeInsetMobile: 12,
      rightEdgeInsetDesktop: 14,
      feetLiftPx: TEACHER_FEET_LIFT_PX_DEFAULT,
      feetLiftPxMobile: TEACHER_FEET_LIFT_PX_MOBILE_DEFAULT,
      mobileFeetYOffsetPx: TEACHER_FEET_Y_OFFSET_MOBILE_DEFAULT,
      ...options,
    };
  }

  private getFeetLiftPx(): number {
    return this.options.mobile ? this.options.feetLiftPxMobile : this.options.feetLiftPx;
  }

  private getFeetYOffset(): number {
    return this.options.mobile ? this.options.mobileFeetYOffsetPx : TEACHER_FEET_Y_OFFSET_DESKTOP;
  }

  private resolveSpriteY(feetY: number): number {
    return feetY - this.getFeetLiftPx();
  }

  create(initialState: TeacherState = "standby", compact = true) {
    this.ensureAnimations();
    this.sprite?.destroy();
    this.sprite = this.scene.add
      .sprite(0, 0, TEACHER_STANDBY_SHEET_KEY, 0)
      .setOrigin(0.5, 1)
      .setDepth(this.options.depth)
      .setScrollFactor(0);
    this.compact = compact;
    this.setState(initialState);
  }

  destroy() {
    this.sprite?.destroy();
    this.sprite = undefined;
  }

  onResize() {
    this.applyLayout();
  }

  setCompact(compact: boolean, tweenMs = 0) {
    this.compact = compact;
    if (!this.sprite) return;
    if (tweenMs <= 0) {
      this.applyLayout();
      return;
    }

    const { width, height, x, y } = this.computeTargetBounds(this.currentState);
    this.scene.tweens.killTweensOf(this.sprite);
    this.scene.tweens.add({
      targets: this.sprite,
      displayWidth: width,
      displayHeight: height,
      x,
      y: this.resolveSpriteY(y),
      duration: tweenMs,
      ease: "Back.easeOut",
      easeParams: [3.5],
    });
  }

  setState(state: TeacherState) {
    if (!this.sprite) return;
    this.currentState = state;
    const key =
      state === "standby" ? TEACHER_STANDBY_ANIM_KEY : state === "point" ? TEACHER_POINT_ANIM_KEY : TEACHER_CLAP_ANIM_KEY;
    this.applyLayout();
    this.sprite.play(key, true);
  }

  private ensureAnimations() {
    if (!this.scene.anims.exists(TEACHER_STANDBY_ANIM_KEY)) {
      this.scene.anims.create({
        key: TEACHER_STANDBY_ANIM_KEY,
        frames: this.scene.anims.generateFrameNumbers(TEACHER_STANDBY_SHEET_KEY, TEACHER_STANDBY_RANGE),
        frameRate: 10,
        repeat: -1,
      });
    }
    if (!this.scene.anims.exists(TEACHER_POINT_ANIM_KEY)) {
      this.scene.anims.create({
        key: TEACHER_POINT_ANIM_KEY,
        frames: this.scene.anims.generateFrameNumbers(TEACHER_POINT_SHEET_KEY, TEACHER_POINT_RANGE),
        frameRate: 18,
        repeat: -1,
      });
    }
    if (!this.scene.anims.exists(TEACHER_CLAP_ANIM_KEY)) {
      this.scene.anims.create({
        key: TEACHER_CLAP_ANIM_KEY,
        frames: this.scene.anims.generateFrameNumbers(TEACHER_CLAP_SHEET_KEY),
        frameRate: 18,
        repeat: -1,
      });
    }
  }

  private applyLayout() {
    if (!this.sprite) return;
    const { width, height, x, y } = this.computeTargetBounds(this.currentState);
    this.sprite.setDisplaySize(width, height);
    this.sprite.setPosition(x, this.resolveSpriteY(y));
  }

  private computeTargetBounds(state: TeacherState) {
    const scale = this.scene.scale;
    const mobile = this.options.mobile;
    const layout = TEACHER_LAYOUTS[state];
    const targetHeight =
      scale.height *
      (this.compact
        ? mobile
          ? this.options.smallHeightRatioMobile
          : this.options.smallHeightRatioDesktop
        : mobile
          ? this.options.largeHeightRatioMobile
          : this.options.largeHeightRatioDesktop);

    const targetWidth = targetHeight * (layout.frameWidth / layout.frameHeight);

    if (this.options.anchorLeftEdge) {
      const h = scale.height;
      const inset = mobile ? this.options.leftEdgeInsetMobile : this.options.leftEdgeInsetDesktop;
      let feetY: number;
      if (!mobile && this.options.desktopBesideMessage) {
        const boxH = this.options.desktopPopupBoxHeightPx;
        const popupCy = h - this.options.desktopPopupBottomMarginPx - boxH / 2;
        feetY = popupCy + targetHeight / 2;
      } else {
        feetY = h - (mobile ? this.options.bottomMarginMobile : this.options.bottomMarginDesktop) + this.getFeetYOffset();
      }
      const centerX = inset + targetWidth / 2;
      return {
        width: targetWidth,
        height: targetHeight,
        x: centerX + layout.offsetX,
        y: feetY + layout.offsetY,
      };
    }

    if (this.options.anchorRightEdge) {
      const w = scale.width;
      const h = scale.height;
      const inset = mobile ? this.options.rightEdgeInsetMobile : this.options.rightEdgeInsetDesktop;
      let feetY: number;
      if (!mobile && this.options.desktopBesideMessage) {
        const boxH = this.options.desktopPopupBoxHeightPx;
        const popupCy = h - this.options.desktopPopupBottomMarginPx - boxH / 2;
        feetY = popupCy + targetHeight / 2;
      } else {
        feetY = h - (mobile ? this.options.bottomMarginMobile : this.options.bottomMarginDesktop) + this.getFeetYOffset();
      }
      const centerX = w - inset - targetWidth / 2;
      return {
        width: targetWidth,
        height: targetHeight,
        x: centerX + layout.offsetX,
        y: feetY + layout.offsetY,
      };
    }

    if (!mobile && this.options.desktopBesideMessage) {
      const w = scale.width;
      const h = scale.height;
      const {
        desktopPopupCenterXRatio,
        desktopPopupBoxWidthRatio,
        desktopPopupMaxWidthPx,
        desktopPopupBoxHeightPx,
        desktopPopupBottomMarginPx,
        desktopBesideGapPx,
        desktopMinEdgeMarginPx,
      } = this.options;

      const boxW = Math.min(w * desktopPopupBoxWidthRatio, desktopPopupMaxWidthPx);
      const boxH = desktopPopupBoxHeightPx;
      const popupCx = w * desktopPopupCenterXRatio;
      const popupCy = h - desktopPopupBottomMarginPx - boxH / 2;
      const gap = desktopBesideGapPx;
      const minX = desktopMinEdgeMarginPx + targetWidth / 2;
      const maxX = w - desktopMinEdgeMarginPx - targetWidth / 2;

      let centerX = popupCx - boxW / 2 - gap - targetWidth / 2;
      if (centerX < minX) {
        centerX = popupCx + boxW / 2 + gap + targetWidth / 2;
      }
      centerX = Phaser.Math.Clamp(centerX, minX, maxX);

      const feetY = popupCy + targetHeight / 2;

      return {
        width: targetWidth,
        height: targetHeight,
        x: centerX + layout.offsetX,
        y: feetY + layout.offsetY,
      };
    }

    const baseMargin = mobile ? this.options.leftMarginMobile : this.options.leftMarginDesktop;
    const baseY = scale.height - (mobile ? this.options.bottomMarginMobile : this.options.bottomMarginDesktop) + this.getFeetYOffset();

    return {
      width: targetWidth,
      height: targetHeight,
      x: baseMargin + targetWidth / 2 + layout.offsetX,
      y: baseY + layout.offsetY,
    };
  }
}

