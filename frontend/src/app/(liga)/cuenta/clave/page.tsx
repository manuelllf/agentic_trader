"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { claveValida } from "@/lib/liga/registro";
import { useSupabase } from "@/lib/liga/supabase";
import { useSesionRequerida } from "../../_sesion/SesionContext";
import { Boton, CampoClave } from "../../_ui";
import { MarcoCuenta } from "../MarcoCuenta";

export default function ClaveCuenta() {
  const t = useTranslations();
  const sb = useSupabase();
  useSesionRequerida("/cuenta/clave");
  const [claveNueva, setClaveNueva] = useState("");
  const [confirmarClave, setConfirmarClave] = useState("");
  const [cambiando, setCambiando] = useState(false);
  const [avisoClave, setAvisoClave] = useState<{ tipo: "bien" | "mal"; texto: string } | null>(null);

  const cambiarClave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (cambiando || !sb) return;
    if (!claveValida(claveNueva)) {
      setAvisoClave({ tipo: "mal", texto: t("account_clave_requisitos") });
      return;
    }
    if (claveNueva !== confirmarClave) {
      setAvisoClave({ tipo: "mal", texto: t("account_contrasenas_distintas") });
      return;
    }
    setCambiando(true);
    setAvisoClave(null);
    const { error } = await sb.auth.updateUser({ password: claveNueva });
    if (error) {
      setAvisoClave({ tipo: "mal", texto: error.status === 422
        ? t("account_clave_invalida") : t("account_cambio_fallo") });
    } else {
      setClaveNueva("");
      setConfirmarClave("");
      setAvisoClave({ tipo: "bien", texto: t("account_clave_cambiada") });
    }
    setCambiando(false);
  };

  return <MarcoCuenta titulo={t("account_clave")}>
    <form className="form" onSubmit={cambiarClave}>
      <CampoClave titulo={t("account_cambiar_clave")} autoComplete="new-password" minLength={8}
        maxLength={200} required value={claveNueva} onChange={e => setClaveNueva(e.target.value)} />
      <p className="nota">{t("account_clave_requisitos")}</p>
      <CampoClave titulo={t("account_confirmar_clave")} autoComplete="new-password" maxLength={200}
        required value={confirmarClave} onChange={e => setConfirmarClave(e.target.value)} />
      {avisoClave && <p className={avisoClave.tipo === "mal" ? "aviso" : "nota"} role="status">{avisoClave.texto}</p>}
      <Boton type="submit" ancho="completo" disabled={cambiando || claveNueva.length < 8}>
        {cambiando ? t("account_cambiando") : t("account_cambiar_clave")}
      </Boton>
    </form>
  </MarcoCuenta>;
}
