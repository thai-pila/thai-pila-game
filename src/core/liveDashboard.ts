import { getAgentAuthSummary, shouldSkipKnowLearningAgentsFromUrl } from "./agentEnvironment";
import { API_BASE_URL } from "./api";

const LIVE_DASHBOARD_PATH = "live-dashboard";
const DEBUG_QUERY_KEY = "debugLiveDashboard";

declare global {
  interface Window {
    /** ผล POST live-dashboard ล่าสุด — ดูใน DevTools ได้ทันที */
    __eefLiveDashboardLastPost?: LiveDashboardDebugRecord;
  }
}

export type LiveDashboardDebugRecord = {
  at: string;
  kind: "game" | "sequence-batch";
  url: string;
  requestBody: unknown;
  sent: boolean;
  skipReason?: string;
  httpStatus?: number;
  ok?: boolean;
  responseBodyPreview?: string;
  error?: string;
};

function liveDashboardPostUrl(): string {
  const root = API_BASE_URL.replace(/\/?$/, "/");
  return new URL(LIVE_DASHBOARD_PATH, root).toString();
}

/** เปิดด้วย `?debugLiveDashboard=1` — log ละเอียด + ยัง POST ได้แม้อยู่ localhost / มี query */
function isLiveDashboardDebugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get(DEBUG_QUERY_KEY) === "1";
}

function shouldSkipLiveDashboardPost(): boolean {
  if (isLiveDashboardDebugEnabled()) return false;
  return shouldSkipKnowLearningAgentsFromUrl();
}

function setLiveDashboardDebugRecord(record: LiveDashboardDebugRecord): void {
  if (typeof window === "undefined") return;
  window.__eefLiveDashboardLastPost = record;
  // eslint-disable-next-line no-console -- debug การส่ง live-dashboard
  console.info("[live-dashboard] อัปเดต window.__eefLiveDashboardLastPost", record);
}

function logLiveDashboardSent(record: LiveDashboardDebugRecord): void {
  setLiveDashboardDebugRecord(record);
  // eslint-disable-next-line no-console -- debug การส่ง live-dashboard
  console.group(`[live-dashboard] ✓ ส่งข้อมูลแล้ว (${record.kind}) @ ${record.at}`);
  // eslint-disable-next-line no-console
  console.info("URL:", record.url);
  // eslint-disable-next-line no-console
  console.info("request body:", record.requestBody);
  // eslint-disable-next-line no-console
  console.info("HTTP:", record.httpStatus, record.ok ? "OK" : "FAILED");
  if (record.responseBodyPreview) {
    // eslint-disable-next-line no-console
    console.info("response preview:", record.responseBodyPreview);
  }
  // eslint-disable-next-line no-console
  console.groupEnd();
}

function logLiveDashboardSkipped(
  kind: LiveDashboardDebugRecord["kind"],
  skipReason: string,
  extra?: Record<string, unknown>
): void {
  const record: LiveDashboardDebugRecord = {
    at: new Date().toISOString(),
    kind,
    url: liveDashboardPostUrl(),
    requestBody: extra ?? null,
    sent: false,
    skipReason,
  };
  setLiveDashboardDebugRecord(record);
  // eslint-disable-next-line no-console -- debug การส่ง live-dashboard
  console.info(`[live-dashboard] ไม่ส่ง — ${skipReason}`, extra ?? {});
}

export type LiveDashboardPostInput = {
  resultPreview?: boolean;
  gameKey: string;
  score: number;
  time: number;
  liveDashboardGameUuid?: string;
  liveDashboardSequenceUuid?: string | null;
  /** เกมที่มีหัวใจ: ต้องเป็น true (เล่นจบครบข้อ) ถึงจะส่ง */
  liveDashboardFlappyPassed?: boolean;
};

export type LiveDashboardSequenceGameEntry = {
  uuid_game_info: string;
  score: string;
  time_sec: string;
};

export type LiveDashboardSequenceBatchInput = {
  sequenceUuid: string;
  entries: LiveDashboardSequenceGameEntry[];
};

/**
 * POST ผลไป live-dashboard ตามสัญญา API — เฉพาะเมื่อ URL ไม่มี query (?)
 * เกมที่มีหัวใจ: ส่งเฉพาะเมื่อ `liveDashboardFlappyPassed === true`
 *
 * Debug: ดู console prefix `[live-dashboard]` หรือ `window.__eefLiveDashboardLastPost`
 * เปิด log/POST บน dev: `?debugLiveDashboard=1`
 */
export function postLiveDashboardIfEligible(game: Phaser.Game, data: LiveDashboardPostInput): void {
  const logSkip = (reason: string, extra?: Record<string, unknown>) => {
    logLiveDashboardSkipped("game", reason, {
      gameKey: data.gameKey,
      score: data.score,
      time: data.time,
      liveDashboardGameUuid: data.liveDashboardGameUuid,
      liveDashboardSequenceUuid: data.liveDashboardSequenceUuid,
      search: typeof window !== "undefined" ? window.location.search : "",
      ...extra,
    });
  };

  if (isLiveDashboardDebugEnabled()) {
    // eslint-disable-next-line no-console -- debug การส่ง live-dashboard
    console.info("[live-dashboard] debug mode เปิดอยู่ (?debugLiveDashboard=1)", {
      gameKey: data.gameKey,
      payload: data,
    });
  }

  if (data.resultPreview === true) {
    logSkip("resultPreview");
    return;
  }
  if (shouldSkipLiveDashboardPost()) {
    logSkip("URL มี query (?…) หรือ hostname เป็น localhost/IP (dev) — ไม่ส่ง live-dashboard");
    return;
  }
  if (!data.liveDashboardGameUuid) {
    logSkip("ไม่มี liveDashboardGameUuid (game_info.uuid)");
    return;
  }

  if (
    (data.gameKey === "flappy-bird" ||
      data.gameKey === "find-the-match" ||
      data.gameKey === "flying-fruits" ||
      data.gameKey === "game-show-quiz" ||
      data.gameKey === "complete-the-sentence") &&
    data.liveDashboardFlappyPassed !== true
  ) {
    logSkip(`${data.gameKey} ยังไม่ผ่านครบข้อ (liveDashboardFlappyPassed !== true)`);
    return;
  }

  const auth = getAgentAuthSummary(game);
  if (!auth?.studentUserUuid || !auth.providerUuid) {
    // eslint-disable-next-line no-console -- debug การส่ง live-dashboard
    console.warn("[live-dashboard] ไม่ส่ง — ไม่มี auth จาก Agent (ต้องมี student + provider)", {
      gameKey: data.gameKey,
      hasStudent: !!auth?.studentUserUuid,
      hasProvider: !!auth?.providerUuid,
    });
    return;
  }

  const body = {
    teacher_uuid: auth.providerUuid,
    student_uuid: auth.studentUserUuid,
    student_name: auth.studentDisplayName ?? "",
    uuid_sequence_info: data.liveDashboardSequenceUuid ?? null,
    uuid_game_info: data.liveDashboardGameUuid,
    game_information: {
      score: Math.round(Number(data.score) || 0),
      time_sec: Math.max(0, Math.round(Number(data.time) || 0)),
    },
  };

  const url = liveDashboardPostUrl();
  const sentAt = new Date().toISOString();
  // eslint-disable-next-line no-console -- debug การส่ง live-dashboard
  console.info("[live-dashboard] กำลัง POST …", { url, body, sentAt });

  void fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
    .then(async (res) => {
      const snippet = await res.text().catch(() => "");
      const responseBodyPreview = snippet ? snippet.slice(0, 400) : "(ว่าง)";
      if (res.ok) {
        logLiveDashboardSent({
          at: sentAt,
          kind: "game",
          url,
          requestBody: body,
          sent: true,
          httpStatus: res.status,
          ok: true,
          responseBodyPreview,
        });
        return;
      }
      const record: LiveDashboardDebugRecord = {
        at: sentAt,
        kind: "game",
        url,
        requestBody: body,
        sent: true,
        httpStatus: res.status,
        ok: false,
        responseBodyPreview,
      };
      setLiveDashboardDebugRecord(record);
      // eslint-disable-next-line no-console -- debug การส่ง live-dashboard
      console.warn("[live-dashboard] HTTP ไม่สำเร็จ (ส่ง request แล้ว แต่ server ตอบ error)", record);
    })
    .catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      setLiveDashboardDebugRecord({
        at: sentAt,
        kind: "game",
        url,
        requestBody: body,
        sent: false,
        error: message,
      });
      // eslint-disable-next-line no-console -- debug การส่ง live-dashboard
      console.warn("[live-dashboard] POST ล้มเหลว (เครือข่าย / throw)", err);
    });
}

/**
 * POST ผลรวม sequence — endpoint เดียวกับเกมเดี่ยว แต่ `uuid_game_info: null` และ `game_information` เป็น array
 */
export function postLiveDashboardSequenceBatch(
  game: Phaser.Game,
  data: LiveDashboardSequenceBatchInput
): void {
  const logSkip = (reason: string) => {
    logLiveDashboardSkipped("sequence-batch", reason, {
      sequenceUuid: data.sequenceUuid,
      entryCount: data.entries.length,
      entries: data.entries,
    });
  };

  if (isLiveDashboardDebugEnabled()) {
    // eslint-disable-next-line no-console -- debug การส่ง live-dashboard
    console.info("[live-dashboard] debug mode เปิดอยู่ (?debugLiveDashboard=1)", {
      sequenceUuid: data.sequenceUuid,
      entryCount: data.entries.length,
    });
  }

  if (shouldSkipLiveDashboardPost()) {
    logSkip("URL มี query (?…) หรือ hostname เป็น localhost/IP (dev)");
    return;
  }
  if (!data.sequenceUuid) {
    logSkip("ไม่มี sequenceUuid");
    return;
  }
  if (data.entries.length === 0) {
    logSkip("ไม่มีรายการเกม");
    return;
  }

  const auth = getAgentAuthSummary(game);
  if (!auth?.studentUserUuid || !auth.providerUuid) {
    // eslint-disable-next-line no-console -- debug การส่ง live-dashboard
    console.warn("[live-dashboard] ไม่ส่ง sequence batch — ไม่มี auth จาก Agent", {
      hasStudent: !!auth?.studentUserUuid,
      hasProvider: !!auth?.providerUuid,
    });
    return;
  }

  const body = {
    teacher_uuid: auth.providerUuid,
    student_uuid: auth.studentUserUuid,
    student_name: auth.studentDisplayName ?? "",
    uuid_sequence_info: data.sequenceUuid,
    uuid_game_info: null,
    game_information: data.entries,
  };

  const url = liveDashboardPostUrl();
  const sentAt = new Date().toISOString();
  // eslint-disable-next-line no-console -- debug การส่ง live-dashboard
  console.info("[live-dashboard] กำลัง POST sequence batch …", { url, body, sentAt });

  void fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
    .then(async (res) => {
      const snippet = await res.text().catch(() => "");
      const responseBodyPreview = snippet ? snippet.slice(0, 400) : "(ว่าง)";
      if (res.ok) {
        logLiveDashboardSent({
          at: sentAt,
          kind: "sequence-batch",
          url,
          requestBody: body,
          sent: true,
          httpStatus: res.status,
          ok: true,
          responseBodyPreview,
        });
        return;
      }
      const record: LiveDashboardDebugRecord = {
        at: sentAt,
        kind: "sequence-batch",
        url,
        requestBody: body,
        sent: true,
        httpStatus: res.status,
        ok: false,
        responseBodyPreview,
      };
      setLiveDashboardDebugRecord(record);
      // eslint-disable-next-line no-console -- debug การส่ง live-dashboard
      console.warn("[live-dashboard] sequence batch HTTP ไม่สำเร็จ (ส่ง request แล้ว แต่ server ตอบ error)", record);
    })
    .catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      setLiveDashboardDebugRecord({
        at: sentAt,
        kind: "sequence-batch",
        url,
        requestBody: body,
        sent: false,
        error: message,
      });
      // eslint-disable-next-line no-console -- debug การส่ง live-dashboard
      console.warn("[live-dashboard] sequence batch POST ล้มเหลว", err);
    });
}
