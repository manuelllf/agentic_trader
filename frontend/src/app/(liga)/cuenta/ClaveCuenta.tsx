"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { claveValida } from "@/lib/liga/registro";
import { useSupabase } from "@/lib/liga/supabase";
import { AccionBarra, BarraCuenta, CuerpoCuenta, Grupo, Pie, useCambiosSinGuardar, useNavCuenta } from "./marco";

const ojo = (visible: boolean) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
  <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />
  {visible && <path d="m3 3 18 18" />}</svg>;

export function ClaveCuenta() {
  const t = useTranslations();
  const sb = useSupabase();
  const { volver, avisar } = useNavCuenta();
  const [nueva, setNueva] = useState("");
  const [repite, setRepite] = useState("");
  const [ver, setVer] = useState({ nueva: false, repite: false });
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const segundo = useRef<HTMLInputElement>(null);

  const puede = nueva.length >= 8 && !!repite && !ocupado;
  useCambiosSinGuardar(!!(nueva || repite));

  const cambiar = async () => {
    if (!puede || !sb) return;
    if (!claveValida(nueva)) {
      setError(t("auth_clave_revisa"));
      return;
    }
    if (nueva !== repite) {
      setError(t("account_contrasenas_distintas"));
      return;
    }
    setOcupado(true);
    setError(null);
    const { error: fallo } = await sb.auth.updateUser({ password: nueva });
    setOcupado(false);
    if (fallo) {
      setError(fallo.status === 422 ? t("account_clave_invalida") : t("account_cambio_fallo"));
      return;
    }
    setNueva("");
    setRepite("");
    volver();
    avisar(t("account_clave_cambiada"));
  };

  const fila = (campo: "nueva" | "repite", texto: string, valor: string, poner: (v: string) => void) => <li>
    <label className="cu-celda cu-entrada">
      <input ref={campo === "repite" ? segundo : undefined} type={ver[campo] ? "text" : "password"} value={valor}
        placeholder={texto} aria-label={texto} autoComplete="new-password" maxLength={200}
        enterKeyHint={campo === "nueva" ? "next" : "done"} onChange={e => { poner(e.target.value); setError(null); }}
        onKeyDown={e => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          if (campo === "nueva") segundo.current?.focus();
          else void cambiar();
        }} />
      <button type="button" className="cu-x" aria-pressed={ver[campo]}
        aria-label={ver[campo] ? t("auth_ocultar_contrasena") : t("auth_mostrar_contrasena")}
        onClick={() => setVer(v => ({ ...v, [campo]: !v[campo] }))}>{ojo(ver[campo])}</button>
    </label>
  </li>;

  return <>
    <BarraCuenta titulo={t("account_clave")}
      accion={<AccionBarra texto={t("account_cambiar")} desactivada={!puede} onClick={cambiar} />} />
    <CuerpoCuenta>
      <Grupo>
        {fila("nueva", t("account_clave_nueva"), nueva, setNueva)}
        {fila("repite", t("account_clave_repite"), repite, setRepite)}
      </Grupo>
      <Pie mal={!!error}>{error ?? t("auth_clave_requisitos")}</Pie>
    </CuerpoCuenta>
  </>;
}
