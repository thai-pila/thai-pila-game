import Phaser from "phaser";
import { estimateThaiTextLineCount, measureThaiTextWidth } from "./thaiText";

/** การ์ดคำ chocie.png — layout ร่วม find-the-match / flappy-bird */
export const CHOCIE_CHOICE_TUNING = {
  mobile: {
    wMin: 100,
    wMax: 240,
    hPad: 6,
    gapX: 22,
    gapY: 4,
    rowGapY: 28,
    fontTextOnly: 18,
    fontLabelWithImage: 13,
    labelAboveGap: 4,
    labelBoxTopTrim: 6,
    labelBoxBottomTrim: 10,
    imageFrameW: 130,
    imageFrameH: 130,
    /** ช่องว่างระหว่างขอบล่างกรอบรูปกับ pill ข้อความ */
    imageFrameGap: 10,
    speakerSize: 38,
    /** ส่วนที่ลำโพงทับ pill (น้อยลง = ลำโพงอยู่ซ้ายห่างขึ้น) */
    speakerPillOverlap: 0.22,
    textPillMinW: 72,
  },
  desktop: {
    wMin: 168,
    wMax: 220,
    hPad: 28,
    gapX: 28,
    gapY: 8,
    rowGapY: 32,
    fontTextOnly: 24,
    fontLabelWithImage: 22,
    labelAboveGap: 2,
    labelBoxTopTrim: 8,
    labelBoxBottomTrim: 12,
    imageFrameW: 130,
    imageFrameH: 130,
    imageFrameGap: 4,
    speakerSize: 46,
    speakerPillOverlap: 0.24,
    textPillMinW: 88,
  },
} as const;

export type ChocieChoiceOverlayLayout = {
  speakerX: number;
  speakerY: number;
  speakerSize: number;
  pillLeft: number;
  pillTop: number;
  pillW: number;
  pillH: number;
  textCenterX: number;
  textCenterY: number;
};

export type ChocieChoiceLayoutOpts = {
  imageTextGap: number;
  speakerPillOverlap: number;
};

export type ChocieChoiceTextLayout = {
  pillW: number;
  fontPx: number;
  pillH: number;
  wordWrapWidth?: number;
  wrappedText?: string;
};

function wrapThaiTextAtWordBoundaries(
  text: string,
  maxWidth: number,
  fontPx: number,
  strokeW: number
): string | undefined {
  if (typeof Intl === "undefined" || !("Segmenter" in Intl)) return undefined;

  const SegmenterCtor = (Intl as typeof Intl & {
    Segmenter: new (locale: string, options: { granularity: "word" }) => {
      segment(value: string): Iterable<{ segment: string }>;
    };
  }).Segmenter;
  const segments = Array.from(new SegmenterCtor("th", { granularity: "word" }).segment(text.trim()), (part) => part.segment);
  const lines: string[] = [];
  let line = "";

  for (const segment of segments) {
    const candidate = `${line}${segment}`;
    const candidateW = measureThaiTextWidth(candidate, {
      fontSizePx: fontPx,
      fontWeight: 700,
      strokeWidthPx: strokeW,
    });
    if (line && candidateW > maxWidth) {
      lines.push(line.trim());
      line = segment.trimStart();
    } else {
      line = candidate;
    }
  }
  if (line.trim()) lines.push(line.trim());
  return lines.join("\n");
}

export function getChocieChoicePhaserTextInsets(mobile: boolean, tightBottom = true) {
  return {
    padX: 10,
    padTop: mobile ? 12 : 12,
    padBottom: tightBottom ? 2 : mobile ? 12 : 12,
    lineSpacing: mobile ? 8 : 7,
    strokeW: mobile ? 5 : 6,
  };
}

function measureChocieChoiceWrappedTextHeight(
  word: string,
  fontPx: number,
  wrapContentWidth: number,
  insets: ReturnType<typeof getChocieChoicePhaserTextInsets>
): number {
  const lineCount = estimateThaiTextLineCount(word, {
    width: wrapContentWidth,
    fontSizePx: fontPx,
    fontWeight: 700,
    lineHeight: 1.25,
  });
  const contentH =
    lineCount <= 1 ? fontPx : fontPx + (lineCount - 1) * (fontPx + insets.lineSpacing);
  return Math.ceil(contentH + insets.padTop + insets.padBottom + insets.strokeW + 8);
}

export function resolveChocieChoiceTextLayout(
  word: string,
  mobile: boolean,
  pillPadX: number,
  minPillW: number,
  maxPillW: number,
  fontOptions: { baseFont: number; minFont: number; maxFont: number },
  singleLinePillH = mobile ? 30 : 36
): ChocieChoiceTextLayout {
  const insets = getChocieChoicePhaserTextInsets(mobile);
  const strokeW = insets.strokeW;
  const maxInnerW = Math.max(1, maxPillW - pillPadX * 2);
  const { pillW, fontPx } = resolveChocieChoiceTextMetrics(
    word,
    mobile,
    pillPadX,
    minPillW,
    maxPillW,
    fontOptions
  );

  const textWidthAt = (px: number) =>
    measureThaiTextWidth(word, { fontSizePx: px, fontWeight: 700, strokeWidthPx: strokeW });

  if (textWidthAt(fontPx) <= maxInnerW + 0.5) {
    return { pillW, fontPx, pillH: singleLinePillH };
  }

  const wordWrapWidth = maxInnerW;
  const wrapContentWidth = Math.max(1, wordWrapWidth - insets.padX * 2);
  const wrappedText = wrapThaiTextAtWordBoundaries(word, wrapContentWidth, fontPx, strokeW);
  const wrappedLineCount = Math.max(1, (wrappedText ?? word).split("\n").length);
  const pillH = Math.max(
    singleLinePillH,
    wrappedLineCount > 1
      ? Math.ceil(
          fontPx +
            (wrappedLineCount - 1) * (fontPx + insets.lineSpacing) +
            insets.padTop +
            insets.padBottom +
            insets.strokeW +
            8
        )
      : measureChocieChoiceWrappedTextHeight(word, fontPx, wrapContentWidth, insets)
  );

  return {
    pillW: maxPillW,
    fontPx,
    pillH,
    wordWrapWidth,
    wrappedText,
  };
}

export function computeChocieChoiceBoxBottomOverlayLayout(
  frameBottom: number,
  speakerSize: number,
  mobile: boolean,
  hasSound: boolean,
  pillW: number,
  layoutOpts?: ChocieChoiceLayoutOpts,
  pillHOverride?: number
): ChocieChoiceOverlayLayout {
  const imageTextGap = layoutOpts?.imageTextGap ?? (mobile ? 10 : 14);
  const speakerPillOverlap = layoutOpts?.speakerPillOverlap ?? (mobile ? 0.22 : 0.24);
  const textBarH = pillHOverride ?? (mobile ? 30 : 36);
  const textCenterY = frameBottom + imageTextGap + textBarH / 2;
  const textBarTop = textCenterY - textBarH / 2;

  if (hasSound) {
    const overlap = speakerSize * speakerPillOverlap;
    const totalW = pillW + speakerSize - overlap;
    const groupLeft = -totalW / 2;
    const speakerX = groupLeft + speakerSize / 2;
    const pillLeft = groupLeft + speakerSize - overlap;
    return {
      speakerX,
      speakerY: textCenterY,
      speakerSize,
      pillLeft,
      pillTop: textBarTop,
      pillW,
      pillH: textBarH,
      textCenterX: pillLeft + pillW / 2,
      textCenterY,
    };
  }

  return {
    speakerX: 0,
    speakerY: 0,
    speakerSize: 0,
    pillLeft: -pillW / 2,
    pillTop: textBarTop,
    pillW,
    pillH: textBarH,
    textCenterX: 0,
    textCenterY,
  };
}

export function computeChocieChoiceTextSoundLayout(
  pillW: number,
  pillH: number,
  speakerSize: number,
  centerY: number,
  speakerPillOverlap = 0.24
): ChocieChoiceOverlayLayout {
  const overlap = speakerSize * speakerPillOverlap;
  const totalW = pillW + speakerSize - overlap;
  const groupLeft = -totalW / 2;
  const speakerX = groupLeft + speakerSize / 2;
  const pillLeft = groupLeft + speakerSize - overlap;
  const pillTop = centerY - pillH / 2;
  return {
    speakerX,
    speakerY: centerY,
    speakerSize,
    pillLeft,
    pillTop,
    pillW,
    pillH,
    textCenterX: pillLeft + pillW / 2,
    textCenterY: centerY,
  };
}

function getChocieChoiceVisualTextLen(text: string): number {
  return text.replace(/\s+/g, "").replace(/[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/g, "").length;
}

function resolveChocieChoiceAdaptiveFontPx(
  word: string,
  mobile: boolean,
  options: { baseFont: number; minFont: number; maxFont: number }
): number {
  const visualLen = getChocieChoiceVisualTextLen(word);
  let fontDelta = 0;
  if (visualLen <= 2) fontDelta = mobile ? 14 : 18;
  else if (visualLen <= 4) fontDelta = mobile ? 9 : 13;
  else if (visualLen <= 7) fontDelta = mobile ? 4 : 7;
  else if (visualLen <= 10) fontDelta = mobile ? 0 : 2;
  else if (visualLen <= 14) fontDelta = mobile ? -3 : -4;
  else fontDelta = mobile ? -5 : -7;
  return Phaser.Math.Clamp(options.baseFont + fontDelta, options.minFont, options.maxFont);
}

export function resolveChocieChoiceTextMetrics(
  word: string,
  mobile: boolean,
  pillPadX: number,
  minPillW: number,
  maxPillW: number,
  fontOptions: { baseFont: number; minFont: number; maxFont: number }
): { pillW: number; fontPx: number } {
  const strokeW = mobile ? 5 : 6;
  const minFont = fontOptions.minFont;
  let fontPx = resolveChocieChoiceAdaptiveFontPx(word, mobile, fontOptions);
  const maxInnerW = Math.max(1, maxPillW - pillPadX * 2);

  const textWidthAt = (px: number) =>
    measureThaiTextWidth(word, { fontSizePx: px, fontWeight: 700, strokeWidthPx: strokeW });

  while (fontPx > minFont && textWidthAt(fontPx) > maxInnerW) {
    fontPx -= 1;
  }

  const textW = textWidthAt(fontPx);
  const pillW = Phaser.Math.Clamp(textW + pillPadX * 2, minPillW, maxPillW);
  return { pillW, fontPx };
}

export function getChocieInnerWidth(bW: number, mobile: boolean): number {
  return bW - (mobile ? 10 : 14);
}

export function getChocieInnerBottom(bH: number, bottomTrim: number): number {
  return bH / 2 - bottomTrim;
}

export function getChocieInnerTop(bH: number, topTrim: number): number {
  return -bH / 2 + topTrim;
}

export function getChocieInnerCenterY(bH: number, topTrim: number, bottomTrim: number): number {
  return (getChocieInnerTop(bH, topTrim) + getChocieInnerBottom(bH, bottomTrim)) / 2;
}

export function resolveChocieChoiceImageFrameLayout(
  bH: number,
  bW: number,
  tc: {
    labelBoxTopTrim: number;
    labelBoxBottomTrim: number;
    imageFrameW: number;
    imageFrameGap: number;
  },
  mobile: boolean,
  hasText: boolean,
  hasSound: boolean,
  speakerSize: number
): {
  frameW: number;
  frameH: number;
  frameCenterY: number;
  frameBottom: number;
  frameLeft: number;
  frameRight: number;
} {
  const boxBottom = getChocieInnerBottom(bH, tc.labelBoxBottomTrim);
  const boxTop = getChocieInnerTop(bH, tc.labelBoxTopTrim);
  const textBarH = mobile ? 30 : 36;
  const imageTextGap = tc.imageFrameGap;
  let bottomHang = 0;
  if (hasText) {
    bottomHang =
      imageTextGap +
      textBarH / 2 +
      Math.max(textBarH / 2, hasSound ? speakerSize / 2 : 0);
  } else if (hasSound) {
    bottomHang = speakerSize / 2;
  }

  let frameH = Math.min(tc.imageFrameW, bW * 0.92);
  let frameW = frameH;
  let frameBottom = boxBottom - bottomHang;
  let frameCenterY = frameBottom - frameH / 2;

  if (frameCenterY - frameH / 2 < boxTop) {
    frameH = Math.max(mobile ? 84 : 104, boxBottom - bottomHang - boxTop);
    frameW = frameH;
    frameBottom = boxBottom - bottomHang;
    frameCenterY = frameBottom - frameH / 2;
  }

  return {
    frameW,
    frameH,
    frameCenterY,
    frameBottom,
    frameLeft: -frameW / 2,
    frameRight: frameW / 2,
  };
}

export function chocieThaiGameTextStyle(options: {
  mobile: boolean;
  fontPx: number;
  wordWrapWidth?: number;
  tightBottom?: boolean;
  strokeThickness?: number;
}): Phaser.Types.GameObjects.Text.TextStyle {
  const { mobile, fontPx, wordWrapWidth, tightBottom } = options;
  const padY = mobile ? 12 : 12;
  const style: Phaser.Types.GameObjects.Text.TextStyle = {
    font: `700 ${fontPx}px "Noto Sans Thai", sans-serif`,
    color: "#4E4E4E",
    stroke: "#ffffff",
    strokeThickness: options.strokeThickness ?? (mobile ? 5 : 6),
    align: "center",
    padding: tightBottom
      ? { left: 10, right: 10, top: padY, bottom: 2 }
      : { x: 10, y: padY },
    lineSpacing: mobile ? 8 : 7,
  };
  if (wordWrapWidth !== undefined && wordWrapWidth > 0) {
    style.wordWrap = { width: wordWrapWidth, useAdvancedWrap: true };
  }
  return style;
}
