"use client";
import { useTranslations } from "next-intl";

import { useState } from "react";
import { codigoDe, reportarError } from "@/lib/liga/errores";
import { Boton } from "./Boton";

// No está en la maqueta (solo enseña datos que siempre cargan bien): mismo lenguaje visual
// que `Vacio` (`.empty`), pero con `role="alert"` y la voz de error de DESIGN.md §10 — qué
// pasó y cómo se arregla, sin disculpas. Siempre hay salida: la acción de reintentar y, aparte,
// «Reportar este error» para dejar una nota al admin.
export interface ErrorLigaProps {
  titulo: string;
  mensaje: string;
  accion?: { texto: string; onClick: () => void };
  /** `false` en el muestrario o donde el mensaje no sea un fallo real. */
  reportar?: boolean;
}

type Fase = "pendiente" | "enviando" | "enviado" | "fallo";

export function ErrorLiga({ titulo, mensaje, accion, reportar = true }: ErrorLigaProps) {
  const t = useTranslations();
  const [fase, setFase] = useState<Fase>("pendiente");

  const enviar = async () => {
    setFase("enviando");
    const ok = await reportarError(
      { codigo: codigoDe(mensaje), pantalla: window.location.pathname, mensaje: `${titulo}: ${mensaje}` });
    setFase(ok ? "enviado" : "fallo");
  };

  return (
    <div className="empty" role="alert">
      <h2>{titulo}</h2>
      <p>{mensaje}</p>
      {accion && (
        <Boton variante="secundario" ancho="completo" onClick={accion.onClick}>
          {accion.texto}
        </Boton>
      )}
      {reportar && (fase === "enviado" ? (
        <p className="fine" role="status">{t("system_error_gracias")}</p>
      ) : (
        <>
          <Boton variante="discreto" ancho="completo" disabled={fase === "enviando"} onClick={enviar}>
            {fase === "enviando" ? t("system_error_enviando") : t("system_error_reportar")}
          </Boton>
          {fase === "fallo" && (
            <p className="fine" role="status">{t("system_error_envio_fallo")}</p>
          )}
        </>
      ))}
    </div>
  );
}
