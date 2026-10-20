"use client";

import { Campana } from "../_avisos/Campana";
import { CREDITOS_VISIBLES } from "@/lib/liga/funciones";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useSesion } from "../_sesion/SesionContext";
import { getCatalogo, getCreditos, getPortada, misEstrategias, misLigas } from "@/lib/liga/api";
import { precargar } from "@/lib/liga/cache";
import { EstadoEnlace } from "./EstadoEnlace";
import { Marca } from "./Marca";
import { LanguageSelector } from "@/i18n/LanguageSelector";

// `.tabbar` de la maqueta (DESIGN.md §5 y §6): Liga, Privadas, Crear y Mías, iconos de trazo
// en línea (nada de librería de iconos).
const PESTANAS = [
  {
    href: "/liga", clave: "liga", texto: "Liga",
    icono: <path d="M3 20h18M5 20v-6h4v6M10 20V8h4v12M15 20v-9h4v9" />,
  },
  {
    href: "/privadas", clave: "privadas", texto: "Privadas",
    icono: (
      <>
        <circle cx="9" cy="8" r="3.2" />
        <path d="M3 19.5c0-3.2 2.7-5.5 6-5.5s6 2.3 6 5.5" />
        <path d="M16 5a3.2 3.2 0 0 1 0 6.2M17.5 14.3c2 .7 3.5 2.6 3.5 5.2" />
      </>
    ),
  },
  {
    href: "/crear", clave: "crear", texto: "Crear",
    icono: <><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></>,
  },
  {
    href: "/mias", clave: "mias", texto: "Mías",
    icono: (
      <>
        <path d="M12 3.5l8.5 4.6L12 12.7 3.5 8.1z" />
        <path d="M3.5 12.4L12 17l8.5-4.6M3.5 16.4L12 21l8.5-4.6" />
      </>
    ),
  },
  {
    href: "/cuenta", clave: "cuenta",
    icono: <><circle cx="12" cy="8" r="3.2" /><path d="M5 20c0-4 3.1-6 7-6s7 2 7 6" /></>,
  },
] as const;

export function BarraPestanas() {
  const t = useTranslations();
  const ruta = usePathname();
  const router = useRouter();
  const { estado, yo, cerrarSesion } = useSesion();
  const panel = yo?.aal2 ? "/admin" : "/cuenta/verificacion?next=/admin";
  const [contraida, setContraida] = useState(false);

  useEffect(() => {
    let guardada = false;
    try { guardada = localStorage.getItem("liga-barra") === "contraida"; } catch {}
    setContraida(guardada);
    if (guardada) document.documentElement.dataset.barra = "contraida";
    else delete document.documentElement.dataset.barra;
    return () => { delete document.documentElement.dataset.barra; };
  }, []);

  const alternar = () => {
    const siguiente = !contraida;
    setContraida(siguiente);
    if (siguiente) document.documentElement.dataset.barra = "contraida";
    else delete document.documentElement.dataset.barra;
    try { localStorage.setItem("liga-barra", siguiente ? "contraida" : "abierta"); } catch {}
  };

  // Precarga tanto el código (`router.prefetch`, de más al `<Link>` que ya lo hace solo al
  // entrar en el viewport) como los datos de las otras pestañas, después del primer pintado: al
  // tocarlas ya están calientes en la caché de módulo (`lib/liga/cache.ts`) y pintan al instante.
  useEffect(() => {
    for (const p of PESTANAS) router.prefetch(p.href);
    const calentar = () => {
      precargar("catalogo", getCatalogo);
      if (estado === "dentro") {
        precargar("mis-estrategias", misEstrategias);
        precargar("mis-ligas", misLigas);
        if (CREDITOS_VISIBLES) precargar("creditos", getCreditos);
      } else if (estado === "fuera") {
        precargar("portada", getPortada);
      }
    };
    const ric = window.requestIdleCallback as typeof window.requestIdleCallback | undefined;
    if (ric) {
      const idle = ric(calentar);
      return () => window.cancelIdleCallback(idle);
    }
    const timer = window.setTimeout(calentar, 200);
    return () => window.clearTimeout(timer);
  }, [estado, router]);

  return (
    <nav className="tabbar" aria-label={t("common_secciones")}>
      <div className="barra-marca solo-escritorio">
        {contraida ? <img src="/icon-192.png?v=vennett-10" alt="" width={32} height={32} />
          : <Marca className="barra-wordmark" />}
        <button type="button" className="barra-alternar" onClick={alternar}
          aria-label={t(contraida ? "common_barra_expandir" : "common_barra_contraer")}
          aria-expanded={!contraida}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9}
            strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d={contraida ? "m9 6 6 6-6 6" : "m15 6-6 6 6 6"} />
          </svg>
        </button>
      </div>
      {PESTANAS.map((p) => {
        const activa = p.clave === "crear" ? ruta?.startsWith("/crear")
          : p.clave === "mias" ? ruta?.startsWith("/mias")
          : p.clave === "privadas" ? ruta?.startsWith("/privadas")
          : p.clave === "cuenta" ? ruta?.startsWith("/cuenta")
          : p.clave === "liga" ? (ruta === "/liga" || ruta?.startsWith("/ficha"))
          : false;
        return (
          <Link key={p.clave} href={p.href} prefetch aria-current={activa ? "page" : undefined}
            className={p.clave === "cuenta" ? "solo-escritorio" : undefined}
            onClick={(event) => {
              if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey
                && !event.altKey && event.currentTarget.querySelector('[aria-busy="true"]')) {
                event.preventDefault();
              }
            }}>
            <EstadoEnlace claseEtiqueta={contraida ? "etiqueta sr-only-escritorio" : "etiqueta"} texto={t(`common_${p.clave}`)} icono={p.icono} />
          </Link>
        );
      })}
      <div className="barra-pie solo-escritorio">
        <LanguageSelector />
        {estado === "dentro" && <>
          <Campana variante="barra" contraida={contraida} />
          {yo?.admin && <Link className="barra-accion" href={panel}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 3 4.5 6v5.5c0 4.4 3.1 7.6 7.5 9.5 4.4-1.9 7.5-5.1 7.5-9.5V6Z" /><path d="m9 12 2.2 2.2L15.5 10" />
            </svg>
            <span className={contraida ? "sr-only-escritorio" : undefined}>{t("account_panel_control")}</span>
          </Link>}
          <button type="button" className="barra-accion" onClick={() => cerrarSesion()}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M10 4H5.5A1.5 1.5 0 0 0 4 5.5v13A1.5 1.5 0 0 0 5.5 20H10" /><path d="M15 8l4 4-4 4M19 12H9" />
            </svg>
            <span className={contraida ? "sr-only-escritorio" : undefined}>{t("account_salir")}</span>
          </button>
        </>}
        {estado === "fuera" && <Link className="barra-accion" href="/entrar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="8" r="3.6" /><path d="M5 20c.6-3.6 3.5-5.6 7-5.6s6.4 2 7 5.6" />
          </svg>
          <span className={contraida ? "sr-only-escritorio" : undefined}>{t("account_entrar")}</span>
        </Link>}
      </div>
    </nav>
  );
}
