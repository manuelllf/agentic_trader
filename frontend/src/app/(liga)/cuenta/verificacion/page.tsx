"use client";

// Verificación en dos pasos con una app (Google Authenticator, 1Password…). Sin ella activa y
// superada en esta sesión, el Panel de control no abre.

import Link from "next/link";
import { useEffect, useState } from "react";
import { Boton, Cargando } from "../../_ui";
import { destinoSeguro, useSupabase } from "@/lib/liga/supabase";

type Estado =
  | { paso: "cargando" }
  | { paso: "alta"; factorId: string; qr: string; secreto: string }
  | { paso: "codigo"; factorId: string }
  | { paso: "hecho" };

export default function Verificacion() {
  const sb = useSupabase();
  const [estado, setEstado] = useState<Estado>({ paso: "cargando" });
  const [codigo, setCodigo] = useState("");
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [destino, setDestino] = useState("/liga");

  useEffect(() => {
    const next = destinoSeguro(new URLSearchParams(window.location.search).get("next"));
    setDestino(next);
    if (!sb) return;
    (async () => {
      const { data: sesion } = await sb.auth.getSession();
      if (!sesion.session) {
        window.location.replace(`/entrar?next=${encodeURIComponent("/cuenta/verificacion?next=" + next)}`);
        return;
      }
      const { data: nivel } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
      if (nivel?.currentLevel === "aal2") {
        setEstado({ paso: "hecho" });
        return;
      }
      const { data: factores } = await sb.auth.mfa.listFactors();
      const activo = factores?.totp[0];
      if (activo) {
        setEstado({ paso: "codigo", factorId: activo.id });
        return;
      }
      // Un alta que se quedó a medias bloquearía la nueva: se retira antes.
      for (const f of factores?.all ?? []) {
        if (f.status === "unverified") await sb.auth.mfa.unenroll({ factorId: f.id });
      }
      const { data, error: fallo } = await sb.auth.mfa.enroll({
        factorType: "totp", friendlyName: "App de verificación",
      });
      if (fallo || !data) {
        setError("No se pudo preparar la verificación. Recarga la página para intentarlo otra vez.");
        return;
      }
      setEstado({ paso: "alta", factorId: data.id, qr: data.totp.qr_code, secreto: data.totp.secret });
    })();
  }, [sb]);

  const verificar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sb || ocupado || (estado.paso !== "alta" && estado.paso !== "codigo")) return;
    setOcupado(true);
    setError("");
    try {
      const { error: fallo } = await sb.auth.mfa.challengeAndVerify({
        factorId: estado.factorId, code: codigo.trim(),
      });
      if (fallo) {
        setError("Ese código no vale. Mira el que marca ahora tu app y escríbelo otra vez.");
        return;
      }
      await sb.auth.refreshSession();
      setEstado({ paso: "hecho" });
    } finally {
      setOcupado(false);
    }
  };

  const formCodigo = (
    <form className="form" onSubmit={verificar}>
      <label className="campo">
        <span className="lbl">Código</span>
        <input className="inp codigo" inputMode="numeric" autoComplete="one-time-code"
               pattern="[0-9]{6}" maxLength={6} required value={codigo}
               onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ""))} />
      </label>
      {error && <p className="aviso" role="alert">{error}</p>}
      <Boton type="submit" variante="principal" ancho="completo"
             disabled={ocupado || codigo.length !== 6}>
        {ocupado ? "Comprobando…" : "Verificar"}
      </Boton>
    </form>
  );

  return (
    <main className="sencilla">
      <header className="sencilla-top">
        <Link href="/" className="wordmark">índicem</Link>
      </header>

      <section className="sencilla-cuerpo arriba" aria-labelledby="titular">
        <h1 id="titular">Verificación en dos pasos</h1>
        {sb === null ? (
          <p className="nota">Las cuentas todavía no están abiertas.</p>
        ) : estado.paso === "cargando" ? (
          error ? <p className="aviso" role="alert">{error}</p> : <Cargando filas={2} />
        ) : estado.paso === "alta" ? (
          <>
            <p className="nota">
              Escanea el código con tu app de verificación y escribe las 6 cifras que te dé.
            </p>
            {/* eslint-disable-next-line @next/next/no-img-element -- QR en data URI de Supabase */}
            <img className="qr" src={estado.qr} alt="Código QR para añadir la cuenta a tu app" />
            <p className="secreto">
              Si no puedes escanearlo, añade esta clave a mano: <b className="num">{estado.secreto}</b>
            </p>
            {formCodigo}
          </>
        ) : estado.paso === "codigo" ? (
          <>
            <p className="nota">Escribe el código que marca ahora tu app de verificación.</p>
            {formCodigo}
          </>
        ) : (
          <>
            <p className="nota">Listo: esta sesión ya está verificada.</p>
            <Link href={destino} className="btn pri wide">Seguir</Link>
          </>
        )}
      </section>
    </main>
  );
}
