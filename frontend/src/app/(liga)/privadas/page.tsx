"use client";

// «Ligas privadas» (DESIGN.md §7 «Privadas»): Gratis ve un estado vacío con el porqué de Pro (sin
// botón de pago: no hay pasarela todavía, igual que los créditos); Pro ve sus ligas, puede crear
// una y unirse por código.

import Link from "next/link";
import { useState } from "react";
import { BarraPestanas, Boton, CabeceraApp, Cargando, ErrorLiga, Vacio } from "../_ui";
import { crearLiga, misLigas, unirseLiga, type LigaResumen } from "@/lib/liga/api";
import { useCache } from "@/lib/liga/cache";
import { useSesionRequerida } from "../_sesion/SesionContext";

export default function Privadas() {
  const { estado, yo } = useSesionRequerida("/privadas");
  const sesionLista = estado !== "cargando";
  const esPro = yo?.plan === "pro";

  const { datos: ligas, cargando, refrescar: cargar } = useCache<LigaResumen[] | string>(
    sesionLista && estado === "dentro" && esPro ? "mis-ligas" : null, misLigas,
  );
  const [nombre, setNombre] = useState("");
  const [codigo, setCodigo] = useState("");
  const [ocupada, setOcupada] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  async function alCrear(e: React.FormEvent) {
    e.preventDefault();
    if (!nombre.trim()) return;
    setOcupada(true);
    setAviso(null);
    const r = await crearLiga(nombre.trim());
    setOcupada(false);
    if (typeof r === "string") { setAviso(r); return; }
    setNombre("");
    cargar();
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
    cargar();
  }

  return (
    <main className="scroll">
      <CabeceraApp />
      <h1 className="h1">Ligas privadas</h1>
      <p className="meta">Las mismas jornadas, solo con quien tú invites.</p>

      {!sesionLista || (esPro && cargando) ? (
        <div style={{ marginTop: 20 }}><Cargando filas={3} /></div>
      ) : !esPro ? (
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
