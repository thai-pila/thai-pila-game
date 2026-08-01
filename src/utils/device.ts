export function isMobile(): boolean {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

 
export function isInIframe(): boolean {
  try {
    return typeof window !== "undefined" && window.self !== window.top;
  } catch {
    return true; 
  }
}

 
export function isMobileLayout(): boolean {
  // เคยกัน iframe ไว้ ทำให้ "มือถือที่ฝังในเว็บอื่น" ถูกมองเป็น desktop
  // และเลย์เอาต์ไม่ responsive บน mobile
  return isMobile();
}
