import {
  areAllGameAudioMuted,
  GAME_AUDIO_MENU_LABELS,
  GAME_AUDIO_SELECT_ALL_LABEL,
  isBackgroundAudioGroupMuted,
  isGameAudioMuted,
  setAllGameAudioMuted,
  setBackgroundAudioGroupMuted,
  setGameAudioMuted,
  subscribeGameAudioSettings,
  type GameAudioCategory,
} from "./GameAudioSettings";

/** แถวในเมนู — ไม่แสดง `choice` แยก (รวมกับ background) */
const MENU_CATEGORIES: GameAudioCategory[] = [
  "assistant_voice",
  "background",
  "question",
];

const POS_STORAGE_KEY = "eef-audio-menu-pos";
const DRAG_THRESHOLD_PX = 8;
const DEFAULT_MARGIN_PX = 10;
const BTN_GAP_PX = 8;
const PANEL_EST_HEIGHT_PX = 200;
const PANEL_MIN_WIDTH_PX = 200;

let root: HTMLDivElement | null = null;
let panel: HTMLDivElement | null = null;
let menuBtn: HTMLButtonElement | null = null;
let open = false;
let unsubscribe: (() => void) | null = null;
let outsideHandler: ((e: MouseEvent | TouchEvent) => void) | null = null;
let dragDisposer: (() => void) | null = null;
let didDrag = false;

function ensureStyles() {
  if (typeof document === "undefined") return;
  document.getElementById("eef-game-audio-menu-styles")?.remove();
  const s = document.createElement("style");
  s.id = "eef-game-audio-menu-styles";
  s.textContent = `
    #eef-audio-menu-root {
      position: fixed;
      bottom: ${DEFAULT_MARGIN_PX}px;
      right: ${DEFAULT_MARGIN_PX}px;
      top: auto;
      z-index: 100001;
      font-family: "Noto Sans Thai Looped", "Noto Sans Thai", sans-serif;
      pointer-events: none;
      touch-action: none;
      overflow: visible;
    }
    #eef-audio-menu-btn {
      pointer-events: auto;
      width: 44px;
      height: 44px;
      border: none;
      border-radius: 10px;
      background: rgba(255, 255, 255, 0.94);
      box-shadow: 0 2px 10px rgba(0, 40, 80, 0.22);
      cursor: grab;
      touch-action: none;
      -webkit-user-select: none;
      user-select: none;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 5px;
      padding: 0;
    }
    #eef-audio-menu-btn.is-dragging {
      cursor: grabbing;
    }
    #eef-audio-menu-btn span {
      display: block;
      width: 20px;
      height: 3px;
      background: #025b96;
      border-radius: 2px;
      pointer-events: none;
    }
    #eef-audio-menu-panel {
      pointer-events: auto;
      position: absolute;
      width: max-content;
      min-width: 0;
      max-width: min(92vw, 280px);
      background: rgba(255, 255, 255, 0.98);
      border-radius: 12px;
      box-shadow: 0 8px 28px rgba(0, 40, 80, 0.28);
      padding: 10px 12px 12px;
      box-sizing: border-box;
      opacity: 0;
      visibility: hidden;
      transition: opacity 0.18s ease, visibility 0.18s;
    }
    #eef-audio-menu-panel.open {
      opacity: 1;
      visibility: visible;
    }
    #eef-audio-menu-panel.place-below {
      top: calc(100% + ${BTN_GAP_PX}px);
      bottom: auto;
    }
    #eef-audio-menu-panel.place-above {
      bottom: calc(100% + ${BTN_GAP_PX}px);
      top: auto;
    }
    #eef-audio-menu-panel.align-left {
      left: 0;
      right: auto;
    }
    #eef-audio-menu-panel.align-right {
      right: 0;
      left: auto;
    }
    #eef-audio-menu-panel h3 {
      margin: 0 0 8px;
      font-size: 15px;
      font-weight: 700;
      color: #025b96;
    }
    .eef-audio-rows {
      display: grid;
      grid-template-columns: max-content 22px;
      column-gap: 10px;
      align-items: center;
    }
    .eef-audio-row {
      display: contents;
      cursor: pointer;
      -webkit-user-select: none;
      user-select: none;
    }
    .eef-audio-row-text {
      font-size: 14px;
      font-weight: 600;
      color: #1a3d52;
      line-height: 1.3;
      padding: 7px 0;
      border-bottom: 1px solid rgba(2, 91, 150, 0.1);
      white-space: nowrap;
    }
    .eef-audio-row-select-all .eef-audio-row-text {
      font-weight: 700;
      color: #025b96;
    }
    .eef-audio-row:last-of-type .eef-audio-row-text {
      border-bottom: none;
      padding-bottom: 2px;
    }
    .eef-audio-row-check {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 7px 0;
      border-bottom: 1px solid rgba(2, 91, 150, 0.1);
    }
    .eef-audio-row:last-of-type .eef-audio-row-check {
      border-bottom: none;
      padding-bottom: 2px;
    }
    .eef-audio-checkbox {
      appearance: none;
      -webkit-appearance: none;
      width: 22px;
      height: 22px;
      margin: 0;
      flex-shrink: 0;
      border: 2px solid #025b96;
      border-radius: 5px;
      background: #fff;
      cursor: pointer;
      position: relative;
      transition: background-color 0.15s ease, border-color 0.15s ease;
    }
    .eef-audio-checkbox:checked {
      background: #2e9fd4;
      border-color: #2e9fd4;
    }
    .eef-audio-checkbox:checked::after {
      content: "";
      position: absolute;
      left: 6px;
      top: 2px;
      width: 6px;
      height: 11px;
      border: solid #fff;
      border-width: 0 2.5px 2.5px 0;
      transform: rotate(45deg);
    }
    .eef-audio-checkbox:focus-visible {
      outline: 2px solid #2e9fd4;
      outline-offset: 2px;
    }
  `;
  document.head.appendChild(s);
}

function clampMenuPosition(x: number, y: number) {
  if (!root) return { x, y };
  const rect = root.getBoundingClientRect();
  const w = rect.width || 44;
  const h = rect.height || 44;
  const maxX = Math.max(DEFAULT_MARGIN_PX, window.innerWidth - w - DEFAULT_MARGIN_PX);
  const maxY = Math.max(DEFAULT_MARGIN_PX, window.innerHeight - h - DEFAULT_MARGIN_PX);
  return {
    x: Math.min(Math.max(DEFAULT_MARGIN_PX, x), maxX),
    y: Math.min(Math.max(DEFAULT_MARGIN_PX, y), maxY),
  };
}

function placeMenuAt(x: number, y: number) {
  if (!root) return;
  const p = clampMenuPosition(x, y);
  root.style.left = `${p.x}px`;
  root.style.top = `${p.y}px`;
  root.style.right = "auto";
  root.style.bottom = "auto";
  if (open) layoutPanel();
}

/** วางแผงให้อยู่ใน viewport — เปิดด้านบน/ล่างและชิดซ้าย/ขวาตามตำแหน่งปุ่ม */
function layoutPanel() {
  if (!menuBtn || !panel) return;

  panel.classList.remove("place-below", "place-above", "align-left", "align-right");

  const btnRect = menuBtn.getBoundingClientRect();
  const measureOpen = !panel.classList.contains("open");
  if (measureOpen) panel.classList.add("open");
  const panelH = panel.offsetHeight || PANEL_EST_HEIGHT_PX;
  const panelW = panel.offsetWidth || PANEL_MIN_WIDTH_PX;
  if (measureOpen) panel.classList.remove("open");

  const spaceBelow = window.innerHeight - btnRect.bottom - DEFAULT_MARGIN_PX;
  const spaceAbove = btnRect.top - DEFAULT_MARGIN_PX;
  const openBelow = spaceBelow >= panelH + BTN_GAP_PX || spaceBelow >= spaceAbove;
  panel.classList.add(openBelow ? "place-below" : "place-above");

  const fitsRight = btnRect.left + panelW <= window.innerWidth - DEFAULT_MARGIN_PX;
  const fitsLeft = btnRect.right - panelW >= DEFAULT_MARGIN_PX;
  if (!fitsRight && fitsLeft) {
    panel.classList.add("align-right");
  } else {
    panel.classList.add("align-left");
  }
}

/** เลื่อนปุ่ม+แผงกลับเข้าจอถ้ายังล้นขอบหลังจัดวาง */
function nudgeMenuIntoViewport() {
  if (!open || !panel || !root) return;
  const rect = panel.getBoundingClientRect();
  let dx = 0;
  let dy = 0;
  if (rect.bottom > window.innerHeight - DEFAULT_MARGIN_PX) {
    dy = window.innerHeight - DEFAULT_MARGIN_PX - rect.bottom;
  }
  if (rect.top < DEFAULT_MARGIN_PX) {
    dy = DEFAULT_MARGIN_PX - rect.top;
  }
  if (rect.right > window.innerWidth - DEFAULT_MARGIN_PX) {
    dx = window.innerWidth - DEFAULT_MARGIN_PX - rect.right;
  }
  if (rect.left < DEFAULT_MARGIN_PX) {
    dx = DEFAULT_MARGIN_PX - rect.left;
  }
  if (!dx && !dy) return;
  const rootRect = root.getBoundingClientRect();
  placeMenuAt(rootRect.left + dx, rootRect.top + dy);
}

function saveMenuPosition() {
  if (!root) return;
  const rect = root.getBoundingClientRect();
  try {
    sessionStorage.setItem(
      POS_STORAGE_KEY,
      JSON.stringify({ x: Math.round(rect.left), y: Math.round(rect.top) })
    );
  } catch {
    /* ignore quota / private mode */
  }
}

function applySavedMenuPosition() {
  if (!root) return;
  try {
    const raw = sessionStorage.getItem(POS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { x?: number; y?: number };
      if (typeof parsed.x === "number" && typeof parsed.y === "number") {
        placeMenuAt(parsed.x, parsed.y);
        return;
      }
    }
  } catch {
    /* ignore */
  }
  const w = root.offsetWidth || 44;
  const h = root.offsetHeight || 44;
  placeMenuAt(
    window.innerWidth - w - DEFAULT_MARGIN_PX,
    window.innerHeight - h - DEFAULT_MARGIN_PX
  );
}

function bindMenuDrag(btn: HTMLButtonElement) {
  let dragging = false;
  let pointerId: number | null = null;
  let startClientX = 0;
  let startClientY = 0;
  let originLeft = 0;
  let originTop = 0;

  const onPointerDown = (e: PointerEvent) => {
    if (!root) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;

    dragging = true;
    didDrag = false;
    pointerId = e.pointerId;
    startClientX = e.clientX;
    startClientY = e.clientY;
    const rect = root.getBoundingClientRect();
    originLeft = rect.left;
    originTop = rect.top;
    btn.classList.add("is-dragging");
    btn.setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!dragging || e.pointerId !== pointerId || !root) return;
    const dx = e.clientX - startClientX;
    const dy = e.clientY - startClientY;
    if (!didDrag && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;

    didDrag = true;
    if (open) setPanelOpen(false);
    placeMenuAt(originLeft + dx, originTop + dy);
    e.preventDefault();
  };

  const finishDrag = (e: PointerEvent) => {
    if (!dragging || e.pointerId !== pointerId) return;
    dragging = false;
    pointerId = null;
    btn.classList.remove("is-dragging");
    try {
      btn.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    if (didDrag) saveMenuPosition();
  };

  const onPointerUp = (e: PointerEvent) => finishDrag(e);
  const onPointerCancel = (e: PointerEvent) => finishDrag(e);

  btn.addEventListener("pointerdown", onPointerDown);
  btn.addEventListener("pointermove", onPointerMove);
  btn.addEventListener("pointerup", onPointerUp);
  btn.addEventListener("pointercancel", onPointerCancel);

  const onResize = () => {
    if (!root) return;
    const rect = root.getBoundingClientRect();
    placeMenuAt(rect.left, rect.top);
    if (open) layoutPanel();
  };
  window.addEventListener("resize", onResize);

  dragDisposer = () => {
    btn.removeEventListener("pointerdown", onPointerDown);
    btn.removeEventListener("pointermove", onPointerMove);
    btn.removeEventListener("pointerup", onPointerUp);
    btn.removeEventListener("pointercancel", onPointerCancel);
    window.removeEventListener("resize", onResize);
  };
}

function syncToggles() {
  if (!panel) return;
  const selectAll = panel.querySelector<HTMLInputElement>('input[data-cat="select_all"]');
  if (selectAll) selectAll.checked = areAllGameAudioMuted();
  for (const cat of MENU_CATEGORIES) {
    const input = panel.querySelector<HTMLInputElement>(`input[data-cat="${cat}"]`);
    if (!input) continue;
    if (cat === "background") {
      input.checked = isBackgroundAudioGroupMuted();
    } else {
      input.checked = isGameAudioMuted(cat);
    }
  }
}

function setPanelOpen(next: boolean) {
  open = next;
  if (!panel) return;
  if (open) {
    layoutPanel();
    panel.classList.add("open");
    requestAnimationFrame(() => {
      layoutPanel();
      nudgeMenuIntoViewport();
    });
  } else {
    panel.classList.remove("open");
  }
}

function bindOutsideClose() {
  if (outsideHandler) return;
  outsideHandler = (e: MouseEvent | TouchEvent) => {
    if (!open || !root) return;
    const t = e.target as Node | null;
    if (t && root.contains(t)) return;
    setPanelOpen(false);
  };
  document.addEventListener("mousedown", outsideHandler);
  document.addEventListener("touchstart", outsideHandler, { passive: true });
}

function unbindOutsideClose() {
  if (!outsideHandler) return;
  document.removeEventListener("mousedown", outsideHandler);
  document.removeEventListener("touchstart", outsideHandler);
  outsideHandler = null;
}

export function mountGameAudioMenu(): () => void {
  if (typeof document === "undefined") return () => {};
  ensureStyles();
  destroyGameAudioMenu();

  root = document.createElement("div") as HTMLDivElement;
  root.id = "eef-audio-menu-root";

  menuBtn = document.createElement("button");
  menuBtn.id = "eef-audio-menu-btn";
  menuBtn.type = "button";
  menuBtn.setAttribute("aria-label", "ตั้งค่าเสียง — ลากเพื่อย้ายตำแหน่ง");
  for (let i = 0; i < 3; i += 1) {
    menuBtn.appendChild(document.createElement("span"));
  }
  menuBtn.addEventListener("click", (e) => {
    if (didDrag) {
      didDrag = false;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    e.stopPropagation();
    setPanelOpen(!open);
  });

  panel = document.createElement("div") as HTMLDivElement;
  panel.id = "eef-audio-menu-panel";
  const title = document.createElement("h3");
  title.textContent = "ตั้งค่าเสียง";
  panel.appendChild(title);

  const rowsWrap = document.createElement("div");
  rowsWrap.className = "eef-audio-rows";

  const addRow = (
    cat: GameAudioCategory | "select_all",
    label: string,
    extraClass?: string
  ) => {
    const row = document.createElement("label");
    row.className = `eef-audio-row${extraClass ? ` ${extraClass}` : ""}`;

    const text = document.createElement("span");
    text.className = "eef-audio-row-text";
    text.textContent = label;

    const checkWrap = document.createElement("span");
    checkWrap.className = "eef-audio-row-check";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "eef-audio-checkbox";
    input.id = `eef-audio-${cat}`;
    input.dataset.cat = cat;
    input.addEventListener("change", () => {
      const muted = input.checked;
      if (cat === "select_all") {
        setAllGameAudioMuted(muted, { byUser: true });
        return;
      }
      if (cat === "background") {
        setBackgroundAudioGroupMuted(muted, { byUser: true });
        return;
      }
      setGameAudioMuted(cat, muted, { byUser: true });
    });

    checkWrap.appendChild(input);
    row.appendChild(text);
    row.appendChild(checkWrap);
    rowsWrap.appendChild(row);
    return input;
  };

  addRow("select_all", GAME_AUDIO_SELECT_ALL_LABEL, "eef-audio-row-select-all");
  for (const cat of MENU_CATEGORIES) {
    addRow(cat, GAME_AUDIO_MENU_LABELS[cat]);
  }

  panel.appendChild(rowsWrap);

  root.appendChild(menuBtn);
  root.appendChild(panel);
  document.body.appendChild(root);

  applySavedMenuPosition();
  bindMenuDrag(menuBtn);

  bindOutsideClose();
  syncToggles();
  unsubscribe = subscribeGameAudioSettings(() => syncToggles());

  return destroyGameAudioMenu;
}

export function destroyGameAudioMenu() {
  unbindOutsideClose();
  dragDisposer?.();
  dragDisposer = null;
  unsubscribe?.();
  unsubscribe = null;
  root?.remove();
  root = null;
  panel = null;
  menuBtn = null;
  open = false;
  didDrag = false;
}
