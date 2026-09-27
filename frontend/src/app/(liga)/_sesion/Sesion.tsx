"use client";

// Cabecera de sesión: «Entrar» sin cuenta; con cuenta, un botón con el alias que abre un menú
// corto (Panel de control solo al admin, y Salir). Se abre al tocar, nunca al pasar por encima.

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { getYo, type Yo } from "@/lib/liga/api";
import { supabase } from "@/lib/liga/supabase";

type Estado = { tipo: "cargando" } | { tipo: "fuera" } | { tipo: "dentro"; yo: Yo | null };

export function Sesion() {
  const [estado, setEstado] = useState<Estado>({ tipo: "cargando" });
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sb = supabase();
    if (!sb) {
      setEstado({ tipo: "fuera" });
      return;
    }
    let vivo = true;
    sb.auth.getSession().then(async ({ data }) => {
      if (!vivo) return;
      if (!data.session) {
        setEstado({ tipo: "fuera" });
        return;
      }
      const yo = await getYo();
      if (vivo) setEstado({ tipo: "dentro", yo });
    });
    return () => { vivo = false; };
  }, []);

  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: PointerEvent) => {
      if (!caja.current?.contains(e.target as Node)) setAbierto(false);
    };
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape") setAbierto(false); };
    document.addEventListener("pointerdown", fuera);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", fuera);
      document.removeEventListener("keydown", escape);
    };
  }, [abierto]);

  const salir = async () => {
    await supabase()?.auth.signOut();
    setAbierto(false);
    setEstado({ tipo: "fuera" });
  };

  if (estado.tipo === "cargando") return null;
  if (estado.tipo === "fuera") {
    return <Link href="/entrar" className="btn small discreto">Entrar</Link>;
  }
  const { yo } = estado;
  const panel = yo?.aal2 ? "/admin" : "/cuenta/verificacion?next=/admin";
  return (
    <div className="cuenta" ref={caja}>
      <button type="button" className="cuenta-boton" aria-haspopup="menu"
              aria-expanded={abierto} onClick={() => setAbierto((a) => !a)}>
        <span>{yo?.alias ?? "Tu cuenta"}</span>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.8"
                strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {abierto && (
        <div className="cuenta-menu" role="menu">
          <Link href="/cuenta" role="menuitem" className="cuenta-item">Tu cuenta</Link>
          {yo?.admin && (
            <Link href={panel} role="menuitem" className="cuenta-item">Panel de control</Link>
          )}
          <button type="button" role="menuitem" className="cuenta-item salir" onClick={salir}>
            Salir
          </button>
        </div>
      )}
    </div>
  );
}
