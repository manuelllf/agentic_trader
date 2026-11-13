"use client";

import { PREGUNTA_VISIBLE } from "@/lib/liga/funciones";
import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { Catalogo } from "@/lib/liga/api";
import { pesosCoherentes } from "@/lib/liga/receta";
import { Hoja } from "../_ui/Hoja";
import { SegmentoLiga } from "../liga/SegmentoLiga";
import { Deslizador, IconoInfo } from "./piezas";

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
  const [ayuda, setAyuda] = useState<string | null>(null);
  const claves = catalogo.pesos.claves.filter(k => k !== "pregunta" || pregunta.trim());
  const totalPesos = claves.reduce((total, k) => total + (pesos[k] ?? 0), 0);
  const exactos = claves.map(k => totalPesos ? (pesos[k] ?? 0) * 100 / totalPesos : 0);
  const porcentajes = exactos.map(Math.floor);
  // Reparte los restos para que el redondeo conserve el total de cien.
  const restos = exactos.map((v, i) => ({ i, resto: v - porcentajes[i] })).sort((a, b) => b.resto - a.resto);
  const faltan = totalPesos ? 100 - porcentajes.reduce((a, b) => a + b, 0) : 0;
  for (let i = 0; i < faltan; i++) porcentajes[restos[i].i]++;
  const preset = PRESETS.find(p => catalogo.presets[p] && catalogo.pesos.claves.every(k =>
    (pesos[k] ?? 0) === (catalogo.presets[p][k] ?? 0))) ?? null;
  const maximo = catalogo.pesos.maximo ?? 50, paso = catalogo.pesos.paso ?? 5;

  return <>
    <p className="cr-bajada">{t("builder_criterios_bajada")}</p>
    {PREGUNTA_VISIBLE && <>
      <div className="cr-grupo" style={{ marginTop: 16 }}>
        <textarea id="cQ" className="cr-area" maxLength={160} aria-label={t("builder_question")} placeholder={t("builder_question_example")}
          value={pregunta} onChange={e => actualizarB({ pregunta: e.target.value, pesos: pesosCoherentes(e.target.value, pesos).pesos })} />
      </div>
      <p className="cr-pie">{t(pro ? "builder_question_help_pro" : "builder_question_help_credits")}</p>
    </>}
    <SegmentoLiga className="cr-seg-pequeno criterios-presets" etiquetaGrupo={t("builder_criteria_presets")} valor={preset}
      opciones={PRESETS.filter(p => catalogo.presets[p]).map(p => ({ valor: p, etiqueta: t(`builder_preset_${p}`) }))}
      onChange={p => actualizarB({ pesos: pesosCoherentes(pregunta, catalogo.presets[p]).pesos })} />
    <div className="cr-grupo" style={{ marginTop: 16 }}>
      {claves.map((k, i) => (k !== "pregunta" || PREGUNTA_VISIBLE) && <div className="cr-bloque cr-peso" key={k}>
        <div className="cr-peso-cab">
          <span><label htmlFor={`w-${k}`}>{NOTAS[k] ? t(NOTAS[k].titulo) : catalogo.pesos.etiquetas[k]}</label>
            {NOTAS[k] && <> <button type="button" className="cr-info" aria-label={t("builder_criterio_info", { title: t(NOTAS[k].titulo) })}
              aria-haspopup="dialog" onClick={() => setAyuda(k)}><IconoInfo /></button></>}</span>
          <span className="num">{porcentajes[i]}&nbsp;%</span>
        </div>
        <Deslizador id={`w-${k}`} min={0} max={maximo} step={paso} valor={pesos[k] ?? 0}
          onChange={e => actualizarB({ pesos: pesosCoherentes(pregunta, { ...pesos, [k]: Number(e.target.value) }).pesos })} />
      </div>)}
    </div>
    {!totalPesos && <p className="cr-pie mal" role="alert">{t("builder_weight_zero_help")}</p>}
    {children}
    <Hoja abierta={!!ayuda} titulo={ayuda && NOTAS[ayuda] ? t(NOTAS[ayuda].titulo) : ""} accion={t("builder_listo")} onCerrar={() => setAyuda(null)}>
      {ayuda && NOTAS[ayuda] && <div className="cr-hoja-pad cr-texto" style={{ paddingBottom: 12 }}>
        <p>{t(NOTAS[ayuda].ayuda)}</p><p>{t("builder_criterio_escala")}</p></div>}
    </Hoja>
  </>;
}
