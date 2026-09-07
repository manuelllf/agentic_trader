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

export type ResultadoGate = { id: number; ticker: string; pasa: boolean | null; motivo: string };
export const evaluarPendientesGate = () =>
  post<{ evaluadas: number; resultados: ResultadoGate[] }>("/momentum/gate/evaluar-pendientes");
