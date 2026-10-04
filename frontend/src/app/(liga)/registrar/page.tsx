"use client";

import { useTranslations } from "next-intl";
import { LanguageSelector } from "@/i18n/LanguageSelector";
import Link from "next/link";
import { useState } from "react";
import { Boton, CampoClave } from "../_ui";
import { useSupabase } from "@/lib/liga/supabase";
import { claveValida, solicitarCorreo, useAccesoCorreo } from "@/lib/liga/registro";

export default function Registrar() {
  const t = useTranslations();
  const sb = useSupabase();
  const acceso = useAccesoCorreo();
  const [email, setEmail] = useState("");
  const [alias, setAlias] = useState("");
  const [clave, setClave] = useState("");
  const [confirmacion, setConfirmacion] = useState("");
  const [acepta, setAcepta] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [error, setError] = useState("");
  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (ocupado || !sb || !acceso?.registro_abierto) return;
    if (!claveValida(clave)) { setError(t("auth_clave_requisitos")); return; }
    if (clave !== confirmacion) { setError(t("auth_contrasenas_distintas")); return; }
    setOcupado(true); setError("");
    const fallo = await solicitarCorreo("", { email, alias, clave, acepta_terminos: acepta });
    if (fallo) { setOcupado(false); setError(fallo); }
    else {
      let falloAcceso = false;
      try {
        const resultado = await sb.auth.signInWithPassword({ email: email.trim(), password: clave });
        falloAcceso = Boolean(resultado.error);
      } catch {
        falloAcceso = true;
      }
      setClave(""); setConfirmacion("");
      setOcupado(false);
      if (falloAcceso) setEnviado(true);
      else window.location.assign("/liga");
    }
  }
  return <main className="sencilla">
    <header className="sencilla-top"><Link href="/" className="wordmark">Vennett</Link><LanguageSelector /></header>
    <section className="sencilla-cuerpo arriba" aria-labelledby="titular">
      <h1 id="titular">{enviado ? t("auth_cuenta_creada") : t("auth_crear_cuenta")}</h1>
      {enviado ? <>
        <p>{t("auth_cuenta_creada_entrada")}</p>
        <Link href="/entrar" className="btn">{t("auth_entrar")}</Link>
      </> : <form className="form" onSubmit={enviar}>
        <label className="campo"><span className="lbl">{t("auth_email")}</span>
          <input className="inp" type="email" autoComplete="email" autoCapitalize="none" maxLength={254}
            required value={email} onChange={e => setEmail(e.target.value)} /></label>
        <label className="campo"><span className="lbl">{t("auth_nombre_usuario")}</span>
          <input className="inp" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false}
            pattern="[a-z0-9_.]{3,20}" minLength={3} maxLength={20} required value={alias}
            onChange={e => setAlias(e.target.value.toLowerCase())} aria-describedby="ayuda-alias" />
          <span className="nota" id="ayuda-alias">{t("auth_ayuda_alias")}</span></label>
        <CampoClave autoComplete="new-password" minLength={8} maxLength={200} required value={clave}
          onChange={e => setClave(e.target.value)} aria-describedby="ayuda-clave" />
        <p className="nota" id="ayuda-clave">{t("auth_clave_requisitos")}</p>
        <CampoClave titulo={t("auth_confirmar_contrasena")} autoComplete="new-password" required maxLength={200}
          value={confirmacion} onChange={e => setConfirmacion(e.target.value)} />
        <label className="registro-aceptacion"><input type="checkbox" required checked={acepta}
          onChange={e => setAcepta(e.target.checked)} /><span>{t.rich("auth_aceptacion_legal", { terms: chunks => <Link href="/legal/terminos">{chunks}</Link>, privacy: chunks => <Link href="/legal/privacidad">{chunks}</Link> })}</span></label>
        <Boton type="submit" variante="principal" ancho="completo" disabled={ocupado || !sb || !acceso?.registro_abierto}>
          {ocupado ? t("auth_creando_cuenta") : t("auth_crear_cuenta")}</Boton>
      </form>}
      {error && <p className="aviso" role="alert">{error}</p>}
      {sb === null && <p className="nota">{t("auth_registro_no_disponible")}</p>}
      {acceso && !acceso.registro_abierto && <p className="nota">{t("auth_registro_cerrado")}</p>}
      <p><Link href="/entrar">{t("auth_ya_tengo_cuenta")}</Link></p>
    </section>
  </main>;
}
