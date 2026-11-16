"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { enviarPruebaBoletin } from "@/lib/blog/admin";
import { Boton } from "../../_contenido/piezas";

/** Manda al correo del admin el último artículo publicado, tal y como lo recibiría un suscriptor. */
export default function BotonPrueba() {
  const t = useTranslations();
  const [ocupado, setOcupado] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [fallo, setFallo] = useState("");
  async function enviar() {
    if (ocupado) return;
    setOcupado(true); setFallo(""); setEnviado(false);
    try { await enviarPruebaBoletin(); setEnviado(true); }
    catch (e) { setFallo(e instanceof Error ? e.message : t("ba_error")); }
    finally { setOcupado(false); }
  }
  return <>
    <div className="pc-botones"><Boton tono="sec" disabled={ocupado} onClick={enviar}>{t(ocupado ? "ba_working" : "ba_test_email")}</Boton></div>
    {fallo && <p className="pc-aviso" role="alert">{fallo}</p>}
    {enviado && <p className="pc-estado-linea" role="status">{t("ba_test_sent")}</p>}
  </>;
}
