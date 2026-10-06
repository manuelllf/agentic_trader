"use client";

// Entrar con la cuenta. Si la cuenta tiene la verificación en dos pasos, se pide el código aquí
// mismo: sin él la sesión se queda en aal1 y las salas no abren.

import { useTranslations } from "next-intl";
import { LanguageSelector } from "@/i18n/LanguageSelector";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Boton, CampoClave } from "../_ui";
import { entrarConAlias } from "@/lib/liga/api";
import { destinoSeguro, useSupabase } from "@/lib/liga/supabase";
import { Marca } from "../_ui/Marca";

type Paso = "credenciales" | "codigo";

export default function Entrar() {
  const t = useTranslations();
  const [paso, setPaso] = useState<Paso>("credenciales");
  const [email, setEmail] = useState("");
  const [clave, setClave] = useState("");
  const [codigo, setCodigo] = useState("");
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [destino, setDestino] = useState("/liga");
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
        fallo = !e ? null : e.status === 429 ? t("auth_muchos_intentos")
          : t("auth_credenciales_incorrectas");
      } else {
        fallo = await entrarConAlias(sb, email, clave);
      }
      if (fallo) {
        setError(fallo);
        return;
      }
      const { data, error: falloNivel } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
      if (falloNivel) { setError(t("system_signin_failed")); return; }
      if (data?.nextLevel === "aal2" && data.currentLevel !== "aal2") {
        setPaso("codigo");
        return;
      }
      seguir();
    } catch {
      setError(t("system_signin_failed"));
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
        setError(t("auth_sin_verificacion"));
        return;
      }
      const { error: fallo } = await sb.auth.mfa.challengeAndVerify({
        factorId: factor.id, code: codigo.trim(),
      });
      if (fallo) {
        setError(t("auth_codigo_incorrecto"));
        return;
      }
      seguir();
    } catch {
      setError(t("system_signin_failed"));
    } finally {
      setOcupado(false);
    }
  };

  return (
    <main className="sencilla">
      <header className="sencilla-top">
        <Link href="/" className="wordmark"><Marca /></Link>
      <LanguageSelector /></header>

      <section className="sencilla-cuerpo arriba" aria-labelledby="titular">
        {sb === null ? (
          <>
            <h1 id="titular">{t("auth_entrar")}</h1>
            <p className="nota">{t("auth_cuentas_cerradas")}</p>
          </>
        ) : paso === "credenciales" ? (
          <>
            <h1 id="titular">{t("auth_entrar")}</h1>
            <form className="form" onSubmit={entrar}>
              <label className="campo">
                <span className="lbl">{t("auth_usuario_email")}</span>
                <input className="inp" type="text" autoComplete="username" required
                       autoCapitalize="none" autoCorrect="off" spellCheck={false}
                       value={email} onChange={(e) => setEmail(e.target.value)}
                       placeholder={t("auth_ejemplo_usuario")} />
              </label>
              <CampoClave autoComplete="current-password" required
                value={clave} onChange={(e) => setClave(e.target.value)} />
              {error && <p className="aviso" role="alert">{error}</p>}
              <Boton type="submit" variante="principal" ancho="completo"
                     disabled={ocupado || !sb || !email || !clave}>
                {ocupado ? t("auth_entrando") : t("auth_entrar")}
              </Boton>
            </form>
            <p>{t("auth_sin_cuenta")} <Link href="/registrar">{t("auth_crear_cuenta")}</Link></p>
          </>
        ) : (
          <>
            <h1 id="titular">{t("auth_tu_codigo")}</h1>
            <p className="nota">{t("auth_codigo_instrucciones")}</p>
            <form className="form" onSubmit={verificar}>
              <label className="campo">
                <span className="lbl">{t("auth_codigo")}</span>
                <input className="inp codigo" inputMode="numeric" autoComplete="one-time-code"
                       pattern="[0-9]{6}" maxLength={6} required autoFocus value={codigo}
                       onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ""))} />
              </label>
              {error && <p className="aviso" role="alert">{error}</p>}
              <Boton type="submit" variante="principal" ancho="completo"
                     disabled={ocupado || codigo.length !== 6}>
                {ocupado ? t("auth_comprobando") : t("auth_seguir")}
              </Boton>
            </form>
          </>
        )}
      </section>
    </main>
  );
}
