"use client";

// Ajustes: solo las claves conocidas por la API (`gestion.AJUSTES_CONOCIDOS`); nada de crear
// claves libres — el backend rechaza cualquier otra con 422.

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import AuthGate from "@/components/AuthGate";
import { ApiError, get, put } from "@/lib/api";

type Ajuste = { clave: string; valor: unknown; actualizado: string; actualizado_por: string | null };

// Misma lista que `gestion.AJUSTES_CONOCIDOS` en el backend; si la API no la conoce, el PUT
// devuelve 422 y el mensaje se enseña tal cual.
const CLAVES_CONOCIDAS = [
  "creditos.pro_mensual",
  "ia.conversor.activo", "ia.pregunta.activo", "ia.lectura.activo", "ia.moderacion.activo",
  "ia.tope_mensual_usd", "ia.margen_objetivo",
];

const error = (e: unknown) => (e instanceof ApiError ? e.message : "Algo falló. Reintenta.");
const FECHA = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

function Ajustes() {
  const [ajustes, setAjustes] = useState<Ajuste[] | null>(null);
  const [fallo, setFallo] = useState("");
  const [ocupada, setOcupada] = useState<string | null>(null);
  const [borradores, setBorradores] = useState<Record<string, string>>({});

  const cargar = useCallback(() => {
    setFallo("");
    get<Ajuste[]>("/liga/admin/ajustes").then((filas) => {
      setAjustes(filas);
      setBorradores(Object.fromEntries(
        CLAVES_CONOCIDAS.map((c) => {
          const f = filas.find((x) => x.clave === c);
          return [c, f ? JSON.stringify(f.valor) : ""];
        }),
      ));
    }).catch((e) => setFallo(error(e)));
  }, []);
  useEffect(cargar, [cargar]);

  const guardar = async (clave: string) => {
    let valor: unknown;
    try { valor = JSON.parse(borradores[clave]); } catch { setFallo("Ese valor no es JSON válido."); return; }
    if (!window.confirm(`¿Guardar «${clave}» = ${borradores[clave]}?`)) return;
    setOcupada(clave); setFallo("");
    try { await put(`/liga/admin/ajustes/${encodeURIComponent(clave)}`, { valor }); cargar(); }
    catch (e) { setFallo(error(e)); } finally { setOcupada(null); }
  };

  return (
    <main className="mx-auto max-w-md px-4 pb-16 pt-6 text-[13px]" style={{ color: "#c3c2b7" }}>
      <Link href="/admin/liga" className="text-[12.5px]" style={{ color: "#898781" }}>← Liguilla</Link>
      <h1 className="mt-3 text-[19px] text-white"
          style={{ fontFamily: "var(--font-land-serif)", fontStyle: "italic" }}>Ajustes</h1>

      {fallo && <p className="mt-3 rounded-lg p-3" style={{ background: "#2a1616", color: "#e66767" }}>{fallo}</p>}
      {!ajustes ? (
        !fallo && <p className="mt-6" style={{ color: "#898781" }}>Cargando…</p>
      ) : (
        <ul className="mt-4 border-t" style={{ borderColor: "#303030" }}>
          {CLAVES_CONOCIDAS.map((clave) => {
            const fila = ajustes.find((a) => a.clave === clave) ?? null;
            return (
              <li key={clave} className="border-b py-3" style={{ borderColor: "#303030" }}>
                <p className="text-white">{clave}</p>
                <p className="mt-1 text-[11.5px]" style={{ color: "#67665f" }}>
                  {fila ? `Actualizado ${FECHA.format(new Date(fila.actualizado))}` : "Sin valor todavía."}
                </p>
                <div className="mt-2 flex gap-2">
                  <input value={borradores[clave] ?? ""}
                         onChange={(e) => setBorradores({ ...borradores, [clave]: e.target.value })}
                         placeholder="Valor JSON, p. ej. 5"
                         className="min-h-[44px] flex-1 rounded-lg border px-3 text-white"
                         style={{ background: "#141413", borderColor: "#303030" }} />
                  <button type="button" disabled={ocupada === clave} onClick={() => guardar(clave)}
                          className="min-h-[44px] rounded-lg px-4 font-bold text-white disabled:opacity-40"
                          style={{ background: "#3987e5" }}>
                    Guardar
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}

export default function AjustesAdmin() {
  return (
    <AuthGate>
      <Ajustes />
    </AuthGate>
  );
}
