import type Phaser from "phaser";
import {
  type GameAudioCategory,
  isGameAudioEnabled,
} from "./GameAudioSettings";

export {
  GAME_BGM_VOLUME,
  GAME_BGM_VOLUME_END,
  GAME_BGM_VOLUME_FADE,
} from "./GameAudioSettings";

export function canPlayGameAudio(category: GameAudioCategory): boolean {
  return isGameAudioEnabled(category);
}

/** จำแนก SFX — ค่าเริ่มต้นเป็น `choice` (เอฟเฟกต์) ให้ปิดตามกลุ่มพื้นหลัง */
export function inferSfxAudioCategory(key: string): GameAudioCategory {
  const k = key.toLowerCase();
  if (k.startsWith("bgm_") || k.includes("clock_ticking") || k.includes("ticking")) {
    return "background";
  }
  if (k.includes("alert_danger") || k.includes("alert_warning")) return "background";
  if (k.includes("notification_message")) return "assistant_voice";
  if (k.includes("question")) return "question";
  return "choice";
}

export function guardedScenePlay(
  scene: Phaser.Scene,
  key: string,
  volume: number,
  category?: GameAudioCategory | null
) {
  if (!scene.cache.audio.exists(key)) return;
  const cat = category == null ? inferSfxAudioCategory(key) : category;
  if (!canPlayGameAudio(cat)) return;
  scene.sound.play(key, { volume });
}

export function guardedScenePlayVoice(scene: Phaser.Scene, key: string, volume: number) {
  if (!canPlayGameAudio("assistant_voice")) return;
  if (!scene.cache.audio.exists(key)) return;
  scene.sound.stopByKey(key);
  scene.sound.play(key, { volume });
}

export function guardedScenePlayQuestion(scene: Phaser.Scene, key: string, volume: number) {
  if (!canPlayGameAudio("question")) return;
  if (!scene.cache.audio.exists(key)) return;
  scene.sound.stopByKey(key);
  scene.sound.play(key, { volume });
}

export function guardedScenePlayChoice(scene: Phaser.Scene, key: string, volume: number) {
  if (!canPlayGameAudio("choice")) return;
  if (!scene.cache.audio.exists(key)) return;
  scene.sound.stopByKey(key);
  scene.sound.play(key, { volume });
}

/**
 * เล่นเสียงคำถาม แล้วเรียก `onComplete` เมื่อเสียงเล่นจบ
 * - ถ้าปิดเสียงคำถาม / ไม่มีไฟล์ / ไม่มี key → เรียก `onComplete` ทันที
 * - มี fallback timer กันเคส event ไม่ยิง
 * ใช้สำหรับ "ให้เสียงโจทย์เล่นจบก่อน แล้วค่อยขึ้นคำใบ้"
 */
export function guardedScenePlayQuestionThen(
  scene: Phaser.Scene,
  key: string | undefined | null,
  volume: number,
  onComplete: () => void
): void {
  const playable =
    !!key && canPlayGameAudio("question") && scene.cache.audio.exists(key);
  if (!playable) {
    onComplete();
    return;
  }
  scene.sound.stopByKey(key as string);
  const sound = scene.sound.add(key as string, { volume });
  let finished = false;
  let fallbackTimer: Phaser.Time.TimerEvent | undefined;
  const finish = (runComplete: boolean) => {
    if (finished) return;
    finished = true;
    fallbackTimer?.destroy();
    fallbackTimer = undefined;
    try {
      sound.destroy();
    } catch {
      /* already destroyed */
    }
    if (runComplete) onComplete();
  };
  sound.once("complete", () => finish(true));
  sound.once("stop", () => finish(false));
  sound.play();
  const durationMs = sound.duration && sound.duration > 0 ? sound.duration * 1000 : 4000;
  fallbackTimer = scene.time.delayedCall(durationMs + 300, () => finish(true));
}
