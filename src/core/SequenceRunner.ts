import Phaser from "phaser";
import { loadGameScene } from "../games/registry";
import {
  GamePayloadEntry,
  GameSourcePayload,
  getGameAvailability,
  getGameUnplayableMessage,
  mapGameTypeToSceneKey,
  toGamePayload,
} from "./api";

// =============================================================
// SequenceRunner – รับ list ของเกม (จาก source=sequence) แล้วเล่นทีละเกม
// เกมจะส่งสัญญาณจบผ่าน ResultScene (ปุ่ม next) หรือ event "sequence-next"
// ที่ scene ตัวเองยิงให้ก่อน scene ถัดไปจะถูก start
// =============================================================

export interface SequenceRunOptions {
  game: Phaser.Game;
  games: GamePayloadEntry[];
  /** จาก API `sequence_info.exercise_name` */
  sequenceInfoExerciseName?: string;
  /** UUID ของ sequence (uuid_newgen หรือ uuid) — runstate / agent scope */
  sequenceUuid?: string;
  /** `sequence_info.uuid` เท่านั้น — ส่ง live-dashboard */
  liveDashboardSequenceUuid?: string;
  onAllFinished?: (results: SequenceResult[]) => void;
  onBeforeStartGame?: (sceneKey: string, payload: GameSourcePayload, indexInSequence: number) => void;
}

export interface SequenceResult {
  sceneKey: string;
  exerciseName?: string;
  score?: number;
  total?: number;
  time?: number;
  /** `game_info.uuid` — ใช้ส่ง live-dashboard แบบ batch ตอนหน้าสรุป */
  uuid_game_info?: string;
  /** legacy / เคสพิเศษ — โหมดสรุป sequence ใช้ปุ่ม resultbtn แทน */
  restartSequence?: boolean;
  /** เล่นเกมปัจจุบันใหม่ (ไม่ไปเกมถัดไป / ไม่บันทึกผลรอบนี้) */
  replayCurrentGame?: boolean;
}

export class SequenceRunner {
  private readonly opts: SequenceRunOptions;
  private readonly sequenceInfoExerciseName: string | undefined;
  private readonly entries: GamePayloadEntry[];
  private currentIndex = 0;
  private results: SequenceResult[] = [];
  private currentSceneKey: string | null = null;

  constructor(opts: SequenceRunOptions) {
    this.opts = opts;
    this.sequenceInfoExerciseName = opts.sequenceInfoExerciseName;
    let unknownType = 0;
    let skippedUnpublished = 0;
    let skippedBanned = 0;
    this.entries = opts.games.filter((g) => {
      if (mapGameTypeToSceneKey(g.game_info.game_type) == null) {
        unknownType += 1;
        return false;
      }
      const availability = getGameAvailability(g.game_info);
      if (availability.playable) return true;
      if (availability.reason === "unpublished") skippedUnpublished += 1;
      else skippedBanned += 1;
      console.info(
        `[SequenceRunner] ข้ามเกม "${g.game_info.exercise_name}" (${g.game_info.uuid}): ${getGameUnplayableMessage(availability.reason)}`
      );
      return false;
    });
    if (unknownType > 0) {
      console.warn(`[SequenceRunner] ข้าม ${unknownType} เกมที่ไม่รู้จัก game_type`);
    }
    if (skippedUnpublished > 0) {
      console.info(`[SequenceRunner] ข้าม ${skippedUnpublished} เกมที่ยังไม่เผยแพร่`);
    }
    if (skippedBanned > 0) {
      console.info(`[SequenceRunner] ข้าม ${skippedBanned} เกมที่ถูกลบออกจากระบบ`);
    }
  }

  async start() {
    if (this.entries.length === 0) {
      console.warn("[SequenceRunner] ไม่มีเกมให้เล่น");
      this.opts.onAllFinished?.([]);
      return;
    }
    await this.runEntry(0);
  }

  /** Stop a scene even when paused/sleeping — isActive() alone can skip cleanup. */
  private stopSceneIfPresent(key: string) {
    const plugin = this.opts.game.scene;
    const sceneMap = plugin.keys as Record<string, Phaser.Scene | undefined>;
    if (!sceneMap[key]) return;
    plugin.stop(key);
  }

  private async runEntry(index: number) {
    if (index >= this.entries.length) {
      this.opts.onAllFinished?.(this.results);
      return;
    }

    this.opts.game.sound.stopAll();
    this.currentIndex = index;
    const entry = this.entries[index];
    const sceneKey = mapGameTypeToSceneKey(entry.game_info.game_type)!;
    const payload = toGamePayload(entry);

    await loadGameScene(this.opts.game, sceneKey);
    this.currentSceneKey = sceneKey;
    this.opts.onBeforeStartGame?.(sceneKey, payload, index);

    const exerciseNames = this.entries.map((e) => e.game_info.exercise_name);

    const scene = this.opts.game.scene.getScene(sceneKey);
    // listen scene จบ (ResultScene จะยิง event นี้กลับมาเมื่อกด next / replay ใน sequence mode)
    const onSequenceNext = (
      result?: SequenceResult & { showSequenceSummary?: boolean }
    ) => {
      const restart = result?.restartSequence === true;
      const showSummary = result?.showSequenceSummary === true;
      const replayCurrent = result?.replayCurrentGame === true;

      if (replayCurrent) {
        this.opts.game.sound.stopAll();
        this.stopSceneIfPresent("ResultScene");
        this.stopSceneIfPresent(sceneKey);
        void this.runEntry(this.currentIndex);
        return;
      }

      if (result) {
        const {
          restartSequence: _rs,
          replayCurrentGame: _rc,
          showSequenceSummary: _ss,
          ...rest
        } = result;
        const entryMeta = this.entries[this.currentIndex];
        this.results.push({
          ...rest,
          sceneKey,
          uuid_game_info: entryMeta?.game_info.uuid,
          exerciseName: entryMeta?.game_info.exercise_name,
        });
      } else {
        const entryMeta = this.entries[this.currentIndex];
        this.results.push({
          sceneKey,
          uuid_game_info: entryMeta?.game_info.uuid,
          exerciseName: entryMeta?.game_info.exercise_name,
        });
      }

      if (showSummary) {
        /** ปิด Result / เสียง — เก็บ scene เกมไว้ใต้หน้าสรุป (ไม่จอดำ) */
        this.opts.game.sound.stopAll();
        this.stopSceneIfPresent("ResultScene");
        this.stopSceneIfPresent("HomeScene");

        const exerciseNames = this.entries.map((e) => e.game_info.exercise_name);
        this.opts.game.scene.run("SequenceSummaryScene", {
          sequenceInfoExerciseName: this.sequenceInfoExerciseName,
          liveDashboardSequenceUuid: this.opts.liveDashboardSequenceUuid,
          exerciseNames,
          results: [...this.results],
          onReplay: () => {
            const finishedRun = [...this.results];
            this.opts.onAllFinished?.(finishedRun);
            this.stopSceneIfPresent("SequenceSummaryScene");
            this.stopSceneIfPresent(sceneKey);
            this.results = [];
            void this.runEntry(0);
          },
        });
        this.opts.game.scene.bringToTop("SequenceSummaryScene");
        if (this.opts.game.scene.isActive(sceneKey))
          this.opts.game.scene.pause(sceneKey);
        return;
      }

      /** หยุดเสียง/เพลงทั้งหมดของเกมก่อนหน้า — BGM ไม่ค้างเมื่อไปเกมถัดไปใน sequence */
      this.opts.game.sound.stopAll();

      this.stopSceneIfPresent(sceneKey);
      this.stopSceneIfPresent("ResultScene");
      this.stopSceneIfPresent("HomeScene");

      if (restart) {
        const finishedRun = [...this.results];
        this.opts.onAllFinished?.(finishedRun);
        this.results = [];
        void this.runEntry(0);
        return;
      }

      void this.runEntry(index + 1);
    };
    scene.events.once("sequence-next", onSequenceNext);

    this.opts.game.scene.start(sceneKey, {
      gameKey: sceneKey,
      payload,
      sequence: {
        index,
        total: this.entries.length,
        isSequence: true,
        exerciseNames,
        sequenceInfoExerciseName: this.sequenceInfoExerciseName,
        sequenceUuid: this.opts.sequenceUuid,
        liveDashboardSequenceUuid: this.opts.liveDashboardSequenceUuid,
      },
    });
  }

  getCurrentIndex() {
    return this.currentIndex;
  }

  getCurrentSceneKey() {
    return this.currentSceneKey;
  }
}
