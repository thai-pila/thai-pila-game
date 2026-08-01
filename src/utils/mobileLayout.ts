import { isMobile } from "./device";

/** ขนาด viewport ที่มองเห็นจริง — ใช้ visualViewport บนมือถือ (iframe / Safari) */
export function getGameViewportSize(): { width: number; height: number } {
  if (typeof window === "undefined") return { width: 1280, height: 720 };

  const vv = window.visualViewport;
  if (isMobile() && vv) {
    return {
      width: Math.max(1, Math.round(vv.width)),
      height: Math.max(1, Math.round(vv.height)),
    };
  }

  return {
    width: Math.max(1, Math.round(window.innerWidth)),
    height: Math.max(1, Math.round(window.innerHeight)),
  };
}

/** มือถือจอเตี้ย (iframe, SE, landscape แคบ) */
export function isShortMobileViewport(height: number, width?: number): boolean {
  return height <= 760 || (width != null && width <= 400);
}

/** มือถือจอเล็กมาก */
export function isTinyMobileViewport(height: number, width?: number): boolean {
  return height <= 640 || (width != null && width <= 360);
}

/** ย่อค่า px คงที่บนมือถือเมื่อจอเตี้ย */
export function getMobileCompactUiScale(height: number, width?: number): number {
  if (isTinyMobileViewport(height, width)) {
    if (height <= 560) return 0.76;
    return 0.84;
  }
  if (isShortMobileViewport(height, width)) return 0.92;
  return 1;
}

export function mobileCompactPx(base: number, height: number, width?: number): number {
  return Math.max(1, Math.round(base * getMobileCompactUiScale(height, width)));
}
