"use client";

// Pantalla «Mías» (DESIGN.md §7 «Mías»): lista de mis estrategias con su estado, apuntar/
// desapuntar, «Cada día 1» y el borrado de un borrador. La maqueta añade un bloque de créditos
// de IA con «Recargar»: `/liga/yo` no da un saldo en euros (no hay endpoint de créditos todavía),
// así que ese bloque se omite en vez de inventar una cifra (gap de backend, ver el informe de F7).

import Link from "next/link";
import { useEffect, useState } from "react";
import { BarraPestanas, Boton, CabeceraApp, Cargando, Escudo, ErrorLiga, Segmentado, Vacio }
  from "../_ui";
import {
  borrarEstrategia, cadaDia1, desapuntar, apuntar as apuntarApi, getYo, misEstrategias,
  type Estrategia, type Yo,
} from "@/lib/liga/api";
import { useSupabase } from "@/lib/liga/supabase";

const ETIQUETA_ESTADO: Record<string, string> = {
  borrador: "Borrador", apuntada: "Apuntada, en espera", jugando: "Jugando", retirada: "Retirada",
};

export default function Mias() {
  const sb = useSupabase();
  const [sesionLista, setSesionLista] = useState(false);
  const [yo, setYo] = useState<Yo | null>(null);
  const [estrategias, setEstrategias] = useState<Estrategia[] | string | null>(null);
  const [ocupada, setOcupada] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    if (sb === undefined) return;
    if (sb === null) { setSesionLista(true); return; }
    (async () => {
      const { data } = await sb.auth.getSession();
      if (!data.session) {
        window.location.replace("/entrar?next=/mias");
        return;
      }
      setYo(await getYo());
      setSesionLista(true);
    })();
  }, [sb]);

  async function cargar() {
    setEstrategias(await misEstrategias());
  }

  useEffect(() => {
    if (sesionLista) cargar();
  }, [sesionLista]);

  async function alApuntar(id: string) {
    setOcupada(id);
    setAviso(null);
    const r = await apuntarApi(id);
    if (typeof r === "string") setAviso(r); else await cargar();
    setOcupada(null);
  }

  async function alDesapuntar(id: string) {
    setOcupada(id);
    setAviso(null);
    const r = await desapuntar(id);
    if (typeof r === "string") setAviso(r); else await cargar();
    setOcupada(null);
  }

  async function alCambiarCadaDia1(id: string, opcion: "revisar" | "mantener") {
    setOcupada(id);
    setAviso(null);
    const r = await cadaDia1(id, opcion);
    if (typeof r === "string") setAviso(r); else await cargar();
    setOcupada(null);
  }

  async function alBorrar(id: string, nombre: string) {
    if (!window.confirm(`¿Borrar el borrador «${nombre}»? No se puede deshacer.`)) return;
    setOcupada(id);
    setAviso(null);
    const r = await borrarEstrategia(id);
    if (typeof r === "string") setAviso(r); else await cargar();
    setOcupada(null);
  }

  return (
    <main className="scroll">
      <CabeceraApp plan={yo?.plan} />
      <h1 className="h1">Mis estrategias</h1>
      <p className="meta">
        {yo?.plan === "pro"
          ? "Con Pro puedes tener varias jugando a la vez."
          : "Gratis: una estrategia, solo con reglas."}
      </p>

      {!sesionLista || estrategias === null ? (
        <div style={{ marginTop: 20 }}><Cargando filas={3} /></div>
      ) : typeof estrategias === "string" ? (
        <ErrorLiga titulo="No se pudieron cargar tus estrategias" mensaje={estrategias}
                   accion={{ texto: "Reintentar", onClick: cargar }} />
      ) : estrategias.length === 0 ? (
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
