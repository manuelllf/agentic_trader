"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useMemo, useState } from "react";
import { Celda, Datos, Esqueleto, Grupo, Segmentado, Vacio } from "../_panel/ui";
import { CarteraIbkr } from "./CarteraIbkr";
import { Carga, NoDisponible } from "./Comun";
import { HojaCompartir, imagenPasos } from "./Compartir";
import { useTareasDelDia } from "./Dia";
import { CabeceraCompartir, Flujo } from "./Flujo";
import { useCarteraEnHoy } from "./preferencias";
import { Grafica } from "./Grafica";
import { aNumero, dinero, fecha, peso, razon, tonoDe } from "./formato";
import { capitalizar, diaCorto, diaLargo, enFrase, subDecision, tituloDecision, type Traducir } from "./textos";
import type { CarteraAgente, CicloActual, Dia, Hoy } from "./tipos";
import { useCarga } from "./useCarga";

// Lo que está en curso se ve avanzar sin recargar la pantalla.
const REFRESCO_MS = 30_000;

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
    <Grupo cabecera={lista.length ? t("pnl_agente_hoy_cartera_cab", { n: lista.length }) : t("pnl_agente_hoy_cartera_vacia_cab")}
      pie={lista.length === 0 ? t("pnl_agente_hoy_sin_posiciones") : undefined}>
      {lista.map(p => (
        <Celda key={p.ticker} titulo={p.ticker} href={`/admin/alpha/fichas/${encodeURIComponent(p.ticker)}`}
          subtitulo={t("pnl_agente_hoy_pos_sub", { peso: peso(p.peso, locale), acciones: aNumero(p.acciones) })}
          valor={<span className={tonoDe(p.rentabilidad)}>{razon(p.rentabilidad, locale)}</span>} />
      ))}
      <Celda titulo={t("pnl_agente_hoy_caja")} subtitulo={t("pnl_agente_hoy_caja_sub", { peso: peso(pesoCaja, locale) })}
        valor={dinero(c.caja, locale)} />
    </Grupo>
  );
}

/** El día del agente en hora de Nueva York: sus tareas con pista, En vivo y el registro. */
function ElDia({ hoy, locale, t }: { hoy: Hoy; locale: string; t: Traducir }) {
  const dias = [hoy.dia_anterior, hoy.dia].filter((d): d is string => Boolean(d));
  const [diaSel, setDiaSel] = useState(hoy.dia);
  const esHoy = diaSel === hoy.dia;
  const carga = useCarga<Dia>(`/v1/dia/${diaSel}`, esHoy ? REFRESCO_MS : undefined);
  const ciclo = useCarga<CicloActual>("/v1/ciclo/actual", REFRESCO_MS);
  const { pasos, hoja } = useTareasDelDia(carga.datos);
  const [compartir, setCompartir] = useState(false);
  const crear = useCallback(() => imagenPasos(
    t("pnl_agente_dia_imagen_titulo", { dia: enFrase(diaLargo(diaSel, locale), locale) }), t("pnl_agente_dia_imagen_sub"),
    pasos.map(p => ({ titulo: p.titulo, sub: typeof p.sub === "string" ? p.sub : undefined, valor: p.valorTexto ?? (typeof p.valor === "string" ? p.valor : undefined), estado: p.estado, subMal: p.subMal })),
    t("pnl_agente_imagen_pie")), [pasos, diaSel, locale, t]);
  const nEventos = carga.datos?.eventos.length ?? 0;
  const pensando = Boolean(ciclo.datos?.en_curso);

  return (
    <>
      <CabeceraCompartir titulo={t("pnl_agente_dia_cab")} onCompartir={() => setCompartir(true)} />
      {dias.length > 1 && (
        <Segmentado etiquetaGrupo={t("pnl_agente_dia_aria")} valor={diaSel} onChange={setDiaSel}
          opciones={dias.map(d => ({ valor: d, etiqueta: d === hoy.dia ? t("pnl_agente_dia_hoy", { dia: diaCorto(d, locale) }) : capitalizar(diaCorto(d, locale), locale) }))} />
      )}
      <div className="pa-dia">
        {carga.estado === "cargando" ? <Esqueleto filas={5} etiqueta={t("pnl_agente_cargando")} />
          : carga.estado === "error" ? <NoDisponible error={carga.error} onReintentar={carga.recargar} />
          : pasos.length ? <div className="pnl-llega"><Flujo pasos={pasos} /></div>
          : <Vacio titulo={t("pnl_agente_dia_sin_tareas")} texto={t("pnl_agente_dia_sin_tareas_texto")} />}
      </div>
      <div className="pa-bloque">
        <Grupo>
          <Celda titulo={t("pnl_agente_envivo")} href="/admin/alpha/en-vivo"
            subtitulo={pensando ? t("pnl_agente_envivo_pensando") : t("pnl_agente_envivo_repite")} />
          <Celda titulo={t("pnl_agente_dia_registro")} valor={carga.datos ? String(nEventos) : undefined}
            href={nEventos ? `/admin/alpha/registro/${diaSel}` : undefined} />
        </Grupo>
      </div>
      {hoja}
      <HojaCompartir abierta={compartir} crear={crear} nombre={`alpha-${diaSel}`} alt={t("pnl_agente_dia_cab")} onCerrar={() => setCompartir(false)} />
    </>
  );
}

function Contenido({ hoy, locale, t }: { hoy: Hoy; locale: string; t: Traducir }) {
  const [carteraEnHoy] = useCarteraEnHoy();
  const c = "error" in hoy.cartera ? null : hoy.cartera;
  const u = hoy.ultima_decision;
  const tituloU = useMemo(() => (u ? tituloDecision(u.operaciones, u.tipo, t, locale) : ""), [u, t, locale]);

  return (
    <div className="pa-hoy">
      <div>
        <Estado hoy={hoy} t={t} />
        {c ? (
          <div className="pa-cifra">
            <small>{t("pnl_agente_hoy_valor")}</small>
            <b>{dinero(c.valor_total, locale)}</b>
          </div>
        ) : (
          <Vacio titulo={t("pnl_agente_hoy_cartera_error")} texto={"error" in hoy.cartera ? hoy.cartera.error : undefined} />
        )}
        <Grafica serie={hoy.serie} />
        <Grupo cabecera={t("pnl_agente_hoy_ultima_cab")}>
          {u ? (
            <Celda titulo={tituloU} href={`/admin/alpha/decisiones/${u.id}`} subtitulo={subDecision(u, t, fecha(u.fecha, locale))} />
          ) : (
            <Celda titulo={t("pnl_agente_hoy_ultima_vacio")} subtitulo={t("pnl_agente_hoy_ultima_vacio_texto")} />
          )}
          <Celda titulo={t("pnl_agente_hoy_todas")} valor={String(hoy.decisiones_total)} href="/admin/alpha/decisiones" />
        </Grupo>
        {c && <Cartera c={c} locale={locale} t={t} />}
      </div>
      <div>
        <ElDia hoy={hoy} locale={locale} t={t} />
        {c && (
          <>
            <h2 className="pnl-cab-grupo">{t("pnl_agente_hoy_riesgo_cab")}</h2>
            <Datos items={[
              { etiqueta: t("pnl_agente_hoy_modo"), valor: hoy.estado.modo ? t(`pnl_agente_modo_${hoy.estado.modo}`) : "—" },
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
  const carga = useCarga<Hoy>("/v1/hoy", REFRESCO_MS);
  return <Carga {...carga} filas={5}>{hoy => <Contenido hoy={hoy} locale={locale} t={t} />}</Carga>;
}
