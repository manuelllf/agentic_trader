"use client";

// Moderación: reportes pendientes y «Ocultar» (plan §14). No hay ruta de descarte en la API
// (solo listar y ocultar), así que aquí solo se ofrece ocultar.

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import AuthGate from "@/components/AuthGate";
import { ApiError, get, post } from "@/lib/api";

type Reporte = {
  id: number; autor_id: string | null; tipo: "alias" | "estrategia" | "liga" | "pregunta";
  objeto_id: string; motivo: string; estado: string; creado: string; contenido: string | null;
};
type ListaReportes = { total: number; filas: Reporte[] };

const QUE: Record<Reporte["tipo"], string> = {
  alias: "Alias", estrategia: "Nombre de estrategia", liga: "Nombre de liga",
  pregunta: "Pregunta de una estrategia",
};
// Ocultar una pregunta oculta la estrategia entera (lo único que moderación puede tocar).
const OCULTAR: Record<Reporte["tipo"], string> = {
  alias: "este alias", estrategia: "esta estrategia", liga: "esta liga",
  pregunta: "la estrategia de esta pregunta",
};

const CUANTOS = 50;
const error = (e: unknown) => (e instanceof ApiError ? e.message : "Algo falló. Reintenta.");
const CUANDO = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function Moderacion() {
  const [lista, setLista] = useState<ListaReportes | null>(null);
  const [fallo, setFallo] = useState("");
  const [ocupado, setOcupado] = useState<number | null>(null);

  const cargar = useCallback(() => {
    setFallo("");
    get<ListaReportes>(`/liga/moderacion/reportes?cuantos=${CUANTOS}`)
      .then(setLista).catch((e) => setFallo(error(e)));
  }, []);
  useEffect(cargar, [cargar]);

  const ocultar = async (r: Reporte) => {
    if (!window.confirm(`¿Ocultar ${OCULTAR[r.tipo]}? El reporte quedará resuelto.`)) return;
    setOcupado(r.id); setFallo("");
    try {
      await post("/liga/moderacion/ocultar", { reporte_id: r.id });
      cargar();
    } catch (e) { setFallo(error(e)); } finally { setOcupado(null); }
  };

  return (
    <main className="mx-auto max-w-md px-4 pb-16 pt-6 text-[13px]" style={{ color: "#c3c2b7" }}>
      <Link href="/admin/liga" className="text-[12.5px]" style={{ color: "#898781" }}>← Vennett</Link>
      <h1 className="mt-3 text-[19px] text-white"
          style={{ fontFamily: "var(--font-land-serif)", fontStyle: "italic" }}>Moderación</h1>

      {fallo && <p className="mt-3 rounded-lg p-3" style={{ background: "#2a1616", color: "#e66767" }}>{fallo}</p>}
      {!lista ? (
        !fallo && <p className="mt-6" style={{ color: "#898781" }}>Cargando…</p>
      ) : lista.filas.length === 0 ? (
        <p className="mt-6" style={{ color: "#898781" }}>Sin reportes pendientes.</p>
      ) : (
        <>
        {lista.total > lista.filas.length && (
          <p className="mt-4" style={{ color: "#e6a667" }}>
            Hay {lista.total} reportes; aquí salen los {lista.filas.length} más antiguos.
          </p>
        )}
        <ul className="mt-4 border-t" style={{ borderColor: "#303030" }}>
          {lista.filas.map((r) => (
            <li key={r.id} className="border-b py-3" style={{ borderColor: "#303030" }}>
              <p style={{ color: "#898781" }}>{QUE[r.tipo]}</p>
              <p className="mt-1 break-words text-[15px] text-white">
                {r.contenido ?? "(ya no existe o no se puede leer)"}
              </p>
              <p className="mt-1" style={{ color: "#898781" }}>Motivo: {r.motivo}</p>
              <p className="mt-1 text-[11.5px]" style={{ color: "#67665f" }}>
                {CUANDO.format(new Date(r.creado))}
              </p>
              <button type="button" disabled={ocupado === r.id} onClick={() => ocultar(r)}
                      className="mt-2 min-h-[40px] rounded-lg px-3 font-bold text-white disabled:opacity-40"
                      style={{ background: "#7a2020" }}>
                Ocultar
              </button>
            </li>
          ))}
        </ul>
        </>
      )}
    </main>
  );
}

export default function ModeracionAdmin() {
  return (
    <AuthGate>
      <Moderacion />
    </AuthGate>
  );
}
