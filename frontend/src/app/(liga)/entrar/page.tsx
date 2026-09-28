"use client";

// Entrar con la cuenta. Si la cuenta tiene la verificación en dos pasos, se pide el código aquí
// mismo: sin él la sesión se queda en aal1 y las salas no abren.

import Link from "next/link";
import { useEffect, useState } from "react";
import { Boton } from "../_ui";
import { entrarConAlias } from "@/lib/liga/api";
import { destinoSeguro, useSupabase } from "@/lib/liga/supabase";

type Paso = "credenciales" | "codigo";

export default function Entrar() {
  const [paso, setPaso] = useState<Paso>("credenciales");
  const [email, setEmail] = useState("");
  const [clave, setClave] = useState("");
  const [codigo, setCodigo] = useState("");
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [destino, setDestino] = useState("/");
  const sb = useSupabase();

  useEffect(() => {
    setDestino(destinoSeguro(new URLSearchParams(window.location.search).get("next")));
  }, []);

  const seguir = () => window.location.assign(destino);

  const entrar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sb || ocupado) return;
    setOcupado(true);
    setError("");
    try {
      let fallo: string | null;
      if (email.includes("@")) {
        const { error: e } = await sb.auth.signInWithPassword({ email: email.trim(), password: clave });
        fallo = !e ? null : e.status === 429 ? "Demasiados intentos. Espera unos minutos."
          : "El usuario o la contraseña no coinciden. Revísalos y prueba otra vez.";
      } else {
        fallo = await entrarConAlias(sb, email, clave);
      }
      if (fallo) {
        setError(fallo);
        return;
      }
      const { data } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
      if (data?.nextLevel === "aal2" && data.currentLevel !== "aal2") {
        setPaso("codigo");
        return;
      }
      seguir();
    } finally {
      setOcupado(false);
    }
  };

  const verificar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sb || ocupado) return;
    setOcupado(true);
    setError("");
    try {
      const { data } = await sb.auth.mfa.listFactors();
      const factor = data?.totp[0];
      if (!factor) {
        setError("Tu cuenta no tiene ninguna app de verificación activa.");
        return;
      }
      const { error: fallo } = await sb.auth.mfa.challengeAndVerify({
        factorId: factor.id, code: codigo.trim(),
      });
      if (fallo) {
        setError("Ese código no vale. Mira el que marca ahora tu app y escríbelo otra vez.");
        return;
      }
      seguir();
    } finally {
      setOcupado(false);
    }
  };

  return (
    <main className="sencilla">
      <header className="sencilla-top">
        <Link href="/" className="wordmark">liguilla</Link>
      </header>

      <section className="sencilla-cuerpo arriba" aria-labelledby="titular">
        {sb === null ? (
          <>
            <h1 id="titular">Entrar</h1>
            <p className="nota">Las cuentas todavía no están abiertas.</p>
          </>
        ) : paso === "credenciales" ? (
          <>
            <h1 id="titular">Entrar</h1>
            <form className="form" onSubmit={entrar}>
              <label className="campo">
                <span className="lbl">Email o nombre de usuario</span>
                <input className="inp" type="text" autoComplete="username" required
                       autoCapitalize="none" autoCorrect="off" spellCheck={false}
                       value={email} onChange={(e) => setEmail(e.target.value)}
                       placeholder="tu_usuario o tu@correo.es" />
              </label>
              <label className="campo">
                <span className="lbl">Contraseña</span>
                <input className="inp" type="password" autoComplete="current-password" required
                       value={clave} onChange={(e) => setClave(e.target.value)} />
              </label>
              {error && <p className="aviso" role="alert">{error}</p>}
              <Boton type="submit" variante="principal" ancho="completo"
                     disabled={ocupado || !email || !clave}>
                {ocupado ? "Entrando…" : "Entrar"}
              </Boton>
            </form>
          </>
        ) : (
          <>
            <h1 id="titular">Tu código</h1>
            <p className="nota">Abre tu app de verificación y escribe el código de 6 cifras.</p>
            <form className="form" onSubmit={verificar}>
              <label className="campo">
                <span className="lbl">Código</span>
                <input className="inp codigo" inputMode="numeric" autoComplete="one-time-code"
                       pattern="[0-9]{6}" maxLength={6} required autoFocus value={codigo}
                       onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ""))} />
              </label>
              {error && <p className="aviso" role="alert">{error}</p>}
              <Boton type="submit" variante="principal" ancho="completo"
                     disabled={ocupado || codigo.length !== 6}>
                {ocupado ? "Comprobando…" : "Seguir"}
              </Boton>
            </form>
          </>
        )}
      </section>
    </main>
  );
}
