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
    if (!sb || (!code && !tokenHash)) { setFallo(true); return; }
    void (async () => {
      try {
        const { error } = tokenHash && (tipo === "magiclink" || tipo === "recovery")
          ? await supabase()!.auth.verifyOtp({ token_hash: tokenHash, type: tipo })
          : await supabase()!.auth.exchangeCodeForSession(code ?? "");
        if (error) setFallo(true);
        else window.location.replace(destino);
      } catch { setFallo(true); }
    })();
  }, [sb]);

  return <main className="sencilla">
    {fallo ? <>
      <p className="aviso" role="alert">{t("auth_enlace_invalido")}</p>
      <Link href="/entrar">{t("auth_entrar")}</Link>
    </> : <p className="nota">{t("auth_comprobando_enlace")}</p>}
  </main>;
}
