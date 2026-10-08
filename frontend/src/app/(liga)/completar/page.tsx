"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { useEffect, useState } from "react";
import { aceptarTerminos, cambiarAlias } from "@/lib/liga/api";
import { esAliasValido } from "@/lib/liga/proveedores";
import { destinoSeguro } from "@/lib/liga/supabase";
import { useSesionRequerida } from "../_sesion/SesionContext";
import { Boton } from "../_ui";
import { MarcoAcceso } from "../_ui/MarcoAcceso";

export default function Completar() {
  const t = useTranslations();
  const { estado, yo } = useSesionRequerida("/completar");
  const [destino, setDestino] = useState<string | null>(null);
  const [alias, setAlias] = useState("");
  const [acepta, setAcepta] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setDestino(destinoSeguro(new URLSearchParams(window.location.search).get("next")));
  }, []);
  useEffect(() => {
    if (estado === "dentro" && yo?.pendiente === false && destino) window.location.assign(destino);
  }, [estado, yo?.pendiente, destino]);

  // Solo las cuentas nuevas tienen el alias automático; a las demás solo les falta aceptar.
  const pideAlias = yo?.alias.startsWith("jugador_") ?? false;

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (ocupado || !acepta || !destino || estado !== "dentro" || !yo?.pendiente) return;
    if (pideAlias && !esAliasValido(alias)) { setError(t("auth_alias_no_valido")); return; }
    setOcupado(true); setError("");
    try {
      if (pideAlias) {
        const perfil = await cambiarAlias(alias);
        if (typeof perfil === "string") { setError(perfil); return; }
      }
      const aceptacion = await aceptarTerminos();
      if (typeof aceptacion === "string") { setError(aceptacion); return; }
      window.location.assign(destino);
    } finally { setOcupado(false); }
  };

  if (estado !== "dentro" || !yo?.pendiente || !destino) return null;
  return <MarcoAcceso pestana="crear">
    <h2>{t("auth_completa_titulo")}</h2>
    <p className="nota">{t("auth_completa_texto")}</p>
    <form className="form" onSubmit={enviar}>
      {pideAlias && <label className="campo"><span className="lbl">{t("auth_nombre_usuario")}</span>
        <input className="inp" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false}
          required value={alias} onChange={e => setAlias(e.target.value.toLowerCase())} /></label>}
      <label className="acc-acepta"><input className="acc-chk" type="checkbox" required checked={acepta}
        onChange={e => setAcepta(e.target.checked)} /><span>{t.rich("auth_aceptacion_legal", {
          terms: chunks => <Link href="/legal/terminos">{chunks}</Link>,
          privacy: chunks => <Link href="/legal/privacidad">{chunks}</Link>,
        })}</span></label>
      {error && <p className="aviso" role="alert">{error}</p>}
      <Boton type="submit" variante="principal" ancho="completo" disabled={ocupado || !acepta}>
        {ocupado ? t("auth_guardando") : t("auth_completa_guardar")}</Boton>
    </form>
  </MarcoAcceso>;
}
