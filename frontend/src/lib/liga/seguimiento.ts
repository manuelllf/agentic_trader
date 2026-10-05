import { llamar, type RentabilidadAcumulada } from "./api";

export type ResultadoReciente = {
  inscripcion_id: number;
  jornada_id: number;
  dia_fin: string;
  rentabilidad: number;
  sp500: number;
  diferencia_sp: number;
};

export type CambioCartera = {
  jornada_anterior_id: number;
  jornada_actual_id: number;
  tickers_anteriores: string[];
  tickers_actuales: string[];
  entradas: string[];
  salidas: string[];
  nueva_desde_revision: boolean;
};

export type SeguimientoEstrategia = {
  estrategia_id: string;
  nombre: string;
  estado: string;
  primera_revision: boolean;
  resultado_nuevo: boolean;
  ultima_inscripcion_id: number | null;
  ultimo_resultado_inscripcion_id: number | null;
  ultima_revision_inscripcion_id: number | null;
  ultima_revision_resultado_inscripcion_id: number | null;
  acumulado: RentabilidadAcumulada | null;
  resultado: ResultadoReciente | null;
  cambio_cartera: CambioCartera | null;
  cambio_desde_revision?: CambioCartera | null;
  sin_pregunta?: MotivoSinPregunta | null;
  quitadas_vaciadas?: boolean;
};

export type MotivoSinPregunta = "sin_ia" | "tope" | "incompleta" | "tiempo";

export type CursorRevision = {
  estrategia_id: string;
  inscripcion_id: number | null;
  resultado_inscripcion_id: number | null;
};

export function getSeguimiento() {
  return llamar<SeguimientoEstrategia[]>("/liga/seguimiento");
}

export function marcarSeguimientos(items: CursorRevision[]) {
  return llamar<{ actualizadas: number }>("/liga/seguimiento/revisado", {
    method: "POST", body: JSON.stringify({ items }),
  });
}
