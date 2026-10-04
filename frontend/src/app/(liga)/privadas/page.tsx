"use client";

// Una liga reúne personas; su estrategia representante se obtiene de la competición.

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { BarraPestanas, Boton, Cargando, ErrorLiga, Vacio } from "../_ui";
import { crearLiga, misLigas, unirseLiga, type LigaResumen } from "@/lib/liga/api";
import { invalidar, useCache } from "@/lib/liga/cache";
import { useSesionRequerida } from "../_sesion/SesionContext";
import { fecha } from "@/lib/liga/format";
import "./privadas.css";

export default function Privadas() {
  const router = useRouter();
  const { estado, yo } = useSesionRequerida("/privadas");
  const sesionLista = estado !== "cargando";
  const esPro = yo?.plan === "pro";

  const { datos: ligas, cargando, fallo, refrescar: cargar } = useCache<LigaResumen[] | string>(
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
    invalidar("mis-ligas"); router.push(`/privadas/${r.id}`);
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
    invalidar("mis-ligas"); router.push(`/privadas/${r.id}`);
  }

  return (
    <main className="scroll privadas">
      <p className="priv-eyebrow">Vuestro punto de comparación</p>
      <h1 className="h1">Ligas privadas</h1>
      <p className="meta">Sigue las estrategias de tu grupo, compara resultados y entiende cómo invierte cada persona.</p>

      {!sesionLista || (estado === "dentro" && !yo) || (esPro && cargando) ? (
        <div style={{ marginTop: 20 }}><Cargando filas={3} /></div>
      ) : !esPro ? (
        <div className="empty">
          <h2>Tu liga, con los tuyos</h2>
          <p>
            Crea una liga, pasa el código a quien quieras y comparad las mismas jornadas entre
            vosotros. También puedes unirte a la de otra persona. Las ligas privadas son de Pro.
          </p>
        </div>
      ) : fallo || typeof ligas === "string" ? (
        <ErrorLiga titulo="No se pudieron cargar tus ligas" mensaje={typeof ligas === "string" ? ligas : "Reintenta en un momento."}
                   accion={{ texto: "Reintentar", onClick: cargar }} />
      ) : (
        <>
          {ligas && ligas.length === 0 ? (
            <Vacio titulo="Todavía no estás en ninguna liga"
                   texto="Crea una liga privada o únete a la de otra persona con su código." />
          ) : (
            <section className="sec">
              <h2 className="sec-t">Tus ligas · {ligas?.length ?? 0}</h2>
              <div className="priv-lista">
                {ligas?.map((l) => (
                  <Link key={l.id} href={`/privadas/${l.id}`} className="priv-liga">
                    <span className="priv-eyebrow">{l.es_dueno ? "La organizas tú" : "Participas"}</span>
                    <h3>{l.nombre}</h3>
                    <span className="priv-liga-miembros"><b>{l.n_miembros}</b> participantes <small>· {l.cupo - l.n_miembros} plazas libres</small></span>
                    <span className="priv-liga-pie"><small>Desde {fecha(l.creada.slice(0, 10))}</small><span>Ver resultados →</span></span>
                  </Link>
                ))}
              </div>
            </section>
          )}

          <div className="priv-accesos">
          <section className="priv-panel">
            <h2>¿Te han invitado?</h2>
            <p>Introduce el código del organizador. Tu estrategia aparecerá cuando tenga una cartera formada.</p>
            <form className="form" style={{ marginTop: 0, gap: 12 }} onSubmit={alUnirse}>
              <label htmlFor="liga-codigo">Código de invitación</label>
              <input id="liga-codigo" className="inp codigo" placeholder="ABC123" maxLength={16} value={codigo}
                     onChange={(e) => setCodigo(e.target.value.toUpperCase())}
                     autoCapitalize="characters" />
              <Boton type="submit" variante="secundario" ancho="completo" disabled={ocupada || !codigo.trim()}>
                {ocupada ? "Espera…" : "Unirme a la liga"}
              </Boton>
            </form>
          </section>

          <section className="priv-panel">
            <h2>Reúne a tu grupo</h2>
            <p>Crea una liga y comparte su código. Cada persona participa con su propia cuenta Pro.</p>
            <form className="form" style={{ marginTop: 0, gap: 12 }} onSubmit={alCrear}>
              <label htmlFor="liga-nombre">Nombre de la liga</label>
              <input id="liga-nombre" className="inp" placeholder="Un nombre para vuestro grupo" maxLength={40} value={nombre}
                     onChange={(e) => setNombre(e.target.value)} />
              <Boton type="submit" variante="principal" ancho="completo" disabled={ocupada || !nombre.trim()}>
                {ocupada ? "Espera…" : "Crear liga"}
              </Boton>
            </form>
          </section>

          </div>
          {aviso && <p className="aviso" role="alert" style={{ marginTop: 16 }}>{aviso}</p>}
        </>
      )}

      <BarraPestanas />
    </main>
  );
}
