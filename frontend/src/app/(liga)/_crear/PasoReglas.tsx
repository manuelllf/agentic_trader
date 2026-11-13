"use client";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { convertirFrase, type Catalogo, type Mercado, type ParametroRegla, type PreviewSeleccion,
  type ReglaElegida, type ConvertirResultado, type InterpretacionIdea } from "@/lib/liga/api";
import { miles } from "@/lib/liga/format";
import { normalizeLocale } from "@/i18n/locale";
import { Hoja } from "../_ui/Hoja";
import { SegmentoLiga } from "../liga/SegmentoLiga";
import { Histograma, posicion } from "./Histograma";
import { Propuesta } from "./PasoIdea";
import { CabGrupo, Chevron, Deslizador, IconoLupa, IconoMas, Marca } from "./piezas";
import { MAXIMOS, PORCENTAJES, cifra, valorRegla } from "./reglaTexto";

type Props = {
  catalogo: Catalogo; mercado: Mercado | null; reglas: ReglaElegida[]; preview: PreviewSeleccion | null; estrategiaId?: string;
  quedan: number | null; alCambiarQuedan: (n: number) => void; alCambiarOcupado: (v: boolean) => void;
  actualizarB: (v: { reglas: ReglaElegida[]; interpretacion?: InterpretacionIdea[] }) => void;
};
const BANDAS = [{ clave: "pequenas", desde: 300, hasta: 2000 },
  { clave: "medianas", desde: 2000, hasta: 10000 }, { clave: "grandes", desde: 10000, hasta: 5000000 }];
type HojaAbierta = { tipo: "regla"; clave: string } | { tipo: "anadir" } | null;

const normalizar = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
// La API manda los decimales como texto («0.5»): todo se pasa a número antes de comparar.
const extremos = (p: ParametroRegla) => ({ min: Number(p.valores?.[0] ?? p.minimo ?? 0), max: Number(p.valores?.at(-1) ?? p.maximo ?? 100) });

export function PasoReglas({ catalogo, mercado, reglas, preview, estrategiaId, quedan,
  alCambiarQuedan, alCambiarOcupado, actualizarB }: Props) {
  const t = useTranslations();
  const locale = normalizeLocale(useLocale()) ?? "es";
  const [hoja, setHoja] = useState<HojaAbierta>(null);
  const total = preview?.evaluadas, cumplen = preview?.cumplen_reglas;

  return <div className="paso-reglas">
    <CabGrupo derecha={cumplen != null && total != null ? <span className="reglas-total" role="status">
      {t.rich("builder_reglas_cumplen", { n: miles(cumplen, locale), total: miles(total, locale), b: (c) => <b>{c}</b> })}</span> : undefined}>
      {t("builder_reglas_tuyas")}</CabGrupo>
    <div className="cr-grupo">
      {reglas.map(r => {
        const def = catalogo.reglas.find(c => c.clave === r.clave);
        if (!def) return null;
        return <button type="button" className="cr-celda regla" key={r.clave} aria-haspopup="dialog"
          onClick={() => setHoja({ tipo: "regla", clave: r.clave })}>
          <span className="t"><b className="normal">{def.titulo}</b></span>
          <span className="valor">{def.parametros.length ? valorRegla(def, r, catalogo.sectores, t, locale) : ""}</span><Chevron />
        </button>;
      })}
      <button type="button" className="cr-celda accion" aria-haspopup="dialog" onClick={() => setHoja({ tipo: "anadir" })}>
        <IconoMas /><span className="t"><b className="normal">{t("builder_add_rule_cell")}</b></span>
      </button>
    </div>
    {!reglas.length && <p className="cr-pie">{t("builder_no_rules_all_pass")}</p>}

    <HojaRegla catalogo={catalogo} reglas={reglas} preview={preview} mercado={mercado}
      clave={hoja?.tipo === "regla" ? hoja.clave : null} onCerrar={() => setHoja(null)} actualizarB={actualizarB} />
    <HojaAnadir abierta={hoja?.tipo === "anadir"} catalogo={catalogo} reglas={reglas} mercado={mercado}
      estrategiaId={estrategiaId} quedan={quedan} alCambiarQuedan={alCambiarQuedan} alCambiarOcupado={alCambiarOcupado}
      actualizarB={actualizarB} onCerrar={() => setHoja(null)}
      onAnadida={clave => setHoja({ tipo: "regla", clave })} />
  </div>;
}

/* ---------- Una regla: valor, histograma, deslizador, qué mide y quitar ---------- */
function HojaRegla({ catalogo, reglas, preview, mercado, clave, onCerrar, actualizarB }: {
  catalogo: Catalogo; reglas: ReglaElegida[]; preview: PreviewSeleccion | null; mercado: Mercado | null;
  clave: string | null; onCerrar: () => void; actualizarB: Props["actualizarB"];
}) {
  const t = useTranslations();
  const locale = normalizeLocale(useLocale()) ?? "es";
  const r = clave ? reglas.find(x => x.clave === clave) : undefined;
  const def = r ? catalogo.reglas.find(c => c.clave === r.clave) : undefined;
  const cambiar = (params: Record<string, unknown>) => r && actualizarB({
    reglas: reglas.map(x => x.clave === r.clave ? { ...x, params: { ...x.params, ...params } } : x) });

  let cuerpo = null;
  if (r && def) {
    const stats = mercado?.reglas?.[r.clave];
    const detalle = preview?.por_regla?.find(p => p.clave === r.clave);
    const primero = def.parametros[0];
    const fraccion = (nombre: string) => {
      const p = def.parametros.find(x => x.nombre === nombre)!;
      const { min, max } = extremos(p);
      return posicion(Number(r.params[nombre] ?? p.defecto), min, max, p.tipo === "lista");
    };
    const desde = r.clave === "tamano" ? fraccion("desde") : primero && !MAXIMOS.has(r.clave) ? fraccion(primero.nombre) : 0;
    const hasta = r.clave === "tamano" ? fraccion("hasta") : primero && MAXIMOS.has(r.clave) ? fraccion(primero.nombre) : 1;
    const conPorcentaje = (v: number) => cifra(v, locale) + (PORCENTAJES.has(r.clave) ? " %" : "");
    const banda = BANDAS.find(b => Number(r.params.desde) === b.desde && Number(r.params.hasta) === b.hasta)?.clave ?? null;
    cuerpo = <div className="cr-hoja-pad">
      {primero && primero.tipo !== "sectores" && <p className="cr-valor-gr num">{valorRegla(def, r, catalogo.sectores, t, locale)}</p>}
      {preview?.cumplen_reglas != null && preview.evaluadas != null && <p className="cr-valor-sub" role="status">
        {t.rich("builder_regla_cumplen", { n: miles(preview.cumplen_reglas, locale), total: miles(preview.evaluadas, locale), b: (c) => <b>{c}</b> })}</p>}
      {primero && primero.tipo !== "sectores" && stats && <Histograma barras={stats.histograma} desde={desde} hasta={hasta} />}
      {r.clave === "tamano" && <SegmentoLiga className="cr-seg-pequeno" etiquetaGrupo={def.titulo} valor={banda}
        opciones={BANDAS.map(b => ({ valor: b.clave, etiqueta: t(`builder_banda_${b.clave}`) }))}
        onChange={v => { const b = BANDAS.find(x => x.clave === v)!; cambiar({ desde: b.desde, hasta: b.hasta }); }} />}
      {r.clave === "tamano" ? <div className="cr-grupo">{def.parametros.map(p => {
        const valores = p.valores ?? [];
        const actual = Number(r.params[p.nombre] ?? p.defecto);
        const tope = p.nombre === "hasta" && actual >= (valores.at(-1) ?? Infinity);
        return <div className="cr-bloque" key={p.nombre}>
          <div className="cr-peso-cab"><span>{t(p.nombre === "desde" ? "builder_tamano_desde" : "builder_tamano_hasta")}</span>
            <span className="num">{tope ? t("builder_tamano_sin_tope") : `${cifra(actual, locale)} M$`}</span></div>
          <Deslizador aria-label={p.etiqueta} step={1} min={0} max={valores.length - 1} valor={Math.max(0, valores.indexOf(actual))}
            onChange={e => {
              const v = valores[Number(e.target.value)];
              const params: Record<string, unknown> = { [p.nombre]: v };
              if (p.nombre === "desde" && v > Number(r.params.hasta)) params.hasta = v;
              if (p.nombre === "hasta" && v < Number(r.params.desde)) params.desde = v;
              cambiar(params);
            }} />
        </div>;
      })}</div> : def.parametros.map(p => p.tipo === "sectores"
        ? <div className="cr-grupo" key={p.nombre} style={{ marginTop: 16 }}>{Object.entries(catalogo.sectores).map(([k, etiqueta]) => {
          const actuales = (r.params[p.nombre] as string[]) ?? [];
          const marcado = actuales.includes(k);
          return <button type="button" className="cr-celda" role="checkbox" aria-checked={marcado} key={k}
            onClick={() => cambiar({ [p.nombre]: marcado ? actuales.filter(s => s !== k) : [...actuales, k] })}>
            <span className="t"><b className="normal">{etiqueta}</b></span><span /><Marca marcada={marcado} /></button>;
        })}</div>
        : <div key={p.nombre}>
          {p.valores
            ? <Deslizador aria-label={p.etiqueta} step={1} min={0} max={p.valores.length - 1}
                valor={Math.max(0, p.valores.indexOf(Number(r.params[p.nombre] ?? p.defecto)))}
                onChange={e => cambiar({ [p.nombre]: p.valores![Number(e.target.value)] })} />
            : <Deslizador aria-label={p.etiqueta} step={Number(p.paso ?? 1)} min={extremos(p).min} max={extremos(p).max}
                valor={Number(r.params[p.nombre] ?? p.defecto)} onChange={e => cambiar({ [p.nombre]: Number(e.target.value) })} />}
          <div className="cr-rango-ext"><span>{conPorcentaje(extremos(p).min)}</span><span>{conPorcentaje(extremos(p).max)}</span></div>
        </div>)}
      <CabGrupo>{t("builder_regla_que_mide")}</CabGrupo>
      <div className="cr-grupo"><div className="cr-bloque cr-texto regla-info">
        <p>{t(`builder_regla_${r.clave}_mide`)} {t(`builder_regla_${r.clave}_calculo`)}</p>
        {detalle && <p>{t("builder_reglas_impacto", { sola: miles(detalle.sola, locale), sin: miles(detalle.sin_ella, locale) })}</p>}
        {stats && stats.cobertura < 100 && <p>{t("builder_reglas_cobertura", { count: stats.cobertura })}</p>}
      </div></div>
      <div className="cr-grupo" style={{ marginTop: 20 }}>
        <button type="button" className="cr-celda peligro" onClick={() => { actualizarB({ reglas: reglas.filter(e => e.clave !== r.clave) }); onCerrar(); }}>
          {t("builder_regla_quitar")}</button>
      </div>
    </div>;
  }
  return <Hoja abierta={!!(r && def)} titulo={def?.titulo ?? ""} accion={t("builder_listo")} onCerrar={onCerrar}>{cuerpo}</Hoja>;
}

/* ---------- Añadir regla: buscar, describir o elegir del catálogo ---------- */
function HojaAnadir({ abierta, catalogo, reglas, mercado, estrategiaId, quedan, alCambiarQuedan, alCambiarOcupado,
  actualizarB, onCerrar, onAnadida }: {
  abierta: boolean; catalogo: Catalogo; reglas: ReglaElegida[]; mercado: Mercado | null; estrategiaId?: string;
  quedan: number | null; alCambiarQuedan: (n: number) => void; alCambiarOcupado: (v: boolean) => void;
  actualizarB: Props["actualizarB"]; onCerrar: () => void; onAnadida: (clave: string) => void;
}) {
  const t = useTranslations();
  const locale = normalizeLocale(useLocale()) ?? "es";
  const [busca, setBusca] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [propuesta, setPropuesta] = useState<ConvertirResultado | null>(null);
  useEffect(() => { if (!abierta) { setBusca(""); setPropuesta(null); setError(null); } }, [abierta]);
  const disponibles = catalogo.reglas.filter(r => r.ofrecida !== false && !reglas.some(e => e.clave === r.clave)
    && normalizar(`${r.titulo} ${r.grupo ?? ""} ${t(`builder_grupo_${r.grupo ?? "otros"}`)}`).includes(normalizar(busca.trim())));
  async function proponer() {
    setOcupado(true); alCambiarOcupado(true); setError(null); setPropuesta(null);
    try {
      const r = await convertirFrase(busca.trim(), estrategiaId);
      if (typeof r === "string") setError(r); else { setPropuesta(r); alCambiarQuedan(r.quedan); }
    } catch { setError(t("builder_idea_error")); }
    finally { setOcupado(false); alCambiarOcupado(false); }
  }
  return <Hoja abierta={abierta} titulo={t("builder_anadir_titulo")} cancelar={t("builder_cancelar")} accion={t("builder_listo")} onCerrar={onCerrar}>
    <div className="cr-hoja-pad">
      <label className="cr-buscar"><IconoLupa />
        <input id="reglas-busca" type="search" maxLength={300} autoComplete="off" placeholder={t("builder_reglas_busca")}
          aria-label={t("builder_reglas_busca")} value={busca} onChange={e => { setBusca(e.target.value); setPropuesta(null); }} /></label>
      {busca.trim().length >= 3 && !propuesta && <div className="cr-grupo" style={{ marginTop: 12 }}>
        <button type="button" className="cr-celda accion" disabled={ocupado || quedan === 0} onClick={proponer}>
          <IconoMas /><span className="t"><b className="normal">{t(ocupado ? "builder_searching_rules" : "builder_reglas_proponer", { frase: busca.trim() })}</b>
            {quedan !== null && <small>{t("builder_idea_quedan", { count: Math.max(0, quedan) })}</small>}</span>
        </button></div>}
      {error && <p className="cr-pie mal" role="alert">{error}</p>}
      {propuesta && <Propuesta propuesta={propuesta} alUsar={() => {
        actualizarB({ reglas: [...reglas, ...propuesta.reglas.filter(r => !reglas.some(e => e.clave === r.clave)
          && catalogo.reglas.some(c => c.clave === r.clave && c.ofrecida !== false))], interpretacion: propuesta.interpretacion });
        onCerrar();
      }} />}
      {Array.from(new Set(disponibles.map(r => r.grupo ?? "otros"))).map(grupo => <div className="reglas-grupo" key={grupo}>
        <CabGrupo derecha={mercado ? t("builder_anadir_sola") : undefined}>{t(`builder_grupo_${grupo}`)}</CabGrupo>
        <div className="cr-grupo">{disponibles.filter(r => (r.grupo ?? "otros") === grupo).map(r => <button type="button"
          className="cr-celda reglas-anadir" key={r.clave} aria-label={t("builder_add_rule", { title: r.titulo })}
          onClick={() => {
            actualizarB({ reglas: [...reglas, { clave: r.clave, params: Object.fromEntries(r.parametros
              .filter(p => p.tipo === "sectores" || p.defecto !== null).map(p => [p.nombre, p.tipo === "sectores" ? [] : p.defecto])) }] });
            onAnadida(r.clave);
          }}>
          <span className="t"><b className="normal">{r.titulo}</b></span>
          {mercado?.reglas?.[r.clave] ? <span className="valor num">{miles(mercado.reglas[r.clave].sola, locale)}</span> : <span />}
        </button>)}</div>
      </div>)}
      {!disponibles.length && !propuesta && <p className="cr-pie" style={{ marginTop: 16 }}>{t("builder_no_matching_filters")}</p>}
    </div>
  </Hoja>;
}
