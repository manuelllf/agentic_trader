"use client";

// Vuelta del enlace de confirmación del alta: llega con `?code=`, con `token_hash` o con los tokens
// en el fragmento, y `confirmarAlta` los reconoce todos.

import { useTranslations } from "next-intl";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { destinoConAvisos } from "@/lib/liga/avisos";
import { confirmarAlta } from "@/lib/liga/registro";
import { useSupabase } from "@/lib/liga/supabase";
import { Boton } from "../_ui/Boton";
import { MarcoAcceso } from "../_ui/MarcoAcceso";

const DESTINO = "/liga";

export default function Confirmar() {
  const t = useTranslations();
  const sb = useSupabase();
  const iniciado = useRef(false);
  const [estado, setEstado] = useState<"comprobando" | "confirmada" | "invalido">("comprobando");
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    if (sb === undefined || iniciado.current) return;
    // El enlace solo vale una vez: no se procesa de nuevo si el efecto se repite.
    iniciado.current = true;
    if (!sb) { setEstado("invalido"); return; }
    void confirmarAlta(sb).then(async (resultado) => {
      if (resultado === "con-sesion") window.location.replace(await destinoConAvisos("confirmar", DESTINO));
      else setEstado(resultado === "confirmada" ? "confirmada" : "invalido");
    });
  }, [sb]);

  async function entrar() {
    if (ocupado) return;
    setOcupado(true);
    window.location.assign(await destinoConAvisos("confirmar", DESTINO));
  }

  return <MarcoAcceso modo="tramite"
    titular={t(estado === "confirmada" ? "auth_cuenta_confirmada" : "auth_confirmar_correo")}>
    {estado !== "invalido" && <p role="status" className={estado === "comprobando" ? "nota" : undefined}>
      {t(estado === "comprobando" ? "auth_comprobando_enlace" : "auth_correo_confirmado")}</p>}
    {estado === "confirmada" &&
      <Boton variante="principal" ancho="completo" disabled={ocupado} onClick={() => void entrar()}>
        {ocupado ? t("auth_entrando") : t("auth_entrar")}</Boton>}
    {estado === "invalido" && <>
      <p className="aviso" role="alert">{t("auth_enlace_invalido")}</p>
      <Link href="/entrar" className="btn pri wide">{t("auth_entrar")}</Link>
    </>}
  </MarcoAcceso>;
}
