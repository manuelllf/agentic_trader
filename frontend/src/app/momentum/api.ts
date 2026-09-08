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

// Etapas 1+2 (sector + estadística), gratis -- a demanda, candidato a candidato.
export const comprobarFiltrosCandidato = (id: number) =>
  post<Candidato>(`/momentum/candidatos/${id}/comprobar-filtros`);

// Única llamada real del candidato -- siempre uno a uno, nunca en bloque (ver page.tsx).
export const lanzarGateCandidato = (id: number) =>
  post<Candidato>(`/momentum/candidatos/${id}/gate`);

export const setMantenerUniverso = (ticker: string, mantener: boolean) =>
  post<{ ok: boolean; mantener: boolean }>(`/momentum/universo/${ticker}/mantener`, { mantener });

// `ids`: las señales que Manuel eligió (nunca "todas" a ciegas). El endpoint solo LANZA el
// gate en segundo plano y responde al momento -- el progreso real se sondea con `getGateProgreso()`.
export const lanzarGate = (ids: number[]) =>
  post<{ lanzado: boolean; motivo?: string; pendientes: number }>(
    "/momentum/gate/evaluar-pendientes", { ids },
  );

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

// Rescate manual de la detección diaria de ApeWisdom -- mismo criterio que adminScan.
export const adminDetectarCandidatos = () =>
  post<{ ok: boolean; nuevos?: number; error?: string }>("/momentum/admin/candidatos-detectar");

// Alta manual de un candidato que Manuel detectó por su cuenta, sin esperar a ApeWisdom.
export const crearCandidatoManual = (ticker: string) =>
  post<Candidato>("/momentum/candidatos", { ticker });

// Busca la fila más reciente de un ticker si ya existe (`null` si nunca se vio) -- para el
// buscador del header: encuentra lo que ya hay antes de crear uno nuevo.
export const buscarCandidato = (ticker: string) =>
  get<Candidato | null>(`/momentum/candidatos/buscar?ticker=${encodeURIComponent(ticker)}`);
