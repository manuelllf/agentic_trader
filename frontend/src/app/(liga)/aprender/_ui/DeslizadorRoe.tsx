"use client";

import { useState, type CSSProperties } from "react";
import { useLocale, useTranslations } from "next-intl";
import { pasanConRoe, type MercadoAprender } from "@/lib/aprender";
import { miles } from "@/lib/liga/format";

export function DeslizadorRoe({ mercado }: { mercado: MercadoAprender }) {
  const t = useTranslations();
  const locale = useLocale() === "en" ? "en" : "es";
  const [umbral, setUmbral] = useState(mercado.roe.defecto);
  const pasan = pasanConRoe(mercado, umbral);
  const { minimo, maximo, paso } = mercado.roe;
  const p = maximo > minimo ? ((umbral - minimo) / (maximo - minimo)) * 100 : 0;
  return <>
    <ul className="cu-grupo"><li><div className="pg-regla">
      <div className="pg-regla-cab"><b>{t("learn_g2_regla")}</b><span>{t("learn_g2_valor", { umbral })}</span></div>
      <input type="range" min={minimo} max={maximo} step={paso} value={umbral} style={{ "--p": `${p}%` } as CSSProperties}
        aria-label={t("learn_g2_deslizador_aria")} onChange={e => setUmbral(Number(e.target.value))} />
      <div className="escala"><span>{t("learn_g2_valor", { umbral: minimo })}</span><span>{t("learn_g2_valor", { umbral: maximo })}</span></div>
      <div className="recuento"><b>{pasan === null ? "" : miles(pasan, locale)}</b>{t("learn_g2_pasan", { umbral, total: miles(mercado.total, locale) })}</div>
    </div></li></ul>
    <p className="cu-pie">{t("learn_g2_fuente")}</p>
  </>;
}
