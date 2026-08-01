import { isMobileLayout } from "./device";
import type { SequenceContext } from "../core/scenes/BaseGameScene";

let barRoot: HTMLDivElement | null = null;
let peekWrap: HTMLDivElement | null = null;
let outsideCloseHandler: ((e: MouseEvent | TouchEvent) => void) | null = null;
let peekDesktopEnterHandler: (() => void) | null = null;
let peekDesktopLeaveHandler: (() => void) | null = null;
let peekMobileActivateHandler: ((e: Event) => void) | null = null;

/** ความสูงแถบ peek ตอนพับ (ต้องพอดีกับป้ายลูกศร) */
const PEEK_STRIP_H = 18;

export type SequenceBarLayoutMode = "off" | "fixed" | "gameplay-peek";

export function getSequenceBarHeight(): number {
  return isMobileLayout() ? 46 : 52;
}

function ensureStyles() {
  if (typeof document === "undefined") return;
  const styleId = "eef-sequence-bar-styles";
  let s = document.getElementById(styleId) as HTMLStyleElement | null;
  if (!s) {
    s = document.createElement("style");
    s.id = styleId;
    document.head.appendChild(s);
  }
  s.textContent = `
    #eef-seq-peek-root {
      position: fixed;
      left: 0;
      top: 0;
      right: 0;
      z-index: 100000;
      pointer-events: none;
      overflow: visible;
    }
    #eef-seq-peek-root.peek-collapsed {
      height: ${PEEK_STRIP_H}px;
    }
    #eef-seq-peek-root.peek-expanded {
      pointer-events: auto;
    }
    #eef-seq-peek-root.active-desktop.peek-expanded {
      pointer-events: auto;
    }
    #eef-seq-hotstrip {
      position: absolute;
      left: 0;
      top: 0;
      right: 0;
      height: ${PEEK_STRIP_H}px;
      pointer-events: auto;
      background: transparent;
      z-index: 2;
      display: flex;
      align-items: flex-end;
      justify-content: center;
      padding-bottom: 1px;
      box-sizing: border-box;
    }
    .eef-seq-hover-hint {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 10px;
      line-height: 1;
      min-width: 22px;
      padding: 2px 8px 3px;
      color: rgba(45, 45, 45, 0.88);
      background: rgba(255, 255, 255, 0.42);
      border: 1px solid rgba(255, 255, 255, 0.72);
      border-radius: 0 0 8px 8px;
      box-shadow:
        0 2px 8px rgba(0, 0, 0, 0.08),
        inset 0 1px 0 rgba(255, 255, 255, 0.55);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      pointer-events: none;
      user-select: none;
      transform: translateY(3px);
    }
    #eef-seq-peek-root.peek-collapsed .eef-seq-hover-hint {
      animation: eef-seq-hint-pulse 2.2s ease-in-out infinite;
    }
    #eef-seq-peek-root.peek-expanded .eef-seq-hover-hint {
      opacity: 0;
      visibility: hidden;
      animation: none;
    }
    @keyframes eef-seq-hint-pulse {
      0%, 100% {
        transform: translateY(3px);
        filter: brightness(1);
        box-shadow:
          0 2px 8px rgba(0, 0, 0, 0.08),
          inset 0 1px 0 rgba(255, 255, 255, 0.55);
      }
      50% {
        transform: translateY(5px);
        filter: brightness(1.04);
        box-shadow:
          0 4px 12px rgba(0, 0, 0, 0.12),
          inset 0 1px 0 rgba(255, 255, 255, 0.7);
      }
    }
    @media (max-width: 768px) {
      #eef-seq-hotstrip {
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
      }
    }
    #eef-seq-peek-root #eef-sequence-bar {
      position: absolute;
      left: 0;
      right: 0;
      top: 0;
      width: 100%;
      z-index: 0;
    }
    #eef-sequence-bar {
      position: fixed;
      left: 0;
      right: 0;
      top: 0;
      width: 100%;
      z-index: 0;
      pointer-events: none;
      box-sizing: border-box;
      background: rgba(255, 255, 255, 0.38);
      border-bottom: 1px solid rgba(255, 255, 255, 0.55);
      box-shadow: 0 4px 18px rgba(0, 0, 0, 0.06);
      backdrop-filter: blur(14px) saturate(1.15);
      -webkit-backdrop-filter: blur(14px) saturate(1.15);
      font-family: "Noto Sans Thai", sans-serif;
      display: none;
      align-items: center;
      padding: 0 14px;
    }
    #eef-seq-peek-root.peek-collapsed #eef-sequence-bar {
      display: none !important;
      visibility: hidden !important;
    }
    #eef-seq-peek-root.peek-expanded #eef-sequence-bar {
      display: flex !important;
      visibility: visible !important;
      pointer-events: none;
    }
    #eef-sequence-bar .eef-seq-inner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 100%;
      min-width: 0;
      gap: 10px;
    }
    @media (min-width: 769px) {
      #eef-sequence-bar .eef-seq-inner {
        display: grid;
        grid-template-columns: 1fr auto 1fr;
        align-items: center;
      }
      #eef-sequence-bar .eef-seq-title {
        grid-column: 1;
        justify-self: start;
      }
      #eef-sequence-bar .eef-seq-stepper {
        grid-column: 2;
        justify-self: center;
      }
    }
    #eef-sequence-bar .eef-seq-title {
      flex: 1;
      min-width: 0;
      font-size: 13px;
      line-height: 1.35;
      color: #2d2d2d;
      font-weight: 500;
      overflow: hidden;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
    }
    @media (min-width: 769px) {
      #eef-sequence-bar .eef-seq-title { font-size: 14px; }
    }
    #eef-sequence-bar .eef-seq-stepper {
      display: flex;
      flex-direction: row;
      align-items: center;
      flex-shrink: 0;
      gap: 6px;
    }
    #eef-sequence-bar .eef-seq-dot {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      font-weight: 700;
      box-sizing: border-box;
      line-height: 0;
    }
    #eef-sequence-bar .eef-seq-dot.inactive {
      width: 26px;
      height: 26px;
      font-size: 11px;
      background: rgba(255, 255, 255, 0.55);
      color: #5c5c5c;
      border: 1px solid rgba(255, 255, 255, 0.65);
    }
    #eef-sequence-bar .eef-seq-dot.active {
      width: 32px;
      height: 32px;
      font-size: 13px;
      background: #1e88e5;
      color: #ffffff;
    }
    body.eef-seq-fixed-bar #eef-sequence-bar {
      position: fixed;
      left: 0;
      top: 0;
      z-index: 100000;
    }
    @media (min-width: 769px) {
      body.eef-seq-fixed-bar #eef-sequence-bar .eef-seq-inner {
        display: grid;
        grid-template-columns: 1fr auto 1fr;
        align-items: center;
      }
      body.eef-seq-fixed-bar #eef-sequence-bar .eef-seq-title {
        grid-column: 1;
        justify-self: start;
      }
      body.eef-seq-fixed-bar #eef-sequence-bar .eef-seq-stepper {
        grid-column: 2;
        justify-self: center;
      }
    }
  `;
}

function collapsePeekStrip() {
  if (!peekWrap) return;
  peekWrap.style.height = `${PEEK_STRIP_H}px`;
  peekWrap.classList.remove("peek-expanded");
  peekWrap.classList.add("peek-collapsed");
  removePeekOutsideClose();
}

function removePeekEventListeners() {
  if (peekWrap) {
    if (peekDesktopEnterHandler) {
      peekWrap.removeEventListener("mouseenter", peekDesktopEnterHandler);
      peekDesktopEnterHandler = null;
    }
    if (peekDesktopLeaveHandler) {
      peekWrap.removeEventListener("mouseleave", peekDesktopLeaveHandler);
      peekDesktopLeaveHandler = null;
    }
    const hot = peekWrap.querySelector("#eef-seq-hotstrip");
    if (hot && peekMobileActivateHandler) {
      hot.removeEventListener("click", peekMobileActivateHandler);
      peekMobileActivateHandler = null;
    }
  }
  removePeekOutsideClose();
}

function teardownPeekUi() {
  collapsePeekStrip();
  removePeekEventListeners();
  if (barRoot && peekWrap?.contains(barRoot)) {
    document.body.appendChild(barRoot);
  }
  if (peekWrap?.parentNode) peekWrap.parentNode.removeChild(peekWrap);
  peekWrap = null;
  document.body.classList.remove("eef-seq-fixed-bar");
  resetBarInlineStyles();
}

function hideBarElement() {
  if (!barRoot) return;
  barRoot.style.setProperty("display", "none", "important");
  barRoot.style.setProperty("visibility", "hidden", "important");
}

function ensureBarRoot(): HTMLDivElement {
  ensureStyles();
  if (!barRoot && typeof document !== "undefined") {
    barRoot = document.createElement("div");
    barRoot.id = "eef-sequence-bar";
    document.body.appendChild(barRoot);
  }
  return barRoot!;
}

function removePeekOutsideClose() {
  if (!outsideCloseHandler || typeof document === "undefined") return;
  document.removeEventListener("mousedown", outsideCloseHandler);
  document.removeEventListener("touchstart", outsideCloseHandler);
  outsideCloseHandler = null;
}

function resetBarInlineStyles() {
  if (!barRoot) return;
  barRoot.style.removeProperty("display");
  barRoot.style.removeProperty("visibility");
  barRoot.style.position = "";
  barRoot.style.left = "";
  barRoot.style.right = "";
  barRoot.style.top = "";
  barRoot.style.zIndex = "";
  barRoot.style.boxShadow = "";
}

function buildBarInnerHtml(ctx: SequenceContext): string {
  const currentIdx = ctx.index;
  const currentName = ctx.exerciseNames![currentIdx] ?? "";
  const seqTitle = (ctx.sequenceInfoExerciseName ?? "").trim();
  const title =
    seqTitle.length > 0 ? `${seqTitle} - ${currentName}` : currentName;
  const n = ctx.exerciseNames!.length;
  const stepperHtml = Array.from({ length: n }, (_, i) => {
    const active = i === currentIdx;
    return `<span class="eef-seq-dot ${active ? "active" : "inactive"}">${i + 1}</span>`;
  }).join("");
  return `
    <div class="eef-seq-inner">
      <div class="eef-seq-title">${escapeHtml(title)}</div>
      <div class="eef-seq-stepper">${stepperHtml}</div>
    </div>
  `;
}

export function updateSequenceHudDom(ctx: SequenceContext): void {
  if (typeof document === "undefined") return;
  if (!ctx.isSequence || !ctx.exerciseNames?.length) return;

  const el = ensureBarRoot();
  const h = getSequenceBarHeight();
  el.style.height = `${h}px`;
  el.innerHTML = buildBarInnerHtml(ctx);
}

export function hideSequenceHudDom(): void {
  if (typeof document === "undefined") return;
  teardownPeekUi();
  hideBarElement();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * off — ซ่อนทั้งหมด  
 * fixed — เฉพาะหน้า Home (sequence) แถบติดบนตลอด  
 * gameplay-peek — หน้าเล่นเกม: แถบลูกศรเหลืองที่ขอบบน — desktop hover, mobile แตะลูกศร
 */
export function setSequenceBarLayout(mode: SequenceBarLayoutMode, ctx?: SequenceContext): void {
  if (typeof document === "undefined") return;

  teardownPeekUi();

  if (mode === "off" || !ctx?.isSequence || !ctx.exerciseNames?.length) {
    hideBarElement();
    return;
  }

  updateSequenceHudDom(ctx);
  const bar = ensureBarRoot();
  bar.style.removeProperty("visibility");

  if (mode === "fixed") {
    if (!document.body.contains(bar)) document.body.appendChild(bar);
    document.body.classList.add("eef-seq-fixed-bar");
    bar.style.setProperty("display", "flex", "important");
    bar.style.height = `${getSequenceBarHeight()}px`;
    bar.style.top = "0";
    return;
  }

  /* gameplay-peek — bar ชิดขอบบนเมื่อขยาย, hotstrip + ▼ ทับด้านบน (เหมือนกันทั้ง desktop / mobile) */
  document.body.classList.remove("eef-seq-fixed-bar");
  const mobile = isMobileLayout();

  peekWrap = document.createElement("div");
  peekWrap.id = "eef-seq-peek-root";
  peekWrap.className = mobile ? "peek-collapsed" : "peek-collapsed active-desktop";

  peekWrap.appendChild(bar);
  const hot = document.createElement("div");
  hot.id = "eef-seq-hotstrip";
  const hoverHint = document.createElement("span");
  hoverHint.className = "eef-seq-hover-hint";
  hoverHint.setAttribute("aria-hidden", "true");
  hoverHint.title = mobile
    ? "แตะเพื่อดูแถบลำดับเกม"
    : "ชี้เมาส์ที่นี่เพื่อดูแถบลำดับเกม";
  hoverHint.textContent = "▼";
  hot.appendChild(hoverHint);
  peekWrap.appendChild(hot);

  document.body.appendChild(peekWrap);

  const barH = getSequenceBarHeight();
  peekWrap.style.height = `${PEEK_STRIP_H}px`;

  bar.style.removeProperty("display");
  bar.style.height = `${barH}px`;

  const expand = () => {
    peekWrap!.style.height = `${barH}px`;
    peekWrap!.classList.remove("peek-collapsed");
    peekWrap!.classList.add("peek-expanded");
  };
  const collapse = () => {
    collapsePeekStrip();
  };

  if (mobile) {
    peekMobileActivateHandler = (e: Event) => {
      e.stopPropagation();
      if (peekWrap!.classList.contains("peek-expanded")) {
        collapse();
      } else {
        expand();
        removePeekOutsideClose();
        outsideCloseHandler = (ev: MouseEvent | TouchEvent) => {
          const t = ev.target as Node;
          if (peekWrap?.contains(t)) return;
          collapse();
        };
        document.addEventListener("mousedown", outsideCloseHandler);
        document.addEventListener("touchstart", outsideCloseHandler, { passive: true });
      }
    };
    hot.addEventListener("click", peekMobileActivateHandler);
  } else {
    peekDesktopEnterHandler = expand;
    peekDesktopLeaveHandler = collapse;
    peekWrap.addEventListener("mouseenter", peekDesktopEnterHandler);
    peekWrap.addEventListener("mouseleave", peekDesktopLeaveHandler);
  }
}

export function refreshSequenceGameplayBar(ctx: SequenceContext | undefined): void {
  if (!ctx?.isSequence || !ctx.exerciseNames?.length) return;
  collapsePeekStrip();
  updateSequenceHudDom(ctx);
}
