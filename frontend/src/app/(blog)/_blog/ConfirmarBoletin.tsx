"use client";

import { Suspense, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

type Textos = { boton: string; espera: string; exito: string; invalido: string; error: string };

function Accion({ textos }: { textos: Textos }) {
  const token = useSearchParams().get("token");
  const [esperando, setEsperando] = useState(false);
  const [resultado, setResultado] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  const ocupado = useRef(false);

  async function enviar() {
    if (!token || ocupado.current) return;
    ocupado.current = true;
    setEsperando(true); setError("");
    try {
      const respuesta = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"}/blog/boletin/confirmar`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }),
      });
      const datos = await respuesta.json().catch(() => null);
      if (!respuesta.ok || typeof datos?.ok !== "boolean") {
        setError(typeof datos?.detail === "string" ? datos.detail : textos.error);
      } else { setResultado(datos.ok); }
    } catch { setError(textos.error); }
    finally { ocupado.current = false; setEsperando(false); }
  }

  if (!token || resultado === false) return <p role="status">{textos.invalido}</p>;
  if (resultado === true) return <p role="status">{textos.exito}</p>;
  return <>
    <button className="blog-boton" type="button" onClick={enviar} disabled={esperando} aria-busy={esperando} style={{ minHeight: 44 }}>
      {esperando ? textos.espera : textos.boton}
    </button>
    {error && <p role="alert">{error}</p>}
  </>;
}

export default function ConfirmarBoletin({ textos }: { textos: Textos }) {
  return <Suspense fallback={<p role="status">{textos.espera}</p>}><Accion textos={textos} /></Suspense>;
}
