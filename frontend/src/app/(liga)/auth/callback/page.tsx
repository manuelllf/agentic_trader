"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { destinoSeguro, supabase, useSupabase } from "@/lib/liga/supabase";

export default function Callback() {
  const t = useTranslations();
  const sb = useSupabase();
  const iniciado = useRef(false);
  const [fallo, setFallo] = useState(false);

  useEffect(() => {
    if (sb === undefined || iniciado.current) return;
    iniciado.current = true;
    const parametros = new URLSearchParams(window.location.search);
    const code = parametros.get("code");
    // Las plantillas de correo mandan token_hash (no depende del navegador que pidió el enlace).
    const tokenHash = parametros.get("token_hash");
    const tipo = parametros.get("type");
    const destino = destinoSeguro(parametros.get("next"));
    if (!sb) { setFallo(true); return; }
    void (async () => {
      try {
        const tipoOtp = tipo === "magiclink" || tipo === "recovery" ? tipo : null;
        const usaOtp = Boolean(tokenHash) && tipoOtp !== null;
        if (usaOtp || code) {
          const { error } = usaOtp
            ? await supabase()!.auth.verifyOtp({ token_hash: tokenHash!, type: tipoOtp! })
            : await supabase()!.auth.exchangeCodeForSession(code!);
          if (!error) { window.location.replace(destino); return; }
        }
      } catch { /* el intercambio falló: se comprueba si ya hay sesión abajo */ }
      // Antes de avisar de un enlace caducado, miramos si la sesión ya está puesta: así no
      // aparece el aviso un instante cuando la vuelta llega bien.
      const sesion = await supabase()!.auth.getSession().then(r => r.data.session, () => null);
      if (sesion) window.location.replace(destino);
      else setFallo(true);
    })();
  }, [sb]);

  return <main className="sencilla">
    {fallo ? <>
      <p className="aviso" role="alert">{t("auth_enlace_invalido")}</p>
      <Link href="/entrar">{t("auth_entrar")}</Link>
    </> : <p className="nota">{t("auth_comprobando_enlace")}</p>}
  </main>;
}
