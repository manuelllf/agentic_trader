"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { borrarMiCuenta } from "@/lib/liga/cuenta";
import { useSupabase } from "@/lib/liga/supabase";
import { useSesion } from "../_sesion/SesionContext";
import { BarraCuenta, CabGrupo, CuerpoCuenta, Grupo, Pie, useDescargarDatos } from "./marco";

export function BorrarCuenta() {
  const t = useTranslations();
  const sb = useSupabase();
  const { yo } = useSesion();
  const { descargando, error: errorDescarga, descargar } = useDescargarDatos();
  const [palabra, setPalabra] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clave = t("account_palabra_baja");

  const borrar = async () => {
    if (ocupado || !sb) return;
    setOcupado(true);
    setError(null);
    const fuera = await borrarMiCuenta(palabra.trim());
    if (fuera) {
      setError(fuera);
      setOcupado(false);
      return;
    }
    await sb.auth.signOut();
    window.location.replace("/");
  };

  return <>
    <BarraCuenta titulo={t("account_titulo_borrar")} />
    <CuerpoCuenta>
      <CabGrupo>{t("account_baja_se_borra")}</CabGrupo>
      <Grupo>
        <li><div className="cu-celda texto">{t("account_baja_perfil")}</div></li>
        <li><div className="cu-celda texto">{t("account_baja_creditos")}</div></li>
        <li><div className="cu-celda texto">{t("account_baja_datos")}</div></li>
      </Grupo>
      <Pie>{t("account_baja_no_deshacer")}</Pie>
      {yo?.plan_pago && <Pie>{t("account_baja_cancela_suscripcion")}</Pie>}
      <CabGrupo>{t("account_baja_se_queda")}</CabGrupo>
      <Grupo>
        <li><div className="cu-celda texto">{t("account_baja_estrategias")}</div></li>
      </Grupo>
      <Grupo>
        <li><button type="button" className="cu-celda accion" disabled={descargando} onClick={() => void descargar()}>
          {descargando ? t("account_preparando") : t("account_baja_descargar_antes")}
        </button></li>
      </Grupo>
      {errorDescarga && <Pie mal alerta>{errorDescarga}</Pie>}
      <CabGrupo>{t("account_baja_confirmar_cab", { palabra: clave })}</CabGrupo>
      <Grupo>
        <li><label className="cu-celda cu-entrada">
          <input value={palabra} onChange={e => setPalabra(e.target.value)} placeholder={clave} autoCapitalize="characters"
            autoCorrect="off" spellCheck={false} autoComplete="off" aria-label={t("account_confirmar_baja", { palabra: clave })} />
        </label></li>
      </Grupo>
      {error && <Pie mal alerta>{error}</Pie>}
      <button type="button" className="cu-boton peligro" onClick={() => void borrar()}
        disabled={ocupado || palabra.trim().toUpperCase() !== clave}>
        {ocupado ? t("account_borrando") : t("account_borrar_cuenta")}
      </button>
    </CuerpoCuenta>
  </>;
}
