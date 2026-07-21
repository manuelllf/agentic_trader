// Cliente HTTP hacia el backend FastAPI.
import type {
  AppConfig, Approval, ApprovalsResponse, DemoStatus, EquityHistory,
  LedgerSnapshot, Macro, Overview, Performance, PersonalSummary, Proposal, RealSummary,
  ScoreRow, WatchItem,
} from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const TIMEOUT_MS = 15_000;
const TOKEN_KEY = "agentic_token";

/** Error de red tipado: el backend no respondió (caído, CORS, timeout). */
export class ApiError extends Error {
  constructor(message: string, readonly kind: "network" | "http", readonly status?: number) {
    super(message);
    this.name = "ApiError";
  }
}

const OFFLINE = "No hay conexión con el servidor. Reintenta en unos segundos.";

/* ---- token de sesión (login) ---- */
const getToken = () => (typeof window !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null);
export const setToken = (t: string) => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);
/** true si hay un token guardado (no valida que siga vigente — eso lo decide el backend). */
export const hasToken = () => !!getToken();
/** 401 en cualquier llamada → sesión caducada: limpia el token y avisa al AuthGate. */
function onUnauthorized() {
  clearToken();
  if (typeof window !== "undefined") window.dispatchEvent(new Event("agentic-unauthorized"));
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const token = getToken();
  const headers = {
    ...(init?.headers as Record<string, string> | undefined),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  try {
    return await fetch(`${API_URL}${path}`, { cache: "no-store", signal: ctrl.signal, ...init, headers });
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
  if (res.status === 401) { onUnauthorized(); throw new ApiError("Sesión caducada.", "http", 401); }
  if (!res.ok) throw new ApiError(`No se pudo leer ${path} (${res.status}).`, "http", res.status);
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await request(path, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) { onUnauthorized(); throw new ApiError("Sesión caducada.", "http", 401); }
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new ApiError(
      (detail as { detail?: string }).detail ?? `La operación falló (${res.status}).`,
      "http", res.status,
    );
  }
  return res.json() as Promise<T>;
}

/* ---- login / sesión ---- */

/** Inicia sesión con la contraseña. Guarda el token si es correcta; lanza si no.
 *  Va por `request()`: mismo timeout de 15 s y mismo mapeo de red que el resto — un backend
 *  colgado ya no deja el botón en "Entrando…" hasta el timeout del navegador. */
export async function login(password: string): Promise<void> {
  const res = await request("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (res.status === 401) throw new ApiError("Contraseña incorrecta.", "http", 401);
  if (res.status === 429)
    throw new ApiError("Demasiados intentos fallidos. Espera unos minutos.", "http", 429);
  if (!res.ok) throw new ApiError(`No se pudo iniciar sesión (${res.status}).`, "http", res.status);
  const data = (await res.json()) as { token: string };
  setToken(data.token);
}

/** Comprueba el token guardado. true = sesión válida (o backend caído → no bloquea con login). */
export async function checkAuth(): Promise<boolean> {
  try {
    const res = await request("/auth/check");   // request() ya añade el Authorization
    return res.status !== 401;   // 401 → hay que loguear; cualquier otra cosa → deja pasar
  } catch {
    return true;                 // backend inalcanzable: la app mostrará su banner de conexión
  }
}

export function logout() {
  clearToken();
  if (typeof window !== "undefined") window.location.reload();
}

export const getLedger = () => get<LedgerSnapshot>("/ledger");

export const runDemo = () => post<DemoStatus & { started: boolean }>("/demo/run");
export const getDemoStatus = () => get<DemoStatus>("/demo/status");

export const getMacro = () => get<Macro>("/macro");
export const getConfig = () => get<AppConfig>("/config");
export const getScores = () => get<ScoreRow[]>("/scores");  // default del backend: TODO lo profundo
export const getProposal = () => get<Proposal | null>("/proposal");
export const getWatchlist = () => get<WatchItem[]>("/watchlist");
export const getPerformance = () => get<Performance>("/performance");
export const getOverview = () => get<Overview>("/overview");
/** Curva histórica (cierres diarios). La sombra es pública; la real sin sesión llega sin equity. */
export const getHistory = (book: "shadow" | "real" = "shadow") =>
  get<EquityHistory>(`/history?book=${book}`);

// ---- Sala Real ----
export const getReal = () => get<RealSummary>("/real");
/** Cambio EUR→USD indicativo (el libro vive en USD; tú aportas en €). */
export const getFx = () => get<{ pair: string; rate: number | null; asof: string | null }>("/fx");

/** Traza de una aportación en €: lo que el broker convirtió DE VERDAD (o simuló en dry-run). */
export interface FxAllocated {
  currency: string;
  eur?: number;
  usd: string;        // dólares netos apuntados en el libro (imagen final del broker)
  rate: string;       // cambio real del fill
  simulated: boolean;
}
export const allocateReal = (amount: number, note = "", currency: "USD" | "EUR" = "USD") =>
  post<RealSummary & { allocated?: FxAllocated }>("/real/allocate", { amount, note, currency });
export const getApprovals = () => get<ApprovalsResponse>("/approvals");

/** Informe PERSISTIDO del último escaneo (cron o manual): modo, contadores, coste e
 * incidencias — o el error si reventó entero. A diferencia de /demo/status (memoria del
 * runner), sobrevive a reinicios y también lo escribe el cron del martes. */
export interface ScanReport {
  at: string;
  mode: "decisión" | "observatorio" | null;   // null = falló antes de saberse el modo
  error: string | null;                        // != null → el escaneo entero falló
  issues: string[];
  scanned: number | null;
  prescored: number | null;
  deep: number | null;
  cost: { calls: number; cost_usd: number } | null;
}
export const getScanReport = () => get<{ report: ScanReport | null }>("/scan/report");
export const approveTrade = (id: number) => post<Approval>(`/approvals/${id}/approve`);
export const rejectTrade = (id: number) => post<Approval>(`/approvals/${id}/reject`);
export const reconcileApprovals = () => post<{ reconciled: number }>("/approvals/reconcile");

// Los endpoints de mantenimiento del backend (/admin/seed, /admin/seed-memory,
// /admin/memory-status) siguen vivos, pero se usan a mano (migración puntual por consola):
// la UI ya no los llama y sus clientes se retiraron de aquí.

export interface ShadowReset {
  ok: boolean;
  deleted: { positions: number; trades: number; snapshots: number };
  cash_after: string;   // caja del sombra tras el reinicio (= capital conservado)
}

/** DESTRUCTIVO (solo libro sombra): borra posiciones/operaciones/curva; conserva el capital. */
export const resetShadow = () => post<ShadowReset>("/admin/reset-shadow");

// ---- Cartera personal IBKR (read-only, intocable para el agente) ----
export const getPersonal = () => get<PersonalSummary>("/personal");
export const syncPersonal = () => post<PersonalSummary & { synced: number }>("/personal/sync");

// ---- Push (alertas) ----
export const getPushKey = () => get<{ key: string }>("/push/key");
export const subscribePush = (sub: PushSubscriptionJSON) =>
  post<{ ok: boolean }>("/push/subscribe", sub);
export const testPush = () => post<{ sent: number }>("/push/test");
