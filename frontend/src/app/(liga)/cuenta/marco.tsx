"use client";

// Piezas comunes de Tu cuenta (maqueta v1). Cada pantalla pinta su barra (BarraCuenta) y su cuerpo (CuerpoCuenta);
// el anfitrión decide si viven en la hoja del móvil o en la página de escritorio (NavCuenta.modo).

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { exportarMisDatos } from "@/lib/liga/cuenta";
import { Campana } from "../_avisos/Campana";
import { Sesion } from "../_sesion/Sesion";

export type Pantalla = "inicio" | "nombre" | "clave" | "verificacion" | "avisos" | "legal" | "borrar" | "plan";

export const RUTAS: Record<Pantalla, string> = {
  inicio: "/cuenta", nombre: "/cuenta/nombre", clave: "/cuenta/clave", verificacion: "/cuenta/verificacion",
  avisos: "/cuenta/avisos", legal: "/cuenta/legal", borrar: "/cuenta/borrar", plan: "/cuenta/plan",
};

export const TITULOS = {
  inicio: "account_tu_cuenta", nombre: "account_titulo_nombre", clave: "account_clave", verificacion: "account_titulo_verificacion",
  avisos: "account_avisos", legal: "account_legal", borrar: "account_titulo_borrar", plan: "account_grupo_plan",
} as const satisfies Record<Pantalla, string>;

export interface NavCuenta {
  modo: "hoja" | "pagina";
  /** Fuera del panel: la barra lleva «‹ Cuenta» en vez de «⋯» o «Listo». */
  hondo: boolean;
  /** Clase de la pantalla que entra en la hoja (empuje de iOS). */
  animacion: "" | "cu-entra" | "cu-vuelve";
  ir: (p: Pantalla) => void;
  volver: () => void;
  /** Cierra la hoja; en la página no hace nada. */
  cerrar: () => void;
  avisar: (texto: string) => void;
  marcarCambios: (hay: boolean) => void;
}

const ContextoNav = createContext<NavCuenta | null>(null);
export const ProveedorNavCuenta = ContextoNav.Provider;

export function useNavCuenta(): NavCuenta {
  const nav = useContext(ContextoNav);
  if (!nav) throw new Error("useNavCuenta fuera de Cuenta");
  return nav;
}

/** Con algo escrito sin guardar, cerrar la hoja pregunta antes (DESIGN §6). */
export function useCambiosSinGuardar(hay: boolean): void {
  const { marcarCambios } = useNavCuenta();
  useEffect(() => {
    marcarCambios(hay);
    return () => marcarCambios(false);
  }, [hay, marcarCambios]);
}

const CHEVRON_ATRAS = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"
  strokeLinejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>;

/** Barra de la pantalla: en la hoja, chevron o nada, título y acción o «Listo»; en la página, «⋯» o chevron y la campana. */
export function BarraCuenta({ titulo, accion }: { titulo: string; accion?: ReactNode }) {
  const t = useTranslations();
  const nav = useNavCuenta();
  const destino = t("account_volver");
  const atras = nav.hondo ? <button type="button" className="cu-atras" aria-label={t("account_volver_aria", { destino })}
    onClick={nav.volver}>{CHEVRON_ATRAS}<span>{destino}</span></button> : null;
  if (nav.modo === "hoja") {
    return <div className="hoja-liga-nav">
      <span className="lado">{atras}</span>
      <h2 id="cu-hoja-titulo">{titulo}</h2>
      <span className="lado der">{accion ?? (nav.hondo ? null
        : <button type="button" className="hoja-liga-acc der" onClick={nav.cerrar}>{t("account_listo")}</button>)}</span>
    </div>;
  }
  return <header className="cab centrada">
    {atras ?? <Sesion />}
    <h1 className="cab-titulo">{titulo}</h1>
    <div className="cab-der">{accion}{!nav.hondo && <Campana variante="cabecera" />}</div>
  </header>;
}

/** Acción de la barra (Guardar, Cambiar): petróleo semibold; gris mientras no hay nada que hacer. */
export function AccionBarra({ texto, desactivada = false, onClick }: { texto: string; desactivada?: boolean; onClick: () => void }) {
  return <button type="button" className="cu-accion" disabled={desactivada} onClick={onClick}>{texto}</button>;
}

export function CuerpoCuenta({ children, llega = false }: { children: ReactNode; llega?: boolean }) {
  const nav = useNavCuenta();
  const cuerpo = <div className={`cu${nav.animacion ? ` ${nav.animacion}` : ""}${llega ? " cu-llega" : ""}`}>{children}</div>;
  return nav.modo === "hoja" ? <div className="hoja-liga-contenido">{cuerpo}</div> : cuerpo;
}

export function Grupo({ iconos = false, children }: { iconos?: boolean; children: ReactNode }) {
  return <ul className={`cu-grupo${iconos ? " iconos" : ""}`}>{children}</ul>;
}

export function CabGrupo({ children }: { children: ReactNode }) {
  return <p className="cu-cab">{children}</p>;
}

export function Pie({ children, mal = false, id, alerta = false }: { children: ReactNode; mal?: boolean; id?: string; alerta?: boolean }) {
  return <p className={`cu-pie${mal ? " mal" : ""}`} id={id} role={alerta ? "alert" : "status"}>{children}</p>;
}

export function Chevron() {
  return <svg className="chev" viewBox="0 0 8 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
    strokeLinejoin="round" aria-hidden="true"><path d="m1 1 6 6-6 6" /></svg>;
}

/** Flechas arriba y abajo de los botones con menú en una fila (Idioma). */
export function Selector() {
  return <svg className="selector" viewBox="0 0 10 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
    strokeLinejoin="round" aria-hidden="true"><path d="m2 6 3-3 3 3M2 10l3 3 3-3" /></svg>;
}

const GLIFOS = {
  dosPasos: <><path d="M12 3.5 5.5 6v5.3c0 4 2.8 7.3 6.5 8.7 3.7-1.4 6.5-4.7 6.5-8.7V6z" /><path d="m9.2 12 2 2 3.7-3.8" /></>,
  clave: <><circle cx="8.5" cy="15.5" r="3.5" /><path d="m11 13 7.5-7.5M15.5 8.5l2 2M13.5 10.5l1.5 1.5" /></>,
  avisos: <><path d="M6.5 10a5.5 5.5 0 1 1 11 0c0 4.2 1.6 5.5 1.6 5.5H4.9S6.5 14.2 6.5 10Z" /><path d="M10.2 19a1.9 1.9 0 0 0 3.6 0" /></>,
  idioma: <><circle cx="12" cy="12" r="8" /><path d="M4 12h16M12 4c2.2 2.2 3.2 4.9 3.2 8s-1 5.8-3.2 8c-2.2-2.2-3.2-4.9-3.2-8s1-5.8 3.2-8Z" /></>,
  descargar: <path d="M12 4.5v10M8 10.5l4 4 4-4M5.5 19h13" />,
  borrar: <path d="M5 7.5h14M9.5 7.5V5h5v2.5M7 7.5l.9 11.5h8.2L17 7.5" />,
  metodo: <><circle cx="12" cy="12" r="8" /><path d="M9.7 9.6a2.4 2.4 0 1 1 3.3 2.2c-.6.3-1 .8-1 1.4v.5M12 16.5v.3" /></>,
  aprender: <path d="M4.5 6h5.5a2 2 0 0 1 2 2v11a2 2 0 0 0-2-2H4.5zM19.5 6H14a2 2 0 0 0-2 2v11a2 2 0 0 1 2-2h5.5z" />,
  legal: <><path d="M7 4h6.5L17.5 8v12H7z" /><path d="M13.5 4v4h4M9.5 12.5h5.5M9.5 15.5h5.5" /></>,
  plan: <><path d="M9 6h11M9 12h11M9 18h11" /><path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01" /></>,
};
export type Glifo = keyof typeof GLIFOS;

/** Baldosa de icono como en Ajustes: gris neutro con trazo blanco; roja solo en lo que borra. */
export function Icono({ glifo, peligro = false }: { glifo: Glifo; peligro?: boolean }) {
  return <span className={`cu-ico${peligro ? " peligro" : ""}`} aria-hidden="true">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">{GLIFOS[glifo]}</svg>
  </span>;
}

type PropsCelda = { texto: string; valor?: string; icono?: Glifo; peligro?: boolean; etiqueta?: string };

/** Fila que baja a otra pantalla de Cuenta (empuja en la hoja; navega en la página). */
export function CeldaNav({ a, texto, valor, icono, peligro = false, etiqueta }: PropsCelda & { a: Pantalla }) {
  const { ir } = useNavCuenta();
  return <li><button type="button" className={`cu-celda${icono ? " con-ico" : ""}${peligro ? " peligro" : ""}`}
    aria-label={etiqueta} onClick={() => ir(a)}>
    {icono && <Icono glifo={icono} peligro={peligro} />}<span>{texto}</span><span className="valor">{valor}</span><Chevron />
  </button></li>;
}

/** Fila que sale de Cuenta (cómo funciona, legal…): navegar cierra la hoja. */
export function CeldaEnlace({ href, texto, icono }: PropsCelda & { href: string }) {
  return <li><Link href={href} className={`cu-celda${icono ? " con-ico" : ""}`}>
    {icono && <Icono glifo={icono} />}<span>{texto}</span><span /><Chevron />
  </Link></li>;
}

/** Aviso breve (cápsula neutra); se va solo a los 3,5 s. */
export function AvisoCuenta({ texto, onFin }: { texto: string | null; onFin: () => void }) {
  useEffect(() => {
    if (!texto) return;
    const id = window.setTimeout(onFin, 3500);
    return () => window.clearTimeout(id);
  }, [texto, onFin]);
  return texto ? <div className="cu-aviso" role="status">{texto}</div> : null;
}

function bajarArchivo(nombre: string, texto: string): void {
  const enlace = document.createElement("a");
  enlace.href = URL.createObjectURL(new Blob([texto], { type: "application/json" }));
  enlace.download = nombre;
  enlace.click();
  URL.revokeObjectURL(enlace.href);
}

const ARCHIVO_DATOS = "mis-datos-vennett.json";

/** Descarga de «Descargar mis datos» (panel y Borrar cuenta). */
export function useDescargarDatos(): { descargando: boolean; error: string | null; descargar: () => Promise<void> } {
  const t = useTranslations();
  const { avisar } = useNavCuenta();
  const [descargando, setDescargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const descargar = useCallback(async () => {
    if (descargando) return;
    setDescargando(true);
    setError(null);
    const resultado = await exportarMisDatos();
    if ("error" in resultado) setError(resultado.error);
    else {
      bajarArchivo(ARCHIVO_DATOS, resultado.texto);
      avisar(t("account_descargado", { archivo: ARCHIVO_DATOS }));
    }
    setDescargando(false);
  }, [descargando, avisar, t]);
  return { descargando, error, descargar };
}

/** Esqueleto con la forma del panel: tú arriba y tres grupos de dos filas con baldosa. */
export function EsqueletoCuenta() {
  const t = useTranslations();
  const fila = (ancho: number, i: number) => <li key={i}><div className="cu-celda con-ico">
    <span className="cu-esq" style={{ width: 29, height: 29, borderRadius: 7 }} /><span className="cu-esq" style={{ width: `${ancho}%` }} />
  </div></li>;
  return <div aria-busy="true" aria-label={t("account_cargando_aria")}>
    <ul className="cu-grupo"><li><div className="cu-celda cu-yo">
      <span className="cu-esq" style={{ width: 56, height: 56, borderRadius: "50%" }} />
      <span><span className="cu-esq" style={{ width: "46%", height: 18 }} /><span className="cu-esq" style={{ width: "64%", marginTop: 8 }} /></span>
    </div></li></ul>
    {[[62, 40], [34, 30], [56, 44]].map((anchos, g) => <ul key={g} className="cu-grupo iconos" style={{ marginTop: 28 }}>{anchos.map(fila)}</ul>)}
  </div>;
}
