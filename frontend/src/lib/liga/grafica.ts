// Lógica pura de la gráfica de rendimiento: periodos, normalización a 0 % y ejes.
// Sin React ni formato: todo se prueba en `grafica.test.ts`.

import type { RendimientoFicha } from "./api";

export type PuntoSerie = RendimientoFicha["serie"][number];
export type Periodo = "dia" | "semana" | "mes" | "jornada" | "total";
export const PERIODOS: Periodo[] = ["dia", "semana", "mes", "jornada", "total"];

/** Retornos diarios que exige la volatilidad anual (el mismo mínimo que el backend). */
export const OBSERVACIONES_MINIMAS = 60;

/** Cierres que hacen falta antes del primero: una semana son 5 sesiones, un mes 21. */
const SESIONES: Record<"dia" | "semana" | "mes", number> = { dia: 1, semana: 5, mes: 21 };

/** Índice donde empieza el periodo, o null si la serie no da para él. */
export function inicioPeriodo(serie: PuntoSerie[], periodo: Periodo): number | null {
  const n = serie.length;
  if (periodo === "total") return n >= 2 ? 0 : null;
  if (periodo === "jornada") {
    const ultima = serie[n - 1]?.jornada;
    if (ultima == null) return null;
    const inicio = serie.findIndex((p) => p.jornada === ultima);
    // Sin una jornada anterior, "jornada" y "total" serían la misma curva.
    return inicio > 0 && inicio < n - 1 ? inicio : null;
  }
  const inicio = n - 1 - SESIONES[periodo];
  return inicio >= 0 ? inicio : null;
}

export function periodosDisponibles(serie: PuntoSerie[]): Record<Periodo, boolean> {
  return Object.fromEntries(
    PERIODOS.map((p) => [p, inicioPeriodo(serie, p) !== null]),
  ) as Record<Periodo, boolean>;
}

/** Recorta la serie al periodo y rebasa las dos curvas a 0 % en su primer punto. */
export function ventana(serie: PuntoSerie[], periodo: Periodo): PuntoSerie[] {
  const inicio = inicioPeriodo(serie, periodo);
  if (inicio === null) return [];
  const tramo = serie.slice(inicio);
  const e0 = 1 + tramo[0].estrategia / 100;
  const s0 = 1 + tramo[0].sp500 / 100;
  return tramo.map((p) => ({
    ...p,
    estrategia: ((1 + p.estrategia / 100) / e0 - 1) * 100,
    sp500: ((1 + p.sp500 / 100) / s0 - 1) * 100,
  }));
}

/** Peor caída desde un máximo, como fracción negativa (−0,028 = −2,8 %). */
export function caidaMaxima(puntos: PuntoSerie[]): number {
  let pico = 0;
  let peor = 0;
  for (const p of puntos) {
    pico = Math.max(pico, p.estrategia);
    peor = Math.min(peor, (1 + p.estrategia / 100) / (1 + pico / 100) - 1);
  }
  return peor;
}

/** Retornos diarios que se pueden contar: los saltos (días sin cierre) no lo son. */
export function observaciones(puntos: PuntoSerie[]): number {
  return puntos.slice(1).filter((p) => !p.salto).length;
}

/** Índices (dentro de la ventana) donde empieza una jornada distinta de la anterior. */
export function inicios(puntos: PuntoSerie[]): { indice: number; jornada: number }[] {
  const salida: { indice: number; jornada: number }[] = [];
  puntos.forEach((p, i) => {
    if (i > 0 && p.jornada != null && puntos[i - 1].jornada !== p.jornada) {
      salida.push({ indice: i, jornada: p.jornada });
    }
  });
  return salida;
}

// Solo pasos que se escriben exactos con 0 o 1 decimal: la etiqueta nunca redondea una marca.
const PASOS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100];

/** Decimales con los que se escriben las marcas de un eje: 1 bajo el punto, 0 desde él. */
export function decimalesDeTicks(ticks: number[]): number {
  return ticks.length > 1 && Math.abs(ticks[1] - ticks[0]) < 1 ? 1 : 0;
}

/** Marcas redondas que cubren todo el rango y el 0 %: la primera ≤ mínimo y la última ≥ máximo. */
export function ticksLimpios(minimo: number, maximo: number): number[] {
  const lo = Math.min(minimo, 0);
  const hi = Math.max(maximo, 0);
  const holgura = (hi - lo) * 0.08 || 1;
  const paso = PASOS.find((p) => p >= (hi - lo + 2 * holgura) / 4) ?? 100;
  const ticks: number[] = [];
  let v = Math.floor((lo - holgura) / paso) * paso;
  do {
    ticks.push(Math.round(v * 1e6) / 1e6);
    v += paso;
  } while (ticks[ticks.length - 1] < hi + holgura - 1e-9);
  return ticks;
}

/** Punto más cercano a una coordenada x, dentro de `[izquierda, izquierda + ancho]`. */
export function indiceCercano(x: number, izquierda: number, ancho: number, n: number): number {
  if (n <= 1) return 0;
  const k = Math.round(((x - izquierda) * (n - 1)) / ancho);
  return Math.max(0, Math.min(n - 1, k));
}
