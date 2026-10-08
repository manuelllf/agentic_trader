"use client";

// Entrar con la cuenta. Si la cuenta tiene la verificación en dos pasos, se pide el código aquí
// mismo: sin él la sesión se queda en aal1 y las salas no abren.

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { GOOGLE_ACTIVO, APPLE_ACTIVO } from "@/lib/liga/proveedores";
import { Boton, CampoClave } from "../_ui";
import { BotonGoogle, Separador } from "../_ui/AccesoProveedor";
import { entrarConAlias } from "@/lib/liga/api";
import { destinoSeguro, useSupabase } from "@/lib/liga/supabase";
import { MarcoAcceso } from "../_ui/MarcoAcceso";
import { CampoCodigo } from "../_ui/CampoCodigo";

type Paso = "credenciales" | "codigo" | "recuperar" | "enlace";

export default function Entrar() {
  const t = useTranslations();
  const [paso, setPaso] = useState<Paso>("credenciales");
  const [enviado, setEnviado] = useState(false);
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

  const entrarProveedor = async (provider: "google" | "apple") => {
    if (!sb || ocupado) return;
    setOcupado(true); setError("");
    try {
      const { error } = await sb.auth.signInWithOAuth({ provider, options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(destino)}`,
      } });
      if (error) setError(t("auth_sin_proveedor"));
    } catch { setError(t("auth_sin_proveedor")); }
    finally { setOcupado(false); }
  };

  const cambiarModo = (modo: Paso) => {
    setPaso(modo); setError(""); setEnviado(false);
  };

  const enviarCorreo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sb || ocupado) return;
    setOcupado(true); setError("");
    try {
      if (paso === "recuperar") {
        await sb.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent("/cambiar-clave")}`,
        });
      } else {
        await sb.auth.signInWithOtp({ email: email.trim(), options: {
          shouldCreateUser: false,
          emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(destino)}`,
        } });
      }
    } catch {
      // La respuesta uniforme evita revelar si el correo tiene cuenta.
    } finally { setEnviado(true); setOcupado(false); }
  };

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
    <MarcoAcceso pestana="entrar" modo={paso === "codigo" ? "codigo" : "completo"}>
        {sb === null ? (
          <>
            <p className="nota">{t("auth_cuentas_cerradas")}</p>
          </>
        ) : paso === "credenciales" ? (
          <>
            {GOOGLE_ACTIVO && <BotonGoogle texto={t("auth_continuar_google")} disabled={ocupado || !sb}
              onClick={() => void entrarProveedor("google")} />}
            {APPLE_ACTIVO && <Boton variante="secundario" ancho="completo" disabled={ocupado || !sb}
              onClick={() => void entrarProveedor("apple")}>{t("auth_continuar_apple")}</Boton>}
            <Separador texto={t("auth_o")} />
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
              <button type="button" className="acc-olvido" disabled={ocupado}
                onClick={() => cambiarModo("recuperar")}>{t("auth_olvide_contrasena")}</button>
              {error && <p className="aviso" role="alert">{error}</p>}
              <Boton type="submit" variante="principal" ancho="completo"
                     disabled={ocupado || !sb || !email || !clave}>
                {ocupado ? t("auth_entrando") : t("auth_entrar")}
              </Boton>
              <Boton variante="discreto" ancho="completo" disabled={ocupado}
                onClick={() => cambiarModo("enlace")}>{t("auth_entrar_con_enlace")}</Boton>
            </form>
          </>
        ) : paso !== "codigo" ? (
          <form className="form" onSubmit={enviarCorreo}>
            <label className="campo"><span className="lbl">{t("auth_email")}</span>
              <input className="inp" type="email" autoComplete="email" autoCapitalize="none" required
                value={email} onChange={e => setEmail(e.target.value)} /></label>
            {enviado && <p className="nota" role="status">{t("auth_correo_enviado_generico")}</p>}
            <Boton type="submit" variante="principal" ancho="completo" disabled={ocupado || !sb || !email.trim()}>
              {ocupado ? t("auth_enviando") : t("auth_enviar_enlace")}</Boton>
            <Boton variante="secundario" ancho="completo" disabled={ocupado}
              onClick={() => cambiarModo("credenciales")}>{t("auth_volver_entrar")}</Boton>
          </form>
        ) : (
          <>
            <p className="nota">{t("auth_codigo_instrucciones")}</p>
            <form className="form" onSubmit={verificar}>
              <CampoCodigo value={codigo} onChange={setCodigo} autoFocus disabled={ocupado} />
              {error && <p className="aviso" role="alert">{error}</p>}
              <Boton type="submit" variante="principal" ancho="completo"
                     disabled={ocupado || codigo.length !== 6}>
                {ocupado ? t("auth_comprobando") : t("auth_seguir")}
              </Boton>
            </form>
          </>
        )}
    </MarcoAcceso>
  );
}
