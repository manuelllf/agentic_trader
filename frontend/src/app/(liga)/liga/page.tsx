"use client";

// Pantalla «Liga» (DESIGN.md §7 «Liga»/«Clasificación»/«Este mes»): el marcador, la clasificación
// de la temporada y «Este mes», con datos reales y públicos (`/liga/publico/*`, D3: se ve sin
// cuenta). Sin temporada todavía (hoy: todos los campos de `/liga/publico/portada` son `null`) se
// enseña un estado vacío honesto en vez de inventar filas.
//
// Gap de backend (ver el informe de F7): `EquipoOut` no manda `visibilidad`, así que no se puede
// distinguir aquí «publicada» de «privada» como pide la leyenda de la maqueta; se usa una
// etiqueta neutra («de la comunidad») para las que no son de la casa ni la propia.

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { normalizeLocale } from "@/i18n/locale";
import type { Locale } from "@/i18n/locale";
import {
  BarraPestanas, Cargando, Clasificacion as TablaClasificacion, escudoCasa, ErrorLiga,
  FilaEquipo, FilaJornada, HuecoClasificacion, Segmentado, Vacio,
} from "../_ui";
import {
  getClasificacion, getJornadaPublica, getPortada,
  type Clasificacion, type EquipoPublico, type FilaClasificacion, type JornadaDetalle,
  type Portada,
} from "@/lib/liga/api";
import { claseSigno, fecha, porcentaje } from "@/lib/liga/format";
import { useSesion } from "../_sesion/SesionContext";
import { useCache } from "@/lib/liga/cache";
import { precargarFicha } from "@/lib/liga/ficha";
import { PremioAnual } from "./PremioAnual";

type Vista = "tabla" | "jornada";

function etiquetaEquipo(e: EquipoPublico, miAlias: string | null, t: (key: string) => string): string {
  if (e.casa) return t("league_equipo_casa");
  if (miAlias && e.autor === miAlias) return t("league_equipo_tuya");
  return t("league_equipo_comunidad");
}

const horaLocal = (iso: string, locale: Locale) =>
  new Date(iso).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });


/** Quién juega ahora o está apuntado: la clasificación de la temporada solo suma jornadas
 *  cerradas, así que no sirve para contar a los que están jugando este mes. */
function resumenJuego(p: Portada, t: (key: string, values?: Record<string, number | string>) => string): string {
  const jugando = p.inscritas_en_juego ?? 0, apuntadas = p.apuntadas ?? 0;
  if (p.en_juego) return t("league_resumen_jugando", { count: jugando });
  if (apuntadas > 0) {
    return p.proxima
      ? t("league_resumen_apuntadas_con_jornada", { count: apuntadas, round: p.proxima.numero })
      : t("league_resumen_apuntadas", { count: apuntadas });
  }
  return t("league_resumen_sin_apuntadas");
}

/** Lo que se enseña en «Este mes» mientras no hay jornada formada: que ya viene, o que ya cerró la
 *  inscripción y solo falta formarla (se forma sola el primer día de bolsa, tras el corte y antes de abrir el mercado). */
function SinJornada({ portada }: { portada: Portada }) {
  const t = useTranslations();
  const locale = normalizeLocale(useLocale()) ?? "es";
  const date = (value: string) => fecha(value, new Date(), locale);
  const p = portada.proxima;
  if (!p) {
    return (
      <Vacio titulo={t("league_sin_jornada_titulo")}
             texto={t("league_sin_jornada_texto")} />
    );
  }
  const apuntadas = portada.apuntadas ?? 0;
  const cerrada = new Date(p.cierre_inscripcion).getTime() < Date.now();
  const cuantas = apuntadas > 0 ? `${t("league_resumen_apuntadas_corta", { count: apuntadas })}. ` : "";
  return cerrada ? (
    <Vacio titulo={t("league_jornada_fijada_titulo", { round: p.numero })}
           texto={`${cuantas}${t("league_jornada_fijada_texto")}`} />
  ) : (
    <Vacio titulo={t("league_jornada_proxima_titulo", { round: p.numero, date: date(p.dia_inicio) })}
           texto={`${cuantas}${t("league_jornada_proxima_texto", { date: date(p.cierre_inscripcion), time: horaLocal(p.cierre_inscripcion, locale) })}`} />
  );
}

function textoSinClasificacion(p: Portada, t: (key: string, values?: Record<string, number | string>) => string, locale: Locale): string {
  if (p.en_juego) {
    return t("league_clasificacion_vacia_jugando");
  }
  const apuntadas = p.apuntadas ?? 0;
  if (apuntadas > 0) {
    const date = p.proxima ? ` ${fecha(p.proxima.dia_inicio, new Date(), locale)}` : "";
    return t("league_clasificacion_vacia_apuntadas", { count: apuntadas, date });
  }
  return t("league_clasificacion_vacia_sin_apuntadas");
}

export default function Liga() {
  return <Suspense fallback={<Cargando />}><LigaContenido /></Suspense>;
}

function LigaContenido() {
  const t = useTranslations();
  const locale = normalizeLocale(useLocale()) ?? "es";
  const router = useRouter();
  const parametros = useSearchParams();
  const { yo } = useSesion();
  const vista: Vista = parametros.get("vista") === "tabla" ? "tabla" : "jornada";
  const setVista = (valor: Vista) => {
    const query = new URLSearchParams(parametros.toString());
    if (valor === "tabla") query.set("vista", valor); else query.delete("vista");
    router.replace(`/liga${query.size ? `?${query}` : ""}`, { scroll: false });
  };

  // Caché compartida (`lib/liga/cache.ts`): al volver a «Liga» se pinta lo último bueno al
  // instante y se revalida en segundo plano, en vez de repetir el esqueleto (H1/M6 del informe).
  const { datos: portada, cargando: cargandoPortada, refrescar: refrescarPortada } =
    useCache<Portada | string>("portada", getPortada, 120000);
  const hayTemporada = typeof portada === "object" && !!portada && portada.temporada !== null;
  const { datos: clasificacion, refrescar: refrescarClasificacion } =
    useCache<Clasificacion | string>(
      vista === "tabla" && hayTemporada ? `clasificacion:${yo?.alias ?? ""}` : null,
      () => getClasificacion({ alias: yo?.alias }),
    );
  const idEnJuego = typeof portada === "object" && portada ? portada.en_juego?.id ?? null : null;
  const { datos: jornada, refrescar: refrescarJornada } = useCache<JornadaDetalle | string>(
    vista === "jornada" && idEnJuego != null ? `jornada:${idEnJuego}` : null,
    () => getJornadaPublica(idEnJuego as number),
    120000,
  );

  const abrir = (id: string) => router.push(`/ficha/${id}`);

  const filaDe = (f: FilaClasificacion) => (
    <FilaEquipo
      key={f.equipo.id}
      puesto={f.posicion}
      nombre={f.equipo.nombre}
      escudo={f.equipo.casa ? escudoCasa(f.equipo.casa) : f.equipo.escudo}
      casa={f.equipo.casa}
      etiqueta={etiquetaEquipo(f.equipo, yo?.alias ?? null, (key) => t(key))}
      vsIndice={f.dif_sp}
      puntos={f.puntos}
      acumulado={f.acumulado}
      movimiento={f.movimiento}
      tipo={f.equipo.casa ? "casa" : (yo && f.equipo.autor === yo.alias) ? "mia" : "normal"}
      onClick={() => abrir(f.equipo.id)}
      alAcercar={() => precargarFicha(f.equipo.id)}
    />
  );

  if (cargandoPortada) {
    return (
      <main className="scroll">
        <h1 className="h1">{t("league_titulo")}</h1>
        <div style={{ marginTop: 20 }}><Cargando filas={4} /></div>
        <BarraPestanas />
      </main>
    );
  }

  if (typeof portada === "string") {
    return (
      <main className="scroll">
        <h1 className="h1">{t("league_titulo")}</h1>
        <ErrorLiga titulo={t("league_error_portada")} mensaje={portada}
                   accion={{ texto: t("league_reintentar"), onClick: refrescarPortada }} />
        <BarraPestanas />
      </main>
    );
  }
  if (!portada) return null;

  const { temporada } = portada;

  return (
    <main className="scroll">
        <h1 className="h1">{t("league_titulo")}</h1>

      {temporada === null ? (
        <Vacio
          titulo={portada.proxima
            ? t("league_primera_jornada", { date: fecha(portada.proxima.dia_inicio, new Date(), locale) })
            : t("league_sin_inicio")}
          texto={t("league_sin_inicio_texto")}
          accion={yo
            ? { texto: t("league_crear_estrategia"), onClick: () => { window.location.href = "/crear"; } }
            : { texto: t("league_entrar"), onClick: () => { window.location.href = "/entrar?next=/crear"; } }}
        />
      ) : (
        <>
          {portada.en_juego && (
            <div className="board">
              <div>
                <b>{t("league_jornada_de", { round: portada.en_juego.numero, total: temporada.n_jornadas })}</b>
                <span>{t("league_temporada", { season: temporada.nombre })}</span>
              </div>
              {portada.en_juego.sp_rentabilidad != null && (
                <div className="r">
                  <span>{t("league_sp_mes")}</span>
                  <b className={`num ${claseSigno(portada.en_juego.sp_rentabilidad)}`}>
                    {porcentaje(portada.en_juego.sp_rentabilidad, 1, locale)}
                  </b>
                </div>
              )}
            </div>
          )}
          <p className="meta" style={{ marginTop: 10 }}>
            {resumenJuego(portada, (key, values) => t(key, values))}
          </p>
          <PremioAnual />

          <div style={{ marginTop: 16 }}>
            <Segmentado etiquetaGrupo={t("league_vista_aria")} valor={vista} onChange={setVista}
                        opciones={[{ valor: "jornada", etiqueta: t("league_este_mes") },
                                   { valor: "tabla", etiqueta: t("league_clasificacion") }]} />
          </div>

          {vista === "tabla" ? (
            clasificacion === undefined ? (
              <div style={{ marginTop: 20 }}><Cargando filas={5} /></div>
            ) : typeof clasificacion === "string" ? (
              <ErrorLiga titulo={t("league_error_clasificacion")} mensaje={clasificacion}
                         accion={{ texto: t("league_reintentar"), onClick: refrescarClasificacion }} />
            ) : clasificacion.filas.length === 0 ? (
              <Vacio titulo={t("league_sin_clasificacion")}
                     texto={textoSinClasificacion(portada, (key, values) => t(key, values), locale)}
                     accion={yo
                       ? { texto: t("league_crear_mia"), onClick: () => { window.location.href = "/crear"; } }
                       : { texto: t("league_entrar"), onClick: () => { window.location.href = "/entrar"; } }} />
            ) : (
              <div className="sec" style={{ marginTop: 20 }}>
                <TablaClasificacion>
                  {clasificacion.filas.map(filaDe)}
                  {clasificacion.total > clasificacion.filas.length && (
                    <HuecoClasificacion>
                      {t("league_mas_filas", { count: clasificacion.total - clasificacion.filas.length - clasificacion.mias.length })}
                    </HuecoClasificacion>
                  )}
                  {clasificacion.mias.map(filaDe)}
                </TablaClasificacion>
                <div className="legend">
                  <p>{t("league_leyenda_casa")}</p>
                  <p>{t("league_leyenda_vs_sp")}</p>
                </div>
              </div>
            )
          ) : jornada === undefined ? (
            portada.en_juego ? <div style={{ marginTop: 20 }}><Cargando filas={4} /></div>
              : (
                <SinJornada portada={portada} />
              )
          ) : typeof jornada === "string" ? (
            <ErrorLiga titulo={t("league_error_mes")} mensaje={jornada}
                       accion={{ texto: t("league_reintentar"), onClick: refrescarJornada }} />
          ) : (
            <VistaJornada detalle={jornada} miAlias={yo?.alias ?? null} onAbrir={abrir} />
          )}
        </>
      )}

      <BarraPestanas />
    </main>
  );
}

function VistaJornada({
  detalle, miAlias, onAbrir,
}: { detalle: JornadaDetalle; miAlias: string | null; onAbrir: (id: string) => void }) {
  const t = useTranslations();
  const locale = normalizeLocale(useLocale()) ?? "es";
  const formatDate = (value: string) => fecha(value, new Date(), locale);
  const formatTime = (value: string) => new Date(value).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  const conDatos = detalle.filas.filter((f) => f.rentabilidad !== null);
  if (conDatos.length === 0) {
    return (
      <p className="callout" style={{ marginTop: 20 }}>
        {t("league_jornada_sin_cierres")}
      </p>
    );
  }
  const grupos: Record<"G" | "E" | "P", typeof conDatos> = { G: [], E: [], P: [] };
  for (const f of conDatos) {
    const dif = f.dif_sp ?? 0;
    grupos[dif > 0.2 ? "G" : dif >= -0.2 ? "E" : "P"].push(f);
  }
  const fila = (f: (typeof conDatos)[number]) => (
    <FilaJornada key={f.equipo.id} nombre={f.equipo.nombre}
      escudo={f.equipo.casa ? escudoCasa(f.equipo.casa) : f.equipo.escudo} casa={f.equipo.casa}
      etiqueta={etiquetaEquipo(f.equipo, miAlias, (key) => t(key))}
      rentabilidad={f.rentabilidad ?? 0} propia={!!miAlias && f.equipo.autor === miAlias}
      onAbrir={() => onAbrir(f.equipo.id)} />
  );
  return (
    <div className="sec" style={{ marginTop: 20 }}>
      {detalle.provisional && detalle.hasta && (
        <p className="meta">
          {detalle.en_vivo ? t("league_cotizaciones_provisionales") : t("league_ultimo_cierre", { date: formatDate(detalle.hasta) })}
          {detalle.actualizado && t("league_consultado_a", { time: formatTime(detalle.actualizado) })}
          {t("league_actualiza_y_cierre")}
          {!!detalle.precios_pendientes && t("league_precios_pendientes", { count: detalle.precios_pendientes })}
        </p>
      )}
      <p className="grp">{t("league_ganando_mes")} <small>{grupos.G.length}</small></p>
      {grupos.G.map(fila)}
      <p className="grp">{t("league_empatando")} <small>{t("league_empate_ayuda")}</small></p>
      {grupos.E.map(fila)}
      <p className="grp">{t("league_perdiendo")} <small>{grupos.P.length}</small></p>
      {grupos.P.map(fila)}
    </div>
  );
}
