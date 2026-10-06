"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { normalizeLocale } from "@/i18n/locale";
import { getNotasEmpresa } from "@/lib/liga/api";
import { useCache } from "@/lib/liga/cache";
import { fecha } from "@/lib/liga/format";

const NOTAS = [
  ["negocio", "strategies_weight_business"],
  ["precio", "strategies_weight_price"],
  ["deuda", "strategies_weight_debt"],
  ["pronto", "strategies_weight_catalyst"],
] as const;

/** Las cuatro notas (0 a 9) con las que se eligió la empresa en la foto de la jornada. */
export function NotasEmpresa({ fichaId, ticker }: { fichaId: string; ticker: string }) {
  const t = useTranslations();
  const locale = normalizeLocale(useLocale()) ?? "es";
  const { datos, cargando } = useCache(`notas:${fichaId}:${ticker}`, () => getNotasEmpresa(fichaId, ticker));
  if (cargando && !datos) return null;
  if (!datos || typeof datos === "string") return null;
  return (
    <section className="sec" aria-label={t("strategies_company_notes")}>
      <h3 className="sec-t">{t("strategies_company_notes")}</h3>
      {datos.notas ? <>
        {NOTAS.map(([clave, etiqueta]) => {
          const valor = Math.max(0, Math.min(9, Math.round(Number(datos.notas?.[clave] ?? 0))));
          return (
            <div className="nota-empresa" key={clave} role="group" aria-label={t(etiqueta)}>
              <b>{t(etiqueta)}</b>
              <span className="num n">{valor}<small> / 9</small></span>
              <span className="nota-esc" aria-hidden="true">
                {Array.from({ length: 9 }, (_, i) => <i key={i} className={i < valor ? "on" : undefined} />)}
              </span>
            </div>
          );
        })}
        <p className="fine">{t("strategies_company_notes_source", { date: fecha(datos.dia, new Date(), locale), round: datos.jornada })}</p>
      </> : <p className="fine">{t("strategies_company_notes_none")}</p>}
      <Link className="enlace-fila" href="/como-funciona">
        <span>{t("strategies_company_notes_how")}</span><span aria-hidden="true">›</span>
      </Link>
    </section>
  );
}
