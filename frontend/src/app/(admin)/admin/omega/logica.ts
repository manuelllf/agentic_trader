// Lógica pura de la sala Omega (sin JSX ni estado): qué señal va a qué lista, a qué candidato le falta qué
// y los retornos que se enseñan. Aparte de helpers.ts, que solo formatea.
import { costeBase } from "./helpers";
import type { Candidato, Cuenta, Senal } from "./types";

export const esAlertaPendiente = (s: Senal) => s.estado === "nueva" || s.estado === "cuidado";
export const esPosicion = (s: Senal) => s.estado === "ejecutada";
/** Una señal sigue teniendo pantalla propia mientras está pendiente o abierta. */
export const esViva = (s: Senal) => esAlertaPendiente(s) || esPosicion(s);

export function separarAlertas(alertas: Senal[]) {
  return {
    pendientes: alertas.filter(esAlertaPendiente),
    posiciones: alertas.filter(esPosicion),
    // El gate es el único paso de pago: las que aún no lo pasaron esperan a que Manuel lo lance.
    sinGate: alertas.filter((s) => s.gate_resultado == null),
  };
}

/** Empate del día: 2+ señales nuevas con la misma fecha de entrada. */
export function empatesPorFecha(pendientes: Senal[]): Map<string, Senal[]> {
  const grupos = new Map<string, Senal[]>();
  for (const s of pendientes) {
    const g = grupos.get(s.entry_date) ?? [];
    g.push(s);
    grupos.set(s.entry_date, g);
  }
  return grupos;
}

/** Terminado = ya no hay más pasos automáticos: falló sector o estadística, o el gate ya respondió. */
export const pipelineTerminado = (c: Candidato) =>
  c.gate_pass != null || (c.filtro_sector_pass != null && (!c.filtro_sector_pass || !c.estadistica_pass));

export const listoParaGate = (c: Candidato) =>
  c.filtro_sector_pass != null && !!c.filtro_sector_pass && !!c.estadistica_pass && c.gate_pass == null;

/** Solo antes del gate: un fallo de sector o estadística puede ser un yfinance caído, no un veredicto. */
export const puedeReintentar = (c: Candidato) =>
  c.gate_pass == null && c.filtro_sector_pass != null && (!c.filtro_sector_pass || !c.estadistica_pass);

export function clasificarCandidatos(candidatos: Candidato[]) {
  const activos = candidatos.filter((c) => c.decision === "pendiente");
  const porRevisar = activos.filter((c) => !pipelineTerminado(c));
  return {
    porRevisar,
    evaluados: activos.filter(pipelineTerminado),
    // Pasaron sector y estadística y solo les falta el gate de pago.
    listos: porRevisar.filter((c) => c.filtro_sector_pass && c.estadistica_pass),
  };
}

/** Lo que de media ha costado cada llamada del gate hasta ahora; null si aún no hay ninguna. */
export function costePorLlamada(cuenta: Cuenta | null): number | null {
  if (!cuenta || !cuenta.gate_llamadas) return null;
  const media = Number(cuenta.gate_gastado_usd) / cuenta.gate_llamadas;
  return Number.isFinite(media) ? media : null;
}

/** Retorno de una alerta o posición: en vivo contra tu coste real si hay precio, si no el guardado. */
export function retornoVivo(s: Senal, precioVivo: number | null): number {
  return precioVivo != null ? (precioVivo / costeBase(s) - 1) * 100 : Number(s.ret);
}

export interface ResultadoHistorial {
  ret: number;
  enCurso: boolean;
  cerradaAMano: boolean;
  /** Lo que habría hecho el sistema solo, cuando se cerró a mano. */
  soloSistema: number | null;
}

export function resultadoHistorial(s: Senal, precioVivo: number | null): ResultadoHistorial {
  const cerradaAMano = s.estado === "vendida" && s.cierre_manual != null;
  const enCurso = !s.resuelta && !cerradaAMano;
  const soloSistema = cerradaAMano && s.cierre_manual!.ret_sistema != null ? Number(s.cierre_manual!.ret_sistema) : null;
  const ret = cerradaAMano ? Number(s.cierre_manual!.ret) : enCurso ? retornoVivo(s, precioVivo) : Number(s.ret);
  return { ret, enCurso, cerradaAMano, soloSistema };
}

/** Número tecleado a mano: acepta coma decimal. NaN si no es un número. */
export function numeroTecleado(texto: string): number {
  const limpio = texto.trim().replace(",", ".");
  return limpio === "" ? NaN : Number(limpio);
}
