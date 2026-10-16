"use client";

import { PLANES_VISIBLES } from "@/lib/liga/planes";
import type { ReactNode } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import type { Yo } from "@/lib/liga/api";
import { correoOculto } from "@/lib/liga/cuenta";
import { ChevronCuenta } from "./MarcoCuenta";
import { usePushDispositivo } from "./usePushDispositivo";

export function FilaCuenta({ href, nombre, valor, sub, peligro = false }: {
  href?: string; nombre: string; valor?: string; sub?: string; peligro?: boolean;
}) {
  const contenido = <>
    <span className="ajustes-texto"><span className="ajustes-nombre">{nombre}</span>
      {sub && <span className="ajustes-sub">{sub}</span>}</span>
    {valor && <span className="ajustes-valor">{valor}</span>}
    {href && <ChevronCuenta />}
  </>;
  const clase = `ajustes-fila${sub ? " ajustes-con-sub" : ""}${peligro ? " ajustes-peligro" : ""}`;
  return <li>{href ? <Link href={href} className={clase}>{contenido}</Link>
    : <div className={clase}>{contenido}</div>}</li>;
}

function Grupo({ titulo, children, nota }: { titulo: string; children: ReactNode; nota?: string }) {
  return <section className="ajustes-grupo" aria-label={titulo}>
    <h2 className="ajustes-etq">{titulo}</h2>
    <ul className="ajustes-lista">{children}</ul>
    {nota && <p className="ajustes-nota">{nota}</p>}
  </section>;
}

/** Una sola fila: el resumen de los avisos (push de este dispositivo y correo); el detalle, dentro. */
function FilaAvisos({ correo }: { correo: boolean }) {
  const t = useTranslations();
  const { estado } = usePushDispositivo();
  const push = estado === "activo";
  const valor = estado === "cargando" ? undefined : t(push && correo ? "account_avisos_resumen_ambos"
    : push ? "account_avisos_resumen_push" : correo ? "account_avisos_resumen_correo"
      : "account_avisos_resumen_ninguno");
  return <FilaCuenta href="/cuenta/avisos" nombre={t("account_avisos")} valor={valor} />;
}

export function CuentaHub({ yo, email }: { yo: Yo; email: string | null }) {
  const t = useTranslations();
  const locale = useLocale();
  const duracion = yo.plan_pago === "media_temporada" ? "media" : yo.plan_pago;
  const plan = yo.plan === "gratis" ? t("planes_gratis") : duracion
    ? t("planes_pro_titulo", { duracion: t(`planes_${duracion}_nombre`) }) : t("planes_pro");
  const sub = yo.plan === "gratis" ? t("account_plan_gratis_sub") : yo.plan_pago
    ? t("account_plan_hasta", { fecha: yo.plan_pago_hasta
      ? new Date(yo.plan_pago_hasta).toLocaleDateString(locale, { day: "numeric", month: "long" })
      : t("planes_fecha_no_disponible") }) : t("account_plan_concedido");
  return <div className="ajustes">
    <Grupo titulo={t("account_grupo_tu")} nota={t("account_correo_nota")}>
      <FilaCuenta href="/cuenta/nombre" nombre={t("account_nombre_liga")} valor={yo.alias} />
      <FilaCuenta nombre={t("account_correo")} valor={correoOculto(email ?? "")} />
    </Grupo>
    {PLANES_VISIBLES && (<Grupo titulo={t("account_grupo_plan")}>
      <FilaCuenta href="/cuenta/plan" nombre={plan} sub={sub} />
    </Grupo>)}
    <Grupo titulo={t("account_grupo_seguridad")}>
      <FilaCuenta href="/cuenta/verificacion?next=/cuenta" nombre={t("account_verificacion")}
        valor={yo.aal2 ? t("account_activada") : undefined} />
      <FilaCuenta href="/cuenta/clave" nombre={t("account_clave")} />
    </Grupo>
    <Grupo titulo={t("account_grupo_avisos")}>
      <FilaAvisos correo={Boolean(yo.avisos_correo)} />
    </Grupo>
    <Grupo titulo={t("account_grupo_datos")}>
      <FilaCuenta href="/cuenta/datos" nombre={t("account_descargar_datos")} />
      <FilaCuenta href="/como-funciona" nombre={t("account_metodo")} />
      <FilaCuenta href="/cuenta/legal" nombre={t("account_legal")} />
    </Grupo>
    <ul className="ajustes-lista ajustes-baja">
      <FilaCuenta href="/cuenta/borrar" nombre={t("account_borrar_cuenta")} peligro />
    </ul>
  </div>;
}
