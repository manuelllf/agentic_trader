"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { getAvisos, guardarZonaHoraria, marcarAvisosLeidos, type ListaAvisos } from "@/lib/liga/api";
import { fijar, useCache } from "@/lib/liga/cache";
import { useSesion } from "../_sesion/SesionContext";
import { HojaAvisos } from "./HojaAvisos";
import "./avisos.css";

// Cada cinco minutos, por si llega uno con la app abierta.
const INTERVALO = 5 * 60_000;
let zonaEnviada = false;

export function Campana({ variante, contraida = false }: { variante: "cabecera" | "barra"; contraida?: boolean }) {
  const t = useTranslations();
  const { estado, yo } = useSesion();
  const { datos, fallo } = useCache<ListaAvisos>(estado === "dentro" ? "avisos" : null, async () => {
    const r = await getAvisos();
    if (typeof r === "string") throw new Error(r);
    return r;
  }, INTERVALO);
  const [abierto, setAbierto] = useState(false);

  useEffect(() => {
    if (estado !== "dentro" || !yo || zonaEnviada) return;
    zonaEnviada = true;
    const zona = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const clave = `liga-zona:${yo.alias}`;
    try { if (localStorage.getItem(clave) === zona) return; } catch {}
    void guardarZonaHoraria(zona).then(r => {
      if (typeof r !== "string") {
        try { localStorage.setItem(clave, zona); } catch {}
      }
    }).catch(() => {});
  }, [estado, yo]);

  const cerrar = () => setAbierto(false);
  const abrir = () => {
    setAbierto(true);
    if (datos && datos.sin_leer > 0) void marcarAvisosLeidos().then(r => {
      if (typeof r !== "string") fijar("avisos", r);
    }).catch(() => {});
  };
  if (estado !== "dentro") return null;
  // La hoja va a la capa de la liga, fuera de la cabecera: el desenfoque de la cabecera al bajar la
  // convertiría en el punto de referencia de la posición fija.
  return <div className={`campana-caja${variante === "barra" ? " en-barra" : ""}`}>
    <button type="button" className={variante === "barra" ? "barra-accion campana" : "campana"} aria-haspopup="dialog" aria-expanded={abierto}
      aria-label={t("avisos_aria", { n: datos?.sin_leer ?? 0 })} onClick={() => (abierto ? cerrar() : abrir())}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true"><path d="M6 9.5a6 6 0 1 1 12 0c0 4.6 1.8 6 1.8 6H4.2S6 14.1 6 9.5Z" /><path d="M10 19.5a2 2 0 0 0 4 0" /></svg>
      {variante === "barra" && <span className={contraida ? "sr-only-escritorio" : undefined}>{t("avisos_titulo")}</span>}
      {(datos?.sin_leer ?? 0) > 0 && <span className="campana-punto" aria-hidden="true" />}
    </button>
    {abierto && createPortal(<HojaAvisos lista={datos} fallo={fallo} onCerrar={cerrar} />, document.querySelector(".lg") ?? document.body)}
  </div>;
}
