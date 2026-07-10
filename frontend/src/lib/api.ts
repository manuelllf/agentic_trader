// Cliente HTTP hacia el backend FastAPI.
import type {
  AppConfig, Approval, ApprovalsResponse, DemoStatus, ExecuteResult, LedgerSnapshot, Macro,
  Performance, PersonalSummary, Proposal, RealSummary, ScoreRow, WatchItem,
} from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const TIMEOUT_MS = 15_000;

/** Error de red tipado: el backend no respondió (caído, CORS, timeout). */
export class ApiError extends Error {
  constructor(message: string, readonly kind: "network" | "http", readonly status?: number) {
    super(message);
    this.name = "ApiError";
  }
}

const OFFLINE = "No hay conexión con el backend. Comprueba que está en marcha (localhost:8000).";

async function request(path: string, init?: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(`${API_URL}${path}`, { cache: "no-store", signal: ctrl.signal, ...init });
  } catch (e) {
    // fetch rechaza con TypeError (backend caído/CORS) o AbortError (timeout).
    const msg = e instanceof DOMException && e.name === "AbortError"
      ? "El backend tardó demasiado en responder (timeout)."
      : OFFLINE;
    throw new ApiError(msg, "network");
  } finally {
    clearTimeout(timer);
  }
}

async function get<T>(path: string): Promise<T> {
  const res = await request(path);
  if (!res.ok) throw new ApiError(`No se pudo leer ${path} (${res.status}).`, "http", res.status);
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await request(path, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new ApiError(
      (detail as { detail?: string }).detail ?? `La operación falló (${res.status}).`,
      "http", res.status,
    );
  }
  return res.json() as Promise<T>;
}

export const getLedger = () => get<LedgerSnapshot>("/ledger");
export const allocate = (amount: number, note = "") =>
  post<LedgerSnapshot>("/ledger/allocate", { amount, note });

export const runDemo = () => post<DemoStatus & { started: boolean }>("/demo/run");
export const getDemoStatus = () => get<DemoStatus>("/demo/status");

export const getMacro = () => get<Macro>("/macro");
export const getConfig = () => get<AppConfig>("/config");
export const getScores = () => get<ScoreRow[]>("/scores?limit=25");
export const getProposal = () => get<Proposal | null>("/proposal");
export const getWatchlist = () => get<WatchItem[]>("/watchlist");
export const getPerformance = () => get<Performance>("/performance");

// Ejecuta un item de la propuesta en el libro sombra (botón Comprar/Vender).
export const executeProposalItem = (ticker: string) =>
  post<ExecuteResult>(`/proposal/execute/${ticker}`);
export const executeProposalAll = () =>
  post<{ ok: boolean; executed: string[]; skipped: string[]; message: string; ledger: LedgerSnapshot }>(
    "/proposal/execute",
  );

// ---- Sala Real ----
export const getReal = () => get<RealSummary>("/real");
export const allocateReal = (amount: number, note = "") =>
  post<RealSummary>("/real/allocate", { amount, note });
export const getApprovals = () => get<ApprovalsResponse>("/approvals");
export const approveTrade = (id: number) => post<Approval>(`/approvals/${id}/approve`);
export const rejectTrade = (id: number) => post<Approval>(`/approvals/${id}/reject`);
export const reconcileApprovals = () => post<{ reconciled: number }>("/approvals/reconcile");

// ---- Cartera personal IBKR (read-only, intocable para el agente) ----
export const getPersonal = () => get<PersonalSummary>("/personal");
export const syncPersonal = () => post<PersonalSummary & { synced: number }>("/personal/sync");

// ---- Push (alertas) ----
export const getPushKey = () => get<{ key: string }>("/push/key");
export const subscribePush = (sub: PushSubscriptionJSON) =>
  post<{ ok: boolean }>("/push/subscribe", sub);
export const unsubscribePush = (endpoint: string) =>
  post<{ ok: boolean }>("/push/unsubscribe", { endpoint, keys: {} });
export const testPush = () => post<{ sent: number }>("/push/test");
