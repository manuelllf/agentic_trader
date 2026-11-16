"use client";

// Candidatos: la pantalla con sus dos listas, la hoja de cada uno y la hoja para añadir un ticker a mano.
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ApiError } from "@/lib/api";
import {
  buscarCandidato, comprobarFiltrosCandidato, crearCandidatoManual, decidirCandidato, getGateProgresoCandidato, lanzarGateCandidato,
} from "../api";
import { fmtFecha } from "../helpers";
import { listoParaGate, pipelineTerminado, puedeReintentar } from "../logica";
import type { Candidato } from "../types";
import { Celda, Esqueleto, Grupo, Hoja, Segmentado, Vacio } from "../../_panel/ui";
import { Atras, Boton, Botones, Campo, Estado, useIdioma } from "./ui";

const marca = (v: boolean | number | null) => (v == null ? "–" : v ? "✓" : "✗");

/** Sector, estadística y gate de un candidato con sus acciones: lo comparten la hoja de cada uno y la de añadir. */
export function PanelCandidato({ inicial, confirmarGate, alCambiar, alDecidir }:
  { inicial: Candidato; confirmarGate: (ticker: string) => Promise<boolean>; alCambiar: (c: Candidato) => void; alDecidir: () => void }) {
  const t = useTranslations();
  const [c, setC] = useState(inicial);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cambiarRef = useRef(alCambiar);
  cambiarRef.current = alCambiar;
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const sinComprobar = c.filtro_sector_pass == null;
  const terminado = pipelineTerminado(c);

  const accionar = async (fn: () => Promise<Candidato>) => {
    setOcupado(true); setError("");
    try {
      const nuevo = await fn();
      setC(nuevo); alCambiar(nuevo);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("omega_action_failed"));
    } finally {
      setOcupado(false);
    }
  };

  // El gate solo se lanza en segundo plano; esperar la respuesta daba timeout con el gate ya en curso por detrás.
  const sondear = useCallback(async () => {
    try {
      const p = await getGateProgresoCandidato(c.id);
      if (p.status === "running") return;
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      setOcupado(false);
      if (p.status === "error") setError(p.error ?? t("omega_gate_completion_failed"));
      if (p.candidato) { setC(p.candidato); cambiarRef.current(p.candidato); }
    } catch { /* un fallo puntual de red no corta el sondeo */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.id]);

  // Retoma el sondeo si ya había un gate corriendo para este candidato.
  useEffect(() => {
    if (!listoParaGate(inicial)) return;
    let cancelado = false;
    getGateProgresoCandidato(inicial.id).then((p) => {
      if (cancelado || p.status !== "running") return;
      setOcupado(true);
      pollRef.current = setInterval(sondear, 3000);
    }).catch(() => {});
    return () => { cancelado = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inicial.id]);

  const lanzarGate = async () => {
    if (!(await confirmarGate(c.ticker))) return;
    setOcupado(true); setError("");
    try {
      await lanzarGateCandidato(c.id);
      pollRef.current = setInterval(sondear, 3000);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("omega_gate_failed"));
      setOcupado(false);
    }
  };

  const decidir = async (decision: "incorporado" | "descartado") => {
    setOcupado(true); setError("");
    try {
      await decidirCandidato(c.id, decision);
      alCambiar({ ...c, decision, decidido_por: "manual" });
      alDecidir();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("omega_action_failed"));
      setOcupado(false);
    }
  };

  const veredicto = (v: boolean | number | null) => (v == null ? t("pnl_omega_sin_comprobar") : v ? t("pnl_omega_pasa") : t("pnl_omega_no_pasa"));
  return (
    <>
      <Grupo cabecera={t("pnl_omega_comprobaciones")}>
        <Celda titulo={t("omega_ui_sector")} valor={veredicto(c.filtro_sector_pass)} subtitulo={c.filtro_sector_detalle || (sinComprobar ? t("omega_unchecked") : undefined)} />
        <Celda titulo={t("omega_statistics")} valor={veredicto(c.estadistica_pass)} subtitulo={c.estadistica_detalle || (sinComprobar ? t("omega_unchecked") : undefined)} />
        <Celda titulo={t("omega_fundamental_gate")} valor={veredicto(c.gate_pass)} subtitulo={c.gate_detalle || (c.gate_pass == null ? t("omega_unchecked") : undefined)} />
      </Grupo>
      {(sinComprobar || puedeReintentar(c) || listoParaGate(c)) && (
        <div className="po-sep"><Grupo>
          {sinComprobar && <Celda titulo={ocupado ? t("omega_checking") : t("omega_check_free")} tono="accion" deshabilitada={ocupado} onClick={() => accionar(() => comprobarFiltrosCandidato(c.id))} />}
          {!sinComprobar && puedeReintentar(c) && <Celda titulo={ocupado ? t("omega_retrying") : t("omega_retry_free")} tono="accion" deshabilitada={ocupado} onClick={() => accionar(() => comprobarFiltrosCandidato(c.id))} />}
          {listoParaGate(c) && <Celda titulo={ocupado ? t("omega_evaluating") : t("pnl_omega_lanzar_gate_cand")} tono="accion" deshabilitada={ocupado} onClick={lanzarGate} />}
        </Grupo></div>
      )}
      {error && <Estado error>{error}</Estado>}
      {terminado ? (
        <Botones>
          <Boton tono="tinte" deshabilitado={ocupado || c.decision === "descartado"} onClick={() => decidir("descartado")}>{t("omega_keep_out")}</Boton>
          <Boton deshabilitado={ocupado || c.decision === "incorporado"} onClick={() => decidir("incorporado")}>{t("omega_include")}</Boton>
        </Botones>
      ) : (
        <Boton tono="peligro" deshabilitado={ocupado} onClick={() => decidir("descartado")}>{t("omega_ui_descartar")}</Boton>
      )}
      <p className="pnl-pie-grupo">{terminado ? t("omega_ui_sin_decidir_todavia_incorporar_o_mantener_fuera_es_cosa_tuya") : t("pnl_omega_pie_candidato")}</p>
    </>
  );
}

export function HojaCandidato({ c, confirmarGate, alCambiar, alCerrar }:
  { c: Candidato; confirmarGate: (ticker: string) => Promise<boolean>; alCambiar: (c: Candidato) => void; alCerrar: () => void }) {
  const t = useTranslations();
  const locale = useIdioma();
  return (
    <Hoja abierta titulo={c.ticker} accion={t("pnl_omega_listo")} onCerrar={alCerrar}>
      <div className="po-hoja">
        <p className="po-meta" style={{ textAlign: "center" }}>{[c.nombre, t("pnl_omega_evaluado_el", { date: fmtFecha(c.fecha_evaluacion, locale) })].filter(Boolean).join(" · ")}</p>
        <PanelCandidato inicial={c} confirmarGate={confirmarGate} alCambiar={alCambiar} alDecidir={alCerrar} />
      </div>
    </Hoja>
  );
}

/** Busca un ticker entre los ya vistos o lo da de alta a mano, y lo deja listo para comprobar y decidir. */
export function HojaAnadir({ confirmarGate, alCambiar, alCerrar }:
  { confirmarGate: (ticker: string) => Promise<boolean>; alCambiar: (c: Candidato) => void; alCerrar: () => void }) {
  const t = useTranslations();
  const [ticker, setTicker] = useState("");
  const [candidato, setCandidato] = useState<Candidato | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");

  const buscar = async () => {
    const simbolo = ticker.trim().toUpperCase();
    if (!simbolo || ocupado) return;
    setOcupado(true); setError("");
    try {
      setCandidato((await buscarCandidato(simbolo)) ?? (await crearCandidatoManual(simbolo)));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("omega_candidate_search_failed"));
    } finally {
      setOcupado(false);
    }
  };

  return (
    <Hoja abierta titulo={t("omega_ui_anadir_ticker")} accion={t("pnl_omega_listo")} onCerrar={alCerrar}>
      <div className="po-hoja">
        {candidato ? (
          <>
            <p className="po-meta" style={{ textAlign: "center" }}>
              {[candidato.ticker, candidato.nombre].filter(Boolean).join(" · ")}
            </p>
            <PanelCandidato key={candidato.id} inicial={candidato} confirmarGate={confirmarGate} alCambiar={alCambiar} alDecidir={alCerrar} />
            <div className="po-sep"><Grupo><Celda titulo={t("omega_ui_nueva_busqueda")} tono="accion" onClick={() => { setCandidato(null); setTicker(""); }} /></Grupo></div>
          </>
        ) : (
          <>
            <Campo etiqueta={t("omega_attr_anadir_ticker")} valor={ticker} onCambio={setTicker} mayusculas deshabilitado={ocupado}
              placeholder={t("omega_attr_ticker_ej_huma")} onEnter={buscar} />
            {error && <Estado error>{error}</Estado>}
            <Boton tono="tinte" deshabilitado={!ticker.trim()} ocupado={ocupado} onClick={buscar}>{ocupado ? "…" : t("pnl_omega_buscar")}</Boton>
          </>
        )}
      </div>
    </Hoja>
  );
}

type Lista = "revisar" | "evaluados";

export function PantallaCandidatos({ porRevisar, evaluados, cargando, alVolver, alAbrir, alAnadir }:
  { porRevisar: Candidato[]; evaluados: Candidato[]; cargando: boolean; alVolver: () => void; alAbrir: (c: Candidato) => void; alAnadir: () => void }) {
  const t = useTranslations();
  const locale = useIdioma();
  const [lista, setLista] = useState<Lista>("revisar");
  const filas = lista === "revisar" ? porRevisar : evaluados;
  return (
    <div className="pnl-llega">
      <Atras texto={t("pnl_omega_sala")} onClick={alVolver} />
      <h2 className="po-titulo">{t("omega_attr_candidatos")}</h2>
      <Segmentado etiquetaGrupo={t("omega_attr_candidatos")} valor={lista} onChange={setLista}
        opciones={[{ valor: "revisar", etiqueta: t("omega_review_tab", { count: porRevisar.length }) }, { valor: "evaluados", etiqueta: t("omega_evaluated_tab", { count: evaluados.length }) }]} />
      {cargando ? <Esqueleto filas={3} etiqueta={t("pnl_omega_cargando")} /> : filas.length ? (
        <div style={{ marginTop: 16 }}>
          <Grupo>
            {filas.map((c) => (
              <Celda key={c.id} titulo={c.nombre ? `${c.ticker} · ${c.nombre}` : c.ticker} onClick={() => alAbrir(c)}
                subtitulo={lista === "evaluados"
                  ? `${t("omega_ui_sector")} ${marca(c.filtro_sector_pass)} · ${t("omega_statistics").toLowerCase()} ${marca(c.estadistica_pass)} · ${t("pnl_omega_gate")} ${marca(c.gate_pass)}`
                  : [fmtFecha(c.fecha_evaluacion, locale), c.filtro_sector_pass != null ? `${t("omega_ui_sector")} ${marca(c.filtro_sector_pass)} · ${t("omega_statistics").toLowerCase()} ${marca(c.estadistica_pass)}` : ""].filter(Boolean).join(" · ")} />
            ))}
          </Grupo>
        </div>
      ) : (
        <Vacio titulo={t(lista === "revisar" ? "omega_ui_nada_nuevo_detectado" : "omega_ui_ningun_candidato_evaluado_todavia")} texto={t("pnl_omega_vacio_candidatos")} />
      )}
      <div className="po-sep"><Grupo><Celda titulo={t("omega_ui_anadir_ticker")} tono="accion" onClick={alAnadir} /></Grupo></div>
      <p className="pnl-pie-grupo">{t("omega_ui_tickers_fuera_del_universo_fijo_con_dos_entradas_posibles_apewisdom_los_trae_solo_quot_detectar_rupturas_quot")}</p>
    </div>
  );
}
