"use client";

// Hojas de la sala Omega: detalle del historial, gate por lotes y modelo del gate.
import { useState } from "react";
import { useTranslations } from "next-intl";
import { dolares } from "../../_marco/formato";
import type { GateProvider } from "../api";
import { esGateRegimen, fmtFecha, fmtRet, precioHoy, TIPO_LABEL, tituloRegimen } from "../helpers";
import { resultadoHistorial } from "../logica";
import type { Regimen, Senal } from "../types";
import { Celda, Grupo, Hoja } from "../../_panel/ui";
import { GrupoPrecios } from "./Precios";
import { Boton, Cifra, FilaCheck, FilaTexto, tonoRet, useIdioma } from "./ui";

export const MODELOS_GATE: { valor: GateProvider; nombre: string }[] = [
  { valor: "deepseek", nombre: "DeepSeek Flash" }, { valor: "qwen", nombre: "Qwen 3.7 Flash" },
];
export const nombreModelo = (p: GateProvider | null) => MODELOS_GATE.find((m) => m.valor === p)?.nombre ?? "…";

export function HojaHistorial({ s, precioVivo, regimen, alCerrar }:
  { s: Senal; precioVivo: number | null; regimen: Regimen | null; alCerrar: () => void }) {
  const t = useTranslations();
  const locale = useIdioma();
  const { ret, enCurso, cerradaAMano, soloSistema } = resultadoHistorial(s, precioVivo);
  const precioMostrado = enCurso ? precioVivo ?? precioHoy(s) : precioHoy(s);
  const estado = enCurso ? t("omega_in_progress") : cerradaAMano ? t("omega_manually_closed") : t("omega_resolved");
  const etiquetas = [t(TIPO_LABEL[s.tipo] ?? "omega_pattern_zigzag"), estado,
    !enCurso && s.motivo ? (s.motivo === "objetivo" ? t("omega_target") : t("omega_time")) : "",
    s.mantener === false ? t("omega_ui_apagado") : ""].filter(Boolean).join(" · ");
  const e = s.ejecucion;
  return (
    <Hoja abierta titulo={s.ticker} accion={t("pnl_omega_listo")} onCerrar={alCerrar}>
      <div className="po-hoja" aria-label={t("omega_signal_detail_aria", { ticker: s.ticker })}>
        <Cifra etiqueta={`${s.sector} · ${t("omega_entry_date", { date: fmtFecha(s.entry_date, locale) })}`} valor={fmtRet(ret, locale)} tono={tonoRet(ret)} pie={etiquetas} />
        {esGateRegimen(s) && <p className="pnl-pie-grupo">{`${t("omega_regime")}: ${tituloRegimen(s, regimen, t)}`}</p>}
        <GrupoPrecios s={s} precioMostrado={precioMostrado} etiquetaHoy={enCurso ? t("omega_ui_hoy") : t("pnl_omega_salida")} retorno={ret} />
        <Grupo cabecera={t("pnl_omega_gate")}>
          <Celda titulo={t("pnl_omega_veredicto")} valor={s.gate_resultado == null ? t("omega_ui_pendiente") : s.gate_resultado === "pasa" ? t("omega_ui_pasa") : t("omega_ui_falla")} />
          {s.gate_detalle && <FilaTexto>{s.gate_detalle}</FilaTexto>}
        </Grupo>
        {e ? (
          <>
            <Grupo cabecera={t("omega_ui_tu_ejecucion")}>
              <Celda titulo={t("omega_ui_acciones")} valor={Number(e.acciones)} />
              <Celda titulo={t("omega_ui_precio_de_compra")} valor={dolares(e.precio, locale)} />
              <Celda titulo={t("omega_ui_comision")} valor={dolares(e.comision, locale)} />
              <Celda titulo={t("omega_ui_invertido")} valor={dolares(Number(e.acciones) * Number(e.precio) + Number(e.comision), locale)} />
              {e.notas && <Celda titulo={t("omega_ui_notas")} subtitulo={e.notas} />}
            </Grupo>
          </>
        ) : null}
        <p className="pnl-pie-grupo">
          {enCurso ? t("pnl_omega_en_seguimiento", { count: s.dias ?? 0 })
            : cerradaAMano
              ? `${s.cierre_manual!.exit_date ? t("omega_sold_on", { date: fmtFecha(s.cierre_manual!.exit_date, locale) }) : t("omega_manual_sale")}${soloSistema != null ? t("omega_alone_would_have", { value: fmtRet(soloSistema, locale) }) : ""}`
              : s.exit_date ? t("omega_exit_date", { date: fmtFecha(s.exit_date, locale), days: s.dias ?? "-" }) : ""}
        </p>
      </div>
    </Hoja>
  );
}

/** Elegir qué señales pasan por el gate. Cada una es una llamada de pago: la confirmación con su coste la pide quien abre la hoja. */
export function HojaGateLote({ pendientes, modelo, corriendo, alEvaluar, alCerrar }:
  { pendientes: Senal[]; modelo: string; corriendo: boolean; alEvaluar: (ids: number[]) => void; alCerrar: () => void }) {
  const t = useTranslations();
  const locale = useIdioma();
  const [quitadas, setQuitadas] = useState<Set<number>>(new Set());
  const ids = pendientes.filter((s) => !quitadas.has(s.id)).map((s) => s.id);
  const alternar = (id: number) => setQuitadas((q) => { const n = new Set(q); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <Hoja abierta titulo={t("pnl_omega_gate")} accion={t("pnl_omega_listo")} onCerrar={alCerrar}>
      <div className="po-hoja">
        <div className="po-sep">
          <Grupo>
            {pendientes.map((s) => (
              <FilaCheck key={s.id} rol="checkbox" marcado={!quitadas.has(s.id)} deshabilitada={corriendo} titulo={s.ticker} onClick={() => alternar(s.id)}
                subtitulo={`${t(TIPO_LABEL[s.tipo] ?? "omega_pattern_zigzag")} · ${t("omega_entry_date", { date: fmtFecha(s.entry_date, locale) })}`} />
            ))}
          </Grupo>
        </div>
        <p className="pnl-pie-grupo">{t("pnl_omega_pie_gate_lote", { modelo })}</p>
        <Boton deshabilitado={ids.length === 0 || corriendo} onClick={() => alEvaluar(ids)}>{t("pnl_omega_evaluar", { count: ids.length })}</Boton>
      </div>
    </Hoja>
  );
}

export function HojaGateModelo({ actual, ocupado, alElegir, alCerrar }:
  { actual: GateProvider | null; ocupado: boolean; alElegir: (p: GateProvider) => void; alCerrar: () => void }) {
  const t = useTranslations();
  return (
    <Hoja abierta titulo={t("omega_ui_gate_modelo")} accion={t("pnl_omega_listo")} onCerrar={alCerrar}>
      <div className="po-hoja">
        <div className="po-sep">
          <Grupo pie={t("omega_attr_proveedor_del_gate_candidatos_senales_se_queda_asi_hasta_que_lo_cambies_sin_salto_automatico_si_uno")}>
            {MODELOS_GATE.map((m) => (
              <FilaCheck key={m.valor} rol="radio" marcado={actual === m.valor} deshabilitada={ocupado || actual == null} titulo={m.nombre}
                onClick={() => { alElegir(m.valor); alCerrar(); }} />
            ))}
          </Grupo>
        </div>
      </div>
    </Hoja>
  );
}
