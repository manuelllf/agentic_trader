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

export type ReasoningEffort = "none" | "low" | "high" | "max";

export interface LlmStageDefault {
  model: string;
  reasoning_effort: ReasoningEffort;
  temperature: number;
}

export interface AppConfig {
  max_positions: number;
  min_positions: number;
  max_position_pct: number;
  dry_run: boolean;
  limit_buffer_pct: number;
  approval_expiry_days: number;   // una propuesta sin decidir caduca a los N días
  llm_defaults: {
    prescore: LlmStageDefault;
    mid: LlmStageDefault;
    deep: LlmStageDefault;
    constructor: LlmStageDefault;
  };
}

/** Override de una etapa para el modal de configuración de la simulación (Alpha). Todo
 *  opcional: lo que no venga usa el default de producción (ver `AppConfig.llm_defaults`). */
export interface StageLLMOverride {
  model?: string;
  reasoning_effort?: ReasoningEffort;
  temperature?: number;
  top_p?: number;
}

export interface DemoRunOverrides {
  prescore?: StageLLMOverride;
  mid?: StageLLMOverride;
  deep?: StageLLMOverride;
  constructor?: StageLLMOverride;
}

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
  omega: {
    // Retorno combinado (abierto + realizado) sobre el capital EXTERNO de verdad aportado a
    // Omega -- no la suma de los dos porcentajes por separado, ni el coste bruto de cada
    // compra: si reinviertes lo ganado, esa parte no cuenta como aportación nueva (ver
    // `capital.retorno_combinado` en el backend). Solo el %, nunca importes ni posiciones.
    return_pct: number | null;
  };
}

export interface DemoStatus {
  status: "idle" | "running" | "done" | "error" | "cancelled";
  started_at: string | null;
  finished_at: string | null;
  // Qué escaneo corre/corrió: false=observatorio, true=decisión, null=nada -- decide qué botón
  // de cancelar (cada uno el suyo) tiene sentido mostrar.
  decide: boolean | null;
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

// ---- Explorador de universo (filtro sobre las fotos de fundamentales, DuckDB) ----
export interface ExplorerFiltros {
  fecha_desde?: string;
  fecha_hasta?: string;
  alcance?: "global" | "escaneo";
  sector?: string[];
  industria?: string[];
  pais?: string[];
  mercado?: string[];
  q?: string;
  market_cap_min?: number;
  market_cap_max?: number;
  price_min?: number;
  price_max?: number;
  pe_trailing_min?: number;
  pe_trailing_max?: number;
  pe_forward_min?: number;
  pe_forward_max?: number;
  cerca_max_pct?: number;
}
export interface ExplorerOpciones {
  sectores: string[];
  industrias: string[];
  paises: string[];
  mercados: string[];
}
export interface ExplorerDistribucion { p25: number; p50: number; p75: number }
export interface ExplorerContar {
  total: number;
  distribuciones: Partial<Record<"market_cap_usd" | "price" | "pe_trailing" | "pe_forward", ExplorerDistribucion>>;
}
export interface ExplorerTickerRow {
  ticker: string;
  captured_at: string;
  name: string | null;
  sector: string | null;
  industry: string | null;
  currency: string | null;
  price: number | null;
  market_cap_usd: number | null;
  pe_trailing: number | null;
  pe_forward: number | null;
  high_52w: number | null;
  low_52w: number | null;
  country: string | null;
  exchange: string | null;
}
export interface ExplorerTickers { items: ExplorerTickerRow[]; total: number }

export interface ScanFull {
  at: string;
  cadence: string;
  decide: boolean;
  regime: string;
  vix: number | null;
  outlook: string;
  macro_calendario: string;
  macro_eventos: string;
  macro_titulares: { fuente: string; texto: string }[];
}
