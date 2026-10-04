"use client";

import { useTranslations } from "next-intl";
import { LanguageSelector } from "@/i18n/LanguageSelector";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Boton, CampoClave } from ".";
import { useSupabase } from "@/lib/liga/supabase";
import { claveValida, completarEnlace } from "@/lib/liga/registro";

export function EnlaceCuenta({ recuperar = false }: { recuperar?: boolean }) {
  const t = useTranslations();
  const sb = useSupabase();
  const iniciado = useRef(false);
  const [estado, setEstado] = useState<"cargando" | "listo" | "error" | "guardado">("cargando");
  const [clave, setClave] = useState("");
  const [confirmacion, setConfirmacion] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (sb === undefined || iniciado.current) return;
    iniciado.current = true;
    if (!sb) { setEstado("error"); return; }
    completarEnlace(sb, recuperar ? "recovery" : "signup")
      .then(ok => setEstado(ok ? "listo" : "error"))
      .catch(() => setEstado("error"));
  }, [sb, recuperar]);
  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (ocupado || !sb || estado !== "listo") return;
    if (!claveValida(clave)) { setError(t("auth_clave_requisitos")); return; }
    if (clave !== confirmacion) { setError(t("auth_contrasenas_distintas")); return; }
    setOcupado(true); setError("");
    try {
      const { error: fallo } = await sb.auth.updateUser({ password: clave });
      if (fallo) { setError(t("auth_cambio_clave_fallo")); return; }
      setClave(""); setConfirmacion("");
      await sb.auth.signOut({ scope: "global" });
      setEstado("guardado");
    } catch { setError(t("auth_cambio_conexion")); }
    finally { setOcupado(false); }
  }
  return <main className="sencilla">
    <header className="sencilla-top"><Link href="/" className="wordmark">Vennett</Link><LanguageSelector /></header>
    <section className="sencilla-cuerpo arriba" aria-labelledby="titular">
      <h1 id="titular">{recuperar ? t("auth_nueva_contrasena") : t("auth_confirmar_correo")}</h1>
      {estado === "cargando" && <p role="status">{t("auth_comprobando_enlace")}</p>}
      {estado === "error" && <><p role="alert">{t("auth_enlace_invalido")}</p>
        <Link href={recuperar ? "/recuperar" : "/registrar"}>{t("auth_otro_enlace")}</Link></>}
      {estado === "listo" && (recuperar ? <form className="form" onSubmit={guardar}>
        <CampoClave titulo={t("auth_nueva_contrasena")} autoComplete="new-password" minLength={8} maxLength={200}
          required value={clave} onChange={e => setClave(e.target.value)} aria-describedby="ayuda-clave" />
        <p className="nota" id="ayuda-clave">{t("auth_clave_requisitos")}</p>
        <CampoClave titulo={t("auth_confirmar_contrasena")} autoComplete="new-password" maxLength={200}
          required value={confirmacion} onChange={e => setConfirmacion(e.target.value)} />
        <Boton type="submit" variante="principal" ancho="completo" disabled={ocupado}>
          {ocupado ? t("auth_guardando") : t("auth_guardar_contrasena")}</Boton>
      </form> : <><p role="status">{t("auth_correo_confirmado")}</p><Link href="/liga">{t("auth_ir_liga")}</Link></>)}
      {estado === "guardado" && <><p role="status">{t("auth_clave_cambiada")}</p><Link href="/entrar">{t("auth_entrar")}</Link></>}
      {error && <p className="aviso" role="alert">{error}</p>}
    </section>
  </main>;
}
