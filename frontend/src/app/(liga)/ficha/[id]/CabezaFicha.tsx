"use client";

// Cabeza de la ficha (maqueta `vistaFicha`): escudo, nombre, quién la firma y la cifra de la semana en curso.
// Sin mercado todavía, cae a la última jornada cerrada con resultado.

import { useRef } from "react";
import { useLocale, useTranslations } from "next-intl";
import { normalizeLocale } from "@/i18n/locale";
import { Escudo, escudoCasa } from "../../_ui";
import { useTituloEnCabecera } from "../../_ui/useTituloEnCabecera";
import { claseDe } from "../../liga/ListaRanking";
import type { Ficha } from "@/lib/liga/api";
import { porcentaje, signo } from "@/lib/liga/format";

const ESPACIO_DURO = " ";

export function CabezaFicha({ ficha }: { ficha: Ficha }) {
  const t = useTranslations();
  const locale = normalizeLocale(useLocale()) ?? "es";
  const titulo = useRef<HTMLHeadingElement>(null);
  useTituloEnCabecera(titulo);

  const subtitulo = ficha.casa ? t("ficha_de_la_casa")
    : ficha.es_dueno ? t("strategies_yours")
      : ficha.autor ? t("strategies_by_author", { author: ficha.autor })
        : t("strategies_retired");

  const ultima = ficha.jornadas.length ? ficha.jornadas[ficha.jornadas.length - 1] : null;
  const mercado = ficha.mercado;
  const cerrada = [...ficha.jornadas].reverse().find((j) => j.rentabilidad != null) ?? null;

  let cifra: { etiqueta: string; valor: number; sp: number | null } | null = null;
  if (mercado?.rentabilidad != null) {
    cifra = {
      etiqueta: t("ficha_semana_jornada", { round: ultima?.numero ?? 0, total: ultima?.jornada_total ?? 0 }),
      valor: mercado.rentabilidad, sp: mercado.sp500,
    };
  } else if (cerrada && cerrada.rentabilidad != null) {
    cifra = {
      etiqueta: t("ficha_ultima_jornada", { round: cerrada.numero, total: cerrada.jornada_total }),
      valor: cerrada.rentabilidad, sp: cerrada.sp500,
    };
  }
  const diff = cifra == null || cifra.sp == null ? null
    : mercado?.rentabilidad != null && mercado.diferencia != null ? mercado.diferencia : cifra.valor - cifra.sp;
  const clase = claseDe(diff);

  return (
    <>
      <div className="fi-cabeza">
        <Escudo valor={ficha.casa ? escudoCasa(ficha.casa) : ficha.escudo} casa={ficha.casa} baldosa tamano={56}
          etiqueta={t("strategies_crest", { name: ficha.nombre })} />
        <div>
          <h1 ref={titulo}>{ficha.nombre}</h1>
          <p>{subtitulo}</p>
        </div>
      </div>
      {cifra && (
        <div className="fi-cifra">
          <small>{cifra.etiqueta}</small>
          <b>{porcentaje(cifra.valor, 1, locale)}</b>
          {diff != null && cifra.sp != null && (
            <p>{t.rich("ficha_frente_sp", {
              diff: `${signo(diff, 1, locale)}${ESPACIO_DURO}pp`,
              sp: porcentaje(cifra.sp, 1, locale),
              dif: (c) => <span className={`${clase || "igual"}-t`}>{c}</span>,
            })}</p>
          )}
        </div>
      )}
    </>
  );
}
