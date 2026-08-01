import Phaser from "phaser";
import {
  HUD_CENTER_TEXT_FONT_WEIGHT,
  HUD_QUESTION_TEXT_COLOR,
  getTeacherHintBoxMaxWidth,
  getTeacherHintMaxFontPx,
  getTeacherHintMinFontPx,
} from "../hud/gameHudLayout";
import { createHudScaleCtx } from "../../utils/desktopUiScale";
import { createThaiTextElement, estimateThaiTextLineCount, measureThaiTextWidth } from "../../utils/thaiText";
import { TeacherAssistant, type TeacherAssistantOptions, type TeacherState } from "./TeacherAssistant";

export type TeacherHintLayout = "none" | "image-only" | "image-text";

export type TeacherHintPresentOptions = {
  text?: string;
  durationMs?: number;
  teacherState?: TeacherState;
  hintLayout?: TeacherHintLayout;
  hintTextureKey?: string;
  /** @default true — รีเซ็ตรูปคำใบ้เมื่อซ่อน */
  resetHintOnHide?: boolean;
  /** @default true */
  playNotificationSfx?: boolean;
  /** @default true — รีเซ็ต hint ก่อนแสดงข้อความธรรมดา */
  resetHintBeforeShow?: boolean;
};

export type TeacherHintUIOptions = TeacherAssistantOptions & {
  mobile: boolean;
  messageDepth?: number;
  onNotificationSfx?: () => void;
};

const SITUATION_TEACHER_DEFAULTS: Partial<TeacherAssistantOptions> = {
  depth: 1,
  anchorLeftEdge: true,
  desktopPopupCenterXRatio: 0.56,
  desktopPopupBoxWidthRatio: 0.34,
  desktopPopupMaxWidthPx: 800,
  desktopPopupBoxHeightPx: 58,
  desktopPopupBottomMarginPx: 25,
};

type MessageUIState = {
  container: Phaser.GameObjects.Container;
  box: Phaser.GameObjects.Graphics;
  dom: Phaser.GameObjects.DOMElement;
  inner: HTMLElement;
  text: string;
  thumb?: Phaser.GameObjects.Image;
};

export type TeacherHintFootprint = {
  bottomMargin: number;
  blockH: number;
  imgW?: number;
  imgH?: number;
  bubbleW?: number;
  bubbleH?: number;
  gap?: number;
};

function resolveTeacherHintLayout(
  hintText: string,
  hintTextureKey?: string | null,
  textures?: Phaser.Textures.TextureManager
): TeacherHintLayout {
  const text = hintText.trim();
  const hasThumb = !!(hintTextureKey && textures?.exists(hintTextureKey));
  if (text && hasThumb) return "image-text";
  if (hasThumb) return "image-only";
  return "none";
}

type TeacherHintTextBubble = {
  boxW: number;
  boxH: number;
  innerW: number;
  wrapWidth?: number;
  fontPx: number;
  lineCount: number;
};

function resolveTeacherHintTextBubble(
  scene: Phaser.Scene,
  mobile: boolean,
  text: string,
  maxBubbleW?: number
): TeacherHintTextBubble {
  const trimmed = text.trim();
  const { width, height } = scene.scale;
  const ui = createHudScaleCtx(width, height, mobile);
  const pillPadX = ui.px(mobile ? 12 : 16);
  const stylePadX = 10;
  const horizPad = pillPadX * 2 + stylePadX * 2;
  const slack = ui.px(12);
  const maxW = Math.max(120, maxBubbleW ?? getTeacherHintBoxMaxWidth(width, height, mobile, ui.px.bind(ui)));
  const minW = mobile ? ui.px(120) : ui.px(160);
  let fontPx = getTeacherHintMaxFontPx(ui.px.bind(ui), mobile);
  const minFontPx = getTeacherHintMinFontPx(ui.px.bind(ui), mobile);
  const lineHeight = 1.35;
  const maxLines = mobile ? 4 : 5;
  const basePillH = ui.px(mobile ? 44 : 58);
  const vertPad = ui.px(mobile ? 8 : 10);

  const countLines = (inner: number, fp: number) =>
    estimateThaiTextLineCount(trimmed, {
      width: Math.max(1, inner),
      fontSizePx: fp,
      fontWeight: HUD_CENTER_TEXT_FONT_WEIGHT,
      lineHeight,
    });

  let boxW = minW;
  let lineCount = 1;
  let wrapWidth: number | undefined;

  if (trimmed) {
    let inner = Math.max(1, maxW - horizPad);
    lineCount = countLines(inner, fontPx);
    while (fontPx > minFontPx && lineCount > maxLines) {
      fontPx -= 1;
      lineCount = countLines(inner, fontPx);
    }

    if (lineCount <= 1) {
      const textW = measureThaiTextWidth(trimmed, {
        fontSizePx: fontPx,
        fontWeight: HUD_CENTER_TEXT_FONT_WEIGHT,
      });
      boxW = Math.min(maxW, Math.max(minW, textW + horizPad + slack));
      inner = Math.max(1, boxW - horizPad);
      while (countLines(inner, fontPx) > 1 && boxW < maxW) {
        boxW = Math.min(maxW, boxW + ui.px(8));
        inner = Math.max(1, boxW - horizPad);
      }
      lineCount = countLines(inner, fontPx);
      if (lineCount > 1) {
        boxW = maxW;
        inner = Math.max(1, boxW - horizPad);
        lineCount = countLines(inner, fontPx);
        wrapWidth = inner;
      }
    } else {
      boxW = maxW;
      wrapWidth = Math.max(1, boxW - horizPad);
      lineCount = countLines(wrapWidth, fontPx);
    }
  }

  const innerW = Math.max(1, boxW - horizPad);
  const lineStep = fontPx * lineHeight;
  const boxH = Math.max(basePillH, lineCount * lineStep + vertPad);

  return {
    boxW,
    boxH,
    innerW: wrapWidth ?? innerW,
    wrapWidth,
    fontPx,
    lineCount,
  };
}

export class TeacherHintUI {
  private readonly scene: Phaser.Scene;
  private readonly options: TeacherHintUIOptions;
  private readonly teacher: TeacherAssistant;
  private messageUI?: MessageUIState;
  private hintLayout: TeacherHintLayout = "none";
  private hintTextureKey?: string;
  private hideEvent?: Phaser.Time.TimerEvent;
  private resizeHandler?: (gameSize: Phaser.Structs.Size) => void;
  private resetHintOnHide = true;
  private coveredDomVisibility = new Map<HTMLElement, string>();

  static preload(scene: Phaser.Scene) {
    TeacherAssistant.preload(scene);
  }

  /** ขนาด hint ที่ layout() ใช้จริง — ให้เกมจองพื้นที่ล่างหน้าจอไม่ให้ทับตัวเลือก */
  static measureHintFootprint(
    scene: Phaser.Scene,
    mobile: boolean,
    options: {
      hintLayout?: TeacherHintLayout;
      hintText?: string;
      hintTextureKey?: string | null;
    }
  ): TeacherHintFootprint {
    const { width, height } = scene.scale;
    const bottomMargin = mobile ? 18 : 25;
    const hintText = (options.hintText ?? "").trim();
    const hintTextureKey = options.hintTextureKey ?? undefined;
    const hintLayout =
      options.hintLayout ??
      resolveTeacherHintLayout(hintText, hintTextureKey, scene.textures);
    const hasThumb = !!(hintTextureKey && scene.textures.exists(hintTextureKey));

    if (hintLayout === "image-only" && hasThumb && hintTextureKey) {
      const tex = scene.textures.get(hintTextureKey).getSourceImage() as HTMLImageElement;
      const srcW = tex?.naturalWidth || tex.width || 1;
      const srcH = tex?.naturalHeight || tex.height || 1;
      const maxW = mobile ? Math.min(200, width * 0.44) : Math.min(240, width * 0.26);
      const imgW = maxW;
      const imgH = Math.min((imgW / srcW) * srcH, height * (mobile ? 0.36 : 0.22));
      return { bottomMargin, blockH: imgH, imgW, imgH };
    }

    if (hintLayout === "image-text" && hasThumb && hintTextureKey) {
      const tex = scene.textures.get(hintTextureKey).getSourceImage() as HTMLImageElement;
      const srcW = tex?.naturalWidth || tex.width || 1;
      const srcH = tex?.naturalHeight || tex.height || 1;
      const maxImgW = mobile ? Math.min(120, width * 0.26) : Math.min(140, width * 0.16);
      const imgH = Math.min((maxImgW / srcW) * srcH, height * (mobile ? 0.22 : 0.18));
      const imgW = (imgH / srcH) * srcW;
      const gap = mobile ? 10 : 14;
      const hudMaxW = getTeacherHintBoxMaxWidth(width, height, mobile);
      const bubbleMaxW = Math.max(120, hudMaxW - imgW - gap);
      const bubble = resolveTeacherHintTextBubble(scene, mobile, hintText, bubbleMaxW);
      const bubbleW = bubble.boxW;
      const bubbleH = bubble.boxH;
      return {
        bottomMargin,
        blockH: Math.max(bubbleH, imgH),
        imgW,
        imgH,
        bubbleW,
        bubbleH,
        gap,
      };
    }

    const bubble = resolveTeacherHintTextBubble(scene, mobile, hintText);
    return {
      bottomMargin,
      blockH: bubble.boxH,
      bubbleW: bubble.boxW,
      bubbleH: bubble.boxH,
    };
  }

  static measureBottomReservePx(
    scene: Phaser.Scene,
    mobile: boolean,
    options: {
      hintLayout?: TeacherHintLayout;
      hintText?: string;
      hintTextureKey?: string | null;
      safetyGap?: number;
    }
  ): number {
    const hintText = (options.hintText ?? "").trim();
    const hintTextureKey = options.hintTextureKey ?? undefined;
    const hasThumb = !!(hintTextureKey && scene.textures.exists(hintTextureKey));
    if (!hintText && !hasThumb) {
      return (mobile ? 18 : 25) + (options.safetyGap ?? (mobile ? 12 : 14));
    }
    const footprint = TeacherHintUI.measureHintFootprint(scene, mobile, options);
    const safetyGap = options.safetyGap ?? (mobile ? 12 : 14);
    return footprint.bottomMargin + footprint.blockH + safetyGap;
  }

  constructor(scene: Phaser.Scene, options: TeacherHintUIOptions) {
    this.scene = scene;
    this.options = options;
    this.teacher = new TeacherAssistant(scene, {
      ...SITUATION_TEACHER_DEFAULTS,
      ...options,
    });
  }

  get assistant(): TeacherAssistant {
    return this.teacher;
  }

  create(initialTeacherState: TeacherState = "standby", compact = true) {
    this.destroyMessageOnly();
    this.teacher.create(initialTeacherState, compact);

    const depth = this.options.messageDepth ?? 2100;
    const container = this.scene.add.container(0, 0).setDepth(depth).setScrollFactor(0);
    const box = this.scene.add.graphics();
    const placeholder = document.createElement("div");
    const dom = this.scene.add.dom(0, 0, placeholder).setOrigin(0.5, 0.5).setScrollFactor(0);
    dom.setDepth(depth + 1);
    (dom.node as HTMLElement).style.zIndex = "2147483647";
    const inner = document.createElement("div");
    container.add([box, dom]);
    container.setVisible(false);
    this.messageUI = { container, box, dom, inner, text: "" };
    this.layout();

    this.resizeHandler = () => {
      this.teacher.onResize();
      this.layout();
    };
    this.scene.scale.on(Phaser.Scale.Events.RESIZE, this.resizeHandler);
    this.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.detachResize());
  }

  destroy() {
    this.detachResize();
    this.clearHideTimer();
    this.restoreCoveredDomElements();
    this.messageUI?.container.destroy(true);
    this.messageUI = undefined;
    this.teacher.destroy();
    this.resetHintChrome();
  }

  setTeacherState(state: TeacherState) {
    this.teacher.setState(state);
  }

  resetHintChrome() {
    this.hintLayout = "none";
    this.hintTextureKey = undefined;
    const thumb = this.messageUI?.thumb;
    if (thumb) {
      thumb.destroy();
      if (this.messageUI) this.messageUI.thumb = undefined;
    }
  }

  /**
   * แสดงข้อความ/รูปคำใบ้ — layout ตาม situation (ตำแหน่งข้อความกลาง bubble)
   */
  present(options: TeacherHintPresentOptions) {
    const ui = this.messageUI;
    if (!ui) return;

    this.restoreCoveredDomElements();

    const {
      text = "",
      durationMs = 2000,
      teacherState,
      hintLayout,
      hintTextureKey,
      resetHintOnHide = true,
      playNotificationSfx = true,
      resetHintBeforeShow = true,
    } = options;

    this.resetHintOnHide = resetHintOnHide;
    this.clearHideTimer();
    this.scene.tweens.killTweensOf(ui.container);

    if (resetHintBeforeShow && hintLayout === undefined && !hintTextureKey) {
      this.resetHintChrome();
    }

    if (hintLayout !== undefined) this.hintLayout = hintLayout;
    if (hintTextureKey !== undefined) this.hintTextureKey = hintTextureKey;

    const clean = (text ?? "").trim();
    const hasThumb = !!this.hintTextureKey && this.scene.textures.exists(this.hintTextureKey);
    if (!clean && !hasThumb) return;

    ui.text = clean;
    this.layout();

    if (teacherState) {
      this.teacher.setState(teacherState);
    }

    ui.container.setVisible(true);
    ui.container.setAlpha(0);
    ui.container.setScale(0.98);
    ui.container.y += 8;

    this.scene.time.delayedCall(0, () => {
      if (ui.container.visible) this.hideDomElementsCoveredByHint();
    });

    this.scene.tweens.add({
      targets: ui.container,
      alpha: 1,
      scale: 1,
      y: "-=8",
      duration: 200,
      ease: "Cubic.easeOut",
    });

    if (durationMs > 0) {
      this.hideEvent = this.scene.time.delayedCall(durationMs, () => this.hide());
    }

    if (playNotificationSfx) {
      this.options.onNotificationSfx?.();
    }
  }

  /** ตั้งค่า hint แล้วแสดง — เลือก layout อัตโนมัติจาก text + รูป */
  presentHint(options: {
    text?: string;
    hintTextureKey?: string;
    durationMs?: number;
    teacherState?: TeacherState;
    playNotificationSfx?: boolean;
  }) {
    const hint = (options.text ?? "").trim();
    const imgKey = options.hintTextureKey;
    const imgReady = !!(imgKey && this.scene.textures.exists(imgKey));

    if (hint && imgReady) {
      this.present({
        text: hint,
        hintLayout: "image-text",
        hintTextureKey: imgKey,
        durationMs: options.durationMs ?? 5200,
        teacherState: options.teacherState ?? "point",
        resetHintBeforeShow: false,
        playNotificationSfx: options.playNotificationSfx,
      });
      return;
    }

    if (!hint && imgReady) {
      this.present({
        text: "",
        hintLayout: "image-only",
        hintTextureKey: imgKey,
        durationMs: options.durationMs ?? 5200,
        teacherState: options.teacherState ?? "point",
        resetHintBeforeShow: false,
        playNotificationSfx: options.playNotificationSfx,
      });
      return;
    }

    if (hint) {
      this.present({
        text: hint,
        hintLayout: "none",
        durationMs: options.durationMs ?? 5200,
        teacherState: options.teacherState ?? "point",
        resetHintBeforeShow: true,
        playNotificationSfx: options.playNotificationSfx,
      });
    }
  }

  hide() {
    const ui = this.messageUI;
    if (!ui) return;

    this.clearHideTimer();
    this.scene.tweens.killTweensOf(ui.container);
    this.scene.tweens.add({
      targets: ui.container,
      alpha: 0,
      scale: 0.98,
      y: "+=8",
      duration: 160,
      ease: "Cubic.easeIn",
      onComplete: () => {
        ui.container.setVisible(false);
        this.restoreCoveredDomElements();
        this.teacher.setState("standby");
        if (this.resetHintOnHide) {
          this.resetHintChrome();
        }
      },
    });
  }

  hideImmediate() {
    const ui = this.messageUI;
    if (!ui) return;
    this.clearHideTimer();
    this.scene.tweens.killTweensOf(ui.container);
    ui.container.setVisible(false);
    ui.container.setAlpha(0);
    this.restoreCoveredDomElements();
    this.teacher.setState("standby");
    if (this.resetHintOnHide) {
      this.resetHintChrome();
    }
  }

  layout() {
    const ui = this.messageUI;
    if (!ui) return;

    const { width, height } = this.scene.scale;
    const mobile = this.options.mobile;
    const hintLayout = this.hintLayout;
    const hasThumb = !!this.hintTextureKey && this.scene.textures.exists(this.hintTextureKey);

    ui.thumb?.destroy();
    ui.thumb = undefined;

    const radius = mobile ? 14 : 16;
    const bottomMargin = mobile ? 18 : 25;
    const x = width / 2;

    const replaceDom = (element: HTMLElement) => {
      ui.container.remove(ui.dom, true);
      const dom = this.scene.add.dom(0, 0, element).setOrigin(0.5, 0.5).setScrollFactor(0);
      const messageDepth = this.options.messageDepth ?? 2100;
      dom.setDepth(messageDepth + 1);
      (dom.node as HTMLElement).style.zIndex = "2147483647";
      dom.pointerEvents = "none";
      ui.dom = dom;
      const inner = element.firstElementChild as HTMLElement | null;
      if (inner) ui.inner = inner;
      ui.container.add(dom);
    };

    if (hintLayout === "image-only" && hasThumb && this.hintTextureKey) {
      ui.box.clear();
      const footprint = TeacherHintUI.measureHintFootprint(this.scene, mobile, {
        hintLayout: "image-only",
        hintTextureKey: this.hintTextureKey,
      });
      const y = height - footprint.blockH / 2 - footprint.bottomMargin;
      ui.container.setPosition(x, y);
      const thumb = this.scene.add
        .image(0, 0, this.hintTextureKey)
        .setDisplaySize(footprint.imgW ?? 1, footprint.imgH ?? 1)
        .setScrollFactor(0);
      ui.container.add(thumb);
      ui.thumb = thumb;

      const placeholder = document.createElement("div");
      placeholder.style.width = "0";
      placeholder.style.height = "0";
      placeholder.style.overflow = "hidden";
      replaceDom(placeholder);

      this.teacher.onResize();
      return;
    }

    if (hintLayout === "image-text" && hasThumb && this.hintTextureKey) {
      const footprint = TeacherHintUI.measureHintFootprint(this.scene, mobile, {
        hintLayout: "image-text",
        hintText: (ui.text ?? "").trim(),
        hintTextureKey: this.hintTextureKey,
      });
      const { imgW = 1, imgH = 1, bubbleW = 1, bubbleH = 1, gap = mobile ? 10 : 14 } = footprint;
      const totalW = imgW + gap + bubbleW;
      const y = height - footprint.blockH / 2 - footprint.bottomMargin;
      ui.container.setPosition(x, y);

      ui.box.clear();
      ui.box.fillStyle(0xffffff, 0.95);
      ui.box.lineStyle(2, 0xd7e4ea, 1);
      const bubbleCx = -totalW / 2 + imgW + gap + bubbleW / 2;
      ui.box.fillRoundedRect(bubbleCx - bubbleW / 2, -bubbleH / 2, bubbleW, bubbleH, radius);
      ui.box.strokeRoundedRect(bubbleCx - bubbleW / 2, -bubbleH / 2, bubbleW, bubbleH, radius);

      const text = (ui.text ?? "").trim();
      const bubble = resolveTeacherHintTextBubble(this.scene, mobile, text, bubbleW);
      const div = createThaiTextElement(text, {
        width: Math.floor(bubble.innerW),
        height: bubbleH - (mobile ? 8 : 10),
        fontSize: `${bubble.fontPx}px`,
        color: HUD_QUESTION_TEXT_COLOR,
        align: "center",
        padding: 0,
        maxLines: mobile ? 6 : 5,
        minFontSizePx: getTeacherHintMinFontPx(),
        fontWeight: HUD_CENTER_TEXT_FONT_WEIGHT,
        lineHeight: 1.35,
      });
      const inner = div.firstElementChild as HTMLElement | null;
      if (inner) {
        inner.style.lineHeight = "1.35";
      }
      replaceDom(div);

      const imgLocalX = -totalW / 2 + imgW / 2;
      const thumb = this.scene.add
        .image(imgLocalX, 0, this.hintTextureKey)
        .setDisplaySize(imgW, imgH)
        .setScrollFactor(0);
      ui.container.add(thumb);
      ui.thumb = thumb;

      ui.dom.setPosition(bubbleCx, 0);

      this.teacher.onResize();
      return;
    }

    const bubble = resolveTeacherHintTextBubble(this.scene, mobile, (ui.text ?? "").trim());
    const boxW = bubble.boxW;
    const boxH = bubble.boxH;
    const y = height - boxH / 2 - bottomMargin;

    ui.container.setPosition(x, y);
    ui.box.clear();
    ui.box.fillStyle(0xffffff, 0.95);
    ui.box.lineStyle(2, 0xd7e4ea, 1);
    ui.box.fillRoundedRect(-boxW / 2, -boxH / 2, boxW, boxH, radius);
    ui.box.strokeRoundedRect(-boxW / 2, -boxH / 2, boxW, boxH, radius);

    const text = (ui.text ?? "").trim();
    const div = createThaiTextElement(text, {
      width: Math.floor(bubble.innerW),
      height: boxH,
      fontSize: `${bubble.fontPx}px`,
      color: HUD_QUESTION_TEXT_COLOR,
      align: "center",
      padding: 0,
      maxLines: mobile ? 4 : 5,
      minFontSizePx: getTeacherHintMinFontPx(),
      fontWeight: HUD_CENTER_TEXT_FONT_WEIGHT,
      lineHeight: 1.35,
    });
    const inner = div.firstElementChild as HTMLElement | null;
    if (inner) {
      inner.style.lineHeight = "1.35";
    }

    const lineCount = mobile ? bubble.lineCount : this.estimateLineCount(inner);
    const domYOffset = mobile ? 0 : lineCount <= 1 ? 15 : 8;
    replaceDom(div);
    ui.dom.setPosition(0, domYOffset);

    this.teacher.onResize();
  }

  private estimateLineCount(inner: HTMLElement | null): number {
    if (!inner || typeof window === "undefined") return 1;
    const computed = window.getComputedStyle(inner);
    const lineHeightPx = parseFloat(computed.lineHeight || "0");
    if (!Number.isFinite(lineHeightPx) || lineHeightPx <= 0) return 1;
    return Math.max(1, Math.round(inner.scrollHeight / lineHeightPx));
  }

  private clearHideTimer() {
    this.hideEvent?.destroy();
    this.hideEvent = undefined;
  }

  private hideDomElementsCoveredByHint() {
    const hintNode = this.messageUI?.dom.node as HTMLElement | undefined;
    const domContainer = this.scene.sys.game.domContainer;
    if (!hintNode || !domContainer) return;

    const hintRect = hintNode.getBoundingClientRect();
    if (hintRect.width <= 0 || hintRect.height <= 0) return;
    const padding = 10;
    const coveredRect = {
      left: hintRect.left - padding,
      right: hintRect.right + padding,
      top: hintRect.top - padding,
      bottom: hintRect.bottom + padding,
    };

    Array.from(domContainer.children).forEach((node) => {
      if (!(node instanceof HTMLElement) || node === hintNode) return;
      const rect = node.getBoundingClientRect();
      const overlaps =
        rect.width > 0 &&
        rect.height > 0 &&
        rect.right > coveredRect.left &&
        rect.left < coveredRect.right &&
        rect.bottom > coveredRect.top &&
        rect.top < coveredRect.bottom;
      if (!overlaps) return;
      this.coveredDomVisibility.set(node, node.style.visibility);
      node.style.visibility = "hidden";
    });
  }

  private restoreCoveredDomElements() {
    this.coveredDomVisibility.forEach((visibility, node) => {
      node.style.visibility = visibility;
    });
    this.coveredDomVisibility.clear();
  }

  private detachResize() {
    if (!this.resizeHandler) return;
    this.scene.scale.off(Phaser.Scale.Events.RESIZE, this.resizeHandler);
    this.resizeHandler = undefined;
  }

  private destroyMessageOnly() {
    this.detachResize();
    this.clearHideTimer();
    this.restoreCoveredDomElements();
    this.messageUI?.container.destroy(true);
    this.messageUI = undefined;
  }
}
