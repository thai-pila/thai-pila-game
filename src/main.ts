import Phaser from "phaser";
import { HomeScene } from "./core/scenes/HomeScene";
import { ResultScene, type ResultSceneData } from "./core/scenes/ResultScene";
import { SequenceSummaryScene } from "./core/scenes/SequenceSummaryScene";
import { loadGameScene } from "./games/registry";
import { isMobileLayout } from "./utils/device";
import { getGameViewportSize } from "./utils/mobileLayout";
import {
  fetchRootPayload,
  type GameSceneKey,
  getGameAvailability,
  getGameUnplayableMessage,
  getGameUnplayableMessageHtml,
  isGamePlayable,
  mapGameTypeToSceneKey,
  QUERY_KEY_TO_GAME_SCENE,
  readUrlParams,
  toGamePayload,
  type GameSourcePayload,
  type RootPayload,
  type SequenceSourcePayload,
} from "./core/api";
import { SequenceRunner } from "./core/SequenceRunner";
import type { SequenceResult } from "./core/SequenceRunner";
import {
  registerAgentEnvironmentBootstrap,
  resolveAgentEnvironment,
} from "./core/agentEnvironment";
import { ensureNotoSansThaiLoopedReady } from "./utils/notoThaiFont";
import {
  DESKTOP_LAYOUT_HEIGHT,
  DESKTOP_LAYOUT_WIDTH,
} from "./utils/desktopUiScale";

// =============================================================
//  DEV — พรีวิวหน้า Result โดยไม่เล่นเกม:
//  ?debugResult=1&gameKey=flappy-bird&score=12&time=90&label=คะแนน
//  (optional: total=10)
//  ปุ่มเล่นอีกครั้งจะปิด Result เท่านั้น
// =============================================================

function runResultScenePreview(sp: URLSearchParams) {
  const gameKey = (sp.get("gameKey") ?? "flappy-bird").trim();
  const score = Math.max(0, Number(sp.get("score") ?? "12"));
  const time = Math.max(0, Number(sp.get("time") ?? "90"));
  const scoreLabel = (sp.get("label") ?? "จำนวนข้อที่ทำได้").trim() || "จำนวนข้อที่ทำได้";
  const totalRaw = sp.get("total");
  const totalParsed = totalRaw != null && totalRaw !== "" ? Number(totalRaw) : NaN;
  const total = Number.isFinite(totalParsed) ? Math.max(0, totalParsed) : undefined;

  const payload: ResultSceneData = {
    gameKey,
    score,
    time,
    scoreLabel,
    total,
    resultPreview: true,
  };

  setDocumentTitleByGameKey(gameKey);
  game.scene.start("ResultScene", payload);
}

// =============================================================
//  DEV — ปรับ UI หน้าสรุป sequence โดยไม่เล่นจนจบ:
//  เปิดในเบราว์เซอร์แบบนี้ →  ?seqSummary=1
//  (ข้อมูลจำลองใน runSequenceSummaryPreview แก้ได้ตามต้องการ)
// =============================================================

function runSequenceSummaryPreview() {
  const mockResults: SequenceResult[] = [
    { sceneKey: "flip-cards", score: 5, time: 20.43 },
    { sceneKey: "anagram", score: 20, time: 24.1 },
    { sceneKey: "whack-a-mole", score: 2, time: 50.1 },
  ];
  game.scene.start("SequenceSummaryScene", {
    sequenceInfoExerciseName: "ทดสอบsequence",
    exerciseNames: mockResults.map((_, i) => `เกม ${i + 1}`),
    results: mockResults,
    onReplay: () => {
      game.scene.stop("SequenceSummaryScene");
      console.log("[seqSummary preview] ปิดแล้ว — รีเฟรชหรือเปิดใหม่ด้วย ?seqSummary=1");
    },
  });
}

// =============================================================
//  DEV / FALLBACK CONFIG 
//  ถ้าเปิดผ่าน URL จริง (มี ?source=...&uuid=... หรือ /<source>/<uuid>)
// =============================================================

/** เลือกโหมดทดสอบเมื่อไม่มี URL params */
type DevFallbackSource = "game" | "sequence";
const DEV_FALLBACK_SOURCE: DevFallbackSource = "game"; // <-- เปลี่ยนเป็น "sequence" เพื่อทดสอบโหมดต่อเนื่อง

/** UUID ของแต่ละเกมย่อย (ใช้เมื่อ DEV_FALLBACK_SOURCE = "game") */
const DEV_FALLBACK_GAME_UUIDS: Record<string, string> = {
  // situation: "c2bc8915-e390-4e6b-bdf1-a202146676c7",
  situation: "290a8b82-ff7d-49f7-846c-0be2a0fa74a4",
  "whack-a-mole": "eaaa2c1b-8ac5-4a6d-8424-51b5a0d49997",
  "flip-cards": "c7fd2aab-2813-4f1e-a66e-0b2931d908e6",
  // "find-the-match": "2c0fce40-223a-4ed0-b55b-b040b72b714d",
  "find-the-match": "e84f9b96-408d-4487-8ce4-e290551094db",
  "anagram": "35a4f265-487b-4c54-a195-83838e79f354",
  "flying-fruits": "d1276cc1-bd9c-4d83-87cf-21e70fe5ba1e",
  "game-show-quiz": "2d449593-db27-44ca-a34f-3081bc4ba2ae",
  "flappy-bird": "21e1d787-49f5-49a3-9279-86538c4a5006",  // cb17a032-d93f-4b60-8d58-d83828810b10
  "complete-the-sentence": "b0589224-423b-4f49-a4c8-81b2d09fd19c",
};

/** เกมที่อยากทดสอบเมื่อ DEV_FALLBACK_SOURCE = "game" */
const DEV_FALLBACK_GAME_KEY: keyof typeof DEV_FALLBACK_GAME_UUIDS = "complete-the-sentence";
/** UUID ของ sequence (ใช้เมื่อ DEV_FALLBACK_SOURCE = "sequence") */
const DEV_FALLBACK_SEQUENCE_UUID = "0b42524d-c5df-4465-89ec-02c482b5ddb2";

// =============================================================
//  Phaser game bootstrap
// =============================================================

const mobile = isMobileLayout();
const dpr =
  typeof window !== "undefined" && typeof window.devicePixelRatio === "number"
    ? window.devicePixelRatio
    : 1;
/** มือถือ DPR มัก 2.5–3; จำกัดที่ 2 ทำให้ canvas เล็กกว่าจอ → FIT แล้วภาพ/ตัวหนังสือเบลอ */
const RENDER_RESOLUTION = Math.min(dpr, mobile ? 3 : 2);
const DEFAULT_TITLE = "THAI PILA GAME";
const GAME_TITLES: Record<string, string> = {
  "find-the-match": "THAI PILA GAME - FIND THE MATCH",
  situation: "THAI PILA GAME - SITUATION",
  "flip-cards": "THAI PILA GAME - FLIP CARDS",
  "whack-a-mole": "THAI PILA GAME - WHACK A MOLE",
  anagram: "THAI PILA GAME - ANAGRAM",
  "flappy-bird": "THAI PILA GAME - FLAPPY BIRD",
  "flying-fruits": "THAI PILA GAME - FLYING FRUITS",
  "game-show-quiz": "THAI PILA GAME - GAME SHOW QUIZ",
  "complete-the-sentence": "THAI PILA GAME - COMPLETE THE SENTENCE",
};
const DEFAULT_DESCRIPTION = "เล่นเกมแสนสนุกกับ THAI PILA GAME";
const FAVICON_PATH = "/assets/common/favicon_pilathailand.png";
const PAGE_BG_COLOR = "#bfeee5";

function blockCopyActions() {
  if (typeof document === "undefined") return;
  const prevent = (event: Event) => event.preventDefault();
  document.addEventListener("copy", prevent);
  document.addEventListener("cut", prevent);
  document.addEventListener("selectstart", prevent);
  document.addEventListener("contextmenu", prevent);
  document.addEventListener("keydown", (event: KeyboardEvent) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    const key = event.key.toLowerCase();
    if (key === "c" || key === "x" || key === "a") {
      event.preventDefault();
    }
  });
}

function applyPageStyles() {
  if (typeof document === "undefined") return;
  const html = document.documentElement;
  const body = document.body;
  html.style.width = "100%";
  html.style.height = "100%";
  html.style.margin = "0";
  html.style.overflow = "hidden";
  html.style.backgroundColor = PAGE_BG_COLOR;
  body.style.width = "100%";
  body.style.height = "100%";
  body.style.margin = "0";
  body.style.overflow = "hidden";
  body.style.backgroundColor = PAGE_BG_COLOR;
  body.style.touchAction = "none";
  body.style.overscrollBehavior = "none";

  const styleId = "thai-pila-game-viewport-style";
  if (!document.getElementById(styleId)) {
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      html, body {
        margin: 0;
        padding: 0;
        overflow: hidden;
        background: ${PAGE_BG_COLOR};
        min-height: 100vh;
        min-height: 100dvh;
      }
      canvas {
        display: block;
        background: ${PAGE_BG_COLOR};
      }
    `;
    document.head.appendChild(style);
  }
}

function applyGameCanvasStyles() {
  const canvas = game.canvas;
  if (!canvas) return;
  canvas.style.display = "block";
  canvas.style.backgroundColor = PAGE_BG_COLOR;
  const parent = canvas.parentElement;
  if (parent) {
    parent.style.backgroundColor = PAGE_BG_COLOR;
    parent.style.width = "100%";
    parent.style.height = "100%";
  }
}

function setDocumentTitleByGameKey(gameKey?: string) {
  if (typeof document === "undefined") return;
  const title = GAME_TITLES[gameKey ?? ""] ?? DEFAULT_TITLE;
  document.title = title;
  setSocialMeta({ title, description: DEFAULT_DESCRIPTION });
}

function getSceneOverrideFromQuery(): GameSceneKey | null {
  if (typeof window === "undefined") return null;
  const search = new URLSearchParams(window.location.search);
  for (const [queryKey, sceneKey] of QUERY_KEY_TO_GAME_SCENE) {
    if (search.has(queryKey)) return sceneKey;
  }
  return null;
}

function setMetaAttr(
  selector: string,
  attrName: "content" | "href",
  value: string
) {
  if (typeof document === "undefined") return;
  let element = document.querySelector(selector);
  if (!element) {
    if (selector.startsWith('meta[property="')) {
      const property = selector.slice('meta[property="'.length, -2);
      const meta = document.createElement("meta");
      meta.setAttribute("property", property);
      document.head.appendChild(meta);
      element = meta;
    } else if (selector.startsWith('meta[name="')) {
      const name = selector.slice('meta[name="'.length, -2);
      const meta = document.createElement("meta");
      meta.setAttribute("name", name);
      document.head.appendChild(meta);
      element = meta;
    } else if (selector === 'link[rel="icon"]') {
      const link = document.createElement("link");
      link.setAttribute("rel", "icon");
      link.setAttribute("type", "image/png");
      document.head.appendChild(link);
      element = link;
    }
  }
  if (!element) return;
  element.setAttribute(attrName, value);
}

function setSocialMeta({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  if (typeof window === "undefined") return;
  const shareUrl = window.location.href;
  const imageUrl = new URL(FAVICON_PATH, window.location.origin).toString();

  setMetaAttr('meta[property="og:title"]', "content", title);
  setMetaAttr('meta[property="og:description"]', "content", description);
  setMetaAttr('meta[property="og:image"]', "content", imageUrl);
  setMetaAttr('meta[property="og:url"]', "content", shareUrl);
  setMetaAttr('meta[name="twitter:title"]', "content", title);
  setMetaAttr('meta[name="twitter:description"]', "content", description);
  setMetaAttr('meta[name="twitter:image"]', "content", imageUrl);
  setMetaAttr('link[rel="icon"]', "href", FAVICON_PATH);
}

applyPageStyles();
const initialViewport = getGameViewportSize();

const config = {
  type: Phaser.AUTO,
  backgroundColor: PAGE_BG_COLOR,
  parent: document.body,
  dom: { createContainer: true },
  resolution: RENDER_RESOLUTION,
  autoRound: false,
  antialias: true,
  scale: mobile
    ? {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        width: initialViewport.width,
        height: initialViewport.height,
        expandParent: true,
      }
    : {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        width: DESKTOP_LAYOUT_WIDTH,
        height: DESKTOP_LAYOUT_HEIGHT,
        expandParent: true,
      },
  scene: [],
} as Phaser.Types.Core.GameConfig & { resolution: number };

const game = new Phaser.Game(config);
applyGameCanvasStyles();
game.scale.on(Phaser.Scale.Events.RESIZE, applyGameCanvasStyles);

if (mobile && typeof window !== "undefined") {
  const syncViewportScale = () => {
    const { width, height } = getGameViewportSize();
    if (width > 0 && height > 0) {
      game.scale.resize(width, height);
    }
  };
  window.addEventListener("resize", syncViewportScale);
  window.visualViewport?.addEventListener("resize", syncViewportScale);
  window.visualViewport?.addEventListener("scroll", syncViewportScale);
}
game.scene.add("HomeScene", HomeScene);
game.scene.add("ResultScene", ResultScene);
game.scene.add("SequenceSummaryScene", SequenceSummaryScene);

// =============================================================
//  Boot flow
//  1) อ่าน URL params → ถ้าครบใช้ของจริง
//  2) ถ้าไม่มี → ใช้ DEV_FALLBACK_*
//  3) ยิง API ตัวเดียวกัน (fetchRootPayload)
//  4) ถ้า source=game  → โหลดเกมตาม game_type แล้ว start
//     ถ้า source=sequence → ส่ง list เข้า SequenceRunner ให้เล่นต่อกันไปจนครบ
// =============================================================

(async () => {
  try {
    applyPageStyles();
    blockCopyActions();
    await ensureNotoSansThaiLoopedReady();
    if (typeof window !== "undefined") {
      const sp = new URLSearchParams(window.location.search);
      if (sp.get("seqSummary") === "1" || sp.get("debugSequenceSummary") === "1") {
        console.log(
          "[boot] โหมดพรีวิว SequenceSummaryScene — ไม่เรียก API / ไม่เล่นเกม (ปิดด้วยปุ่มเล่นใหม่หรือแก้โค้ด)"
        );
        runSequenceSummaryPreview();
        return;
      }
      if (sp.get("debugResult") === "1" || sp.get("resultPreview") === "1") {
        console.log(
          "[boot] พรีวิว ResultScene — ตัวอย่าง ?debugResult=1&gameKey=flappy-bird&score=12&time=90&label=คะแนน"
        );
        runResultScenePreview(sp);
        return;
      }
    }

    const { source: urlSource, uuid: urlUuid } = readUrlParams();

    let payload: RootPayload;
    if (urlSource && urlUuid) {
      console.log(`[boot] ใช้ค่าจาก URL → source=${urlSource}, uuid=${urlUuid}`);
      payload = await fetchRootPayload(urlSource, urlUuid);
    } else {
      // -------- DEV / FALLBACK --------
      if ((DEV_FALLBACK_SOURCE as DevFallbackSource) === "sequence") {
        console.log(
          `[boot] ไม่มี URL params → DEV fallback (sequence) uuid=${DEV_FALLBACK_SEQUENCE_UUID}`
        );
        payload = await fetchRootPayload("sequence", DEV_FALLBACK_SEQUENCE_UUID);
      } else {
        const devUuid = DEV_FALLBACK_GAME_UUIDS[DEV_FALLBACK_GAME_KEY];
        console.log(
          `[boot] ไม่มี URL params → DEV fallback (game=${DEV_FALLBACK_GAME_KEY}) uuid=${devUuid}`
        );
        payload = await fetchRootPayload("game", devUuid);
      }
    }

    const agentEnvBootstrap = await resolveAgentEnvironment();
    registerAgentEnvironmentBootstrap(game, agentEnvBootstrap, payload.source);

    if (payload.source === "sequence") {
      await runSequence(payload);
    } else {
      await runSingleGame(payload);
    }
  } catch (err) {
    console.error("[boot] โหลดข้อมูลเกมล้มเหลว", err);
    showBootError(err);
  }
})();

async function runSingleGame(payload: GameSourcePayload) {
  const availability = getGameAvailability(payload.game_info);
  if (!availability.playable) {
    showBootMessage(getGameUnplayableMessageHtml(availability.reason), true);
    return;
  }

  const sceneKey = getSceneOverrideFromQuery() ?? mapGameTypeToSceneKey(payload.game_info.game_type);
  if (!sceneKey) {
    throw new Error(`ไม่รู้จัก game_type: ${payload.game_info.game_type}`);
  }
  setDocumentTitleByGameKey(sceneKey);
  await loadGameScene(game, sceneKey);
  game.scene.start(sceneKey, { gameKey: sceneKey, payload });
}

async function runSequence(payload: SequenceSourcePayload) {
  setDocumentTitleByGameKey();
  const hasPlayableGame = payload.games.some(
    (g) => mapGameTypeToSceneKey(g.game_info.game_type) != null && isGamePlayable(g.game_info)
  );
  if (!hasPlayableGame) {
    showBootMessage("ไม่มีเกมที่เล่นได้ในลำดับนี้");
    return;
  }

  const sequenceUuid = payload.sequence_info.uuid_newgen ?? payload.sequence_info.uuid;
  /** live-dashboard ใช้ `sequence_info.uuid` เท่านั้น (ไม่ใช้ uuid_newgen) */
  const liveDashboardSequenceUuid = payload.sequence_info.uuid;
  const runner = new SequenceRunner({
    game,
    games: payload.games,
    sequenceInfoExerciseName: payload.sequence_info.exercise_name,
    sequenceUuid,
    liveDashboardSequenceUuid,
    onBeforeStartGame: (sceneKey, p, idx) => {
      setDocumentTitleByGameKey(sceneKey);
      console.log(
        `[sequence] เกม ${idx + 1}/${payload.games.length} → ${sceneKey} (${p.game_info.exercise_name})`
      );
    },
    onAllFinished: (results) => {
      console.log("[sequence] จบครบทุกเกมแล้ว", results);
      // TODO: ใส่หน้าสรุป sequence ตรงนี้ได้ในอนาคต
    },
  });
  await runner.start();
}

function showBootMessage(message: string, asHtml = false) {
  const div = document.createElement("div");
  div.style.cssText =
    "position:fixed;inset:0;display:flex;align-items:center;justify-content:center;color:#fff;background:#b02a37;font-family:'Noto Sans Thai',sans-serif;font-size:24px;line-height:1.5;text-align:center;padding:24px;z-index:99999;";
  if (asHtml) div.innerHTML = message;
  else div.textContent = message;
  document.body.appendChild(div);
}

function showBootError(_err: unknown) {
  showBootMessage("ไม่เจอเนื้อหาของเกม");
}

// อย่าลบ – เก็บไว้ในกรณีโค้ดอื่นอ้างถึง
export { game };

// keep references referenced (สำหรับการอ่านโค้ด)
void toGamePayload;
