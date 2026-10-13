"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { convertirFrase, getMercado, type Catalogo, type Mercado, type PreviewSeleccion,
  type ReglaElegida, type ConvertirResultado, type InterpretacionIdea } from "@/lib/liga/api";
import { miles, signo, porcentaje } from "@/lib/liga/format";
import { Histograma, posicion } from "./Histograma";

type Props = {
  catalogo: Catalogo; reglas: ReglaElegida[]; preview: PreviewSeleccion | null; estrategiaId?: string;
  quedan: number | null; alCambiarQuedan: (n: number) => void; alCambiarOcupado: (v: boolean) => void;
  actualizarB: (v: { reglas: ReglaElegida[]; interpretacion?: InterpretacionIdea[] }) => void;
};
const MAXIMOS = new Set(["barata", "pb", "ev_ebitda", "deuda", "deuda_pn", "payout", "beta", "cortos"]);
const PORCENTAJES = new Set(["fcf", "rentables", "roa", "margen", "margen_neto", "crecen", "deuda_pn", "dividendo", "payout", "castigadas_pct", "fuerza_sp", "directivos", "cortos"]);
const BANDAS = [{ clave: "pequenas", desde: 300, hasta: 2000 },
  { clave: "medianas", desde: 2000, hasta: 10000 }, { clave: "grandes", desde: 10000, hasta: 5000000 }];
export function PasoReglas({ catalogo, reglas, preview, estrategiaId, quedan,
  alCambiarQuedan, alCambiarOcupado, actualizarB }: Props) {
  const t = useTranslations();
  const [busca, setBusca] = useState("");
  const [mercado, setMercado] = useState<Mercado | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [propuesta, setPropuesta] = useState<ConvertirResultado | null>(null);
  const [abiertas, setAbiertas] = useState<string[]>([]);
  useEffect(() => {
    let vigente = true;
    void getMercado().then(r => { if (vigente) { if (typeof r === "string") setError(r); else setMercado(r); } })
      .catch(() => { if (vigente) setError(t("builder_preview_refresh_error")); });
    return () => { vigente = false; };
  }, [t]);
  const normalizar = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const disponibles = catalogo.reglas.filter(r => r.ofrecida !== false && !reglas.some(e => e.clave === r.clave)
    && normalizar(`${r.titulo} ${r.grupo ?? ""} ${t(`builder_grupo_${r.grupo ?? "otros"}`)}`).includes(normalizar(busca.trim())));
  function cambiar(clave: string, params: Record<string, unknown>) {
    actualizarB({ reglas: reglas.map(r => r.clave === clave ? { ...r, params: { ...r.params, ...params } } : r) });
  }
  async function proponer() {
    setOcupado(true); alCambiarOcupado(true); setError(null); setPropuesta(null);
    try {
      const r = await convertirFrase(busca.trim(), estrategiaId);
      if (typeof r === "string") setError(r); else { setPropuesta(r); alCambiarQuedan(r.quedan); }
    } catch { setError(t("builder_idea_error")); }
    finally { setOcupado(false); alCambiarOcupado(false); }
  }
  return <div className="paso-reglas">
    <label className="lbl" htmlFor="reglas-busca">{t("builder_reglas_busca")}</label>
    <input id="reglas-busca" className="inp" type="search" maxLength={300} value={busca}
      onChange={e => { setBusca(e.target.value); setPropuesta(null); }} />
    {busca.trim().length >= 3 && <div className="reglas-proponer">
      <p>{t("builder_reglas_propuesta", { frase: busca.trim() })}</p>
      <button type="button" disabled={ocupado || quedan === 0} onClick={proponer}>
        {t(ocupado ? "builder_searching_rules" : "builder_propose_rules")}</button>
      <p className="fine">{t("builder_convert_idea_notice")}</p>
    </div>}
    {error && <p role="alert">{error}</p>}
    {propuesta && <section aria-label={t("builder_idea_interpretation")}>
      {propuesta.interpretacion.map((i, n) => <p key={n}>{i.intencion}: {i.motivo}</p>)}
      <button type="button" onClick={() => {
        actualizarB({ reglas: [...reglas, ...propuesta.reglas.filter(r => !reglas.some(e => e.clave === r.clave)
          && catalogo.reglas.some(c => c.clave === r.clave && c.ofrecida !== false))], interpretacion: propuesta.interpretacion });
        setPropuesta(null);
      }}>{t("builder_idea_usar")}</button>
    </section>}
    <h3>{t("builder_reglas_tuyas")}</h3>
    {reglas.map(r => {
      const def = catalogo.reglas.find(c => c.clave === r.clave);
      if (!def) return null;
      const abierta = abiertas.includes(r.clave), stats = mercado?.reglas?.[r.clave];
      const detalle = preview?.por_regla?.find(p => p.clave === r.clave);
      const valores = def.parametros.map(p => {
        const v = r.params[p.nombre] ?? p.defecto;
        return Array.isArray(v) ? v.map(s => catalogo.sectores[String(s)] ?? s).join(", ") : typeof v === "number" ? PORCENTAJES.has(r.clave) ? porcentaje(v, 1).replace(/^\+/, "") : signo(v, 2).replace(/^\+/, "") : String(v ?? "");
      }).join(" · ");
      const primero = def.parametros[0];
      const fraccion = (nombre: string) => {
        const p = def.parametros.find(p => p.nombre === nombre)!;
        return posicion(Number(r.params[nombre] ?? p.defecto), p.valores?.[0] ?? p.minimo ?? 0,
          p.valores?.at(-1) ?? p.maximo ?? 100, p.tipo === "lista");
      };
      const desde = r.clave === "tamano" ? fraccion("desde") : primero && !MAXIMOS.has(r.clave) ? fraccion(primero.nombre) : 0;
      const hasta = r.clave === "tamano" ? fraccion("hasta") : primero && MAXIMOS.has(r.clave) ? fraccion(primero.nombre) : 1;
      return <section className="reglas-activa" key={r.clave}>
        <div className="reglas-cabecera"><strong>{def.titulo}</strong><output>{valores}</output>
          <button type="button" aria-label={t("builder_reglas_info", { title: def.titulo })} aria-expanded={abierta}
            aria-controls={`info-${r.clave}`} onClick={() => setAbiertas(abierta ? abiertas.filter(k => k !== r.clave) : [...abiertas, r.clave])}>i</button>
          <button type="button" aria-label={t("builder_remove_rule", { title: def.titulo })}
            onClick={() => actualizarB({ reglas: reglas.filter(e => e.clave !== r.clave) })}>×</button></div>
        {abierta && <div id={`info-${r.clave}`} className="fine">
          <p>{t(`builder_regla_${r.clave}_mide`)}</p><p>{t(`builder_regla_${r.clave}_calculo`)}</p>
          {detalle && <p>{t("builder_reglas_impacto", { sola: miles(detalle.sola), sin: miles(detalle.sin_ella) })}</p>}
          {stats && stats.cobertura < 100 && <p>{t("builder_reglas_cobertura", { count: stats.cobertura })}</p>}
        </div>}
        {r.clave === "tamano" && <div className="reglas-chips">{BANDAS.map(b => <button type="button" key={b.clave}
          aria-pressed={Number(r.params.desde) === b.desde && Number(r.params.hasta) === b.hasta}
          onClick={() => cambiar(r.clave, { desde: b.desde, hasta: b.hasta })}>{t(`builder_banda_${b.clave}`)}</button>)}</div>}
        {primero && primero.tipo !== "sectores" && <Histograma barras={stats?.histograma ?? []} desde={desde} hasta={hasta} />}
        {def.parametros.map(p => p.tipo === "sectores" ? <div className="reglas-chips" key={p.nombre}>
          {Object.entries(catalogo.sectores).map(([k, etiqueta]) => {
            const actuales = (r.params[p.nombre] as string[]) ?? [];
            return <button type="button" key={k} aria-pressed={actuales.includes(k)} onClick={() => cambiar(r.clave,
              { [p.nombre]: actuales.includes(k) ? actuales.filter(s => s !== k) : [...actuales, k] })}>{etiqueta}</button>;
          })}</div> : <div className="rng" key={p.nombre}>
            <label htmlFor={`regla-${r.clave}-${p.nombre}`}>{p.etiqueta}</label>
            <input id={`regla-${r.clave}-${p.nombre}`} type="range" min={p.valores ? 0 : p.minimo ?? 0}
              max={p.valores ? p.valores.length - 1 : p.maximo ?? 100} step={p.valores ? 1 : p.paso ?? 1}
              value={p.valores ? p.valores.indexOf(Number(r.params[p.nombre] ?? p.defecto)) : Number(r.params[p.nombre] ?? p.defecto)}
              onChange={e => {
                const valor = p.valores ? p.valores[Number(e.target.value)] : Number(e.target.value);
                const params: Record<string, unknown> = { [p.nombre]: valor };
                if (r.clave === "tamano") {
                  if (p.nombre === "desde" && valor > Number(r.params.hasta)) params.hasta = valor;
                  if (p.nombre === "hasta" && valor < Number(r.params.desde)) params.desde = valor;
                }
                cambiar(r.clave, params);
              }} />
          </div>)}
        {!primero && <p>{detalle?.detalle ?? def.titulo}</p>}
      </section>;
    })}
    <p className="reglas-total" role="status">{preview?.cumplen_reglas != null && preview.evaluadas != null
      ? t("builder_reglas_total", { count: miles(preview.cumplen_reglas), total: miles(preview.evaluadas) }) : t("builder_candidates_not_counted")}</p>
    {Array.from(new Set(disponibles.map(r => r.grupo ?? "otros"))).map(grupo => <section key={grupo}>
      <h3>{t(`builder_grupo_${grupo}`)}</h3>
      {disponibles.filter(r => (r.grupo ?? "otros") === grupo).map(r => <button type="button" className="reglas-anadir" key={r.clave}
        onClick={() => actualizarB({ reglas: [...reglas, { clave: r.clave, params: Object.fromEntries(r.parametros
          .filter(p => p.tipo === "sectores" || p.defecto !== null).map(p => [p.nombre, p.tipo === "sectores" ? [] : p.defecto])) }] })}>
        <span>{r.titulo}</span><span>{mercado?.reglas?.[r.clave] ? miles(mercado.reglas[r.clave].sola) : t("builder_idea_sin_recuento")}</span>
      </button>)}
    </section>)}
    {!disponibles.length && <p>{t("builder_no_matching_filters")}</p>}
  </div>;
}
