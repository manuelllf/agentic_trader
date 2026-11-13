"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { PLANES_VISIBLES } from "@/lib/liga/planes";
import { correoOculto } from "@/lib/liga/cuenta";
import { useLanguage } from "@/i18n/Provider";
import type { Locale } from "@/i18n/locale";
import { useSesion } from "../_sesion/SesionContext";
import {
  BarraCuenta, CeldaEnlace, CeldaNav, Chevron, CuerpoCuenta, Grupo, Icono, Pie, Selector,
  useDescargarDatos, useNavCuenta,
} from "./marco";
import { usePushDispositivo } from "./usePushDispositivo";

const CHECK = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6"
  strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>;

/** Una sola fila de Avisos: resumen de push (este dispositivo) y correo; el detalle, dentro. */
function CeldaAvisos({ correo }: { correo: boolean }) {
  const t = useTranslations();
  const { estado } = usePushDispositivo();
  const push = estado === "activo";
  const valor = estado === "cargando" ? undefined : t(push && correo ? "account_avisos_resumen_ambos"
    : push ? "account_avisos_resumen_push" : correo ? "account_avisos_resumen_correo"
      : "account_avisos_resumen_ninguno");
  return <CeldaNav a="avisos" icono="avisos" texto={t("account_avisos")} valor={valor} />;
}

/** Fila Idioma con su menú de dos opciones dentro del mismo li. */
function FilaIdioma() {
  const t = useTranslations();
  const { locale, changing, selectLocale } = useLanguage();
  const [abierto, setAbierto] = useState(false);
  const fila = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (!abierto) return;
    const fuera = (ev: PointerEvent) => {
      if (!fila.current?.contains(ev.target as Node)) setAbierto(false);
    };
    const escape = (ev: KeyboardEvent) => { if (ev.key === "Escape") setAbierto(false); };
    document.addEventListener("pointerdown", fuera);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", fuera);
      document.removeEventListener("keydown", escape);
    };
  }, [abierto]);
  const nombres: Record<Locale, string> = { es: t("account_idioma_es"), en: t("account_idioma_en") };
  return <li ref={fila}>
    <button type="button" className="cu-celda con-ico" aria-haspopup="menu" aria-expanded={abierto}
      disabled={changing} onClick={() => setAbierto(v => !v)}>
      <Icono glifo="idioma" /><span>{t("common_idioma")}</span>
      <span className="valor">{nombres[locale]}</span><Selector />
    </button>
    {abierto && <div className="cu-menu" role="menu" aria-label={t("common_idioma")}>
      {(["es", "en"] as const).map(c => <button key={c} type="button" role="menuitemradio" aria-checked={c === locale}
        lang={c} disabled={changing} onClick={() => { setAbierto(false); void selectLocale(c); }}>
        <span className="cu-marca">{CHECK}</span>{nombres[c]}
      </button>)}
    </div>}
  </li>;
}

export function PanelCuenta() {
  const t = useTranslations();
  const locale = useLocale();
  const nav = useNavCuenta();
  const { yo, email, cerrarSesion } = useSesion();
  const { failure } = useLanguage();
  const { descargando, error, descargar } = useDescargarDatos();
  if (!yo) return null;
  const duracion = yo.plan_pago === "media_temporada" ? "media" : yo.plan_pago;
  const plan = yo.plan === "gratis" ? t("planes_gratis") : duracion
    ? t("planes_pro_titulo", { duracion: t(`planes_${duracion}_nombre`) }) : t("planes_pro");
  const sub = yo.plan === "gratis" ? t("account_plan_gratis_sub") : yo.plan_pago
    ? t("account_plan_hasta", { fecha: yo.plan_pago_hasta
      ? new Date(yo.plan_pago_hasta).toLocaleDateString(locale, { day: "numeric", month: "long" })
      : t("planes_fecha_no_disponible") }) : t("account_plan_concedido");
  const salir = async () => {
    nav.cerrar();
    await cerrarSesion();
  };
  return <>
    <BarraCuenta titulo={t("account_tu_cuenta")} />
    <CuerpoCuenta>
      <ul className="cu-grupo">
        <li><button type="button" className="cu-celda cu-yo" aria-label={t("account_nombre_aria", { alias: yo.alias })}
          onClick={() => nav.ir("nombre")}>
          <span className="cu-mono" aria-hidden="true">{yo.alias.slice(0, 1).toUpperCase()}</span>
          <span className="t"><b>{yo.alias}</b><small>{correoOculto(email ?? "")}</small></span>
          <Chevron />
        </button></li>
      </ul>
      <Pie>{t("account_pie_yo")}</Pie>
      {PLANES_VISIBLES && <Grupo iconos>
        <CeldaNav a="plan" icono="plan" texto={plan} valor={sub} />
      </Grupo>}
      <Grupo iconos>
        <CeldaNav a="verificacion" icono="dosPasos" texto={t("account_verificacion")}
          valor={yo.aal2 ? t("account_activada") : ""} />
        <CeldaNav a="clave" icono="clave" texto={t("account_clave")} />
      </Grupo>
      <Grupo iconos>
        <CeldaAvisos correo={Boolean(yo.avisos_correo)} />
        <FilaIdioma />
      </Grupo>
      {failure && <Pie mal alerta>{t("common_idioma_error")}</Pie>}
      <Grupo iconos>
        <li><button type="button" className="cu-celda con-ico" disabled={descargando} onClick={() => void descargar()}>
          <Icono glifo="descargar" /><span>{t("account_descargar_datos")}</span>
          <span className="valor">{descargando ? t("account_preparando") : ""}</span><span />
        </button></li>
        <CeldaNav a="borrar" icono="borrar" peligro texto={t("account_borrar_cuenta")} />
      </Grupo>
      <Pie>{t("account_descarga_pie")}</Pie>
      {error && <Pie mal alerta>{error}</Pie>}
      <Grupo iconos>
        <CeldaEnlace href="/como-funciona" icono="metodo" texto={t("account_metodo")} />
        <CeldaEnlace href="/aprender" icono="aprender" texto={t("account_aprender")} />
        <CeldaNav a="legal" icono="legal" texto={t("account_legal")} />
      </Grupo>
      <Grupo>
        <li><button type="button" className="cu-celda accion centrada" onClick={() => void salir()}>
          <span>{t("account_salir")}</span>
        </button></li>
      </Grupo>
    </CuerpoCuenta>
  </>;
}
