// Contratos que devuelve el backend (deben coincidir con app/schemas.py y las rutas).

export interface Position {
  ticker: string;
  quantity: string;
  avg_cost: string;
  value: string;
}

export interface LedgerSnapshot {
  cash: string;
  positions_value: string;
  equity: string;
  realized_pnl: string;
  unrealized_pnl: string;
  positions: Position[];
}

export interface Macro {
  regime: "risk-on" | "neutral" | "risk-off" | "desconocido";
  spy_above_ma200: boolean | null;
  vix: number | null;
}

export interface AppConfig {
  max_positions: number;
  min_positions: number;
  max_position_pct: number;
  dry_run: boolean;
  limit_buffer_pct: number;
  approval_expiry_days: number;   // una propuesta sin decidir caduca a los N días
}

export interface ScoreRow {
  id: number;
  created_at: string;
  ticker: string;
  sector: string;
  score: number; // 1-100
  headline: string;
  report: string;
  price: number | null;
  target_price: number | null;
  held: boolean;
  on_watchlist: boolean;
}

export type TradeAction = "comprar" | "ampliar" | "mantener" | "recortar" | "vender";

export interface ProposalItem {
  ticker: string;
  action: TradeAction;
  score: number | null;
  target_weight_pct: number;
  price: string | null;
  target_price: number | null;
  upside_pct: number | null;
  target_value: string;
  target_shares: number;
  delta_shares: number;
  thesis: string;
  edge: string;
  risk: string;
}

export interface Proposal {
  id: number;
  created_at: string;
  cash_target_pct: number;
  macro_summary: string;
  items: ProposalItem[];
}

// Sin sesión, el backend anonimiza cada posición (label + P&L, sin ticker ni importes) para no
// regalar la cartera del método — de ahí que casi todo aquí sea opcional según haya sesión o no.
export interface PerfPosition {
  ticker?: string;
  label?: string;
  quantity?: string;
  avg_cost?: string;
  price?: string;
  value?: string;
  cost_basis?: string;
  unrealized_pnl: string;
  realized_pnl?: string;
  pnl_pct?: number;
  unrealized_pct?: number;
}

export interface Performance {
  since: string | null;
  cost_basis: string;
  market_value: string;
  portfolio_return_pct: number;
  spy_return_pct: number | null;
  spy_ref: number | null;    // precio del SPY en el minuto de la primera compra (persistido)
  spy_last: number | null;   // último precio del SPY
  alpha_pct: number | null;
  positions: PerfPosition[];
}

export interface ExecuteResult {
  ok: boolean;
  ticker: string;
  side: "buy" | "sell";
  quantity: string;
  price: string;
  message: string;
  ledger: LedgerSnapshot;
}

export interface WatchItem {
  ticker: string;
  score: number;
  thesis: string;
  last_seen: string;
}

// ---- Sala Real (cuenta IBKR · aprobar/rechazar) ----

export type ApprovalStatus =
  | "pending" | "executed" | "working" | "rejected" | "failed" | "expired";

export interface Approval {
  id: number;
  created_at: string | null;
  decided_at: string | null;
  status: ApprovalStatus;
  ticker: string;
  sector: string;
  action: TradeAction;
  target_weight_pct: number;
  score: number | null;
  est_price: string | null;
  target_price: number | null;
  upside_pct: number | null;
  thesis: string;
  edge: string;
  risk: string;
  macro_summary: string;
  requested_quantity: string | null;
  quantity: string | null;
  fill_price: string | null;
  result_msg: string;
  order_ref: string;
  broker_order_id: string | null;
}

export interface ApprovalsResponse {
  pending: Approval[];
  history: Approval[];
}

export interface BrokerStatus {
  mode: "dry-run" | "live";
  live: boolean;
  detail: string;
}

export interface RealPosition extends Position {
  price: string;
}

export interface RealSummary {
  cash: string;
  positions_value: string;
  equity: string;
  realized_pnl: string;
  unrealized_pnl: string;
  positions: RealPosition[];
  performance: Performance;
  broker: BrokerStatus;
  pending_count: number;
}

// ---- Cartera personal IBKR (intocable para el agente) ----

export interface PersonalPosition {
  ticker: string;
  description: string;
  asset_class: string;
  currency: string;
  quantity: string;
  avg_cost: string | null;
  price: string | null;
  value: string | null;
  unrealized_pnl: string | null;
  live: boolean;
}

export interface PersonalSummary {
  synced_at: string | null;
  total_value: string;
  total_unrealized_pnl: string;
  positions: PersonalPosition[];
}

// ---- Curva histórica (cierres diarios; índice base 100 ponderado por tiempo) ----

export interface HistoryPoint {
  date: string;             // YYYY-MM-DD (día de mercado)
  equity?: string;          // ausente en la curva real sin sesión (doble nivel)
  index: number;            // cartera, base 100 — los flujos no cuentan como rentabilidad
  spy_index: number | null; // S&P 500, base 100 el mismo día
}

export interface EquityHistory {
  book: "shadow" | "real";
  series: HistoryPoint[];
}

// ---- Portada pública (teaser de ambas salas) ----

export interface Overview {
  shadow: {
    return_pct: number | null;
    spy_pct: number | null;
    alpha_pct: number | null;
    since: string | null;
    positions: number;
  };
  real: {
    unrealized_pct: number | null;
  };
}

export interface DemoStatus {
  status: "idle" | "running" | "done" | "error";
  started_at: string | null;
  finished_at: string | null;
  result: {
    scanned: number;
    prescored: number;
    deep: number;
    watchlist: number;
    proposed: number;
    positions: number;
    cost: {
      calls: number;
      prompt_tokens: number;
      completion_tokens: number;
      cost_usd: number;
    } | null;
  } | null;
  error: string | null;
}
