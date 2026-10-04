"use client";
import { useTranslations } from "next-intl";

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
  const t = useTranslations();
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
        <h1 id="titular">{t("system_error_titulo")}</h1>
        <p>
          {t("system_error_pantalla")}
        </p>
        <Boton variante="principal" ancho="completo" onClick={reset}>{t("system_error_reintentar")}</Boton>
        <Link href="/liga" className="btn wide">{t("system_error_ir_liga")}</Link>
        {fase === "enviado" ? (
          <p className="fine" role="status">{t("system_error_gracias")}</p>
        ) : (
          <>
            <Boton variante="discreto" ancho="completo" disabled={fase === "enviando"}
                   onClick={reportar}>
              {fase === "enviando" ? t("system_error_enviando") : t("system_error_reportar")}
            </Boton>
            {fase === "fallo" && (
              <p className="fine" role="status">{t("system_error_envio_fallo")}</p>
            )}
          </>
        )}
      </section>
    </main>
  );
}
