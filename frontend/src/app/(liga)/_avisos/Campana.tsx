"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { getAvisos, guardarZonaHoraria, marcarAvisosLeidos, type Aviso, type ListaAvisos } from "@/lib/liga/api";
import { fijar, useCache } from "@/lib/liga/cache";
import { useSesion } from "../_sesion/SesionContext";
import { PanelAvisos } from "./PanelAvisos";
import { HojaResumen } from "./HojaResumen";
import "./avisos.css";

// Cada cinco minutos, por si llega uno con la app abierta.
const INTERVALO = 5 * 60_000;
let zonaEnviada = false;

export function Campana({ variante, contraida = false }: { variante: "cabecera" | "barra"; contraida?: boolean }) {
  const t = useTranslations();
  const { estado, yo } = useSesion();
  const { datos } = useCache<ListaAvisos>(estado === "dentro" ? "avisos" : null, async () => {
    const r = await getAvisos();
    if (typeof r === "string") throw new Error(r);
    return r;
  }, INTERVALO);
  const [abierto, setAbierto] = useState(false);
  const [vista, setVista] = useState<ListaAvisos>();
  const [resumen, setResumen] = useState<Aviso | null>(null);
  const caja = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: PointerEvent) => {
      if (!caja.current?.contains(e.target as Node)) setAbierto(false);
    };
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape") setAbierto(false); };
    document.addEventListener("pointerdown", fuera);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", fuera);
      document.removeEventListener("keydown", escape);
    };
  }, [abierto]);

  const cerrar = () => setAbierto(false);
  const abrir = () => {
    if (!datos) return;
    setVista(datos);
    setAbierto(true);
    if (datos.sin_leer > 0) void marcarAvisosLeidos().then(r => {
      if (typeof r !== "string") fijar("avisos", r);
    }).catch(() => {});
  };
  if (estado !== "dentro") return null;
  return <div className={`campana-caja${variante === "barra" ? " en-barra" : ""}`} ref={caja}>
    <button type="button" className={variante === "barra" ? "barra-accion campana" : "campana"} aria-haspopup="dialog" aria-expanded={abierto}
      aria-label={t("avisos_aria", { n: datos?.sin_leer ?? 0 })} onClick={() => (abierto ? cerrar() : abrir())}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6.5 9a5.5 5.5 0 0 1 11 0c0 6 2.5 7 2.5 8H4c0-1 2.5-2 2.5-8" /><path d="M10 20.5h4" /></svg>
      {variante === "barra" && <span className={contraida ? "sr-only-escritorio" : undefined}>{t("avisos_titulo")}</span>}
      {(datos?.sin_leer ?? 0) > 0 && <span className="campana-punto" aria-hidden="true" />}
    </button>
    {abierto && vista && <PanelAvisos lista={vista} enBarra={variante === "barra"} onIr={cerrar} onResumen={a => { setResumen(a); cerrar(); }} />}
    {resumen && <HojaResumen aviso={resumen} onCerrar={() => setResumen(null)} />}
  </div>;
}
