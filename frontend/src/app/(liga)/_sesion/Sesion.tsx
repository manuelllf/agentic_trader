"use client";

// Cabecera de sesión: «Entrar» sin cuenta; con cuenta, el alias y «Salir». Al admin le sale además
// el Panel de control, que pasa antes por el 2FA si esta sesión aún no lo ha superado.

import Link from "next/link";
import { useEffect, useState } from "react";
import { getYo, type Yo } from "@/lib/liga/api";
import { supabase } from "@/lib/liga/supabase";

type Estado = { tipo: "cargando" } | { tipo: "fuera" } | { tipo: "dentro"; yo: Yo | null };

export function Sesion() {
  const [estado, setEstado] = useState<Estado>({ tipo: "cargando" });

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

  const salir = async () => {
    await supabase()?.auth.signOut();
    setEstado({ tipo: "fuera" });
  };

  if (estado.tipo === "cargando") return null;
  if (estado.tipo === "fuera") {
    return <Link href="/entrar" className="btn small discreto">Entrar</Link>;
  }
  const { yo } = estado;
  const panel = yo?.aal2 ? "/admin" : "/cuenta/verificacion?next=/admin";
  return (
    <div className="sesion">
      {yo && <span className="alias">{yo.alias}</span>}
      {yo?.admin && <Link href={panel} className="btn small pri">Panel de control</Link>}
      <button type="button" className="btn small discreto" onClick={salir}>Salir</button>
    </div>
  );
}
