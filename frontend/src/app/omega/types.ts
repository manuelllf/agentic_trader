// Tipos de Omega -- deliberadamente locales, no en @/lib/types: momentum no comparte
// universo ni capital con el ranker (ver docs/momentum-sala-real-x.md).

export type Senal = {
  id: number;
  ticker: string;
  sector: string;
  tipo: "zigzag" | "suelo" | "ambos";
  entry_date: string;
  entry_price: number | string;
  ref_label: "pico_referencia" | "ATH_referencia";
  ref_price: number | string;
  caida_pct: number | string;
  resuelta: boolean | number;
  exit_date: string | null;
  ret: number | string | null;
  motivo: "objetivo" | "tiempo" | null;
  dias: number | null;
  estado: "nueva" | "cuidado" | "ejecutada" | "vendida" | "descartada";
  gate_resultado: "pasa" | "falla" | null;
  gate_detalle: string;
  cuidado?: boolean;
  mantener?: boolean;  // solo lo trae /historial: false = ticker apagado
  // Termómetro de régimen (10-sep-2026, ver app/momentum/regimen.py) congelado al nacer la
  // señal -- null = no medido (señales de antes de esta fecha). Informativo, nunca bloqueó
  // la entrada: solo dice si el gate la habría descartado SI hubiera existido ese día.
  cesta_60d?: number | string | null;
  gate_regimen?: boolean | number | null;
  // ATH real de la serie -- lo guarda `signals.py` para AMBAS familias (no solo suelo), pero
  // hasta ahora solo se enseñaba cuando ref_label era el propio ATH. En zigzag (ref_label =
  // pico_referencia) existe igual, solo no se mostraba.
  ath?: number | string | null;
  // Solo en /alertas, solo si estado === "ejecutada": lo que se escribió de verdad al marcar
  // la señal como ejecutada (tabla aparte `momentum_ejecuciones`, antes se guardaba y nunca se
  // volvía a mostrar en ningún sitio -- ver Ejecucion más abajo).
  ejecucion?: Ejecucion | null;
};

export type Ejecucion = {
  acciones: number | string;
  precio: number | string;
  comision: number | string;
  notas: string;
  ejecutada_at: string;
};

// Termómetro de régimen EN VIVO -- GET /momentum/regimen, ver app/momentum/regimen.py.
export type Regimen = {
  cesta_60d: number | null;
  umbral: number;
  activo: boolean;
};

export type Validacion = {
  ticker: string;
  sector: string;
  n: number;
  media: number | null;
  mediana: number | null;
  pct_positivas: number | null;
  mantener: boolean;
};

export type Candidato = {
  id: number;
  ticker: string;
  nombre: string;
  fecha_evaluacion: string;
  filtro_sector_pass: boolean | number | null;
  filtro_sector_detalle: string;
  estadistica_pass: boolean | number | null;
  estadistica_detalle: string;
  gate_pass: boolean | number | null;
  gate_detalle: string;
  decision: "incorporado" | "descartado" | "pendiente";
  decidido_por: "sistema" | "manual";
};

export type Cuenta = {
  cash: Record<string, string> | null;
  desplegado_usd: string;
  tope_usd: string;
  libre_usd: string;
  gate_gastado_usd: string;
  gate_llamadas: number;
  pnl_abierto_usd: string;
  pnl_abierto_pct: string;
  pnl_realizado_usd: string;
  pnl_realizado_pct: string;
};

export type UniversoTicker = { ticker: string; sector: string; mantener: boolean };
