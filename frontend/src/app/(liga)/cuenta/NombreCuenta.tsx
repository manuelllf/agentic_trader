"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { cambiarAlias } from "@/lib/liga/api";
import { fijar } from "@/lib/liga/cache";
import { useSesion } from "../_sesion/SesionContext";
import { AccionBarra, BarraCuenta, CuerpoCuenta, Grupo, Pie, useCambiosSinGuardar, useNavCuenta } from "./marco";

// Tope de cambios de nombre cada 30 días: el mismo de backend/app/liga/limites.py.
const CAMBIOS_ALIAS = 3;

const ICO_X = <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="9" fill="currentColor" opacity=".6" />
  <path d="m7 7 6 6M13 7l-6 6" stroke="var(--surface)" strokeWidth="1.8" strokeLinecap="round" /></svg>;

export function NombreCuenta() {
  const t = useTranslations();
  const { yo } = useSesion();
  const { volver, avisar } = useNavCuenta();
  // Se fija una vez: la revalidación de la sesión no debe pisar lo que se está escribiendo.
  const [valor, setValor] = useState(() => yo?.alias ?? "");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const campo = useRef<HTMLInputElement>(null);

  const limpio = valor.trim().toLowerCase();
  const puede = !!yo && limpio !== "" && limpio !== yo.alias && !ocupado;
  useCambiosSinGuardar(!!yo && limpio !== yo.alias);

  const guardar = async () => {
    if (!puede) return;
    setOcupado(true);
    setError(null);
    const fuera = await cambiarAlias(valor);
    setOcupado(false);
    if (typeof fuera === "string") {
      setError(fuera);
      return;
    }
    fijar("yo", fuera);
    volver();
    avisar(t("account_guardado"));
  };

  return <>
    <BarraCuenta titulo={t("account_titulo_nombre")}
      accion={<AccionBarra texto={t("account_guardar")} desactivada={!puede} onClick={guardar} />} />
    <CuerpoCuenta>
      <Grupo><li><label className="cu-celda cu-entrada">
        <input ref={campo} value={valor} maxLength={20} autoCapitalize="none" autoCorrect="off" spellCheck={false}
          enterKeyHint="done" aria-label={t("account_nombre_liga")} aria-describedby="cu-pie-nombre" autoFocus
          onChange={e => { setValor(e.target.value); setError(null); }}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void guardar(); } }} />
        <button type="button" className="cu-x" aria-label={t("account_borrar_nombre_aria")} hidden={!valor}
          onClick={() => { setValor(""); setError(null); campo.current?.focus(); }}>{ICO_X}</button>
      </label></li></Grupo>
      <Pie id="cu-pie-nombre" mal={!!error}>{error ?? t("account_nombre_pie", { count: CAMBIOS_ALIAS })}</Pie>
    </CuerpoCuenta>
  </>;
}
