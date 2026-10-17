"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { convertirFrase, getMercado, type Catalogo, type ConvertirResultado,
  type InterpretacionIdea, type Mercado, type ReglaElegida, type EstiloCatalogo } from "@/lib/liga/api";
import { miles } from "@/lib/liga/format";
import { normalizeLocale } from "@/i18n/locale";
import { Boton } from "../_ui";
import { textoRegla } from "./reglaTexto";

type Cambios = Partial<Omit<EstiloCatalogo, "clave">> & { interpretacion?: InterpretacionIdea[] };
type Props = {
  catalogo: Catalogo; idea: string; reglas: ReglaElegida[]; estrategiaId?: string;
  quedan: number | null; alCambiarQuedan: (n: number) => void;
  alCambiarIdea: (idea: string) => void; alCambiarOcupado: (ocupado: boolean) => void;
  actualizarB: (cambios: Cambios) => void; irReglas: () => void;
};
const MARCAS = { exacta: "✓", aproximada: "≈", no_disponible: "-" };

/** Lo que el conversor entendió, línea a línea, y el botón para quedarse con sus reglas. */
export function Propuesta({ propuesta, alUsar }: { propuesta: ConvertirResultado; alUsar: () => void }) {
  const t = useTranslations();
  return <section className="tarjeta propuesta" aria-label={t("builder_idea_interpretation")}>
    <ul className="idea-propuesta">{propuesta.interpretacion.map((item, i) => <li key={i}>
      <span className={`marca marca-${item.tipo}`} aria-label={t(`builder_idea_${item.tipo}`)}>{MARCAS[item.tipo]}</span>
      <div><b>{item.intencion}</b><span>{item.motivo}</span></div>
    </li>)}</ul>
    {propuesta.reglas.length > 0 && <Boton variante="principal" ancho="completo" onClick={alUsar}>
      {t("builder_idea_usar")}</Boton>}
  </section>;
}

export function PasoIdea({ catalogo, idea, reglas, estrategiaId, quedan, alCambiarQuedan,
  alCambiarIdea, alCambiarOcupado, actualizarB, irReglas }: Props) {
  const t = useTranslations();
  const locale = normalizeLocale(useLocale()) ?? "es";
  const [mercado, setMercado] = useState<Mercado | null>(null);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [propuesta, setPropuesta] = useState<ConvertirResultado | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let vigente = true;
    // Sin recuento, los estilos se eligen igual: no hace falta avisar de ello.
    void getMercado().then(r => { if (vigente && r && typeof r !== "string") setMercado(r); });
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
    <div className="paso-bloque">
      <label className="lbl" htmlFor="idea-frase">{t("builder_idea_palabras")}</label>
      <textarea id="idea-frase" className="inp" rows={3} maxLength={300}
        placeholder={t("builder_idea_placeholder")} value={idea} disabled={ocupado}
        onChange={e => { alCambiarIdea(e.target.value); setPropuesta(null); setError(null); }} />
      <div className="paso-accion">
        <Boton variante="principal" disabled={ocupado || !idea.trim() || quedan === 0} onClick={proponer}>
          {t(ocupado ? "builder_idea_proponiendo" : "builder_idea_proponer")}</Boton>
        {quedan !== null && <span className="fine" role="status">{t("builder_idea_quedan", { count: Math.max(0, quedan) })}</span>}
      </div>
      {error && <p className="aviso" role="alert">{error}</p>}
      {propuesta && <Propuesta propuesta={propuesta} alUsar={usarPropuesta} />}
    </div>
    <section className="paso-bloque" aria-labelledby="idea-estilos">
      <h2 id="idea-estilos" className="sec-t">{t("builder_idea_estilos")}</h2>
      <div className="idea-estilos">{catalogo.estilos.map(estilo => {
        const expandido = abierto === estilo.clave;
        const recuento = mercado?.estilos[estilo.clave]?.pasan;
        return <div className={`idea-estilo${expandido ? " abierto" : ""}`} key={estilo.clave}>
          <button type="button" className="idea-estilo-abrir" aria-expanded={expandido}
            aria-controls={`estilo-${estilo.clave}`} onClick={() => setAbierto(expandido ? null : estilo.clave)}>
            <span className="idea-estilo-texto"><b>{t(`builder_style_${estilo.clave}_titulo`)}</b>
              <span>{t(`builder_style_${estilo.clave}_descripcion`)}</span></span>
            {recuento !== undefined && <span className="idea-recuento num"><b>{miles(recuento, locale)}</b>{t("builder_idea_pasan")}</span>}
          </button>
          {expandido && <div id={`estilo-${estilo.clave}`} className="idea-estilo-detalle">
            <ul className="idea-chips">{estilo.reglas.map(r => {
              const def = catalogo.reglas.find(c => c.clave === r.clave);
              return <li key={r.clave} className="chip">{def ? textoRegla(def, r, catalogo.sectores ?? {}, t, locale) : r.clave}</li>;
            })}</ul>
            <p><b>{t("builder_idea_mira")}</b> {t(`builder_style_${estilo.clave}_mira`)}</p>
            <p><b>{t("builder_idea_cuesta")}</b> {t(`builder_style_${estilo.clave}_cuesta`)}</p>
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
    </section>
  </div>;
}
