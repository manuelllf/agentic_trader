"use client";

// Pantalla principal de Omega: estado del bróker y del mercado, procesos gratis, gate, cuenta, alertas, posiciones, historial.
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { dolares, dolaresConSigno, euros } from "../../_marco/formato";
import { probarAvisoOmega } from "../api";
import { Celda, Esqueleto, Grupo } from "../../_panel/ui";
import { esGateRegimen, fmtFecha, fmtRet, TIPO_LABEL } from "../helpers";
import { clasificarCandidatos, resultadoHistorial, retornoVivo, separarAlertas } from "../logica";
import type { Senal } from "../types";
import type { useGate, useOmega } from "../useOmega";
import { nombreModelo } from "./Hojas";
import { Estado, FilaProceso, tonoRet, useIdioma } from "./ui";

type Omega = ReturnType<typeof useOmega>;
type Gate = ReturnType<typeof useGate>;

export interface PropsRaiz {
  o: Omega;
  gate: Gate;
  /** Confirmación breve de lo último que se guardó. */
  aviso: string;
  alSenal: (id: number) => void;
  alHistorial: (s: Senal) => void;
  alGateLote: () => void;
  alModelo: () => void;
  alCandidatos: () => void;
  alUniverso: () => void;
}

const PASO_HISTORIAL = 5;

export function Raiz({ o, gate, aviso, alSenal, alHistorial, alGateLote, alModelo, alCandidatos, alUniverso }: PropsRaiz) {
  const t = useTranslations();
  const locale = useIdioma();
  const [visibles, setVisibles] = useState(PASO_HISTORIAL);
  const [probando, setProbando] = useState(false);
  const [avisoPrueba, setAvisoPrueba] = useState("");

  const { pendientes, posiciones, sinGate } = useMemo(() => separarAlertas(o.alertas ?? []), [o.alertas]);
  const { porRevisar, evaluados, listos } = useMemo(() => clasificarCandidatos(o.candidatos ?? []), [o.candidatos]);
  const validacion = o.validacion ?? [];
  const apagados = validacion.filter((v) => v.mantener === false).length;
  const historial = o.historial ?? [];
  const cuenta = o.cuenta;

  const probarAviso = async () => {
    if (probando) return;
    setProbando(true); setAvisoPrueba("");
    try {
      const r = await probarAvisoOmega();
      setAvisoPrueba(r.dispositivos === 0 ? t("admin_omega_probar_sin_dispositivos") : t("admin_omega_probar_resultado", { ok: r.ok, total: r.dispositivos }));
    } catch {
      setAvisoPrueba(t("admin_omega_probar_error"));
    } finally {
      setProbando(false);
    }
  };

  if (o.cargando) return <Esqueleto filas={4} etiqueta={t("omega_ui_cargando_omega")} />;

  const conectado = cuenta?.cash != null;
  const eur = cuenta?.cash && o.fx ? Number(cuenta.cash.EUR ?? 0) + Number(cuenta.cash.USD ?? 0) / o.fx : null;
  const pnlAb = Number(cuenta?.pnl_abierto_usd ?? 0);
  const pnlRe = Number(cuenta?.pnl_realizado_usd ?? 0);
  const esc = o.escaneo;
  const pctEscaneo = esc.progreso && esc.progreso.total > 0 ? (esc.progreso.hecho / esc.progreso.total) * 100 : 5;
  const gp = gate.progreso;
  const gateTexto = gp ? `${t("omega_gate_progress", { done: gp.hecho, total: gp.total })}${gp.ticker_actual ? ` · ${gp.ticker_actual}` : ""}…` : t("omega_ui_evaluando_titulo");
  const gatePct = gp && gp.total > 0 ? (gp.hecho / gp.total) * 100 : 5;
  const ocupadoProceso = esc.activo || o.rupturas.activo;

  const filaAlerta = (s: Senal, posicion: boolean) => {
    const ret = retornoVivo(s, o.preciosVivos[s.ticker] ?? null);
    const gateTxt = s.gate_resultado == null ? t("omega_ui_pendiente") : s.gate_resultado === "pasa" ? t("omega_ui_pasa") : t("omega_ui_falla");
    const sub = posicion
      ? [s.posicion_abierta ? `${Number(s.posicion_abierta.acciones)} ${t("omega_ui_acc")} ${dolares(s.posicion_abierta.coste_medio, locale)}` : "",
        s.dias != null ? t("pnl_omega_dias", { count: s.dias }) : "", s.dias != null && s.dias >= 80 ? t("omega_ui_cerca_del_tope_de_90_dias") : ""]
      : [t(TIPO_LABEL[s.tipo] ?? "omega_pattern_zigzag"), s.dias != null ? t("pnl_omega_dias", { count: s.dias }) : "", `${t("pnl_omega_gate")}: ${gateTxt}`,
        s.cuidado ? t("pnl_omega_cuidado") : ""];
    return <Celda key={s.id} titulo={s.ticker} subtitulo={sub.filter(Boolean).join(" · ")} onClick={() => alSenal(s.id)}
      valor={<span className={tonoRet(ret)}>{fmtRet(ret, locale)}</span>} />;
  };

  return (
    <div className="pnl-llega">
      {aviso && <p className="po-aviso" role="status">{aviso}</p>}
      {o.error && <Estado error>{o.error}</Estado>}

      <Grupo>
        <Celda titulo={t("pnl_omega_ibkr")} subtitulo={t("omega_ui_el_agente_detecta_rupturas_y_sugiere_tu_ejecutas_a_mano_y_lo_reportas_aqui")}
          valor={!o.cuentaLista ? t("pnl_omega_comprobando") : conectado ? t("omega_broker_connected") : t("omega_broker_disconnected")} />
        {o.regimen?.cesta_60d != null && (
          <Celda titulo={`${t("omega_universe_health")} (60d)`}
            subtitulo={`${t("omega_universe_health_help")} ${o.regimen.activo ? t("omega_regime_below_help") : t("omega_regime_reference_help")}`}
            valor={<span className={o.regimen.activo ? "po-mal" : undefined}>{fmtRet(o.regimen.cesta_60d, locale)}</span>} />
        )}
      </Grupo>

      <Grupo cabecera={t("pnl_omega_buscar_gratis")} pie={esc.mensaje || o.rupturas.mensaje || undefined}>
        <FilaProceso titulo={t("pnl_omega_senales")} deshabilitada={ocupadoProceso} onClick={esc.lanzar}
          subtitulo={esc.activo ? (esc.progreso?.ticker_actual ? `${t("pnl_omega_buscando")} ${esc.progreso.ticker_actual}` : t("pnl_omega_buscando")) : t("pnl_omega_buscar_senales_ayuda")}
          valor={esc.activo ? (esc.progreso && esc.progreso.total > 0 ? `${esc.progreso.hecho}/${esc.progreso.total}` : "") : t("pnl_omega_buscar")}
          progreso={esc.activo ? pctEscaneo : null} etiquetaProgreso={t("pnl_omega_senales")} />
        <FilaProceso titulo={t("omega_attr_rupturas")} deshabilitada={ocupadoProceso} onClick={o.rupturas.lanzar}
          subtitulo={o.rupturas.activo ? t("pnl_omega_buscando_apewisdom") : t("pnl_omega_rupturas_ayuda")} valor={o.rupturas.activo ? "" : t("pnl_omega_buscar")} />
      </Grupo>

      {(sinGate.length > 0 || listos.length > 0) && (
        <Grupo cabecera={t("pnl_omega_esperan_gate")} pie={gate.error || undefined}>
          {sinGate.length > 0 && (
            <FilaProceso titulo={t("pnl_omega_senales_esperan", { count: sinGate.length })} cuenta={gate.corriendo ? undefined : sinGate.length}
              subtitulo={gate.corriendo ? gateTexto : `${sinGate.map((s) => s.ticker).join(", ")} · ${t("pnl_omega_una_llamada")}`}
              deshabilitada={gate.corriendo} onClick={alGateLote} progreso={gate.corriendo ? gatePct : null} etiquetaProgreso={t("pnl_omega_gate")} />
          )}
          {listos.length > 0 && (
            <Celda titulo={t("omega_candidates_ready", { count: listos.length })} subtitulo={listos.map((c) => c.ticker).join(", ")} onClick={alCandidatos} />
          )}
        </Grupo>
      )}

      <Grupo cabecera={t("omega_ui_cuenta")}>
        <Celda titulo={t("omega_ui_capital_desplegado")} valor={dolares(cuenta?.desplegado_usd ?? 0, locale)}
          subtitulo={t("omega_attr_coste_de_compra_de_lo_que_sigue_abierto_ahora_mismo_no_es_la_caja_ni_el_valor_a_precio_de_hoy")} />
        <Celda titulo={t("omega_ui_pnl_abierto")} valor={<span className={tonoRet(pnlAb, 2)}>{`${dolaresConSigno(pnlAb, locale)} · ${fmtRet(cuenta?.pnl_abierto_pct ?? null, locale)}`}</span>} />
        <Celda titulo={t("omega_ui_pnl_realizado")} valor={<span className={tonoRet(pnlRe, 2)}>{`${dolaresConSigno(pnlRe, locale)} · ${fmtRet(cuenta?.pnl_realizado_pct ?? null, locale)}`}</span>} />
        <Celda titulo={t("omega_ui_poder_compra")} valor={eur != null ? euros(eur, locale, 0) : "-"}
          subtitulo={eur != null && o.fx ? `≈ ${dolares(eur * o.fx, locale, 0)}` : undefined} />
        <Celda titulo={t("omega_ui_gate_gasto")} valor={`${dolares(cuenta?.gate_gastado_usd ?? 0, locale)} · ${cuenta?.gate_llamadas ?? 0} ${t("omega_ui_llam")}`} />
        <Celda titulo={t("omega_ui_gate_modelo")} valor={nombreModelo(o.gateProvider)} deshabilitada={o.gateProvider == null} onClick={alModelo} />
      </Grupo>

      <Grupo cabecera={`${t("omega_attr_alertas_activas")} · ${pendientes.length}`} pie={t("omega_ui_sin_caducidad_pasados_21_dias_se_marcan_quot_cuidado_quot_p75_de_dias_a_objetivo_entre_las_ganadoras_historica")}>
        {pendientes.length ? pendientes.map((s) => filaAlerta(s, false)) : <Celda titulo={t("omega_ui_ninguna_senal_sin_resolver_ahora_mismo")} />}
      </Grupo>

      <Grupo cabecera={`${t("omega_attr_posiciones_activas")} · ${posiciones.length}`}>
        {posiciones.length ? posiciones.map((s) => filaAlerta(s, true)) : <Celda titulo={t("omega_ui_ninguna_posicion_abierta_ahora_mismo")} />}
      </Grupo>

      <Grupo cabecera={`${t("omega_attr_historial_de_senales")} · ${historial.length}`}
        pie={t("omega_ui_senales_ya_resueltas_mas_las_que_descartaste_y_siguen_en_curso_para_ver_quot_la_deje_pasar_y_habria_hecho_x_qu")}>
        {historial.length === 0 && <Celda titulo={t("pnl_omega_historial_vacio")} />}
        {historial.slice(0, visibles).map((s) => {
          const r = resultadoHistorial(s, o.preciosVivos[s.ticker] ?? null);
          const ejecutada = s.estado === "ejecutada" || s.estado === "vendida";
          const estado = r.enCurso ? t("omega_live_days", { days: s.dias ?? "-" })
            : r.cerradaAMano ? (r.soloSistema != null ? t("omega_manual_return", { value: fmtRet(r.soloSistema, locale) }) : t("omega_manually_closed"))
            : s.motivo === "objetivo" ? t("omega_target") : s.motivo === "tiempo" ? t("omega_time") : "";
          const ejec = ejecutada ? t("omega_executed") : r.enCurso ? t("omega_discarded_tracking") : t("omega_not_executed");
          return (
            <Celda key={s.id} titulo={s.mantener === false ? `${s.ticker} · ${t("omega_ui_apagado")}` : s.ticker} onClick={() => alHistorial(s)}
              subtitulo={[t(TIPO_LABEL[s.tipo] ?? "omega_pattern_zigzag"), fmtFecha(s.entry_date, locale), estado, ejec, esGateRegimen(s) ? t("omega_regime") : ""].filter(Boolean).join(" · ")}
              valor={<span className={tonoRet(r.ret)}>{fmtRet(r.ret, locale)}</span>} />
          );
        })}
        {historial.length > visibles && (
          <Celda titulo={t("omega_load_more", { count: historial.length - visibles })} tono="accion" onClick={() => setVisibles((n) => n + PASO_HISTORIAL)} />
        )}
      </Grupo>

      <Grupo cabecera={t("pnl_omega_universo_candidatos")}>
        <Celda titulo={t("omega_attr_candidatos")} subtitulo={t("omega_candidate_counts", { pending: porRevisar.length, evaluated: evaluados.length })} onClick={alCandidatos} />
        <Celda titulo={t("omega_attr_universo")} onClick={alUniverso}
          subtitulo={apagados > 0 ? t("omega_universe_active_off", { activos: validacion.length - apagados, apagados }) : t("pnl_omega_empresas", { count: validacion.length })} />
      </Grupo>

      <Grupo cabecera={t("pnl_omega_avisos")} pie={avisoPrueba || t("pnl_omega_avisos_ayuda")}>
        <Celda titulo={t("admin_omega_probar_aviso")} tono="accion" deshabilitada={probando} onClick={probarAviso} />
        <Celda titulo={o.refrescando ? t("omega_ui_actualizando") : t("omega_attr_actualizar")} tono="accion" deshabilitada={o.refrescando} onClick={o.refrescar} />
      </Grupo>
    </div>
  );
}
