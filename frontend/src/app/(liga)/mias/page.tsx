"use client";

// Pantalla «Mías» (DESIGN.md §7 «Mías»): lista de mis estrategias con su estado, apuntar/
// desapuntar, «Cada día 1» y el borrado de un borrador. El saldo de créditos (F7) sale en el chip
// de la cabecera (`GET /liga/creditos`); la maqueta también pone un botón «Recargar», pero no hay
// pasarela de pago todavía, así que aquí solo se enseña el saldo (gap, ver el informe de F7).
//
// Sesión y perfil vienen de `SesionContext` (una sola vez por app, no por pantalla); la lista de
// estrategias usa la caché compartida (`lib/liga/cache.ts`): al volver a «Mías» se ve lo último
// bueno al instante mientras se revalida, y cada acción (apuntar/desapuntar/cada-día-1/borrar)
// actualiza solo su fila con el objeto que ya devuelve la API en vez de repetir la lista entera.

import Link from "next/link";
import { useState } from "react";
import { Sesion } from "../_sesion/Sesion";
import { BarraPestanas, Boton, Cargando, Escudo, ErrorLiga, Segmentado, Vacio }
  from "../_ui";
import { CambiosEstrategia } from "../_ui/CambiosEstrategia";
import {
  borrarEstrategia, cadaDia1, desapuntar, apuntar as apuntarApi, getJornadaPublica,
  getClasificacion, getPortada, misEstrategias, type Clasificacion, type Estrategia,
  type JornadaDetalle, type Portada,
} from "@/lib/liga/api";
import { mutar, useCache } from "@/lib/liga/cache";
import { fecha, porcentaje } from "@/lib/liga/format";
import { getSeguimiento, type SeguimientoEstrategia }
  from "@/lib/liga/seguimiento";
import { useSesionRequerida } from "../_sesion/SesionContext";

const ETIQUETA_ESTADO: Record<string, string> = {
  borrador: "Borrador", apuntada: "Apuntada, en espera", jugando: "Jugando", retirada: "Retirada",
};
const puntosPorcentuales = (valor: number) => porcentaje(valor).replace(" %", " pp");

type ListaEstrategias = Estrategia[] | string;

/** Cambia solo la fila `id` de la lista cacheada; si `cambios` es un objeto ya lo sustituye
 *  entero (lo que devuelve la API tras la acción), evitando volver a pedir toda la lista. */
function parchearFila(id: string, cambios: Partial<Estrategia> | Estrategia) {
  mutar<ListaEstrategias>("mis-estrategias", (prev) => {
    if (!Array.isArray(prev)) return prev ?? [];
    return prev.map((e) => (e.id === id ? { ...e, ...cambios } : e));
  });
}

export default function Mias() {
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
  // Leer no marca una revisión; la caché privada se invalida al cambiar de cuenta.
  const { datos: seguimiento } = useCache<SeguimientoEstrategia[] | string>(
    estado === "dentro" ? "seguimiento" : null, getSeguimiento,
  );

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
    if (!window.confirm(`¿Borrar el borrador «${nombre}»? No se puede deshacer.`)) return;
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

  return (
    <main className="scroll">
      <div className="titulo-cuenta"><h1 className="h1">Mis estrategias</h1><Sesion /></div>
      <p className="meta">
        {!yo ? "" : yo.plan === "pro"
          ? "Con Pro puedes tener varias jugando a la vez."
          : "Gratis: una estrategia, solo con reglas."}
      </p>

      {estado === "cargando" || cargando ? (
        <div style={{ marginTop: 20 }}><Cargando filas={3} /></div>
      ) : typeof estrategias === "string" ? (
        <ErrorLiga titulo="No se pudieron cargar tus estrategias" mensaje={estrategias}
                   accion={{ texto: "Reintentar", onClick: cargar }} />
      ) : !estrategias || estrategias.length === 0 ? (
        <Vacio
          titulo="Todavía no tienes ninguna"
          texto="Crea tu estrategia: elige las reglas, ajusta los pesos y apúntala a la próxima jornada."
          accion={{ texto: "Crear la primera", onClick: () => { window.location.href = "/crear"; } }}
        />
      ) : (
        <div className="sec estrategias-lista" style={{ marginTop: 14 }}>
          <div style={{ borderTop: "1px solid var(--line)" }}>
            {estrategias.map((e) => (
              <div key={e.id} className="li-bloque" style={{ minWidth: 0 }}>
              <div className="li" style={{ cursor: "default" }}>
                <Escudo valor={e.escudo} etiqueta={`Escudo de ${e.nombre}`} tamano={34} />
                <Link href={`/ficha/${e.id}`} className="t" style={{ textDecoration: "none" }}>
                  <b>{e.nombre}</b>
                  <small>{ETIQUETA_ESTADO[e.estado] ?? e.estado}</small>
                </Link>
                <div className="li-acts">
                  <Link href={`/ficha/${e.id}`} className="btn small">Ver estrategia</Link>
                  <Link href={`/crear/${e.id}`} className="btn small">Editar</Link>
                  {e.estado === "borrador" && (
                    <>
                      <Boton tamano="pequeno" variante="principal" disabled={ocupada === e.id}
                             onClick={() => alApuntar(e.id)}>
                        Apuntarla
                      </Boton>
                      <Boton tamano="pequeno" variante="discreto" disabled={ocupada === e.id}
                             onClick={() => alBorrar(e.id, e.nombre)}>
                        Borrar
                      </Boton>
                    </>
                  )}
                  {e.estado === "apuntada" && (
                    <Boton tamano="pequeno" disabled={ocupada === e.id} onClick={() => alDesapuntar(e.id)}>
                      Quitar de la jornada
                    </Boton>
                  )}
                </div>
              </div>
              {e.estado === "jugando" && (
                <div className="li-dia1" role="status" aria-label={`Resultado de la jornada actual de ${e.nombre}`}
                     style={{ flexWrap: "wrap", alignItems: "flex-start" }}>
                  <span>
                    {typeof detalleJornada === "object" && detalleJornada
                      ? `Jornada ${detalleJornada.jornada.numero} · ${detalleJornada.provisional
                        ? `${detalleJornada.en_vivo ? "Cotizaciones provisionales" : "Último cierre disponible"} · datos hasta ${detalleJornada.hasta ? fecha(detalleJornada.hasta) : "fecha no disponible"}`
                        : "en curso"}`
                      : "Jornada en curso"}
                  </span>
                  {filasJornada?.get(e.id)?.rentabilidad != null ? (
                    <b>
                      {porcentaje(filasJornada.get(e.id)!.rentabilidad!)} este mes
                      {filasJornada.get(e.id)!.dif_sp != null
                        ? ` · ${puntosPorcentuales(filasJornada.get(e.id)!.dif_sp!)} vs S&P`
                        : " · diferencia con S&P no disponible"}
                    </b>
                  ) : (
                    <small>
                      {detalleJornada === undefined ? falloJornada ? "No se pudo cargar el resultado actual."
                        : "Cargando el resultado de la jornada…"
                        : typeof detalleJornada === "string" ? "No se pudo cargar el resultado actual."
                        : filasJornada?.has(e.id) ? "Aún no hay un cálculo provisional para esta estrategia."
                        : "No hay una cifra disponible para esta estrategia en la jornada actual."}
                    </small>
                  )}
                </div>
              )}
              {e.estado !== "borrador" && porEstrategia?.get(e.id) && (
                <div className="li-finanzas" aria-label={`Rendimiento acumulado de ${e.nombre}`}>
                  {porEstrategia.get(e.id)!.acumulado ? (
                    <>
                      <div className="li-finanzas-cifra li-finanzas-principal">
                        <small>{porEstrategia.get(e.id)!.acumulado!.incompleta
                          ? `Últimos ${porEstrategia.get(e.id)!.acumulado!.periodos} periodos seguidos`
                          : "Acumulado"}</small>
                        <b>{porcentaje(porEstrategia.get(e.id)!.acumulado!.rentabilidad)}</b>
                      </div>
                      <div className="li-finanzas-cifra">
                        <small>S&amp;P 500 · mismo periodo</small>
                        <b>{porcentaje(porEstrategia.get(e.id)!.acumulado!.sp500)}</b>
                      </div>
                      <span className={`li-finanzas-diferencia ${porEstrategia.get(e.id)!.acumulado!.diferencia_pp > 0.00005
                        ? "up" : porEstrategia.get(e.id)!.acumulado!.diferencia_pp < -0.00005 ? "dn" : "fl"}`}>
                        {puntosPorcentuales(porEstrategia.get(e.id)!.acumulado!.diferencia_pp)} vs S&amp;P
                      </span>
                      <small className="li-finanzas-periodo">
                        {porEstrategia.get(e.id)!.acumulado!.desde === porEstrategia.get(e.id)!.acumulado!.hasta
                          ? fecha(porEstrategia.get(e.id)!.acumulado!.desde)
                          : `${fecha(porEstrategia.get(e.id)!.acumulado!.desde)} – ${fecha(porEstrategia.get(e.id)!.acumulado!.hasta)}`}
                      </small>
                    </>
                  ) : (
                    <small className="li-finanzas-periodo">Sin jornadas cerradas comparables.</small>
                  )}
                  {rankingPorEstrategia?.get(e.id) && (
                    <span className="li-finanzas-puesto">
                      Liga #{rankingPorEstrategia.get(e.id)!.posicion}
                      {rankingPorEstrategia.get(e.id)!.movimiento == null ? " · sin periodo anterior comparable"
                        : rankingPorEstrategia.get(e.id)!.movimiento! > 0
                          ? ` · ↑${rankingPorEstrategia.get(e.id)!.movimiento} posiciones`
                          : rankingPorEstrategia.get(e.id)!.movimiento! < 0
                            ? ` · ↓${Math.abs(rankingPorEstrategia.get(e.id)!.movimiento!)} posiciones`
                            : " · sin cambio de posición"}
                    </span>
                  )}
                </div>
              )}
              {(e.estado === "apuntada" || e.estado === "jugando") && (
                <div className="li-dia1">
                  <span>Cada día 1</span>
                  <Segmentado<"revisar" | "mantener"> pequeno etiquetaGrupo={`Cada día 1 de ${e.nombre}`}
                              opciones={[{ valor: "revisar", etiqueta: "Revisar" },
                                         { valor: "mantener", etiqueta: "Mantener" }]}
                              valor={e.cada_dia_1 === "mantener" ? "mantener" : "revisar"}
                              onChange={(v) => alCambiarCadaDia1(e.id, v)} />
                </div>
              )}
              {porEstrategia?.get(e.id) && (
                <CambiosEstrategia resumen={porEstrategia.get(e.id)!} />
              )}
              </div>
            ))}
          </div>
        </div>
      )}

      {typeof seguimiento === "string" && (
        <p className="meta" role="status" style={{ marginTop: 12 }}>
          No se pudo cargar el seguimiento: {seguimiento}
        </p>
      )}

      {aviso && <p className="aviso" role="alert" style={{ marginTop: 16 }}>{aviso}</p>}

      <div className="cta">
        <Link href="/crear" className="btn wide">Crear otra estrategia</Link>
      </div>

      <BarraPestanas />
    </main>
  );
}
