"use client";

/** Omega: descubrimiento de momentum, independiente del ranker fundamental (Alpha).
 *  Nunca ejecuta en IBKR — solo alerta y sugiere, Manuel ejecuta a mano y lo reporta aquí.
 *  Ver docs/momentum-sala-real-x.md para el diseño completo. */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AuthGate from "@/components/AuthGate";
import { ApiError, getFx } from "@/lib/api";
import { money, signMoney } from "@/lib/format";
import {
  adminDetectarCandidatos, adminScan, getAlertas, getCandidatos, getCuenta, getGateConfig,
  getHistorial, getPreciosVivos, getRegimen, getScanProgreso, getValidacion, setGateConfig,
} from "./api";
import type { GateProvider, ScanProgreso } from "./api";
import { CandidatoBuscadorModal, CandidatosTabs } from "./components/Candidatos";
import { AlertasCarrusel, GatePendienteBanner } from "./components/AlertaCard";
import { HistorialModal } from "./components/HistorialModal";
import { ActionChip, AvisoTemporal, CargarMasBtn, Collapsible, Empty, RegimenChip, Section } from "./components/ui";
import { UniversoTabla, UniversoTickerModal } from "./components/Universo";
import { costeBase, esGateRegimen, fmtFecha, fmtRet, TIPO_LABEL, tituloRegimen } from "./helpers";
import { NUMS, SANS, T } from "./tokens";
import type { Candidato, Cuenta, Regimen, Senal, Validacion } from "./types";

export default function SalaMomentum() {
  return (
    <AuthGate>
      <SalaMomentumRoom />
    </AuthGate>
  );
}

function SalaMomentumRoom() {
  const [cuenta, setCuenta] = useState<Cuenta | null>(null);
  const [alertas, setAlertas] = useState<Senal[] | null>(null);
  const [historial, setHistorial] = useState<Senal[] | null>(null);
  const [validacion, setValidacion] = useState<Validacion[] | null>(null);
  const [candidatos, setCandidatos] = useState<Candidato[] | null>(null);
  const [regimen, setRegimen] = useState<Regimen | null>(null);
  const [fx, setFx] = useState<number | null>(null);
  const [preciosVivos, setPreciosVivos] = useState<Record<string, number | null>>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState("");
  const [scanProgreso, setScanProgreso] = useState<ScanProgreso | null>(null);
  const scanPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [detectando, setDetectando] = useState(false);
  const [detectMsg, setDetectMsg] = useState("");
  const [buscadorAbierto, setBuscadorAbierto] = useState(false);
  const [histVisibles, setHistVisibles] = useState(5);
  const [detalleHistorial, setDetalleHistorial] = useState<Senal | null>(null);
  const [universoAbierto, setUniversoAbierto] = useState<Validacion | null>(null);

  // Selector MANUAL del proveedor del gate (candidatos + señales) -- persistido en el backend,
  // no en el navegador: se queda así hasta que Manuel lo cambie, sea cual sea la pestaña o el
  // dispositivo desde el que lo mire (14-sep-2026: el apagón de DeepSeek dejó el gate colgado
  // horas sin forma de saltar a Qwen).
  const [gateProvider, setGateProviderState] = useState<GateProvider | null>(null);
  const [gateProviderBusy, setGateProviderBusy] = useState(false);
  useEffect(() => { getGateConfig().then((c) => setGateProviderState(c.provider)).catch(() => {}); }, []);
  const cambiarGateProvider = async (p: GateProvider) => {
    if (p === gateProvider || gateProviderBusy) return;
    setGateProviderBusy(true);
    try {
      const r = await setGateConfig(p);
      setGateProviderState(r.provider);
    } catch { /* fallo puntual: el select vuelve al valor guardado */ }
    finally { setGateProviderBusy(false); }
  };

  // Recarga: re-pide datos y actualiza estado sin navegar ni desmontar la sala -- el scroll y
  // cualquier fila desplegada se quedan donde estaban. La primera carga (sin datos aún) usa
  // pantalla completa; un refresco posterior (botón "actualizar") pone un velo ENCIMA de lo que
  // ya hay, mismo criterio que Alpha -- consistente como bloqueo de pantalla, sin perder
  // nada de lo que el usuario tenía abierto.
  //
  // Coalescer llamadas simultáneas -- BUG real (9-sep-2026): cada acción suelta (descartar,
  // ejecutar...) aplica su parche optimista y DESPUÉS lanza `load()` en segundo plano. Si dos
  // acciones se disparan seguidas, la primera `load()` puede seguir en vuelo cuando la segunda
  // acción ya confirmó en el servidor -- esa `load()` vieja trae una foto DE ANTES del segundo
  // cambio y la pisa por completo (`setAlertas(a)` es un reemplazo total), así que la fila
  // vuelve a aparecer un instante hasta que la `load()` de la segunda acción por fin llega y la
  // quita otra vez. Fix: si ya hay una `load()` en vuelo, no lanzar otra en paralelo -- solo
  // marcar que hace falta una más, y encadenarla justo cuando la actual termine. Esa última
  // siempre arranca DESPUÉS de que todas las acciones ya confirmaran en el servidor.
  const cargandoRef = useRef(false);
  const recargaPendienteRef = useRef(false);
  const load = useCallback(async () => {
    if (cargandoRef.current) {
      recargaPendienteRef.current = true;
      return;
    }
    cargandoRef.current = true;
    try {
      const [c, a, h, v, cd, fxr, reg] = await Promise.all([
        getCuenta(), getAlertas(), getHistorial(), getValidacion(), getCandidatos(),
        getFx().catch(() => null),
        // Termómetro de régimen: informativo, si falla (yfinance caído) no debe tumbar la carga.
        getRegimen().catch(() => null),
      ]);
      setCuenta(c); setAlertas(a); setHistorial(h); setValidacion(v); setCandidatos(cd);
      if (fxr?.rate) setFx(fxr.rate);
      setRegimen(reg);
      setError("");
      // Precio en vivo (activas + descartadas que siguen en curso en el histórico): referencia
      // visual aparte, sin esperar a que responda para terminar de cargar el resto -- si
      // yfinance tarda o falla, no bloquea.
      const tickersEnVivo = Array.from(new Set([
        ...a.filter((s) => s.estado === "nueva" || s.estado === "cuidado" || s.estado === "ejecutada").map((s) => s.ticker),
        ...h.filter((s) => !s.resuelta).map((s) => s.ticker),
      ]));
      if (tickersEnVivo.length) {
        getPreciosVivos(tickersEnVivo).then(setPreciosVivos).catch(() => {});
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Sin conexión con el backend.");
    } finally {
      setLoading(false);
      setRefreshing(false);
      cargandoRef.current = false;
      if (recargaPendienteRef.current) {
        recargaPendienteRef.current = false;
        load();
      }
    }
  }, []);

  const refrescar = useCallback(() => { setRefreshing(true); load(); }, [load]);

  // Acciones sueltas (descartar, ejecutar, comprobar filtros, gate, decidir...) ya NO recargan
  // la sala entera antes de responder -- eso era el motor de "se queda colgado un segundo":
  // esperaban a IBKR (Cuenta) + precio en vivo de 17 tickers antes de mover una sola fila.
  // Ahora la propia respuesta de la acción (ya trae la fila actualizada) se aplica al momento,
  // y la recarga completa sigue en segundo plano, sin bloquear lo que ya se ve.
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

  // Rescate manual del escaneo diario (cron 16:45 ET): gratis, sin gate. Separado de
  // "actualizar" a propósito -- ese solo relee lo que ya hay, esto hace una llamada a yfinance
  // por ticker del universo.
  //
  // En segundo plano desde el 9-sep-2026 (bug real): recorrer el universo entero (~9s medidos
  // en local con 28 tickers, más en producción) podía superar el timeout de 15s del cliente --
  // el navegador daba "timeout" con el escaneo ya completado y guardado por detrás. Mismo
  // patrón lanza+sondea que el gate: `POST /admin/scan` solo arranca el hilo, y `GET
  // /scan/progreso` se sondea cada 2s hasta que termina.
  const pararScan = useCallback(() => {
    if (scanPollRef.current) { clearInterval(scanPollRef.current); scanPollRef.current = null; }
  }, []);

  const sondearScan = useCallback(async () => {
    try {
      const p = await getScanProgreso();
      setScanProgreso(p);
      if (p.status !== "running") {
        pararScan();
        setScanning(false);
        if (p.status === "done") {
          setScanMsg(`${p.nuevas} señal(es) nueva(s) de ${p.total} ticker(s) revisado(s).`);
          load();
        } else if (p.status === "error") {
          setScanMsg(`Error: ${p.error}`);
        }
      }
    } catch { /* fallo puntual de red no debe cortar el sondeo */ }
  }, [load, pararScan]);

  // Al entrar (o recargar a mitad): si ya había un escaneo corriendo, retoma el sondeo solo --
  // mismo criterio que el gate (GateBanner más abajo).
  useEffect(() => {
    getScanProgreso().then((p) => {
      if (p.status === "running") { setScanning(true); scanPollRef.current = setInterval(sondearScan, 2000); }
    }).catch(() => {});
    return pararScan;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const escanear = async () => {
    setScanMsg("");
    try {
      const r = await adminScan();
      if (!r.lanzado) {
        setScanMsg(r.motivo === "ya en curso" ? "Ya había un escaneo en curso, sigo el suyo." : "");
        setScanning(true);
        scanPollRef.current = setInterval(sondearScan, 2000);
        return;
      }
      setScanning(true);
      scanPollRef.current = setInterval(sondearScan, 2000);
    } catch (e) {
      setScanMsg(e instanceof ApiError ? e.message : "No se pudo lanzar el escaneo.");
    }
  };

  // Rescate manual de la detección diaria de ApeWisdom (cron 16:10 ET): gratis, sin gate.
  const detectarCandidatos = async () => {
    setDetectando(true);
    setDetectMsg("");
    try {
      const r = await adminDetectarCandidatos();
      setDetectMsg(r.ok ? `${r.nuevos} candidato(s) nuevo(s) detectado(s).` : `Error: ${r.error}`);
      if (r.ok) await load();
    } catch (e) {
      setDetectMsg(e instanceof ApiError ? e.message : "No se pudo lanzar la detección.");
    } finally {
      setDetectando(false);
    }
  };

  useEffect(() => { load(); }, [load]);

  // "ejecutada" entra también aquí -- son las que de verdad necesitan una decisión tuya ahora
  // (cerrar o aumentar), no solo las que aún no se han tocado. Antes tenían su propia sección
  // aparte ("Posiciones abiertas", de solo lectura) que duplicaba exactamente este conjunto sin
  // dar ninguna acción -- se retiró en vez de mantener el mismo dato en dos sitios distintos.
  const activas = (alertas ?? []).filter((s) => s.estado === "nueva" || s.estado === "cuidado" || s.estado === "ejecutada");
  // Señales detectadas por el escaneo diario (gratis) que todavía no pasaron por el gate de
  // noticias (el único paso que gasta dinero real) -- ver doc §3, decidido 7-sep-2026.
  const pendientesGate = (alertas ?? []).filter((s) => s.gate_resultado == null);
  // Candidatos: solo se ven aquí mientras siguen sin decidir (corregido 8-sep-2026 -- el
  // filtro/gate no deciden por ti, solo informan). En cuanto decides Incorporar o Mantener
  // fuera, la fila sale de esta vista -- el dato sigue en la base para siempre, pero deja de
  // ocupar sitio: si incorporas, ya vive de verdad en Universo; si descartas, la decisión fue
  // con fundamento y no hace falta seguir viéndola.
  const pipelineTerminado = (c: Candidato) =>
    c.gate_pass != null || (c.filtro_sector_pass != null && (!c.filtro_sector_pass || !c.estadistica_pass));
  const candidatosActivos = (candidatos ?? []).filter((c) => c.decision === "pendiente");
  const candidatosPorRevisar = candidatosActivos.filter((c) => !pipelineTerminado(c));
  const candidatosEvaluados = candidatosActivos.filter(pipelineTerminado);
  // De los "por revisar", cuáles ya pasaron sector+estadística y solo les falta el gate -- se
  // recuerda arriba junto al otro gasto real para que no se pierdan al fondo de un acordeón.
  const candidatosListos = candidatosPorRevisar.filter((c) => c.filtro_sector_pass && c.estadistica_pass);

  // Universo activo vs apagado (apagado = mantener false; sin fila = activo).
  const universoApagados = (validacion ?? []).filter((v) => v.mantener === false).length;
  const universoCount = universoApagados > 0
    ? `${(validacion ?? []).length - universoApagados} activos · ${universoApagados} apagados`
    : (validacion ?? []).length;

  // Empate del día: 2+ señales NUEVAS con la misma fecha de entrada. Si alguna del grupo es
  // 'ambos' (zigzag+suelo coinciden), esa se recomienda; si no, se muestra el empate sin
  // destacar ninguna — decide Manuel (ver doc §4, decidido 7-sep-2026).
  const empatesPorFecha = useMemo(() => {
    const grupos = new Map<string, Senal[]>();
    for (const s of activas) {
      const g = grupos.get(s.entry_date) ?? [];
      g.push(s);
      grupos.set(s.entry_date, g);
    }
    return grupos;
  }, [activas]);

  const conectado = cuenta?.cash != null;

  if (loading) {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-3 text-[13px]"
           style={{ background: T.page, color: T.muted }}>
        <span className="h-6 w-6 animate-spin rounded-full border-2"
              style={{ borderColor: T.grid, borderTopColor: T.entry }} />
        <p>Cargando Omega…</p>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] pb-10 text-[13px] antialiased" style={{ background: T.page, color: T.ink2, fontFamily: SANS }}>
      {/* Velo de bloqueo ENCIMA de la sala (no un return que la sustituya): un refresco manual
          no debe perder el scroll ni cerrar ninguna fila desplegada. */}
      {refreshing && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 text-[13px]"
             style={{ background: `${T.page}f2` }}>
          <span className="h-6 w-6 animate-spin rounded-full border-2"
                style={{ borderColor: T.grid, borderTopColor: T.entry }} />
          <p style={{ color: T.muted }}>Actualizando…</p>
        </div>
      )}
      <div className="mx-auto max-w-[1500px] px-4 pt-6 lg:px-6">
        {/* Sin barra fija -- como la land, la navegación que hace falta vive en el flujo
            normal, no clavada arriba (feedback 12-sep-2026, "el header AI slop fuera"). */}
        <Link href="/" className="mb-4 inline-block text-[12px] transition-colors hover:underline" style={{ color: T.muted }}>
          ← Portada
        </Link>
        {scanMsg && <AvisoTemporal texto={scanMsg} onCerrar={() => setScanMsg("")} />}
        {detectMsg && <AvisoTemporal texto={detectMsg} onCerrar={() => setDetectMsg("")} />}

        {/* ---------- cabecera: eyebrow + título + descripción, como Alpha y Beta (ver /mockup).
            El badge de estado va en la MISMA fila que el símbolo, no como hermano de todo el
            bloque -- así no le da por bajar debajo de la descripción en pantallas estrechas
            (feedback 12-sep-2026). ---------- */}
        <header className="mb-6">
          <div className="flex items-center justify-between gap-4">
            <p className="flex items-center gap-2 text-[22px] font-medium"
               style={{ color: T.entry, fontFamily: "var(--font-land-serif)", fontStyle: "italic",
                        fontOpticalSizing: "none", fontVariationSettings: '"opsz" 9' }}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: error ? T.bad : T.good }} />
              Ω
            </p>
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold"
                  style={{ background: conectado ? "rgba(107,190,138,0.14)" : "rgba(250,178,25,0.14)",
                           color: conectado ? T.good : T.warn }}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: conectado ? T.good : T.warn }} />
              {conectado ? "IBKR conectado" : "IBKR sin conexión"}
            </span>
          </div>
          <h1 className="mt-1 text-[26px] font-bold" style={{ color: T.ink }}>Descubrimiento de momentum</h1>
          <p className="mt-2 max-w-[46ch] text-[14px]" style={{ color: T.ink2 }}>
            El agente detecta rupturas y sugiere; tú ejecutas a mano y lo reportas aquí.
          </p>
        </header>

        {/* Fila propia, flotando en el flujo normal -- cada acción se distingue por su texto,
            no por un color arbitrario (antes: iconos solos + leyenda aparte explicándolos). */}
        <div className="mb-6 flex flex-wrap justify-center gap-2">
          <ActionChip onClick={escanear} busy={scanning}
                      label={scanning && scanProgreso?.status === "running" && scanProgreso.total > 0
                        ? `${scanProgreso.hecho}/${scanProgreso.total}` : "Señales"}
                      title="Recalcular señales ahora (gratis, por si el cron 16:05 ET no ha corrido)">
            <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" />
          </ActionChip>
          <ActionChip onClick={detectarCandidatos} busy={detectando} label="Rupturas"
                      title="Fuerza la detección de rupturas de ApeWisdom ahora (gratis, por si el cron 16:10 ET no ha corrido). Automático: solo mira lo que ApeWisdom ya trae."
                      stroke>
            <path d="M2 13h3l2-7 3 15 3-11 2 3h5" />
          </ActionChip>
          <ActionChip onClick={() => setBuscadorAbierto(true)} label="Tickers"
                      title="Añade o revisa un ticker a mano, sin esperar a ApeWisdom" stroke>
            <circle cx="10" cy="10" r="6.5" />
            <path d="M20 20l-4.3-4.3M10 7v6M7 10h6" />
          </ActionChip>
          <ActionChip onClick={refrescar} busy={refreshing} label="Actualizar" stroke>
            <path d="M3 12a9 9 0 0 1 15.3-6.3L21 8M21 3v5h-5M21 12a9 9 0 0 1-15.3 6.3L3 16M3 21v-5h5" />
          </ActionChip>
        </div>

        {error && (
          <div className="mb-3 border-l-2 pl-3 text-[12.5px]" style={{ borderColor: T.bad, color: T.bad }}>
            {error}
          </div>
        )}

        {/* ---------- Gate pendiente: primero de todo, invisible si no hay nada que decidir --------- */}
        {pendientesGate.length > 0 && <GatePendienteBanner señales={pendientesGate} onEvaluado={load} />}
        {/* Recordatorio aparte: candidatos listos para el gate no dependen de que haya señales
            pendientes -- si no, se pierden al fondo del acordeón de Candidatos (ver doc). */}
        {candidatosListos.length > 0 && (
          <p className="mb-6 flex items-center gap-2 text-[11.5px]" style={{ color: T.muted }}>
            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: T.good }} />
            {candidatosListos.length} candidato{candidatosListos.length === 1 ? "" : "s"} de ApeWisdom ya{" "}
            {candidatosListos.length === 1 ? "pasó" : "pasaron"} sus filtros y{" "}
            {candidatosListos.length === 1 ? "espera" : "esperan"} tu gate:{" "}
            <a href="#candidatos" className="font-semibold" style={{ color: T.good }}>
              {candidatosListos.map((c) => c.ticker).join(", ")} ↓
            </a>
          </p>
        )}

        {/* ---------- Cuenta: solo lectura, no se toca -- lee como el resto de la casa (línea
            fina arriba), no como una tarjeta más apilada en el feed (feedback 12-sep-2026,
            "eso es justo el AI slop"). La caja de verdad se reserva para lo que sí es una
            unidad discreta que se toca (alertas, historial). ---------- */}
        <div className="mb-6">
          <p className="mb-3 text-[16px] font-bold tracking-tight" style={{ color: T.ink }}>Cuenta</p>
          {(() => {
            const pnlAbUsd = Number(cuenta?.pnl_abierto_usd ?? 0);
            const pnlReUsd = Number(cuenta?.pnl_realizado_usd ?? 0);
            const eur = cuenta?.cash && fx ? Number(cuenta.cash.EUR ?? 0) + Number(cuenta.cash.USD ?? 0) / fx : null;
            return (
              <div className="border-t pt-4" style={{ borderColor: T.grid }}>
                <div className="grid grid-cols-2 gap-x-5 gap-y-5">
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: T.muted }}>Capital total</div>
                    <div className={`mt-1.5 text-[22px] font-bold tracking-tight ${NUMS}`} style={{ color: T.ink }}>${money(cuenta?.desplegado_usd ?? 0)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: T.muted }}>PnL abierto</div>
                    <div className={`mt-1.5 text-[22px] font-bold tracking-tight ${NUMS}`} style={{ color: pnlAbUsd >= 0 ? T.good : T.bad }}>
                      {signMoney(pnlAbUsd)}
                    </div>
                    <div className={`mt-0.5 text-[10.5px] ${NUMS}`} style={{ color: pnlAbUsd >= 0 ? T.good : T.bad }}>
                      {fmtRet(cuenta?.pnl_abierto_pct ?? null)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: T.muted }}>PnL realizado</div>
                    <div className={`mt-1.5 text-[22px] font-bold tracking-tight ${NUMS}`} style={{ color: pnlReUsd >= 0 ? T.good : T.bad }}>
                      {signMoney(pnlReUsd)}
                    </div>
                    <div className={`mt-0.5 text-[10.5px] ${NUMS}`} style={{ color: pnlReUsd >= 0 ? T.good : T.bad }}>
                      {fmtRet(cuenta?.pnl_realizado_pct ?? null)}
                    </div>
                  </div>
                  <div>
                    {/* Antes había un tile "Cash" aparte -- era el mismo dinero que este, solo
                        que sin convertir y sin el USD sumado: redundante, se quita. */}
                    <div className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: T.muted }}>Poder compra</div>
                    <div className={`mt-1.5 text-[22px] font-bold tracking-tight ${NUMS}`} style={{ color: T.ink }}>
                      {eur != null ? `€${money(eur, 0)}` : "-"}
                    </div>
                    {eur != null && fx && (
                      <div className={`mt-0.5 text-[10.5px] ${NUMS}`} style={{ color: T.muted }}>≈ ${money(eur * fx, 0)}</div>
                    )}
                  </div>
                </div>
                <div className="mt-4 flex items-baseline justify-between border-t pt-3.5"
                     style={{ borderColor: T.grid }}
                     title={`${cuenta?.gate_llamadas ?? 0} llamada(s) real(es), señales + candidatos`}>
                  <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: T.muted }}>Gate gasto</span>
                  <span className={`text-[13px] font-bold ${NUMS}`} style={{ color: T.warn }}>
                    ${money(cuenta?.gate_gastado_usd ?? 0, 2)}
                    <span className="ml-1.5 font-normal" style={{ color: T.muted }}>· {cuenta?.gate_llamadas ?? 0} llam.</span>
                  </span>
                </div>
                <div className="mt-2.5 flex items-center justify-between"
                     title="Proveedor del gate (candidatos + señales) -- se queda así hasta que lo cambies, sin salto automático si uno falla.">
                  <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: T.muted }}>Gate modelo</span>
                  <select value={gateProvider ?? ""} disabled={gateProvider == null || gateProviderBusy}
                          onChange={(e) => cambiarGateProvider(e.target.value as GateProvider)}
                          className="rounded-md px-2 py-1 text-[11.5px] font-bold disabled:opacity-40"
                          style={{ background: T.panel2, color: T.ink, border: `1px solid ${T.grid}` }}>
                    <option value="deepseek">DeepSeek Flash</option>
                    <option value="qwen">Qwen 3.7 Flash</option>
                  </select>
                </div>
              </div>
            );
          })()}
        </div>

        {/* ---------- Alertas activas ---------- */}
        <Section title="Alertas activas" count={activas.length}>
          {regimen && <RegimenChip regimen={regimen} />}
          <p className="mb-2 text-[10.5px]" style={{ color: T.muted }}>
            Sin caducidad: pasados 21 días se marcan &quot;cuidado&quot; (p75 de días-a-objetivo entre las ganadoras históricas).
          </p>
          {activas.length === 0 ? (
            <Empty>Ninguna señal sin resolver ahora mismo.</Empty>
          ) : (
            <AlertasCarrusel alertas={activas} empates={empatesPorFecha} preciosVivos={preciosVivos} regimen={regimen} onCambio={actualizarAlerta} />
          )}
        </Section>

        {/* ---------- Historial de señales ---------- */}
        <Section title="Historial de señales" count={historial?.length ?? 0}>
          <p className="mb-2 text-[10.5px]" style={{ color: T.muted }}>
            Señales ya resueltas más las que descartaste y siguen en curso (para ver &quot;la
            dejé pasar y habría hecho X%&quot;). El check marca si la ejecutaste de verdad.
          </p>
          <div className="border-t" style={{ borderColor: T.grid }}>
            {(historial ?? []).slice(0, histVisibles).map((s, i) => {
              const ejecutada = s.estado === "ejecutada" || s.estado === "vendida";
              // Vendida a mano pero el job diario aún no la resolvió (`resuelta === false`): el
              // resultado REAL es `cierre_manual`, no "en curso" -- ya no hay nada en marcha que
              // seguir con precio en vivo (bug real, 15-sep-2026).
              const cerradaAMano = s.estado === "vendida" && !s.resuelta && s.cierre_manual != null;
              const enCurso = !s.resuelta && !cerradaAMano;
              // En curso: retorno en vivo contra TU coste real si la ejecutaste (`costeBase`),
              // si no contra la entrada de la señal (descartada, o pendiente) -- igual que en
              // Alertas activas. Si yfinance no responde, cae al ret guardado.
              const vivo = preciosVivos[s.ticker];
              const ret = cerradaAMano
                ? Number(s.cierre_manual!.ret)
                : enCurso && vivo != null
                  ? (vivo / costeBase(s) - 1) * 100
                  : Number(s.ret);
              return (
                <div key={s.id} onClick={() => setDetalleHistorial(s)}
                     className="flex cursor-pointer items-center gap-3 px-3.5 py-3 transition-colors hover:bg-white/5"
                     style={i > 0 ? { borderTop: `1px solid ${T.grid}` } : undefined}>
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border"
                        style={ejecutada
                          ? { background: T.entry, borderColor: T.entry }
                          : { borderColor: T.ring }}
                        title={ejecutada ? "La ejecutaste" : enCurso ? "Descartada, sigue en seguimiento" : "No se ejecutó"}>
                    {ejecutada && (
                      <svg viewBox="0 0 16 16" className="h-3 w-3" stroke="#fff" fill="none" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3.5 8.5l3 3 6-7" />
                      </svg>
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <b style={{ color: T.ink }}>{s.ticker}</b>
                    {s.mantener === false && <span className="ml-1.5 text-[9px]" style={{ color: T.warn }}>apagado</span>}
                    {esGateRegimen(s) && (
                      <span className="ml-1.5 text-[9px]" style={{ color: T.bad }} title={tituloRegimen(s, regimen)}>
                        ⛔ régimen
                      </span>
                    )}
                    <span className="ml-2 text-[11px]" style={{ color: T.muted }}>
                      {TIPO_LABEL[s.tipo]} · {fmtFecha(s.entry_date)}
                    </span>
                  </div>
                  <div className="text-right">
                    <div className={`font-bold ${NUMS}`} style={{ color: ret >= 0 ? T.good : T.bad }}>
                      {fmtRet(ret)}
                    </div>
                    <div className="text-[9.5px]" style={{ color: enCurso ? T.warn : T.muted }}>
                      {enCurso ? `en curso · ${s.dias}d` : cerradaAMano ? "cerrada a mano" : s.motivo}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {(historial?.length ?? 0) > histVisibles && (
            <CargarMasBtn onClick={() => setHistVisibles((n) => n + 5)}
                          restantes={(historial?.length ?? 0) - histVisibles} />
          )}
        </Section>

        {/* ---------- Candidatos: "por revisar" + "evaluados" en un módulo, dos pestañas
            (antes eran dos acordeones separados) -- justo antes de Universo, que es a donde
            van a parar si se incorporan. */}
        <div id="candidatos">
          <Collapsible title="Candidatos" count={`${candidatosPorRevisar.length} por revisar · ${candidatosEvaluados.length} evaluados`}>
            <p className="px-3.5 pb-2 pt-3 text-[11px] leading-relaxed" style={{ color: T.muted }}>
              Tickers fuera del universo fijo, con dos entradas posibles: ApeWisdom los trae solo
              (&quot;Detectar rupturas&quot;, menciones sociales) o los metes tú a mano
              (&quot;Añadir ticker&quot;). Sector y estadística son automáticos; el gate es la
              única llamada real, siempre candidato a candidato.
            </p>
            <CandidatosTabs porRevisar={candidatosPorRevisar} evaluados={candidatosEvaluados} onCambio={actualizarCandidato} />
          </Collapsible>
        </div>

        {/* ---------- Universo: fusiona "Validación histórica" + "Universo vigilado" en una
            sola tabla (antes los mismos 34 tickers se repetían en dos acordeones) ---------- */}
        <Collapsible title="Universo" count={universoCount}>
          <p className="px-3.5 pb-2 pt-3 text-[11px] leading-relaxed" style={{ color: T.muted }}>
            Cada ticker con su resultado real acumulado. Apagar uno lo saca de alertas y recuentos
            pero se sigue escaneando, para ver si mejora y quieres reactivarlo.
          </p>
          <UniversoTabla validacion={validacion ?? []} onAbrir={setUniversoAbierto} />
        </Collapsible>
      </div>
      {buscadorAbierto && (
        <CandidatoBuscadorModal onClose={() => setBuscadorAbierto(false)} onCambio={actualizarCandidato} />
      )}
      {detalleHistorial && (
        <HistorialModal s={detalleHistorial} precioVivo={preciosVivos[detalleHistorial.ticker] ?? null}
                        regimen={regimen} onClose={() => setDetalleHistorial(null)} />
      )}
      {universoAbierto && (
        // Fuera de <table>/<tbody> a propósito (bug real: un <div fixed> dentro de <tbody> es
        // HTML inválido y React lo marca como error de hidratación) -- mismo patrón que
        // `HistorialModal` arriba, la fila solo dispara `onAbrir`.
        <UniversoTickerModal v={universoAbierto} alertas={alertas ?? []} historial={historial ?? []}
                            preciosVivos={preciosVivos} onCambio={actualizarValidacion}
                            onClose={() => setUniversoAbierto(null)} />
      )}
    </div>
  );
}
