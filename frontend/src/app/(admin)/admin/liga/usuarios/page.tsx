"use client";

// Admin: buscar usuarios por alias, paginado (plan §5.2/§11). Cada fila lleva al detalle, donde
// están los roles, el plan, el saldo y las escrituras.

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import AuthGate from "@/components/AuthGate";
import { ApiError, get } from "@/lib/api";

type UsuarioFila = {
  id: string; alias: string; roles: string[]; plan: "gratis" | "pro";
  plan_hasta: string | null; suspendido: boolean; creado: string;
};
type ListaUsuarios = { total: number; filas: UsuarioFila[] };

const CUANTOS = 50;
const error = (e: unknown) => (e instanceof ApiError ? e.message : "Algo falló. Reintenta.");

function Usuarios() {
  const [alias, setAlias] = useState("");
  const [buscando, setBuscando] = useState("");
  const [desde, setDesde] = useState(0);
  const [lista, setLista] = useState<ListaUsuarios | null>(null);
  const [fallo, setFallo] = useState("");
  const [cargando, setCargando] = useState(false);

  const cargar = useCallback((a: string, d: number) => {
    setCargando(true); setFallo("");
    const q = new URLSearchParams({ alias: a, desde: String(d), cuantos: String(CUANTOS) });
    get<ListaUsuarios>(`/liga/admin/usuarios?${q.toString()}`)
      .then(setLista).catch((e) => setFallo(error(e))).finally(() => setCargando(false));
  }, []);

  useEffect(() => { cargar(buscando, desde); }, [cargar, buscando, desde]);

  const buscar = (e: React.FormEvent) => {
    e.preventDefault();
    setDesde(0); setBuscando(alias.trim());
  };

  return (
    <main className="mx-auto max-w-md px-4 pb-16 pt-6 text-[13px]" style={{ color: "#c3c2b7" }}>
      <Link href="/admin/liga" className="text-[12.5px]" style={{ color: "#898781" }}>← Liguilla</Link>
      <h1 className="mt-3 text-[19px] text-white"
          style={{ fontFamily: "var(--font-land-serif)", fontStyle: "italic" }}>Usuarios</h1>

      <form onSubmit={buscar} className="mt-4 flex gap-2">
        <input value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="Buscar por alias"
               className="min-h-[44px] flex-1 rounded-lg border px-3 text-white"
               style={{ background: "#141413", borderColor: "#303030" }} />
        <button type="submit"
                className="min-h-[44px] rounded-lg px-4 font-bold text-white"
                style={{ background: "#3987e5" }}>
          Buscar
        </button>
      </form>

      {fallo && <p className="mt-3 rounded-lg p-3" style={{ background: "#2a1616", color: "#e66767" }}>{fallo}</p>}
      {cargando && !lista && <p className="mt-6" style={{ color: "#898781" }}>Cargando…</p>}

      {lista && (
        <>
          <p className="mt-4" style={{ color: "#898781" }}>{lista.total} usuarios.</p>
          <ul className="mt-2 border-t" style={{ borderColor: "#303030" }}>
            {lista.filas.map((u) => (
              <li key={u.id} className="border-b" style={{ borderColor: "#303030" }}>
                <Link href={`/admin/liga/usuarios/${u.id}`}
                      className="flex min-h-[56px] items-center justify-between gap-2 py-2">
                  <span>
                    <span className="text-white">{u.alias}</span>
                    {u.suspendido && (
                      <span className="ml-2 rounded px-1.5 py-0.5 text-[11px]"
                            style={{ background: "#2a1616", color: "#e66767" }}>suspendido</span>
                    )}
                    {u.plan === "pro" && (
                      <span className="ml-2 rounded px-1.5 py-0.5 text-[11px]"
                            style={{ background: "#1f5f3a", color: "#9be0b3" }}>pro</span>
                    )}
                  </span>
                  <span style={{ color: "#898781" }}>{u.roles.join(", ") || "usuario"}</span>
                </Link>
              </li>
            ))}
          </ul>
          {lista.filas.length === 0 && <p className="mt-4" style={{ color: "#898781" }}>Sin resultados.</p>}
          <div className="mt-4 flex justify-between gap-2">
            <button type="button" disabled={desde === 0 || cargando}
                    onClick={() => setDesde(Math.max(0, desde - CUANTOS))}
                    className="min-h-[44px] rounded-lg px-4 disabled:opacity-40"
                    style={{ background: "#2c2c2a", color: "#c3c2b7" }}>
              Anterior
            </button>
            <button type="button" disabled={desde + CUANTOS >= lista.total || cargando}
                    onClick={() => setDesde(desde + CUANTOS)}
                    className="min-h-[44px] rounded-lg px-4 disabled:opacity-40"
                    style={{ background: "#2c2c2a", color: "#c3c2b7" }}>
              Siguiente
            </button>
          </div>
        </>
      )}
    </main>
  );
}

export default function UsuariosAdmin() {
  return (
    <AuthGate>
      <Usuarios />
    </AuthGate>
  );
}
