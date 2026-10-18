"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { useEffect, useState } from "react";
import { destinoConAvisos } from "@/lib/liga/avisos";
import { aceptarTerminos, cambiarAlias, declararEdad } from "@/lib/liga/api";
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
  const [edad, setEdad] = useState("");
  const pideEdad = yo?.edad_declarada === false;
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
      if (pideEdad) {
        const edadNumero = Number(edad);
        if (!Number.isInteger(edadNumero) || edadNumero < 14) { setError(t("auth_edad_minima")); return; }
        if (edadNumero > 120) { setError(t("auth_edad_no_valida")); return; }
        const resultado = await declararEdad(edadNumero);
        if (typeof resultado === "string") { setError(resultado); return; }
      }
      if (pideAlias) {
        const perfil = await cambiarAlias(alias);
        if (typeof perfil === "string") { setError(perfil); return; }
      }
      const aceptacion = await aceptarTerminos();
      if (typeof aceptacion === "string") { setError(aceptacion); return; }
      window.location.assign(await destinoConAvisos("resto", destino));
    } finally { setOcupado(false); }
  };

  if (estado !== "dentro" || !yo?.pendiente || !destino) return null;
  return <MarcoAcceso modo="tramite" titular={t(pideAlias ? "auth_completa_titulo" : "auth_cambio_titulo")}>
    <p className="nota">{t(pideEdad ? "auth_edad_y_condiciones_texto" : pideAlias ? "auth_completa_texto" : "auth_cambio_texto")}</p>
    <form className="form" onSubmit={enviar}>
      {pideAlias && <label className="campo"><span className="lbl">{t("auth_nombre_usuario")}</span>
        <input className="inp" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false}
          required value={alias} onChange={e => setAlias(e.target.value.toLowerCase())} /></label>}
      {pideEdad && <label className="campo"><span className="lbl">{t("auth_edad_etiqueta")}</span>
        <input className="inp" type="number" inputMode="numeric" min={14} max={120} step={1} required
          value={edad} onChange={e => setEdad(e.target.value)} aria-describedby="ayuda-edad" />
        <span className="nota" id="ayuda-edad">{t("auth_edad_ayuda")}</span></label>}
      <label className="acc-acepta"><input className="acc-chk" type="checkbox" required checked={acepta}
        onChange={e => setAcepta(e.target.checked)} /><span>{t.rich("auth_aceptacion_legal", {
          terms: chunks => <Link href="/legal/terminos">{chunks}</Link>,
          privacy: chunks => <Link href="/legal/privacidad">{chunks}</Link>,
        })}</span></label>
      {error && <p className="aviso" role="alert">{error}</p>}
      <Boton type="submit" variante="principal" ancho="completo" disabled={ocupado || !acepta || (pideEdad && !edad)}>
        {ocupado ? t("auth_guardando") : t(pideAlias ? "auth_completa_guardar" : "auth_cambio_guardar")}</Boton>
    </form>
  </MarcoAcceso>;
}
