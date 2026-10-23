"use client";

import { useEffect, useMemo, useState } from "react";
import * as api from "@/lib/criptico/api";
import type { Idioma, Textos } from "@/lib/criptico/tipos";
import { Marca } from "../../(liga)/_ui/Marca";
import { ruta, traductor } from "./textos";

export default function Token({ idioma, textos, token, accion }: {
  idioma: Idioma; textos: Textos; token: string; accion: "confirmar" | "baja";
}) {
  const t = useMemo(() => traductor(idioma, textos), [idioma, textos]);
  const [estado, setEstado] = useState("cr_cargando");
  const [intento, setIntento] = useState(0);
  useEffect(() => {
    let activo = true;
    if (!token) { setEstado("cr_token_invalido"); return; }
    setEstado("cr_cargando");
    void api[accion](token).then(({ ok }) => {
      if (activo) setEstado(ok ? accion === "confirmar" ? "cr_confirmado" : "cr_baja_ok" : "cr_token_invalido");
    }).catch(() => { if (activo) setEstado("cr_error"); });
    return () => { activo = false; };
  }, [token, accion, intento]);
  return <main className="cr-estado" lang={idioma}>
    <a className="sello" href={ruta(idioma)}><Marca className="marca" /><i aria-hidden="true" /><b>{t("cr_nombre")}</b></a>
    <h1>{t(`cr_${accion}_titulo`)}</h1><p role="status">{t(estado)}</p>
    {estado === "cr_error" && <button type="button" className="btn pri" onClick={() => setIntento(n => n + 1)}>{t("cr_reintentar")}</button>}
    <a className="cr-enlace" href={ruta(idioma)}>{t("cr_volver")}</a>
  </main>;
}
