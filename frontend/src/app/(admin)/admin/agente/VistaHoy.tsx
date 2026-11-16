"use client";

import { useLocale, useTranslations } from "next-intl";
import { Celda, Datos, Grupo, Vacio } from "../_panel/ui";
import { CarteraIbkr } from "./CarteraIbkr";
import { Carga } from "./Comun";
import { useCarteraEnHoy } from "./preferencias";
import { Grafica } from "./Grafica";
import { aNumero, diaHoraNY, dinero, fecha, horaNY, legible, peso, razon, tonoDe } from "./formato";
import type { CarteraAgente, Hoy } from "./tipos";
import { useCarga } from "./useCarga";

type Traducir = ReturnType<typeof useTranslations>;

/** Qué está haciendo el agente, en una palabra y lo que implica. La parada manda sobre todo lo demás. */
export function estadoDelAgente(e: Hoy["estado"]): { titulo: string; sub: string; parado: boolean } {
  if (e.parada) return { titulo: "parado", sub: e.parada_motivo ?? "", parado: true };
  if (e.modo === "pausa") return { titulo: "pausa", sub: "", parado: false };
  if (e.sombra) return { titulo: "sombra", sub: "", parado: false };
  return { titulo: e.modo === "defensivo" ? "defensivo" : "activo", sub: "", parado: false };
}

function Estado({ hoy, t }: { hoy: Hoy; t: Traducir }) {
  const e = hoy.estado;
  const { titulo, sub } = estadoDelAgente(e);
  const subtitulo = titulo === "parado" ? (sub || t("pnl_agente_hoy_estado_parado_sub")) : t(`pnl_agente_hoy_estado_${titulo}_sub`);
  return (
    <Grupo className="pa-estado">
      <Celda titulo={t(`pnl_agente_hoy_estado_${titulo}`)} subtitulo={subtitulo} tono={titulo === "parado" ? "peligro" : "normal"} />
      <Celda titulo={t("pnl_agente_hoy_ia")} subtitulo={e.ia_activa ? undefined : t("pnl_agente_hoy_ia_apagada_sub")}
        valor={t(e.ia_activa ? "pnl_agente_hoy_ia_activa" : "pnl_agente_hoy_ia_apagada")} />
    </Grupo>
  );
}

function Cartera({ c, locale, t }: { c: CarteraAgente; locale: string; t: Traducir }) {
  const total = aNumero(c.valor_total);
  const pesoCaja = total > 0 ? aNumero(c.caja) / total : 0;
  const lista = [...c.posiciones].sort((a, b) => aNumero(b.peso) - aNumero(a.peso));
  return (
    <>
      <Grupo cabecera={t("pnl_agente_hoy_cartera_cab", { n: lista.length })}>
        {lista.map(p => (
          <Celda key={p.ticker} titulo={p.ticker} href={`/admin/agente/fichas/${encodeURIComponent(p.ticker)}`}
            subtitulo={t("pnl_agente_hoy_pos_sub", { peso: peso(p.peso, locale), acciones: aNumero(p.acciones) })}
            valor={<span className={tonoDe(p.rentabilidad)}>{razon(p.rentabilidad, locale)}</span>} />
        ))}
        <Celda titulo={t("pnl_agente_hoy_caja")} subtitulo={t("pnl_agente_hoy_caja_sub", { peso: peso(pesoCaja, locale) })}
          valor={dinero(c.caja, locale)} />
      </Grupo>
      {lista.length === 0 && <p className="pnl-pie-grupo">{t("pnl_agente_hoy_sin_posiciones")}</p>}
    </>
  );
}

function Contenido({ hoy, locale, t }: { hoy: Hoy; locale: string; t: Traducir }) {
  const [carteraEnHoy] = useCarteraEnHoy();
  const c = "error" in hoy.cartera ? null : hoy.cartera;
  const serie = hoy.serie;
  const primero = serie.length > 0 ? aNumero(serie[0].valor_total) : 0;
  const desdeInicio = c && serie.length > 1 && primero > 0 ? aNumero(c.valor_total) / primero - 1 : null;
  const ahora = Date.now();
  const proximos = hoy.despertares.filter(d => Date.parse(d.hora) >= ahora);
  const u = hoy.ultima_decision;

  return (
    <div className="pa-hoy">
      <div>
        <Estado hoy={hoy} t={t} />
        {c ? (
          <div className="pa-cifra">
            <small>{t("pnl_agente_hoy_valor")}</small>
            <b>{dinero(c.valor_total, locale)}</b>
            {desdeInicio !== null && (
              <p>
                <span className={tonoDe(desdeInicio)}>{razon(desdeInicio, locale)}</span> {t("pnl_agente_hoy_desde", { fecha: fecha(serie[0].fecha, locale) })}
              </p>
            )}
          </div>
        ) : (
          <Vacio titulo={t("pnl_agente_hoy_cartera_error")} texto={"error" in hoy.cartera ? hoy.cartera.error : undefined} />
        )}
        <Grafica serie={serie} />
        {c && <Cartera c={c} locale={locale} t={t} />}
      </div>
      <div>
        <Grupo cabecera={t("pnl_agente_hoy_ultima_cab")}>
          {u ? (
            <Celda titulo={u.razonamiento} href={`/admin/agente/decisiones/${u.id}`}
              subtitulo={`${fecha(u.fecha, locale)} · ${t(`pnl_agente_dec_tipo_${u.tipo}`)}${u.sombra ? ` · ${t("pnl_agente_dec_en_sombra")}` : ""}`} />
          ) : (
            <Celda titulo={t("pnl_agente_hoy_ultima_vacio")} subtitulo={t("pnl_agente_hoy_ultima_vacio_texto")} />
          )}
        </Grupo>
        <Grupo cabecera={t("pnl_agente_hoy_viene_cab")} pie={proximos.length > 0 ? t("pnl_agente_hoy_viene_pie") : undefined}>
          {proximos.length > 0 ? proximos.map(d => (
            <Celda key={`${d.fecha}-${d.tarea}`} titulo={t(`pnl_agente_tarea_${d.tarea}`)} valor={diaHoraNY(d.hora, locale)} />
          )) : <Celda titulo={t("pnl_agente_hoy_viene_vacio")} />}
        </Grupo>
        <Grupo cabecera={t("pnl_agente_hoy_eventos_cab")}>
          {hoy.eventos.length > 0 ? hoy.eventos.map(ev => (
            <Celda key={ev.id} titulo={`${legible(ev.tipo)}${ev.ticker ? ` · ${ev.ticker}` : ""}`}
              subtitulo={t(`pnl_agente_origen_${ev.origen}`)} valor={horaNY(ev.ocurrido, locale)} />
          )) : <Celda titulo={t("pnl_agente_hoy_eventos_vacio")} />}
        </Grupo>
        {c && (
          <>
            <h2 className="pnl-cab-grupo">{t("pnl_agente_hoy_riesgo_cab")}</h2>
            <Datos items={[
              { etiqueta: t("pnl_agente_hoy_modo"), valor: hoy.estado.modo ? t(`pnl_agente_modo_${hoy.estado.modo}`) : "-" },
              { etiqueta: t("pnl_agente_hoy_caida"), valor: razon(c.caida_desde_maximo, locale) },
            ]} />
          </>
        )}
        {carteraEnHoy === true && <CarteraIbkr />}
      </div>
      <p className="pnl-pie-grupo pa-pie">{t("pnl_agente_pie_papel")}</p>
    </div>
  );
}

export default function VistaHoy() {
  const t = useTranslations();
  const locale = useLocale();
  const carga = useCarga<Hoy>("/v1/hoy");
  return <Carga {...carga} filas={5}>{hoy => <Contenido hoy={hoy} locale={locale} t={t} />}</Carga>;
}
