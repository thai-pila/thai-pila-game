import Phaser from "phaser";
import { isMobileLayout } from "../../utils/device";
import { hideSequenceHudDom } from "../../utils/sequenceHudDom";
import {
  createThaiTextElement,
  createThaiTextSpan,
} from "../../utils/thaiText";
import type { SequenceResult } from "../SequenceRunner";
import { postLiveDashboardSequenceBatch } from "../liveDashboard";

export type SequenceSummarySceneData = {
  sequenceInfoExerciseName?: string;
  /** `sequence_info.uuid` เท่านั้น — ส่ง live-dashboard batch */
  liveDashboardSequenceUuid?: string;
  exerciseNames: string[];
  results: SequenceResult[];
  onReplay: () => void;
};

/** จำนวนแถวใน viewport  */
const VISIBLE_ROW_SLOTS = 3;

 
const SUMMARY_TEXT_COLOR = "#45C7F4";

 
const SEQUENCE_TITLE_TOP_RATIO = 0.15;
 
const TITLE_TO_LIST_GAP_RATIO = 0.006;
 
const TITLE_TO_LIST_PULL_UP_S = 26;
 
const LIST_TO_TOTALS_GAP_RATIO = 0.022;
 
const TOTALS_SECTION_TOP_PAD_S = 6;
 
const TIME_BOX_TO_REPLAY_GAP_RATIO = 0.1;

/** ความกว้างโซนรายการเทียบการ์ด — แถบเลื่อนอยู่ใน gutter ทางขวา ไม่ทับกล่อง */
const LIST_TOTAL_WIDTH_RATIO = 0.84;
/** เว้นขวาให้ scrollbar (px × scale) เมื่อมีการเลื่อน */
const LIST_SCROLL_GUTTER_S = 15;
/** ความไวเลื่อนล้อ — ค่าสูง = เลื่อนง่ายขึ้น */
const LIST_WHEEL_SCROLL_FACTOR = 1.05;
/** คูณ WheelEvent.deltaY บน DOM รายการ (โฟลว์ HTML เหนือแคนวาส — Phaser ไม่ได้รับ wheel) */
const LIST_DOM_WHEEL_MULTIPLIER = 0.42;
/** ความกว้างแทร็ก/thumb แนวตั้ง */
const SCROLLBAR_TRACK_W = 7;

/** ความกว้างปุ่ม `seq_summary_replay` เทียบกับความกว้างการ์ด — ลดตัวเลข = ปุ่มเล็กลง (ความสูงคำนวณตามสัดส่วนภาพ) */
const REPLAY_BTN_WIDTH_RATIO_MOBILE = 0.5;
const REPLAY_BTN_WIDTH_RATIO_DESKTOP = 0.6;

function formatWholeSeconds(sec: number): string {
  const safe = Math.max(0, Math.floor(sec));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${s.toString().padStart(2, "0")} นาที`;
}

export class SequenceSummaryScene extends Phaser.Scene {
  private liveDashboardPosted = false;

  constructor() {
    super("SequenceSummaryScene");
  }

  preload() {
    this.load.image("seq_summary_bg", "assets/result/result_sq_bg.png");
    this.load.image("seq_summary_replay", "assets/result/replay_btn.png");
    this.load.image("seq_summary_box", "assets/result/box.png");
  }

  create(data: SequenceSummarySceneData) {
    hideSequenceHudDom();
    this.postSequenceLiveDashboardOnce(data);

    const buildLayout = () => {
      const { width, height } = this.scale;
      const mobile = isMobileLayout();
      const seqTitle = (data.sequenceInfoExerciseName ?? "").trim() || "ลำดับเกม";
      const n = Math.min(data.exerciseNames.length, data.results.length);
      const rows: Array<{
        label: string;
        score: number;
        total?: number;
        timeSec: number;
      }> = [];
      for (let i = 0; i < n; i += 1) {
        const r = data.results[i];
        rows.push({
          label: `เกมที่ ${i + 1}`,
          score: r.score ?? 0,
          total: r.total,
          timeSec: r.time ?? 0,
        });
      }

      const totalScore = data.results.reduce((s, r) => s + (r.score ?? 0), 0);
      const totalTimeSec = data.results.reduce((s, r) => s + (r.time ?? 0), 0);

      this.cameras.main.setScroll(0, 0);
      this.cameras.main.setBackgroundColor("rgba(0,0,0,0)");

      const tex = this.textures.get("seq_summary_bg").getSourceImage() as HTMLImageElement;
      const texW = tex?.naturalWidth || tex?.width || 400;
      const texH = tex?.naturalHeight || tex?.height || 700;
      const maxCardWByHeight = height * 0.92 * (texW / texH);
      const targetCardW = mobile ? width * 0.94 : width * 0.86;
      const maxCardW = mobile ? 560 : 440;
      const cardW = Math.min(targetCardW, maxCardW, maxCardWByHeight);
      const cardH = (texH / texW) * cardW;
      const cx = width / 2;
      const cy = height / 2;
      const cardTop = cy - cardH / 2;
      const s = cardW / (mobile ? 460 : 400);

      const panelObjects: Phaser.GameObjects.GameObject[] = [];
      const addToPanel = <T extends Phaser.GameObjects.GameObject>(obj: T): T => {
        panelObjects.push(obj);
        return obj;
      };

      addToPanel(
        this.add
          .image(cx, cy, "seq_summary_bg")
          .setDisplaySize(cardW, cardH)
          .setDepth(11)
      );

      /** ชื่อ sequence — วัดจากขอบบนการ์ดถึงขอบบนกล่องข้อความ (ไม่ใช่จุดกึ่งกลาง) */
      const titleH = Math.max(56, cardH * 0.12);
      const titleTopRatio = Phaser.Math.Clamp(SEQUENCE_TITLE_TOP_RATIO, 0.04, 0.42);
      const titleTop = cardTop + cardH * titleTopRatio;
      const titleY = titleTop + titleH / 2;
      const titleDiv = createThaiTextElement(seqTitle, {
        width: cardW * 0.88,
        height: titleH,
        fontSize: `${Math.round(17 * s)}px`,
        color: SUMMARY_TEXT_COLOR,
        align: "center",
        maxLines: 2,
        minFontSizePx: Math.round(12 * s),
      });
      titleDiv.style.pointerEvents = "none";
      /** depth สูงกว่ารายการ (14) — ปรับตำแหน่งชื่อแล้วจะไม่ถูกบังโดยแถบรายการ */
      addToPanel(
        this.add.dom(cx, titleY, titleDiv).setOrigin(0.5, 0.5).setDepth(15)
      );

      const rowH = Math.round(44 * s);
      const rowGap = Math.round(8 * s);
      const listViewportH = VISIBLE_ROW_SLOTS * rowH + (VISIBLE_ROW_SLOTS - 1) * rowGap;
      const listTotalW = cardW * LIST_TOTAL_WIDTH_RATIO;
      const listLeft = cx - listTotalW / 2;
      const listTop =
        titleY +
        titleH / 2 +
        cardH * TITLE_TO_LIST_GAP_RATIO -
        Math.round(TITLE_TO_LIST_PULL_UP_S * s);

      const contentH = rows.length * rowH + Math.max(0, rows.length - 1) * rowGap;
      const maxScroll = Math.max(0, contentH - listViewportH);
      const listScrollGutter = maxScroll > 0 ? Math.round(LIST_SCROLL_GUTTER_S * s) : 0;
      const listW = listTotalW - listScrollGutter;

      const maskG = this.add.graphics().setDepth(14).setVisible(false);
      maskG.fillStyle(0xffffff, 1);
      maskG.fillRoundedRect(listLeft, listTop, listW, listViewportH, 8);
      const geomMask = maskG.createGeometryMask();

      const listClip = this.add.container(listLeft, listTop).setDepth(14).setMask(geomMask);
      const listInner = this.add.container(0, 0);
      listClip.add(listInner);

      rows.forEach((row, i) => {
        const y = i * (rowH + rowGap) + rowH / 2;
        listInner.add(
          this.add
            .image(listW / 2, y, "seq_summary_box")
            .setDisplaySize(listW, rowH)
            .setDepth(13)
        );
      });

      /**
       * ข้อความแถวละเกม — รวมใน div overflow:hidden เพราะ Phaser DOM ไม่ถูก geometry mask ตัด
       * (ถ้า add.dom ทีละแถวใน listInner จะเห็นครบทุกแถวแม้ VISIBLE_ROW_SLOTS จะเป็น 2)
       */
      const clipOuter = document.createElement("div");
      clipOuter.style.cssText = [
        "overflow:hidden",
        `width:${listW}px`,
        `height:${listViewportH}px`,
        "position:relative",
        "margin:0",
        "padding:0",
        "box-sizing:border-box",
        "pointer-events:none",
      ].join(";");
      const clipInner = document.createElement("div");
      clipInner.style.cssText = [
        "position:absolute",
        "left:0",
        "top:0",
        "width:100%",
        "margin:0",
        "padding:0",
        "pointer-events:none",
        "will-change:transform",
      ].join(";");
      rows.forEach((row, i) => {
        const top = i * (rowH + rowGap);
        const scoreStr =
          row.total != null && row.total > 0
            ? `${row.score}/${row.total} ข้อ`
            : `${row.score} ข้อ`;
        const timeStr = formatWholeSeconds(row.timeSec);
        const rowWrap = document.createElement("div");
        rowWrap.style.cssText = [
          "position:absolute",
          "left:0",
          `top:${top}px`,
          `width:100%`,
          `height:${rowH}px`,
          "display:grid",
          "grid-template-columns:1fr 1.15fr 1fr",
          "align-items:center",
          `column-gap:${Math.round(6 * s)}px`,
          `padding:0 ${Math.round(listW * 0.04)}px`,
          "box-sizing:border-box",
        ].join(";");

        const labelDiv = createThaiTextSpan(row.label, {
          fontSizePx: Math.round(14 * s),
          color: SUMMARY_TEXT_COLOR,
          fontWeight: 700,
          pointerEventsNone: true,
        });
        const scoreDiv = createThaiTextSpan(scoreStr, {
          fontSizePx: Math.round(14 * s),
          color: SUMMARY_TEXT_COLOR,
          fontWeight: 500,
          textAlign: "center",
          maxWidthPx: listW * 0.36,
          pointerEventsNone: true,
        });
        const timeDiv = createThaiTextSpan(timeStr, {
          fontSizePx: Math.round(13 * s),
          color: SUMMARY_TEXT_COLOR,
          fontWeight: 500,
          textAlign: "right",
          maxWidthPx: listW * 0.32,
          pointerEventsNone: true,
        });
        rowWrap.appendChild(labelDiv);
        rowWrap.appendChild(scoreDiv);
        rowWrap.appendChild(timeDiv);
        clipInner.appendChild(rowWrap);
      });
      clipOuter.appendChild(clipInner);

      addToPanel(
        this.add
          .dom(listLeft + listW / 2, listTop + listViewportH / 2, clipOuter)
          .setOrigin(0.5, 0.5)
          .setDepth(15)
      );

      let scrollY = 0;
      const applyScroll = (next: number) => {
        scrollY = Phaser.Math.Clamp(next, -maxScroll, 0);
        listInner.setY(scrollY);
        clipInner.style.transform = `translateY(${scrollY}px)`;
      };
      applyScroll(0);

      let thumb: Phaser.GameObjects.Rectangle | null = null;
      let scrollTrack: Phaser.GameObjects.Rectangle | null = null;
      let hitZone: Phaser.GameObjects.Rectangle | undefined;
      const trackCenterXForThumb =
        maxScroll > 0 ? listLeft + listW + listScrollGutter / 2 : listLeft + listW / 2;
      const updateThumb = () => {
        if (!thumb || maxScroll <= 0) return;
        thumb.setX(trackCenterXForThumb);
        const thumbRange = listViewportH - thumb.height;
        const t = maxScroll > 0 ? -scrollY / maxScroll : 0;
        thumb.setY(listTop + thumb.height / 2 + t * thumbRange);
      };

      if (maxScroll > 0) {
        const trackW = SCROLLBAR_TRACK_W;
        const trackPad = 4;
        const trackCenterX = listLeft + listW + listScrollGutter / 2;
        scrollTrack = this.add
          .rectangle(
            trackCenterX,
            listTop + listViewportH / 2,
            trackW + trackPad * 2,
            listViewportH,
            0x29b6f6,
            0.2
          )
          .setDepth(14)
          .setStrokeStyle(1, 0x45c7f4, 0.35);
        const thumbH = Math.max(
          28,
          (listViewportH / contentH) * listViewportH
        );
        thumb = this.add
          .rectangle(trackCenterX, listTop + thumbH / 2, trackW, thumbH, 0x45c7f4, 0.85)
          .setDepth(15)
          .setStrokeStyle(1, 0x29b6f6);
        updateThumb();

        hitZone = this.add
          .rectangle(
            listLeft + listW / 2,
            listTop + listViewportH / 2,
            listW,
            listViewportH,
            0x000000,
            0
          )
          .setDepth(16)
          .setInteractive();

        let listDragLastY = 0;
        let listDragging = false;
        hitZone.on("pointerdown", (p: Phaser.Input.Pointer) => {
          listDragging = true;
          listDragLastY = p.worldY;
        });

        let thumbDragLastY = 0;
        let thumbDragging = false;
        thumb
          .setInteractive({ useHandCursor: true, draggable: false })
          .setDepth(17);
        thumb.on("pointerdown", (p: Phaser.Input.Pointer) => {
          thumbDragging = true;
          thumbDragLastY = p.worldY;
          listDragging = false;
        });

        scrollTrack
          .setInteractive({ useHandCursor: true })
          .setDepth(16);
        scrollTrack.on("pointerdown", (p: Phaser.Input.Pointer) => {
          const thumbRange = listViewportH - thumb!.height;
          const localY = Phaser.Math.Clamp(p.y - listTop, 0, listViewportH);
          const t = thumbRange > 0 ? Phaser.Math.Clamp((localY - thumb!.height / 2) / thumbRange, 0, 1) : 0;
          applyScroll(-t * maxScroll);
          updateThumb();
          thumbDragging = true;
          thumbDragLastY = p.worldY;
          listDragging = false;
        });

        const onGlobalPointerUp = () => {
          listDragging = false;
          thumbDragging = false;
        };
        const onGlobalMove = (p: Phaser.Input.Pointer) => {
          if (!p.isDown) return;
          if (thumbDragging) {
            const dy = p.worldY - thumbDragLastY;
            thumbDragLastY = p.worldY;
            applyScroll(scrollY - dy);
            updateThumb();
            return;
          }
          if (!listDragging) return;
          const dy = p.worldY - listDragLastY;
          listDragLastY = p.worldY;
          applyScroll(scrollY + dy);
          updateThumb();
        };
        this.input.on("pointermove", onGlobalMove);
        this.input.on("pointerup", onGlobalPointerUp);
        this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
          this.input.off("pointermove", onGlobalMove);
          this.input.off("pointerup", onGlobalPointerUp);
        });

        /** DOM รายการอยู่เหนือแคนวาส — ต้องจับ wheel/pointer ที่ clipOuter ถึงจะเลื่อนเมื่อเมาส์อยู่บนแถว */
        clipOuter.style.pointerEvents = "auto";
        clipOuter.style.touchAction = "none";
        clipOuter.style.cursor = "grab";

        const onListWheelDom = (ev: WheelEvent) => {
          ev.preventDefault();
          ev.stopPropagation();
          applyScroll(scrollY - ev.deltaY * LIST_DOM_WHEEL_MULTIPLIER);
          updateThumb();
        };
        let listDomDragging = false;
        let listDomLastClientY = 0;
        const onListPointerDown = (ev: PointerEvent) => {
          listDomDragging = true;
          listDomLastClientY = ev.clientY;
          try {
            clipOuter.setPointerCapture(ev.pointerId);
          } catch {
            /* ignore */
          }
          clipOuter.style.cursor = "grabbing";
        };
        const onListPointerMove = (ev: PointerEvent) => {
          if (!listDomDragging) return;
          const dy = ev.clientY - listDomLastClientY;
          listDomLastClientY = ev.clientY;
          applyScroll(scrollY + dy);
          updateThumb();
        };
        const onListPointerEnd = (ev: PointerEvent) => {
          listDomDragging = false;
          try {
            clipOuter.releasePointerCapture(ev.pointerId);
          } catch {
            /* ignore */
          }
          clipOuter.style.cursor = "grab";
        };
        clipOuter.addEventListener("wheel", onListWheelDom, { passive: false });
        clipOuter.addEventListener("pointerdown", onListPointerDown);
        clipOuter.addEventListener("pointermove", onListPointerMove);
        clipOuter.addEventListener("pointerup", onListPointerEnd);
        clipOuter.addEventListener("pointercancel", onListPointerEnd);

        this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
          clipOuter.removeEventListener("wheel", onListWheelDom);
          clipOuter.removeEventListener("pointerdown", onListPointerDown);
          clipOuter.removeEventListener("pointermove", onListPointerMove);
          clipOuter.removeEventListener("pointerup", onListPointerEnd);
          clipOuter.removeEventListener("pointercancel", onListPointerEnd);
        });
      }

      const wheelHandler = (
        _pointer: Phaser.Input.Pointer,
        _go: Phaser.GameObjects.GameObject[],
        _dx: number,
        dy: number
      ) => {
        if (maxScroll <= 0) return;
        const p = this.input.activePointer;
        if (
          p.x < listLeft ||
          p.x > listLeft + listTotalW ||
          p.y < listTop ||
          p.y > listTop + listViewportH
        ) {
          return;
        }
        applyScroll(scrollY - dy * LIST_WHEEL_SCROLL_FACTOR);
        updateThumb();
      };
      this.input.on("wheel", wheelHandler);
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
        this.input.off("wheel", wheelHandler);
      });

      const totalsTop = listTop + listViewportH + cardH * LIST_TO_TOTALS_GAP_RATIO;
      const boxW = cardW * (mobile ? 0.72 : 0.62);
      const boxH = Math.round(46 * s);
      /** ระยะจากจุดกึ่งกลางป้ายข้อความถึงขอบบนกล่อง — ต้องมากกว่า boxH/2 + ครึ่งสูงป้าย ไม่ให้ทับพื้นฟ้า */
      const labelHalfApprox = Math.round(10 * s);
      const gapLabelToPill = Math.round(9 * s);

      const totalScoreY = totalsTop + TOTALS_SECTION_TOP_PAD_S * s;
      addToPanel(
        this.add
          .dom(
            cx,
            totalScoreY,
            createThaiTextSpan("จำนวนข้อที่ทำได้ทั้งหมด", {
              fontSizePx: Math.round(15 * s),
              color: SUMMARY_TEXT_COLOR,
              fontWeight: 500,
              textAlign: "center",
              pointerEventsNone: true,
            })
          )
          .setOrigin(0.5)
          .setDepth(12)
      );
      const scoreBoxY = totalScoreY + labelHalfApprox + gapLabelToPill + boxH / 2;
      addToPanel(
        this.add
          .image(cx, scoreBoxY, "seq_summary_box")
          .setDisplaySize(boxW, boxH)
          .setDepth(12)
      );
      addToPanel(
        this.add
          .dom(
            cx,
            scoreBoxY,
            createThaiTextSpan(`${totalScore} ข้อ`, {
              fontSizePx: Math.round(20 * s),
              color: SUMMARY_TEXT_COLOR,
              fontWeight: 700,
              textAlign: "center",
              pointerEventsNone: true,
            })
          )
          .setOrigin(0.5)
          .setDepth(13)
      );

      const totalTimeLabelY =
        scoreBoxY + boxH / 2 + gapLabelToPill + labelHalfApprox;
      addToPanel(
        this.add
          .dom(
            cx,
            totalTimeLabelY,
            createThaiTextSpan("เวลาทั้งหมด", {
              fontSizePx: Math.round(15 * s),
              color: SUMMARY_TEXT_COLOR,
              fontWeight: 500,
              textAlign: "center",
              pointerEventsNone: true,
            })
          )
          .setOrigin(0.5)
          .setDepth(12)
      );
      const timeBoxY = totalTimeLabelY + labelHalfApprox + gapLabelToPill + boxH / 2;
      addToPanel(
        this.add
          .image(cx, timeBoxY, "seq_summary_box")
          .setDisplaySize(boxW, boxH)
          .setDepth(12)
      );
      addToPanel(
        this.add
          .dom(
            cx,
            timeBoxY,
            createThaiTextSpan(formatWholeSeconds(totalTimeSec), {
              fontSizePx: Math.round(18 * s),
              color: SUMMARY_TEXT_COLOR,
              fontWeight: 700,
              textAlign: "center",
              pointerEventsNone: true,
            })
          )
          .setOrigin(0.5)
          .setDepth(13)
      );

      const btnW =
        cardW * (mobile ? REPLAY_BTN_WIDTH_RATIO_MOBILE : REPLAY_BTN_WIDTH_RATIO_DESKTOP);
      const rpTex = this.textures.get("seq_summary_replay").getSourceImage() as HTMLImageElement;
      const rpTexW = rpTex?.naturalWidth || rpTex?.width || 200;
      const rpTexH = rpTex?.naturalHeight || rpTex?.height || 80;
      const replayBtnH = (rpTexH / rpTexW) * btnW;
      let btnY = timeBoxY + boxH / 2 + cardH * TIME_BOX_TO_REPLAY_GAP_RATIO;
      const bottomLimit = cardTop + cardH - cardH * 0.04;
      if (btnY + replayBtnH / 2 > bottomLimit) {
        btnY = bottomLimit - replayBtnH / 2;
      }

      const replayBtn = addToPanel(
        this.add
          .image(cx, btnY, "seq_summary_replay")
          .setDisplaySize(btnW, replayBtnH)
          .setDepth(12)
          .setInteractive({ useHandCursor: true })
      );

      replayBtn.on("pointerdown", () => {
        replayBtn.disableInteractive();
        data.onReplay();
      });

      const enterOffsetY = mobile ? -100 : -120;
      panelObjects.forEach((obj) => {
        const target = obj as unknown as { y: number; alpha: number };
        target.y += enterOffsetY;
        target.alpha = 0;
      });
      listClip.y += enterOffsetY;
      maskG.y += enterOffsetY;
      if (thumb) thumb.y += enterOffsetY;
      if (scrollTrack) scrollTrack.y += enterOffsetY;
      if (hitZone) hitZone.y += enterOffsetY;

      const slideTargets: Phaser.GameObjects.GameObject[] = [listClip, maskG];
      if (scrollTrack) slideTargets.push(scrollTrack);
      if (thumb) slideTargets.push(thumb);
      if (hitZone) slideTargets.push(hitZone);

      this.tweens.add({
        targets: panelObjects,
        y: `+=${Math.abs(enterOffsetY)}`,
        alpha: 1,
        duration: 560,
        ease: "Cubic.easeOut",
        stagger: 12,
      });
      this.tweens.add({
        targets: slideTargets,
        y: `+=${Math.abs(enterOffsetY)}`,
        duration: 560,
        ease: "Cubic.easeOut",
      });
    };

    if (typeof document !== "undefined" && document.fonts?.ready) {
      void document.fonts.ready.then(buildLayout);
    } else {
      buildLayout();
    }
  }

  private postSequenceLiveDashboardOnce(data: SequenceSummarySceneData) {
    if (this.liveDashboardPosted) return;
    this.liveDashboardPosted = true;

    const sequenceUuid = (data.liveDashboardSequenceUuid ?? "").trim();
    if (!sequenceUuid) return;

    const entries = data.results
      .filter((r) => (r.uuid_game_info ?? "").trim().length > 0)
      .map((r) => ({
        uuid_game_info: (r.uuid_game_info ?? "").trim(),
        score: String(Math.round(Number(r.score) || 0)),
        time_sec: String(Math.max(0, Math.round(Number(r.time) || 0))),
      }));

    postLiveDashboardSequenceBatch(this.game, { sequenceUuid, entries });
  }
}
