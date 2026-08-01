/**
 * Know Learning `@knowlearning/agents` — ค่า embed / user context
 * https://docs.knowlearning.systems/embedding/recommended-app-scaffold/#the-scaffold
 *
 * เรียกครั้งเดียวตอน boot จาก main แล้วเก็บผลใน `game.registry` (key: REGISTRY_KEY_AGENT_ENV)
 *
 * ใช้ agents เฉพาะเมื่อ:
 * - URL **ไม่มี** query ต่อท้าย path (`location.search` ว่าง)
 * - hostname **ไม่ใช่** localhost / 127.0.0.1 / IP (โหมด dev — ไม่โหลด bundle agents)
 */
import type Phaser from "phaser";

const IPV4_HOSTNAME_RE =
  /^(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

/** localhost / loopback / hostname เป็น IPv4 — ไม่เรียก @knowlearning/agents (ใช้ตอน dev) */
export function isKnowLearningAgentDevHostname(): boolean {
  if (typeof window === "undefined") return false;
  const h = window.location.hostname.toLowerCase();
  if (h === "localhost" || h === "127.0.0.1" || h === "::1") return true;
  return IPV4_HOSTNAME_RE.test(h);
}

/**
 * ไม่เรียก Know Learning agents เมื่อ:
 * - มี query string (`…?…`)
 * - หรือ hostname เป็น localhost / IP (dev)
 */
export function shouldSkipKnowLearningAgentsFromUrl(): boolean {
  if (typeof window === "undefined") return false;
  if (window.location.search.length > 0) return true;
  if (isKnowLearningAgentDevHostname()) return true;
  return false;
}

export const REGISTRY_KEY_AGENT_ENV = "agentEnvironmentBootstrap";
/** สรุปจาก `environment.auth` — ตั้งตอน boot สำเร็จ */
export const REGISTRY_KEY_AGENT_AUTH_SUMMARY = "agentAuthSummary";

export type AgentEnvironmentBootstrap =
  | { ok: true; environment: unknown }
  | { ok: false; error: unknown; skipThirdParty?: boolean };

function getAgentSkipReasonLabel(): string {
  if (typeof window === "undefined") return "no window";
  if (isKnowLearningAgentDevHostname()) return "localhost / IP (dev)";
  if (window.location.search.length > 0) return "URL has query (?…)";
  return "unknown";
}

/** ค่าที่ดึงจาก `Agent.environment().auth` ตามที่ embed ส่งมา */
export type AgentAuthSummary = {
  /** `auth.user` — UUID นักเรียน (ผู้ใช้ใน session นี้) */
  studentUserUuid: string | undefined;
  /** `auth.provider` — UUID provider / โหมด SSO (มักอ้างถึง “ครู” ทางระบบ) */
  providerUuid: string | undefined;
  /** `auth.info.name` — ชื่อแสดง เช่น ด.ช. xxx */
  studentDisplayName: string | undefined;
};

/**
 * ดึงเฉพาะ user / provider / ชื่อ จาก object ที่ได้จาก `Agent.environment()`
 */
export function parseAgentAuthFromEnvironment(environment: unknown): AgentAuthSummary | null {
  if (!environment || typeof environment !== "object") return null;
  const env = environment as Record<string, unknown>;
  const auth = env.auth;
  if (!auth || typeof auth !== "object") return null;
  const a = auth as Record<string, unknown>;

  const studentUserUuid = typeof a.user === "string" ? a.user : undefined;
  const providerUuid = typeof a.provider === "string" ? a.provider : undefined;

  let studentDisplayName: string | undefined;
  const info = a.info;
  if (info && typeof info === "object") {
    const name = (info as Record<string, unknown>).name;
    if (typeof name === "string") studentDisplayName = name;
  }

  if (studentUserUuid == null && providerUuid == null && studentDisplayName == null) return null;
  return { studentUserUuid, providerUuid, studentDisplayName };
}

export async function resolveAgentEnvironment(): Promise<AgentEnvironmentBootstrap> {
  if (typeof window === "undefined") {
    return { ok: false, error: new Error("no window") };
  }
  if (shouldSkipKnowLearningAgentsFromUrl()) {
    return {
      ok: false,
      error: new Error(`skipped: ${getAgentSkipReasonLabel()} — agents disabled`),
      skipThirdParty: true,
    };
  }
  try {
    const Agent = (await import("@knowlearning/agents")).default;
    const environment = await Agent.environment();
    return { ok: true, environment };
  } catch (error) {
    return { ok: false, error };
  }
}

export function registerAgentEnvironmentBootstrap(
  game: Phaser.Game,
  bootstrap: AgentEnvironmentBootstrap,
  logContext?: string
): void {
  game.registry.set(REGISTRY_KEY_AGENT_ENV, bootstrap);

  const label = logContext ? `[boot · ${logContext}]` : "[boot]";

  if (!bootstrap.ok && bootstrap.skipThirdParty) {
    game.registry.remove(REGISTRY_KEY_AGENT_AUTH_SUMMARY);
    if (typeof window !== "undefined") {
      // eslint-disable-next-line no-console -- แจ้งโหมดข้าม agents
      console.info(
        `${label} ข้าม @knowlearning/agents — ${getAgentSkipReasonLabel()} | hostname=${window.location.hostname} search=${window.location.search || "(empty)"}`
      );
    }
    return;
  }

  if (bootstrap.ok) {
    const env = bootstrap.environment;
    const envRec = env as unknown as Record<string, unknown>;
    const authSummary = parseAgentAuthFromEnvironment(env);
    if (authSummary) {
      game.registry.set(REGISTRY_KEY_AGENT_AUTH_SUMMARY, authSummary);
    } else {
      game.registry.remove(REGISTRY_KEY_AGENT_AUTH_SUMMARY);
    }

    // eslint-disable-next-line no-console -- ตั้งใจ log ค่าจาก Agent.environment()
    console.group(`${label} Agent.environment() — ค่าที่ได้`);
    // eslint-disable-next-line no-console
    console.log("full object:", env);
    if (env && typeof env === "object") {
      // eslint-disable-next-line no-console
      console.log("top-level keys:", Object.keys(envRec));
    }
    if ("auth" in envRec) {
      // eslint-disable-next-line no-console
      console.log("auth:", envRec.auth);
    }
    if ("variables" in envRec) {
      // eslint-disable-next-line no-console
      console.log("variables:", envRec.variables);
    }
    if (authSummary) {
      // eslint-disable-next-line no-console
      console.log("สรุป auth (ใช้ในเกมได้):", {
        "providerUuid (ครู / SSO provider)": authSummary.providerUuid,
        'ชื่อ info.name': authSummary.studentDisplayName,
        "userUuid (นักเรียน / auth.user)": authSummary.studentUserUuid,
      });
    }
    // eslint-disable-next-line no-console
    console.groupEnd();
  } else {
    // eslint-disable-next-line no-console
    console.warn(`${label} Agent.environment() ล้มเหลว — โหมด standalone หรือไม่มี embed agent`, bootstrap.error);
  }
}

export function getAgentEnvironmentBootstrap(game: Phaser.Game): AgentEnvironmentBootstrap | undefined {
  return game.registry.get(REGISTRY_KEY_AGENT_ENV) as AgentEnvironmentBootstrap | undefined;
}

/** อ่านสรุป auth ที่ตั้งตอน boot — หรือคำนวณใหม่จาก bootstrap ถ้ายังไม่มีใน registry */
export function getAgentAuthSummary(game: Phaser.Game): AgentAuthSummary | undefined {
  const cached = game.registry.get(REGISTRY_KEY_AGENT_AUTH_SUMMARY) as AgentAuthSummary | undefined;
  if (cached) return cached;
  const boot = getAgentEnvironmentBootstrap(game);
  if (!boot?.ok) return undefined;
  return parseAgentAuthFromEnvironment(boot.environment) ?? undefined;
}
