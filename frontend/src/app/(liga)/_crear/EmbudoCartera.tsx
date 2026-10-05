"use client";

import { useLocale, useTranslations } from "next-intl";
import { miles } from "@/lib/liga/format";

/** De la foto disponible a la cartera: cuántas empresas quedan en cada paso y qué peso recibe cada una. */
export function EmbudoCartera({ evaluadas, cumplen, seleccionadas, maximo, reparto, porSector }: {
  evaluadas: number | null; cumplen: number | null; seleccionadas: number | null;
  maximo: number; reparto: string; porSector: number;
}) {
  const t = useTranslations();
  const idioma = useLocale() === "en" ? "en" : "es";
  const cifra = (n: number | null) => (n == null ? t("builder_pending") : miles(n, idioma));
  // Raíz cuadrada: con miles de empresas arriba y unas pocas abajo, una escala lineal dejaría el final invisible.
  const ancho = (n: number | null) =>
    `${evaluadas && n != null ? Math.max(5, Math.round(Math.sqrt(n / evaluadas) * 100)) : 5}%`;
  const fuera = evaluadas != null && cumplen != null ? Math.max(evaluadas - cumplen, 0) : null;
  const entran = seleccionadas ?? maximo;
  const parte = reparto === "igual" && entran > 0 ? `${Math.round(100 / entran)} %` : "+";

  return (
    <ol className="embudo">
      <li className="embudo-paso">
        <b>{cifra(evaluadas)}</b><span>{t("builder_companies_in_snapshot")}</span>
        <i style={{ width: ancho(evaluadas) }} />
      </li>
      <li className="embudo-union" aria-hidden="true">
        {fuera != null ? t("builder_funnel_out", { count: miles(fuera, idioma) }) : ""}
      </li>
      <li className="embudo-paso">
        <b>{cifra(cumplen)}</b><span>{t("builder_pass_rules")}</span>
        <i style={{ width: ancho(cumplen) }} />
      </li>
      <li className="embudo-union" aria-hidden="true">{t("builder_funnel_ranked")}</li>
      <li className="embudo-paso final">
        <b>{seleccionadas != null ? miles(seleccionadas, idioma) : t("builder_up_to", { count: maximo })}</b>
        <span>
          {t(seleccionadas != null ? "builder_form_portfolio" : "builder_companies_max")}: {t("builder_best_scores")}
          {porSector === 0 ? "" : `, ${t("builder_sector_max", { count: porSector })}`}
        </span>
        <i style={{ width: ancho(seleccionadas ?? maximo) }} />
      </li>
      <li className="embudo-paso cierre">
        <b>{parte}</b><span>{t(reparto === "igual" ? "builder_for_each" : "builder_weight_best_scores")}</span>
      </li>
    </ol>
  );
}
