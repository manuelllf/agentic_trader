"use client";
import { useLocale, useTranslations } from "next-intl";
/** Omega: descubrimiento de momentum, independiente del ranker fundamental (Alpha).
 *  Nunca ejecuta en IBKR — solo alerta y sugiere, Manuel ejecuta a mano y lo reporta aquí.
 *  Ver docs/momentum-sala-real-x.md para el diseño completo. */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AuthGate from "@/components/AuthGate";
import { InfoTip } from "@/components/InfoTip";
import SalaDoor from "@/components/SalaDoor";
import { LanguageSelector } from "@/i18n/LanguageSelector";
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
  const t = useTranslations();
  const locale = useLocale() === "en" ? "en" : "es";
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
    // Cuenta (IBKR real) puede tardar varios segundos -- medido en vivo, ~4s -- y no debe
    // retrasar lo que ya está listo en ~100ms. Aparte del Promise.all, sin bloquear.
    getCuenta().then(setCuenta).catch(() => {});
    try {
      const [a, h, v, cd, fxr, reg] = await Promise.all([
        getAlertas(), getHistorial(), getValidacion(), getCandidatos(),
        getFx().catch(() => null),
        // Termómetro de régimen: informativo, si falla (yfinance caído) no debe tumbar la carga.
        getRegimen().catch(() => null),
      ]);
      // Si ya se pidió otra recarga mientras esta seguía en vuelo, esta respuesta puede no
      // reflejar la acción que la disparó -- no la apliques, la encadenada de abajo ya la trae
      // fresca (evita el "reaparece un instante" que describe el comentario de arriba).
      if (!recargaPendienteRef.current) {
        setAlertas(a); setHistorial(h); setValidacion(v); setCandidatos(cd);
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
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("omega_connection_failed"));
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
  // `universoAbierto` guarda solo el ticker del momento del clic (ver onAbrir); el objeto que de
  // verdad se pinta en el modal sale SIEMPRE de `validacion`, la única fuente de verdad -- si no,
  // el toggle "mantener" persistía bien pero el modal seguía enseñando el estado de antes de
  // pulsarlo hasta cerrarlo y reabrirlo (bug real, 22-sep-2026).
  const universoAbiertoLive = useMemo(
    () => universoAbierto
      ? (validacion ?? []).find((v) => v.ticker === universoAbierto.ticker) ?? universoAbierto
      : null,
    [universoAbierto, validacion],
  );

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
          setScanMsg(t("omega_scan_new_signals", { nuevas: p.nuevas, total: p.total }));
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
        setScanMsg(r.motivo === "ya en curso" ? t("omega_existing_scan") : "");
        setScanning(true);
        scanPollRef.current = setInterval(sondearScan, 2000);
        return;
      }
      setScanning(true);
      scanPollRef.current = setInterval(sondearScan, 2000);
    } catch (e) {
      setScanMsg(e instanceof ApiError ? e.message : t("omega_scan_failed"));
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
      setDetectMsg(e instanceof ApiError ? e.message : t("omega_detection_failed"));
    } finally {
      setDetectando(false);
    }
  };

  useEffect(() => { load(); }, [load]);

  // Separadas otra vez (18-sep-2026, feedback directo): la fusión de "nueva"/"cuidado" con
  // "ejecutada" en un único carrusel mezclaba decisiones pendientes con posiciones que ya solo
  // se vigilan -- mismo AlertaCard para las dos (ya distingue el formulario por `s.estado`), pero
  // en dos secciones separadas para que no se confundan de un vistazo.
  const alertasPendientes = (alertas ?? []).filter((s) => s.estado === "nueva" || s.estado === "cuidado");
  const posicionesActivas = (alertas ?? []).filter((s) => s.estado === "ejecutada");
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
    ? t("omega_universe_active_off", { activos: (validacion ?? []).length - universoApagados, apagados: universoApagados })
    : (validacion ?? []).length;

  // Empate del día: 2+ señales NUEVAS con la misma fecha de entrada. Si alguna del grupo es
  // 'ambos' (zigzag+suelo coinciden), esa se recomienda; si no, se muestra el empate sin
  // destacar ninguna — decide Manuel (ver doc §4, decidido 7-sep-2026).
  const empatesPorFecha = useMemo(() => {
    const grupos = new Map<string, Senal[]>();
    for (const s of alertasPendientes) {
      const g = grupos.get(s.entry_date) ?? [];
      g.push(s);
      grupos.set(s.entry_date, g);
    }
    return grupos;
  }, [alertasPendientes]);

  const conectado = cuenta?.cash != null;

  if (loading) {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-3 text-[13px]"
           style={{ background: T.page, color: T.muted }}>
        <span className="h-6 w-6 animate-spin rounded-full border-2"
              style={{ borderColor: T.grid, borderTopColor: T.entry }} />
        <p>{t("omega_ui_cargando_omega")}</p>
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
          <p style={{ color: T.muted }}>{t("omega_ui_actualizando")}</p>
        </div>
      )}
      <div className="mx-auto max-w-[1500px] px-4 pt-6 lg:px-6">
        {/* Sin barra fija -- como la land, la navegación que hace falta vive en el flujo
            normal, no clavada arriba (feedback 12-sep-2026, "el header AI slop fuera"). */}
        <div className="mb-4 flex items-center justify-between">
          <Link href="/admin" className="text-[12px] transition-colors hover:underline" style={{ color: T.muted }}>{t("omega_ui_salas")}</Link>
          <div className="flex items-center gap-2">
            <LanguageSelector />
            <SalaDoor to="alpha" />
            <SalaDoor to="beta" />
          </div>
        </div>
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
              {conectado ? t("omega_broker_connected") : t("omega_broker_disconnected")}
            </span>
          </div>
          <h1 className="mt-1 text-[26px] font-bold" style={{ color: T.ink }}>{t("omega_ui_descubrimiento_de_momentum")}</h1>
          <p className="mt-2 max-w-[46ch] text-[14px]" style={{ color: T.ink2 }}>{t("omega_ui_el_agente_detecta_rupturas_y_sugiere_tu_ejecutas_a_mano_y_lo_reportas_aqui")}</p>
        </header>

        {/* Una fila centrada de 4 celdas iguales, también en el móvil. Cada acción se distingue
            por su texto, no por un color. */}
        <div className="mx-auto mb-6 grid max-w-[520px] grid-cols-4 gap-1 min-[360px]:gap-1.5">
          <ActionChip onClick={escanear} busy={scanning}
                      label={scanning && scanProgreso?.status === "running" && scanProgreso.total > 0
                        ? `${scanProgreso.hecho}/${scanProgreso.total}` : "Señales"}>
            <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" />
          </ActionChip>
          <ActionChip onClick={detectarCandidatos} busy={detectando} label={t("omega_attr_rupturas")} stroke>
            <path d="M2 13h3l2-7 3 15 3-11 2 3h5" />
          </ActionChip>
          <ActionChip onClick={() => setBuscadorAbierto(true)} label={t("omega_attr_tickers")} stroke>
            <circle cx="10" cy="10" r="6.5" />
            <path d="M20 20l-4.3-4.3M10 7v6M7 10h6" />
          </ActionChip>
          <ActionChip onClick={refrescar} busy={refreshing} label={t("omega_attr_actualizar")} stroke>
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
            {t("omega_candidates_ready", { count: candidatosListos.length })}{" "}
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
          <p className="mb-3 text-[16px] font-bold tracking-tight" style={{ color: T.ink }}>{t("omega_ui_cuenta")}</p>
          {(() => {
            const pnlAbUsd = Number(cuenta?.pnl_abierto_usd ?? 0);
            const pnlReUsd = Number(cuenta?.pnl_realizado_usd ?? 0);
            const eur = cuenta?.cash && fx ? Number(cuenta.cash.EUR ?? 0) + Number(cuenta.cash.USD ?? 0) / fx : null;
            return (
              <div className="border-t pt-4" style={{ borderColor: T.grid }}>
                <div className="grid grid-cols-2 gap-x-5 gap-y-5">
                  <div>
                    <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: T.muted }}>{t("omega_ui_capital_desplegado")}<InfoTip text={t("omega_attr_coste_de_compra_de_lo_que_sigue_abierto_ahora_mismo_no_es_la_caja_ni_el_valor_a_precio_de_hoy")} />
                    </div>
                    <div className={`mt-1.5 text-[22px] font-bold tracking-tight ${NUMS}`} style={{ color: T.ink }}>${money(cuenta?.desplegado_usd ?? 0, 2, locale)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: T.muted }}>{t("omega_ui_pnl_abierto")}</div>
                    <div className={`mt-1.5 text-[22px] font-bold tracking-tight ${NUMS}`} style={{ color: pnlAbUsd >= 0 ? T.good : T.bad }}>
                      {signMoney(pnlAbUsd)}
                    </div>
                    <div className={`mt-0.5 text-[10.5px] ${NUMS}`} style={{ color: pnlAbUsd >= 0 ? T.good : T.bad }}>
                      {fmtRet(cuenta?.pnl_abierto_pct ?? null, locale)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: T.muted }}>{t("omega_ui_pnl_realizado")}</div>
                    <div className={`mt-1.5 text-[22px] font-bold tracking-tight ${NUMS}`} style={{ color: pnlReUsd >= 0 ? T.good : T.bad }}>
                      {signMoney(pnlReUsd)}
                    </div>
                    <div className={`mt-0.5 text-[10.5px] ${NUMS}`} style={{ color: pnlReUsd >= 0 ? T.good : T.bad }}>
                      {fmtRet(cuenta?.pnl_realizado_pct ?? null, locale)}
                    </div>
                  </div>
                  <div>
                    {/* Antes había un tile "Cash" aparte -- era el mismo dinero que este, solo
                        que sin convertir y sin el USD sumado: redundante, se quita. */}
                    <div className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: T.muted }}>{t("omega_ui_poder_compra")}</div>
                    <div className={`mt-1.5 text-[22px] font-bold tracking-tight ${NUMS}`} style={{ color: T.ink }}>
                      {eur != null ? `€${money(eur, 0)}` : "-"}
                    </div>
                    {eur != null && fx && (
                      <div className={`mt-0.5 text-[10.5px] ${NUMS}`} style={{ color: T.muted }}>≈ ${money(eur * fx, 0)}</div>
                    )}
                  </div>
                </div>
                <div className="mt-4 flex items-baseline justify-between border-t pt-3.5"
                     style={{ borderColor: T.grid }}>
                  <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: T.muted }}>{t("omega_ui_gate_gasto")}</span>
                  <span className={`text-[13px] font-bold ${NUMS}`} style={{ color: T.warn }}>
                    ${money(cuenta?.gate_gastado_usd ?? 0, 2)}
                    <span className="ml-1.5 font-normal" style={{ color: T.muted }}>· {cuenta?.gate_llamadas ?? 0}{t("omega_ui_llam")}</span>
                  </span>
                </div>
                <div className="mt-2.5 flex items-center justify-between">
                  <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: T.muted }}>{t("omega_ui_gate_modelo")}<InfoTip text={t("omega_attr_proveedor_del_gate_candidatos_senales_se_queda_asi_hasta_que_lo_cambies_sin_salto_automatico_si_uno")} />
                  </span>
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

        {/* ---------- Alertas activas: decisión pendiente (nueva/cuidado) ---------- */}
        <Section title={t("omega_attr_alertas_activas")} count={alertasPendientes.length}>
          {regimen && <RegimenChip regimen={regimen} />}
          <p className="mb-2 text-[10.5px]" style={{ color: T.muted }}>{t("omega_ui_sin_caducidad_pasados_21_dias_se_marcan_quot_cuidado_quot_p75_de_dias_a_objetivo_entre_las_ganadoras_historica")}</p>
          {alertasPendientes.length === 0 ? (
            <Empty>{t("omega_ui_ninguna_senal_sin_resolver_ahora_mismo")}</Empty>
          ) : (
            <AlertasCarrusel alertas={alertasPendientes} empates={empatesPorFecha} preciosVivos={preciosVivos} regimen={regimen} onCambio={actualizarAlerta} />
          )}
        </Section>

        {/* ---------- Posiciones activas: ya ejecutadas, solo cerrar/aumentar ---------- */}
        <Section title={t("omega_attr_posiciones_activas")} count={posicionesActivas.length}>
          {posicionesActivas.length === 0 ? (
            <Empty>{t("omega_ui_ninguna_posicion_abierta_ahora_mismo")}</Empty>
          ) : (
            <AlertasCarrusel alertas={posicionesActivas} empates={empatesPorFecha} preciosVivos={preciosVivos} regimen={regimen} onCambio={actualizarAlerta} />
          )}
        </Section>

        {/* ---------- Historial de señales ---------- */}
        <Section title={t("omega_attr_historial_de_senales")} count={historial?.length ?? 0}>
          <p className="mb-2 text-[10.5px]" style={{ color: T.muted }}>{t("omega_ui_senales_ya_resueltas_mas_las_que_descartaste_y_siguen_en_curso_para_ver_quot_la_deje_pasar_y_habria_hecho_x_qu")}</p>
          <div className="border-t" style={{ borderColor: T.grid }}>
            {(historial ?? []).slice(0, histVisibles).map((s, i) => {
              const ejecutada = s.estado === "ejecutada" || s.estado === "vendida";
              // Vendida a mano: el resultado REAL es `cierre_manual`, también cuando el job diario
              // ya la resolvió por su cuenta (esa resolución va aparte, como "solo").
              const cerradaAMano = s.estado === "vendida" && s.cierre_manual != null;
              const soloSistema = cerradaAMano && s.cierre_manual!.ret_sistema != null
                ? Number(s.cierre_manual!.ret_sistema) : null;
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
                        aria-label={ejecutada ? t("omega_executed") : enCurso ? t("omega_discarded_tracking") : t("omega_not_executed")}>
                    {ejecutada && (
                      <svg viewBox="0 0 16 16" className="h-3 w-3" stroke="#fff" fill="none" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3.5 8.5l3 3 6-7" />
                      </svg>
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <b style={{ color: T.ink }}>{s.ticker}</b>
                    {s.mantener === false && <span className="ml-1.5 text-[9px]" style={{ color: T.warn }}>{t("omega_ui_apagado")}</span>}
                    {esGateRegimen(s) && (
                      <span className="ml-1.5 inline-flex items-center gap-0.5 text-[9px]" style={{ color: T.bad }}
                            onClick={(e) => e.stopPropagation()}>
                        ⛔ {t("omega_regime")}
                        <InfoTip text={tituloRegimen(s, regimen, t)} />
                      </span>
                    )}
                    <span className="ml-2 text-[11px]" style={{ color: T.muted }}>
                      {t(TIPO_LABEL[s.tipo] ?? "omega_pattern_zigzag")} · {fmtFecha(s.entry_date, locale)}
                    </span>
                  </div>
                  <div className="text-right">
                    <div className={`font-bold ${NUMS}`} style={{ color: ret >= 0 ? T.good : T.bad }}>
                      {fmtRet(ret, locale)}
                    </div>
                    <div className="text-[9.5px]" style={{ color: enCurso ? T.warn : T.muted }}>
                      {enCurso ? t("omega_live_days", { days: s.dias ?? "—" })
                        : cerradaAMano
                          ? soloSistema != null ? t("omega_manual_return", { value: fmtRet(soloSistema, locale) }) : t("omega_manually_closed")
                          : s.motivo}
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
          <Collapsible title={t("omega_attr_candidatos")} count={t("omega_candidate_counts", { pending: candidatosPorRevisar.length, evaluated: candidatosEvaluados.length })}>
            <p className="px-3.5 pb-2 pt-3 text-[11px] leading-relaxed" style={{ color: T.muted }}>{t("omega_ui_tickers_fuera_del_universo_fijo_con_dos_entradas_posibles_apewisdom_los_trae_solo_quot_detectar_rupturas_quot")}</p>
            <CandidatosTabs porRevisar={candidatosPorRevisar} evaluados={candidatosEvaluados} onCambio={actualizarCandidato} />
          </Collapsible>
        </div>

        {/* ---------- Universo: fusiona "Validación histórica" + "Universo vigilado" en una
            sola tabla (antes los mismos 34 tickers se repetían en dos acordeones) ---------- */}
        <Collapsible title={t("omega_attr_universo")} count={universoCount}>
          <p className="px-3.5 pb-2 pt-3 text-[11px] leading-relaxed" style={{ color: T.muted }}>{t("omega_ui_cada_ticker_con_su_resultado_real_acumulado_apagar_uno_lo_saca_de_alertas_y_recuentos_pero_se_sigue_escaneando")}</p>
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
      {universoAbiertoLive && (
        // Fuera de <table>/<tbody> a propósito (bug real: un <div fixed> dentro de <tbody> es
        // HTML inválido y React lo marca como error de hidratación) -- mismo patrón que
        // `HistorialModal` arriba, la fila solo dispara `onAbrir`.
        <UniversoTickerModal v={universoAbiertoLive} alertas={alertas ?? []} historial={historial ?? []}
                            preciosVivos={preciosVivos} onCambio={actualizarValidacion}
                            onClose={() => setUniversoAbierto(null)} />
      )}
    </div>
  );
}
