import Phaser from "phaser";
import {
  BG_HUD_TEXTURE_KEY,
  HUD_HOURGLASS_ASSET_PATH,
  HUD_PROCESS_TEXTURE_KEY,
  HUD_STAT_TEXT_MAX_PX,
  HUD_VALUE_COLOR,
  applyHudStatDomPill,
  buildHudStatTextCss,
  createHudStatCenteredPillElement,
  getHudStatFont,
  getHudStatFontSize,
  layoutBgHudImage,
  parseHudFontPx,
  preloadHudProcess,
  type GameHudPillSlots,
  type GameHudRowMetrics,
} from "./gameHudLayout";

export { preloadHudProcess };

/** ข้อความ HUD เช่น `2/5` */
export function formatQuestionProgress(current: number, total: number): string {
  const t = Math.max(0, Math.floor(total) || 0);
  if (t <= 0) return "";
  const c = Math.max(1, Math.min(Math.floor(current) || 1, t));
  return `${c}/${t}`;
}

export const QUESTION_PROGRESS_HUD_COLOR = HUD_VALUE_COLOR;

export type QuestionProgressHudMetrics = {
  boxH: number;
  boxW: number;
  gap: number;
  paddingX: number;
  fontSize: string;
  font: string;
};

/** ขนาด/ฟอนต์ pill progress */
export function getQuestionProgressHudMetrics(
  mobile: boolean,
  width: number,
  px: (base: number) => number
): QuestionProgressHudMetrics {
  const fontSize = getHudStatFontSize(px, mobile);
  return {
    boxH: mobile ? 40 : px(50),
    boxW: Math.min(width * (mobile ? 0.11 : 0.08), mobile ? 72 : px(88)),
    gap: px(6),
    paddingX: mobile ? 4 : px(8),
    fontSize,
    font: getHudStatFont(px, mobile),
  };
}

export function resolveQuestionProgressCurrent(
  total: number,
  options?: {
    questionIndex0?: number | null;
    gameplayActive?: boolean;
    completedCount?: number;
  }
): number {
  const t = Math.max(0, Math.floor(total) || 0);
  if (t <= 0) return 1;
  if (options?.gameplayActive === false) return 1;
  const idx = options?.questionIndex0;
  if (idx != null && idx >= 0) return Math.min(idx + 1, t);
  if (options?.completedCount != null) {
    return Math.min(Math.max(1, options.completedCount + 1), t);
  }
  return 1;
}

export function getQuestionProgressLabel(
  total: number,
  options?: {
    questionIndex0?: number | null;
    gameplayActive?: boolean;
    completedCount?: number;
  }
): string {
  if (total <= 0) return "";
  return formatQuestionProgress(resolveQuestionProgressCurrent(total, options), total);
}

export function getHudContainerBaseY(container: Phaser.GameObjects.Container): number {
  const baseY = container.getData("baseY");
  return typeof baseY === "number" ? baseY : container.y;
}

export function tweenHudContainerDropIn(
  scene: Phaser.Scene,
  container: Phaser.GameObjects.Container,
  targetY: number,
  startY = -150
) {
  container.y = startY;
  scene.tweens.add({
    targets: container,
    y: targetY,
    duration: 600,
    ease: "Back.easeOut",
    easeParams: [3.5],
    delay: 0,
  });
}

export type DomHudPill = {
  container: Phaser.GameObjects.Container;
  bg: Phaser.GameObjects.Image;
  dom: Phaser.GameObjects.DOMElement;
  inner: HTMLElement;
  labelSpan?: HTMLSpanElement;
  valueSpan?: HTMLSpanElement;
};

export type PhaserQuestionProgressHud = {
  bg: Phaser.GameObjects.Image;
  text: Phaser.GameObjects.Text;
};

export function createPhaserQuestionProgressHud(
  scene: Phaser.Scene,
  depth: number,
  options?: { font?: string; resolution?: number; mobile?: boolean; width?: number; px?: (base: number) => number }
): PhaserQuestionProgressHud {
  const metrics =
    options?.mobile != null && options.width != null && options.px
      ? getQuestionProgressHudMetrics(options.mobile, options.width, options.px)
      : null;
  const font =
    options?.font ??
    metrics?.font ??
    getHudStatFont((n) => n, options?.mobile ?? false);
  const bg = scene.add.image(0, 0, HUD_PROCESS_TEXTURE_KEY).setOrigin(0.5).setScrollFactor(0).setDepth(depth);
  const text = scene.add
    .text(0, 0, "", {
      font,
      color: QUESTION_PROGRESS_HUD_COLOR,
      align: "center",
    })
    .setOrigin(0.5, 0.5)
    .setScrollFactor(0)
    .setDepth(depth + 1)
    .setResolution(options?.resolution ?? 1)
    .setVisible(false)
    .setAlpha(0);
  return { bg, text };
}

export function layoutPhaserQuestionProgressHud(options: {
  scene: Phaser.Scene;
  hud: PhaserQuestionProgressHud;
  cx: number;
  rowY: number;
  boxH: number;
  boxW: number;
  label: string;
  font: string;
}) {
  const { scene, hud, cx, rowY, boxH, boxW, label, font } = options;
  const visible = label.length > 0;

  if (visible) {
    layoutBgHudImage(hud.bg, cx, rowY, boxW, boxH);
  }
  hud.bg.setVisible(visible);

  applyHudStatDomPill({
    scene,
    anchor: hud.text,
    cx,
    cy: rowY,
    boxW,
    boxH,
    text: label,
    fontPx: parseHudFontPx(font),
    color: QUESTION_PROGRESS_HUD_COLOR,
    visible,
  });
}

/** วาง pill progress ตาม slot จาก gameHudLayout */
export function layoutPhaserQuestionProgressAtSlot(options: {
  scene: Phaser.Scene;
  hud: PhaserQuestionProgressHud;
  slots: GameHudPillSlots;
  metrics: GameHudRowMetrics;
  label: string;
}) {
  const cx = options.slots.progressCx;
  if (cx == null) {
    options.hud.bg.setVisible(false);
    options.hud.text.setVisible(false);
    const dom = options.hud.text.getData("hudStatDom") as Phaser.GameObjects.DOMElement | undefined;
    dom?.setVisible(false);
    return;
  }
  layoutPhaserQuestionProgressHud({
    scene: options.scene,
    hud: options.hud,
    cx,
    rowY: options.slots.rowY,
    boxH: options.metrics.pillH,
    boxW: options.metrics.progressW,
    label: options.label,
    font: options.metrics.fontProgress,
  });
}

/** @deprecated ใช้ layoutPhaserQuestionProgressAtSlot */
export function layoutPhaserQuestionProgressBeforeScore(options: {
  scene: Phaser.Scene;
  hud: PhaserQuestionProgressHud;
  scoreBgLeftX: number;
  scoreRowY: number;
  width: number;
  mobile: boolean;
  px: (base: number) => number;
  label: string;
}) {
  const metrics = getQuestionProgressHudMetrics(options.mobile, options.width, options.px);
  const cx = options.scoreBgLeftX - metrics.gap - metrics.boxW / 2;
  layoutPhaserQuestionProgressHud({
    scene: options.scene,
    hud: options.hud,
    cx,
    rowY: options.scoreRowY,
    boxH: metrics.boxH,
    boxW: metrics.boxW,
    label: options.label,
    font: metrics.font,
  });
}

export function createDomHudPill(
  scene: Phaser.Scene,
  depth: number,
  initialLabel: string,
  bgKey: string = BG_HUD_TEXTURE_KEY
): DomHudPill {
  const container = scene.add.container(0, 0).setDepth(depth);
  const bg = scene.add.image(0, 0, bgKey).setOrigin(0.5);
  const placeholder = document.createElement("div");
  const dom = scene.add.dom(0, 0, placeholder).setOrigin(0.5, 0.5);
  container.add([bg, dom]);
  const inner = document.createElement("div");
  inner.textContent = initialLabel;
  return { container, bg, dom, inner };
}

export function createDomProgressHudPill(scene: Phaser.Scene, depth: number, initialLabel: string): DomHudPill {
  return createDomHudPill(scene, depth, initialLabel, HUD_PROCESS_TEXTURE_KEY);
}

export function layoutDomHudPill(options: {
  scene: Phaser.Scene;
  pill: DomHudPill;
  x: number;
  y: number;
  boxW: number;
  boxH: number;
  label: string;
  fontSize: string;
  color?: string;
  domYOffset?: number;
}): void {
  const {
    scene,
    pill,
    x,
    y,
    boxW,
    boxH,
    label,
    fontSize,
    color = QUESTION_PROGRESS_HUD_COLOR,
    domYOffset = 0,
  } = options;

  const visible = label.trim().length > 0;
  pill.container.setPosition(x, y);
  pill.container.setData("baseX", x);
  pill.container.setData("baseY", y);
  pill.container.setVisible(visible);

  layoutBgHudImage(pill.bg, 0, 0, boxW, boxH);
  pill.bg.setVisible(visible);

  const fontPx = parseFloat(fontSize) || HUD_STAT_TEXT_MAX_PX;
  const { root, labelSpan } = createHudStatCenteredPillElement({
    label: visible ? label : "",
    boxW,
    boxH,
    fontPx,
    color,
  });

  pill.container.remove(pill.dom, true);
  const dom = scene.add.dom(-boxW / 2, -boxH / 2 + domYOffset, root).setOrigin(0, 0);
  dom.pointerEvents = "none";
  dom.setVisible(visible);
  pill.dom = dom;
  pill.inner = root;
  pill.labelSpan = labelSpan;
  pill.container.add(dom);
}

export function setDomProgressHudPillLabel(pill: DomHudPill, label: string) {
  const visible = label.trim().length > 0;
  pill.container.setVisible(visible);
  pill.bg.setVisible(visible);
  pill.dom.setVisible(visible);
  const span = pill.labelSpan ?? pill.inner.querySelector("span");
  if (span) {
    span.textContent = label;
    return;
  }
  pill.inner.textContent = label;
}

/** pill เวลาแบบ DOM — hourglass ซ้าย + ตัวเลขขวา (absolute เพื่อให้ตรงกับ Phaser HUD) */
export function layoutDomTimeHudPill(options: {
  scene: Phaser.Scene;
  pill: DomHudPill;
  x: number;
  y: number;
  boxW: number;
  boxH: number;
  timeText: string;
  fontSize: string;
  color?: string;
  iconSize?: number;
  domYOffset?: number;
}): void {
  const {
    scene,
    pill,
    x,
    y,
    boxW,
    boxH,
    timeText,
    fontSize,
    color = HUD_VALUE_COLOR,
    domYOffset = 0,
  } = options;
  const fontPx = parseFloat(fontSize) || 24;
  const iconSize = Math.min(
    options.iconSize ?? Math.round(fontPx * 0.92),
    Math.max(14, Math.round(boxH * 0.58))
  );
  const padX = Math.max(8, Math.round(boxH * 0.24));

  pill.container.setPosition(x, y);
  pill.container.setData("baseX", x);
  pill.container.setData("baseY", y);
  pill.container.setVisible(true);

  layoutBgHudImage(pill.bg, 0, 0, boxW, boxH);
  pill.bg.setVisible(true);

  const div = document.createElement("div");
  div.style.cssText = [
    `width:${boxW}px`,
    `height:${boxH}px`,
    "position:relative",
    "box-sizing:border-box",
    "overflow:hidden",
  ].join(";");

  const img = document.createElement("img");
  img.src = HUD_HOURGLASS_ASSET_PATH;
  img.alt = "";
  img.draggable = false;
  img.style.cssText = [
    "position:absolute",
    `left:${padX}px`,
    "top:50%",
    "transform:translateY(-50%)",
    `height:${iconSize}px`,
    "width:auto",
    "display:block",
    "pointer-events:none",
  ].join(";");

  const span = document.createElement("span");
  span.textContent = timeText;
  span.style.cssText = [
    "position:absolute",
    `right:${padX}px`,
    "top:50%",
    "transform:translateY(-50%)",
    buildHudStatTextCss(fontPx, color),
  ].join(";");

  div.appendChild(img);
  div.appendChild(span);

  pill.container.remove(pill.dom, true);
  const dom = scene.add.dom(0, domYOffset, div).setOrigin(0.5, 0.5);
  dom.pointerEvents = "none";
  dom.setVisible(true);
  pill.dom = dom;
  pill.inner = div;
  pill.container.add(dom);
}

/** pill คะแนน — ป้ายซ้าย + ตัวเลขขวา (เหมือน Phaser HUD) */
export function layoutDomLabelValueHudPill(options: {
  scene: Phaser.Scene;
  pill: DomHudPill;
  x: number;
  y: number;
  boxW: number;
  boxH: number;
  labelText: string;
  valueText: string;
  fontSize: string;
  labelColor?: string;
  valueColor?: string;
  labelPadLeft?: number;
  valuePadRight?: number;
  domYOffset?: number;
}): void {
  const {
    scene,
    pill,
    x,
    y,
    boxW,
    boxH,
    labelText,
    valueText,
    fontSize,
    labelColor = HUD_VALUE_COLOR,
    valueColor = HUD_VALUE_COLOR,
    domYOffset = 0,
  } = options;
  const fontPx = parseFloat(fontSize) || HUD_STAT_TEXT_MAX_PX;
  const padLeft = options.labelPadLeft ?? Math.max(8, Math.round(boxH * 0.24));
  const padRight = options.valuePadRight ?? padLeft;

  pill.container.setPosition(x, y);
  pill.container.setData("baseX", x);
  pill.container.setData("baseY", y);
  pill.container.setVisible(true);

  layoutBgHudImage(pill.bg, 0, 0, boxW, boxH);
  pill.bg.setVisible(true);

  const div = document.createElement("div");
  div.style.cssText = [
    `width:${boxW}px`,
    `height:${boxH}px`,
    "position:relative",
    "box-sizing:border-box",
    "overflow:hidden",
  ].join(";");

  const labelSpan = document.createElement("span");
  labelSpan.textContent = labelText;
  labelSpan.style.cssText = [
    "position:absolute",
    `left:${padLeft}px`,
    "top:50%",
    "transform:translateY(-50%)",
    buildHudStatTextCss(fontPx, labelColor),
  ].join(";");

  const valueSpan = document.createElement("span");
  valueSpan.textContent = valueText;
  valueSpan.style.cssText = [
    "position:absolute",
    `right:${padRight}px`,
    "top:50%",
    "transform:translateY(-50%)",
    buildHudStatTextCss(fontPx, valueColor),
  ].join(";");

  div.appendChild(labelSpan);
  div.appendChild(valueSpan);

  pill.container.remove(pill.dom, true);
  const dom = scene.add.dom(0, domYOffset, div).setOrigin(0.5, 0.5);
  dom.pointerEvents = "none";
  dom.setVisible(true);
  pill.dom = dom;
  pill.inner = div;
  pill.labelSpan = labelSpan;
  pill.valueSpan = valueSpan;
  pill.container.add(dom);
}

export function setDomLabelValueHudPillValue(pill: DomHudPill, valueText: string) {
  if (pill.valueSpan) {
    pill.valueSpan.textContent = valueText;
    return;
  }
  const spans = pill.inner.querySelectorAll("span");
  const value = spans.length > 1 ? spans[1] : spans[0];
  if (value) value.textContent = valueText;
}

export type GameHudStatsDomPills = {
  time?: DomHudPill;
  score?: DomHudPill;
  progress?: DomHudPill;
};

/** วางเวลา / คะแนน / progress แถวเดียว — ใช้ร่วมกันทุกเกม DOM HUD */
export function layoutGameHudStatsDomRow(options: {
  scene: Phaser.Scene;
  mobile: boolean;
  metrics: GameHudRowMetrics;
  slots: GameHudPillSlots;
  rowCenterY: number;
  px: (n: number) => number;
  pills: GameHudStatsDomPills;
  timeText?: string;
  scoreValue?: string;
  progressLabel?: string;
  labelPad?: number;
  valuePad?: number;
}) {
  const statFontSize = getHudStatFontSize(options.px, options.mobile);
  const pad = options.labelPad ?? Math.max(8, Math.round(options.metrics.pillH * 0.24));
  const valuePad = options.valuePad ?? pad;

  if (options.pills.time && options.timeText != null) {
    layoutDomTimeHudPill({
      scene: options.scene,
      pill: options.pills.time,
      x: options.slots.timeCx,
      y: options.rowCenterY,
      boxW: options.metrics.timeW,
      boxH: options.metrics.pillH,
      timeText: options.timeText,
      fontSize: statFontSize,
      color: HUD_VALUE_COLOR,
    });
  }

  if (options.pills.score) {
    layoutDomLabelValueHudPill({
      scene: options.scene,
      pill: options.pills.score,
      x: options.slots.scoreCx,
      y: options.rowCenterY,
      boxW: options.metrics.scoreW,
      boxH: options.metrics.pillH,
      labelText: "คะแนน",
      valueText: options.scoreValue ?? "0",
      fontSize: statFontSize,
      labelPadLeft: pad,
      valuePadRight: valuePad,
    });
  }

  const progressCx = options.slots.progressCx;
  if (options.pills.progress) {
    const progressLabel = (options.progressLabel ?? "").trim();
    if (progressCx == null || !progressLabel) {
      options.pills.progress.container.setVisible(false);
    } else {
      layoutDomHudPill({
        scene: options.scene,
        pill: options.pills.progress,
        x: progressCx,
        y: options.rowCenterY,
        boxW: options.metrics.progressW,
        boxH: options.metrics.pillH,
        label: progressLabel,
        fontSize: statFontSize,
      });
    }
  }
}

export function setDomTimeHudPillValue(pill: DomHudPill, timeText: string, color?: string) {
  const span = pill.inner.querySelector("span");
  if (!span) return;
  span.textContent = timeText;
  if (color) span.style.color = color;
}

export function getDomTimeHudPillValueColor(pill: DomHudPill): string {
  const span = pill.inner.querySelector("span");
  const c = span?.style.color?.trim();
  return c || HUD_VALUE_COLOR;
}

export function layoutDomQuestionProgressAtSlot(options: {
  scene: Phaser.Scene;
  pill: DomHudPill;
  cx: number;
  cy: number;
  boxW: number;
  boxH: number;
  label: string;
  fontSize?: string;
}) {
  layoutDomHudPill({
    scene: options.scene,
    pill: options.pill,
    x: options.cx,
    y: options.cy,
    boxW: options.boxW,
    boxH: options.boxH,
    label: options.label,
    fontSize: options.fontSize ?? `${HUD_STAT_TEXT_MAX_PX}px`,
  });
}

/** @deprecated ใช้ layoutDomQuestionProgressAtSlot */
export function layoutDomQuestionProgressBeforeScore(options: {
  scene: Phaser.Scene;
  pill: DomHudPill;
  scoreContainer: Phaser.GameObjects.Container;
  width: number;
  mobile: boolean;
  px: (base: number) => number;
  label: string;
  scoreBoxWRatio?: number;
  scoreBoxWMaxMobile?: number;
  scoreBoxWMaxDesktop?: number;
  fontSize?: string;
  paddingX?: number;
  boxH?: number;
}) {
  const {
    scene,
    pill,
    scoreContainer,
    width,
    mobile,
    px,
    label,
    scoreBoxWRatio = mobile ? 0.26 : 0.28,
    scoreBoxWMaxMobile = 260,
    scoreBoxWMaxDesktop = 280,
    fontSize: fontSizeOverride,
    boxH: boxHOverride,
  } = options;

  const metrics = getQuestionProgressHudMetrics(mobile, width, px);
  const scoreBoxW = Math.min(width * scoreBoxWRatio, mobile ? scoreBoxWMaxMobile : px(scoreBoxWMaxDesktop));
  const baseX = scoreContainer.getData("baseX");
  const baseY = scoreContainer.getData("baseY");
  if (typeof baseX !== "number" || typeof baseY !== "number") return;

  const fontSize = fontSizeOverride ?? metrics.fontSize;
  const boxH = boxHOverride ?? metrics.boxH;
  const progressX = baseX - scoreBoxW / 2 - metrics.gap - metrics.boxW / 2;
  layoutDomHudPill({
    scene,
    pill,
    x: progressX,
    y: baseY,
    boxW: metrics.boxW,
    boxH,
    label,
    fontSize,
  });
}
