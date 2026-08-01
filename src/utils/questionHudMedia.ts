import type Phaser from "phaser";
import {
  getHudCenterTextMaxBasePx,
  getHudCenterTextMinBasePx,
} from "../core/hud/gameHudLayout";
import { estimateThaiTextLineCount, measureThaiTextWidth } from "./thaiText";

/** ขนาดกรอบภาพโจทย์ + ตำแหน่งลำโพง — ใช้ร่วมกัน anagram / flappy-bird / flying-fruits / find-the-match */

export const QUESTION_MEDIA_FRAME_FILL_ALPHA = 1;
export const QUESTION_MEDIA_IMAGE_PAD_RATIO = 0.08;
export const QUESTION_MEDIA_FRAME_STROKE_COLOR = 0xd9e8e5;

export const QUESTION_MEDIA_CARD_FRAME_BASE = 230;
export const QUESTION_MEDIA_CARD_STROKE_COLOR = 0x00a8e8;

export type QuestionMediaLayoutVariant = "default" | "card";

export type QuestionMediaTextOverlay = {
  left: number;
  top: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  fontPx?: number;
  /** ตั้งเมื่อต้อง wrap หลายบรรทัด — บรรทัดเดียวไม่ต้องส่ง */
  wrapWidth?: number;
  lineCount?: number;
};

export type QuestionMediaLayoutParams = {
  mobile: boolean;
  px: (n: number) => number;
  screenWidth: number;
  screenHeight?: number;
  mediaCenterX: number;
  mediaCenterY: number;
  hasImage: boolean;
  hasSound: boolean;
  imageTexW?: number;
  imageTexH?: number;
  /** ข้อความโจทย์ — ใช้คำนวณกล่อง pill แบบขยายตามความยาว */
  questionText?: string;
  /** ความกว้างสูงสุดของ pill โจทย์ (เท่า suggestion HUD) */
  maxTextOverlayW?: number;
  /** find-the-match: กรอบสี่เหลี่ยม + ลำโพงมุมล่างซ้าย + text overlay ด้านล่าง */
  variant?: QuestionMediaLayoutVariant;
};

export type QuestionMediaLayoutResult = {
  frameW: number;
  frameH: number;
  imageCenterX: number;
  imageCenterY: number;
  imageW: number;
  imageH: number;
  speakerX: number;
  speakerY: number;
  speakerSize: number;
  showImage: boolean;
  showSound: boolean;
  soundOnlyFrame: boolean;
  textOverlay?: QuestionMediaTextOverlay;
};

/** ความกว้างกรอบเป้าหมาย (มี min/max) */
export function getQuestionMediaFrameTargetW(
  mobile: boolean,
  px: (n: number) => number,
  screenWidth: number,
  screenHeight?: number
): number {
  const cfg = mobile
    ? { target: 180, min: 160, max: 220, ratio: 0.48 }
    : { target: 240, min: 200, max: 300, ratio: 0.28 };
  const byRatio = screenWidth * cfg.ratio;
  const scaled = px(cfg.target);
  let w = Math.min(px(cfg.max), Math.max(px(cfg.min), Math.max(scaled, byRatio)));

  if (!mobile && screenHeight) {
    const aspect = 1.08;
    const maxH = Math.min(px(260), screenHeight * 0.26);
    if (w * aspect > maxH) {
      w = maxH / aspect;
    }
  }

  if (mobile && screenHeight) {
    const aspect = 1.05;
    const maxH = Math.min(px(200), screenHeight * 0.2);
    if (w * aspect > maxH) {
      w = maxH / aspect;
    }
  }

  return w;
}

export function getQuestionMediaFrameSize(
  mobile: boolean,
  px: (n: number) => number,
  screenWidth: number,
  hasImage: boolean,
  screenHeight?: number
): { frameW: number; frameH: number } {
  if (hasImage) {
    return getQuestionMediaCardFrameSize(mobile, px, screenWidth, screenHeight);
  }
  const fullW = getQuestionMediaFrameTargetW(mobile, px, screenWidth, screenHeight);
  const frameW = fullW * 0.6;
  const aspect = mobile ? 0.92 : 0.95;
  return { frameW, frameH: frameW * aspect };
}

export function getQuestionMediaFrameHalfH(
  mobile: boolean,
  px: (n: number) => number,
  screenWidth: number,
  hasImage = true,
  screenHeight?: number
): number {
  return getQuestionMediaFrameSize(mobile, px, screenWidth, hasImage, screenHeight).frameH / 2;
}

/** จุดกลางกรอบ — ใต้ pill/ขอบ HUD บน */
export function getQuestionMediaCenterYBelowAnchor(
  anchorBottomY: number,
  frameHalfH: number,
  mobile: boolean,
  px: (n: number) => number
): number {
  const gap = px(mobile ? 14 : 18);
  const extra = px(mobile ? 6 : 8);
  return anchorBottomY + gap + frameHalfH + extra;
}

export function getQuestionMediaFrameRadius(frameW: number): number {
  return Math.max(10, frameW * 0.08);
}

/** clip รูป cover ให้อยู่ในกรอบมุมโค้ง (พิกัดจอ) */
export function createQuestionMediaImageMask(
  scene: Phaser.Scene,
  centerX: number,
  centerY: number,
  frameW: number,
  frameH: number,
  depth = 0
): Phaser.GameObjects.Graphics {
  const radius = getQuestionMediaFrameRadius(frameW);
  const maskGfx = scene.add.graphics().setScrollFactor(0).setDepth(depth).setVisible(false);
  maskGfx.fillStyle(0xffffff, 1);
  maskGfx.fillRoundedRect(
    centerX - frameW / 2,
    centerY - frameH / 2,
    frameW,
    frameH,
    radius
  );
  return maskGfx;
}

/** clip รูป cover — พิกัดเทียบ container (ศูนย์กลาง 0,0) */
export function createQuestionMediaImageMaskLocal(
  scene: Phaser.Scene,
  frameW: number,
  frameH: number
): Phaser.GameObjects.Graphics {
  const radius = getQuestionMediaFrameRadius(frameW);
  const maskGfx = scene.add.graphics().setVisible(false);
  maskGfx.fillStyle(0xffffff, 1);
  maskGfx.fillRoundedRect(-frameW / 2, -frameH / 2, frameW, frameH, radius);
  return maskGfx;
}

export function maskQuestionMediaImage(
  image: Phaser.GameObjects.Image,
  maskGfx: Phaser.GameObjects.Graphics
): void {
  image.setMask(maskGfx.createGeometryMask());
}

/** วาดกรอบขาวโปร่งใส — จุดอ้างอิงอยู่กึ่งกลาง (0,0) */
export function drawQuestionMediaFrameBox(
  gfx: Phaser.GameObjects.Graphics,
  frameW: number,
  frameH: number,
  alpha = QUESTION_MEDIA_FRAME_FILL_ALPHA,
  strokeColor = QUESTION_MEDIA_FRAME_STROKE_COLOR
) {
  const radius = getQuestionMediaFrameRadius(frameW);
  gfx.clear();
  gfx.fillStyle(0xffffff, alpha);
  gfx.lineStyle(2, strokeColor, 1);
  gfx.fillRoundedRect(-frameW / 2, -frameH / 2, frameW, frameH, radius);
  gfx.strokeRoundedRect(-frameW / 2, -frameH / 2, frameW, frameH, radius);
}

/** กรอบสี่เหลี่ยม ~230px — find-the-match card layout */
export function getQuestionMediaCardFrameSize(
  mobile: boolean,
  px: (n: number) => number,
  screenWidth: number,
  screenHeight?: number
): { frameW: number; frameH: number } {
  const cfg = mobile
    ? { base: 180, min: 160, max: 220, ratio: 0.48 }
    : { base: QUESTION_MEDIA_CARD_FRAME_BASE, min: 200, max: 260, ratio: 0.28 };
  const byRatio = screenWidth * cfg.ratio;
  let size = Math.min(px(cfg.max), Math.max(px(cfg.min), Math.max(px(cfg.base), byRatio)));

  if (screenHeight) {
    const maxByH = mobile ? screenHeight * 0.2 : screenHeight * 0.26;
    size = Math.min(size, maxByH);
  }

  return { frameW: size, frameH: size };
}

export function fitQuestionMediaContainSize(
  texW: number,
  texH: number,
  maxW: number,
  maxH: number
): { imageW: number; imageH: number } {
  const scale = Math.min(maxW / Math.max(1, texW), maxH / Math.max(1, texH));
  return {
    imageW: texW * scale,
    imageH: texH * scale,
  };
}

function fitQuestionMediaImageInFrame(
  texW: number,
  texH: number,
  frameW: number,
  frameH: number,
  pad: number
): { imageW: number; imageH: number } {
  const innerW = Math.max(1, frameW - pad * 2);
  const innerH = Math.max(1, frameH - pad * 2);
  return fitQuestionMediaContainSize(texW, texH, innerW, innerH);
}

/** @deprecated ใช้ fitQuestionMediaContainSize แทน */
export function fitQuestionMediaCoverSize(
  texW: number,
  texH: number,
  boxW: number,
  boxH: number
): { imageW: number; imageH: number } {
  const ratio = texW / Math.max(1, texH);
  const boxRatio = boxW / boxH;
  if (ratio > boxRatio) {
    const imageH = boxH;
    return { imageW: imageH * ratio, imageH };
  }
  const imageW = boxW;
  return { imageW, imageH: imageW / ratio };
}

/** วาดเฉพาะขอบกรอบ — รูปอยู่ด้านหลังเต็มกรอบ */
export function drawQuestionMediaFrameBorder(
  gfx: Phaser.GameObjects.Graphics,
  frameW: number,
  frameH: number,
  strokeColor = QUESTION_MEDIA_FRAME_STROKE_COLOR,
  strokeWidth = 2
) {
  const radius = getQuestionMediaFrameRadius(frameW);
  gfx.clear();
  gfx.lineStyle(strokeWidth, strokeColor, 1);
  gfx.strokeRoundedRect(-frameW / 2, -frameH / 2, frameW, frameH, radius);
}

/** กรอบการ์ด find-the-match — พื้นขาว + ขอบฟ้า */
export function drawQuestionMediaCardFrameBox(
  gfx: Phaser.GameObjects.Graphics,
  frameW: number,
  frameH: number,
  strokeWidth = 3
) {
  const radius = getQuestionMediaFrameRadius(frameW);
  gfx.clear();
  gfx.fillStyle(0xffffff, 1);
  gfx.lineStyle(strokeWidth, QUESTION_MEDIA_CARD_STROKE_COLOR, 1);
  gfx.fillRoundedRect(-frameW / 2, -frameH / 2, frameW, frameH, radius);
  gfx.strokeRoundedRect(-frameW / 2, -frameH / 2, frameW, frameH, radius);
}

/** วาดเฉพาะขอบกรอบการ์ด find-the-match */
export function drawQuestionMediaCardFrameBorder(
  gfx: Phaser.GameObjects.Graphics,
  frameW: number,
  frameH: number,
  strokeWidth = 3
) {
  const radius = getQuestionMediaFrameRadius(frameW);
  gfx.clear();
  gfx.lineStyle(strokeWidth, QUESTION_MEDIA_CARD_STROKE_COLOR, 1);
  gfx.strokeRoundedRect(-frameW / 2, -frameH / 2, frameW, frameH, radius);
}

export function getQuestionMediaCardLayoutHalfH(
  mobile: boolean,
  px: (n: number) => number,
  screenWidth: number,
  screenHeight?: number
): number {
  const { frameH } = getQuestionMediaCardFrameSize(mobile, px, screenWidth, screenHeight);
  const overlayHang = px(mobile ? 16 : 20);
  return frameH / 2 + overlayHang;
}

/** ความกว้าง pill สูงสุดเมื่อมีลำโพงอยู่หน้ากล่อง — รวมแล้วไม่เกิน HUD */
export function getQuestionHudPillMaxWWithSpeaker(
  maxHudW: number,
  speakerSize: number,
  gapPx: number,
  minW: number
): number {
  return Math.max(minW, maxHudW - speakerSize - gapPx);
}

/** กล่องข้อความโจทย์ — ขยายตามความยาวจนถึง maxW แล้วค่อยขึ้นบรรทัดใหม่ */
export function resolveQuestionHudTextPillBox(options: {
  text: string;
  mobile: boolean;
  px: (n: number) => number;
  centerX: number;
  topY: number;
  minW: number;
  maxW: number;
  pillPadX: number;
  basePillH: number;
  fontPx: number;
  minFontPx?: number;
  /** จำนวนบรรทัดสูงสุดเมื่อข้อความยาวเกิน maxW (default 4 mobile / 5 desktop) */
  maxLines?: number;
  /** padding ซ้าย/ขวาใน Phaser text style (chocieThaiGameTextStyle) */
  textStylePadX?: number;
}): QuestionMediaTextOverlay {
  const trimmed = options.text.trim();
  const minFont = options.minFontPx ?? options.px(getHudCenterTextMinBasePx(options.mobile));
  let fontPx = options.fontPx;
  const padX = options.pillPadX;
  const stylePadX = options.textStylePadX ?? 10;
  const horizPad = padX * 2 + stylePadX * 2;
  const maxW = Math.max(options.minW, options.maxW);
  const maxInner = Math.max(1, maxW - horizPad);

  const textWAt = (px: number) =>
    measureThaiTextWidth(trimmed, { fontSizePx: px, fontWeight: 600 });

  const linesAt = (px: number, wrapInner: number) =>
    estimateThaiTextLineCount(trimmed, {
      width: wrapInner,
      fontSizePx: px,
      fontWeight: 600,
      lineHeight: options.mobile ? 1.35 : 1.3,
    });

  let pillW: number;
  let wrapWidth: number | undefined;
  let lineCount: number;

  if (!trimmed) {
    pillW = options.minW;
    lineCount = 1;
  } else if (textWAt(fontPx) + horizPad <= maxW) {
    const textW = textWAt(fontPx);
    const linesFull = linesAt(fontPx, maxInner);
    if (linesFull > 1) {
      pillW = maxW;
      wrapWidth = maxInner;
      lineCount = linesFull;
      const maxLines = options.maxLines ?? (options.mobile ? 4 : 5);
      while (fontPx > minFont && lineCount > maxLines) {
        fontPx -= 1;
        lineCount = linesAt(fontPx, wrapWidth);
      }
    } else {
      pillW = Math.min(maxW, Math.max(options.minW, textW + horizPad));
      lineCount = 1;
    }
  } else {
    pillW = maxW;
    wrapWidth = maxInner;
    lineCount = linesAt(fontPx, wrapWidth);
    const maxLines = options.maxLines ?? (options.mobile ? 4 : 5);
    while (fontPx > minFont && lineCount > maxLines) {
      fontPx -= 1;
      lineCount = linesAt(fontPx, wrapWidth);
    }
  }

  if (lineCount === 1) {
    wrapWidth = undefined;
  } else if (wrapWidth === undefined) {
    wrapWidth = Math.max(1, pillW - horizPad);
  }

  const lineStep = fontPx * (options.mobile ? 1.35 : 1.3);
  const vertPad = options.px(options.mobile ? 8 : 10);
  const pillH = Math.max(options.basePillH, lineCount * lineStep + vertPad);
  const left = options.centerX - pillW / 2;

  return {
    left,
    top: options.topY,
    width: pillW,
    height: pillH,
    centerX: options.centerX,
    centerY: options.topY + pillH / 2,
    fontPx,
    wrapWidth,
    lineCount,
  };
}

/** ข้อความสั้น = ใหญ่, ยาว = เล็ก — ไม่เกินความกว้าง overlay */
export function fitQuestionMediaOverlayFontPx(
  text: string,
  overlayWidth: number,
  mobile: boolean,
  px: (n: number) => number
): number {
  const maxPx = px(getHudCenterTextMaxBasePx(mobile));
  const minPx = px(getHudCenterTextMinBasePx(mobile));
  const len = Math.max(1, text.trim().length);
  const charFactor = 0.58;
  let fontPx = maxPx;
  const estimatedW = len * fontPx * charFactor;
  if (estimatedW > overlayWidth * 0.92) {
    fontPx = Math.max(minPx, Math.floor((overlayWidth * 0.92) / (len * charFactor)));
  }
  return fontPx;
}

/** pill ข้อความบนการ์ด find-the-match — ขาว + เงาด้านล่าง */
export function drawQuestionMediaOverlayTextPill(
  gfx: Phaser.GameObjects.Graphics,
  left: number,
  top: number,
  width: number,
  height: number,
  radius: number,
  shadowOffsetY = 2
) {
  gfx.clear();
  gfx.fillStyle(0x000000, 0.2);
  gfx.fillRoundedRect(left, top + shadowOffsetY, width, height, radius);
  gfx.fillStyle(0xffffff, 0.95);
  gfx.fillRoundedRect(left, top, width, height, radius);
}

/** ตำแหน่งลำโพงหน้ากล่องโจทย์ — มีช่องว่างไม่ทับข้อความ */
export function resolveQuestionHudSpeakerPillGroupLayout(options: {
  mediaCenterX: number;
  pillW: number;
  pillCenterY: number;
  speakerSize: number;
  gapPx: number;
}): { speakerX: number; speakerY: number; pillLeft: number; pillCenterX: number } {
  const totalW = options.pillW + options.gapPx + options.speakerSize;
  const groupLeft = options.mediaCenterX - totalW / 2;
  const speakerX = groupLeft + options.speakerSize / 2;
  const pillLeft = groupLeft + options.speakerSize + options.gapPx;
  return {
    speakerX,
    speakerY: options.pillCenterY,
    pillLeft,
    pillCenterX: pillLeft + options.pillW / 2,
  };
}

/** กล่องข้อความโจทย์บนการ์ด — pill กว้างตามข้อความ (ไม่เกิน HUD) ลำโพงอยู่หน้าข้อความเสมอ */
export function resolveQuestionMediaCardTextOverlay(options: {
  text: string;
  mobile: boolean;
  px: (n: number) => number;
  mediaCenterX: number;
  frameBottom: number;
  speakerSize: number;
  minW: number;
  maxW: number;
  pillPadX: number;
  basePillH: number;
  fontPx: number;
}): { textOverlay: QuestionMediaTextOverlay; speakerX: number; speakerY: number } {
  const speakerY = options.frameBottom + options.speakerSize * 0.06;
  const speakerGap = options.px(options.mobile ? 8 : 10);
  const maxPillW = getQuestionHudPillMaxWWithSpeaker(
    options.maxW,
    options.speakerSize,
    speakerGap,
    options.minW
  );

  const measured = resolveQuestionHudTextPillBox({
    text: options.text,
    mobile: options.mobile,
    px: options.px,
    centerX: options.mediaCenterX,
    topY: speakerY,
    minW: options.minW,
    maxW: maxPillW,
    pillPadX: options.pillPadX,
    basePillH: options.basePillH,
    fontPx: options.fontPx,
    maxLines: 2,
  });

  const group = resolveQuestionHudSpeakerPillGroupLayout({
    mediaCenterX: options.mediaCenterX,
    pillW: measured.width,
    pillCenterY: speakerY,
    speakerSize: options.speakerSize,
    gapPx: speakerGap,
  });
  const textOverlay: QuestionMediaTextOverlay = {
    left: group.pillLeft,
    top: speakerY - measured.height / 2,
    width: measured.width,
    height: measured.height,
    centerX: group.pillCenterX,
    centerY: speakerY,
    fontPx: measured.fontPx,
    wrapWidth: measured.wrapWidth,
  };

  return { textOverlay, speakerX: group.speakerX, speakerY: group.speakerY };
}

function computeQuestionMediaCardLayout(
  p: QuestionMediaLayoutParams
): QuestionMediaLayoutResult {
  const hasImageContent = !!(p.hasImage && p.imageTexW && p.imageTexH);
  const { frameW, frameH } = getQuestionMediaCardFrameSize(
    p.mobile,
    p.px,
    p.screenWidth,
    p.screenHeight
  );

  const frameLeft = p.mediaCenterX - frameW / 2;
  const frameRight = p.mediaCenterX + frameW / 2;
  const frameBottom = p.mediaCenterY + frameH / 2;

  const speakerSize = p.px(p.mobile ? 44 : 52);
  const textBarH = p.px(p.mobile ? 34 : 40);

  const questionText = (p.questionText ?? "").trim();
  const maxOverlayW = p.maxTextOverlayW;
  const useExpandablePill = !!(questionText && maxOverlayW && maxOverlayW > 0);

  let textOverlay: QuestionMediaTextOverlay;
  let speakerX: number;
  let speakerY: number;

  if (useExpandablePill) {
    const card = resolveQuestionMediaCardTextOverlay({
      text: questionText,
      mobile: p.mobile,
      px: p.px,
      mediaCenterX: p.mediaCenterX,
      frameBottom,
      speakerSize,
      minW: p.px(p.mobile ? 72 : 88),
      maxW: maxOverlayW,
      pillPadX: p.px(p.mobile ? 8 : 10),
      basePillH: textBarH,
      fontPx: p.px(getHudCenterTextMaxBasePx(p.mobile)),
    });
    textOverlay = card.textOverlay;
    speakerX = card.speakerX;
    speakerY = card.speakerY;
  } else {
    speakerX = frameLeft + speakerSize * 0.28;
    speakerY = frameBottom + speakerSize * 0.06;
    const hangBelowLegacy = textBarH * 0.45;
    const textBarBottom = frameBottom + hangBelowLegacy;
    const textBarTopLegacy = textBarBottom - textBarH;
    const textLeft = frameLeft + speakerSize * 0.62;
    const textRight = frameRight + p.px(4);
    const textW = Math.max(p.px(48), textRight - textLeft);
    textOverlay = {
      left: textLeft,
      top: textBarTopLegacy,
      width: textW,
      height: textBarH,
      centerX: textLeft + textW / 2,
      centerY: (textBarTopLegacy + textBarBottom) / 2,
    };
  }

  if (hasImageContent) {
    const pad = p.px(p.mobile ? 10 : 12);
    const fit = fitQuestionMediaImageInFrame(
      p.imageTexW!,
      p.imageTexH!,
      frameW,
      frameH,
      pad
    );

    return {
      frameW,
      frameH,
      imageCenterX: p.mediaCenterX,
      imageCenterY: p.mediaCenterY,
      imageW: fit.imageW,
      imageH: fit.imageH,
      speakerX,
      speakerY,
      speakerSize,
      showImage: true,
      showSound: p.hasSound,
      soundOnlyFrame: false,
      textOverlay,
    };
  }

  return {
    frameW,
    frameH,
    imageCenterX: p.mediaCenterX,
    imageCenterY: p.mediaCenterY,
    imageW: 0,
    imageH: 0,
    speakerX,
    speakerY,
    speakerSize,
    showImage: false,
    showSound: p.hasSound,
    soundOnlyFrame: true,
    textOverlay,
  };
}

export function computeQuestionMediaLayout(
  p: QuestionMediaLayoutParams
): QuestionMediaLayoutResult | null {
  if (!p.hasImage && !p.hasSound) return null;

  if (p.variant === "card") {
    return computeQuestionMediaCardLayout(p);
  }

  const hasImageContent = !!(p.hasImage && p.imageTexW && p.imageTexH);
  const { frameW, frameH } = getQuestionMediaFrameSize(
    p.mobile,
    p.px,
    p.screenWidth,
    hasImageContent,
    p.screenHeight
  );

  const speakerSizeWithImg = p.px(p.mobile ? 26 : 32);
  const speakerSizeSoundOnly = p.px(p.mobile ? 42 : 52);

  if (hasImageContent) {
    const frameBottom = p.mediaCenterY + frameH / 2;
    const speakerPad = p.px(p.mobile ? 9 : 11);
    const speakerSize = speakerSizeWithImg;
    const speakerY = frameBottom - speakerSize / 2 - speakerPad;
    const speakerX = p.mediaCenterX;
    const pad = p.px(p.mobile ? 10 : 12);
    const fit = fitQuestionMediaImageInFrame(
      p.imageTexW!,
      p.imageTexH!,
      frameW,
      frameH,
      pad
    );

    return {
      frameW,
      frameH,
      imageCenterX: p.mediaCenterX,
      imageCenterY: p.mediaCenterY,
      imageW: fit.imageW,
      imageH: fit.imageH,
      speakerX,
      speakerY,
      speakerSize,
      showImage: true,
      showSound: p.hasSound,
      soundOnlyFrame: false,
    };
  }

  return {
    frameW,
    frameH,
    imageCenterX: p.mediaCenterX,
    imageCenterY: p.mediaCenterY,
    imageW: 0,
    imageH: 0,
    speakerX: p.mediaCenterX,
    speakerY: p.mediaCenterY,
    speakerSize: speakerSizeSoundOnly,
    showImage: false,
    showSound: p.hasSound,
    soundOnlyFrame: true,
  };
}
