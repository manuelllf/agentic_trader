"use client";

// Estado del plan y enlaces al portal de Lemon.

import { useLocale, useTranslations } from "next-intl";
import { useId, useState } from "react";
import type { Yo } from "@/lib/liga/api";
import type { ProductoPago, Suscripcion } from "@/lib/liga/pagos";

type Pro = "mensual" | "media_temporada" | "temporada";
type Clave = "mensual" | "media" | "temporada" | "liga";

const CLAVE: Record<ProductoPago, Clave> = {
  mensual: "mensual", media_temporada: "media", temporada: "temporada", pack_liga: "liga",
};
const PRO: Pro[] = ["mensual", "media_temporada", "temporada"];

function esPro(producto: string | null | undefined): producto is Pro {
  return PRO.includes(producto as Pro);
}

type Props = {
  yo: Yo;
  suscripcion: Suscripcion | null;
  comprar?: (producto: ProductoPago) => Promise<{ url: string } | { error: string }>;
};

export function PlanCuentaVista({ yo, suscripcion, comprar: pedirCompra }: Props) {
  const t = useTranslations();
  const locale = useLocale();
  const base = useId();
  const [comprando, setComprando] = useState<ProductoPago | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const actual = esPro(yo.plan_pago) ? yo.plan_pago : null;
  const proDelAdmin = yo.plan === "pro" && actual === null;

  async function comprar(producto: ProductoPago) {
    if (comprando || !pedirCompra) return;
    setComprando(producto);
    setAviso(null);
    const res = await pedirCompra(producto);
    if ("url" in res) {
      window.location.replace(res.url);
      return;
    }
    setComprando(null);
    setAviso(t(res.error as Parameters<typeof t>[0]));
  }

  const nombre = (p: Pro) => t(`planes_${CLAVE[p]}_nombre` as Parameters<typeof t>[0]);
  const formatear = (valor: string | null | undefined) => valor
    ? new Date(valor).toLocaleDateString(locale, { day: "numeric", month: "long" }) : null;
  const fecha = formatear(suscripcion?.renueva_en ?? yo.plan_pago_hasta);
  const fechaFin = formatear(suscripcion?.termina_en ?? suscripcion?.renueva_en
    ?? yo.plan_pago_hasta) ?? t("planes_fecha_no_disponible");
  const activa = !suscripcion || suscripcion.estado === "activa";
  const cancelada = suscripcion?.estado === "cancelada";

  return (
    <section className="form cuenta-plan" aria-labelledby={`${base}-titulo`}>
      <p className="cuenta-plan-etiqueta">{t("planes_plan_actual")}</p>

      {yo.plan === "gratis" ? (
        <>
          <h2 id={`${base}-titulo`} className="cuenta-plan-titulo">{t("planes_gratis")}</h2>
          <p className="cuenta-plan-nota">{t("planes_gratis_ayuda")}</p>
          <h3 className="cuenta-plan-subtitulo">{t("planes_elige")}</h3>
          <p className="cuenta-plan-nota">{t("planes_intro")}</p>
          <ul className="cuenta-plan-lista">
            {PRO.map((p) => (
              <li key={p} className="cuenta-plan-fila">
                <span className="cuenta-plan-fila-texto">
                  <span className="cuenta-plan-fila-nombre">
                    {t("planes_pro_titulo", { duracion: nombre(p) })}
                  </span>
                  <span className="cuenta-plan-fila-detalle">
                    {t(`planes_${CLAVE[p]}_detalle` as Parameters<typeof t>[0])}
                  </span>
                </span>
                <button type="button" className="btn small" disabled={comprando !== null}
                  onClick={() => comprar(p)}>
                  {comprando === p ? t("planes_cargando") : t("planes_elegir")}
                </button>
              </li>
            ))}
            <li className="cuenta-plan-fila">
              <span className="cuenta-plan-fila-texto">
                <span className="cuenta-plan-fila-nombre">{t("planes_liga_nombre")}</span>
                <span className="cuenta-plan-fila-detalle">{t("planes_liga_detalle")}</span>
              </span>
              <button type="button" className="btn small" disabled={comprando !== null}
                onClick={() => comprar("pack_liga")}>
                {comprando === "pack_liga" ? t("planes_cargando") : t("planes_elegir")}
              </button>
            </li>
          </ul>
        </>
      ) : (
        <>
          <div className="cuenta-plan-cabeza">
            <h2 id={`${base}-titulo`} className="cuenta-plan-titulo">
              {actual ? t("planes_pro_titulo", { duracion: nombre(actual) }) : t("planes_pro")}
            </h2>
            {actual && (
              <span className="cuenta-plan-precio">
                {t(`planes_${CLAVE[actual]}_precio` as Parameters<typeof t>[0])}{" "}
                {t(`planes_${CLAVE[actual]}_periodo` as Parameters<typeof t>[0])}
              </span>
            )}
          </div>
          {actual && activa && (
            <p className="cuenta-plan-nota">
              {fecha && t("planes_renueva", { fecha })} {t("planes_pro_dos_ligas")}
            </p>
          )}
          {proDelAdmin && <p className="cuenta-plan-nota">{t("planes_pro_admin")}</p>}
          {actual && cancelada && (
            <>
              <p className="cuenta-plan-nota">{t("planes_cancelada", { fecha: fechaFin })}</p>
              <p className="cuenta-plan-nota">{t("planes_cancelada_ayuda")}</p>
            </>
          )}
          {actual && !activa && !cancelada && (
            <>
              <p className="aviso" role="status">{t("planes_atrasada")}</p>
              {suscripcion?.tarjeta_url && (
                <a className="btn pri" href={suscripcion.tarjeta_url} target="_blank"
                  rel="noopener noreferrer">{t("planes_actualizar_tarjeta")}</a>
              )}
            </>
          )}

          {actual && suscripcion && (
            <section className="cuenta-plan-pago" aria-labelledby={`${base}-pago`}>
              <h3 id={`${base}-pago`} className="cuenta-plan-subtitulo">
                {t("planes_suscripcion")}
              </h3>
              {suscripcion.tarjeta_marca && suscripcion.tarjeta_ultimos4 && (
                <p className="cuenta-plan-nota">{t("planes_tarjeta", {
                  marca: suscripcion.tarjeta_marca, ultimos: suscripcion.tarjeta_ultimos4,
                })}</p>
              )}
              <p className="cuenta-plan-nota">{t("planes_gestion_ayuda")}</p>
              {suscripcion.portal_url && (
                <a className="btn pri" href={suscripcion.portal_url} target="_blank"
                  rel="noopener noreferrer">{t("planes_gestionar")}</a>
              )}
            </section>
          )}

          <section className="cuenta-plan-pase" aria-labelledby={`${base}-pase`}>
            <h3 id={`${base}-pase`} className="cuenta-plan-subtitulo">{t("planes_liga_nombre")}</h3>
            {yo.pase_liga && <p className="cuenta-plan-nota">{t("planes_pase_tienes")}</p>}
            <p className="cuenta-plan-nota">{t("planes_pase_detalle")}</p>
            <button type="button" className="btn small wide" disabled={comprando !== null}
              onClick={() => comprar("pack_liga")}>
              {comprando === "pack_liga" ? t("planes_cargando") : t("planes_comprar_pase")}
            </button>
          </section>
        </>
      )}
      {aviso && <p className="aviso" role="alert">{aviso}</p>}
    </section>
  );
}
