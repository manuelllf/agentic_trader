"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { pasanConRoe, type MercadoAprender } from "@/lib/aprender";
import { miles } from "@/lib/liga/format";

export function DeslizadorRoe({ mercado }: { mercado: MercadoAprender }) {
  const t = useTranslations();
  const locale = useLocale() === "en" ? "en" : "es";
  const [umbral, setUmbral] = useState(mercado.roe.defecto);
  const pasan = pasanConRoe(mercado, umbral);
  return <>
    <div className="apr-regla">
      <div className="apr-regla-cab"><b>{t("learn_g2_regla")}</b><span className="apr-valor">{t("learn_g2_valor", { umbral })}</span></div>
      <input type="range" min={mercado.roe.minimo} max={mercado.roe.maximo} step={mercado.roe.paso} value={umbral}
        aria-label={t("learn_g2_deslizador_aria")} onChange={e => setUmbral(Number(e.target.value))} />
      <div className="apr-escala"><span>{t("learn_g2_valor", { umbral: mercado.roe.minimo })}</span><span>{t("learn_g2_valor", { umbral: mercado.roe.maximo })}</span></div>
      <div className="apr-recuento"><b className="num">{pasan === null ? "" : miles(pasan, locale)}</b><span>{t("learn_g2_pasan", { umbral, total: miles(mercado.total, locale) })}</span></div>
    </div>
    <p className="apr-fuente">{t("learn_g2_fuente")}</p>
  </>;
}
