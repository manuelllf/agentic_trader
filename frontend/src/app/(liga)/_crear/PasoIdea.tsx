"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { convertirFrase, enviarIntencion, getMercado, type Catalogo, type ConvertirResultado,
  type InterpretacionIdea, type Mercado, type ReglaElegida, type EstiloCatalogo } from "@/lib/liga/api";
import { miles } from "@/lib/liga/format";
import { normalizeLocale } from "@/i18n/locale";
import { Hoja } from "../_ui/Hoja";
import { AvisoCrear, CabGrupo, Chevron } from "./piezas";
import { valorRegla } from "./reglaTexto";

type Cambios = Partial<Omit<EstiloCatalogo, "clave">> & { interpretacion?: InterpretacionIdea[] };
type Props = {
  catalogo: Catalogo; idea: string; reglas: ReglaElegida[]; estrategiaId?: string;
  quedan: number | null; alCambiarQuedan: (n: number) => void;
  alCambiarIdea: (idea: string) => void; alCambiarOcupado: (ocupado: boolean) => void;
  actualizarB: (cambios: Cambios) => void; irReglas: () => void;
};
const MARCAS = { exacta: "✓", aproximada: "≈", no_disponible: "–" };

/** Lo que el conversor entendió, una celda por intención, y el botón para quedarse con sus reglas. */
export function Propuesta({ propuesta, alUsar }: { propuesta: ConvertirResultado; alUsar: () => void }) {
  const t = useTranslations();
  return <section className="cr-fundido" aria-label={t("builder_idea_interpretation")}>
    <CabGrupo>{t("builder_idea_entendido")}</CabGrupo>
    <div className="cr-grupo">{propuesta.interpretacion.map((item, i) => <div className="cr-celda con-marca" key={i}>
      <span className={`cr-marca ${item.tipo}`} aria-label={t(`builder_idea_${item.tipo}`)}>{MARCAS[item.tipo]}</span>
      <span className="t"><b>{item.intencion}</b><small>{item.motivo}</small></span>
    </div>)}</div>
    <p className="cr-pie">{t("builder_idea_leyenda")}</p>
    {propuesta.reglas.length > 0 && <div className="cr-bloque-boton">
      <button type="button" className="cr-boton" onClick={alUsar}>{t("builder_idea_usar")}</button></div>}
  </section>;
}

/** Esqueleto de la propuesta mientras el conversor trabaja: marca y dos líneas por intención. */
function EsqueletoPropuesta() {
  return <div className="cr-grupo cr-fundido" aria-hidden="true" style={{ marginTop: 20 }}>{[0, 1, 2].map(i => <div className="cr-celda con-marca" key={i}>
    <span className="cr-esq" style={{ width: 24, height: 24, borderRadius: "50%" }} />
    <span className="t"><span className="cr-esq" style={{ width: "60%", height: 15 }} />
      <span className="cr-esq" style={{ width: "85%", height: 13, marginTop: 6 }} /></span>
  </div>)}</div>;
}

export function PasoIdea({ catalogo, idea, reglas, estrategiaId, quedan, alCambiarQuedan,
  alCambiarIdea, alCambiarOcupado, actualizarB, irReglas }: Props) {
  const t = useTranslations();
  const locale = normalizeLocale(useLocale()) ?? "es";
  const [mercado, setMercado] = useState<Mercado | null>(null);
  const [estiloAbierto, setEstiloAbierto] = useState<string | null>(null);
  const [propuesta, setPropuesta] = useState<ConvertirResultado | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [intencionAbierta, setIntencionAbierta] = useState(false);
  const [intencion, setIntencion] = useState("");
  const [enviandoIntencion, setEnviandoIntencion] = useState(false);
  const [errorIntencion, setErrorIntencion] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  async function enviar() {
    if (!intencion.trim() || enviandoIntencion) return;
    setEnviandoIntencion(true); setErrorIntencion(null);
    try {
      const resultado = await enviarIntencion(intencion.trim());
      if (resultado !== null) setErrorIntencion(resultado);
      else { setIntencion(""); setIntencionAbierta(false); setAviso(t("builder_intencion_ok")); }
    } finally { setEnviandoIntencion(false); }
  }
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
  function empezarCon(estilo: EstiloCatalogo) {
    const { clave: _clave, ...receta } = estilo;
    void _clave;
    setEstiloAbierto(null);
    actualizarB({ ...structuredClone(receta), interpretacion: [] });
    irReglas();
  }
  const estilo = catalogo.estilos.find(e => e.clave === estiloAbierto);
  const recuento = (clave: string) => mercado?.estilos[clave]?.pasan;

  return <div className="paso-idea">
    <div className="cr-grupo" style={{ marginTop: 16 }}>
      <textarea id="idea-frase" className="cr-area" rows={3} maxLength={300} aria-label={t("builder_idea_palabras")}
        placeholder={t("builder_idea_placeholder")} value={idea} disabled={ocupado}
        onChange={e => { alCambiarIdea(e.target.value); setPropuesta(null); setError(null); }} />
    </div>
    <div className="cr-fila-accion">
      <button type="button" className="cr-boton tinte auto" disabled={ocupado || !idea.trim() || quedan === 0} onClick={proponer}>
        {t(ocupado ? "builder_idea_proponiendo" : "builder_idea_proponer")}</button>
      {quedan !== null && <p className="cr-pie" role="status">{t("builder_idea_quedan", { count: Math.max(0, quedan) })}</p>}
    </div>
    {error && <p className="cr-pie mal" role="alert">{error}</p>}
    {ocupado && <EsqueletoPropuesta />}
    {propuesta && !ocupado && <Propuesta propuesta={propuesta} alUsar={usarPropuesta} />}

    <CabGrupo derecha={mercado ? t("builder_idea_pasan_hoy") : undefined}>{t("builder_idea_estilos")}</CabGrupo>
    <div className="cr-grupo">
      {catalogo.estilos.map(e => {
        const n = recuento(e.clave);
        return <button type="button" className="cr-celda idea-estilo" key={e.clave} aria-haspopup="dialog" onClick={() => setEstiloAbierto(e.clave)}>
          <span className="t"><b>{t(`builder_style_${e.clave}_titulo`)}</b><small>{t(`builder_style_${e.clave}_descripcion`)}</small></span>
          {n !== undefined ? <span className="valor ink num idea-recuento">{miles(n, locale)}</span> : <span />}
          <Chevron />
        </button>;
      })}
      <button type="button" className="cr-celda" onClick={() => { actualizarB({ reglas: [], interpretacion: [] }); irReglas(); }}>
        <span className="t"><b className="normal tinte">{t("builder_idea_cero")}</b></span>
      </button>
    </div>
    <p className="cr-pie"><button type="button" onClick={() => { setIntencionAbierta(true); setErrorIntencion(null); }}>{t("builder_intencion_abrir")}</button></p>

    <Hoja abierta={!!estilo} titulo={estilo ? t(`builder_style_${estilo.clave}_titulo`) : ""} cancelar={t("builder_cancelar")}
      accion={t("builder_empezar")} onAccion={() => estilo && empezarCon(estilo)} onCerrar={() => setEstiloAbierto(null)}>
      {estilo && <div className="cr-hoja-pad">
        {recuento(estilo.clave) !== undefined && <>
          <p className="cr-valor-gr num">{miles(recuento(estilo.clave)!, locale)}</p>
          <p className="cr-valor-sub">{t("builder_estilo_pasan", { total: miles(mercado!.n, locale) })}</p></>}
        <CabGrupo>{t("builder_estilo_reglas")}</CabGrupo>
        <div className="cr-grupo cr-reglas-estilo">{estilo.reglas.map(r => {
          const def = catalogo.reglas.find(c => c.clave === r.clave);
          return <div className="cr-celda" key={r.clave}><span className="t"><b className="normal">{def?.titulo ?? r.clave}</b></span>
            <span className="valor">{def ? valorRegla(def, r, catalogo.sectores ?? {}, t, locale) : ""}</span></div>;
        })}</div>
        <div className="cr-texto" style={{ margin: "20px 4px 0" }}>
          <p><b>{t("builder_idea_mira")}</b> {t(`builder_style_${estilo.clave}_mira`)}</p>
          <p><b>{t("builder_idea_cuesta")}</b> {t(`builder_style_${estilo.clave}_cuesta`)}</p>
        </div>
        <p className="cr-pie" style={{ margin: "16px 4px 0" }}>{t("builder_estilo_nota")}</p>
      </div>}
    </Hoja>

    <Hoja abierta={intencionAbierta} titulo={t("builder_intencion_titulo")} cancelar={t("builder_cancelar")}
      accion={t("builder_intencion_enviar")} accionDesactivada={enviandoIntencion || !intencion.trim()}
      onAccion={enviar} onCerrar={() => { setIntencionAbierta(false); setIntencion(""); setErrorIntencion(null); }}>
      <div className="cr-hoja-pad">
        <div className="cr-grupo" style={{ marginTop: 4 }}>
          <textarea id="idea-intencion-texto" className="cr-area" rows={3} maxLength={160} aria-label={t("builder_intencion_abrir")}
            aria-describedby="idea-intencion-ayuda" placeholder={t("builder_intencion_ejemplo")} value={intencion}
            disabled={enviandoIntencion} onChange={e => setIntencion(e.target.value)} />
        </div>
        {errorIntencion && <p className="cr-pie mal" role="alert">{errorIntencion}</p>}
        <p id="idea-intencion-ayuda" className="cr-pie"><span aria-live="polite">{intencion.length}/160</span> · {t("builder_intencion_ayuda")}</p>
      </div>
    </Hoja>
    {aviso && <AvisoCrear texto={aviso} onFin={() => setAviso(null)} />}
  </div>;
}
