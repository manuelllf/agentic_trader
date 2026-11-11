"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import TurnstileWidget from "@/components/TurnstileWidget";

export type TextosBoletin = {
  titulo: string; nota: string; correo: string; boton: string;
  revisaTitulo: string; revisaTexto: string; error: string; correoInvalido: string;
};

export default function Boletin({ idioma, textos }: {
  idioma: "es" | "en"; textos: TextosBoletin;
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
    // La validación es de la app: el globo del navegador no sale nunca.
    if (!event.currentTarget.checkValidity()) { setError(textos.correoInvalido); return; }
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

  return <section className="blog-suscribir" aria-labelledby={`${id}-titulo`}>
    {enviado ? <div role="status"><h2 id={`${id}-titulo`}>{textos.revisaTitulo}</h2><p>{textos.revisaTexto}</p><p>{correo}</p></div> : <>
      <h2 id={`${id}-titulo`}>{textos.titulo}</h2>
      <form className="blog-suscribir-form" onSubmit={enviar} noValidate aria-describedby={`${id}-nota`}>
        <label className="blog-sr" htmlFor={`${id}-correo`}>{textos.correo}</label>
        <input id={`${id}-correo`} name="correo" type="email" autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false}
          placeholder={textos.correo} required value={correo} disabled={esperando} onChange={event => setCorreo(event.target.value)} />
        <p id={`${id}-nota`} className="blog-sr">{textos.nota}</p>
        <TurnstileWidget onToken={setToken} resetKey={resetKey} />
        <button className="blog-boton" type="submit" disabled={!token || esperando} aria-busy={esperando}>{textos.boton}</button>
        {error && <p role="alert">{error}</p>}
      </form>
    </>}
  </section>;
}
