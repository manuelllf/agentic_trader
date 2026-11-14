"use client";

// Último recurso: si falla hasta el layout raíz. No depende de ninguna hoja de estilos ni de
// componentes de la web (podrían ser justo lo que falla), así que lleva su propio <style>.

import es from "../../messages/es/system.json";
import en from "../../messages/en/system.json";
import { browserLocale, type Locale } from "@/i18n/locale";
import { useEffect, useState } from "react";
import { reportarError } from "@/lib/liga/errores";

const CSS = `
.ge{margin:0;background:#F2F2F7;color:#000;font-family:-apple-system,BlinkMacSystemFont,system-ui,sans-serif}
.ge main{max-width:480px;margin:0 auto;padding:18vh 16px 24px;display:flex;flex-direction:column;align-items:center;text-align:center}
.ge svg{width:48px;height:48px;color:#8E8E93}
.ge h1{margin:16px 0 0;font-size:20px;line-height:25px;font-weight:600}
.ge p{margin:6px 0 0;max-width:32ch;font-size:15px;line-height:20px;color:#8E8E93}
.ge .acc{display:grid;gap:12px;width:100%;max-width:340px;margin-top:24px}
.ge .acc p{margin:0;max-width:none;text-align:center}
.ge .bt{display:block;width:100%;min-height:50px;border:0;border-radius:14px;box-sizing:border-box;padding:13px 16px;font:inherit;font-size:17px;font-weight:600;text-align:center;text-decoration:none;cursor:pointer;background:#0B6E68;color:#fff}
.ge .bt.tin{background:rgba(11,110,104,.12);color:#0B6E68}
.ge .en{min-height:44px;border:0;background:transparent;font:inherit;font-size:17px;color:#0B6E68;cursor:pointer}
.ge .en:disabled{color:#8E8E93;cursor:default}
@media (prefers-color-scheme: dark){.ge{background:#000;color:#fff}.ge .bt.tin{background:rgba(79,163,157,.18);color:#4FA39D}.ge .en{color:#4FA39D}}
`;

export default function ErrorGlobal({ error, reset }: {
  error: Error & { digest?: string }; reset: () => void;
}) {
  const [locale, setLocale] = useState<Locale>("es");
  useEffect(() => setLocale(browserLocale()), []);
  const t = (key: keyof typeof es) => (locale === "en" ? en : es)[key];
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
    <html lang={locale}>
      <body className="ge">
        <style>{CSS}</style>
        <main>
          <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2"
               strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21.4 7.6 4.6 37a3 3 0 0 0 2.6 4.5h33.6a3 3 0 0 0 2.6-4.5L26.6 7.6a3 3 0 0 0-5.2 0Z" />
            <path d="M24 18v10M24 34v.4" />
          </svg>
          <h1>{t("system_error_titulo")}</h1>
          <p>{t("system_error_web")}</p>
          <div className="acc">
            <button type="button" className="bt" onClick={reset}>{t("system_error_reintentar")}</button>
            {/* Un enlace normal (no `next/link`): recarga entera y sale del estado roto. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/" className="bt tin">{t("system_error_ir_inicio")}</a>
            {fase === "enviado" ? (
              <p role="status">{t("system_error_gracias")}</p>
            ) : (
              <>
                <button type="button" className="en" onClick={reportar} disabled={fase === "enviando"}>
                  {fase === "enviando" ? t("system_error_enviando") : t("system_error_reportar")}
                </button>
                {fase === "fallo" && <p role="status">{t("system_error_envio_fallo")}</p>}
              </>
            )}
          </div>
        </main>
      </body>
    </html>
  );
}
