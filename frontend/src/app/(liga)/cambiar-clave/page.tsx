"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { useSupabase } from "@/lib/liga/supabase";
import { claveValida } from "@/lib/liga/registro";
import { useSesionRequerida } from "../_sesion/SesionContext";
import { Boton, CampoClave } from "../_ui";
import { MarcoAcceso } from "../_ui/MarcoAcceso";

export default function CambiarClave() {
  const t = useTranslations();
  const { estado } = useSesionRequerida("/cambiar-clave");
  const sb = useSupabase();
  const [clave, setClave] = useState("");
  const [repetida, setRepetida] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sb || ocupado || estado !== "dentro") return;
    if (!claveValida(clave)) { setError(t("auth_clave_no_cumple")); return; }
    if (clave !== repetida) { setError(t("auth_contrasenas_distintas")); return; }
    setOcupado(true); setError("");
    try {
      const { error } = await sb.auth.updateUser({ password: clave });
      if (error) setError(t("auth_cambio_clave_fallo"));
      else window.location.assign("/liga");
    } catch { setError(t("auth_cambio_clave_fallo")); }
    finally { setOcupado(false); }
  };

  if (estado !== "dentro") return null;
  return <MarcoAcceso pestana="entrar">
    <form className="form" onSubmit={enviar}>
      <CampoClave titulo={t("auth_nueva_contrasena")} autoComplete="new-password" required
        value={clave} onChange={e => setClave(e.target.value)} />
      <CampoClave titulo={t("auth_confirmar_contrasena")} autoComplete="new-password" required
        value={repetida} onChange={e => setRepetida(e.target.value)} />
      {error && <p className="aviso" role="alert">{error}</p>}
      <Boton type="submit" variante="principal" ancho="completo" disabled={ocupado || !sb}>
        {ocupado ? t("auth_guardando") : t("auth_guardar_contrasena")}</Boton>
    </form>
  </MarcoAcceso>;
}
