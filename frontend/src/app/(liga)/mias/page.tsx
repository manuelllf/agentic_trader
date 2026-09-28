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
import { BarraPestanas, Boton, CabeceraApp, Cargando, Escudo, ErrorLiga, Segmentado, Vacio }
  from "../_ui";
import {
  borrarEstrategia, cadaDia1, desapuntar, apuntar as apuntarApi, misEstrategias,
  type Estrategia,
} from "@/lib/liga/api";
import { mutar, useCache } from "@/lib/liga/cache";
import { useSesionRequerida } from "../_sesion/SesionContext";

const ETIQUETA_ESTADO: Record<string, string> = {
  borrador: "Borrador", apuntada: "Apuntada, en espera", jugando: "Jugando", retirada: "Retirada",
};

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
  const [ocupada, setOcupada] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

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
      <CabeceraApp conCreditos />
      <h1 className="h1">Mis estrategias</h1>
      <p className="meta">
        {yo?.plan === "pro"
          ? "Con Pro puedes tener varias jugando a la vez."
          : "Gratis: una estrategia, solo con reglas."}
      </p>

      {cargando ? (
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
        <div className="sec" style={{ marginTop: 14 }}>
          <div style={{ borderTop: "1px solid var(--line)" }}>
            {estrategias.map((e) => (
              <div key={e.id} className="li" style={{ cursor: "default" }}>
                <Escudo valor={e.escudo} etiqueta={`Escudo de ${e.nombre}`} tamano={34} />
                <span className="t">
                  <b>{e.nombre}</b>
                  <small>{ETIQUETA_ESTADO[e.estado] ?? e.estado}</small>
                  {(e.estado === "apuntada" || e.estado === "jugando") && (
                    <div style={{ marginTop: 8, maxWidth: 220 }}>
                      <Segmentado<"revisar" | "mantener"> pequeno etiquetaGrupo={`Cada día 1 de ${e.nombre}`}
                                  opciones={[{ valor: "revisar", etiqueta: "Revisar" },
                                             { valor: "mantener", etiqueta: "Mantener" }]}
                                  valor={e.cada_dia_1 === "mantener" ? "mantener" : "revisar"}
                                  onChange={(v) => alCambiarCadaDia1(e.id, v)} />
                    </div>
                  )}
                </span>
                <div className="li-acts">
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
            ))}
          </div>
        </div>
      )}

      {aviso && <p className="aviso" role="alert" style={{ marginTop: 16 }}>{aviso}</p>}

      <div className="cta">
        <Link href="/crear" className="btn wide">Crear otra estrategia</Link>
      </div>

      <BarraPestanas />
    </main>
  );
}
