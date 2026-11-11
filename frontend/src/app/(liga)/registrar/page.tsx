"use client";

import { useTranslations } from "next-intl";
import TurnstileWidget from "@/components/TurnstileWidget";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Boton, CampoClave } from "../_ui";
import { BotonGoogle, Separador } from "../_ui/AccesoProveedor";
import { GOOGLE_ACTIVO, APPLE_ACTIVO } from "@/lib/liga/proveedores";
import { destinoSeguro, useSupabase } from "@/lib/liga/supabase";
import { claveValida, requisitosClave, solicitarCorreo, useAccesoCorreo } from "@/lib/liga/registro";
import { MarcoAcceso } from "../_ui/MarcoAcceso";

export default function Registrar() {
  const t = useTranslations();
  const sb = useSupabase();
  const acceso = useAccesoCorreo();
  const [email, setEmail] = useState("");
  const [alias, setAlias] = useState("");
  const [edad, setEdad] = useState("");
  const [clave, setClave] = useState("");
  const [acepta, setAcepta] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [reenviado, setReenviado] = useState(false);
  const [error, setError] = useState("");
  const [turnstile, setTurnstile] = useState("");
  const [captchaReset, setCaptchaReset] = useState(0);
  const captchaPendiente = Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim()) && !turnstile;
  const [destino, setDestino] = useState("/liga");
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

  const requisitos = requisitosClave(clave);
  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (ocupado || captchaPendiente || !sb || !acceso?.registro_abierto) return;
    // El formulario no usa los avisos del navegador: lo que falte se dice aquí.
    if (!email || !alias || !edad || !clave || !acepta) { setError(t("auth_completa_campos")); return; }
    if (!claveValida(clave)) { setError(t("auth_clave_revisa")); return; }
    const edadNumero = Number(edad);
    if (!Number.isInteger(edadNumero) || edadNumero < 14) { setError(t("auth_edad_minima")); return; }
    if (edadNumero > 120) { setError(t("auth_edad_no_valida")); return; }
    setOcupado(true); setError("");
    const fallo = await solicitarCorreo("", { email, alias, edad: edadNumero, clave, acepta_terminos: acepta, turnstile });
    setTurnstile(""); setCaptchaReset(value => value + 1);
    if (fallo) { setOcupado(false); setError(fallo); }
    else {
      let falloAcceso = false;
      try {
        const resultado = await sb.auth.signInWithPassword({ email: email.trim(), password: clave });
        falloAcceso = Boolean(resultado.error);
      } catch {
        falloAcceso = true;
      }
      setClave("");
      setOcupado(false);
      if (falloAcceso) setEnviado(true);
      else window.location.assign("/liga");
    }
  }

  const cerrado = acceso?.registro_abierto === false;
  return <MarcoAcceso pestana="crear" sinCambio={enviado}>
      {enviado ? (
        <div className="v3-estado">
          <h2 className="v3-enviada">{t("auth_cuenta_creada")}</h2>
          <p className="v3-texto">{t("auth_cuenta_creada_entrada")}</p>
          <div className="v3-seguridad">{t("auth_comprobacion")}</div>
          <TurnstileWidget onToken={setTurnstile} resetKey={captchaReset} />
          {captchaPendiente && <p className="v3-nota" role="status">{t("auth_captcha_pendiente")}</p>}
          <Boton variante="secundario" ancho="completo" className="v3-secundario v3-tinte"
            disabled={ocupado || captchaPendiente || !acceso?.correo_disponible}
            onClick={async () => {
              if (ocupado || captchaPendiente || !acceso?.correo_disponible) return;
              setOcupado(true); setError(""); setReenviado(false);
              const fallo = await solicitarCorreo("/reenviar", { email, turnstile });
              setTurnstile(""); setCaptchaReset(value => value + 1);
              setOcupado(false);
              if (fallo) setError(fallo);
              else setReenviado(true);
            }}>{ocupado ? t("auth_enviando") : t("auth_reenviar_confirmacion")}</Boton>
          {reenviado && <p className="v3-nota" role="status">{t("auth_correo_enviado_generico")}</p>}
          {error && <p className="v3-aviso" role="alert">{error}</p>}
        </div>
      ) : cerrado ? (
        <div className="v3-estado">
          <div className="v3-campos v3-apagado">
            <label className="v3-caja"><input type="email" disabled aria-label={t("auth_campo_correo")} placeholder={t("auth_campo_correo")} /></label>
            <label className="v3-caja"><input type="text" disabled aria-label={t("auth_campo_usuario")} placeholder={t("auth_campo_usuario")} /></label>
          </div>
          <p className="v3-aviso" role="status">{t("auth_registro_cerrado")}</p>
          {sb === null && <p className="v3-nota">{t("auth_registro_no_disponible")}</p>}
          <Link href="/entrar" className="v3-principal">{t("auth_entrar")}</Link>
        </div>
      ) : (
        <div className="v3-estado">
          {GOOGLE_ACTIVO && <BotonGoogle texto={t("auth_continuar_google")} disabled={ocupado || !sb}
            onClick={() => void entrarProveedor("google")} />}
          {APPLE_ACTIVO && <Boton variante="secundario" ancho="completo" className="v3-secundario"
            disabled={ocupado || !sb} onClick={() => void entrarProveedor("apple")}>{t("auth_continuar_apple")}</Boton>}
          <Separador texto={t("auth_o")} />
          <form className="v3-form" noValidate onSubmit={enviar}>
            <div className="v3-campos">
              <label className="v3-caja">
                <input type="email" autoComplete="email" autoCapitalize="none" maxLength={254} required
                  aria-label={t("auth_campo_correo")} placeholder={t("auth_campo_correo")}
                  value={email} onChange={e => setEmail(e.target.value)} />
              </label>
              <label className="v3-caja">
                <input type="text" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                  pattern="[a-z0-9_.]{3,20}" minLength={3} maxLength={20} required value={alias}
                  aria-label={t("auth_nombre_usuario")} placeholder={t("auth_campo_usuario")}
                  onChange={e => setAlias(e.target.value.toLowerCase())} aria-describedby="ayuda-campos" />
              </label>
              <label className="v3-caja">
                <input type="number" inputMode="numeric" min={14} max={120} step={1} required value={edad}
                  aria-label={t("auth_edad_etiqueta")} placeholder={t("auth_campo_edad")}
                  onChange={e => setEdad(e.target.value)} aria-describedby="ayuda-campos" />
              </label>
              <CampoClave caja autoComplete="new-password" minLength={8} maxLength={200} required value={clave}
                onChange={e => setClave(e.target.value)} aria-describedby="ayuda-clave" />
            </div>
            <p className="v3-ayuda" id="ayuda-campos">{t("auth_ayuda_registro")}</p>
            <p className="v3-ayuda" id="ayuda-clave" aria-live="polite">
              <Requisito cumplido={requisitos.longitud} texto={t("auth_req_longitud")} /> · <Requisito cumplido={requisitos.mayuscula} texto={t("auth_req_mayuscula")} /> · <Requisito cumplido={requisitos.simbolo} texto={t("auth_req_simbolo")} />
            </p>
            <label className="v3-acepta">
              <input type="checkbox" required checked={acepta} onChange={e => setAcepta(e.target.checked)} />
              <span className="v3-marca-sel" aria-hidden="true">
                <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" focusable="false"><path d="M2.5 7.5l3 3 6-6.5" /></svg>
              </span>
              <span className="v3-txt">{t.rich("auth_aceptacion_legal", { terms: chunks => <Link href="/legal/terminos">{chunks}</Link>, privacy: chunks => <Link href="/legal/privacidad">{chunks}</Link> })}</span>
            </label>
            <div className="v3-seguridad">{t("auth_comprobacion")}</div>
            <TurnstileWidget onToken={setTurnstile} resetKey={captchaReset} />
            {captchaPendiente && <p className="v3-nota" role="status">{t("auth_captcha_pendiente")}</p>}
            {error && <p className="v3-aviso" role="alert">{error}</p>}
            <Boton type="submit" variante="principal" ancho="completo" className="v3-principal"
              disabled={ocupado || captchaPendiente || !sb || !acceso?.registro_abierto}>
              {ocupado ? t("auth_creando_cuenta") : t("auth_crear_cuenta")}</Boton>
          </form>
          {sb === null && <p className="v3-nota">{t("auth_registro_no_disponible")}</p>}
        </div>
      )}
  </MarcoAcceso>;
}

function Requisito({ cumplido, texto }: { cumplido: boolean; texto: string }) {
  return <span className={cumplido ? "hecho" : undefined}><b aria-hidden="true">{cumplido ? "✓" : "○"}</b> {texto}</span>;
}
