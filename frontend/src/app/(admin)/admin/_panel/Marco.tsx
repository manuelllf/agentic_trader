"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Marca } from "@/app/(liga)/_ui/Marca";
import { Campana } from "./Campana";
import { ProveedorAccionCabecera, useAccionCabecera } from "./AccionCabecera";
import { ResumenPanelProvider, cuentasPorSeccion, useResumenPanel } from "./resumen";
import { GRUPOS_SECCIONES, SALAS, esPantallaNueva, salaDe, seccionDe, tienePadre, type Forma } from "./salas";
import "../_marco/marco.css";
import "./panel.css";

function IconoSala({ formas }: { formas: readonly Forma[] }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {formas.map((f, i) => {
        if (f.tipo === "trazo") return <path key={i} d={f.d} />;
        if (f.tipo === "relleno") return <rect key={i} x={f.x} y={f.y} width={f.ancho} height={f.alto} rx={f.radio} fill="currentColor" stroke="none" />;
        return <circle key={i} cx={f.cx} cy={f.cy} r={f.r} fill={f.lleno ? "currentColor" : "none"} />;
      })}
    </svg>
  );
}

function Estructura({ children }: { children: ReactNode }) {
  const t = useTranslations();
  const ruta = usePathname() ?? "";
  const sala = salaDe(ruta);
  const seccion = seccionDe(ruta);
  const nueva = esPantallaNueva(ruta);
  const { datos } = useResumenPanel();
  const accion = useAccionCabecera();
  const cuentas = datos ? cuentasPorSeccion(datos.pendientes) : {};
  const [superado, setSuperado] = useState(false);

  // Como en iOS: la cabecera toma material al haber contenido debajo y enseña el título cuando el grande sale.
  useEffect(() => {
    const marcar = () => {
      setSuperado(window.scrollY > 4);
    };
    marcar();
    window.addEventListener("scroll", marcar, { passive: true });
    return () => window.removeEventListener("scroll", marcar);
  }, [ruta, nueva]);

  const titulo = seccion ? t(`admin_pnl_sec_${seccion}`) : ruta.replace(/\/+$/, "") === "/admin/liga" ? t("admin_pnl_sec_resumen") : t(`admin_pnl_sala_${sala}`);
  const clasePnl = nueva ? "pnl" : "pnl pnl-vieja";

  return (
    <div className={`pnl-raiz${nueva ? "" : " vieja"}`}>
      <div className="lg pnl-lg">
        <div className={clasePnl}>
          <nav className="pnl-barra" aria-label={t("admin_pnl_salas")} style={{ "--n": SALAS.length } as CSSProperties}>
            <Link href="/admin" className="pnl-marca" aria-label={t("admin_pnl_sala_vennett")}><Marca /></Link>
            {SALAS.map(s => (
              <div key={s.clave} style={{ display: "contents" }}>
                <Link href={s.href} className="pnl-sala" aria-current={sala === s.clave ? "page" : undefined}>
                  <IconoSala formas={s.icono} /><span>{t(`admin_pnl_sala_${s.clave}`)}</span>
                </Link>
                {s.clave === "vennett" && sala === "vennett" && (
                  <div className="pnl-secciones" role="group" aria-label={t("admin_pnl_secciones")}>
                    {GRUPOS_SECCIONES.map(g => (
                      <div key={g.clave} style={{ display: "contents" }}>
                        <p>{t(`admin_pnl_grupo_${g.clave}`)}</p>
                        {g.secciones.map(sec => {
                          const nombre = t(`admin_pnl_sec_${sec.clave}`);
                          if (sec.pronto) return <span key={sec.clave} className="pnl-sec" aria-disabled="true">{nombre}<em>{t("admin_pnl_pronto")}</em></span>;
                          const cuenta = cuentas[sec.clave];
                          return (
                            <Link key={sec.clave} href={sec.href} className="pnl-sec" aria-current={seccion === sec.clave ? "page" : undefined}>
                              {nombre}{cuenta ? <span className="pnl-cuenta">{cuenta}</span> : null}
                            </Link>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </nav>
          <header className={`pnl-cab${superado ? " superado" : ""}`}>
            <div className="pnl-cab-in">
              {tienePadre(ruta) ? (
                <Link href="/admin" className="pnl-atras" aria-label={t("admin_pnl_atras", { destino: t("admin_pnl_sala_vennett") })}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
                  <span>{t("admin_pnl_sala_vennett")}</span>
                </Link>
              ) : <span />}
              {/* Como la maqueta: título pequeño centrado siempre; el h1 de la página queda para lectores de pantalla. */}
              <p className="pnl-cab-titulo visible" aria-hidden="true">{titulo}</p>
              <div className="pnl-cab-der">{accion}<Campana /></div>
            </div>
          </header>
        </div>
      </div>
      {nueva ? (
        <div className="lg pnl-lg">
          <div className="pnl">
            <div className="pnl-slot">
              <main className="pnl-pagina">
                <h1 className="pnl-oculto">{titulo}</h1>
                {children}
              </main>
            </div>
          </div>
        </div>
      ) : (
        // Las salas antiguas quedan fuera de .lg: sus reglas no deben tocar su aspecto oscuro de siempre.
        <div className="pnl-slot"><div className="adm pnl-viejo">{children}</div></div>
      )}
    </div>
  );
}

/** Marco del panel: barra de salas (móvil) o raíl (escritorio), cabecera fija y campana. */
export function Marco({ children }: { children: ReactNode }) {
  const ruta = usePathname() ?? "";
  return <ResumenPanelProvider ruta={ruta}><ProveedorAccionCabecera><Estructura>{children}</Estructura></ProveedorAccionCabecera></ResumenPanelProvider>;
}
