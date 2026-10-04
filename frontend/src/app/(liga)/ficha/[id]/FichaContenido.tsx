"use client";

// La API proyecta la ficha según permisos; la interfaz nunca reconstruye una receta privada.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { normalizeLocale } from "@/i18n/locale";
import {
  BarraPestanas, Boton, Cargando, CASA, Cifra, Escudo, escudoCasa, ErrorLiga, Segmentado,
} from "../../_ui";
import { copiarEstrategia, getCatalogo, getFicha, reportar, type Catalogo, type Ficha, type MercadoFicha } from "@/lib/liga/api";
import { invalidar, useCache } from "@/lib/liga/cache";
import { useSesionRequerida } from "../../_sesion/SesionContext";
import { RendimientoFicha } from "./RendimientoFicha";
import { EvidenciaCartera } from "./EvidenciaCartera";
import { CambiosEstrategia } from "../../_ui/CambiosEstrategia";
import { getSeguimiento, marcarSeguimientos, type SeguimientoEstrategia } from "@/lib/liga/seguimiento";
import { claseSigno, fecha, porcentaje } from "@/lib/liga/format";

const ETIQUETA_PESO: Record<string, string> = {
  negocio: "strategies_weight_business", precio: "strategies_weight_price", deuda: "strategies_weight_debt", pronto: "strategies_weight_catalyst",
  pregunta: "strategies_weight_question",
};

function subtitulo(f: Ficha, esMia: boolean, t: (key: string, values?: Record<string, string>) => string): string {
  if (f.casa) return t("strategies_house_by", { name: CASA[f.casa].nombre });
  if (esMia) return t("strategies_yours");
  if (f.autor) return t("strategies_by_author", { author: f.autor });
  return t("strategies_retired");
}

function CarteraSinEvidencia({ posiciones, mercado }: { posiciones: Ficha["posiciones"]; mercado?: MercadoFicha | null }) {
  const t = useTranslations();
  const locale = normalizeLocale(useLocale()) ?? "es";
  const [ticker, setTicker] = useState<string | null>(null);
  const dialogo = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = dialogo.current;
    if (!ticker || !d) return;
    d.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { d.close(); document.body.style.overflow = overflow; };
  }, [ticker]);
  const cotizacion = ticker ? mercado?.empresas[ticker] : null;
  return <section className="sec"><h3 className="sec-t">{t("strategies_portfolio_count", { count: posiciones.length })}</h3>
    <div className="cartera-plantilla">{posiciones.map(p => <button type="button" className="cartera-empresa con-precio" key={p.ticker} onClick={() => setTicker(p.ticker)}>
      <b>{p.ticker}</b><span>{new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(Number(p.peso))} %<small>{t("strategies_weight")}</small></span>
      <span>{mercado?.empresas[p.ticker]?.precio == null ? "—" : Number(mercado.empresas[p.ticker]!.precio).toLocaleString(locale)}<small>{t("strategies_price")}</small></span>
      <span><b className={`cartera-retorno ${mercado?.empresas[p.ticker]?.rentabilidad == null ? "fl" : claseSigno(mercado.empresas[p.ticker]!.rentabilidad!)}`}>{mercado?.empresas[p.ticker]?.rentabilidad == null ? "—" : porcentaje(mercado.empresas[p.ticker]!.rentabilidad!, 1, locale)}</b><small>{t("strategies_month_provisional")}</small></span><span aria-hidden="true">→</span>
    </button>)}</div>
    <dialog ref={dialogo} className="lecturas-modal empresa-modal" aria-label={t("strategies_company_dialog", { ticker: ticker ?? "" })} onCancel={() => setTicker(null)}>
      <header className="lecturas-cab"><h2>{ticker}</h2><button type="button" className="lecturas-cerrar" autoFocus aria-label={t("strategies_close_company")} onClick={() => setTicker(null)}>×</button></header>
      <div className="lecturas-cuerpo"><p>{t("strategies_price_label")}: {cotizacion?.precio == null ? "—" : Number(cotizacion.precio).toLocaleString(locale)}</p>
        <p>{t("strategies_month_return")}: {cotizacion?.rentabilidad == null ? "—" : porcentaje(cotizacion.rentabilidad, 1, locale)}</p>
        <p className="fine">{cotizacion?.dia ? t("strategies_data_provisional", { date: fecha(cotizacion.dia, new Date(), locale) }) : t("strategies_no_current_quote")}</p>
        <p className="fine">{t("strategies_no_historical_evidence")}</p></div>
    </dialog>
  </section>;
}

export function FichaContenido({ id }: { id: string }) {
  const t = useTranslations();
  const locale = normalizeLocale(useLocale()) ?? "es";
  const date = (value: string) => fecha(value, new Date(), locale);
  const percent = (value: number) => porcentaje(value, 1, locale);
  const router = useRouter();
  const { estado, yo } = useSesionRequerida(`/ficha/${id}`);
  const sesionLista = estado !== "cargando";
  const { datos: catalogo } = useCache<Catalogo | string>("catalogo", getCatalogo);

  // La caché por estrategia impide que una respuesta anterior sustituya la ficha actual.
  const { datos: ficha, cargando: cargandoFicha, refrescar: refrescarFicha } = useCache<Ficha | string>(
    sesionLista && estado === "dentro" ? `ficha:${id}` : null, () => getFicha(id), 120000,
  );
  const { datos: seguimientos } = useCache<SeguimientoEstrategia[] | string>(
    typeof ficha !== "string" && ficha?.es_dueno ? `seguimiento:${id}` : null, getSeguimiento,
  );
  const seguimiento = Array.isArray(seguimientos)
    ? seguimientos.find((s) => s.estrategia_id === id) : undefined;

  const alMostrarSeguimiento = useCallback(() => {
    if (!seguimiento) return;
    void marcarSeguimientos([{
      estrategia_id: seguimiento.estrategia_id,
      inscripcion_id: seguimiento.ultima_inscripcion_id,
      resultado_inscripcion_id: seguimiento.ultimo_resultado_inscripcion_id,
    }]).then((r) => {
      // Conserva el resumen que se está leyendo; Mías recoge la revisión al volver.
      if (typeof r !== "string") invalidar("seguimiento");
    });
  }, [seguimiento]);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [vista, setVista] = useState("cartera");
  const [metodo, setMetodo] = useState("idea");

  async function alCopiar() {
    setOcupado(true);
    setAviso(null);
    const r = await copiarEstrategia(id);
    setOcupado(false);
    if (typeof r === "string") { setAviso(r); return; }
    router.push(`/crear/${r.id}`);
  }

  async function alReportar() {
    const motivo = window.prompt(t("strategies_report_prompt"));
    if (!motivo || !motivo.trim()) return;
    setOcupado(true);
    const r = await reportar("estrategia", id, motivo.trim());
    setOcupado(false);
    setAviso(typeof r === "string" ? r : t("strategies_report_thanks"));
  }

  return (
    <main className="scroll">
      <Link href="/liga" className="back" style={{ marginTop: 4 }} onClick={(evento) => {
        if (evento.ctrlKey || evento.metaKey || evento.shiftKey || evento.altKey) return;
        if (window.history.length > 1) { evento.preventDefault(); router.back(); }
      }}>
        <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M15 6l-6 6 6 6" />
        </svg>
        {t("strategies_back")}
      </Link>

      {cargandoFicha ? (
        <div style={{ marginTop: 20 }}><Cargando filas={4} /></div>
      ) : typeof ficha === "string" ? (
        <ErrorLiga titulo={t("strategies_detail_load_error")} mensaje={ficha}
                   accion={{ texto: t("strategies_retry"), onClick: refrescarFicha }} />
      ) : !ficha ? null : (
        <>
          <div className="fh" style={{ marginTop: 16 }}>
            <Escudo valor={ficha.casa ? escudoCasa(ficha.casa) : ficha.escudo}
              casa={ficha.casa} etiqueta={t("strategies_crest", { name: ficha.nombre })} tamano={52} />
            <div>
              <h2>{ficha.nombre}</h2>
              <p>{subtitulo(ficha, ficha.es_dueno, (key, values) => t(key, values))}</p>
            </div>
          </div>

          {ficha.mercado && <section className="ficha-marcador" aria-label={t("strategies_portfolio_provisional_result")}>
            <div><small>{t("strategies_portfolio_month")}</small><b className={ficha.mercado.rentabilidad == null ? "" : claseSigno(ficha.mercado.rentabilidad)}>{ficha.mercado.rentabilidad == null ? "—" : percent(ficha.mercado.rentabilidad)}</b></div>
            <div><small>{t("strategies_sp_same_period")}</small><b>{ficha.mercado.sp500 == null ? "—" : percent(ficha.mercado.sp500)}</b></div>
            <p className="fine">{t("strategies_market_freshness", { date: date(ficha.mercado.desde), checked: ficha.mercado.consultado ? t("strategies_checked_at", { time: new Date(ficha.mercado.consultado).toLocaleTimeString(locale, {hour:"2-digit",minute:"2-digit"}) }) : t("strategies_waiting_market"), dataDate: date(ficha.mercado.dia) })}</p>
          </section>}
          <Segmentado className="ficha-nav" etiquetaGrupo={t("strategies_detail_tabs")} valor={vista} onChange={setVista}
            opciones={[{ valor: "cartera", etiqueta: t("strategies_portfolio") }, { valor: "metodo", etiqueta: t("strategies_methodology") }, { valor: "resultados", etiqueta: t("strategies_results") }]} />
          {vista === "resultados" && <div className={ficha.es_dueno && seguimiento ? "ficha-distribucion" : undefined}>
            <RendimientoFicha datos={ficha.rendimiento} posiciones={ficha.posiciones} />
            {ficha.es_dueno && seguimiento && (
              <aside><CambiosEstrategia key={`${id}:${seguimiento.ultima_inscripcion_id}:${seguimiento.ultimo_resultado_inscripcion_id}`} resumen={seguimiento} alMostrar={alMostrarSeguimiento} /></aside>
            )}
          </div>}

          {vista === "metodo" && !ficha.receta && <p className="meta">{t("strategies_method_private")}</p>}
          {vista === "metodo" && ficha.receta && (
            <section className="ficha-metodologia">
              <Segmentado etiquetaGrupo={t("strategies_method_steps")} valor={metodo} onChange={setMetodo}
                opciones={[{ valor: "idea", etiqueta: t("strategies_idea") }, { valor: "reglas", etiqueta: t("strategies_rules") }, { valor: "criterios", etiqueta: t("strategies_criteria") }, { valor: "reparto", etiqueta: t("strategies_allocation") }]} />
              {metodo === "idea" && <div className="sec"><h3 className="sec-t">{t("strategies_the_idea")}</h3><p className="meta">{ficha.receta.idea || t("strategies_no_idea")}</p></div>}
              {metodo === "reglas" && <div className="sec">
                <div className="sec-t">{t("strategies_its_rules")}</div>
                <p className="fine">{t("strategies_saved_method_note")}</p>
                <div className="rules">
                  {ficha.receta.reglas.length === 0 && <p className="meta">{t("strategies_no_extra_filters")}</p>}
                  {ficha.receta.reglas.map((r, i) => (
                    <div className="rulec" key={i}>
                      <div>
                        <b>{typeof catalogo === "object" ? catalogo.reglas.find((d) => d.clave === r.clave)?.titulo ?? r.clave : r.clave}</b>
                        {Object.entries(r.params).map(([clave, valor]) => {
                          const parametro = typeof catalogo === "object"
                            ? catalogo.reglas.find((d) => d.clave === r.clave)?.parametros.find((p) => p.nombre === clave) : undefined;
                          const texto = Array.isArray(valor) ? valor.map((v) => typeof catalogo === "object"
                            ? catalogo.sectores[String(v)] ?? String(v) : String(v)).join(", ") : String(valor);
                          return <p className="fine" key={clave}>{parametro?.etiqueta ?? clave}: {texto}</p>;
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>}
              {metodo === "reparto" && <div className="sec">
                <div className="sec-t">{t("strategies_build_and_review")}</div>
                <p className="fine">{t("strategies_allocation_summary", { count: ficha.receta.n_empresas, allocation: ficha.receta.reparto === "igual" ? t("strategies_equal_weights") : t("strategies_score_weights"), sectorLimit: Number(ficha.receta.max_por_sector) === 0 ? t("strategies_no_sector_limit") : t("strategies_sector_limit", { count: ficha.receta.max_por_sector }) })}</p>
                <p className="fine">{t("strategies_monthly_review")}</p>
                {ficha.receta.excluidas.length > 0 && <p className="fine">{t("strategies_excluded")}: {ficha.receta.excluidas.join(", ")}.</p>}
              </div>}
              {metodo === "criterios" && <div className="sec">
                <div className="sec-t">{t("strategies_criteria")}</div>
                {Object.entries(ficha.receta.pesos).filter(([, v]) => v > 0).map(([k, v]) => {
                  const total = Object.values(ficha.receta!.pesos).reduce((a, b) => a + b, 0) || 1;
                  const pct = Math.round((v * 100) / total);
                  return (
                    <div className={`wrow${k === "pregunta" ? " own" : ""}`} key={k}>
                      <span>{ETIQUETA_PESO[k] ? t(ETIQUETA_PESO[k]) : k}</span>
                      <span className="num">{pct}&nbsp;%</span>
                      <div className="wbar"><i style={{ width: `${pct}%` }} /></div>
                    </div>
                  );
                })}
              </div>}
              {metodo === "criterios" && ficha.receta.pregunta && (
                <div className="sec">
                  <div className="sec-t">{t("strategies_ai_question")}</div>
                  <p className="q">«{ficha.receta.pregunta}»</p>
                </div>
              )}
            </section>
          )}

          {vista === "cartera" && ficha.rendimiento?.evidencia && <EvidenciaCartera datos={ficha.rendimiento.evidencia} mercado={ficha.mercado} />}
          {vista === "cartera" && !ficha.rendimiento?.evidencia && ficha.posiciones.length > 0 && (
            <CarteraSinEvidencia posiciones={ficha.posiciones} mercado={ficha.mercado} />
          )}
          {vista === "cartera" && !ficha.rendimiento?.evidencia && ficha.posiciones.length === 0 && <p className="meta">{ficha.rendimiento?.estado === "privado" ? t("strategies_private_portfolio_note") : t("strategies_no_visible_portfolio")}</p>}

          {vista === "cartera" && ficha.casa === "omega" && (
            <div className="sec">
              <div className="sec-t">{t("strategies_its_portfolio")}</div>
              <p className="fine">{t("strategies_changes_during_month")}</p>
            </div>
          )}

          {vista === "resultados" && <section className="sec">
            <h3 className="sec-t">{t("strategies_round_history", { count: ficha.jornadas.length })}</h3>
            <p className="fine">{t("strategies_official_results_note")}</p>
            {ficha.jornadas.length === 0 ? (
              <p className="meta">{t("strategies_no_round_results")}</p>
            ) : ficha.jornadas.map((j) => (
              <div className="month" key={j.numero}>
                <span>{t("strategies_round", { round: j.numero })}</span>
                {j.rentabilidad !== null ? <Cifra valor={j.rentabilidad} /> : <span className="fl">—</span>}
                <span className="num">{j.puntos !== null ? t("strategies_points", { count: j.puntos }) : "—"}</span>
              </div>
            ))}
            <p className="fine"><Link href="/liga">{t("strategies_compare_others")} →</Link></p>
          </section>}

          {!ficha.casa && (
            <p className="fine">
              {t("strategies_user_strategy_disclaimer")}
            </p>
          )}

          {aviso && <p className="aviso" role="alert" style={{ marginTop: 16 }}>{aviso}</p>}

          <div className="cta">
            {ficha.es_dueno ? (
              <Link href={`/crear/${ficha.id}`} className="btn pri wide">{t("strategies_edit")}</Link>
            ) : (
              <>
                {!ficha.casa && ficha.receta && (
                  yo?.plan === "pro" ? (
                    <Boton variante="principal" ancho="completo" disabled={ocupado} onClick={alCopiar}>
                      {t("strategies_copy_adjust")}
                    </Boton>
                  ) : (
                    <div className="lock">
                      {t("strategies_pro_copy_note")}
                    </div>
                  )
                )}
                {!ficha.casa && !ficha.receta && <p className="fine">{t("strategies_copy_requires_published_pro")}</p>}
                <Boton variante="discreto" onClick={alReportar} disabled={ocupado}>{t("strategies_report")}</Boton>
              </>
            )}
          </div>
        </>
      )}

      <BarraPestanas />
    </main>
  );
}
