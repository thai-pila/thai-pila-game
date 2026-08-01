/**
 * Agent runstate — ส่งสถานะการเล่นไป @knowlearning/agents โดยใช้ scope:
 *  - `runstate-{sequenceUuid}` ถ้าเล่นแบบ sequence
 *  - `runstate-{gameUuid}`     ถ้าเล่นแบบเกมเดี่ยว
 *
 * Trigger 3 จุด: เริ่มเกม / ตอบถูกจนเปลี่ยนข้อ / จบเกม
 * sequence: ระหว่างเล่น `games` มีแค่เกมปัจจุบัน 1 รายการ
 *          ตอน `allend` ส่ง `summarySequence` = เกมที่จบแล้วก่อนหน้า (เช่น 5 เกม → เกม 1–4)
 * เกมเดี่ยว: `games` มีเกมเดียวใน scope นั้น
 *
 * ใช้ผ่าน `BaseGameScene.reportRunstate*()` — ไม่ต้องเรียกตรง
 *
 * โหมด dev (localhost / URL มี `?…`): จำลอง state ในหน่วยความจำ + log `[runstate · dry-run]`
 * ไม่ส่งเข้า @knowlearning/agents — ดู `window.__eefRunstateLast` ใน DevTools
 */
import type Phaser from "phaser";
import { shouldSkipKnowLearningAgentsFromUrl, getAgentAuthSummary, isKnowLearningAgentDevHostname } from "./agentEnvironment";

export const RUNSTATE_DASHBOARD_REF = "https://thaipilacreate.eef.or.th/live-monitor";

export type RunstatePhase = "start" | "allstart" | "progress" | "end" | "allend";
export type RunstateSource = "game" | "sequence";

export type AgentRunstateEntry = {
  studentUuid?: string;
  studentName?: string;
  gameKey: string;
  gameUuid?: string;
  /** sequence index (0-based) ของเกมปัจจุบัน */
  gameIndex?: number;
  startDate: string;
  updateDate: string;
  score: number;
  current: number;
  total: number;
  currentQuestion: string;
  reference: {
    dashboard: string;
  };
  phase: RunstatePhase;
  source: RunstateSource;
  totalTimeSec: number;
  iscurrentgame: boolean;
};

type AgentModule = {
  default: {
    state: (scope: string) => Promise<unknown>;
  };
};

type AgentStateContainer = {
  games: AgentRunstateEntry[];
  /** sequence: เกมที่จบแล้วก่อนเกมสุดท้าย — ส่งใน state ตอน `allend` เท่านั้น */
  summarySequence?: AgentRunstateEntry[];
};

/** plain snapshot ระหว่างเล่น (ยังไม่เขียนเข้า agent จนกว่า allend) */
const summarySequenceCache = new Map<string, AgentRunstateEntry[]>();

export type RunstateDebugRecord = {
  at: string;
  phase: RunstatePhase;
  scope: string;
  gameKey: string;
  gameUuid?: string;
  gameIndex?: number;
  score: number;
  current: number;
  total: number;
  currentQuestion: string;
  source: RunstateSource;
  totalTimeSec: number;
  sent: boolean;
  dryRunReason?: string;
  gamesCount: number;
  summarySequenceCount: number;
  entry?: AgentRunstateEntry;
};

declare global {
  interface Window {
    /** ผล runstate ล่าสุด — ดูใน DevTools ได้ทันที (โหมด localhost / มี query จะไม่ส่ง agent จริง) */
    __eefRunstateLast?: RunstateDebugRecord;
  }
}

const stateCache = new Map<string, AgentStateContainer>();
let agentLoader: Promise<AgentModule["default"] | null> | undefined;

/** localhost / URL มี query — จำลอง state ในหน่วยความจำ + log แทนส่ง agent */
function isRunstateDryRun(): boolean {
  return shouldSkipKnowLearningAgentsFromUrl();
}

function getRunstateDryRunReason(): string {
  if (typeof window === "undefined") return "no window";
  if (isKnowLearningAgentDevHostname()) return "localhost / IP (dev)";
  if (window.location.search.length > 0) return "URL has query (?…) — agents disabled";
  return "agents disabled";
}

function createEmptyRunstateContainer(): AgentStateContainer {
  return { games: [], summarySequence: [] };
}

function setRunstateDebugRecord(record: RunstateDebugRecord): void {
  if (typeof window === "undefined") return;
  window.__eefRunstateLast = record;
  const tag = record.sent ? "[runstate]" : "[runstate · dry-run]";
  // eslint-disable-next-line no-console -- debug runstate บน localhost
  console.group(`${tag} ${record.phase} — ${record.currentQuestion}`);
  // eslint-disable-next-line no-console
  console.info(record);
  if (record.entry) {
    // eslint-disable-next-line no-console
    console.info("entry:", record.entry);
  }
  // eslint-disable-next-line no-console
  console.groupEnd();
}

function loadAgent(): Promise<AgentModule["default"] | null> {
  if (shouldSkipKnowLearningAgentsFromUrl()) return Promise.resolve(null);
  if (!agentLoader) {
    agentLoader = import("@knowlearning/agents")
      .then((m) => m.default as AgentModule["default"])
      .catch((err) => {
        console.warn("[runstate] agent import failed", err);
        return null;
      });
  }
  return agentLoader;
}

async function getOrInitState(scope: string): Promise<AgentStateContainer | null> {
  const cached = stateCache.get(scope);
  if (cached) return cached;

  if (isRunstateDryRun()) {
    const container = createEmptyRunstateContainer();
    stateCache.set(scope, container);
    return container;
  }

  const agent = await loadAgent();
  if (!agent) return null;

  try {
    const raw = (await agent.state(scope)) as Partial<AgentStateContainer> & {
      games?: AgentRunstateEntry[];
      summarySequence?: AgentRunstateEntry[];
    };
    if (!Array.isArray(raw.games)) raw.games = [];
    if (!Array.isArray(raw.summarySequence)) raw.summarySequence = [];
    const container = raw as AgentStateContainer;
    stateCache.set(scope, container);
    return container;
  } catch (err) {
    console.warn("[runstate] init state failed", { scope, err });
    return null;
  }
}

function runstateEntryKey(gameKey: string, gameUuid?: string): string {
  return `${gameKey}|${gameUuid ?? ""}`;
}

/** push object เปล่าแล้ว mutate บน proxy ใน tree — ห้าม push object ที่มี nested reference สำเร็จรูป */
function appendEmptyGameRow(container: AgentStateContainer): AgentRunstateEntry {
  container.games.push({} as AgentRunstateEntry);
  return container.games[container.games.length - 1];
}

function setEntryReferenceDashboard(entry: AgentRunstateEntry): void {
  if (entry.reference && typeof entry.reference === "object") {
    entry.reference.dashboard = RUNSTATE_DASHBOARD_REF;
    return;
  }
  entry.reference = { dashboard: RUNSTATE_DASHBOARD_REF };
}

type EntryFields = {
  studentUuid?: string;
  studentName?: string;
  gameKey: string;
  gameUuid?: string;
  gameIndex?: number;
  startDate: string;
  updateDate: string;
  score: number;
  current: number;
  total: number;
  currentQuestion: string;
  phase: RunstatePhase;
  source: RunstateSource;
  totalTimeSec: number;
  iscurrentgame: boolean;
};

function writeEntryFields(entry: AgentRunstateEntry, fields: EntryFields): void {
  entry.studentUuid = fields.studentUuid;
  entry.studentName = fields.studentName;
  entry.gameKey = fields.gameKey;
  entry.gameUuid = fields.gameUuid;
  entry.gameIndex = fields.gameIndex;
  entry.startDate = fields.startDate;
  entry.updateDate = fields.updateDate;
  entry.score = fields.score;
  entry.current = fields.current;
  entry.total = fields.total;
  entry.currentQuestion = fields.currentQuestion;
  entry.phase = fields.phase;
  entry.source = fields.source;
  entry.totalTimeSec = fields.totalTimeSec;
  entry.iscurrentgame = fields.iscurrentgame;
  setEntryReferenceDashboard(entry);
}

function findGameRow(
  container: AgentStateContainer,
  gameKey: string,
  gameUuid?: string
): AgentRunstateEntry | undefined {
  const key = runstateEntryKey(gameKey, gameUuid);
  return container.games.find((g) => runstateEntryKey(g.gameKey, g.gameUuid) === key);
}

/** agent proxy array: length=0 อาจล้างไม่หมด — ใช้ pop จน empty */
function clearGameRows(container: AgentStateContainer): void {
  while (container.games.length > 0) {
    container.games.pop();
  }
}

/** คงแถวที่กำลังอัปเดตไว้แถวเดียว — ลบ snapshot เก่าที่ค้างใน state */
function retainOnlyGameRow(container: AgentStateContainer, keep: AgentRunstateEntry): void {
  for (let i = container.games.length - 1; i >= 0; i -= 1) {
    if (container.games[i] !== keep) {
      container.games.splice(i, 1);
    }
  }
}

function resetSequenceGameRow(container: AgentStateContainer): AgentRunstateEntry {
  clearGameRows(container);
  return appendEmptyGameRow(container);
}

function ensureSummarySequenceArray(container: AgentStateContainer): AgentRunstateEntry[] {
  if (!Array.isArray(container.summarySequence)) {
    container.summarySequence = [];
  }
  return container.summarySequence;
}

function clearSummarySequenceRows(container: AgentStateContainer): void {
  const rows = ensureSummarySequenceArray(container);
  while (rows.length > 0) {
    rows.pop();
  }
}

function appendEmptySummaryRow(container: AgentStateContainer): AgentRunstateEntry {
  const rows = ensureSummarySequenceArray(container);
  rows.push({} as AgentRunstateEntry);
  return rows[rows.length - 1];
}

function snapshotEntry(entry: AgentRunstateEntry): AgentRunstateEntry {
  return {
    studentUuid: entry.studentUuid,
    studentName: entry.studentName,
    gameKey: entry.gameKey,
    gameUuid: entry.gameUuid,
    gameIndex: entry.gameIndex,
    startDate: entry.startDate,
    updateDate: entry.updateDate,
    score: entry.score,
    current: entry.current,
    total: entry.total,
    currentQuestion: entry.currentQuestion,
    reference: { dashboard: entry.reference?.dashboard ?? RUNSTATE_DASHBOARD_REF },
    phase: "end",
    source: entry.source,
    totalTimeSec: entry.totalTimeSec,
    iscurrentgame: false,
  };
}

function getSummaryCache(scopeKey: string): AgentRunstateEntry[] {
  let list = summarySequenceCache.get(scopeKey);
  if (!list) {
    list = [];
    summarySequenceCache.set(scopeKey, list);
  }
  return list;
}

function clearSummaryCache(scopeKey: string): void {
  summarySequenceCache.delete(scopeKey);
}

function appendSummaryCache(scopeKey: string, snapshot: AgentRunstateEntry): void {
  getSummaryCache(scopeKey).push(snapshot);
}

function materializeSummarySequence(
  container: AgentStateContainer,
  snapshots: AgentRunstateEntry[]
): void {
  clearSummarySequenceRows(container);
  for (const snap of snapshots) {
    const row = appendEmptySummaryRow(container);
    writeEntryFields(row, {
      studentUuid: snap.studentUuid,
      studentName: snap.studentName,
      gameKey: snap.gameKey,
      gameUuid: snap.gameUuid,
      gameIndex: snap.gameIndex,
      startDate: snap.startDate,
      updateDate: snap.updateDate,
      score: snap.score,
      current: snap.current,
      total: snap.total,
      currentQuestion: snap.currentQuestion,
      phase: "end",
      source: snap.source,
      totalTimeSec: snap.totalTimeSec,
      iscurrentgame: false,
    });
  }
}

export type RunstateScope =
  | { kind: "sequence"; sequenceUuid: string }
  | { kind: "game"; gameUuid: string };

export function resolveRunstateScope(opts: {
  sequenceUuid?: string | null;
  gameUuid?: string;
}): RunstateScope | null {
  const seq = (opts.sequenceUuid ?? "").trim();
  if (seq) return { kind: "sequence", sequenceUuid: seq };
  const g = (opts.gameUuid ?? "").trim();
  if (g) return { kind: "game", gameUuid: g };
  return null;
}

export function runstateScopeKey(scope: RunstateScope): string {
  return scope.kind === "sequence"
    ? `runstate-${scope.sequenceUuid}`
    : `runstate-${scope.gameUuid}`;
}

export type ReportRunstateInput = {
  game: Phaser.Game;
  scope: RunstateScope;
  gameKey: string;
  gameUuid?: string;
  gameIndex?: number;
  score: number;
  current: number;
  total: number;
  phase: RunstatePhase;
  totalTimeSec?: number;
};

export async function reportRunstate(input: ReportRunstateInput): Promise<void> {
  try {
    const container = await getOrInitState(runstateScopeKey(input.scope));
    if (!container) return;

    const scopeKey = runstateScopeKey(input.scope);

    const auth = getAgentAuthSummary(input.game);
    const studentUuid = auth?.studentUserUuid;
    const studentName = auth?.studentDisplayName;
    const now = new Date().toISOString();
    const total = Math.max(0, Math.floor(input.total) || 0);
    const current = Math.max(0, Math.floor(input.current) || 0);
    const score = Math.max(0, Math.round(Number(input.score) || 0));
    const source: RunstateSource = input.scope.kind === "sequence" ? "sequence" : "game";
    const gameIndexRaw = Math.floor(Number(input.gameIndex));
    const gameIndex =
      Number.isFinite(gameIndexRaw) && gameIndexRaw >= 0 ? gameIndexRaw : undefined;
    const totalTimeSec = Math.max(
      0,
      Math.round((Number(input.totalTimeSec) || 0) * 1000) / 1000
    );
    const currentQuestion = `${Math.min(current, total)}/${total}`;
    const isSequence = input.scope.kind === "sequence";

    let entry = isSequence
      ? container.games[container.games.length - 1]
      : findGameRow(container, input.gameKey, input.gameUuid);

    if (input.phase === "start" || input.phase === "allstart") {
      const startPhase = input.phase;
      if (isSequence) {
        if (startPhase === "allstart") {
          clearSummaryCache(scopeKey);
          clearSummarySequenceRows(container);
        }
        entry = resetSequenceGameRow(container);
      } else {
        for (const g of container.games) g.iscurrentgame = false;
        if (!entry) {
          entry = appendEmptyGameRow(container);
        }
      }

      writeEntryFields(entry, {
        studentUuid,
        studentName,
        gameKey: input.gameKey,
        gameUuid: input.gameUuid,
        gameIndex,
        startDate: now,
        updateDate: now,
        score,
        current,
        total,
        currentQuestion,
        phase: startPhase,
        source,
        totalTimeSec: 0,
        iscurrentgame: true,
      });
    } else if (input.phase === "progress") {
      if (!entry) {
        if (!isSequence) {
          for (const g of container.games) g.iscurrentgame = false;
        }
        entry = isSequence ? resetSequenceGameRow(container) : appendEmptyGameRow(container);
      }

      writeEntryFields(entry, {
        studentUuid,
        studentName,
        gameKey: input.gameKey,
        gameUuid: input.gameUuid,
        gameIndex,
        startDate: now,
        updateDate: now,
        score,
        current,
        total,
        currentQuestion,
        phase: "progress",
        source,
        totalTimeSec: 0,
        iscurrentgame: true,
      });
    } else if (input.phase === "end" || input.phase === "allend") {
      const endPhase = input.phase;
      if (!entry) {
        entry = isSequence ? resetSequenceGameRow(container) : appendEmptyGameRow(container);
        writeEntryFields(entry, {
          studentUuid,
          studentName,
          gameKey: input.gameKey,
          gameUuid: input.gameUuid,
          gameIndex,
          startDate: now,
          updateDate: now,
          score,
          current: total,
          total,
          currentQuestion: `${total}/${total}`,
          phase: endPhase,
          source,
          totalTimeSec,
          iscurrentgame: false,
        });
      } else {
        entry.studentName = studentName ?? entry.studentName;
        entry.updateDate = now;
        entry.gameIndex = gameIndex;
        entry.score = score;
        entry.current = total > 0 ? total : current;
        entry.total = total;
        entry.currentQuestion = total > 0 ? `${total}/${total}` : `${current}/${total}`;
        entry.phase = endPhase;
        entry.source = source;
        entry.totalTimeSec = totalTimeSec;
        entry.iscurrentgame = false;
      }

      if (isSequence && endPhase === "end" && entry) {
        appendSummaryCache(scopeKey, snapshotEntry(entry));
      }
    }

    if (isSequence) {
      entry =
        findGameRow(container, input.gameKey, input.gameUuid) ??
        container.games[container.games.length - 1];
    } else {
      entry = findGameRow(container, input.gameKey, input.gameUuid) ?? entry;
    }

    if (entry) {
      retainOnlyGameRow(container, entry);
    } else {
      clearGameRows(container);
    }

    if (isSequence) {
      if (input.phase === "allend") {
        materializeSummarySequence(container, getSummaryCache(scopeKey));
      } else {
        clearSummarySequenceRows(container);
      }
    } else {
      clearSummarySequenceRows(container);
    }

    const dryRun = isRunstateDryRun();
    setRunstateDebugRecord({
      at: new Date().toISOString(),
      phase: input.phase,
      scope: scopeKey,
      gameKey: input.gameKey,
      gameUuid: input.gameUuid,
      gameIndex,
      score,
      current,
      total,
      currentQuestion,
      source,
      totalTimeSec,
      sent: !dryRun,
      ...(dryRun ? { dryRunReason: getRunstateDryRunReason() } : {}),
      gamesCount: container.games.length,
      summarySequenceCount: container.summarySequence?.length ?? 0,
      entry: entry
        ? {
            ...entry,
            reference: { dashboard: entry.reference?.dashboard ?? RUNSTATE_DASHBOARD_REF },
          }
        : undefined,
    });
  } catch (err) {
    console.warn("[runstate] report failed", err);
  }
}
