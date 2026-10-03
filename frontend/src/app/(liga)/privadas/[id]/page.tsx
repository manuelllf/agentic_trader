"use client";

// Detalle de una liga privada (DESIGN.md §7 «Privadas»): miembros y su clasificación dentro de
// la liga, el código para invitar (solo el dueño) y salir. Sin el gráfico ni las filas «De
// referencia» de la maqueta (necesitarían la clasificación general por cada estrategia de la
// casa: fuera del alcance de F7, ver el informe).

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { BarraPestanas, Boton, Cargando, ErrorLiga } from "../../_ui";
import {
  expulsarDeLiga, rotarCodigoLiga, salirLiga, verLiga, type LigaDetalle,
} from "@/lib/liga/api";
import { useCache } from "@/lib/liga/cache";
import { useSesionRequerida } from "../../_sesion/SesionContext";
import { claseSigno, fecha, porcentaje } from "@/lib/liga/format";

const puntosPorcentuales = (valor: number) => porcentaje(valor).replace(" %", " pp");

export default function PrivadaDetalle() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { estado } = useSesionRequerida(`/privadas/${id}`);
  const sesionLista = estado !== "cargando";

  // Clave por `id` de la liga: igual que en la ficha, así cambiar de liga rápido nunca deja que
  // una respuesta vieja pise la de la liga que se está mirando ahora (M5 del informe).
  const { datos: liga, cargando, refrescar: cargar } = useCache<LigaDetalle | string>(
    sesionLista && estado === "dentro" ? `liga:${id}` : null, () => verLiga(id),
  );
  const [ocupada, setOcupada] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  async function copiarCodigo(codigo: string) {
    try {
      await navigator.clipboard.writeText(codigo);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      setAviso("No se pudo copiar. Copia el código a mano.");
    }
  }

  async function cambiarCodigo() {
    if (!window.confirm("¿Cambiar el código? El anterior dejará de servir para unirse.")) return;
    setOcupada(true);
    setAviso(null);
    const r = await rotarCodigoLiga(id);
    setOcupada(false);
    if (typeof r === "string") { setAviso(r); return; }
    cargar();
  }

  async function salir() {
    if (!window.confirm("¿Salir de esta liga?")) return;
    setOcupada(true);
    const r = await salirLiga(id);
    setOcupada(false);
    if (typeof r === "string") { setAviso(r); return; }
    router.push("/privadas");
  }

  async function expulsar(alias: string) {
    if (!window.confirm(
      `¿Expulsar a ${alias}? Si no quieres que vuelva, cambia el código.`,
    )) return;
    setOcupada(true);
    setAviso(null);
    const r = await expulsarDeLiga(id, alias);
    setOcupada(false);
    if (typeof r === "string") { setAviso(r); return; }
    cargar();
  }

  return (
    <main className="scroll">
      <Link href="/privadas" className="back">
        <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M15 6l-6 6 6 6" />
        </svg>
        Ligas privadas
      </Link>

      {!sesionLista || cargando ? (
        <div style={{ marginTop: 20 }}><Cargando filas={4} /></div>
      ) : typeof liga === "string" ? (
        <ErrorLiga titulo="No se pudo cargar la liga" mensaje={liga}
                   accion={{ texto: "Reintentar", onClick: cargar }} />
      ) : !liga ? null : (
        <>
          <h1 className="h1">{liga.nombre}</h1>
          <p className="meta">{liga.n_miembros} de {liga.cupo} estrategias.</p>

          <div className="sec">
            <div className="tbl-h financiero" aria-hidden="true">
              <span>Posición</span>
              <span>Participante</span>
              <span>Acumulado · S&amp;P 500</span>
              <span>Puntos Liga</span>
            </div>
            {liga.miembros.map((m, index) => (
              <div key={m.alias} className={`tr financiero${m.es_yo ? " me" : ""}`}>
                <span className="pos num">{index + 1}</span>
                <span className="name">
                  <span className="nm">
                    <b>{m.alias}</b>
                    {m.es_yo && <span className="sub"><span className="tag">la tuya</span></span>}
                    {liga.es_dueno && !m.es_yo && (
                      <span className="sub">
                        <Boton variante="discreto" tamano="pequeno" disabled={ocupada}
                               onClick={() => expulsar(m.alias)}>
                          Expulsar
                        </Boton>
                      </span>
                    )}
                  </span>
                </span>
                <span className="finance" aria-label={`Rendimiento acumulado de ${m.alias}`}>
                  {m.acumulado ? (
                    <>
                      <span className={`primary num ${claseSigno(m.acumulado.rentabilidad)}`}>
                        {porcentaje(m.acumulado.rentabilidad)}
                      </span>
                      <span className={`bench num ${claseSigno(m.acumulado.sp500)}`}>
                        S&amp;P 500 {porcentaje(m.acumulado.sp500)}
                      </span>
                      <span className={`pp num ${claseSigno(m.acumulado.diferencia_pp)}`}>
                        {puntosPorcentuales(m.acumulado.diferencia_pp)} vs S&amp;P
                      </span>
                      <span className="period">
                        {m.acumulado.incompleta ? `Últimos ${m.acumulado.periodos} periodos seguidos` : "Acumulado"}
                        {" · "}{fecha(m.acumulado.desde)} – {fecha(m.acumulado.hasta)}
                      </span>
                    </>
                  ) : <span className="period">Sin jornadas cerradas comparables</span>}
                </span>
                <span className="rankmeta">
                  <span className={`move ${m.movimiento == null ? "fl" : m.movimiento > 0 ? "up" : m.movimiento < 0 ? "dn" : "fl"}`}>
                    {m.movimiento == null ? "Sin periodo anterior comparable"
                      : m.movimiento > 0 ? `↑${m.movimiento} posiciones`
                      : m.movimiento < 0 ? `↓${Math.abs(m.movimiento)} posiciones`
                      : "Sin cambio de posición"}
                  </span>
                  <span className="pts num">{m.puntos ?? "—"} pts</span>
                </span>
              </div>
            ))}
          </div>

          {liga.es_dueno && liga.codigo && (
            <div className="sec">
              <div className="sec-t">Invitar</div>
              <div className="code">
                <span>{liga.codigo}</span>
                <Boton onClick={() => copiarCodigo(liga.codigo as string)}>
                  {copiado ? "Copiado" : "Copiar código"}
                </Boton>
              </div>
              <p className="fine">Aquí se ven el alias y el resultado de cada uno.</p>
              <Boton ancho="completo" disabled={ocupada} onClick={cambiarCodigo}
                     style={{ marginTop: 12 }}>
                Cambiar código
              </Boton>
            </div>
          )}

          {aviso && <p className="aviso" role="alert" style={{ marginTop: 16 }}>{aviso}</p>}

          {!liga.es_dueno && (
            <div className="cta">
              <Boton variante="discreto" ancho="completo" disabled={ocupada} onClick={salir}>
                Salir de esta liga
              </Boton>
            </div>
          )}
        </>
      )}

      <BarraPestanas />
    </main>
  );
}
