"use client";

// El premio anual a la vista de todos, sin nombres: cuántas cuentas optan, qué hace falta para
// activarlo y qué se repartiría. Sin nada que enseñar (`visible` falso), no pinta nada.

import { useLocale, useTranslations } from "next-intl";
import { normalizeLocale } from "@/i18n/locale";
import { getPremio } from "@/lib/liga/api";
import { useCache } from "@/lib/liga/cache";

export function PremioAnual() {
  const t = useTranslations();
  const locale = normalizeLocale(useLocale()) ?? "es";
  const { datos: premio } = useCache("premio-publico", getPremio);
  if (!premio || typeof premio === "string" || !premio.visible) return null;

  const numero = (n: number) => new Intl.NumberFormat(locale).format(n);
  const importes = (escalon: number) => (premio.importes[String(escalon)] ?? []).map(numero).join(", ");
  const minimo = numero(premio.umbral_basico ?? 0);

  let texto: string;
  if (premio.calculado) {
    texto = premio.escalon === 0
      ? t("league_premio_cerrado_sin", { cuentas: numero(premio.cuentas), minimo })
      : t("league_premio_cerrado_con", { cuentas: numero(premio.cuentas), importes: importes(premio.escalon) });
  } else if (premio.escalon === 0) {
    texto = t("league_premio_sin_activar", { cuentas: numero(premio.cuentas), minimo });
  } else if (premio.escalon === 1) {
    texto = t("league_premio_reducido", {
      cuentas: numero(premio.cuentas), importes: importes(1),
      completo: numero(premio.umbral_completo ?? 0), importes_completo: importes(2),
    });
  } else {
    texto = t("league_premio_completo", { cuentas: numero(premio.cuentas), importes: importes(2) });
  }

  return (
    <section className="sec" aria-label={t("league_premio_titulo")}>
      <h3 className="sec-t">{t("league_premio_titulo")}</h3>
      <p className="meta">{texto}</p>
      <p className="fine">{t("league_premio_reglas")}</p>
    </section>
  );
}
