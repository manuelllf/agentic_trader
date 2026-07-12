// Cliente HTTP hacia el backend FastAPI.
import type {
  AppConfig, Approval, ApprovalsResponse, DemoStatus, ExecuteResult, LedgerSnapshot, Macro,
  Overview, Performance, PersonalSummary, Proposal, RealSummary, ScoreRow, WatchItem,
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

/** Inicia sesión con la contraseña. Guarda el token si es correcta; lanza si no. */
export async function login(password: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/auth/login`, {
      method: "POST", cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
  } catch {
    throw new ApiError(OFFLINE, "network");
  }
  if (res.status === 401) throw new ApiError("Contraseña incorrecta.", "http", 401);
  if (!res.ok) throw new ApiError(`No se pudo iniciar sesión (${res.status}).`, "http", res.status);
  const data = (await res.json()) as { token: string };
  setToken(data.token);
}

/** Comprueba el token guardado. true = sesión válida (o backend caído → no bloquea con login). */
export async function checkAuth(): Promise<boolean> {
  const token = getToken();
  try {
    const res = await fetch(`${API_URL}/auth/check`, {
      cache: "no-store",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
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
export const getOverview = () => get<Overview>("/overview");

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

// ---- Mantenimiento: volcado de base de datos (local → nube) ----
export const seedDatabase = (snapshot: unknown) =>
  post<{ ok: boolean; loaded: Record<string, number>; total: number }>("/admin/seed", snapshot);

/** Sube el fichero de memoria vectorial (binario) TAL CUAL a la ruta configurada en el backend. */
export async function seedMemory(bytes: ArrayBuffer): Promise<{ ok: boolean; bytes: number; path: string }> {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(`${API_URL}/admin/seed-memory`, {
      method: "POST", cache: "no-store",
      headers: { "Content-Type": "application/octet-stream", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: bytes,
    });
  } catch {
    throw new ApiError(OFFLINE, "network");
  }
  if (res.status === 401) { onUnauthorized(); throw new ApiError("Sesión caducada.", "http", 401); }
  if (!res.ok) throw new ApiError(`No se pudo subir la memoria (${res.status}).`, "http", res.status);
  return res.json() as Promise<{ ok: boolean; bytes: number; path: string }>;
}

export interface MemoryStatus {
  available: boolean;   // hay recuerdos Y deps instaladas (un recall real funcionaría)
  exists: boolean;      // el fichero de memoria existe en la ruta configurada
  count: number;        // nº de recuerdos guardados
  deps: boolean;        // fastembed + sqlite-vec instaladas
  path: string;
  error?: string;
}

/** Diagnóstico read-only de la memoria vectorial (no carga el modelo): confirma que el volcado
 * llegó al volumen contando los recuerdos. */
export const getMemoryStatus = () => get<MemoryStatus>("/admin/memory-status");

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
