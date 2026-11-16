"use client";

// Universo: la lista de empresas vigiladas y la hoja de cada una con su histórico y el interruptor de mantenerla.
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { dolares } from "../../_marco/formato";
import { sortRows, useOrden, type OrdenDir } from "@/lib/useOrden";
import { setMantenerUniverso } from "../api";
import { caidaVsAth, costeBase, fmtFecha, fmtRet, TIPO_LABEL } from "../helpers";
import type { Senal, Validacion } from "../types";
import { Celda, CeldaInterruptor, ChipFiltro, Chips, Datos, Esqueleto, Grupo, Hoja } from "../../_panel/ui";
import { Atras, Estado, tonoRet, useIdioma } from "./ui";

type ClaveUniverso = "ticker" | "sector" | "n" | "media" | "pct_positivas";
const CLAVES: ClaveUniverso[] = ["ticker", "sector", "n", "media", "pct_positivas"];
const CLAVE_TEXTO: Record<ClaveUniverso, string> = {
  ticker: "pnl_omega_ord_ticker", sector: "omega_ui_sector", n: "pnl_omega_ord_n", media: "omega_ui_media", pct_positivas: "pnl_omega_ord_pos",
};

export function PantallaUniverso({ validacion, cargando, resumen, alVolver, alAbrir }:
  { validacion: Validacion[]; cargando: boolean; resumen: string; alVolver: () => void; alAbrir: (v: Validacion) => void }) {
  const t = useTranslations();
  const locale = useIdioma();
  const [orden, setOrden] = useState<{ clave: ClaveUniverso; dir: OrdenDir }>({ clave: "ticker", dir: "asc" });
  const filas = useMemo(() => sortRows(validacion, (v, k: ClaveUniverso) => v[k], orden.clave, orden.dir), [validacion, orden]);
  const elegir = (clave: ClaveUniverso) =>
    setOrden((o) => (o.clave === clave ? { clave, dir: o.dir === "desc" ? "asc" : "desc" } : { clave, dir: clave === "ticker" || clave === "sector" ? "asc" : "desc" }));
  return (
    <div className="pnl-llega">
      <Atras texto={t("pnl_omega_sala")} onClick={alVolver} />
      <h2 className="po-titulo">{t("omega_attr_universo")}</h2>
      <p className="po-meta">{resumen}</p>
      <Chips etiqueta={t("pnl_omega_ordenar")}>
        {CLAVES.map((c) => (
          <ChipFiltro key={c} activo={orden.clave === c} onClick={() => elegir(c)}>
            {t(CLAVE_TEXTO[c])}{orden.clave === c ? (orden.dir === "desc" ? " ↓" : " ↑") : ""}
          </ChipFiltro>
        ))}
      </Chips>
      {cargando ? <div style={{ marginTop: 16 }}><Esqueleto filas={5} etiqueta={t("pnl_omega_cargando")} /></div> : (
        <div className="po-sep">
          <Grupo>
            {filas.map((v) => (
              <Celda key={v.ticker} titulo={v.mantener === false ? `${v.ticker} · ${t("omega_ui_apagado")}` : v.ticker} onClick={() => alAbrir(v)}
                subtitulo={[v.sector, t("pnl_omega_senales_n", { count: v.n }), v.pct_positivas != null ? t("pnl_omega_positivas", { value: v.pct_positivas }) : ""].filter(Boolean).join(" · ")}
                valor={v.media == null ? "-" : <span className={tonoRet(v.media)}>{fmtRet(v.media, locale)}</span>} />
            ))}
          </Grupo>
        </div>
      )}
      <p className="pnl-pie-grupo">{t("omega_ui_cada_ticker_con_su_resultado_real_acumulado_apagar_uno_lo_saca_de_alertas_y_recuentos_pero_se_sigue_escaneando")}</p>
    </div>
  );
}

type ClaveSenal = "entry_date" | "tipo" | "entry_price" | "caida_pct" | "caidaAth" | "ret" | "dias" | "caida_max_pct" | "dias_hasta_min";

export function HojaUniverso({ v, alertas, historial, preciosVivos, alCambiar, alCerrar }:
  { v: Validacion; alertas: Senal[]; historial: Senal[]; preciosVivos: Record<string, number | null>;
    alCambiar: (ticker: string, patch: Partial<Validacion>) => void; alCerrar: () => void }) {
  const t = useTranslations();
  const locale = useIdioma();
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");
  const apagado = v.mantener === false;

  const alternar = async () => {
    setOcupado(true); setError("");
    try {
      await setMantenerUniverso(v.ticker, apagado);
      alCambiar(v.ticker, { mantener: apagado });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("omega_change_failed"));
    } finally {
      setOcupado(false);
    }
  };

  // Alertas y historial son conjuntos disjuntos por construcción: juntarlos no duplica señales.
  const señales = useMemo(() => [...alertas, ...historial].filter((s) => s.ticker === v.ticker)
    .sort((a, b) => b.entry_date.localeCompare(a.entry_date)), [alertas, historial, v.ticker]);
  const resueltas = señales.filter((s) => s.resuelta && s.dias != null);
  const diasMedios = resueltas.length ? resueltas.reduce((acc, s) => acc + Number(s.dias), 0) / resueltas.length : null;

  // El resultado de una señal en curso depende del precio en vivo: se ordena por ese valor, no por el guardado.
  const filas = useMemo(() => señales.map((s) => {
    const cerradaAMano = s.estado === "vendida" && s.cierre_manual != null;
    const enCurso = !s.resuelta && !cerradaAMano;
    const vivo = preciosVivos[s.ticker];
    const ret = cerradaAMano ? Number(s.cierre_manual!.ret) : enCurso && vivo != null ? (vivo / costeBase(s) - 1) * 100 : Number(s.ret);
    return { s, ret, caidaAth: caidaVsAth(s), cerradaAMano, enCurso };
  }), [señales, preciosVivos]);
  type Fila = (typeof filas)[number];
  const acceso = (f: Fila, k: ClaveSenal): string | number | null => {
    if (k === "ret") return f.ret;
    if (k === "caidaAth") return f.caidaAth;
    if (k === "entry_price" || k === "caida_pct" || k === "caida_max_pct") return f.s[k] == null ? null : Number(f.s[k]);
    return f.s[k] as string | number | null;
  };
  const { sorted, sortKey, sortDir, toggle, ariaSort } = useOrden<Fila, ClaveSenal>(filas, acceso);
  const cols: { clave: ClaveSenal; etiqueta: string }[] = [
    { clave: "entry_date", etiqueta: t("pnl_omega_col_entrada") }, { clave: "tipo", etiqueta: t("pnl_omega_col_tipo") },
    { clave: "entry_price", etiqueta: t("pnl_omega_col_precio") }, { clave: "caida_pct", etiqueta: t("omega_reference_drop") },
    { clave: "caidaAth", etiqueta: t("omega_ath_drop") }, { clave: "ret", etiqueta: t("omega_result") },
    { clave: "dias", etiqueta: t("omega_trade_days") }, { clave: "caida_max_pct", etiqueta: t("omega_max_drop") },
    { clave: "dias_hasta_min", etiqueta: t("omega_days_to_bottom") },
  ];
  const media = (n: number | null) => (n == null ? "-" : <span className={tonoRet(n)}>{fmtRet(n, locale)}</span>);

  return (
    <Hoja abierta titulo={v.ticker} accion={t("pnl_omega_listo")} onCerrar={alCerrar}>
      <div className="po-hoja">
        <p className="po-meta" style={{ textAlign: "center" }}>{v.sector}</p>
        <Datos items={[
          { etiqueta: "n", valor: v.n }, { etiqueta: t("omega_ui_media"), valor: media(v.media) },
          { etiqueta: t("omega_ui_mediana"), valor: media(v.mediana) }, { etiqueta: t("omega_ui_dias_medios"), valor: diasMedios != null ? diasMedios.toFixed(0) : "-" },
        ]} />
        <h2 className="pnl-cab-grupo">{t("pnl_omega_senales")}</h2>
        {sorted.length === 0 ? <Grupo><Celda titulo={t("omega_ui_sin_senales_todavia")} /></Grupo> : (
          <div className="po-desliza">
            <table className="po-tabla" aria-label={t("omega_history_of", { ticker: v.ticker })}>
              <thead>
                <tr>
                  {cols.map((c) => (
                    <th key={c.clave} aria-sort={ariaSort(c.clave)}>
                      <button type="button" aria-pressed={sortKey === c.clave} aria-label={t("omega_sort_by", { label: c.etiqueta })} onClick={() => toggle(c.clave)}>
                        {c.etiqueta}{sortKey === c.clave ? (sortDir === "desc" ? " ↓" : " ↑") : ""}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map(({ s, ret, caidaAth, cerradaAMano, enCurso }) => {
                  const solo = cerradaAMano && s.cierre_manual!.ret_sistema != null ? Number(s.cierre_manual!.ret_sistema) : null;
                  const motivo = cerradaAMano ? (solo != null ? t("omega_manual_return", { value: fmtRet(solo, locale) }) : t("omega_manually_closed"))
                    : enCurso ? (s.estado === "descartada" ? t("omega_discarded_live") : t("omega_in_progress"))
                    : s.motivo === "objetivo" ? t("omega_target") : s.motivo === "tiempo" ? t("omega_days_90") : "-";
                  return (
                    <tr key={s.id}>
                      <td>{fmtFecha(s.entry_date, locale)}</td>
                      <td>{t(TIPO_LABEL[s.tipo] ?? "omega_pattern_zigzag")}</td>
                      <td>{dolares(s.entry_price, locale)}</td>
                      <td className="po-mal">{fmtRet(-Number(s.caida_pct), locale)}</td>
                      <td className="po-mal">{caidaAth != null ? fmtRet(-caidaAth, locale) : "-"}</td>
                      <td className={Number.isNaN(ret) ? undefined : tonoRet(ret)}>{Number.isNaN(ret) ? "-" : fmtRet(ret, locale)}<small>{motivo}</small></td>
                      <td>{s.dias ?? "-"}</td>
                      <td className="po-mal">{s.caida_max_pct != null ? fmtRet(Number(s.caida_max_pct), locale) : "-"}</td>
                      <td>{s.dias_hasta_min ?? "-"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="po-sep">
          <Grupo>
            <CeldaInterruptor titulo={t("omega_ui_mantener_en_universo")} activo={!apagado} onCambio={alternar} deshabilitado={ocupado}
              subtitulo={apagado ? t("pnl_omega_apagado_sigue") : undefined} />
          </Grupo>
        </div>
        {error && <Estado error>{error}</Estado>}
      </div>
    </Hoja>
  );
}
