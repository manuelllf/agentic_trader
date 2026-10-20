"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import type { Aviso, ListaAvisos } from "@/lib/liga/api";
import type { Locale } from "@/i18n/locale";
import { cuando, textoAviso } from "./textoAviso";

// Tres avisos antes de desplegar la lista.
const VISIBLES = 3;

export function PanelAvisos({ lista, enBarra, onIr, onResumen }: { lista: ListaAvisos; enBarra: boolean; onIr: () => void; onResumen: (a: Aviso) => void }) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const [abierto, setAbierto] = useState(false);
  const filas = lista.avisos.map(a => ({ a, txt: textoAviso(a, t, locale) })).filter((f): f is typeof f & { txt: NonNullable<typeof f.txt> } => f.txt !== null);
  const visibles = abierto ? filas : filas.slice(0, VISIBLES);
  return <section className={`panel-avisos${enBarra ? " en-barra" : ""}${abierto ? " abierto" : ""}`} aria-label={t("avisos_titulo")}>
    <div className="panel-avisos-h"><b>{t("avisos_titulo")}</b>{lista.sin_leer > 0 && <span className="num">{t("avisos_nuevos", { n: lista.sin_leer })}</span>}</div>
    {filas.length === 0 ? <p className="panel-avisos-vacio">{t("avisos_vacio")}</p> :
      <div className="panel-avisos-lista">{visibles.map(({ a, txt }) => {
        const dentro = <><time className="num">{cuando(a.creado, new Date(), locale)}</time><b>{txt.titulo}</b><p>{txt.texto}</p><span className="ir">{t(`avisos_ir_${txt.destino.ir}`)}</span></>;
        return txt.destino.href
          ? <Link key={a.id} href={txt.destino.href} className={`aviso${a.leido ? "" : " nuevo"}`} onClick={onIr}>{dentro}</Link>
          : <button key={a.id} type="button" className={`aviso${a.leido ? "" : " nuevo"}`} onClick={() => onResumen(a)}>{dentro}</button>;
      })}</div>}
    <div className="panel-avisos-p">
      {filas.length > VISIBLES ? <button type="button" className="mas" aria-expanded={abierto} onClick={() => setAbierto(!abierto)}>{abierto ? t("avisos_ver_menos") : t("avisos_ver_mas", { n: filas.length - VISIBLES })}</button> : <span />}
      <Link href="/cuenta/avisos" className="como" onClick={onIr}>{t("avisos_como")}</Link>
    </div>
  </section>;
}
