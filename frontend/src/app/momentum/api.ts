// Cliente HTTP de Sala Real X -- reusa `get`/`post` de @/lib/api (mismo token/timeout/401
// que el resto de la app) sin compartir tipos ni endpoints con el ranker.
import { get, post } from "@/lib/api";
import type { Candidato, Cuenta, Senal, UniversoTicker, Validacion } from "./types";

export const getCuenta = () => get<Cuenta>("/momentum/cuenta");
export const getAlertas = () => get<Senal[]>("/momentum/alertas");
export const getHistorial = () => get<Senal[]>("/momentum/historial");
export const getValidacion = () => get<Validacion[]>("/momentum/validacion");
export const getCandidatos = () => get<Candidato[]>("/momentum/candidatos");
export const getUniverso = () => get<UniversoTicker[]>("/momentum/universo");

export type EjecutarBody = {
  accion: "compra" | "venta";
  acciones: number;
  precio: number;
  comision: number;
  notas?: string;
};
export const ejecutarSenal = (id: number, body: EjecutarBody) =>
  post<{ ok: boolean; estado: string }>(`/momentum/senales/${id}/ejecutar`, body);

export const descartarSenal = (id: number) =>
  post<{ ok: boolean; estado: string }>(`/momentum/senales/${id}/descartar`);

export const decidirCandidato = (id: number, decision: "incorporado" | "descartado") =>
  post<{ ok: boolean; decision: string }>(`/momentum/candidatos/${id}/decision`, { decision });

export const setMantenerUniverso = (ticker: string, mantener: boolean) =>
  post<{ ok: boolean; mantener: boolean }>(`/momentum/universo/${ticker}/mantener`, { mantener });

// El endpoint solo LANZA el gate en segundo plano y responde al momento -- 17 llamadas reales
// en serie tardan minutos, así que el progreso real se sondea aparte con `getGateProgreso()`.
export const lanzarGate = () =>
  post<{ lanzado: boolean; motivo?: string; pendientes: number }>("/momentum/gate/evaluar-pendientes");

export type GateProgreso = {
  status: "idle" | "running" | "done" | "error";
  total: number;
  hecho: number;
  ok: number;
  fail: number;
  ticker_actual: string | null;
  error: string | null;
};
export const getGateProgreso = () => get<GateProgreso>("/momentum/gate/progreso");

// Rescate manual del escaneo diario (cron 16:45 ET) -- gratis, sin gate, por si el cron no ha
// corrido todavía o falló. Separado de "actualizar" a propósito: ese solo relee lo que ya hay.
export const adminScan = () =>
  post<{ ok: boolean; nuevas?: number; total_universo?: number; error?: string }>("/momentum/admin/scan");
