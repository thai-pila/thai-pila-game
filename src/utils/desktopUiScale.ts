/** ฐานเลย์เอาต์เดสก์ท็อป — จอเล็กกว่านี้ให้ย่อ UI ตามสัดส่วน (เช่น situation) */
export const DESKTOP_LAYOUT_WIDTH = 1920;
export const DESKTOP_LAYOUT_HEIGHT = 1080;

export function getDesktopUiScale(
  width: number,
  height: number,
  mobile: boolean,
  options?: { min?: number; max?: number }
): number {
  if (mobile) return 1;
  const min = options?.min ?? 0.62;
  const max = options?.max ?? 1;
  const raw = Math.min(width / DESKTOP_LAYOUT_WIDTH, height / DESKTOP_LAYOUT_HEIGHT);
  return Math.min(max, Math.max(min, raw));
}

/** คูณขนาดพิกเซลฐาน 1920×1080 — มือถือคืนค่าเดิม */
export function uiPx(base: number, width: number, height: number, mobile: boolean): number {
  if (mobile) return base;
  return Math.round(base * getDesktopUiScale(width, height, mobile));
}

export function uiFont(basePx: number, width: number, height: number, mobile: boolean): string {
  return `${uiPx(basePx, width, height, mobile)}px`;
}

export type HudScaleCtx = {
  mobile: boolean;
  width: number;
  height: number;
  scale: number;
  px: (base: number) => number;
  font: (basePx: number) => string;
};

export function createHudScaleCtx(width: number, height: number, mobile: boolean): HudScaleCtx {
  const scale = getDesktopUiScale(width, height, mobile);
  return {
    mobile,
    width,
    height,
    scale,
    px: (base) => (mobile ? base : Math.round(base * scale)),
    font: (basePx) => `${mobile ? basePx : Math.round(basePx * scale)}px`,
  };
}
