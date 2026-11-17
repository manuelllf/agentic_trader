// Formas de las respuestas de backend/app/agente/api.py. El dinero y los pesos llegan como texto decimal.

export type ModoCartera = "normal" | "defensivo" | "pausa" | "parada";
export type TipoDecision = "nada" | "operar" | "revision";
export type Veredicto = "aprobada" | "rechazada" | "corregir";
export type TipoInforme = "parte_diario" | "decision" | "semanal" | "mensual" | "aviso";
export type EstadoInforme = "borrador" | "ejecutado" | "publicado";

export interface PosicionAgente {
  ticker: string; acciones: string; coste_medio: string; precio: string; valor: string; rentabilidad: string; peso: string;
}
export interface CarteraAgente {
  caja: string; valor_total: string; valor_maximo: string; caida_desde_maximo: string; posiciones: PosicionAgente[];
}
export interface OperacionCorta { ticker: string; lado: "compra" | "venta" }
export interface ResumenDecision {
  id: number; fecha: string; tipo: TipoDecision; sombra: boolean; veredicto: Veredicto | null; razonamiento: string;
  creado: string; operaciones: OperacionCorta[];
}
export interface EventoAgente {
  id: number; ocurrido: string; origen: string; tipo: string; ticker: string | null; datos: Record<string, unknown>;
}
export interface PuntoSerie { fecha: string; valor_total: string; valor_maximo: string }
export interface Despertar { fecha: string; tarea: string; hora: string }

export interface Hoy {
  estado: { parada: boolean; parada_motivo: string | null; modo: ModoCartera | null; ia_activa: boolean; sombra: boolean };
  cartera: CarteraAgente | { error: string };
  serie: PuntoSerie[];
  ultima_decision: ResumenDecision | null;
  decisiones_total: number;
  /** Hoy en Nueva York y el último día anterior con tareas. */
  dia: string;
  dia_anterior: string | null;
  eventos: EventoAgente[];
  despertares: Despertar[];
}

export type Tarea = "vigia_previo" | "ejecucion" | "preparacion" | "despertar" | "consolidacion";
export interface EjecucionTarea {
  id: number; tarea: Tarea; fecha_ny: string; estado: "en_curso" | "hecha" | "fallida";
  empezada: string; terminada: string | null; error: string | null;
}
export interface EventoDia extends EventoAgente { ejecucion_id: number | null }
/** Un día del agente: lo previsto, lo que pasó y sus decisiones. */
export interface Dia {
  fecha: string; programa: { tarea: Tarea; hora: string }[]; ejecuciones: EjecucionTarea[];
  eventos: EventoDia[]; decisiones: ResumenDecision[]; ordenes_ejecutadas: number;
}
/** La lista de seguimiento con las líneas de `screen` (columnas separadas por espacios). */
export interface Seguimiento {
  fecha_precios: string | null; columnas: string; filas: string[]; sin_precios: string[];
  fecha_fundamentales: string | null; lista: { ticker: string; motivo: string; desde: string }[];
}
export interface CicloActual { ciclo: string | null; en_curso: boolean; decision_id: number | null; items: LlamadaModelo[] }

export interface OperacionPropuesta {
  ticker: string; lado: "compra" | "venta"; importe?: string | number | null; acciones?: string | number | null;
  tesis?: string; supuestos?: string; salidas?: string; ruptura?: string; prevision_12m?: string; proximo_evento?: string | null;
}
export interface Propuesta {
  tipo?: TipoDecision; operaciones?: OperacionPropuesta[];
  violaciones?: ({ codigo?: string; detalle?: string; mensaje?: string } | string)[];
}
export interface OrdenAgente {
  id: number; ticker: string; lado: "compra" | "venta"; acciones: string | null; importe_objetivo: string | null;
  fecha_objetivo: string | null; estado: string; motivo: string | null; ejecutada_en: string | null;
  acciones_ejecutadas: string | null; precio: string | null; comision: string | null;
}
export interface DecisionDetalle {
  id: number; ejecucion_id: number | null; fecha_ny: string; tipo: TipoDecision; sombra: boolean; playbook_version_id: number | null;
  propuesta: Propuesta; razonamiento: string; previsiones: { ticker?: string; texto?: string }[];
  revisor_veredicto: Veredicto | null; revisor_motivo: string | null; modelo: string; creado: string; ordenes: OrdenAgente[];
}
export interface ListaDecisiones { items: ResumenDecision[]; siguiente: number | null }

/** Mensaje enviado al modelo, en el formato de la API de chat. */
export interface MensajeModelo { role: string; content: string; tool_call_id?: string }
export interface HerramientaPedida { id: string; function: { name: string; arguments?: string } }
/** Una llamada al modelo de `agente.llamadas_modelo`: de cada vuelta, solo lo nuevo que se envió. */
export interface LlamadaModelo {
  id: number; etapa: string; paso: number; modelo: string; enviado: MensajeModelo[]; respuesta: string | null;
  razonamiento: string | null; herramientas_pedidas: HerramientaPedida[]; coste_usd: string | null;
  latencia_ms: number | null; ok: boolean; error: string | null; creado: string;
}

export interface ResumenInforme {
  id: number; tipo: TipoInforme; fecha_ny: string; decision_id: number | null; estado: EstadoInforme; titulo: string; modelo: string | null; creado: string;
}
export interface InformeDetalle extends ResumenInforme { cuerpo: string; cifras: Record<string, unknown> }

export interface VersionFilosofia { version: number; estado: string; motivo: string | null; adoptada_en: string | null; creado: string }
export interface AgenteVista {
  filosofia: { version: number; contenido: string } | null;
  versiones: VersionFilosofia[];
  lecciones: { id: number; texto: string; decision_ids: number[]; creado: string }[];
  fichas: { ticker: string; certeza: "confirmada" | "conjetura"; version: number; actualizada: string }[];
  seguimiento: { id: number; ticker: string; motivo: string; desde: string; niveles: unknown }[];
  gasto_mes: { por_tipo: { tipo: string; coste_usd: string }[]; total_usd: string; tope_usd: string };
}
export interface Ficha {
  ticker: string; contenido: string; certeza: "confirmada" | "conjetura"; version: number; creado: string; actualizado_en: string | null;
}
export interface Control {
  parada: boolean; motivo: string | null; modo: string; actualizado_en: string | null; actualizado_por: string | null;
  ia_activa: boolean; sombra: boolean;
  /** Cambio de filosofía pendiente del revisor o en prueba; null si no hay ninguno. */
  mejora: { id: number; estado: "propuesta" | "en_sombra"; hipotesis: string; sombra_desde: string | null; sombra_hasta: string | null } | null;
  /** Hay una adopción que se puede deshacer. */
  revertible: boolean;
}
