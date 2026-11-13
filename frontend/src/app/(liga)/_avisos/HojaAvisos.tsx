"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import type { Aviso, ListaAvisos } from "@/lib/liga/api";
import { porcentaje } from "@/lib/liga/format";
import type { Locale } from "@/i18n/locale";
import { cuando, textoAviso } from "./textoAviso";
import { cuentaEnHoja, useHojaCuenta } from "../cuenta/hojaContexto";

// Tres avisos antes de desplegar la lista.
const VISIBLES = 3;

/** Hoja de avisos (DESIGN §7): la lista y el detalle de un aviso van en la misma hoja, sin apilar otra encima.
 *  En escritorio, la misma hoja sale como tarjeta centrada (UIUX §12). */
export function HojaAvisos({ lista, fallo, onCerrar }: { lista: ListaAvisos | undefined; fallo: boolean; onCerrar: () => void }) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const hojaCuenta = useHojaCuenta();
  const [abierto, setAbierto] = useState(false);
  const [detalle, setDetalle] = useState<Aviso | null>(null);
  const cancelar = useRef<HTMLButtonElement>(null);
  const hoja = useRef<HTMLElement>(null);
  // Guardo la última versión de onCerrar para no rehacer el foco en cada pintado.
  const cerrarRef = useRef(onCerrar);
  cerrarRef.current = onCerrar;

  const filas = (lista?.avisos ?? []).map((a) => ({ a, txt: textoAviso(a, t, locale) }))
    .filter((f): f is typeof f & { txt: NonNullable<typeof f.txt> } => f.txt !== null);
  const visibles = abierto ? filas : filas.slice(0, VISIBLES);
  const cargando = lista === undefined && !fallo;

  useEffect(() => {
    const anterior = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    cancelar.current?.focus();
    function tecla(e: KeyboardEvent) {
      if (e.key === "Escape") cerrarRef.current();
      if (e.key === "Tab") {
        const botones = hoja.current?.querySelectorAll<HTMLElement>("button, a[href]");
        const primero = botones?.[0];
        const ultimo = botones?.[botones.length - 1];
        if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo?.focus(); }
        else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero?.focus(); }
      }
    }
    document.addEventListener("keydown", tecla);
    return () => {
      document.removeEventListener("keydown", tecla);
      document.body.style.overflow = overflow;
      anterior?.focus();
    };
  }, []);

  const datos = detalle?.datos ?? {};
  const numero = typeof datos.numero === "number" || typeof datos.numero === "string" ? datos.numero : "";
  const total = datos.total == null ? null : Number(datos.total);
  const tituloDetalle = detalle ? t(total == null ? "avisos_hoja_titulo_sin_total" : "avisos_hoja_titulo", { numero, total: total ?? 0 }) : "";
  const estrategia = typeof datos.estrategia === "string" ? datos.estrategia : "";
  const rent = datos.rentabilidad == null ? null : porcentaje(Number(datos.rentabilidad), 1, locale);
  const sp = datos.sp == null ? null : porcentaje(Number(datos.sp), 1, locale);
  const puesto = typeof datos.puesto_general === "number" ? datos.puesto_general : null;
  const provisional = datos.provisional === true;

  const cabecera = detalle ? <>
    <button type="button" className="izq" onClick={() => setDetalle(null)}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 6-6 6 6 6" /></svg>{t("avisos_titulo")}
    </button>
    <span />
    <button type="button" className="der" onClick={() => cerrarRef.current()}>{t("avisos_listo")}</button>
  </> : <>
    <button ref={cancelar} type="button" className="izq" onClick={() => cerrarRef.current()}>{t("common_cancelar")}</button>
    <span className="titulo">{t("avisos_titulo")}</span>
    <button type="button" className="der" onClick={() => cerrarRef.current()}>{t("avisos_listo")}</button>
  </>;

  const cuerpo = detalle ? <>
    <h2 className="avisos-detalle-titulo">{tituloDetalle}</h2>
    <dl className="hoja-res">
      <div><dt>{t("avisos_hoja_estrategia")}</dt><dd>{estrategia || "-"}</dd></div>
      <div><dt>{t("avisos_hoja_rentabilidad")}</dt><dd className="num">{rent ?? "-"}</dd></div>
      <div><dt>{t("avisos_hoja_sp")}</dt><dd className="num">{sp ?? "-"}</dd></div>
      <div><dt>{t("avisos_hoja_puesto")}</dt><dd className="num">{puesto ?? "-"}</dd></div>
    </dl>
    {provisional && <p className="hoja-res-nota">{t("avisos_hoja_provisional")}</p>}
    <Link href="/mias" className="btn pri wide" onClick={() => cerrarRef.current()}>{t("avisos_hoja_ir")}</Link>
  </> : cargando ? <div className="avisos-esqueletos" aria-hidden="true">
    {[0, 1, 2].map((i) => <div key={i} className="aviso-esqueleto"><span /><span /></div>)}
  </div> : filas.length === 0 ? <div className="avisos-vacio">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9.5a6 6 0 1 1 12 0c0 4.6 1.8 6 1.8 6H4.2S6 14.1 6 9.5Z" /><path d="M10 19.5a2 2 0 0 0 4 0" /></svg>
    <h3>{t("avisos_vacio_titulo")}</h3>
    <p>{t("avisos_vacio_texto")}</p>
    <Link href="/liga?vista=tabla" className="avisos-ver" onClick={() => cerrarRef.current()}>{t("avisos_vacio_ver")}</Link>
  </div> : <>
    {lista && lista.sin_leer > 0 && <p className="avisos-sub">{t("avisos_nuevos", { n: lista.sin_leer })}</p>}
    <div className="avisos-celdas">
      {visibles.map(({ a, txt }) => {
        const dentro = <>
          <span className="pt" aria-hidden="true" />
          <div>
            <span className="t">{txt.titulo}</span>
            <p className="r">{txt.texto}</p>
            <span className="ir">{t(`avisos_ir_${txt.destino.ir}`)}</span>
          </div>
          <time>{cuando(a.creado, new Date(), locale)}</time>
        </>;
        const clase = `aviso${a.leido ? "" : " nuevo"}`;
        return txt.destino.href
          ? <Link key={a.id} href={txt.destino.href} className={clase} onClick={() => cerrarRef.current()}>{dentro}</Link>
          : <button key={a.id} type="button" className={clase} onClick={() => setDetalle(a)}>{dentro}</button>;
      })}
    </div>
    {filas.length > VISIBLES && <button type="button" className="avisos-mas" aria-expanded={abierto} onClick={() => setAbierto(!abierto)}>
      {abierto ? t("avisos_ver_menos") : t("avisos_ver_mas", { n: filas.length - VISIBLES })}
    </button>}
    <Link href="/cuenta/avisos" className="avisos-como" onClick={(e) => {
      cerrarRef.current();
      // En el móvil, la cuenta es una hoja: se cierra esta y se abre aquella, nunca una encima de otra.
      if (hojaCuenta && cuentaEnHoja()) { e.preventDefault(); hojaCuenta.abrir("avisos"); }
    }}>{t("avisos_como")}</Link>
  </>;

  return <>
    <div className="avisos-velo" onClick={() => cerrarRef.current()} />
    <section ref={hoja} className="sheet avisos-hoja" role="dialog" aria-modal="true" aria-label={detalle ? tituloDetalle : t("avisos_titulo")}>
      <div className="sheet-h avisos-cabecera">{cabecera}</div>
      <div className="sheet-b">{cuerpo}</div>
    </section>
  </>;
}
