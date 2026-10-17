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
  BarraPestanas, CabeceraApp, Cargando, Clasificacion as TablaClasificacion, escudoCasa, ErrorLiga,
  FilaEquipo, HuecoClasificacion, OrdenLista, Segmentado, Vacio,
} from "../_ui";
import {
  getClasificacion, getJornadaPublica, getPortada, getPremio, type PremioPublico,
  type Clasificacion, type FilaClasificacion, type JornadaDetalle,
  type OrdenClasificacion, type Portada,
} from "@/lib/liga/api";
import { claseSigno, fecha, porcentaje } from "@/lib/liga/format";
import { useSesion } from "../_sesion/SesionContext";
import { useCache } from "@/lib/liga/cache";
import { precargarFicha } from "@/lib/liga/ficha";
import { anioDeLiga } from "@/lib/liga/anio";
import { etiquetaEquipo, VistaJornada } from "./VistaJornada";

import { TarjetaPremio } from "../_ui/TarjetaPremio";

type Vista = "tabla" | "jornada";

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
  const cerrada = new Date(p.cierre_inscripcion).getTime() < Date.now();
  return cerrada ? (
    <Vacio titulo={t("league_jornada_fijada_titulo", { round: p.numero })}
           texto={t("league_jornada_fijada_texto")} />
  ) : (
    <Vacio titulo={t("league_jornada_proxima_titulo", { round: p.numero, date: date(p.dia_inicio) })}
           texto={t("league_jornada_proxima_texto", { date: date(p.cierre_inscripcion), time: horaLocal(p.cierre_inscripcion, locale) })} />
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
  const orden: OrdenClasificacion = parametros.get("orden") === "puntos" ? "puntos" : "rentabilidad";
  const setVista = (valor: Vista) => {
    const query = new URLSearchParams(parametros.toString());
    if (valor === "tabla") query.set("vista", valor); else query.delete("vista");
    router.replace(`/liga${query.size ? `?${query}` : ""}`, { scroll: false });
  };
  const setOrden = (valor: OrdenClasificacion) => {
    if (valor === orden) return;
    const query = new URLSearchParams(parametros.toString());
    if (valor === "puntos") query.set("orden", valor); else query.delete("orden");
    router.replace(`/liga${query.size ? `?${query}` : ""}`, { scroll: false });
  };

  // Caché compartida (`lib/liga/cache.ts`): al volver a «Liga» se pinta lo último bueno al
  // instante y se revalida en segundo plano, en vez de repetir el esqueleto (H1/M6 del informe).
  const { datos: portada, cargando: cargandoPortada, refrescar: refrescarPortada } =
    useCache<Portada | string>("portada", getPortada, 120000);
  const { datos: premio } = useCache<PremioPublico | string>("premio", getPremio, 120000);
  const anio = anioDeLiga(typeof portada === "object" ? portada : null);
  const hayTemporada = typeof portada === "object" && !!portada && portada.temporada !== null;
  const { datos: clasificacion, refrescar: refrescarClasificacion } =
    useCache<Clasificacion | string>(
      vista === "tabla" && hayTemporada ? `clasificacion:${orden}:${yo?.alias ?? ""}` : null,
      () => getClasificacion({ alias: yo?.alias, orden }),
    );
  const idEnJuego = typeof portada === "object" && portada ? portada.en_juego?.id ?? null : null;
  const { datos: jornada, refrescar: refrescarJornada } = useCache<JornadaDetalle | string>(
    vista === "jornada" && idEnJuego != null ? `jornada:${idEnJuego}` : null,
    () => getJornadaPublica(idEnJuego as number),
    120000,
  );

  const abrir = (id: string | null) => router.push(id ? `/ficha/${id}` : `/entrar?next=${encodeURIComponent("/liga")}`);

  const filaDe = (f: FilaClasificacion) => (
    <FilaEquipo
      key={f.equipo.id ?? `p${f.posicion}`}
      puesto={f.posicion}
      nombre={f.equipo.nombre}
      escudo={f.equipo.casa ? escudoCasa(f.equipo.casa) : f.equipo.escudo}
      casa={f.equipo.casa}
      etiqueta={etiquetaEquipo(f.equipo, yo?.alias ?? null, (key) => t(key))}
      vsIndice={f.dif_sp}
      puntos={f.puntos}
      orden={orden}
      ganadas={f.ganadas}
      empatadas={f.empatadas}
      perdidas={f.perdidas}
      acumulado={f.acumulado}
      movimiento={f.movimiento}
      tipo={f.equipo.casa ? "casa" : (yo && f.equipo.autor === yo.alias) ? "mia" : "normal"}
      onClick={() => abrir(f.equipo.id)}
      alAcercar={f.equipo.id ? () => { if (f.equipo.id) precargarFicha(f.equipo.id); } : undefined}
    />
  );
  const mostrarOrden = clasificacion === undefined || (typeof clasificacion === "object" && clasificacion !== null && clasificacion.filas.length > 0);

  if (cargandoPortada) {
    return (
      <main className="scroll liga-escritorio">
        <CabeceraApp anio={anio} />
        <h1 className="h1">{t("league_titulo")}</h1>
        <p className="meta anio-escritorio">{anio}</p>
        <div style={{ marginTop: 20 }}><Cargando filas={4} /></div>
        <BarraPestanas />
      </main>
    );
  }

  if (typeof portada === "string") {
    return (
      <main className="scroll liga-escritorio">
        <CabeceraApp anio={anio} />
        <h1 className="h1">{t("league_titulo")}</h1>
        <p className="meta anio-escritorio">{anio}</p>
        <ErrorLiga titulo={t("league_error_portada")} mensaje={portada}
                   accion={{ texto: t("league_reintentar"), onClick: refrescarPortada }} />
        <BarraPestanas />
      </main>
    );
  }
  if (!portada) return null;

  const { temporada } = portada;

  return (
    <main className="scroll liga-escritorio">
        <CabeceraApp anio={anio} />
        <h1 className="h1">{t("league_titulo")}</h1>
        <p className="meta anio-escritorio">{anio}</p>

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
                <span>{temporada.clave === "pretemporada" ? t("league_pretemporada") : temporada.clave === "temporada_1" ? t("league_temporada_1") : temporada.nombre}</span>
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
          <div style={{ marginTop: 16 }}>
            <Segmentado etiquetaGrupo={t("league_vista_aria")} valor={vista} onChange={setVista}
                        opciones={[{ valor: "jornada", etiqueta: t("league_este_mes") },
                                   { valor: "tabla", etiqueta: t("league_clasificacion") }]} />
          </div>

          {vista === "tabla" ? (
            <>
              {mostrarOrden && <div style={{ marginTop: 16 }}><OrdenLista etiquetaGrupo={t("league_orden_aria")} valor={orden}
                  opciones={[{ valor: "rentabilidad", etiqueta: t("league_orden_rentabilidad") }, { valor: "puntos", etiqueta: t("league_orden_puntos") }]}
                  onChange={setOrden} /></div>}
              {clasificacion === undefined ? (
                <div style={{ marginTop: 8 }}><Cargando filas={5} /></div>
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
                <div className="sec" style={{ marginTop: 0 }}>
                  <TablaClasificacion jornada_provisional={clasificacion.jornada_provisional}>
                    {clasificacion.filas.map(filaDe)}
                    {clasificacion.total > clasificacion.filas.length && (
                      <HuecoClasificacion>
                        {t("league_mas_filas", { count: clasificacion.total - clasificacion.filas.length - clasificacion.mias.length })}
                      </HuecoClasificacion>
                    )}
                    {clasificacion.mias.map(filaDe)}
                  </TablaClasificacion>
                  {orden === "puntos" && <div className="legend">
                    <p>{t("league_leyenda_orden_puntos")}</p>
                  </div>}
                  {premio && typeof premio !== "string" && premio.visible && <TarjetaPremio premio={premio} sesion={!!yo} confirmada={!!yo?.mayor_edad_confirmada} />}
                </div>
              )}
            </>
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
