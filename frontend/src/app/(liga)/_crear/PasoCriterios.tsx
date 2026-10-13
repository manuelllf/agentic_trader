"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { InfoTip } from "@/components/InfoTip";
import type { Catalogo } from "@/lib/liga/api";
import { pesosCoherentes } from "@/lib/liga/receta";
import { Segmentado } from "../_ui";

const NOTAS: Record<string, { titulo: string; ayuda: string }> = {
  negocio: { titulo: "builder_fundamentals", ayuda: "builder_fundamentals_help" },
  precio: { titulo: "builder_valuation", ayuda: "builder_valuation_help" },
  deuda: { titulo: "builder_financial_strength", ayuda: "builder_financial_strength_help" },
  pronto: { titulo: "builder_near_term_catalyst", ayuda: "builder_near_term_catalyst_help" },
};
const PRESETS = ["equilibrado", "negocio", "precio", "solidez"];

export function PasoCriterios({ catalogo, pregunta, pesos, pro, actualizarB, children }: {
  catalogo: Catalogo; pregunta: string; pesos: Record<string, number>; pro: boolean;
  actualizarB: (cambios: { pregunta?: string; pesos: Record<string, number> }) => void;
  children?: ReactNode;
}) {
  const t = useTranslations();
  const claves = catalogo.pesos.claves.filter(k => k !== "pregunta" || pregunta.trim());
  const totalPesos = claves.reduce((total, k) => total + (pesos[k] ?? 0), 0);
  const exactos = claves.map(k => totalPesos ? (pesos[k] ?? 0) * 100 / totalPesos : 0);
  const porcentajes = exactos.map(Math.floor);
  // Reparte los restos para que el redondeo conserve el total de cien.
  const restos = exactos.map((v, i) => ({ i, resto: v - porcentajes[i] })).sort((a, b) => b.resto - a.resto);
  const faltan = totalPesos ? 100 - porcentajes.reduce((a, b) => a + b, 0) : 0;
  for (let i = 0; i < faltan; i++) porcentajes[restos[i].i]++;
  const preset = PRESETS.find(p => catalogo.presets[p] && catalogo.pesos.claves.every(k =>
    (pesos[k] ?? 0) === (catalogo.presets[p][k] ?? 0))) ?? "";

  return <>
    <div className="field pregunta-propia lenguaje-natural">
      <label className="lbl" htmlFor="cQ">{t("builder_question")} <span>{t("builder_question_optional")}</span></label>
      <textarea id="cQ" className="inp" maxLength={160} placeholder={t("builder_question_example")}
        value={pregunta} onChange={e => actualizarB({ pregunta: e.target.value,
          pesos: pesosCoherentes(e.target.value, pesos).pesos })} />
      <p className="fine">{t(pro ? "builder_question_help_pro" : "builder_question_help_credits")}</p>
      <p className="fine">{t("builder_question_privacy_notice")}{" "}
        <a href="/como-funciona" target="_blank" rel="noopener noreferrer">{t("builder_how_question_used")}</a>
      </p>
    </div>
    <div className="field">
      <span className="lbl">{t("builder_criteria_title")}</span>
      <p className="fine">{t("builder_criteria_scores")}</p>
      <Segmentado etiquetaGrupo={t("builder_criteria_presets")} valor={preset}
        opciones={PRESETS.filter(p => catalogo.presets[p]).map(p => ({ valor: p, etiqueta: t(`builder_preset_${p}`) }))}
        onChange={p => actualizarB({ pesos: pesosCoherentes(pregunta, catalogo.presets[p]).pesos })} />
      <p className="fine">{t("builder_weight_zero_help")}</p>
      {claves.map((k, i) => <div className="wrow" key={k}>
        <label htmlFor={`w-${k}`}>{NOTAS[k] ? t(NOTAS[k].titulo) : catalogo.pesos.etiquetas[k]}
          {NOTAS[k] && <InfoTip text={t(NOTAS[k].ayuda)} />}</label>
        <span className="num">{porcentajes[i]}&nbsp;%</span>
        <input id={`w-${k}`} type="range" min={0} max={50} step={5} value={pesos[k] ?? 0}
          style={{ gridColumn: "1 / -1" }}
          onChange={e => actualizarB({ pesos: pesosCoherentes(pregunta, { ...pesos, [k]: Number(e.target.value) }).pesos })} />
      </div>)}
      {children}
    </div>
  </>;
}
