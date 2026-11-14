"use client";
import { useTranslations } from "next-intl";

// Red de seguridad de la liga: si una pantalla falla al pintarse, nunca se queda en blanco. Tres
// salidas: reintentar, ir a la liga y avisar al admin.

import Link from "next/link";
import { useEffect, useState } from "react";
import { reportarError } from "@/lib/liga/errores";
import { BarraPestanas } from "./_ui/BarraPestanas";
import { Campana } from "./_avisos/Campana";
import { Sesion } from "./_sesion/Sesion";
import "./liga/ranking.css";
import "./_ui/grupos.css";
import "./_ui/paginas.css";

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
    <main className="scroll lv-pagina pg-pagina">
      {/* Sin título en la barra: el de la pantalla es el del aviso (un solo h1). */}
      <header className="cab centrada"><Sesion /><span /><div className="cab-der"><Campana variante="cabecera" /></div></header>
      <div className="pg">
        <div className="pg-vacio">
          <svg className="ico" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2"
               strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21.4 7.6 4.6 37a3 3 0 0 0 2.6 4.5h33.6a3 3 0 0 0 2.6-4.5L26.6 7.6a3 3 0 0 0-5.2 0Z" />
            <path d="M24 18v10M24 34v.4" />
          </svg>
          <h1>{t("system_error_titulo")}</h1>
          <p>{t("system_error_pantalla")}</p>
          <div className="acciones">
            <button type="button" className="cu-boton" onClick={reset}>{t("system_error_reintentar")}</button>
            <Link className="cu-boton tintado" href="/liga">{t("system_error_ir_liga")}</Link>
            {fase === "enviado" ? (
              <p className="estado" role="status">{t("system_error_gracias")}</p>
            ) : (
              <>
                <button type="button" className="pg-enlace" disabled={fase === "enviando"} onClick={reportar}>
                  {fase === "enviando" ? t("system_error_enviando") : t("system_error_reportar")}
                </button>
                {fase === "fallo" && (
                  <p className="estado" role="status">{t("system_error_envio_fallo")}</p>
                )}
              </>
            )}
          </div>
        </div>
      </div>
      <BarraPestanas />
    </main>
  );
}
