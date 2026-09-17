// Helpers puros de Omega (sin JSX, sin estado): formateo, derivados de una señal y las
// distancias contra ATH/pico local. Compartidos entre page.tsx y los componentes.
import type { Regimen, Senal } from './types';

export const TIPO_LABEL: Record<string, string> = {
  zigzag: "zigzag", suelo: "doble suelo", ambos: "zigzag + doble suelo",
};

export function fmtFecha(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString("es-ES", { day: "numeric", month: "short" });
}

export function fmtRet(v: number | string | null): string {
  if (v == null) return "-";
  const n = Number(v);
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

// `gate_regimen` viaja como boolean o 0/1 según el driver de BD -- normaliza a un booleano real.
// Y solo cuenta si además queda el valor de la cesta congelada, para poder explicar el porqué.
export function esGateRegimen(s: Senal): boolean {
  return (s.gate_regimen === true || s.gate_regimen === 1) && s.cesta_60d != null;
}

// La etiqueta es una foto del día que nació la señal, no un aviso en vivo -- el título compara
// esa foto con la cesta de HOY (si ya cargó) para que no se lea como "cuidado, esto va mal
// ahora mismo" cuando el régimen pudo sanearse desde entonces.
export function tituloRegimen(s: Senal, regimen: Regimen | null): string {
  const nacio = `Nació con la cesta del universo a ${Number(s.cesta_60d).toFixed(1)}% (60 sesiones) -- el gate de régimen la habría bloqueado.`;
  const hoy = regimen?.cesta_60d != null ? ` Hoy la cesta está en ${regimen.cesta_60d.toFixed(1)}%.` : "";
  return `${nacio}${hoy} Foto de su día de entrada, no una alarma en vivo.`;
}

/** Precio de hoy = precio de entrada × (1 + retorno actual). El backend no lo manda aparte
 *  porque `ret` ya es mark-to-market sobre `entry_price` — se deriva aquí, no se inventa. */
export function precioHoy(s: Senal): number {
  return Number(s.entry_price) * (1 + Number(s.ret ?? 0) / 100);
}

/** Coste real de la posición: si ya la ejecutaste, lo que DE VERDAD pagaste (`ejecucion.precio`)
 *  -- no el `entry_price` teórico de la señal (bug real, 14-sep-2026: el retorno de una posición
 *  ejecutada se calculaba contra el precio de la señal en vez de tu precio de compra real, así
 *  que compras mejores que la señal salían en rojo y viceversa). Sin ejecución (todavía
 *  pendiente, o descartada) cae al `entry_price` de siempre. */
export function costeBase(s: Senal): number {
  return Number(s.ejecucion?.precio ?? s.entry_price);
}

/** Distancia extra al ATH real, solo para señales cuyo número principal ya va contra el pico
 *  local (zigzag): el ATH existe igual en esas filas, solo nunca se enseñaba. Null si no aporta
 *  nada -- falta el dato, o el pico local YA ES el ATH (mismo número dos veces es ruido). */
export function distAth(s: Senal): number | null {
  if (s.ref_label === "ATH_referencia" || s.ath == null) return null;
  const ath = Number(s.ath);
  if (!ath || Number(s.ref_price) >= ath - 0.005) return null;
  return (1 - Number(s.entry_price) / ath) * 100;
}

/** El espejo de `distAth()`: distancia extra al pico local, solo para "ambos" (el número
 *  principal ya va contra el ATH -- ver `_combinar_ambos` en signals.py). Antes ese pico se
 *  tiraba sin más al fusionar zigzag+suelo; ahora se guarda en `ref_price_pico` y se enseña
 *  igual que el caso contrario, para no perder esa referencia. */
export function distPicoLocal(s: Senal): number | null {
  if (s.ref_price_pico == null) return null;
  return -(Number(s.entry_price) / Number(s.ref_price_pico) - 1) * 100;
}

/** Distancia vs ATH SIEMPRE con valor (a diferencia de `distAth`, pensada para el badge de una
 *  sola señal): si la referencia YA es el ATH, es el mismo número que `caida_pct` -- no null. */
export function caidaVsAth(s: Senal): number | null {
  if (s.ref_label === "ATH_referencia") return Number(s.caida_pct);
  if (s.ath == null) return null;
  return (1 - Number(s.entry_price) / Number(s.ath)) * 100;
}
