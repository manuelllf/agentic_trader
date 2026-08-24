// Cliente HTTP hacia el backend FastAPI.
import type { FunnelScan } from "./scan";
import type {
  AppConfig, Approval, ApprovalsResponse, DemoRunOverrides, DemoStatus, EquityHistory,
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

// Query params: decide=false for full universe without proposing; force_mid_layer=true runs exact monthly circuit.
// overrides in body only (simulation config); "Analyze" never sends it, always uses production defaults.
export const runDemo = (opts?: {
  decide?: boolean; forceMidLayer?: boolean; overrides?: DemoRunOverrides;
}) => {
  const params = new URLSearchParams();
  if (opts?.decide === false) params.set("decide", "false");
  if (opts?.forceMidLayer) params.set("force_mid_layer", "true");
  const qs = params.toString();
  return post<DemoStatus & { started: boolean }>(
    `/demo/run${qs ? `?${qs}` : ""}`, opts?.overrides ? { overrides: opts.overrides } : undefined,
  );
};
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

/** Persistent scan report: mode, counters, cost, issues. Survives deploys unlike /demo/status.
 *  Written by cron and manual scans. */
export interface ScanReport {
  at: string;
  mode: "decisión" | "observatorio" | null;   // null = falló antes de saberse el modo
  error: string | null;                        // != null → el escaneo entero falló
  issues: string[];
  changes?: string[];                          // novedades vs el escaneo anterior (ranking/watchlist)
  outlook?: string | null;                      // tesis macro DE ESTE escaneo (solo con sesión)
  /** Solo observatorio: nombres del ranking de la decisión refrescados por este escaneo. */
  refreshed?: number | null;
  /** Con qué universo se trabajó. `fuente`: "cierre" = la foto del último cierre (lo normal),
   *  "vivo" = sin foto, pedido con el mercado abierto (sale recortado), "seed" = emergencia.
   *  `sobre_suelo` > `size` significa que mordió el tope de nombres. */
  universe?: {
    fuente: "cierre" | "vivo" | "seed";
    at: string | null;
    dias: number | null;
    size: number;
    sobre_suelo?: number;
  } | null;
  scanned: number | null;
  prescored: number | null;
  deep: number | null;
  cost: { calls: number; cost_usd: number } | null;
}
export const getScanReport = () => get<{ report: ScanReport | null }>("/scan/report");

/** Embudo de los últimos escaneos (traza de auditoría). Doble nivel: sin sesión llegan solo
 *  los agregados por etapa y sector — cómo se comporta el sistema, sin decir qué nombres. */
export const getScanFunnel = (limit = 8) =>
  get<{ scans: FunnelScan[] }>(`/scan/funnel?limit=${limit}`);

/** Full scan record: thesis, finalists, and portfolio. Single source for reconstruction after completion.
 *  Protected (reveals tickers and theses). Unlike /scan/report which only has counters. */
export interface ScanFullFinalist {
  ticker: string;
  sector: string;
  prescore: number | null;
  price: number | null;
  market_cap: number | null;
  deep_score: number | null;
  headline: string | null;
  target_price: number | null;
  selected: boolean;
  funded: boolean;
  weight_pct: number | null;
  error: string | null;
}
export interface ScanFullPosition {
  ticker: string;
  action: string;
  score?: number | null;
  target_weight_pct?: number;
  price?: string | null;
  target_price?: number | null;
  upside_pct?: number | null;
  thesis?: string;
  edge?: string;
  risk?: string;
}
export interface ScanFull {
  at: string;
  cadence: string;
  decide: boolean;
  regime: string;
  vix: number | null;
  outlook: string;
  universe: ScanReport["universe"];
  counters: Record<string, number>;
  cost: { calls: number; cost_usd: number } | null;
  issues: string[];
  finalists: ScanFullFinalist[];
  construction: {
    cash_pct: number;
    summary: string;
    items: ScanFullPosition[];
    omitted: { ticker: string; reason: string }[];
  };
}
export const getScanFull = (at?: string) =>
  get<{ scan: ScanFull | null }>(`/scan/full${at ? `?at=${encodeURIComponent(at)}` : ""}`);

/** Outcomes by group (held, selected, discarded, S&P): returns, pairs, and cut frontier.
 *  Without session: anonymized pairs and edges. */
export interface OutcomeStats {
  n: number;
  avg: number | null;
  median: number | null;
}
export interface OutcomeName {
  ticker: string;
  prescore: number | null;
  ret: number | null;
}
export interface OutcomeScan {
  at: string;
  mode: "decisión" | "observatorio";
  days: number;
  groups: {
    cartera: OutcomeStats;
    seleccionados: OutcomeStats;
    descartados: OutcomeStats;
    spy: number | null;
  };
  pairs: { ticker?: string; score: number; ret: number; funded: boolean }[];
  corte: {
    fuera: OutcomeStats & { nombres?: OutcomeName[] };
    dentro: OutcomeStats & { nombres?: OutcomeName[] };
  };
}
/** La fila de LO REAL: el libro vigente desde su compra (ledger, a valor de mercado) + S&P
 *  en la misma ventana. Viaja aparte porque la traza no alcanza a la decisión que lo compró. */
export interface OutcomeBook {
  since: string | null;
  ret: number | null;
  spy: number | null;
  n: number;
}
export const getScanOutcomes = (limit = 8) =>
  get<{ scans: OutcomeScan[]; book: OutcomeBook | null }>(`/scan/outcomes?limit=${limit}`);
/** Un recuerdo guardado: la tesis que el LLM escribió sobre un ticker en un escaneo pasado.
 *  `distance` solo llega en modo semántico (menor = más parecido); en modo ticker no aplica.
 *  `n_tesis` también solo en modo semántico: cuántas tesis guardadas tiene ESA empresa en total. */
export interface MemoryItem {
  ticker: string;
  kind: string;
  text: string;
  created_at: string;
  distance?: number;
  n_tesis?: number;
}
export interface MemorySearchResult {
  mode: "ticker" | "semantic" | "vacio";
  items: MemoryItem[];
  error?: string;
}
/** Buscador de la memoria: un ticker exacto trae su historia cronológica, texto libre trae las
 *  tesis parecidas. Es lo único que queda de escaneos pasados — la tabla de scores se reescribe
 *  en cada decisión mensual. */
export const searchMemory = (q: string, limit = 20) =>
  get<MemorySearchResult>(`/memory/search?q=${encodeURIComponent(q)}&limit=${limit}`);

/** Re-comprobación del top: reconstruye la cartera sobre los ya analizados a fondo con el suelo
 *  actual, sin re-escanear el universo (instantáneo). */
export const recheck = () => post<Record<string, unknown>>("/recheck");
/** Re-analiza a fondo (V4-Pro) los nombres ya profundizados con el macro ACTUAL, sin re-escanear
 *  el universo. Para refrescar tras corregir un dato macro. */
export const redeep = () => post<Record<string, unknown>>("/redeep");

/** Historia de UN ticker a través de los escaneos (¿es estable el criterio?). Protegido entero. */
export interface ScanAuditEntry {
  at: string;
  stage: string;
  prescore: number | null;
  deep_score: number | null;
  price: number | null;
  weight_pct: number | null;
}
export const fetchScanAudit = (ticker: string) =>
  get<{ ticker: string; scans: ScanAuditEntry[] }>(`/scan/audit/${encodeURIComponent(ticker)}`);

// ---- Analítica columnar (DuckDB leyendo Postgres) ----
export const fetchAnalyticsPeSector = () =>
  get<{ items: Record<string, unknown>[] }>("/analytics/pe-sector");
export const fetchAnalyticsCosteEtapa = (scanRunId?: number) =>
  get<{ items: Record<string, unknown>[] }>(
    `/analytics/coste-etapa${scanRunId != null ? `?scan_run_id=${scanRunId}` : ""}`,
  );
export const fetchAnalyticsConfianzaPrescore = (scanRunId?: number) =>
  get<{ items: Record<string, unknown>[] }>(
    `/analytics/confianza-prescore${scanRunId != null ? `?scan_run_id=${scanRunId}` : ""}`,
  );
export const fetchAnalyticsScans = () =>
  get<{ items: { id: number; at: string; cadence: string }[] }>("/analytics/scans");
/** Reconstruye el fichero DuckDB de /analytics/* desde Postgres (también corre solo a diario). */
export const syncAnalytics = () =>
  post<{ ok: boolean; counts: Record<string, number> }>("/admin/sync-analytics");

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

export interface UniverseSnapshotResult {
  ok: boolean;
  at: string | null;
  size: number | null;
  error?: string;
}

/** Rehace la foto del universo NASDAQ al cierre (la que usa el próximo escaneo) bajo demanda,
 *  en vez de esperar al cron. No toca posiciones ni operaciones de ningún libro. */
export const snapshotUniverse = () => post<UniverseSnapshotResult>("/admin/universe-snapshot");

export interface FotoStatus {
  status: "idle" | "running" | "done" | "error";
  started_at: string | null;
  finished_at: string | null;
  result: { alcance: string; pedidos: number; capturados: number; sin_datos: number;
            segundos: number; at: string } | null;
  error: string | null;
}

/** Lanza la foto de fundamentales a demanda (no puntúa nada): recoger datos deja de ir pegado
 *  a puntuarlos, y así se puede fotografiar por la mañana y escanear off-peak por la tarde.
 *  `countries`/`exchanges` solo aplican con `alcance="global"` — el universo global no trae
 *  precio/cap/volumen, así que país/mercado es el único filtro barato disponible. */
export const startFoto = (
  alcance: "nasdaq" | "global" = "nasdaq", limite?: number,
  countries?: string[], exchanges?: string[],
) => {
  const params = new URLSearchParams({ alcance });
  if (limite) params.set("limite", String(limite));
  (countries ?? []).forEach((c) => params.append("countries", c));
  (exchanges ?? []).forEach((e) => params.append("exchanges", e));
  return post<{ started: boolean } & FotoStatus>(`/admin/foto?${params.toString()}`);
};

export const getFotoStatus = () => get<FotoStatus>("/admin/foto");

export interface UniversoGlobalOpciones {
  synced_at: string | null;
  total: number;
  countries: { country: string; count: number }[];
  exchanges: { exchange: string; count: number }[];
}
/** Estado del universo global (HuggingFace) sincronizado: fecha, total, y países/mercados con
 *  su recuento real — para el picker de `startFoto("global", ...)`. */
export const getUniversoGlobal = () => get<UniversoGlobalOpciones>("/admin/universo-global");

export interface UniversoGlobalSyncResult {
  ok: boolean;
  tickers?: number;
  synced_at?: string;
  podadas?: number;
  source?: string;
  error?: string;
}
/** Descarga el CSV completo de HuggingFace (~63.000 filas) y lo carga en `universe_ticker`.
 *  El job mensual lo hace solo; esto es para no esperar. */
export const syncUniversoGlobal = () => post<UniversoGlobalSyncResult>("/admin/universo-global");

/** Cuenta EXACTA de tickers para una combinación país/mercado, sin traerse la lista entera —
 *  el aviso "vas a capturar N tickers" antes de poder confirmar. */
export const contarUniversoGlobal = (countries: string[], exchanges: string[]) => {
  const params = new URLSearchParams();
  countries.forEach((c) => params.append("countries", c));
  exchanges.forEach((e) => params.append("exchanges", e));
  return get<{ count: number }>(`/admin/universo-global/contar?${params.toString()}`);
};

// ---- Cartera personal IBKR (read-only, intocable para el agente) ----
export const getPersonal = () => get<PersonalSummary>("/personal");
export const syncPersonal = () => post<PersonalSummary & { synced: number }>("/personal/sync");

// ---- Push (alertas) ----
export const getPushKey = () => get<{ key: string }>("/push/key");
export const subscribePush = (sub: PushSubscriptionJSON) =>
  post<{ ok: boolean }>("/push/subscribe", sub);
export const testPush = () => post<{ sent: number }>("/push/test");
