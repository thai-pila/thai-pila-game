/**
 * รอให้ Noto Sans Thai แบบ Looped (มีหัว) จาก @font-face ใน index.html โหลดก่อนวาด Phaser Text
 * ลดกรณี canvas ใช้ fallback แล้วเลข 0 / ไทยไม่ตรงกับ Looped-Bold/Medium
 */
let notoLoopedReady: Promise<void> | undefined;

export async function ensureNotoSansThaiLoopedReady(): Promise<void> {
  if (typeof document === "undefined" || !document.fonts?.load) return;
  if (!notoLoopedReady) {
    const sizes = [12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 32, 36, 48, 52, 58, 62, 64] as const;
    const jobs: Promise<FontFace[]>[] = [];
    for (const px of sizes) {
      jobs.push(document.fonts.load(`600 ${px}px "Noto Sans Thai"`));
      jobs.push(document.fonts.load(`700 ${px}px "Noto Sans Thai"`));
    }
    notoLoopedReady = Promise.all(jobs).then(() => undefined);
  }
  await notoLoopedReady;
}
