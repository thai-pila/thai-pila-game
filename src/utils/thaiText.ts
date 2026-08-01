/** ข้อความไทยแบบบรรทัดเดียว — ใช้ DOM แทน Phaser.Text เพื่อให้สระวรรณยุกต์ไม่หายบน Canvas */
export type ThaiSpanOptions = {
  fontSizePx: number;
  color: string;
  fontWeight?: 500 | 600 | 700;
  textAlign?: "left" | "center" | "right";
  maxWidthPx?: number;
  /** ไม่ดัก pointer — ใช้เมื่อทับพื้นที่ที่ต้องการคลิก/ลากด้านล่าง */
  pointerEventsNone?: boolean;
  /**
   * ย่อ/ขยายการวาด (CSS transform) — ใช้เมื่อลด fontSizePx แล้วเบราว์เซอร์ยังไม่ย่อ (ขั้นต่ำ ~12px)
   * หรือต้องการให้เล็กลงชัดโดยไม่แตะ px
   */
  visualScale?: number;
};

export function createThaiTextSpan(text: string, options: ThaiSpanOptions): HTMLDivElement {
  const el = document.createElement("div");
  el.textContent = text;
  const align = options.textAlign ?? "left";
  el.style.cssText = [
    "margin:0",
    "padding:0",
    "box-sizing:border-box",
    `font-family:"Noto Sans Thai",sans-serif`,
    `font-weight:${options.fontWeight ?? 500}`,
    `color:${options.color}`,
    `text-align:${align}`,
    "line-height:1.35",
    options.maxWidthPx != null ? `max-width:${options.maxWidthPx}px` : "",
    "word-wrap:break-word",
    "overflow-wrap:break-word",
    options.pointerEventsNone ? "pointer-events:none" : "",
  ]
    .filter(Boolean)
    .join(";");
  el.style.setProperty("font-size", `${options.fontSizePx}px`, "important");
  const vs = options.visualScale;
  if (vs != null && vs > 0 && vs !== 1) {
    el.style.transform = `scale(${vs})`;
    const ox = align === "center" ? "center" : align === "right" ? "right" : "left";
    el.style.transformOrigin = `${ox} center`;
  }
  return el;
}

export function measureThaiSpanHeight(
  text: string,
  options: Pick<ThaiSpanOptions, "fontSizePx" | "fontWeight" | "textAlign" | "maxWidthPx">
): number {
  if (typeof document === "undefined") return 0;
  const span = createThaiTextSpan(text, {
    fontSizePx: options.fontSizePx,
    color: "#000000",
    fontWeight: options.fontWeight,
    textAlign: options.textAlign,
    maxWidthPx: options.maxWidthPx,
    pointerEventsNone: true,
  });
  const wrap = document.createElement("div");
  wrap.style.cssText = "position:fixed;left:-9999px;top:-9999px;visibility:hidden;";
  wrap.appendChild(span);
  document.body.appendChild(wrap);
  const h = span.offsetHeight;
  document.body.removeChild(wrap);
  return h;
}

export type ThaiTextElementOptions = {
  width: number;
  height: number;
  fontSize: string;
  color: string;
  align: "center" | "left";
  padding?: number;
  maxLines?: number;
  minFontSizePx?: number;
  lineHeight?: number;
  safePaddingYPx?: number;
  fontWeight?: 500 | 600 | 700;
  /** false = ห้าม browser บังคับตัดกลางคำเมื่อพื้นที่แคบ ให้ย่อฟอนต์แทน */
  allowEmergencyWordBreak?: boolean;
};

function parseFontSizePx(fontSize: string): number {
  const n = parseFloat(fontSize);
  if (fontSize.endsWith("px")) return n;
  if (fontSize.endsWith("rem")) return n * 16;
  if (fontSize.endsWith("em")) return n * 16;
  return n || 16;
}

export function createThaiTextElement(
  text: string,
  options: ThaiTextElementOptions
): HTMLDivElement {
  const div = document.createElement("div");
  div.style.cssText = [
    `width:${options.width}px`,
    `height:${options.height}px`,
    `display:flex`,
    `align-items:center`,
    options.align === "center" ? "justify-content:center" : "justify-content:flex-start",
    `text-align:${options.align}`,
    "margin:0",
    "padding:0",
    "box-sizing:border-box",
    options.padding != null ? `padding:0 ${options.padding}px` : "",
  ]
    .filter(Boolean)
    .join(";");

  const inner = document.createElement("div");
  inner.textContent = text;
  const maxWidth = options.width - (options.padding ?? 0) * 2;
  const minFontPx = options.minFontSizePx ?? 24;
  const lineHeight = options.lineHeight ?? 1.35;
  const safePaddingY = options.safePaddingYPx ?? 2;
  const fontWeight = options.fontWeight ?? 500;
  const allowEmergencyWordBreak = options.allowEmergencyWordBreak !== false;
  let fontSizePx = parseFontSizePx(options.fontSize);

  const applyInnerStyle = (fontPx: number) => {
    const baseStyle = [
      `font-family:"Noto Sans Thai",sans-serif`,
      `font-weight:${fontWeight}`,
      `color:${options.color}`,
      "margin:0",
      "padding:0",
      `line-height:${lineHeight}`,
      `padding:${safePaddingY}px 0`,
      "box-sizing:border-box",
      `word-wrap:${allowEmergencyWordBreak ? "break-word" : "normal"}`,
      `overflow-wrap:${allowEmergencyWordBreak ? "break-word" : "normal"}`,
      "word-break:normal",
      `max-width:${maxWidth}px`,
    ];
    if (options.maxLines != null && options.maxLines > 0) {
      baseStyle.push(
        "display:-webkit-box",
        "-webkit-box-orient:vertical",
        `-webkit-line-clamp:${options.maxLines}`,
        "overflow:hidden"
      );
    }
    inner.style.cssText = baseStyle.join(";");
    inner.style.setProperty("font-size", `${fontPx}px`, "important");
  };

  applyInnerStyle(fontSizePx);
  div.appendChild(inner);

  if (options.maxLines != null && options.maxLines > 0) {
    const measure = () => {
      div.style.position = "fixed";
      div.style.left = "-9999px";
      div.style.visibility = "hidden";
      document.body.appendChild(div);
      const overflow =
        inner.scrollHeight > inner.clientHeight + 1 ||
        inner.scrollWidth > inner.clientWidth + 1;
      document.body.removeChild(div);
      div.style.position = "";
      div.style.left = "";
      div.style.visibility = "";
      return overflow;
    };
    while (measure() && fontSizePx > minFontPx) {
      fontSizePx = Math.max(minFontPx, fontSizePx - 2);
      applyInnerStyle(fontSizePx);
    }
  }

  return div;
}

export function measureThaiTextWidth(
  text: string,
  options: {
    fontSizePx: number;
    fontWeight?: 500 | 600 | 700;
    strokeWidthPx?: number;
  }
): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  const fontSizePx = options.fontSizePx;
  const stroke = options.strokeWidthPx ?? 0;
  if (typeof document === "undefined") {
    return trimmed.length * fontSizePx * 0.62 + stroke * 2;
  }
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return trimmed.length * fontSizePx * 0.62 + stroke * 2;
  }
  const weight = options.fontWeight ?? 700;
  ctx.font = `${weight} ${fontSizePx}px "Noto Sans Thai", sans-serif`;
  return ctx.measureText(trimmed).width + stroke * 2;
}

export function estimateThaiTextLineCount(
  text: string,
  options: {
    width: number;
    fontSizePx: number;
    fontWeight?: 500 | 600 | 700;
    lineHeight?: number;
  }
): number {
  if (typeof document === "undefined") return 1;

  const lineHeight = options.lineHeight ?? 1.25;
  const measure = document.createElement("div");
  measure.textContent = text;
  measure.style.cssText = [
    "position:fixed",
    "left:-9999px",
    "top:-9999px",
    "visibility:hidden",
    `width:${Math.max(1, Math.floor(options.width))}px`,
    `font-family:"Noto Sans Thai",sans-serif`,
    `font-weight:${options.fontWeight ?? 700}`,
    `font-size:${options.fontSizePx}px`,
    `line-height:${lineHeight}`,
    "word-wrap:break-word",
    "overflow-wrap:break-word",
    "white-space:normal",
  ].join(";");
  document.body.appendChild(measure);
  const linePx = Math.max(1, options.fontSizePx * lineHeight);
  const count = Math.max(1, Math.round(measure.scrollHeight / linePx));
  document.body.removeChild(measure);
  return count;
}
