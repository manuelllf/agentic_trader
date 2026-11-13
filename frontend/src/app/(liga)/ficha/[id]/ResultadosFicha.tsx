"use client";

import { useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { localeTag, normalizeLocale, type Locale } from "@/i18n/locale";
import type { Ficha } from "@/lib/liga/api";
import { porcentaje, signo } from "@/lib/liga/format";
import { OBSERVACIONES_MINIMAS } from "@/lib/liga/grafica";
import { claseDe } from "../../liga/ListaRanking";
import { GraficaRendimiento } from "./GraficaRendimiento";

type Dato = "vs" | "rent" | "puntos";
const DATOS: Dato[] = ["vs", "rent", "puntos"];
const ETIQUETA_DATO: Record<Dato, string> = {
  vs: "ficha_dato_vs", rent: "ficha_dato_rent", puntos: "ficha_dato_puntos",
};
const ESPACIO_DURO = " ";

const numero = (v: number, decimales: number, locale: Locale) =>
  new Intl.NumberFormat(localeTag(locale), { minimumFractionDigits: decimales, maximumFractionDigits: decimales }).format(v);

const ratio = (v: number | null | undefined, locale: Locale) =>
  v == null || !Number.isFinite(v) ? "-" : numero(v, 2, locale);

const fraccion = (v: number | null | undefined, locale: Locale) =>
  v == null ? "-" : porcentaje(v * 100, 1, locale).replace(/^\+/, "");

const Chevron = () => (
  <svg className="chev" viewBox="0 0 8 14" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"
    strokeLinejoin="round" aria-hidden="true"><path d="m1 1 6 6-6 6" /></svg>
);

export function ResultadosFicha({ ficha }: { ficha: Ficha }) {
  const t = useTranslations();
  const locale = normalizeLocale(useLocale()) ?? "es";
  const [dato, setDato] = useState<Dato>("vs");
  const ciclar = () => setDato((d) => DATOS[(DATOS.indexOf(d) + 1) % DATOS.length]);

  const rendimiento = ficha.rendimiento;
  const serie = rendimiento?.serie ?? [];
  const conSerie = rendimiento != null && rendimiento.estado !== "privado" && rendimiento.estado !== "sin_datos" && serie.length > 0;

  const jornadas = [...ficha.jornadas].sort((a, b) => a.numero - b.numero);
  const resueltas = jornadas.filter((j) => j.rentabilidad !== null);
  const ultima = jornadas[jornadas.length - 1];
  const mercado = ficha.mercado;
  const enJuego = ultima && ultima.rentabilidad === null && mercado ? ultima : null;
  const puntosTotales = resueltas.reduce((suma, j) => suma + (j.puntos ?? 0), 0);

  const pildora = (texto: string, clase: string) => (
    <button type="button" className={`lv-pildora${clase ? ` ${clase}` : ""}`} onClick={ciclar}
      aria-label={`${texto}, ${t("league_cambiar_dato")}`}>
      {texto}
    </button>
  );

  const datoDe = (j: Ficha["jornadas"][number]): { texto: string; clase: string } => {
    const vs = j.rentabilidad !== null && j.sp500 != null ? j.rentabilidad - j.sp500 : null;
    if (dato === "puntos") return { texto: j.puntos != null ? t("strategies_points", { count: j.puntos }) : "-", clase: "" };
    if (dato === "vs") return { texto: vs === null ? "-" : signo(vs, 1, locale), clase: claseDe(vs) };
    return { texto: porcentaje(j.rentabilidad as number, 1, locale), clase: claseDe(vs) };
  };

  let bloqueSerie;
  if (rendimiento?.estado === "privado") {
    bloqueSerie = <p className="lv-pie">{t("strategies_daily_performance_private")}</p>;
  } else if (!conSerie) {
    bloqueSerie = <p className="lv-pie">{t("strategies_daily_performance_empty")}</p>;
  } else {
    const metricas = rendimiento.metricas;
    const fin = serie[serie.length - 1];
    const pesos = ficha.posiciones.map((p) => Number(p.peso ?? 0));
    const hayCartera = pesos.length > 0;
    const efectivo = 100 - pesos.reduce((a, p) => a + p, 0);
    const pocas = metricas != null && metricas.observaciones < OBSERVACIONES_MINIMAS;
    const datos: [string, string][] = [
      [t("ficha_total"), porcentaje(fin.estrategia, 1, locale)],
      ["S&P", porcentaje(fin.sp500, 1, locale)],
      [t("ficha_volatilidad"), fraccion(metricas?.volatilidad, locale)],
      [t("ficha_caida"), fraccion(metricas?.max_drawdown, locale)],
      ["Sharpe", ratio(metricas?.sharpe, locale)],
      ["Sortino", ratio(metricas?.sortino, locale)],
      [t("ficha_posiciones"), hayCartera || ficha.casa !== "omega" ? String(pesos.length) : "-"],
      [t("ficha_mayor_peso"), hayCartera ? `${numero(Math.max(...pesos), 1, locale)}${ESPACIO_DURO}%` : "-"],
    ];
    bloqueSerie = (
      <>
        <GraficaRendimiento serie={serie} metricas={metricas} locale={locale} />
        <div className="fi-datos">
          {datos.map(([etiqueta, valor]) => <div key={etiqueta}><span>{etiqueta}</span><b>{valor}</b></div>)}
        </div>
        {(hayCartera || pocas) && (
          <p className="fi-pie-grupo">
            {hayCartera && t("ficha_datos_pie", { cash: numero(efectivo, 1, locale) })}
            {hayCartera && pocas && " "}
            {pocas && t("ficha_datos_pocos", { n: metricas.observaciones, min: OBSERVACIONES_MINIMAS })}
          </p>
        )}
        <p className="fi-pie-grupo">{rendimiento.metodologia}</p>
        {rendimiento.incompleta && <p className="fi-pie-grupo">{t("strategies_incomplete_series_note")}</p>}
      </>
    );
  }

  return (
    <>
      {bloqueSerie}
      {jornadas.length === 0 || (resueltas.length === 0 && !enJuego) ? (
        <p className="lv-pie">{t("strategies_no_round_results")}</p>
      ) : (
        <>
          <p className="lv-lista-cab">
            <span>{t("ficha_jornadas_cab", { count: resueltas.length, points: puntosTotales })}</span>
            <span><b>{t(ETIQUETA_DATO[dato])}</b></span>
          </p>
          <ul className="lv-lista">
            {enJuego && mercado && (
              <li className="lv-fila fi-emp">
                <span className="lv-fila-abre"><span className="lv-nombre">
                  <b>{t("ficha_jornada", { round: enJuego.numero })}</b><small>{t("ficha_en_juego")}</small>
                </span></span>
                {dato === "puntos" ? pildora("–", "") : dato === "vs"
                  ? pildora(mercado.diferencia == null ? "-" : signo(mercado.diferencia, 1, locale), claseDe(mercado.diferencia))
                  : pildora(mercado.rentabilidad == null ? "-" : porcentaje(mercado.rentabilidad, 1, locale), claseDe(mercado.diferencia))}
              </li>
            )}
            {[...resueltas].reverse().map((j) => {
              const { texto, clase } = datoDe(j);
              return (
                <li key={j.numero} className="lv-fila fi-emp">
                  <span className="lv-fila-abre"><span className="lv-nombre">
                    <b>{t("ficha_jornada", { round: j.numero })}</b>
                    <small>{j.sp500 != null && j.puntos != null
                      ? t("ficha_jornada_sub", { points: j.puntos, sp: porcentaje(j.sp500, 1, locale) })
                      : j.puntos != null ? t("strategies_points", { count: j.puntos }) : ""}</small>
                  </span></span>
                  {pildora(texto, clase)}
                </li>
              );
            })}
          </ul>
        </>
      )}
      <ul className="fi-grupo" style={{ marginTop: 20 }}>
        <li>
          <Link className="fi-celda enlace" href="/liga?vista=tabla">
            <span>{t("ficha_ver_clasificacion")}</span><Chevron />
          </Link>
        </li>
      </ul>
      <p className="lv-pie">
        {t("ficha_resultados_pie")}
        {!ficha.casa && <><br />{t("strategies_user_strategy_disclaimer")}</>}
      </p>
    </>
  );
}
