"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { dolares, porcentajeConSigno, porcentajeSimple } from "../_marco/formato";
import { Celda, Datos, Grupo, Hoja } from "../_panel/ui";
import { TextoAgente } from "./Comun";
import { HojaCompartir, imagenPasos } from "./Compartir";
import { CabeceraCompartir, Flujo, type Paso } from "./Flujo";
import { fecha } from "./formato";
import { lista as listaDe } from "./textos";
import type { HerramientaPedida, LlamadaModelo, MensajeModelo } from "./tipos";

type Obj = Record<string, unknown>;

// Fracciones que el código devuelve como 0,25 y se leen como 25 %.
const ES_PORCENTAJE = /^(margin_of_safety|target_margin|discount_rate|probability|return_total|return_annual|expected_return_annual|change_1m|drawdown_from_high|drawdown_from_1y_high)$/;
const CON_SIGNO = /^(margin_of_safety|return_total|return_annual|expected_return_annual|change_1m|drawdown_from_high|drawdown_from_1y_high)$/;
const EN_DOLARES = /^(price|price_final|expected_price_final|expected_value_today|worst_value_today|value_today|price_for_target_margin|last_close|cash|total_value|dividend_per_share)$/;
const VEREDICTO: Record<string, string> = {
  approve: "aprobada", reject: "rechazada", revise: "corregir", aprobada: "aprobada", rechazada: "rechazada", corregir: "corregir",
};
const MAX_FILAS = 120;

export const leer = (s: string | null | undefined): unknown => { try { return JSON.parse(s ?? ""); } catch { return s; } };
export const esObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
export const args = (h: HerramientaPedida): Obj => { const a = leer(h.function.arguments || "{}"); return esObj(a) ? a : {}; };
/** Empresas que pidió una herramienta: `ticker` suelto o `tickers` en lote. */
export const tickersDe = (a: Obj): string[] => [
  ...(Array.isArray(a.tickers) ? a.tickers.filter((x): x is string => typeof x === "string") : []),
  ...(typeof a.ticker === "string" && a.ticker ? [a.ticker] : []),
];
/** tool_call_id → lo que devolvió la herramienta, sacado de lo que se envió en la vuelta siguiente. */
export function resultadosDe(llamadas: LlamadaModelo[]): Map<string, unknown> {
  const res = new Map<string, unknown>();
  llamadas.forEach(l => l.enviado.forEach(m => { if (m.role === "tool" && m.tool_call_id) res.set(m.tool_call_id, leer(m.content)); }));
  return res;
}

/** Formatos y nombres de esta pantalla, con el idioma ya puesto. Las herramientas van con su nombre real. */
export function useFormato() {
  const t = useTranslations();
  const locale = useLocale();
  return useMemo(() => {
    const num = (v: number, dec: number) => new Intl.NumberFormat(locale, {
      minimumFractionDigits: dec, maximumFractionDigits: dec, useGrouping: "always",
    } as Intl.NumberFormatOptions).format(v).replace("-", "−");
    const coste = (v: string | number | null) => (v === null ? "—" : dolares(Number(v), locale, Number(v) < 0.01 ? 4 : 3));
    const segundos = (ms: number | null) => {
      if (ms === null) return "—";
      const s = ms / 1000;
      return s < 60 ? `${num(s, 1)} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
    };
    const lista = (xs: string[], max = 4) => listaDe(xs, locale, t, max);
    const orden = (v: unknown) => (typeof v === "string" && t.has(`pnl_agente_pasos_orden_${v}`) ? t(`pnl_agente_pasos_orden_${v}`) : undefined);
    const clave = (k: string) => (t.has(`pnl_agente_clave_${k}`) ? t(`pnl_agente_clave_${k}`) : (k.charAt(0).toUpperCase() + k.slice(1)).replace(/_/g, " "));
    const veredicto = (v: unknown) => { const c = typeof v === "string" ? VEREDICTO[v] : undefined; return c ? t(`pnl_agente_ver_${c}`) : ""; };
    const valor = (v: unknown, k = ""): string => {
      if (v === null || v === undefined) return "—";
      if (typeof v === "boolean") return v ? t("pnl_agente_pasos_si") : t("pnl_agente_pasos_no");
      if (k === "sort") return orden(v) ?? String(v);
      if (typeof v === "number" && ES_PORCENTAJE.test(k)) return CON_SIGNO.test(k) || v < 0 ? porcentajeConSigno(v * 100, locale, 1) : porcentajeSimple(v * 100, locale, 1);
      if (typeof v === "number" && EN_DOLARES.test(k)) return dolares(v, locale);
      if (typeof v === "number") return num(v, Number.isInteger(v) ? 0 : 2);
      if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return fecha(v, locale);
      return typeof v === "object" ? JSON.stringify(v) : String(v);
    };
    const pct = (x: string) => (x === "n/a" ? "—" : porcentajeConSigno(Number(x), locale, 1));
    return { t, locale, num, coste, segundos, lista, orden, clave, veredicto, valor, pct };
  }, [t, locale]);
}
type Formato = ReturnType<typeof useFormato>;

/** El título y la línea de debajo de cada vuelta en la lista. */
function resumenVuelta(l: LlamadaModelo, resultados: Map<string, unknown>, f: Formato) {
  const hs = l.herramientas_pedidas;
  if (!hs.length) {
    const r = leer(l.respuesta);
    const d = esObj(r) && esObj(r.decision) ? r.decision : null;
    const ops = (Array.isArray(d?.operaciones) ? d.operaciones : []).filter(esObj)
      .map(o => `${f.t(`pnl_agente_lado_${o.lado}`).toLocaleLowerCase(f.locale)} ${o.ticker}`);
    const tipo = typeof d?.tipo === "string" && f.t.has(`pnl_agente_dec_tipo_${d.tipo}`) ? f.t(`pnl_agente_dec_tipo_${d.tipo}`) : "";
    return { titulo: f.t("pnl_agente_pasos_final"), sub: [tipo, f.lista(ops)].filter(Boolean).join(" · ") };
  }
  const nombres = [...new Set(hs.map(h => h.function.name))];
  const tickers = [...new Set(hs.flatMap(h => tickersDe(args(h))))];
  const orden = hs.map(h => f.orden(args(h).sort)).find(Boolean);
  const cribado = hs.find(h => h.function.name === "screen");
  const r = cribado && resultados.get(cribado.id);
  const sub = tickers.length ? f.lista(tickers)
    : esObj(r) ? f.t("pnl_agente_pasos_cribado_sub", { n: Number(r.shown ?? 0), orden: orden ?? f.orden("drawdown") ?? "" })
    : orden ?? "";
  return { titulo: f.lista(nombres, 3), sub };
}

/* ---------- Resultados de herramientas como grupos de iOS ---------- */

// `screen` llega en líneas cortas con sus columnas: empresa, precio, mes, RSI y caída primero.
function filasCribado(r: Obj, f: Formato): ReactNode[] {
  const filas = (r.rows as unknown[]).map(String);
  const sin = Array.isArray(r.without_price_history) ? r.without_price_history.map(String) : [];
  return [
    <Grupo key="c">
      <Celda titulo={f.clave("universe")} valor={String(r.universe)} />
      <Celda titulo={f.clave("sort")} valor={f.orden(r.sort) ?? String(r.sort)} />
    </Grupo>,
    <Grupo key="e" cabecera={f.t("pnl_agente_pasos_empresas", { n: filas.length })} pie={f.t("pnl_agente_pasos_cribado_pie")}>
      {filas.map((s, i) => {
        const [ticker, cierre, mes, rsi, caida] = s.split(" ");
        return <Celda key={i} titulo={ticker} valor={f.pct(caida)}
          subtitulo={f.t("pnl_agente_pasos_cribado_fila", { cierre: dolares(Number(cierre), f.locale), mes: f.pct(mes), rsi })} />;
      })}
    </Grupo>,
    sin.length > 0 && <Grupo key="s" cabecera={f.clave("without_price_history")}>{sin.map(x => <Celda key={x} titulo={x} />)}</Grupo>,
  ];
}

function filasDe(obj: unknown, f: Formato): ReactNode[] {
  if (!esObj(obj)) return [<Grupo key="v"><Celda titulo={f.valor(obj)} /></Grupo>];
  if (typeof obj.columns === "string" && Array.isArray(obj.rows)) return filasCribado(obj, f);
  const grupos: ReactNode[] = [], sueltos: ReactNode[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (Array.isArray(v)) {
      const items = v.slice(0, MAX_FILAS).map((x, i) => {
        if (!esObj(x)) return <Celda key={i} titulo={f.valor(x, k)} />;
        const nombre = Object.entries(x).find(([, y]) => typeof y === "string");
        return <Celda key={i} titulo={nombre ? String(nombre[1]) : ""}
          subtitulo={Object.entries(x).filter(([a]) => a !== nombre?.[0]).map(([a, b]) => `${f.clave(a)} ${f.valor(b, a)}`).join(" · ")} />;
      });
      grupos.push(
        <Grupo key={k} cabecera={`${f.clave(k)} (${v.length})`} pie={v.length > MAX_FILAS ? f.t("pnl_agente_pasos_y_mas", { n: v.length - MAX_FILAS }) : undefined}>
          {items.length ? items : <Celda titulo={f.t("pnl_agente_pasos_ninguna")} />}
        </Grupo>);
    } else if (esObj(v)) {
      grupos.push(
        <Grupo key={k} cabecera={f.clave(k)}>
          {Object.entries(v).map(([a, b]) => <Celda key={a} titulo={f.clave(a)} valor={f.valor(b, a)} />)}
        </Grupo>);
    } else {
      const s = f.valor(v, k);
      sueltos.push(s.length > 28 ? <Celda key={k} titulo={f.clave(k)} subtitulo={s} /> : <Celda key={k} titulo={f.clave(k)} valor={s} />);
    }
  }
  return sueltos.length ? [<Grupo key="sueltos">{sueltos}</Grupo>, ...grupos] : grupos;
}

/* ---------- La hoja: una pila de vistas, como la navegación de iOS ---------- */

type Vista =
  | { tipo: "vuelta"; i: number } | { tipo: "revisor"; i: number } | { tipo: "contexto" }
  | { tipo: "texto"; titulo: string; texto: string } | { tipo: "herramienta"; h: HerramientaPedida };

const texto = (m: MensajeModelo | undefined) => m?.content ?? "";
const TextoEnviado = ({ t }: { t: string }) => <p className="pa-texto">{t}</p>;

/** Cómo llegó aquí: cada vuelta del agente y el revisor con su pista, su hoja de detalle,
 *  la imagen para compartir y el enlace a verlo en vivo. */
export default function Pasos({ decisionId, llamadas, titulo, subImagen }: {
  decisionId: number; llamadas: LlamadaModelo[]; titulo: string; subImagen: string;
}) {
  const f = useFormato();
  const { t } = f;
  const [pila, setPila] = useState<Vista[]>([]);
  const [compartir, setCompartir] = useState(false);
  const vistaRef = useRef<HTMLDivElement>(null);

  const { agente, revisores, resultados } = useMemo(() => ({
    agente: llamadas.filter(l => l.etapa === "agente"), revisores: llamadas.filter(l => l.etapa === "revisor"), resultados: resultadosDe(llamadas),
  }), [llamadas]);

  useLayoutEffect(() => {
    const caja = vistaRef.current?.parentElement;
    if (caja) caja.scrollTop = 0;
  }, [pila]);

  const pasos: Paso[] = useMemo(() => [
    ...agente.map((l, i): Paso => {
      const r = resumenVuelta(l, resultados, f);
      return { clave: `a${l.id}`, titulo: r.titulo, estado: l.ok ? "hecho" : "fallo", subMal: !l.ok,
        sub: l.ok ? r.sub || undefined : t("pnl_agente_pasos_fallo", { error: l.error ?? "" }), onClick: () => setPila([{ tipo: "vuelta", i }]) };
    }),
    ...revisores.map((l, i): Paso => ({
      clave: `r${l.id}`, titulo: t("pnl_agente_pasos_revisor"), estado: l.ok ? "hecho" : "fallo", subMal: !l.ok,
      sub: l.ok ? f.veredicto((leer(l.respuesta) as Obj | null)?.verdict) || undefined : t("pnl_agente_pasos_fallo", { error: l.error ?? "" }),
      onClick: () => setPila([{ tipo: "revisor", i }]),
    })),
  ], [agente, revisores, resultados, f, t]);

  const total = llamadas.reduce((a, l) => a + Number(l.coste_usd ?? 0), 0);
  const crear = useCallback(() => imagenPasos(titulo, subImagen,
    pasos.map(p => ({ titulo: p.titulo, sub: typeof p.sub === "string" ? p.sub : undefined, estado: p.estado, subMal: p.subMal })),
    t("pnl_agente_imagen_pie")), [pasos, titulo, subImagen, t]);

  const cab = t("pnl_agente_pasos_cab");
  if (!llamadas.length) {
    return <Grupo cabecera={cab}><Celda titulo={t("pnl_agente_pasos_sin_registro")} subtitulo={t("pnl_agente_pasos_sin_registro_sub")} /></Grupo>;
  }

  const empujar = (v: Vista) => setPila(p => [...p, v]);
  const tituloDe = (v: Vista): string => {
    if (v.tipo === "vuelta") return t("pnl_agente_pasos_vuelta", { n: v.i + 1 });
    if (v.tipo === "revisor") return t("pnl_agente_pasos_revisor");
    if (v.tipo === "contexto") return t("pnl_agente_pasos_al_despertar_titulo");
    if (v.tipo === "texto") return v.titulo;
    return [v.h.function.name, ...tickersDe(args(v.h)).slice(0, 2)].join(" · ");
  };
  const costeYTiempo = (l: LlamadaModelo) => (
    <Datos items={[{ etiqueta: t("pnl_agente_pasos_coste"), valor: f.coste(l.coste_usd) }, { etiqueta: t("pnl_agente_pasos_tiempo"), valor: f.segundos(l.latencia_ms) }]} />
  );

  const vistaVuelta = (i: number) => {
    const l = agente[i];
    const avisos = i > 0 ? l.enviado.filter(m => m.role === "user") : [];
    const hs = l.herramientas_pedidas;
    return (
      <>
        {i === 0 && (
          <Grupo><Celda titulo={t("pnl_agente_pasos_al_despertar")} subtitulo={t("pnl_agente_pasos_al_despertar_sub")} onClick={() => empujar({ tipo: "contexto" })} /></Grupo>
        )}
        {l.razonamiento && (
          <>
            <h2 className="pnl-cab-grupo">{t("pnl_agente_pasos_razonamiento")}</h2>
            <TextoAgente texto={l.razonamiento} />
            <p className="pnl-pie-grupo">{t("pnl_agente_pasos_razonamiento_pie")}</p>
          </>
        )}
        {avisos.length > 0 && (
          <Grupo cabecera={t("pnl_agente_pasos_aviso")}>
            {avisos.map((m, j) => <Celda key={j} titulo={m.content.startsWith("Last turn") ? t("pnl_agente_pasos_ultimo_turno") : m.content.slice(0, 80)} />)}
          </Grupo>
        )}
        {hs.length ? (
          <Grupo cabecera={t("pnl_agente_pasos_herramientas")}>
            {hs.map(h => {
              const a = args(h);
              const r = resultados.get(h.id);
              const error = esObj(r) && typeof r.error === "string" ? r.error : null;
              const sinFicha = esObj(r) && r.exists === false;
              const sub = error ?? (sinFicha ? t("pnl_agente_pasos_sin_ficha") : f.orden(a.sort));
              return <Celda key={h.id} titulo={tituloDe({ tipo: "herramienta", h })}
                subtitulo={sub && (error ? <span className="pa-fallo">{sub}</span> : sub)} onClick={() => empujar({ tipo: "herramienta", h })} />;
            })}
          </Grupo>
        ) : (
          <Grupo cabecera={t("pnl_agente_pasos_respondio")}><Celda titulo={t("pnl_agente_pasos_respondio_decision")} /></Grupo>
        )}
        {costeYTiempo(l)}
      </>
    );
  };

  const vistaRevisor = (i: number) => {
    const l = revisores[i];
    const r = leer(l.respuesta);
    const o = esObj(r) ? r : {};
    const [sistema, usuario] = [l.enviado.find(m => m.role === "system"), l.enviado.find(m => m.role === "user")];
    return (
      <>
        <Grupo cabecera={t("pnl_agente_pasos_veredicto")}>
          <Celda titulo={f.veredicto(o.verdict)} subtitulo={typeof o.reason === "string" ? o.reason : undefined} />
        </Grupo>
        <Grupo pie={t("pnl_agente_pasos_revisor_pie")}>
          <Celda titulo={t("pnl_agente_pasos_lo_que_vio")} subtitulo={t("pnl_agente_pasos_lo_que_vio_sub")}
            onClick={() => empujar({ tipo: "texto", titulo: t("pnl_agente_pasos_lo_que_vio"), texto: texto(usuario) })} />
          <Celda titulo={t("pnl_agente_pasos_sus_instrucciones")}
            onClick={() => empujar({ tipo: "texto", titulo: t("pnl_agente_pasos_instrucciones"), texto: texto(sistema) })} />
        </Grupo>
        {costeYTiempo(l)}
      </>
    );
  };

  const vistaContexto = () => {
    const primera = agente[0].enviado;
    const [sistema, usuario] = [primera.find(m => m.role === "system"), primera.find(m => m.role === "user")];
    return (
      <>
        <Grupo>
          <Celda titulo={t("pnl_agente_pasos_instrucciones_fijas")}
            onClick={() => empujar({ tipo: "texto", titulo: t("pnl_agente_pasos_instrucciones"), texto: texto(sistema) })} />
        </Grupo>
        <h2 className="pnl-cab-grupo">{t("pnl_agente_pasos_contexto_dia")}</h2>
        <TextoEnviado t={texto(usuario)} />
      </>
    );
  };

  const vistaHerramienta = (h: HerramientaPedida) => {
    const a = args(h);
    const r = resultados.get(h.id);
    return (
      <>
        {Object.keys(a).length > 0 && <><h2 className="pnl-cab-grupo">{t("pnl_agente_pasos_pidio")}</h2>{filasDe(a, f)}</>}
        <h2 className="pnl-cab-grupo">{t("pnl_agente_pasos_recibio")}</h2>
        {r === undefined ? <Grupo><Celda titulo={t("pnl_agente_pasos_sin_respuesta")} /></Grupo> : filasDe(r, f)}
      </>
    );
  };

  const cuerpo = (v: Vista) => {
    if (v.tipo === "vuelta") return vistaVuelta(v.i);
    if (v.tipo === "revisor") return vistaRevisor(v.i);
    if (v.tipo === "contexto") return vistaContexto();
    if (v.tipo === "texto") return <TextoEnviado t={v.texto} />;
    return vistaHerramienta(v.h);
  };

  const arriba = pila.at(-1);
  const previa = pila.at(-2);

  return (
    <>
      <div className="pnl-llega">
        <CabeceraCompartir titulo={cab} onCompartir={() => setCompartir(true)} />
        <Flujo pasos={pasos} />
        <p className="pnl-pie-grupo">{t("pnl_agente_pasos_pie", { n: agente.length, revisor: revisores.length ? "si" : "no", coste: f.coste(total) })}</p>
        <div className="pa-bloque">
          <Grupo>
            <Celda titulo={t("pnl_agente_envivo_ver")} subtitulo={t("pnl_agente_envivo_ver_sub")} href={`/admin/agente/en-vivo?decision=${decisionId}`} />
          </Grupo>
        </div>
      </div>
      <Hoja abierta={Boolean(arriba)} titulo={arriba ? tituloDe(arriba) : ""} accion={t("admin_pnl_listo")} onCerrar={() => setPila([])}
        atras={previa ? { texto: tituloDe(previa), onAtras: () => setPila(p => p.slice(0, -1)) } : undefined}>
        {arriba && <div className="pa-hoja pa-vista" key={pila.length} ref={vistaRef}>{cuerpo(arriba)}</div>}
      </Hoja>
      <HojaCompartir abierta={compartir} crear={crear} nombre={`alphagentic-decision-${decisionId}`} alt={titulo} onCerrar={() => setCompartir(false)} />
    </>
  );
}
