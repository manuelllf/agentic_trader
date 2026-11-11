"use client";

// Entrar con la cuenta. Si la cuenta tiene la verificación en dos pasos, se pide el código aquí
// mismo: sin él la sesión se queda en aal1 y las salas no abren.

import { useTranslations } from "next-intl";
import TurnstileWidget from "@/components/TurnstileWidget";
import { useEffect, useState } from "react";
import { GOOGLE_ACTIVO, APPLE_ACTIVO } from "@/lib/liga/proveedores";
import { Boton, CampoClave } from "../_ui";
import { BotonGoogle, Separador } from "../_ui/AccesoProveedor";
import { entrarConAlias } from "@/lib/liga/api";
import { destinoSeguro, useSupabase } from "@/lib/liga/supabase";
import { MarcoAcceso } from "../_ui/MarcoAcceso";
import { mensajeErrorLogin } from "@/lib/liga/login";
import { solicitarCorreo } from "@/lib/liga/registro";
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
  const [turnstile, setTurnstile] = useState("");
  const [captchaReset, setCaptchaReset] = useState(0);
  const captchaPendiente = Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim()) && !turnstile;
  const [correoSinConfirmar, setCorreoSinConfirmar] = useState(false);
  const [reenviado, setReenviado] = useState(false);
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
    setPaso(modo); setError(""); setEnviado(false); setCorreoSinConfirmar(false); setReenviado(false);
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
    setCorreoSinConfirmar(false); setReenviado(false);
    try {
      let fallo: string | null;
      if (email.includes("@")) {
        const { error: e } = await sb.auth.signInWithPassword({ email: email.trim(), password: clave });
        setCorreoSinConfirmar(e?.code === "email_not_confirmed");
        fallo = mensajeErrorLogin(e, t);
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
          <p className="v3-nota">{t("auth_cuentas_cerradas")}</p>
        ) : paso === "credenciales" ? (
          <div key={paso} className="v3-estado">
            {GOOGLE_ACTIVO && <BotonGoogle texto={t("auth_continuar_google")} disabled={ocupado || !sb}
              onClick={() => void entrarProveedor("google")} />}
            {APPLE_ACTIVO && <Boton variante="secundario" ancho="completo" className="v3-secundario"
              disabled={ocupado || !sb} onClick={() => void entrarProveedor("apple")}>{t("auth_continuar_apple")}</Boton>}
            <Separador texto={t("auth_o")} />
            <form className="v3-form" noValidate onSubmit={entrar}>
              <div className="v3-campos">
                <label className="v3-caja">
                  <input type="text" autoFocus autoComplete="username" autoCapitalize="none" autoCorrect="off"
                    spellCheck={false} required aria-label={t("auth_usuario_email")}
                    placeholder={t("auth_campo_usuario_correo")} value={email} onChange={(e) => {
                      setEmail(e.target.value); setCorreoSinConfirmar(false); setReenviado(false);
                    }} />
                </label>
                <CampoClave caja autoComplete="current-password" required
                  value={clave} onChange={(e) => setClave(e.target.value)} />
              </div>
              {error && <p className="v3-aviso" role="alert">{error}</p>}
              {correoSinConfirmar && email.includes("@") && <>
                <div className="v3-seguridad">{t("auth_comprobacion")}</div>
                <TurnstileWidget onToken={setTurnstile} resetKey={captchaReset} />
                {captchaPendiente && <p className="v3-nota" role="status">{t("auth_captcha_pendiente")}</p>}
                <Boton variante="secundario" ancho="completo" className="v3-secundario v3-tinte"
                  disabled={ocupado || captchaPendiente} onClick={async () => {
                  if (ocupado || captchaPendiente) return;
                  setOcupado(true); setError(""); setReenviado(false);
                  const fallo = await solicitarCorreo("/reenviar", { email, turnstile });
                  setTurnstile(""); setCaptchaReset(value => value + 1);
                  setOcupado(false);
                  if (fallo) setError(fallo);
                  else setReenviado(true);
                }}>{t("auth_reenviar_confirmacion")}</Boton></>}
              {reenviado && <p className="v3-nota" role="status">{t("auth_correo_enviado_generico")}</p>}
              <Boton type="submit" variante="principal" ancho="completo" className="v3-principal"
                     disabled={ocupado || !sb || !email || !clave || correoSinConfirmar}>
                {ocupado ? t("auth_entrando") : t("auth_entrar")}
              </Boton>
              <div className="v3-fila">
                <button type="button" className="v3-enlace" disabled={ocupado}
                  onClick={() => cambiarModo("recuperar")}>{t("auth_olvide_contrasena")}</button>
                <button type="button" className="v3-enlace" disabled={ocupado}
                  onClick={() => cambiarModo("enlace")}>{t("auth_enlace_correo")}</button>
              </div>
            </form>
          </div>
        ) : paso !== "codigo" ? (
          <div key={paso} className="v3-estado">
            <form className="v3-form" noValidate onSubmit={enviarCorreo}>
              <div className="v3-campos">
                <label className="v3-caja">
                  <input type="email" autoFocus autoComplete="email" autoCapitalize="none" required
                    aria-label={t("auth_campo_correo")} placeholder={t("auth_campo_correo")}
                    value={email} onChange={e => setEmail(e.target.value)} />
                </label>
              </div>
              {enviado && <p className="v3-nota" role="status">{t("auth_correo_enviado_generico")}</p>}
              <Boton type="submit" variante="principal" ancho="completo" className="v3-principal"
                disabled={ocupado || !sb || !email.trim()}>
                {ocupado ? t("auth_enviando") : t("auth_enviar_enlace")}</Boton>
              <div className="v3-fila">
                <button type="button" className="v3-enlace" disabled={ocupado}
                  onClick={() => cambiarModo("credenciales")}>{t("auth_volver_entrar")}</button>
              </div>
            </form>
          </div>
        ) : (
          <div key={paso} className="v3-estado">
            <p className="v3-nota">{t("auth_codigo_instrucciones")}</p>
            <form className="v3-form" onSubmit={verificar}>
              <CampoCodigo value={codigo} onChange={setCodigo} autoFocus disabled={ocupado} />
              {error && <p className="v3-aviso" role="alert">{error}</p>}
              <Boton type="submit" variante="principal" ancho="completo" className="v3-principal"
                     disabled={ocupado || codigo.length !== 6}>
                {ocupado ? t("auth_comprobando") : t("auth_seguir")}
              </Boton>
            </form>
            <p className="v3-nota">{t("auth_codigo_cambia")}</p>
          </div>
        )}
    </MarcoAcceso>
  );
}
