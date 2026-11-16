"use client";

// Datos y procesos de la sala Omega: la carga con sus parches al instante, el escaneo y la detección de rupturas
// (gratis, en segundo plano), el gate de pago con su progreso y el proveedor del gate.
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ApiError, getFx } from "@/lib/api";
import {
  adminDetectarCandidatos, adminScan, getAlertas, getCandidatos, getCuenta, getGateConfig, getGateProgreso, getHistorial,
  getPreciosVivos, getRegimen, getScanProgreso, getValidacion, lanzarGate, setGateConfig,
} from "./api";
import type { GateProgreso, GateProvider, ScanProgreso } from "./api";
import type { Candidato, Cuenta, Regimen, Senal, Validacion } from "./types";

const AVISO_MS = 6000;

/** Mensaje que se borra solo a los 6 segundos. */
export function useMensajeTemporal(): [string, (texto: string) => void] {
  const [texto, setTexto] = useState("");
  useEffect(() => {
    if (!texto) return;
    const id = setTimeout(() => setTexto(""), AVISO_MS);
    return () => clearTimeout(id);
  }, [texto]);
  return [texto, setTexto];
}

export function useOmega() {
  const t = useTranslations();
  const [cuenta, setCuenta] = useState<Cuenta | null>(null);
  const [cuentaLista, setCuentaLista] = useState(false);
  const [alertas, setAlertas] = useState<Senal[] | null>(null);
  const [historial, setHistorial] = useState<Senal[] | null>(null);
  const [validacion, setValidacion] = useState<Validacion[] | null>(null);
  const [candidatos, setCandidatos] = useState<Candidato[] | null>(null);
  const [regimen, setRegimen] = useState<Regimen | null>(null);
  const [fx, setFx] = useState<number | null>(null);
  const [preciosVivos, setPreciosVivos] = useState<Record<string, number | null>>({});
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(true);
  const [refrescando, setRefrescando] = useState(false);

  // Si ya hay una carga en vuelo no se lanza otra en paralelo: se marca que hace falta una más y se encadena al
  // terminar. Una carga vieja traería una foto anterior a la última acción y pisaría el parche (la fila reaparecía).
  const cargandoRef = useRef(false);
  const recargaPendienteRef = useRef(false);
  const load = useCallback(async () => {
    if (cargandoRef.current) { recargaPendienteRef.current = true; return; }
    cargandoRef.current = true;
    // La cuenta (IBKR real) tarda varios segundos y no debe retrasar lo que ya está listo.
    getCuenta().then(setCuenta).catch(() => {}).finally(() => setCuentaLista(true));
    try {
      const [a, h, v, cd, fxr, reg] = await Promise.all([
        getAlertas(), getHistorial(), getValidacion(), getCandidatos(),
        getFx().catch(() => null),
        // El termómetro de régimen es informativo: si falla no debe tumbar la carga.
        getRegimen().catch(() => null),
      ]);
      if (!recargaPendienteRef.current) {
        setAlertas(a); setHistorial(h); setValidacion(v); setCandidatos(cd);
        if (fxr?.rate) setFx(fxr.rate);
        setRegimen(reg);
        setError("");
        const enVivo = Array.from(new Set([
          ...a.filter((s) => s.estado === "nueva" || s.estado === "cuidado" || s.estado === "ejecutada").map((s) => s.ticker),
          ...h.filter((s) => !s.resuelta).map((s) => s.ticker),
        ]));
        if (enVivo.length) getPreciosVivos(enVivo).then(setPreciosVivos).catch(() => {});
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("omega_connection_failed"));
    } finally {
      setCargando(false);
      setRefrescando(false);
      cargandoRef.current = false;
      if (recargaPendienteRef.current) {
        recargaPendienteRef.current = false;
        load();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { load(); }, [load]);

  const refrescar = useCallback(() => { setRefrescando(true); load(); }, [load]);

  // Las acciones sueltas aplican al momento la fila que devuelve el servidor y recargan después, sin bloquear.
  const actualizarAlerta = useCallback((id: number, patch: Partial<Senal>) => {
    setAlertas((prev) => prev?.map((a) => (a.id === id ? { ...a, ...patch } : a)) ?? prev);
    load();
  }, [load]);
  const actualizarCandidato = useCallback((c: Candidato) => {
    setCandidatos((prev) => prev?.map((x) => (x.id === c.id ? c : x)) ?? prev);
    load();
  }, [load]);
  const actualizarValidacion = useCallback((ticker: string, patch: Partial<Validacion>) => {
    setValidacion((prev) => prev?.map((v) => (v.ticker === ticker ? { ...v, ...patch } : v)) ?? prev);
    load();
  }, [load]);

  // ---- Escaneo diario a mano (gratis): arranca el hilo y se sondea cada 2 s hasta que termina ----
  const [escaneando, setEscaneando] = useState(false);
  const [escaneoProgreso, setEscaneoProgreso] = useState<ScanProgreso | null>(null);
  const [escaneoMsg, setEscaneoMsg] = useMensajeTemporal();
  const escaneoRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pararEscaneo = useCallback(() => {
    if (escaneoRef.current) { clearInterval(escaneoRef.current); escaneoRef.current = null; }
  }, []);
  const sondearEscaneo = useCallback(async () => {
    try {
      const p = await getScanProgreso();
      setEscaneoProgreso(p);
      if (p.status !== "running") {
        pararEscaneo();
        setEscaneando(false);
        if (p.status === "done") {
          setEscaneoMsg(t("omega_scan_new_signals", { nuevas: p.nuevas, total: p.total }));
          load();
        } else if (p.status === "error") {
          setEscaneoMsg(t("pnl_omega_error", { detalle: p.error ?? "" }));
        }
      }
    } catch { /* un fallo puntual de red no corta el sondeo */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, pararEscaneo]);
  const empezarSondeoEscaneo = useCallback(() => {
    pararEscaneo();
    setEscaneando(true);
    escaneoRef.current = setInterval(sondearEscaneo, 2000);
  }, [pararEscaneo, sondearEscaneo]);

  // Al entrar (o recargar a mitad) retoma el sondeo si ya había un escaneo corriendo.
  useEffect(() => {
    getScanProgreso().then((p) => { if (p.status === "running") { setEscaneoProgreso(p); empezarSondeoEscaneo(); } }).catch(() => {});
    return pararEscaneo;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const escanear = useCallback(async () => {
    setEscaneoMsg("");
    try {
      const r = await adminScan();
      if (!r.lanzado) setEscaneoMsg(r.motivo === "ya en curso" ? t("omega_existing_scan") : "");
      empezarSondeoEscaneo();
    } catch (e) {
      setEscaneoMsg(e instanceof ApiError ? e.message : t("omega_scan_failed"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empezarSondeoEscaneo]);

  // ---- Detección diaria de ApeWisdom a mano (gratis) ----
  const [detectando, setDetectando] = useState(false);
  const [deteccionMsg, setDeteccionMsg] = useMensajeTemporal();
  const detectar = useCallback(async () => {
    setDetectando(true);
    setDeteccionMsg("");
    try {
      const r = await adminDetectarCandidatos();
      setDeteccionMsg(r.ok ? t("pnl_omega_rupturas_nuevas", { count: r.nuevos ?? 0 }) : t("pnl_omega_error", { detalle: r.error ?? "" }));
      if (r.ok) await load();
    } catch (e) {
      setDeteccionMsg(e instanceof ApiError ? e.message : t("omega_detection_failed"));
    } finally {
      setDetectando(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  // ---- Proveedor del gate: se guarda en el backend y se queda hasta que se cambie, sin salto automático ----
  const [gateProvider, setGateProvider] = useState<GateProvider | null>(null);
  const [gateProviderOcupado, setGateProviderOcupado] = useState(false);
  useEffect(() => { getGateConfig().then((c) => setGateProvider(c.provider)).catch(() => {}); }, []);
  const cambiarGateProvider = useCallback(async (p: GateProvider) => {
    if (p === gateProvider || gateProviderOcupado) return;
    setGateProviderOcupado(true);
    try {
      const r = await setGateConfig(p);
      setGateProvider(r.provider);
    } catch { /* fallo puntual: se queda el valor guardado */ }
    finally { setGateProviderOcupado(false); }
  }, [gateProvider, gateProviderOcupado]);

  return {
    cuenta, cuentaLista, alertas, historial, validacion, candidatos, regimen, fx, preciosVivos, error, cargando, refrescando,
    recargar: load, refrescar, actualizarAlerta, actualizarCandidato, actualizarValidacion,
    escaneo: { activo: escaneando, progreso: escaneoProgreso, mensaje: escaneoMsg, lanzar: escanear },
    rupturas: { activo: detectando, mensaje: deteccionMsg, lanzar: detectar },
    gateProvider, gateProviderOcupado, cambiarGateProvider,
  };
}

/** Gate de pago de señales (una o varias): lanza, sondea cada 3 s y avisa al terminar. Solo corre uno a la vez en el backend. */
export function useGate(alTerminar: () => void) {
  const t = useTranslations();
  const [progreso, setProgreso] = useState<GateProgreso | null>(null);
  const [error, setError] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const terminarRef = useRef(alTerminar);
  terminarRef.current = alTerminar;

  const parar = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);
  const sondear = useCallback(async () => {
    try {
      const p = await getGateProgreso();
      setProgreso(p);
      if (p.status === "running") {
        if (!pollRef.current) pollRef.current = setInterval(sondear, 3000);
        return;
      }
      parar();
      if (p.status === "error") setError(p.error ?? t("omega_gate_failed"));
      terminarRef.current();
    } catch { /* un fallo puntual de red no corta el sondeo */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parar]);

  // Al entrar (o recargar a mitad) retoma el sondeo si ya había un gate corriendo.
  useEffect(() => {
    getGateProgreso().then((p) => {
      setProgreso(p);
      if (p.status === "running") pollRef.current = setInterval(sondear, 3000);
    }).catch(() => {});
    return parar;
  }, [sondear, parar]);

  const lanzar = useCallback(async (ids: number[]) => {
    setError("");
    try {
      const r = await lanzarGate(ids);
      if (!r.lanzado) {
        setError(r.motivo === "ya en curso" ? t("omega_gate_busy") : t("omega_gate_failed"));
        await sondear();
        return;
      }
      setProgreso({ status: "running", total: ids.length, hecho: 0, ok: 0, fail: 0, ticker_actual: null, error: null });
      parar();
      pollRef.current = setInterval(sondear, 3000);
    } catch {
      setError(t("omega_gate_failed"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sondear, parar]);

  return { progreso, corriendo: progreso?.status === "running", error, lanzar };
}
