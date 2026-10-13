"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { convertirFrase, getMercado, type Catalogo, type ConvertirResultado,
  type InterpretacionIdea, type Mercado, type ReglaElegida, type EstiloCatalogo } from "@/lib/liga/api";
import { miles } from "@/lib/liga/format";
import { browserLocale, localeTag } from "@/i18n/locale";
import { Boton } from "../_ui";

type Cambios = Partial<Omit<EstiloCatalogo, "clave">> & { interpretacion?: InterpretacionIdea[] };
type Props = {
  catalogo: Catalogo; idea: string; reglas: ReglaElegida[]; estrategiaId?: string;
  quedan: number | null; alCambiarQuedan: (n: number) => void;
  alCambiarIdea: (idea: string) => void; alCambiarOcupado: (ocupado: boolean) => void;
  actualizarB: (cambios: Cambios) => void; irReglas: () => void;
};
const MARCAS = { exacta: "✓", aproximada: "≈", no_disponible: "–" };

export function PasoIdea({ catalogo, idea, reglas, estrategiaId, quedan, alCambiarQuedan,
  alCambiarIdea, alCambiarOcupado, actualizarB, irReglas }: Props) {
  const t = useTranslations();
  const [mercado, setMercado] = useState<Mercado | null>(null);
  const [cargando, setCargando] = useState(true);
  const [errorMercado, setErrorMercado] = useState<string | null>(null);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [propuesta, setPropuesta] = useState<ConvertirResultado | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let vigente = true;
    void getMercado().then(r => {
      if (!vigente) return;
      if (typeof r === "string") setErrorMercado(r); else setMercado(r);
      setCargando(false);
    });
    return () => { vigente = false; };
  }, []);
  async function proponer() {
    if (!idea.trim() || ocupado) return;
    setOcupado(true); alCambiarOcupado(true); setError(null); setPropuesta(null);
    try {
      const r = await convertirFrase(idea.trim(), estrategiaId);
      if (typeof r === "string") setError(r);
      else { setPropuesta(r); alCambiarQuedan(r.quedan); }
    } catch { setError(t("builder_idea_error")); }
    finally { setOcupado(false); alCambiarOcupado(false); }
  }
  function usarPropuesta() {
    if (!propuesta) return;
    const nuevas = propuesta.reglas.filter(r => catalogo.reglas.some(c => c.clave === r.clave)
      && !reglas.some(e => e.clave === r.clave));
    actualizarB({ reglas: [...reglas, ...nuevas], interpretacion: propuesta.interpretacion });
    irReglas();
  }
  return <div className="paso-idea">
    <div className="field">
      <label className="lbl" htmlFor="idea-frase">{t("builder_idea_palabras")}</label>
      <textarea id="idea-frase" className="inp" rows={3} maxLength={300}
        placeholder={t("builder_idea_placeholder")} value={idea} disabled={ocupado}
        onChange={e => { alCambiarIdea(e.target.value); setPropuesta(null); setError(null); }} />
      <Boton variante="principal" disabled={ocupado || !idea.trim() || quedan === 0} onClick={proponer}>
        {t(ocupado ? "builder_idea_proponiendo" : "builder_idea_proponer")}</Boton>
      <p className="fine" role="status">{quedan === null ? t("builder_idea_cupo_desconocido")
        : t("builder_idea_quedan", { count: Math.max(0, quedan) })}</p>
      <p className="fine">{t("builder_convert_idea_notice")}</p>
      {error && <p role="alert">{error}</p>}
      {propuesta && <section aria-label={t("builder_idea_interpretation")}>
        <ul className="idea-propuesta">{propuesta.interpretacion.map((item, i) => <li key={i}>
          <span aria-label={t(`builder_idea_${item.tipo}`)}>{MARCAS[item.tipo]}</span>
          <div>{item.intencion}<p className="fine">{item.motivo}</p></div>
        </li>)}</ul>
        {propuesta.reglas.length > 0 && <Boton variante="principal" onClick={usarPropuesta}>
          {t("builder_idea_usar")}</Boton>}
      </section>}
    </div>
    <h3>{t("builder_idea_estilos")}</h3>
    {cargando ? <p role="status">{t("builder_idea_cargando")}</p>
      : errorMercado ? <p role="alert">{errorMercado}</p>
      : !mercado && <p role="status">{t("builder_idea_sin_mercado")}</p>}
    <div className="idea-estilos">{catalogo.estilos.map(estilo => {
      const expandido = abierto === estilo.clave;
      const recuento = mercado?.estilos[estilo.clave]?.pasan;
      return <div className="idea-estilo" key={estilo.clave}>
        <button type="button" className="idea-estilo-abrir" aria-expanded={expandido}
          aria-controls={`estilo-${estilo.clave}`} onClick={() => setAbierto(expandido ? null : estilo.clave)}>
          <span><strong>{t(`builder_style_${estilo.clave}_titulo`)}</strong>
            <span className="fine">{t(`builder_style_${estilo.clave}_descripcion`)}</span></span>
          <span className="idea-recuento">{recuento === undefined ? t("builder_idea_sin_recuento")
            : <><b>{miles(recuento)}</b>{t("builder_idea_pasan")}</>}</span>
        </button>
        {expandido && <div id={`estilo-${estilo.clave}`} className="idea-estilo-detalle">
          <ul>{estilo.reglas.map(r => {
            const def = catalogo.reglas.find(c => c.clave === r.clave);
            return <li key={r.clave}>{def?.titulo ?? r.clave}
              {Object.entries(r.params).map(([k, v]) => <span key={k}>{" · "}
                {def?.parametros.find(p => p.nombre === k)?.etiqueta ?? k}{": "}
                {typeof v === "number" ? new Intl.NumberFormat(localeTag(browserLocale())).format(v) : String(v)}</span>)}
            </li>;
          })}</ul>
          <p><span className="fine">{t("builder_idea_mira")}</span>{" "}{t(`builder_style_${estilo.clave}_mira`)}</p>
          <p><span className="fine">{t("builder_idea_cuesta")}</span>{" "}{t(`builder_style_${estilo.clave}_cuesta`)}</p>
          <Boton variante="principal" onClick={() => {
            const { clave: _clave, ...receta } = estilo;
            void _clave;
            actualizarB({ ...structuredClone(receta), interpretacion: [] }); irReglas();
          }}>{t("builder_idea_empezar")}</Boton>
        </div>}
      </div>;
    })}</div>
    <button type="button" className="link" onClick={() => {
      actualizarB({ reglas: [], interpretacion: [] }); irReglas();
    }}>{t("builder_idea_cero")}</button>
  </div>;
}
