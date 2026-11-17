"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { Celda, Esqueleto, Grupo, Hoja, Vacio } from "../_panel/ui";
import type { AgenteError } from "./api";
import { bloques, negritas } from "./formato";
import type { EstadoCarga } from "./useCarga";
import "./agente.css";

/** Contenedor de toda pantalla de Alphagentic; con `atras`, enlace de vuelta a la vista de origen
 *  (por defecto se llama Alphagentic; `atrasTexto` lo cambia, como «Decisiones»). */
export function Pagina({ atras, atrasTexto, className, children }: { atras?: string; atrasTexto?: string; className?: string; children: ReactNode }) {
  const t = useTranslations();
  const destino = atrasTexto ?? t("admin_pnl_sala_alphagentic");
  return (
    <div className={["pa", className].filter(Boolean).join(" ")}>
      {atras && (
        <Link href={atras} className="pa-atras" aria-label={t("admin_pnl_atras", { destino })}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
          <span>{destino}</span>
        </Link>
      )}
      {children}
    </div>
  );
}

/** Texto largo recortado a cinco líneas con «Leer todo», que lo abre entero en una hoja. */
export function TextoRecortado({ texto, titulo }: { texto: string; titulo: string }) {
  const t = useTranslations();
  const [abierta, setAbierta] = useState(false);
  return (
    <>
      <TextoAgente texto={texto} className="pa-carta pa-recorte" />
      <button type="button" className="pa-mas" onClick={() => setAbierta(true)}>{t("pnl_agente_leer_todo")}</button>
      <HojaTexto abierta={abierta} titulo={titulo} texto={texto} onCerrar={() => setAbierta(false)} />
    </>
  );
}

/** Hoja con un texto del agente entero. */
export function HojaTexto({ abierta, titulo, texto, onCerrar }: { abierta: boolean; titulo: string; texto: string; onCerrar: () => void }) {
  const t = useTranslations();
  return (
    <Hoja abierta={abierta} titulo={titulo} accion={t("admin_pnl_listo")} onCerrar={onCerrar}>
      <div className="pa-hoja pa-vista"><TextoAgente texto={texto} /></div>
    </Hoja>
  );
}

const TEXTO_FALLO = {
  sin_url: "pnl_agente_no_disp_sin_url", red: "pnl_agente_no_disp_red",
  sesion: "pnl_agente_no_disp_sesion", http: "pnl_agente_no_disp_http",
} as const;

/** Estado vacío real cuando el servicio del agente no responde: nunca se pinta nada de ejemplo. */
export function NoDisponible({ error, onReintentar }: { error: AgenteError | null; onReintentar: () => void }) {
  const t = useTranslations();
  const tipo = error?.tipo ?? "red";
  return (
    <div className="pnl-llega" role="alert">
      <Vacio titulo={t("pnl_agente_no_disp_titulo")} texto={t(TEXTO_FALLO[tipo], { estado: error?.estado ?? 0 })} />
      {tipo !== "sin_url" && (
        <Grupo className="pa-reintento"><Celda titulo={t("pnl_agente_reintentar")} tono="accion" onClick={onReintentar} /></Grupo>
      )}
    </div>
  );
}

export interface CargaProps<T> {
  estado: EstadoCarga;
  datos: T | null;
  error: AgenteError | null;
  recargar: () => void;
  filas?: number;
  children: (datos: T) => ReactNode;
}

/** Esqueleto mientras llega, vacío real si falla, y el contenido entero cuando está. */
export function Carga<T>({ estado, datos, error, recargar, filas = 4, children }: CargaProps<T>) {
  const t = useTranslations();
  if (estado === "cargando") return <Esqueleto filas={filas} etiqueta={t("pnl_agente_cargando")} />;
  if (estado === "error" || datos === null) return <NoDisponible error={error} onReintentar={recargar} />;
  return <div className="pnl-llega">{children(datos)}</div>;
}

function EnLinea({ texto }: { texto: string }) {
  return <>{negritas(texto).map((trozo, i) => (i % 2 ? <strong key={i}>{trozo}</strong> : trozo))}</>;
}

/** Texto escrito por el agente (filosofía, razonamientos, informes, fichas) con su estructura. */
export function TextoAgente({ texto, className = "pa-carta" }: { texto: string; className?: string }) {
  return (
    <div className={className}>
      {bloques(texto).map((b, i) => {
        if (b.tipo === "titulo") return b.nivel === 1 ? <h3 key={i}><EnLinea texto={b.texto} /></h3> : <h4 key={i}><EnLinea texto={b.texto} /></h4>;
        if (b.tipo === "lista") return <ul key={i}>{b.items.map((it, j) => <li key={j}><EnLinea texto={it} /></li>)}</ul>;
        return <p key={i}><EnLinea texto={b.texto} /></p>;
      })}
    </div>
  );
}
