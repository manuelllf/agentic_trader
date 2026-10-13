"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { solicitarCorreo, useAccesoCorreo } from "@/lib/liga/registro";
import { Boton } from "../_ui";
import { MarcoAcceso } from "../_ui/MarcoAcceso";

export default function Recuperar() {
  const t = useTranslations();
  const acceso = useAccesoCorreo();
  const [email, setEmail] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [error, setError] = useState("");

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (ocupado || !acceso?.correo_disponible) return;
    setOcupado(true); setError("");
    const fallo = await solicitarCorreo("/recuperar", { email });
    setOcupado(false);
    if (fallo) setError(fallo);
    else setEnviado(true);
  }

  return <MarcoAcceso modo="tramite" titular={t("auth_recuperar_contrasena")}>
    {enviado ? <p role="status">{t("auth_correo_enviado_generico")}</p> :
      <form className="form" onSubmit={enviar}>
        <label className="campo"><span className="lbl">{t("auth_email_cuenta")}</span>
          <input className="inp" type="email" autoComplete="email" autoCapitalize="none" maxLength={254}
            required value={email} onChange={e => setEmail(e.target.value)} /></label>
        <Boton type="submit" variante="principal" ancho="completo" disabled={ocupado || !acceso?.correo_disponible}>
          {ocupado ? t("auth_enviando") : t("auth_enviar_enlace")}</Boton>
      </form>}
    {error && <p className="aviso" role="alert">{error}</p>}
    {acceso && !acceso.correo_disponible && <p className="nota">{t("auth_recuperacion_no_disponible")}</p>}
  </MarcoAcceso>;
}
