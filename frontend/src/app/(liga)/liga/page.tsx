"use client";

// Pantalla «Liga» (maqueta v12): cabecera de la app, título grande, la semana en curso, la clasificación
// de la temporada y, solo para admin, la actividad. Datos reales y públicos (`/liga/publico/*`, D3: se
// ve sin cuenta). Sin temporada todavía (hoy: todos los campos de `/liga/publico/portada` son `null`) se
// enseña un estado vacío honesto en vez de inventar filas.

import { Suspense, useRef } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { normalizeLocale } from "@/i18n/locale";
import type { Locale } from "@/i18n/locale";
import { Actividad, BarraPestanas, CabeceraApp, Cargando, ErrorLiga, Vacio } from "../_ui";
import { useTituloEnCabecera } from "../_ui/useTituloEnCabecera";
import { guardarVolver } from "@/lib/liga/volver";
import {
  getActividad, type Actividad as DatosActividad, getClasificacion, getJornadaPublica, getPortada, getPremio,
  type Clasificacion, type JornadaDetalle, type Portada, type PremioPublico,
} from "@/lib/liga/api";
import { fecha } from "@/lib/liga/format";
import { useSesion } from "../_sesion/SesionContext";
import { useCache } from "@/lib/liga/cache";
import { anioDeLiga } from "@/lib/liga/anio";
import { SegmentoLiga, type OpcionSegmentoLiga } from "./SegmentoLiga";
import { ListaClasificacion } from "./ListaClasificacion";
import { EsqueletoRanking } from "./ListaRanking";
import { VistaJornada } from "./VistaJornada";

type Vista = "semana" | "tabla" | "actividad";

const horaLocal = (iso: string, locale: Locale) =>
  new Date(iso).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });


/** Quién juega ahora o está apuntado: la clasificación de la temporada solo suma jornadas
 *  cerradas, así que no sirve para contar a los que están jugando este mes. */
function resumenJuego(p: Portada, t: (key: string, values?: Record<string, number | string>) => string): string {
  const jugando = p.inscritas_en_juego ?? 0, apuntadas = p.apuntadas ?? 0;
  if (p.en_juego) return t("league_resumen_jugando", { count: jugando });
  if (apuntadas > 0) {
    return p.proxima
      ? t("league_resumen_apuntadas_con_jornada", { count: apuntadas, round: p.proxima.numero, total: p.temporada!.n_jornadas })
      : t("league_resumen_apuntadas", { count: apuntadas });
  }
  return t("league_resumen_sin_apuntadas");
}

/** Lo que se enseña en «Esta semana» mientras no hay jornada formada: que ya viene, o que ya cerró la
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
    <Vacio titulo={t("league_jornada_fijada_titulo", { round: p.numero, total: portada.temporada!.n_jornadas })}
           texto={t("league_jornada_fijada_texto")} />
  ) : (
    <Vacio titulo={t("league_jornada_proxima_titulo", { round: p.numero, total: portada.temporada!.n_jornadas, date: date(p.dia_inicio) })}
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
  const titulo = useRef<HTMLHeadingElement>(null);
  useTituloEnCabecera(titulo);
  // La actividad es solo para el admin: a los demás, la pestaña no existe y la vista cae a «Esta semana».
  const admin = yo?.admin === true;
  const pedida = parametros.get("vista");
  const vista: Vista = pedida === "tabla" ? "tabla" : pedida === "actividad" && admin ? "actividad" : "semana";
  const setVista = (valor: Vista) => {
    const query = new URLSearchParams(parametros.toString());
    if (valor !== "semana") query.set("vista", valor); else query.delete("vista");
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
      vista === "tabla" && hayTemporada ? `clasificacion:${yo?.alias ?? ""}` : null,
      () => getClasificacion({ alias: yo?.alias }),
    );
  const temporadaId = typeof portada === "object" && portada ? portada.temporada?.id : undefined;
  const { datos: actividad, refrescar: refrescarActividad } = useCache<DatosActividad | string>(
    vista === "actividad" && temporadaId !== undefined ? `actividad:${temporadaId}` : null,
    () => getActividad({ temporada: temporadaId }),
  );
  const idEnJuego = typeof portada === "object" && portada ? portada.en_juego?.id ?? null : null;
  const { datos: jornada, refrescar: refrescarJornada } = useCache<JornadaDetalle | string>(
    vista === "semana" && idEnJuego != null ? `jornada:${idEnJuego}` : null,
    () => getJornadaPublica(idEnJuego as number),
    120000,
  );

  const abrir = (id: string | null) => {
    if (id) guardarVolver(t("ficha_volver_liga"), `/liga${vista !== "semana" ? `?vista=${vista}` : ""}`, id);
    router.push(id ? `/ficha/${id}` : `/entrar?next=${encodeURIComponent("/liga")}`);
  };

  if (cargandoPortada) {
    return (
      <main className="scroll liga-escritorio lv-pagina">
        <CabeceraApp anio={anio} tituloBarra={t("league_titulo")} />
        <h1 ref={titulo} className="lv-titulo">{t("league_titulo")}</h1>
        <p className="meta anio-escritorio">{anio}</p>
        <div style={{ marginTop: 20 }}><EsqueletoRanking filas={6} /></div>
        <BarraPestanas />
      </main>
    );
  }

  if (typeof portada === "string") {
    return (
      <main className="scroll liga-escritorio lv-pagina">
        <CabeceraApp anio={anio} tituloBarra={t("league_titulo")} />
        <h1 ref={titulo} className="lv-titulo">{t("league_titulo")}</h1>
        <p className="meta anio-escritorio">{anio}</p>
        <ErrorLiga titulo={t("league_error_portada")} mensaje={portada}
                   accion={{ texto: t("league_reintentar"), onClick: refrescarPortada }} />
        <BarraPestanas />
      </main>
    );
  }
  if (!portada) return null;

  const { temporada } = portada;
  const nombreTemporada = temporada === null ? ""
    : temporada.clave === "pretemporada" ? t("league_pretemporada")
      : temporada.clave === "temporada_1" ? t("league_temporada_1") : temporada.nombre;
  const opciones: OpcionSegmentoLiga<Vista>[] = [
    { valor: "semana", etiqueta: t("league_este_mes") },
    { valor: "tabla", etiqueta: t("league_clasificacion") },
    ...(admin ? [{ valor: "actividad" as const, etiqueta: t("actividad_pestana") }] : []),
  ];
  const premioEnlace = premio && typeof premio !== "string" && premio.visible ? (
    <Link href="/premio" className="premio-enlace">
      <svg className="premio-glifo" width={34} height={34} viewBox="0 0 34 34" aria-hidden="true">
        <rect className="base" x={2} y={14} width={30} height={5} rx={2.5} />
        <rect className="tramo" x={2} y={14} width={5} height={5} rx={2.5} />
        <rect className="aguja" x={13.2} y={10} width={1.6} height={13} rx={0.8} />
      </svg>
      <span className="premio-enlace-texto"><b>{t("premio_titulo")}</b><small>{premio.calculado
        ? t("premio_calculado", { escalon: premio.escalon ?? 0 })
        : t("premio_fila_resumen", { cuentas: premio.cuentas ?? 0, basico: premio.umbral_basico ?? 0 })}</small></span>
      <svg className="chev" width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
    </Link>
  ) : null;

  return (
    <main className="scroll liga-escritorio lv-pagina">
      <CabeceraApp anio={anio} tituloBarra={t("league_titulo")} />
      <h1 ref={titulo} className="lv-titulo">{t("league_titulo")}</h1>
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
          <p className="lv-sub">
            {portada.en_juego
              ? `${t("league_jornada_de", { round: portada.en_juego.numero, total: temporada.n_jornadas })} · ${nombreTemporada}`
              : resumenJuego(portada, (key, values) => t(key, values))}
          </p>
          <SegmentoLiga etiquetaGrupo={t("league_vista_aria")} valor={vista} onChange={setVista} opciones={opciones} />

          {vista === "tabla" ? (
            clasificacion === undefined ? (
              <div style={{ marginTop: 8 }}><EsqueletoRanking filas={6} /></div>
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
              <ListaClasificacion clasificacion={clasificacion} miAlias={yo?.alias ?? null} onAbrir={abrir} premio={premioEnlace} />
            )
          ) : vista === "actividad" ? (
            actividad === undefined ? <div style={{ marginTop: 20 }}><Cargando filas={4} /></div>
              : typeof actividad === "string" ? (
                <ErrorLiga titulo={t("actividad_error")} mensaje={actividad}
                           accion={{ texto: t("league_reintentar"), onClick: refrescarActividad }} />
              ) : <Actividad items={actividad.items} />
          ) : jornada === undefined ? (
            portada.en_juego ? <div style={{ marginTop: 20 }}><EsqueletoRanking filas={6} /></div>
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
