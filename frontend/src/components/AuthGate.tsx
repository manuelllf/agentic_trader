"use client";

// Candado de las salas: solo la cuenta de admin con el 2FA de esta sesión. Sin sesión, a entrar;
// con sesión sin 2FA, a pedir el código; cualquier otra cuenta ve que aquí no hay nada. La
// seguridad real está en el backend (require_auth); esto es la capa de UX.

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useLanguage } from "@/i18n/Provider";
import { getYo } from "@/lib/liga/api";
import { useEffect, useState } from "react";
import { checkAuth, sesionRechazada } from "@/lib/api";
import { sesionCaducada, tokenSesion } from "@/lib/liga/supabase";

type State = "checking" | "in" | "out";

async function desvio(): Promise<string | null> {
  const aqui = window.location.pathname + window.location.search;
  const sesion = await tokenSesion();
  if (!sesion) return `/entrar?next=${encodeURIComponent(aqui)}`;
  if (sesion.aal !== "aal2") return `/cuenta/verificacion?next=${encodeURIComponent(aqui)}`;
  return null;
}

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const t = useTranslations();
  const { setAccount } = useLanguage();
  const [state, setState] = useState<State>("checking");

  useEffect(() => {
    let alive = true;
    const decidir = async (ok: boolean) => {
      if (!alive) return;
      if (ok) {
        setState("in");
        const session = await tokenSesion();
        const profile = session ? await getYo().catch(() => null) : null;
        if (alive && session && profile) setAccount({ id: session.uid, locale: profile.idioma ?? null });
        return;
      }
      const a = await desvio();
      if (a) window.location.replace(a);
      else if (sesionRechazada()) await sesionCaducada();  // token caducado: a entrar de nuevo
      else if (alive) setState("out");
    };
    checkAuth().then(decidir);
    // Si una llamada devuelve 401 (sesión caducada), se vuelve a decidir sin recargar.
    const onUnauth = () => { void decidir(false); };
    window.addEventListener("agentic-unauthorized", onUnauth);
    return () => { alive = false; window.removeEventListener("agentic-unauthorized", onUnauth); };
  }, [setAccount]);

  if (state === "in") return <>{children}</>;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4"
         style={{ background: "#0d0d0d", color: "#c3c2b7" }}>
      {state === "checking" ? (
        <div className="flex items-center justify-center gap-2 py-4 text-[12px]" style={{ color: "#898781" }}>
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2"
                style={{ borderColor: "#2c2c2a", borderTopColor: "#898781" }} />
          {t("system_comprobando_sesion")}
        </div>
      ) : (
        <div className="max-w-xs text-center">
          <p className="text-[15px] font-bold" style={{ color: "#fff" }}>{t("system_pagina_no_existe")}</p>
          <Link href="/" className="mt-3 inline-block py-3 text-[12.5px]" style={{ color: "#898781" }}>
            {t("system_volver_portada")}
          </Link>
        </div>
      )}
    </div>
  );
}
