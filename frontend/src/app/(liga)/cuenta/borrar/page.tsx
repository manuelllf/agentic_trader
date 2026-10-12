"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { borrarMiCuenta } from "@/lib/liga/cuenta";
import { useSupabase } from "@/lib/liga/supabase";
import { useSesionRequerida } from "../../_sesion/SesionContext";
import { Boton } from "../../_ui";
import { MarcoCuenta } from "../MarcoCuenta";

export default function BorrarCuenta() {
  const t = useTranslations();
  const sb = useSupabase();
  const { yo } = useSesionRequerida("/cuenta/borrar");
  const [confirmacion, setConfirmacion] = useState("");
  const [errorBaja, setErrorBaja] = useState("");
  const [dandoBaja, setDandoBaja] = useState(false);
  const darDeBaja = async (e: React.FormEvent) => {
    e.preventDefault();
    if (dandoBaja || !sb) return;
    setDandoBaja(true);
    setErrorBaja("");
    const fuera = await borrarMiCuenta(confirmacion.trim());
    if (fuera) {
      setErrorBaja(fuera);
      setDandoBaja(false);
      return;
    }
    await sb.auth.signOut();
    window.location.replace("/");
  };
  return <MarcoCuenta titulo={t("account_borrar_cuenta")}>
    <form className="form" onSubmit={darDeBaja}>
      <p className="nota">{t("account_ayuda_baja")}</p>
      {yo?.plan_pago && <p className="nota">{t("account_baja_cancela_antes")}</p>}
      <label className="campo">
        <span className="lbl">{t("account_confirmar_baja", { palabra: t("account_palabra_baja") })}</span>
        <input className="inp" value={confirmacion} autoCapitalize="characters" autoCorrect="off"
          spellCheck={false} onChange={e => setConfirmacion(e.target.value)} />
      </label>
      {errorBaja && <p className="aviso" role="alert">{errorBaja}</p>}
      <Boton type="submit" ancho="completo"
        disabled={dandoBaja || confirmacion.trim().toUpperCase() !== t("account_palabra_baja")}>
        {dandoBaja ? t("account_borrando") : t("account_borrar_cuenta")}
      </Boton>
    </form>
  </MarcoCuenta>;
}
