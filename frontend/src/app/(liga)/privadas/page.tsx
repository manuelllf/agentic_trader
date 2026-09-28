"use client";

// «Ligas privadas» (DESIGN.md §7 «Privadas»): Gratis ve un estado vacío con el porqué de Pro (sin
// botón de pago: no hay pasarela todavía, igual que los créditos); Pro ve sus ligas, puede crear
// una y unirse por código.

import Link from "next/link";
import { useEffect, useState } from "react";
import { BarraPestanas, Boton, CabeceraApp, Cargando, ErrorLiga, Vacio } from "../_ui";
import {
  crearLiga, getYo, misLigas, unirseLiga, type LigaResumen, type Yo,
} from "@/lib/liga/api";
import { useSupabase } from "@/lib/liga/supabase";

export default function Privadas() {
  const sb = useSupabase();
  const [sesionLista, setSesionLista] = useState(false);
  const [yo, setYo] = useState<Yo | null>(null);
  const [ligas, setLigas] = useState<LigaResumen[] | string | null>(null);
  const [nombre, setNombre] = useState("");
  const [codigo, setCodigo] = useState("");
  const [ocupada, setOcupada] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    if (sb === undefined) return;
    if (sb === null) { setSesionLista(true); return; }
    (async () => {
      const { data } = await sb.auth.getSession();
      if (!data.session) {
        window.location.replace("/entrar?next=/privadas");
        return;
      }
      setYo(await getYo());
      setSesionLista(true);
    })();
  }, [sb]);

  async function cargar() {
    setLigas(await misLigas());
  }

  useEffect(() => {
    if (sesionLista && yo?.plan === "pro") cargar();
  }, [sesionLista, yo]);

  async function alCrear(e: React.FormEvent) {
    e.preventDefault();
    if (!nombre.trim()) return;
    setOcupada(true);
    setAviso(null);
    const r = await crearLiga(nombre.trim());
    setOcupada(false);
    if (typeof r === "string") { setAviso(r); return; }
    setNombre("");
    await cargar();
  }

  async function alUnirse(e: React.FormEvent) {
    e.preventDefault();
    if (!codigo.trim()) return;
    setOcupada(true);
    setAviso(null);
    const r = await unirseLiga(codigo.trim());
    setOcupada(false);
    if (typeof r === "string") { setAviso(r); return; }
    setCodigo("");
    await cargar();
  }

  return (
    <main className="scroll">
      <CabeceraApp plan={yo?.plan} />
      <h1 className="h1">Ligas privadas</h1>
      <p className="meta">Las mismas jornadas, solo con quien tú invites.</p>

      {!sesionLista || (yo?.plan === "pro" && ligas === null) ? (
        <div style={{ marginTop: 20 }}><Cargando filas={3} /></div>
      ) : yo?.plan !== "pro" ? (
        <div className="empty">
          <h2>Tu liga, con los tuyos</h2>
          <p>
            Crea una liga, pasa el código a quien quieras y jugad las mismas jornadas entre
            vosotros. También puedes unirte a la de otra persona. Las ligas privadas son de Pro.
          </p>
        </div>
      ) : typeof ligas === "string" ? (
        <ErrorLiga titulo="No se pudieron cargar tus ligas" mensaje={ligas}
                   accion={{ texto: "Reintentar", onClick: cargar }} />
      ) : (
        <>
          {ligas && ligas.length === 0 ? (
            <Vacio titulo="Todavía no estás en ninguna liga"
                   texto="Crea una liga privada o únete a la de otra persona con su código." />
          ) : (
            <div className="sec" style={{ marginTop: 14 }}>
              <div style={{ borderTop: "1px solid var(--line)" }}>
                {ligas?.map((l) => (
                  <Link key={l.id} href={`/privadas/${l.id}`} className="li">
                    <span className="t">
                      <b>{l.nombre}</b>
                      <small>{l.n_miembros} de {l.cupo} estrategias</small>
                    </span>
                    {l.es_dueno && <span className="status">tuya</span>}
                  </Link>
                ))}
              </div>
            </div>
          )}

          <div className="sec">
            <div className="sec-t">Unirte con un código</div>
            <form className="form" style={{ marginTop: 0, gap: 12 }} onSubmit={alUnirse}>
              <input className="inp codigo" placeholder="ABC123" maxLength={16} value={codigo}
                     onChange={(e) => setCodigo(e.target.value.toUpperCase())}
                     autoCapitalize="characters" />
              <Boton type="submit" variante="secundario" ancho="completo" disabled={ocupada || !codigo.trim()}>
                Unirme
              </Boton>
            </form>
          </div>

          <div className="sec">
            <div className="sec-t">Crear otra liga</div>
            <form className="form" style={{ marginTop: 0, gap: 12 }} onSubmit={alCrear}>
              <input className="inp" placeholder="Nombre de la liga" maxLength={40} value={nombre}
                     onChange={(e) => setNombre(e.target.value)} />
              <Boton type="submit" variante="principal" ancho="completo" disabled={ocupada || !nombre.trim()}>
                Crear
              </Boton>
            </form>
          </div>

          {aviso && <p className="aviso" role="alert" style={{ marginTop: 16 }}>{aviso}</p>}
        </>
      )}

      <BarraPestanas />
    </main>
  );
}
