"use client";

import type { ReactNode, Ref } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { PreviewSeleccion } from "@/lib/liga/api";
import { miles } from "@/lib/liga/format";

export type PropsRevisar = {
  preview: PreviewSeleccion | null; pesos: Record<string, number>;
  nEmpresas: number; reparto: string; maxPorSector: number;
  nombre: string; cambiarNombre: (nombre: string) => void;
  nombreRef?: Ref<HTMLInputElement>; children?: ReactNode;
};

export function PasoRevisar(p: PropsRevisar) {
  const t = useTranslations(), idioma = useLocale() === "en" ? "en" : "es";
  const reglas = [...(p.preview?.por_regla ?? [])].sort((a, b) =>
    Number(["tamano", "grandes", "medianas", "pequenas"].includes(b.clave)) -
    Number(["tamano", "grandes", "medianas", "pequenas"].includes(a.clave)));
  const detalles = reglas.map(r => r.detalle).filter(Boolean);
  const lista = detalles.reduce((texto, detalle, i) => i === 0 ? detalle :
    t("builder_revisar_union", { left: texto, right: detalle, last: i === detalles.length - 1 ? "yes" : "no" }), "");
  const notas = ["negocio", "precio", "deuda", "pronto"];
  const equilibrado = notas.every(k => (p.pesos[k] ?? 0) === (p.pesos[notas[0]] ?? 0));
  const preferencia = equilibrado ? "equilibrado" : notas.reduce((mejor, k) =>
    (p.pesos[k] ?? 0) > (p.pesos[mejor] ?? 0) ? k : mejor, notas[0]);
  const cifra = (n: number | null | undefined) => n == null ? t("builder_pending") : miles(n, idioma);
  const etapas = [
    { n: p.preview?.evaluadas, clave: "mercado" },
    { n: p.preview?.cumplen_reglas, clave: "cumplen" },
    { n: p.preview?.seleccionadas, clave: "entran" },
  ];
  return <div className="paso-revisar">
    <ol className="embudo">{etapas.map((e, i) => <li key={e.clave} className={`embudo-paso${i === 2 ? " final" : ""}`}>
      <b className="num">{cifra(e.n)}</b><span style={i === 2 ? { color: "var(--accent)" } : undefined}>{t(`builder_revisar_${e.clave}`)}</span>
      <i style={{ width: `${p.preview?.evaluadas && e.n != null ? Math.min(100, Math.max(5, Math.sqrt(e.n / p.preview.evaluadas) * 100)) : 5}%` }} />
    </li>)}</ol>
    <p className="field">{detalles.length ? t("builder_revisar_busca", { rules: lista }) : t("builder_revisar_sin_reglas")}{" "}
      {t(`builder_revisar_preferencia_${preferencia}`)}{" "}
      {t("builder_revisar_cartera", { count: miles(p.nEmpresas, idioma), allocation: p.reparto === "igual" ? "equal" : "score",
        limit: p.maxPorSector ? "yes" : "no", sector: p.maxPorSector })}
    </p>
    <div className="field">
      <label className="lbl" htmlFor="cName">{t("builder_revisar_nombre")}</label>
      <input ref={p.nombreRef} id="cName" className="inp" value={p.nombre} maxLength={28} autoComplete="off"
        placeholder={t("builder_revisar_placeholder")} aria-describedby="revisar-nombre-ayuda" onChange={e => p.cambiarNombre(e.target.value)} />
      <p id="revisar-nombre-ayuda" className="fine">{t("builder_revisar_nombre_ayuda")}</p>
    </div>
    {p.children}
  </div>;
}
