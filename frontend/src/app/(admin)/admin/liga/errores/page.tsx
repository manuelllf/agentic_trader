"use client";

// Errores que la gente reporta desde la web (botón «Reportar este error»): el código que vio
// coincide con el del registro del servidor en Railway. Se marcan como resueltos al revisarlos.

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import AuthGate from "@/components/AuthGate";
import { ApiError, get, post } from "@/lib/api";

type Aviso = {
  id: number; codigo: string | null; alias: string | null; pantalla: string; mensaje: string;
  nota: string | null; contexto: Record<string, unknown>; estado: "abierto" | "resuelto";
  creado: string;
};
type Lista = { total: number; filas: Aviso[] };

const CUANTOS = 50;
const error = (e: unknown) => (e instanceof ApiError ? e.message : "Algo falló. Reintenta.");
const CUANDO = new Intl.DateTimeFormat("es-ES", {
  day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
});

function Errores() {
  const [estado, setEstado] = useState<"abierto" | "resuelto">("abierto");
  const [lista, setLista] = useState<Lista | null>(null);
  const [fallo, setFallo] = useState("");
  const [ocupado, setOcupado] = useState<number | null>(null);
  const ultima = useRef(0);

  const cargar = useCallback((e: "abierto" | "resuelto") => {
    setFallo("");
    const n = ++ultima.current;
    get<Lista>(`/liga/admin/errores?estado=${e}&cuantos=${CUANTOS}`)
      .then((r) => { if (n === ultima.current) setLista(r); })
      .catch((err) => { if (n === ultima.current) setFallo(error(err)); });
  }, []);
  useEffect(() => { setLista(null); cargar(estado); }, [cargar, estado]);

  const resolver = async (a: Aviso) => {
    setOcupado(a.id); setFallo("");
    try {
      await post(`/liga/admin/errores/${a.id}/resolver`);
      cargar(estado);
    } catch (e) { setFallo(error(e)); } finally { setOcupado(null); }
  };

  return (
    <main className="mx-auto max-w-md px-4 pb-16 pt-6 text-[13px]" style={{ color: "#c3c2b7" }}>
      <Link href="/admin/liga" className="text-[12.5px]" style={{ color: "#898781" }}>← Liguilla</Link>
      <h1 className="mt-3 text-[19px] text-white"
          style={{ fontFamily: "var(--font-land-serif)", fontStyle: "italic" }}>Errores</h1>

      <div className="mt-3 flex gap-2">
        {(["abierto", "resuelto"] as const).map((e) => (
          <button key={e} type="button" onClick={() => setEstado(e)}
                  className="min-h-[44px] rounded-lg px-4 font-bold"
                  style={{ background: estado === e ? "#3987e5" : "#2c2c2a",
                           color: estado === e ? "#fff" : "#c3c2b7" }}>
            {e === "abierto" ? "Abiertos" : "Resueltos"}
          </button>
        ))}
      </div>

      {fallo && <p className="mt-3 rounded-lg p-3" style={{ background: "#2a1616", color: "#e66767" }}>{fallo}</p>}
      {!lista ? (
        !fallo && <p className="mt-6" style={{ color: "#898781" }}>Cargando…</p>
      ) : lista.filas.length === 0 ? (
        <p className="mt-6" style={{ color: "#898781" }}>
          {estado === "abierto" ? "Sin errores pendientes." : "Aún no hay errores resueltos."}
        </p>
      ) : (
        <>
          {lista.total > lista.filas.length && (
            <p className="mt-4" style={{ color: "#e6a667" }}>
              Hay {lista.total}; aquí salen los {lista.filas.length} más recientes.
            </p>
          )}
          <ul className="mt-4 border-t" style={{ borderColor: "#303030" }}>
            {lista.filas.map((a) => (
              <li key={a.id} className="border-b py-3" style={{ borderColor: "#303030" }}>
                <p className="break-words text-white">
                  {a.mensaje}
                </p>
                <p className="mt-1 break-all" style={{ color: "#898781" }}>
                  {a.codigo ? `código ${a.codigo} · ` : ""}{a.pantalla} · {a.alias ?? "sin sesión"}
                </p>
                {a.nota && <p className="mt-1 break-words">«{a.nota}»</p>}
                {Object.keys(a.contexto).length > 0 && (
                  <p className="mt-1 break-all text-[11.5px]" style={{ color: "#67665f" }}>
                    {Object.entries(a.contexto).map(([k, v]) => `${k}: ${String(v)}`).join(" · ")}
                  </p>
                )}
                <p className="mt-1 text-[11.5px]" style={{ color: "#67665f" }}>
                  {CUANDO.format(new Date(a.creado))}
                </p>
                {a.estado === "abierto" && (
                  <button type="button" disabled={ocupado === a.id} onClick={() => resolver(a)}
                          className="mt-2 min-h-[44px] rounded-lg px-4 font-bold text-white disabled:opacity-40"
                          style={{ background: "#1f5f3a" }}>
                    Marcar como resuelto
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}

export default function ErroresAdmin() {
  return (
    <AuthGate>
      <Errores />
    </AuthGate>
  );
}
