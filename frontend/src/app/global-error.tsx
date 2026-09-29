"use client";

// Último recurso: si falla hasta el layout raíz. No depende de ninguna hoja de estilos ni de
// componentes de la web (podrían ser justo lo que falla), así que va con estilos en línea.

import { useState } from "react";
import { reportarError } from "@/lib/liga/errores";

const BOTON = {
  display: "block", width: "100%", minHeight: 48, marginTop: 12, borderRadius: 14, border: 0,
  font: "inherit", fontWeight: 700, fontSize: 16, textAlign: "center", textDecoration: "none",
  boxSizing: "border-box", padding: "13px 16px", cursor: "pointer",
} as const;

export default function ErrorGlobal({ error, reset }: {
  error: Error & { digest?: string }; reset: () => void;
}) {
  const [fase, setFase] = useState<"pendiente" | "enviando" | "enviado" | "fallo">("pendiente");

  const reportar = async () => {
    setFase("enviando");
    const ok = await reportarError({
      codigo: error.digest?.slice(0, 20) ?? null,
      pantalla: window.location.pathname,
      mensaje: `La web no se pudo mostrar: ${error.message}`.slice(0, 500),
    });
    setFase(ok ? "enviado" : "fallo");
  };

  return (
    <html lang="es">
      <body style={{ margin: 0, background: "#0E0F10", color: "#F3F4F4",
                     fontFamily: "system-ui, sans-serif" }}>
        <main style={{ maxWidth: 480, margin: "0 auto", padding: "64px 20px" }}>
          <h1 style={{ fontSize: 34, lineHeight: 1.1, margin: 0 }}>Algo ha fallado</h1>
          <p style={{ fontSize: 17, lineHeight: 1.5, color: "#C9CDD1" }}>
            La web no se ha podido mostrar. Tus datos están a salvo: puedes reintentarlo, volver
            al inicio o avisarnos.
          </p>
          <button type="button" onClick={reset}
                  style={{ ...BOTON, background: "#4FA39D", color: "#0E0F10" }}>
            Reintentar
          </button>
          {/* Un enlace normal (no `next/link`): recarga entera y sale del estado roto. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/" style={{ ...BOTON, background: "#24272A", color: "#F3F4F4" }}>
            Ir al inicio
          </a>
          {fase === "enviado" ? (
            <p style={{ color: "#9AA1A8" }}>Gracias, ya lo tenemos.</p>
          ) : (
            <>
              <button type="button" onClick={reportar} disabled={fase === "enviando"}
                      style={{ ...BOTON, background: "transparent", color: "#4FA39D" }}>
                {fase === "enviando" ? "Enviando…" : "Reportar este error"}
              </button>
              {fase === "fallo" && (
                <p style={{ color: "#9AA1A8" }}>No hemos podido enviarlo ahora. Inténtalo otra vez.</p>
              )}
            </>
          )}
        </main>
      </body>
    </html>
  );
}
