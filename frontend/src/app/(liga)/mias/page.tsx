"use client";

import Link from "next/link";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { normalizeLocale } from "@/i18n/locale";
import { Sesion } from "../_sesion/Sesion";
import { BarraPestanas, Boton, Cargando, Escudo, ErrorLiga, Segmentado, Vacio, cierreDeCambios }
  from "../_ui";
import {
  borrarEstrategia, cadaDia1, desapuntar, apuntar as apuntarApi, getJornadaPublica,
  getClasificacion, getPortada, miVentana, misEstrategias, optarAlPremio, type Clasificacion, type Estrategia,
  type JornadaDetalle, type Portada, type Ventana,
} from "@/lib/liga/api";
import { mutar, useCache } from "@/lib/liga/cache";
import { precargarFicha } from "@/lib/liga/ficha";
import { claseSigno, porcentaje, signo } from "@/lib/liga/format";
import { getSeguimiento, type SeguimientoEstrategia }
  from "@/lib/liga/seguimiento";
import { useSesionRequerida } from "../_sesion/SesionContext";

const ETIQUETA_ESTADO: Record<string, string> = {
  borrador: "strategies_state_draft", apuntada: "strategies_state_signed_up", jugando: "strategies_state_playing", retirada: "strategies_state_retired",
};
type ListaEstrategias = Estrategia[] | string;

// Conserva la lista cacheada y actualiza solo la estrategia afectada.
function parchearFila(id: string, cambios: Partial<Estrategia> | Estrategia) {
  mutar<ListaEstrategias>("mis-estrategias", (prev) => {
    if (!Array.isArray(prev)) return prev ?? [];
    return prev.map((e) => (e.id === id ? { ...e, ...cambios } : e));
  });
}

export default function Mias() {
  const t = useTranslations();
  const locale = normalizeLocale(useLocale()) ?? "es";
  const percent = (value: number) => porcentaje(value, 1, locale);
  const points = (value: number) => signo(value, 1, locale);
  const { estado, yo } = useSesionRequerida("/mias");
  const sesionLista = estado !== "cargando";

  const { datos: estrategias, cargando, refrescar: cargar } = useCache<ListaEstrategias>(
    sesionLista && estado === "dentro" ? "mis-estrategias" : null, misEstrategias,
  );
  const { datos: portada } = useCache<Portada | string>("portada", getPortada, 120000);
  const puedeVerClasificacion = estado === "dentro" && !!yo && Array.isArray(estrategias)
    && estrategias.length > 0 && typeof portada === "object" && !!portada && !!portada.temporada;
  const { datos: clasificacion } = useCache<Clasificacion | string>(
    puedeVerClasificacion ? `clasificacion:${yo?.alias ?? ""}` : null,
    () => getClasificacion({ alias: yo?.alias }), 120000,
  );
  const jornadaId = typeof portada === "object" && portada ? portada.en_juego?.id ?? null : null;
  const { datos: detalleJornada, fallo: falloJornada } = useCache<JornadaDetalle | string>(
    jornadaId === null ? null : `jornada:${jornadaId}`,
    () => getJornadaPublica(jornadaId as number), 120000,
  );
  const [ocupada, setOcupada] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ajustes, setAjustes] = useState<string | null>(null);
  // Leer no marca una revisión; la caché privada se invalida al cambiar de cuenta.
  const { datos: seguimiento } = useCache<SeguimientoEstrategia[] | string>(
    estado === "dentro" ? "seguimiento" : null, getSeguimiento,
  );

  // Del corte hasta que abre la jornada: qué estrategias se están formando o admiten cambios.
  const { datos: ventanas } = useCache<Ventana[] | string>(
    estado === "dentro" ? "ventana" : null, miVentana,
  );
  const enVentana = Array.isArray(ventanas) ? new Map(ventanas.map((v) => [v.estrategia_id, v])) : null;

  const porEstrategia = Array.isArray(seguimiento)
    ? new Map(seguimiento.map((r) => [r.estrategia_id, r])) : null;
  const rankingPorEstrategia = typeof clasificacion === "object" && clasificacion
    ? new Map([...clasificacion.filas, ...clasificacion.mias].map((f) => [f.equipo.id, f]))
    : null;
  const filasJornada = typeof detalleJornada === "object" && detalleJornada
    ? new Map(detalleJornada.filas.map((f) => [f.equipo.id, f])) : null;

  async function alApuntar(id: string) {
    setOcupada(id);
    setAviso(null);
    const r = await apuntarApi(id);
    if (typeof r === "string") setAviso(r); else parchearFila(id, r);
    setOcupada(null);
  }

  async function alDesapuntar(id: string) {
    setOcupada(id);
    setAviso(null);
    const r = await desapuntar(id);
    if (typeof r === "string") setAviso(r); else parchearFila(id, r);
    setOcupada(null);
  }

  async function alOptarAlPremio(id: string) {
    setOcupada(id);
    setAviso(null);
    const r = await optarAlPremio(id);
    if (typeof r === "string") setAviso(r); else mutar<ListaEstrategias>("mis-estrategias", () => r);
    setOcupada(null);
  }

  async function alCambiarCadaDia1(id: string, opcion: "revisar" | "mantener") {
    setOcupada(id);
    setAviso(null);
    // Optimista: el toggle es un campo puramente local, se ve al tocar y se confirma (o se
    // deshace) con lo que responda el servidor.
    const anterior = mutar<ListaEstrategias>("mis-estrategias", (prev) => (
      Array.isArray(prev) ? prev.map((e) => (e.id === id ? { ...e, cada_dia_1: opcion } : e)) : prev ?? []
    ));
    const r = await cadaDia1(id, opcion);
    if (typeof r === "string") {
      setAviso(r);
      if (anterior !== undefined) mutar<ListaEstrategias>("mis-estrategias", () => anterior);
    } else {
      parchearFila(id, r);
    }
    setOcupada(null);
  }

  async function alBorrar(id: string, nombre: string) {
    if (!window.confirm(t("strategies_delete_draft_confirm", { name: nombre }))) return;
    setOcupada(id);
    setAviso(null);
    const r = await borrarEstrategia(id);
    if (typeof r === "string") {
      setAviso(r);
    } else {
      mutar<ListaEstrategias>("mis-estrategias", (prev) => (
        Array.isArray(prev) ? prev.filter((e) => e.id !== id) : prev ?? []
      ));
    }
    setOcupada(null);
  }

  // Primero lo que cambió desde tu última revisión, luego lo que juega, lo apuntado y los borradores.
  const novedadDe = (r: SeguimientoEstrategia | undefined) => {
    const ninguna: string[] = [];
    if (!r) return null;
    if (r.primera_revision) return { tipo: "primera" as const, entradas: ninguna, salidas: ninguna };
    const c = r.cambio_desde_revision;
    if (c && (c.entradas.length || c.salidas.length)) return { tipo: "cambio" as const, entradas: c.entradas, salidas: c.salidas };
    if (r.resultado_nuevo) return { tipo: "resultado" as const, entradas: ninguna, salidas: ninguna };
    return { tipo: "sin" as const, entradas: ninguna, salidas: ninguna };
  };
  const conNovedad = (e: Estrategia) => {
    const tipo = novedadDe(porEstrategia?.get(e.id))?.tipo;
    return tipo === "cambio" || tipo === "resultado";
  };
  const ORDEN_ESTADO: Record<string, number> = { jugando: 0, apuntada: 1, borrador: 2 };
  const ordenadas = Array.isArray(estrategias)
    ? [...estrategias].sort((a, b) => (conNovedad(b) ? 1 : 0) - (conNovedad(a) ? 1 : 0)
      || (ORDEN_ESTADO[a.estado] ?? 3) - (ORDEN_ESTADO[b.estado] ?? 3))
    : [];
  const conNovedades = ordenadas.filter(conNovedad).length;

  return (
    <main className="scroll">
      <div className="titulo-cuenta"><h1 className="h1">{t("strategies_mine_title")}</h1><Sesion /></div>
      <div className="mias-cabecera">
        <span className="meta">{Array.isArray(estrategias) ? t("strategies_count", { count: estrategias.length }) : ""}{conNovedades > 0 && ` · ${t("strategies_with_news", { count: conNovedades })}`}</span>
          <Link href="/crear" className="btn pri small">{t("strategies_create")}</Link>
      </div>

      {estado === "cargando" || cargando ? (
        <div style={{ marginTop: 20 }}><Cargando filas={3} /></div>
      ) : typeof estrategias === "string" ? (
        <ErrorLiga titulo={t("strategies_mine_error")} mensaje={estrategias}
                   accion={{ texto: t("strategies_retry"), onClick: cargar }} />
      ) : !estrategias || estrategias.length === 0 ? (
        <Vacio
          titulo={t("strategies_empty_title")}
          texto={t("strategies_empty_text")}
          accion={{ texto: t("strategies_create_first"), onClick: () => { window.location.href = "/crear"; } }}
        />
      ) : (
        <div className="mias-lista">
          {ordenadas.map((e) => {
            const actual = filasJornada?.get(e.id);
            const resumen = porEstrategia?.get(e.id);
            const fila = rankingPorEstrategia?.get(e.id);
            const acumulado = resumen?.acumulado ?? fila?.acumulado;
            const puesto = fila?.posicion;
            const movimiento = fila?.movimiento ?? 0;
            const novedad = novedadDe(resumen);
            const ventana = enVentana?.get(e.id);
            const cierre = ventana ? cierreDeCambios(ventana.cierra, locale) : null;
            const pendiente = ocupada === e.id;
            const enVivo = typeof detalleJornada === "object" && !!detalleJornada && detalleJornada.en_vivo;
            const cargandoMes = detalleJornada === undefined && !falloJornada;
            return (
              <article key={e.id} className="mias-estrategia" aria-busy={pendiente || undefined}>
                <div className="mias-cab">
                  <Link href={`/ficha/${e.id}`} className="mias-identidad"
                    onPointerEnter={() => precargarFicha(e.id)} onPointerDown={() => precargarFicha(e.id)}>
                    <Escudo valor={e.escudo} etiqueta={t("strategies_crest", { name: e.nombre })} tamano={34} />
                    <span><h2>{e.nombre}</h2><small>{ETIQUETA_ESTADO[e.estado] ? t(ETIQUETA_ESTADO[e.estado]) : e.estado}{e.opta_premio && ` · ${t("strategies_prize_entered")}`}</small></span>
                    {puesto != null && (
                      <span className="mias-puesto num" aria-label={t("common_ranking_posicion_aria", { count: puesto })}>
                        #{puesto}
                        {movimiento !== 0 && <small className={movimiento > 0 ? "up" : "dn"}>{movimiento > 0 ? "↑" : "↓"}{Math.abs(movimiento)}</small>}
                      </span>
                    )}
                  </Link>
                  <button type="button" className="mias-mas" aria-expanded={ajustes === e.id}
                    aria-label={t("strategies_settings")} onClick={() => setAjustes(ajustes === e.id ? null : e.id)}>⋯</button>
                </div>
                {(e.estado === "jugando" || acumulado) && (
                  <dl className="mias-cifras">
                    <div>
                      <dt>{t("strategies_this_month")}{enVivo && ` · ${t("strategies_provisional").toLowerCase()}`}</dt>
                      <dd className={actual?.rentabilidad != null ? claseSigno(actual.rentabilidad) : ""}>
                        {actual?.rentabilidad != null ? percent(actual.rentabilidad)
                          : e.estado === "jugando" && cargandoMes ? "…" : t("strategies_no_data")}
                      </dd>
                      {actual?.dif_sp != null && <small className={claseSigno(actual.dif_sp)}>{points(actual.dif_sp)} pp {t("common_ranking_vs_sp")}</small>}
                    </div>
                    <div>
                      <dt>{acumulado?.incompleta ? t("strategies_period_count", { count: acumulado.periodos }) : t("strategies_cumulative")}</dt>
                      <dd className={acumulado ? claseSigno(acumulado.rentabilidad) : ""}>
                        {acumulado ? percent(acumulado.rentabilidad) : t("strategies_no_closes")}
                      </dd>
                      {acumulado && <small>{t("strategies_benchmark", { value: percent(acumulado.sp500) })}</small>}
                    </div>
                  </dl>
                )}
                {novedad && (e.estado === "jugando" || acumulado) && (
                  <Link href={`/ficha/${e.id}`} className={`mias-linea${novedad.tipo === "cambio" || novedad.tipo === "resultado" ? " viva" : ""}`}
                    onPointerEnter={() => precargarFicha(e.id)} onPointerDown={() => precargarFicha(e.id)}>
                    {novedad.tipo === "cambio" && <>
                      <b>{t("strategies_change_count", { count: novedad.entradas.length + novedad.salidas.length })}</b>
                      <span>{t("common_seguimiento_cambios", { entradas: novedad.entradas.join(", ") || t("common_seguimiento_ninguna"), salidas: novedad.salidas.join(", ") || t("common_seguimiento_ninguna") })}</span>
                    </>}
                    {novedad.tipo === "resultado" && <b>{t("strategies_new_result")}</b>}
                    {novedad.tipo === "sin" && <span>{t("strategies_no_changes")}</span>}
                    {novedad.tipo === "primera" && <span>{t("strategies_first_look")}</span>}
                  </Link>
                )}
                {ventana && cierre && (
                  <Link href={`/crear/${e.id}`} className="mias-linea viva">
                    {ventana.fase === "cambios" ? <>
                      <b>{t("window_mine_open")}</b>
                      <span>{t("window_mine_until", { date: cierre.dia, time: cierre.hora })}</span>
                    </> : <span>{t("window_mine_forming")}</span>}
                  </Link>
                )}
                {resumen?.sin_pregunta && (
                  <Link href={`/ficha/${e.id}`} className="mias-linea">
                    <span>{t("strategies_without_question")}</span>
                  </Link>
                )}
                {resumen?.quitadas_vaciadas && (
                  <Link href={`/ficha/${e.id}`} className="mias-linea">
                    <span>{t("strategies_removed_cleared")}</span>
                  </Link>
                )}
                {e.estado === "borrador" && (
                  <div className="mias-pie">
                    <Boton tamano="pequeno" variante="principal" disabled={pendiente} onClick={() => alApuntar(e.id)}>{t("strategies_sign_up")}</Boton>
                  </div>
                )}
                {ajustes === e.id && (
                  <div className="mias-ajustes">
                    <div className="mias-acciones">
                      <Link href={`/crear/${e.id}`} className="btn small">{t("strategies_edit")}</Link>
                      {e.estado === "borrador" && <Boton tamano="pequeno" variante="discreto" disabled={pendiente} onClick={() => alBorrar(e.id, e.nombre)}>{t("strategies_delete")}</Boton>}
                      {e.estado === "apuntada" && <Boton tamano="pequeno" disabled={pendiente} onClick={() => alDesapuntar(e.id)}>{t("strategies_remove_from_round")}</Boton>}
                    </div>
                    {(e.estado === "apuntada" || e.estado === "jugando") && (
                      <div className="mias-renovacion">
                        <span>{t("strategies_prize_label")}</span>
                        {e.opta_premio
                          ? <small>{t("strategies_prize_note")}</small>
                          : <Boton tamano="pequeno" disabled={pendiente} onClick={() => alOptarAlPremio(e.id)}>{t("strategies_prize_choose")}</Boton>}
                      </div>
                    )}
                    {(e.estado === "apuntada" || e.estado === "jugando") && (
                      <div className="mias-renovacion">
                        <span>{t("strategies_next_month")}</span>
                        <div inert={pendiente || undefined}>
                          <Segmentado<"revisar" | "mantener"> pequeno etiquetaGrupo={t("strategies_next_month_for", { name: e.nombre })}
                            opciones={[{ valor: "revisar", etiqueta: t("strategies_review") }, { valor: "mantener", etiqueta: t("strategies_keep") }]}
                            valor={e.cada_dia_1 === "mantener" ? "mantener" : "revisar"}
                            onChange={(v) => alCambiarCadaDia1(e.id, v)} />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {typeof seguimiento === "string" && (
        <p className="meta" role="status" style={{ marginTop: 12 }}>
          {t("strategies_tracking_error", { message: seguimiento })}
        </p>
      )}

      {aviso && <p className="aviso" role="alert" style={{ marginTop: 16 }}>{aviso}</p>}

      <BarraPestanas />
    </main>
  );
}
