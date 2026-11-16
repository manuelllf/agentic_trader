"use client";

// Pantalla propia de una señal: alerta pendiente (gate, descartar, marcar ejecutada) o posición abierta (aumentar, cerrar).
import { useTranslations } from "next-intl";
import { dolares } from "../../_marco/formato";
import { Celda, Grupo, Progreso } from "../../_panel/ui";
import { esGateRegimen, fmtFecha, fmtRet, precioHoy, TIPO_LABEL, tituloRegimen } from "../helpers";
import { retornoVivo } from "../logica";
import type { Regimen, Senal } from "../types";
import { GrupoPrecios } from "./Precios";
import { Atras, Boton, Botones, Cifra, Estado, FilaTexto, tonoRet, useIdioma } from "./ui";

export type ModoForm = "ejecutada" | "aumentar" | "venta";

export interface PropsSenal {
  s: Senal;
  grupo: Senal[];
  precioVivo: number | null;
  regimen: Regimen | null;
  gateCorriendo: boolean;
  gateTexto: string;
  gatePct: number;
  gateError: string;
  error: string;
  ocupado: boolean;
  alVolver: () => void;
  alGate: () => void;
  alDescartar: () => void;
  alForm: (modo: ModoForm) => void;
}

export function PantallaSenal({ s, grupo, precioVivo, regimen, gateCorriendo, gateTexto, gatePct, gateError, error, ocupado, alVolver, alGate, alDescartar, alForm }: PropsSenal) {
  const t = useTranslations();
  const locale = useIdioma();
  const posicion = s.estado === "ejecutada";
  const ret = retornoVivo(s, precioVivo);
  const esAmbos = grupo.some((g) => g.tipo === "ambos");
  const veredicto = s.gate_resultado == null ? t("omega_ui_pendiente") : s.gate_resultado === "pasa" ? t("omega_ui_pasa") : t("omega_ui_falla");
  return (
    <div className="pnl-llega">
      <Atras texto={t("pnl_omega_sala")} onClick={alVolver} />
      <h2 className="po-titulo">{s.ticker}</h2>
      <p className="po-meta">
        {[s.sector, t(TIPO_LABEL[s.tipo] ?? "omega_pattern_zigzag"), t("omega_entry_date", { date: fmtFecha(s.entry_date, locale) }),
          s.dias != null ? t("pnl_omega_dias", { count: s.dias }) : "", s.cuidado ? t("pnl_omega_cuidado") : ""].filter(Boolean).join(" · ")}
      </p>
      <Cifra etiqueta={posicion ? t("pnl_omega_desde_compra") : t("pnl_omega_desde_senal")} valor={fmtRet(ret, locale)} tono={tonoRet(ret)}
        pie={posicion && s.posicion_abierta
          ? t("pnl_omega_posicion_abierta", { acciones: Number(s.posicion_abierta.acciones), coste: dolares(s.posicion_abierta.coste_medio, locale) })
          : undefined} />
      {esGateRegimen(s) && <p className="pnl-pie-grupo">{`${t("omega_regime")}: ${tituloRegimen(s, regimen, t)}`}</p>}
      <GrupoPrecios s={s} precioMostrado={precioVivo ?? precioHoy(s)} etiquetaHoy={t("omega_ui_hoy")} retorno={ret} conCoste={posicion} />
      {grupo.length >= 2 && (
        <p className="pnl-pie-grupo">
          {`${t("omega_ui_empate_del_dia")} ${grupo.length} ${t("omega_ui_senales_entraron_hoy")} `}
          {esAmbos && s.tipo === "ambos" ? t("omega_strongest_pattern") : esAmbos ? t("omega_other_strongest") : t("omega_choose_pattern")}
        </p>
      )}
      <Grupo cabecera={t("pnl_omega_gate")}>
        <Celda titulo={t("pnl_omega_veredicto")} valor={veredicto} />
        {s.gate_detalle && <FilaTexto>{s.gate_detalle}</FilaTexto>}
      </Grupo>
      {posicion && s.dias != null && s.dias >= 80 && <p className="pnl-pie-grupo">{t("pnl_omega_cerca_tope")}</p>}
      {s.gate_resultado == null && (
        gateCorriendo ? (
          <div className="po-estado" role="status">{gateTexto}<Progreso valor={gatePct} etiqueta={t("omega_ui_evaluando_titulo")} /></div>
        ) : (
          <Boton tono="tinte" onClick={alGate}>{t("pnl_omega_lanzar_gate")}</Boton>
        )
      )}
      {gateError && <Estado error>{gateError}</Estado>}
      {error && <Estado error>{error}</Estado>}
      {posicion ? (
        <Botones>
          <Boton tono="tinte" onClick={() => alForm("aumentar")}>{t("omega_ui_aumentar")}</Boton>
          <Boton onClick={() => alForm("venta")}>{t("omega_ui_cerrar_posicion")}</Boton>
        </Botones>
      ) : (
        <Botones>
          <Boton tono="peligro" deshabilitado={ocupado} onClick={alDescartar}>{t("omega_dismiss")}</Boton>
          <Boton onClick={() => alForm("ejecutada")}>{t("omega_ui_marcar_ejecutada")}</Boton>
        </Botones>
      )}
      <p className="pnl-pie-grupo">{t("pnl_omega_sin_ordenes")}</p>
    </div>
  );
}
