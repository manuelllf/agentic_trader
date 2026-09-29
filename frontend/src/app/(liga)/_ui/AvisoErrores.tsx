"use client";

import { useEffect, useState } from "react";
import { escucharErrores, reportarError, type AvisoError } from "@/lib/liga/errores";
import { Boton } from "./Boton";

// Aviso de que algo ha fallado, sobre la barra de pestañas y sin tapar la pantalla: nunca
// bloquea. Sale con cualquier fallo del servidor (5xx) o de red; solo se enseña uno a la vez
// hasta que se cierra, para que una racha de fallos no llene la pantalla.
type Fase = "visto" | "enviando" | "enviado" | "fallo";

export function AvisoErrores() {
  const [aviso, setAviso] = useState<AvisoError | null>(null);
  const [fase, setFase] = useState<Fase>("visto");

  useEffect(() => escucharErrores((nuevo) => setAviso((previo) => previo ?? nuevo)), []);

  useEffect(() => {
    if (fase !== "enviado") return;
    const t = setTimeout(() => { setAviso(null); setFase("visto"); }, 4000);
    return () => clearTimeout(t);
  }, [fase]);

  if (!aviso) return null;

  const cerrar = () => { setAviso(null); setFase("visto"); };
  const reportar = async () => {
    setFase("enviando");
    setFase((await reportarError(aviso)) ? "enviado" : "fallo");
  };

  return (
    <div className="aviso-error" role="alert">
      <p>
        {fase === "enviado" ? "Gracias, ya lo tenemos."
          : fase === "fallo" ? "No hemos podido enviarlo ahora. Inténtalo otra vez."
          : aviso.mensaje}
      </p>
      {fase !== "enviado" && (
        <div className="aviso-error-botones">
          <Boton tamano="pequeno" disabled={fase === "enviando"} onClick={reportar}>
            {fase === "enviando" ? "Enviando…" : "Reportar este error"}
          </Boton>
          <Boton tamano="pequeno" variante="discreto" onClick={cerrar}>Cerrar</Boton>
        </div>
      )}
    </div>
  );
}
