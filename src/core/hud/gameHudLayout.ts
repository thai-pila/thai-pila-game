import Phaser from "phaser";
import { createThaiTextSpan, measureThaiSpanHeight } from "../../utils/thaiText";

export const BG_HUD_TEXTURE_KEY = "bg_hud";
export const BG_HUD_ASSET_PATH = "assets/common/bg_hud.png";
export const HUD_PROCESS_TEXTURE_KEY = "hud_process";
export const HUD_PROCESS_ASSET_PATH = "assets/common/hud_process.png";
export const HUD_HOURGLASS_TEXTURE_KEY = "hud_hourglass";
export const HUD_HOURGLASS_ASSET_PATH = "assets/common/hourglass.png";
export const HUD_VOLUME_TEXTURE_KEY = "hud_volume";
export const HUD_VOLUME_ASSET_PATH = "assets/common/volume.png";

export const HUD_VALUE_COLOR = "#2e84c8";
export const HUD_LABEL_COLOR = HUD_VALUE_COLOR;
export const HUD_QUESTION_TEXT_COLOR = "#333333";

/** ฟอนต์ suggestion HUD + โจทย์กลางจอ — แยก mobile / desktop */
export const HUD_CENTER_TEXT_MAX_PX_MOBILE = 22;
export const HUD_CENTER_TEXT_MAX_PX_DESKTOP = 30;
export const HUD_CENTER_TEXT_MIN_PX_MOBILE = 19;
export const HUD_CENTER_TEXT_MIN_PX_DESKTOP = 22;
/** @deprecated ใช้ HUD_CENTER_TEXT_MAX_PX_MOBILE / _DESKTOP */
export const HUD_CENTER_TEXT_MAX_PX = HUD_CENTER_TEXT_MAX_PX_DESKTOP;
/** @deprecated ใช้ HUD_CENTER_TEXT_MIN_PX_MOBILE / _DESKTOP */
export const HUD_CENTER_TEXT_MIN_PX = HUD_CENTER_TEXT_MIN_PX_DESKTOP;
export const HUD_CENTER_TEXT_FONT_WEIGHT = 600;

export function getHudCenterTextMaxBasePx(mobile: boolean): number {
  return mobile ? HUD_CENTER_TEXT_MAX_PX_MOBILE : HUD_CENTER_TEXT_MAX_PX_DESKTOP;
}

export function getHudCenterTextMinBasePx(mobile: boolean): number {
  return mobile ? HUD_CENTER_TEXT_MIN_PX_MOBILE : HUD_CENTER_TEXT_MIN_PX_DESKTOP;
}

export function getHudCenterTextMaxFontPx(px: (n: number) => number, mobile: boolean): number {
  return px(getHudCenterTextMaxBasePx(mobile));
}

export function getHudCenterTextMinFontPx(px: (n: number) => number, mobile: boolean): number {
  return px(getHudCenterTextMinBasePx(mobile));
}

export function getHudCenterTextFont(px: (n: number) => number, mobile: boolean): string {
  return `${HUD_CENTER_TEXT_FONT_WEIGHT} ${getHudCenterTextMaxFontPx(px, mobile)}px "Noto Sans Thai", sans-serif`;
}

/** คำใบ้ครู — สไตล์เดียวกับโจทย์ แต่เล็กลง 3px */
export const TEACHER_HINT_FONT_OFFSET_PX = 3;

export function getTeacherHintMaxBasePx(mobile: boolean): number {
  return getHudCenterTextMaxBasePx(mobile) - TEACHER_HINT_FONT_OFFSET_PX;
}

export function getTeacherHintMinBasePx(mobile: boolean): number {
  return getHudCenterTextMinBasePx(mobile) - TEACHER_HINT_FONT_OFFSET_PX;
}

/** @deprecated ใช้ getTeacherHintMaxBasePx(mobile) */
export const TEACHER_HINT_TEXT_MAX_PX = HUD_CENTER_TEXT_MAX_PX_DESKTOP - TEACHER_HINT_FONT_OFFSET_PX;
/** @deprecated ใช้ getTeacherHintMinBasePx(mobile) */
export const TEACHER_HINT_TEXT_MIN_PX = HUD_CENTER_TEXT_MIN_PX_DESKTOP - TEACHER_HINT_FONT_OFFSET_PX;

export function getTeacherHintMaxFontPx(px?: (n: number) => number, mobile = false): number {
  const base = getTeacherHintMaxBasePx(mobile);
  return px ? px(base) : base;
}

export function getTeacherHintMinFontPx(px?: (n: number) => number, mobile = false): number {
  const base = getTeacherHintMinBasePx(mobile);
  return px ? px(base) : base;
}

export const TEACHER_HINT_BOX_MAX_PX = 700;

export function getTeacherHintBoxMaxWidth(
  screenWidth: number,
  _screenHeight: number,
  mobile: boolean,
  px: (n: number) => number = (n) => n
): number {
  const sidePad = px(mobile ? 14 : 24);
  return Math.max(160, Math.min(px(TEACHER_HINT_BOX_MAX_PX), screenWidth - sidePad * 2));
}

/** เวลา / จำนวนคำถาม / คะแนน — ฟอนต์เดียวกับโจทย์ แต่เล็กลง 8px (+ bonus ปรับขนาด) */
export const HUD_STAT_FONT_OFFSET_PX = 8;
export const HUD_STAT_FONT_BONUS_PX = 5;

export function getHudStatTextMaxBasePx(mobile: boolean): number {
  return getHudCenterTextMaxBasePx(mobile) - HUD_STAT_FONT_OFFSET_PX + HUD_STAT_FONT_BONUS_PX;
}

/** @deprecated ใช้ getHudStatTextMaxBasePx(mobile) */
export const HUD_STAT_TEXT_MAX_PX = getHudStatTextMaxBasePx(false);

export function getHudStatFontPx(px: (n: number) => number, mobile: boolean): number {
  return px(getHudStatTextMaxBasePx(mobile));
}

export function getHudStatFontSize(px: (n: number) => number, mobile: boolean): string {
  return `${getHudStatFontPx(px, mobile)}px`;
}

export function getHudStatFont(px: (n: number) => number, mobile: boolean): string {
  return `${HUD_CENTER_TEXT_FONT_WEIGHT} ${getHudStatFontPx(px, mobile)}px "Noto Sans Thai", sans-serif`;
}

export const HUD_STAT_DOM_KEY = "hudStatDom";

export function parseHudFontPx(font: string): number {
  const m = font.match(/(\d+(?:\.\d+)?)\s*px/i);
  return m ? parseFloat(m[1]) : HUD_STAT_TEXT_MAX_PX;
}

export function buildHudStatTextCss(fontPx: number, color: string = HUD_VALUE_COLOR): string {
  return [
    'font-family:"Noto Sans Thai",sans-serif',
    `font-weight:${HUD_CENTER_TEXT_FONT_WEIGHT}`,
    `font-size:${fontPx}px`,
    `color:${color}`,
    "line-height:1",
    "white-space:nowrap",
  ].join(";");
}

/** DOM เต็ม pill + ข้อความกึ่งกลาง — ใช้ร่วม progress / pill กลาง */
export function createHudStatCenteredPillElement(options: {
  label: string;
  boxW: number;
  boxH: number;
  fontPx: number;
  color?: string;
}): { root: HTMLDivElement; labelSpan: HTMLSpanElement } {
  const color = options.color ?? HUD_VALUE_COLOR;
  const root = document.createElement("div");
  root.style.cssText = [
    `width:${options.boxW}px`,
    `height:${options.boxH}px`,
    "position:relative",
    "display:block",
    "box-sizing:border-box",
    "overflow:hidden",
    "margin:0",
    "padding:0",
  ].join(";");
  const labelSpan = document.createElement("span");
  labelSpan.textContent = options.label;
  labelSpan.style.cssText = [
    "position:absolute",
    "left:50%",
    "top:50%",
    "transform:translate(-50%,-50%)",
    buildHudStatTextCss(options.fontPx, color),
  ].join(";");
  root.appendChild(labelSpan);
  return { root, labelSpan };
}

/** DOM pill เต็มกรอบ — แทน Phaser Text สำหรับ HUD stats */
export function applyHudStatDomPill(options: {
  scene: Phaser.Scene;
  anchor: Phaser.GameObjects.Text;
  cx: number;
  cy: number;
  boxW: number;
  boxH: number;
  text: string;
  fontPx: number;
  color?: string;
  visible?: boolean;
}): Phaser.GameObjects.DOMElement | undefined {
  const visible = options.visible !== false;
  const color = options.color ?? HUD_VALUE_COLOR;

  options.anchor.setVisible(false);
  options.anchor.setAlpha(0);

  if (typeof document === "undefined") {
    options.anchor.setText(options.text);
    options.anchor.setPosition(options.cx, options.cy);
    options.anchor.setOrigin(0.5, 0.5);
    options.anchor.setStyle({
      font: `${HUD_CENTER_TEXT_FONT_WEIGHT} ${options.fontPx}px "Noto Sans Thai", sans-serif`,
      color,
    });
    options.anchor.setVisible(visible);
    options.anchor.setAlpha(visible ? 1 : 0);
    return undefined;
  }

  const { root } = createHudStatCenteredPillElement({
    label: options.text,
    boxW: options.boxW,
    boxH: options.boxH,
    fontPx: options.fontPx,
    color,
  });

  let dom = options.anchor.getData(HUD_STAT_DOM_KEY) as Phaser.GameObjects.DOMElement | undefined;
  const domX = options.cx - options.boxW / 2;
  const domY = options.cy - options.boxH / 2;
  if (!dom) {
    dom = options.scene.add.dom(domX, domY, root).setOrigin(0, 0);
    dom.pointerEvents = "none";
    dom.setScrollFactor(options.anchor.scrollFactorX, options.anchor.scrollFactorY);
    dom.setDepth(options.anchor.depth);
    options.anchor.setData(HUD_STAT_DOM_KEY, dom);
    const parent = options.anchor.parentContainer;
    if (parent) parent.add(dom);
  } else {
    dom.setElement(root);
    dom.setPosition(domX, domY);
    dom.setOrigin(0, 0);
    dom.setScrollFactor(options.anchor.scrollFactorX, options.anchor.scrollFactorY);
    dom.setDepth(options.anchor.depth);
  }
  dom.setVisible(visible);
  return dom;
}

/** ข้อความ HUD stats ผ่าน DOM — ฟอนต์ชัดเหมือนโจทย์ (ไม่ใช้ Phaser canvas) */
export function applyHudStatDomText(options: {
  scene: Phaser.Scene;
  anchor: Phaser.GameObjects.Text;
  text: string;
  x: number;
  y: number;
  fontPx: number;
  color?: string;
  originX?: number;
  originY?: number;
  visible?: boolean;
}): Phaser.GameObjects.DOMElement | undefined {
  const visible = options.visible !== false;
  const color = options.color ?? HUD_VALUE_COLOR;
  const originX = options.originX ?? options.anchor.originX;
  const originY = options.originY ?? options.anchor.originY;

  if (typeof document === "undefined") {
    options.anchor.setText(options.text);
    options.anchor.setPosition(options.x, options.y);
    options.anchor.setStyle({
      font: `${HUD_CENTER_TEXT_FONT_WEIGHT} ${options.fontPx}px "Noto Sans Thai", sans-serif`,
      color,
    });
    options.anchor.setVisible(visible);
    return undefined;
  }

  options.anchor.setVisible(false);

  const wrapper = document.createElement("div");
  wrapper.style.cssText =
    "margin:0;padding:0;display:flex;align-items:center;justify-content:center;";
  const span = document.createElement("span");
  span.textContent = options.text;
  span.style.cssText = buildHudStatTextCss(options.fontPx, color);
  wrapper.appendChild(span);

  let dom = options.anchor.getData(HUD_STAT_DOM_KEY) as Phaser.GameObjects.DOMElement | undefined;
  if (!dom) {
    dom = options.scene.add.dom(options.x, options.y, wrapper).setOrigin(originX, originY);
    dom.pointerEvents = "none";
    dom.setScrollFactor(options.anchor.scrollFactorX, options.anchor.scrollFactorY);
    dom.setDepth(options.anchor.depth);
    options.anchor.setData(HUD_STAT_DOM_KEY, dom);
    const parent = options.anchor.parentContainer;
    if (parent) parent.add(dom);
  } else {
    dom.setElement(wrapper);
    dom.setPosition(options.x, options.y);
    dom.setOrigin(originX, originY);
    dom.setScrollFactor(options.anchor.scrollFactorX, options.anchor.scrollFactorY);
    dom.setDepth(options.anchor.depth);
  }
  dom.setVisible(visible);
  return dom;
}

export function destroyHudStatDom(anchor: Phaser.GameObjects.Text): void {
  const dom = anchor.getData(HUD_STAT_DOM_KEY) as Phaser.GameObjects.DOMElement | undefined;
  dom?.destroy();
  anchor.setData(HUD_STAT_DOM_KEY, undefined);
}

/** ข้อความกลางจอที่ไม่ควรแสดง pill (ว่าง หรือ placeholder `-`) */
export function hasHudCenterLabel(text: string | null | undefined): boolean {
  const t = (text ?? "").trim();
  return t.length > 0 && t !== "-";
}

/** HUD กลาง — ใช้เฉพาะ suggestion; null / `-` / ว่าง = ไม่แสดง (ไม่ fallback exercise_name) */
export function getHudSuggestionLabel(suggestion: string | null | undefined): string {
  const label = (suggestion ?? "").trim();
  return hasHudCenterLabel(label) ? label : "";
}

export function preloadBgHud(scene: Phaser.Scene) {
  if (!scene.textures.exists(BG_HUD_TEXTURE_KEY)) {
    scene.load.image(BG_HUD_TEXTURE_KEY, BG_HUD_ASSET_PATH);
  }
}

export function preloadHudProcess(scene: Phaser.Scene) {
  if (!scene.textures.exists(HUD_PROCESS_TEXTURE_KEY)) {
    scene.load.image(HUD_PROCESS_TEXTURE_KEY, HUD_PROCESS_ASSET_PATH);
  }
}

export function preloadHudHourglass(scene: Phaser.Scene) {
  if (!scene.textures.exists(HUD_HOURGLASS_TEXTURE_KEY)) {
    scene.load.image(HUD_HOURGLASS_TEXTURE_KEY, HUD_HOURGLASS_ASSET_PATH);
  }
}

export function preloadHudVolume(scene: Phaser.Scene) {
  if (!scene.textures.exists(HUD_VOLUME_TEXTURE_KEY)) {
    scene.load.image(HUD_VOLUME_TEXTURE_KEY, HUD_VOLUME_ASSET_PATH);
  }
}

/** โหลด bg_hud + hud_process + hourglass + volume */
export function preloadHudAssets(scene: Phaser.Scene) {
  preloadBgHud(scene);
  preloadHudProcess(scene);
  preloadHudHourglass(scene);
  preloadHudVolume(scene);
}

export type GameHudRowConfig = {
  mobile: boolean;
  width: number;
  height: number;
  px: (base: number) => number;
  maxLives?: number;
  hasProgress?: boolean;
  hasLives?: boolean;
};

export type GameHudRowMetrics = {
  leftPad: number;
  topPad: number;
  rowY: number;
  pillH: number;
  gap: number;
  progressW: number;
  scoreW: number;
  timeW: number;
  livesW: number;
  questionGap: number;
  questionH: number;
  questionRowGap: number;
  fontLabel: string;
  fontDigits: string;
  fontProgress: string;
};

export type GameHudPillSlots = {
  progressCx?: number;
  scoreCx: number;
  /** เวลา — ชิดซ้าย */
  timeCx: number;
  timeRight: number;
  livesCx?: number;
  rowY: number;
  statsLeftEdge: number;
  questionCenterX: number;
  questionMaxW: number;
  questionY: number;
  /** @deprecated ใช้ resolveCenteredQuestionBox แทน */
  questionLeft: number;
};

export function getGameHudRowMetrics(config: GameHudRowConfig): GameHudRowMetrics {
  const { mobile, width, height, px } = config;
  const maxLives = config.maxLives ?? 3;
  const hasProgress = config.hasProgress ?? true;
  const hasLives = config.hasLives ?? true;
  const leftPad = px(mobile ? 14 : 24);
  const topPad = px(mobile ? 12 : 18);
  const pillH = px(mobile ? 40 : 50);
  const gap = px(mobile ? 6 : 8);
  let progressW = Math.min(width * (mobile ? 0.14 : 0.08), mobile ? 56 : px(88));
  let scoreW = px(mobile ? 118 : 165);
  let timeW = px(mobile ? 118 : 165);
  const heartSize = px(mobile ? 22 : 28);
  const heartGap = px(mobile ? 2 : 4);
  const livesPadX = px(mobile ? 16 : 22);
  let livesW = livesPadX * 2 + heartSize * maxLives + heartGap * Math.max(0, maxLives - 1);

  // Mobile HUD has four pills on one row. Scale their widths as a group when
  // needed so the timer and progress slots can never occupy the same pixels.
  if (mobile) {
    const activeWidths = [timeW, scoreW];
    if (hasProgress) activeWidths.push(progressW);
    if (hasLives) activeWidths.push(livesW);
    const activeGaps = Math.max(0, activeWidths.length - 1);
    const availableForPills = Math.max(1, width - leftPad * 2 - gap * activeGaps);
    const requestedPillWidth = activeWidths.reduce((sum, value) => sum + value, 0);
    const fitScale = Math.min(1, availableForPills / Math.max(1, requestedPillWidth));
    timeW *= fitScale;
    scoreW *= fitScale;
    progressW *= fitScale;
    livesW *= fitScale;
  }
  const questionGap = px(mobile ? 10 : 14);
  const questionH = px(mobile ? 52 : 62);
  const questionRowGap = px(mobile ? 10 : 0);
  const yBase = Math.max(mobile ? 40 : px(54), height * (mobile ? 0.045 : 0.06));
  const rowY = yBase - (mobile ? 8 : 0);
  const questionTop = rowY - pillH / 2;

  const statFont = getHudStatFont(px, mobile);
  const fontLabel = statFont;
  const fontDigits = statFont;
  const fontProgress = statFont;

  return {
    leftPad,
    topPad: questionTop,
    rowY,
    pillH,
    gap,
    progressW,
    scoreW,
    timeW,
    livesW,
    questionGap,
    questionH,
    questionRowGap,
    fontLabel,
    fontDigits,
    fontProgress,
  };
}

export function getGameHudPillSlots(
  safeX: number,
  safeY: number,
  safeWidth: number,
  metrics: GameHudRowMetrics,
  options?: { hasProgress?: boolean; hasLives?: boolean; mobile?: boolean }
): GameHudPillSlots {
  const hasProgress = options?.hasProgress ?? true;
  const hasLives = options?.hasLives ?? true;
  const mobile = options?.mobile ?? false;
  const { leftPad, rowY, gap, progressW, scoreW, timeW, livesW, questionGap, topPad, pillH, questionRowGap } =
    metrics;

  const timeCx = safeX + leftPad + timeW / 2;
  const timeRight = safeX + leftPad + timeW;

  let cursorRight = safeX + safeWidth - leftPad;
  let livesCx: number | undefined;
  let scoreCx: number;
  let progressCx: number | undefined;

  if (hasLives) {
    livesCx = cursorRight - livesW / 2;
    cursorRight -= livesW + gap;
  }
  scoreCx = cursorRight - scoreW / 2;
  cursorRight -= scoreW + gap;
  if (hasProgress) {
    progressCx = cursorRight - progressW / 2;
    cursorRight -= progressW + gap;
  }

  const statsLeftEdge = cursorRight;
  const questionCenterX = safeX + safeWidth / 2;
  const questionAreaLeft = timeRight + questionGap;
  const questionAreaRight = statsLeftEdge - questionGap;
  const questionMaxW = Math.max(120, questionAreaRight - questionAreaLeft);
  const questionY = mobile ? topPad + pillH + questionRowGap : topPad;

  return {
    progressCx,
    scoreCx,
    timeCx,
    timeRight,
    livesCx,
    rowY,
    statsLeftEdge,
    questionCenterX,
    questionMaxW,
    questionY,
    questionLeft: questionCenterX - questionMaxW / 2,
  };
}

/** suggestion บนมือถือ — แถวล่าง HUD ใช้ความกว้างเต็มจอ (ไม่จำกัดระหว่างเวลา/สถิติ) */
export function resolveHudSuggestionBox(options: {
  mobile: boolean;
  text: string;
  centerX: number;
  safeX: number;
  safeWidth: number;
  sidePad: number;
  minW: number;
  maxW: number;
  minLeft: number;
  maxRight: number;
}): { left: number; width: number; centerX: number } {
  const textLen = options.text.length;
  const growRatio = Phaser.Math.Clamp((textLen - 8) / 40, 0, 1);

  if (options.mobile) {
    const minLeft = options.safeX + options.sidePad;
    const maxRight = options.safeX + options.safeWidth - options.sidePad;
    const maxW = Math.max(120, maxRight - minLeft);
    // กล่องยาวเกือบเต็มจอ — ข้อความสั้นก็ยังกว้างสวย (แบบ complete-the-sentence)
    const floorW = maxW * 0.92;
    const growRatio = Phaser.Math.Clamp((textLen - 16) / 56, 0, 1);
    const desiredW = Phaser.Math.Linear(floorW, maxW, growRatio);
    return resolveCenteredQuestionBox({
      centerX: options.centerX,
      desiredW,
      minW: floorW,
      maxW,
      minLeft,
      maxRight,
    });
  }

  const desiredW = Phaser.Math.Linear(options.minW, options.maxW * 0.8, growRatio);
  return resolveCenteredQuestionBox({
    centerX: options.centerX,
    desiredW,
    minW: options.minW,
    maxW: options.maxW,
    minLeft: options.minLeft,
    maxRight: options.maxRight,
  });
}

export function drawHudSuggestionPill(
  gfx: Phaser.GameObjects.Graphics,
  left: number,
  top: number,
  width: number,
  height: number,
  radius?: number
) {
  const r = radius ?? Math.min(14, height / 2);
  gfx.clear();
  gfx.fillStyle(0xffffff, 0.92);
  gfx.lineStyle(2, 0xd9e8e5, 1);
  gfx.fillRoundedRect(left, top, width, height, r);
  gfx.strokeRoundedRect(left, top, width, height, r);
}

function parseHudSuggestionFontPx(font: string): number {
  const m = font.match(/(\d+(?:\.\d+)?)\s*px/);
  return m ? parseFloat(m[1]) : 24;
}

function parseHudSuggestionFontWeight(font: string): 500 | 600 | 700 {
  const m = font.match(/^\s*(\d{3})\s/);
  const w = m ? parseInt(m[1], 10) : 600;
  if (w >= 700) return 700;
  if (w >= 600) return 600;
  return 500;
}

export function layoutPhaserHudSuggestion(options: {
  scene: Phaser.Scene;
  pill: Phaser.GameObjects.Graphics;
  text: Phaser.GameObjects.Text;
  /** desktop — DOM แทน Phaser.Text เพื่อไม่ให้สระ/วรรณยุกต์ซ้อนหาย */
  dom?: Phaser.GameObjects.DOMElement;
  parent?: Phaser.GameObjects.Container;
  label: string;
  box: { left: number; width: number; centerX: number };
  top: number;
  height: number;
  wrapPadX: number;
  textPadX: number;
  textPadY: number;
  font: string;
  lineSpacing: number;
  resolution: number;
  mobile?: boolean;
  depth?: number;
}): { height: number; dom?: Phaser.GameObjects.DOMElement } {
  const show = hasHudCenterLabel(options.label);
  if (!show) {
    options.pill.setVisible(false);
    options.text.setVisible(false);
    options.dom?.setVisible(false);
    return { height: 0, dom: options.dom };
  }

  let fontPx = parseHudSuggestionFontPx(options.font);
  const fontWeight = parseHudSuggestionFontWeight(options.font);
  const maxWidthPx = Math.floor(Math.max(40, options.box.width - options.wrapPadX));
  const useDom = typeof document !== "undefined";

  let effectiveHeight = options.height;
  if (useDom) {
    let textH = measureThaiSpanHeight(options.label, {
      fontSizePx: fontPx,
      fontWeight,
      textAlign: "center",
      maxWidthPx,
    });
    // Preserve the normal size for a single line. Long mobile instructions get
    // a smaller font so two/three-line labels remain airy inside the HUD pill.
    if (options.mobile && textH > fontPx * 1.7) {
      fontPx = Math.max(14, fontPx - 4);
      textH = measureThaiSpanHeight(options.label, {
        fontSizePx: fontPx,
        fontWeight,
        textAlign: "center",
        maxWidthPx,
      });
    }
    const verticalPad = options.mobile
      ? Math.max(options.textPadY * 2.4, 16)
      : Math.max(options.textPadY * 2 + 8, 20);
    effectiveHeight = Math.max(options.height, Math.ceil(textH + verticalPad));
  }

  drawHudSuggestionPill(
    options.pill,
    options.box.left,
    options.top,
    options.box.width,
    effectiveHeight,
    effectiveHeight / 2
  );
  options.pill.setVisible(true);

  const cx = options.box.centerX;
  const cy = options.top + effectiveHeight / 2;

  if (useDom) {
    options.text.setVisible(false);
    const span = createThaiTextSpan(options.label, {
      fontSizePx: fontPx,
      color: "#333333",
      fontWeight,
      textAlign: "center",
      maxWidthPx,
      pointerEventsNone: true,
    });

    let dom = options.dom;
    if (!dom) {
      dom = options.scene.add.dom(cx, cy, span).setOrigin(0.5, 0.5).setScrollFactor(0);
      dom.pointerEvents = "none";
      if (options.depth !== undefined) dom.setDepth(options.depth);
      options.parent?.add(dom);
      options.dom = dom;
    } else {
      dom.setElement(span);
      dom.setPosition(cx, cy);
    }
    dom.setVisible(true);
    return { height: effectiveHeight, dom };
  }

  options.dom?.setVisible(false);
  options.text.setText(options.label);
  options.text.setPosition(cx, cy);
  // ไทย — สระ+วรรณยุกต์ซ้อนด้านบน (เช่น ที่) ต้องมี padding บนมากกว่าล่าง ไม่งั้นไม้เอกถูก clip
  const padBottom = options.textPadY;
  const padTop = options.mobile
    ? Math.round(options.textPadY * 1.4)
    : Math.round(options.textPadY + 12);
  options.text.setStyle({
    font: options.font,
    color: "#333333",
    wordWrap: {
      width: maxWidthPx,
      useAdvancedWrap: true,
    },
    align: "center",
    padding: { left: options.textPadX, right: options.textPadX, top: padTop, bottom: padBottom },
    lineSpacing: options.lineSpacing,
  });
  options.text.setResolution(options.resolution);
  options.text.setVisible(true);
  const textBoundsH = options.text.height + padTop + padBottom;
  if (textBoundsH > effectiveHeight) {
    effectiveHeight = textBoundsH;
    drawHudSuggestionPill(
      options.pill,
      options.box.left,
      options.top,
      options.box.width,
      effectiveHeight,
      effectiveHeight / 2
    );
    options.text.setPosition(cx, options.top + effectiveHeight / 2);
  }
  return { height: effectiveHeight, dom: options.dom };
}

/** ข้อความโจทย์ใน pill — desktop ใช้ DOM ให้คมเหมือน suggestion HUD */
export function applyPhaserHudQuestionText(options: {
  scene: Phaser.Scene;
  text: Phaser.GameObjects.Text;
  dom?: Phaser.GameObjects.DOMElement;
  parent?: Phaser.GameObjects.Container;
  content: string;
  centerX: number;
  centerY: number;
  fontPx: number;
  boxWidth: number;
  wrapWidth?: number;
  wrapPadX: number;
  textPadX: number;
  textPadY: number;
  resolution: number;
  mobile?: boolean;
  depth?: number;
  lineSpacing?: number;
}): Phaser.GameObjects.DOMElement | undefined {
  const trimmed = options.content.trim();
  if (!trimmed) {
    options.text.setVisible(false);
    options.dom?.setVisible(false);
    return options.dom;
  }

  const useDom = !options.mobile && typeof document !== "undefined";
  const cx = options.centerX;
  const cy = options.centerY;

  if (useDom) {
    options.text.setVisible(false);
    const wrapW = options.wrapWidth;
    const maxWidthPx =
      wrapW !== undefined && wrapW > 0
        ? Math.floor(Math.max(40, wrapW))
        : Math.floor(Math.max(40, options.boxWidth - options.textPadX * 2));
    const span = createThaiTextSpan(trimmed, {
      fontSizePx: options.fontPx,
      color: HUD_QUESTION_TEXT_COLOR,
      fontWeight: 600,
      textAlign: "center",
      maxWidthPx,
      pointerEventsNone: true,
    });

    let dom = options.dom;
    if (!dom) {
      dom = options.scene.add.dom(cx, cy, span).setOrigin(0.5, 0.5).setScrollFactor(0);
      dom.pointerEvents = "none";
      if (options.depth !== undefined) dom.setDepth(options.depth);
      options.parent?.add(dom);
    } else {
      dom.setElement(span);
      dom.setPosition(cx, cy);
    }
    dom.setVisible(true);
    return dom;
  }

  options.dom?.setVisible(false);
  options.text.setText(trimmed);
  options.text.setPosition(cx, cy);
  const padBottom = options.textPadY;
  const padTop = options.mobile
    ? Math.round(options.textPadY * 1.4)
    : Math.round(options.textPadY + 12);
  const style: Phaser.Types.GameObjects.Text.TextStyle = {
    font: `600 ${options.fontPx}px "Noto Sans Thai", sans-serif`,
    color: HUD_QUESTION_TEXT_COLOR,
    align: "center",
    padding: { left: options.textPadX, right: options.textPadX, top: padTop, bottom: padBottom },
    lineSpacing: options.lineSpacing ?? (options.mobile ? 3 : 2),
  };
  const wrapW = options.wrapWidth;
  if (wrapW !== undefined && wrapW > 0) {
    style.wordWrap = { width: Math.max(40, wrapW), useAdvancedWrap: true };
  }
  options.text.setStyle(style);
  options.text.setResolution(options.resolution);
  options.text.setVisible(true);
  return options.dom;
}

/** คำนวณกรอบคำถามกึ่งกลางจอ ไม่ทับเวลา/สถิติ */
export function resolveCenteredQuestionBox(options: {
  centerX: number;
  desiredW: number;
  minW: number;
  maxW: number;
  minLeft: number;
  maxRight: number;
}): { left: number; width: number; centerX: number } {
  const maxAllowedW = Math.max(1, options.maxRight - options.minLeft);
  const width = Phaser.Math.Clamp(
    options.desiredW,
    Math.min(options.minW, maxAllowedW),
    Math.min(options.maxW, maxAllowedW)
  );
  let left = options.centerX - width / 2;
  if (left < options.minLeft) left = options.minLeft;
  if (left + width > options.maxRight) left = options.maxRight - width;
  return { left, width, centerX: left + width / 2 };
}

export function layoutBgHudImage(
  image: Phaser.GameObjects.Image,
  cx: number,
  cy: number,
  width: number,
  height: number
) {
  image.setPosition(cx, cy);
  image.setDisplaySize(width, height);
}

export function layoutPhaserLabelValuePill(options: {
  scene: Phaser.Scene;
  bg: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  value: Phaser.GameObjects.Text;
  cx: number;
  cy: number;
  pillW: number;
  pillH: number;
  labelText: string;
  valueText: string;
  labelPadLeft: number;
  valuePadRight: number;
  fontLabel: string;
  fontDigits: string;
}) {
  const {
    scene,
    bg,
    label,
    value,
    cx,
    cy,
    pillW,
    pillH,
    labelText,
    valueText,
    labelPadLeft,
    valuePadRight,
    fontLabel,
    fontDigits,
  } = options;
  layoutBgHudImage(bg, cx, cy, pillW, pillH);
  label.setOrigin(0, 0.5);
  value.setOrigin(1, 0.5);
  applyHudStatDomText({
    scene,
    anchor: label,
    text: labelText,
    x: cx - pillW / 2 + labelPadLeft,
    y: cy,
    fontPx: parseHudFontPx(fontLabel),
    color: HUD_LABEL_COLOR,
    originX: 0,
    originY: 0.5,
  });
  applyHudStatDomText({
    scene,
    anchor: value,
    text: valueText,
    x: cx + pillW / 2 - valuePadRight,
    y: cy,
    fontPx: parseHudFontPx(fontDigits),
    color: HUD_VALUE_COLOR,
    originX: 1,
    originY: 0.5,
  });
}

export function getHudTimeIconSize(mobile: boolean, px: (base: number) => number): number {
  return px(mobile ? 22 : 28);
}

/** วางไอคอน HUD โดยคงสัดส่วนต้นฉบับ (ไม่บีบเป็นสี่เหลี่ยมจัตุรัส) */
export function layoutHudIconPreserveAspect(
  icon: Phaser.GameObjects.Image,
  cx: number,
  cy: number,
  maxSize: number
) {
  const frame = icon.frame;
  const texW = frame?.cutWidth ?? frame?.width ?? maxSize;
  const texH = frame?.cutHeight ?? frame?.height ?? maxSize;
  const scale = Math.min(maxSize / Math.max(1, texW), maxSize / Math.max(1, texH));
  icon.setPosition(cx, cy);
  icon.setDisplaySize(Math.max(1, texW * scale), Math.max(1, texH * scale));
}

/** pill เวลา — ไอคอน hourglass ซ้าย + ตัวเลขขวา */
export function layoutPhaserTimeValuePill(options: {
  scene: Phaser.Scene;
  bg: Phaser.GameObjects.Image;
  icon: Phaser.GameObjects.Image;
  value: Phaser.GameObjects.Text;
  cx: number;
  cy: number;
  pillW: number;
  pillH: number;
  valueText: string;
  labelPadLeft: number;
  valuePadRight: number;
  iconSize: number;
  fontDigits: string;
}) {
  const {
    scene,
    bg,
    icon,
    value,
    cx,
    cy,
    pillW,
    pillH,
    valueText,
    labelPadLeft,
    valuePadRight,
    iconSize,
    fontDigits,
  } = options;
  layoutBgHudImage(bg, cx, cy, pillW, pillH);
  layoutHudIconPreserveAspect(icon, cx - pillW / 2 + labelPadLeft + iconSize / 2, cy, iconSize);
  value.setOrigin(1, 0.5);
  applyHudStatDomText({
    scene,
    anchor: value,
    text: valueText,
    x: cx + pillW / 2 - valuePadRight,
    y: cy,
    fontPx: parseHudFontPx(fontDigits),
    color: HUD_VALUE_COLOR,
    originX: 1,
    originY: 0.5,
  });
}

export function layoutPhaserHeartsPill(options: {
  bg: Phaser.GameObjects.Image;
  hearts: Phaser.GameObjects.Image[];
  cx: number;
  cy: number;
  pillW: number;
  pillH: number;
  heartSize: number;
  heartGap: number;
  padLeft: number;
}) {
  const { bg, hearts, cx, cy, pillW, pillH, heartSize, heartGap, padLeft } = options;
  layoutBgHudImage(bg, cx, cy, pillW, pillH);
  const startX = cx - pillW / 2 + padLeft + heartSize / 2;
  hearts.forEach((heart, i) => {
    heart.setPosition(startX + i * (heartSize + heartGap), cy);
    heart.setDisplaySize(heartSize, heartSize);
  });
}
