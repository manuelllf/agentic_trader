"use client";

// El plan de la cuenta: el actual y a qué puedes cambiarlo. Lemon cobra; aquí solo se elige.

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import type { Yo } from "@/lib/liga/api";
import { abrirPago, cambiarPlan, type ProductoPago } from "@/lib/liga/pagos";
import { useSesion } from "../_sesion/SesionContext";

type Pro = "mensual" | "media_temporada" | "temporada";
type Clave = "mensual" | "media" | "temporada" | "liga";

const CLAVE: Record<ProductoPago, Clave> = {
  mensual: "mensual", media_temporada: "media", temporada: "temporada", pack_liga: "liga",
};
const PRO: Pro[] = ["mensual", "media_temporada", "temporada"];

function esPro(producto: string | null | undefined): producto is Pro {
  return PRO.includes(producto as Pro);
}

export function PlanCuenta({ yo }: { yo: Yo }) {
  const t = useTranslations();
  const locale = useLocale();
  const base = useId();
  const { refrescarYo } = useSesion();
  const refrescar = useRef(refrescarYo);
  const seccion = useRef<HTMLElement>(null);
  const [elegido, setElegido] = useState<Pro | null>(null);
  const [cambiando, setCambiando] = useState(false);
  const [comprando, setComprando] = useState<ProductoPago | null>(null);
  const [pedido, setPedido] = useState<{ destino: Pro; intentos: number } | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const actual = esPro(yo.plan_pago) ? yo.plan_pago : null;
  const proDelAdmin = yo.plan === "pro" && actual === null;

  useEffect(() => { refrescar.current = refrescarYo; }, [refrescarYo]);

  // Desde «Ver planes» o el menú se llega con #plan: la sección se pone arriba.
  useEffect(() => {
    if (window.location.hash === "#plan") seccion.current?.scrollIntoView({ block: "start" });
  }, []);

  // Lemon confirma el cambio por webhook: se relee la cuenta unas veces hasta verlo.
  useEffect(() => {
    if (!pedido) return;
    if (actual === pedido.destino) { setPedido(null); return; }
    if (pedido.intentos >= 5) return;
    const id = window.setTimeout(() => {
      setPedido((p) => (p ? { ...p, intentos: p.intentos + 1 } : p));
      refrescar.current();
    }, 3000);
    return () => window.clearTimeout(id);
  }, [pedido, actual]);

  async function cambiar() {
    if (!elegido || cambiando) return;
    setCambiando(true);
    setAviso(null);
    const res = await cambiarPlan(elegido);
    setCambiando(false);
    if ("ok" in res) setPedido({ destino: elegido, intentos: 0 });
    else setAviso(t(res.error as Parameters<typeof t>[0]));
  }

  async function comprar(producto: ProductoPago) {
    if (comprando) return;
    setComprando(producto);
    setAviso(null);
    const res = await abrirPago(producto);
    if ("url" in res) {
      window.location.replace(res.url);
      return;
    }
    setComprando(null);
    setAviso(t(res.error as Parameters<typeof t>[0]));
  }

  const nombre = (p: Pro) => t(`planes_${CLAVE[p]}_nombre` as Parameters<typeof t>[0]);
  const fecha = yo.plan_pago_hasta
    ? new Date(yo.plan_pago_hasta).toLocaleDateString(locale, { day: "numeric", month: "long" })
    : null;

  return (
    <section ref={seccion} className="form cuenta-plan" aria-labelledby={`${base}-titulo`}>
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
          {actual && (
            <p className="cuenta-plan-nota">
              {fecha && t("planes_renueva", { fecha })} {t("planes_pro_dos_ligas")}
            </p>
          )}
          {proDelAdmin && <p className="cuenta-plan-nota">{t("planes_pro_admin")}</p>}

          {actual && (
            <>
              <h3 className="cuenta-plan-subtitulo">{t("planes_cambiar_a")}</h3>
              <fieldset className="cuenta-plan-opciones">
                <legend className="sr-only">{t("planes_cambiar_a")}</legend>
                {PRO.filter((p) => p !== actual).map((p) => (
                  <label key={p} className="cuenta-plan-opcion">
                    <input type="radio" name="duracion" value={p} checked={elegido === p}
                      onChange={() => setElegido(p)} />
                    <span className="cuenta-plan-fila-texto">
                      <span className="cuenta-plan-fila-nombre">{nombre(p)}</span>
                      <span className="cuenta-plan-fila-detalle">
                        {t(`planes_${CLAVE[p]}_cambio` as Parameters<typeof t>[0])}
                      </span>
                    </span>
                    <span className="cuenta-plan-precio">
                      {t(`planes_${CLAVE[p]}_precio` as Parameters<typeof t>[0])}
                    </span>
                  </label>
                ))}
              </fieldset>
              <p className="cuenta-plan-nota">{t("planes_cambio_cobro")}</p>
              <button type="button" className="btn pri wide" disabled={!elegido || cambiando}
                onClick={cambiar}>
                {cambiando ? t("planes_cambiando")
                  : elegido ? t("planes_cambiar_boton", { plan: nombre(elegido) })
                  : t("planes_cambiar_elige")}
              </button>
              {pedido && <p className="nota" role="status">{t("planes_cambio_pedido")}</p>}
            </>
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
