"use client";

// Red de seguridad de la liga: si una pantalla falla al pintarse, nunca se queda en blanco. Tres
// salidas: reintentar, ir a la liga y avisar al admin.

import Link from "next/link";
import { useEffect, useState } from "react";
import { reportarError } from "@/lib/liga/errores";
import { Boton } from "./_ui";

type Fase = "pendiente" | "enviando" | "enviado" | "fallo";

export default function ErrorDePantalla({ error, reset }: {
  error: Error & { digest?: string }; reset: () => void;
}) {
  const [fase, setFase] = useState<Fase>("pendiente");
  useEffect(() => { console.error(error); }, [error]);

  const reportar = async () => {
    setFase("enviando");
    const ok = await reportarError({
      codigo: error.digest?.slice(0, 20) ?? null,
      pantalla: window.location.pathname,
      mensaje: `La pantalla no se pudo mostrar: ${error.message}`.slice(0, 500),
    });
    setFase(ok ? "enviado" : "fallo");
  };

  return (
    <main className="sencilla">
      <header className="sencilla-top">
        <Link href="/" className="wordmark">Vennett</Link>
      </header>
      <section className="sencilla-cuerpo" aria-labelledby="titular">
        <h1 id="titular">Algo ha fallado</h1>
        <p>
          Esta pantalla no se ha podido mostrar. Tus datos están a salvo: puedes reintentarlo,
          volver a la liga o avisarnos.
        </p>
        <Boton variante="principal" ancho="completo" onClick={reset}>Reintentar</Boton>
        <Link href="/liga" className="btn wide">Ir a la liga</Link>
        {fase === "enviado" ? (
          <p className="fine" role="status">Gracias, ya lo tenemos.</p>
        ) : (
          <>
            <Boton variante="discreto" ancho="completo" disabled={fase === "enviando"}
                   onClick={reportar}>
              {fase === "enviando" ? "Enviando…" : "Reportar este error"}
            </Boton>
            {fase === "fallo" && (
              <p className="fine" role="status">No hemos podido enviarlo ahora. Inténtalo otra vez.</p>
            )}
          </>
        )}
      </section>
    </main>
  );
}
