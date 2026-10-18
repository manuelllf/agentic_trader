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
  return <MarcoAcceso pestana="crear" sinCambio={enviado}>
      {!enviado && <>
        {GOOGLE_ACTIVO && <BotonGoogle texto={t("auth_continuar_google")} disabled={ocupado || !sb}
          onClick={() => void entrarProveedor("google")} />}
        {APPLE_ACTIVO && <Boton variante="secundario" ancho="completo" disabled={ocupado || !sb}
          onClick={() => void entrarProveedor("apple")}>{t("auth_continuar_apple")}</Boton>}
        <Separador texto={t("auth_o")} />
      </>}
      {enviado ? <>
        <h2>{t("auth_cuenta_creada")}</h2>
        <p>{t("auth_cuenta_creada_entrada")}</p>
        <TurnstileWidget onToken={setTurnstile} resetKey={captchaReset} />
        {captchaPendiente && <p className="nota" role="status">{t("auth_captcha_pendiente")}</p>}
        <Boton variante="secundario" ancho="completo" disabled={ocupado || captchaPendiente || !acceso?.correo_disponible}
          onClick={async () => {
            if (ocupado || captchaPendiente || !acceso?.correo_disponible) return;
            setOcupado(true); setError(""); setReenviado(false);
            const fallo = await solicitarCorreo("/reenviar", { email, turnstile });
            setTurnstile(""); setCaptchaReset(value => value + 1);
            setOcupado(false);
            if (fallo) setError(fallo);
            else setReenviado(true);
          }}>{ocupado ? t("auth_enviando") : t("auth_reenviar_confirmacion")}</Boton>
        {reenviado && <p role="status">{t("auth_correo_enviado_generico")}</p>}
      </> : <form className="form" onSubmit={enviar}>
        <label className="campo"><span className="lbl">{t("auth_email")}</span>
          <input className="inp" type="email" autoComplete="email" autoCapitalize="none" maxLength={254}
            required value={email} onChange={e => setEmail(e.target.value)} /></label>
        <label className="campo"><span className="lbl">{t("auth_nombre_usuario")}</span>
          <input className="inp" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false}
            pattern="[a-z0-9_.]{3,20}" minLength={3} maxLength={20} required value={alias}
            onChange={e => setAlias(e.target.value.toLowerCase())} aria-describedby="ayuda-alias" />
          <span className="nota" id="ayuda-alias">{t("auth_ayuda_alias")}</span></label>
        <label className="campo"><span className="lbl">{t("auth_edad_etiqueta")}</span>
          <input className="inp" type="number" inputMode="numeric" min={14} max={120} step={1} required
            value={edad} onChange={e => setEdad(e.target.value)} aria-describedby="ayuda-edad" />
          <span className="nota" id="ayuda-edad">{t("auth_edad_ayuda")}</span></label>
        <CampoClave autoComplete="new-password" minLength={8} maxLength={200} required value={clave}
          onChange={e => setClave(e.target.value)} aria-describedby="ayuda-clave" />
        <ul className="acc-req" id="ayuda-clave" aria-live="polite">
          <li className={requisitos.longitud ? "hecho" : undefined}>
            <span aria-hidden="true">{requisitos.longitud ? "✓" : "○"}</span>{t("auth_req_longitud")}</li>
          <li className={requisitos.mayuscula ? "hecho" : undefined}>
            <span aria-hidden="true">{requisitos.mayuscula ? "✓" : "○"}</span>{t("auth_req_mayuscula")}</li>
          <li className={requisitos.simbolo ? "hecho" : undefined}>
            <span aria-hidden="true">{requisitos.simbolo ? "✓" : "○"}</span>{t("auth_req_simbolo")}</li>
        </ul>
        <label className="acc-acepta"><input className="acc-chk" type="checkbox" required checked={acepta}
          onChange={e => setAcepta(e.target.checked)} /><span>{t.rich("auth_aceptacion_legal", { terms: chunks => <Link href="/legal/terminos">{chunks}</Link>, privacy: chunks => <Link href="/legal/privacidad">{chunks}</Link> })}</span></label>
        <TurnstileWidget onToken={setTurnstile} resetKey={captchaReset} />
        {captchaPendiente && <p className="nota" role="status">{t("auth_captcha_pendiente")}</p>}
        <Boton type="submit" variante="principal" ancho="completo" disabled={ocupado || captchaPendiente || !sb || !acceso?.registro_abierto}>
          {ocupado ? t("auth_creando_cuenta") : t("auth_crear_cuenta")}</Boton>
      </form>}
      {error && <p className="aviso" role="alert">{error}</p>}
      {sb === null && <p className="nota">{t("auth_registro_no_disponible")}</p>}
      {acceso && !acceso.registro_abierto && <p className="nota">{t("auth_registro_cerrado")}</p>}
  </MarcoAcceso>;
}
