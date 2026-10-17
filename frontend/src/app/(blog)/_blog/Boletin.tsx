"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import TurnstileWidget from "@/components/TurnstileWidget";

export type TextosBoletin = {
  titulo: string; intro: string; nota: string; correo: string; boton: string;
  revisaTitulo: string; revisaTexto: string; error: string;
};

export default function Boletin({ idioma, variante, textos }: {
  idioma: "es" | "en"; variante: "pagina" | "articulo"; textos: TextosBoletin;
}) {
  const id = useId();
  const [correo, setCorreo] = useState("");
  const [token, setToken] = useState("");
  const [resetKey, setResetKey] = useState(0);
  const [esperando, setEsperando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [error, setError] = useState("");
  const ocupado = useRef(false);
  if (!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim()) return null;

  async function enviar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || ocupado.current) return;
    ocupado.current = true;
    setEsperando(true); setError("");
    try {
      const respuesta = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"}/blog/boletin`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ correo, idioma, turnstile: token }),
      });
      if (respuesta.status === 202) { setEnviado(true); return; }
      const datos = await respuesta.json().catch(() => null);
      setError(typeof datos?.detail === "string" ? datos.detail : textos.error);
    } catch { setError(textos.error); }
    finally {
      setToken(""); setResetKey(value => value + 1);
      ocupado.current = false; setEsperando(false);
    }
  }

  return <section aria-labelledby={`${id}-titulo`} style={{ marginBlock: "2rem", padding: variante === "articulo" ? "1rem" : "1.5rem", border: "1px solid currentColor", borderRadius: 12, minWidth: 0 }}>
    {enviado ? <div role="status"><h2 id={`${id}-titulo`}>{textos.revisaTitulo}</h2><p>{textos.revisaTexto}</p><p style={{ overflowWrap: "anywhere" }}>{correo}</p></div> : <>
      <h2 id={`${id}-titulo`} style={variante === "articulo" ? { fontSize: "1.25rem" } : undefined}>{textos.titulo}</h2>
      <p>{textos.intro}</p><p id={`${id}-nota`}>{textos.nota}</p>
      <form onSubmit={enviar} aria-describedby={`${id}-nota`} style={{ display: "grid", gap: 12, minWidth: 0 }}>
        <label htmlFor={`${id}-correo`}>{textos.correo}</label>
        <input id={`${id}-correo`} name="correo" type="email" autoComplete="email" required value={correo} disabled={esperando}
          onChange={event => setCorreo(event.target.value)} style={{ minHeight: 44, width: "100%", minWidth: 0, boxSizing: "border-box" }} />
        <TurnstileWidget onToken={setToken} resetKey={resetKey} />
        <button className="blog-boton" type="submit" disabled={!token || esperando} aria-busy={esperando} style={{ minHeight: 44 }}>{textos.boton}</button>
        {error && <p role="alert">{error}</p>}
      </form>
    </>}
  </section>;
}
