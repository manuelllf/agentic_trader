"use client";

import { ACTUALIZACION_VISIBLE, LECTURA_VISIBLE } from "@/lib/liga/funciones";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { normalizeLocale } from "@/i18n/locale";
import type { EmpresaBusqueda, EmpresaElegida, PreviewSeleccion, RecetaEntrada } from "@/lib/liga/api";
import { miles, signo } from "@/lib/liga/format";
import { Hoja } from "../_ui/Hoja";
import { ActualizarHoy } from "./ActualizarHoy";
import { CabGrupo, Chevron, IconoArribaAbajo, IconoCheckMenu, IconoLupa, IconoMas, Marca } from "./piezas";

export type PropsCartera = {
  preview: PreviewSeleccion | null; nEmpresas: number; reparto: string; maxPorSector: number;
  sectores: Record<string, string>; excluidas: string[];
  cambio: { entra: string; sale: string } | null;
  actualizarB: (cambios: Partial<Pick<RecetaEntrada, "n_empresas" | "reparto" | "max_por_sector">>) => void;
  cambiar: (ticker: string) => void; recuperar: (ticker: string) => void;
  leer: (ticker: string) => void; lecturas: string[];
  busca: string; buscar: (texto: string) => void; sugerencias: EmpresaBusqueda[];
  preguntar: (empresa: EmpresaBusqueda) => void; porque: { nombre: string; texto: string } | null;
  cadaDia1: "revisar" | "mantener"; cambiarCadaDia1: (valor: "revisar" | "mantener") => void;
  irReglas: () => void;
  receta?: RecetaEntrada; estrategiaId?: string; alActualizar?: () => void;
  children?: ReactNode;
};

const NOTAS = [["negocio", "builder_fundamentals"], ["precio", "builder_valuation"],
  ["deuda", "builder_financial_strength"], ["pronto", "builder_near_term_catalyst"]] as const;
const METRICAS = ["per", "margen_operativo", "crecimiento", "dividendo_medio", "beta"] as const;

/** Baldosa con el ticker: letra un punto más pequeña con cinco letras para que quepa. */
function Baldosa({ ticker, entra = false }: { ticker: string; entra?: boolean }) {
  return <span className={`cr-tile${entra ? " entra" : ""}${ticker.length >= 5 ? " largo" : ""}`} aria-hidden="true">{ticker}</span>;
}

/** Fila con menú anclado (pop-up de iOS): la opción elegida lleva marca. */
function FilaMenu<V extends string | number>({ titulo, valor, opciones, abierta, alAbrir, alCerrar, alElegir }: {
  titulo: string; valor: V; opciones: { valor: V; etiqueta: string }[];
  abierta: boolean; alAbrir: () => void; alCerrar: () => void; alElegir: (v: V) => void;
}) {
  const raiz = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!abierta) return;
    const fuera = (e: PointerEvent) => { if (!raiz.current?.contains(e.target as Node)) alCerrar(); };
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") alCerrar(); };
    document.addEventListener("pointerdown", fuera);
    document.addEventListener("keydown", tecla);
    return () => { document.removeEventListener("pointerdown", fuera); document.removeEventListener("keydown", tecla); };
  }, [abierta, alCerrar]);
  const actual = opciones.find(o => o.valor === valor);
  return <div className="cr-celda popup" ref={raiz}>
    <span className="t"><b className="normal">{titulo}</b></span>
    <button type="button" className="valor" aria-haspopup="menu" aria-expanded={abierta} aria-label={`${titulo}: ${actual?.etiqueta ?? ""}`}
      onClick={() => (abierta ? alCerrar() : alAbrir())}>{actual?.etiqueta}<IconoArribaAbajo /></button>
    <span />
    {abierta && <div className="cr-menu" role="menu" aria-label={titulo}>{opciones.map(o => <button type="button" key={String(o.valor)}
      role="menuitemradio" aria-checked={o.valor === valor} onClick={() => { alElegir(o.valor); alCerrar(); }}>
      {o.valor === valor ? <IconoCheckMenu /> : <span />}<span>{o.etiqueta}</span></button>)}</div>}
  </div>;
}

export function PasoCartera(p: PropsCartera) {
  const t = useTranslations(), locale = normalizeLocale(useLocale()) ?? "es";
  const [menu, setMenu] = useState<"n" | "reparto" | "sector" | null>(null);
  const [empresa, setEmpresa] = useState<string | null>(null);
  const numero = (v: number, dec = 1) => signo(v, dec, locale).replace(/^\+/, "");
  const pct = (v: number, dec = 1) => `${numero(v, dec)} %`;
  const elegidas = p.preview?.elegidas ?? [], perfil = p.preview?.perfil;
  const huecos = p.preview ? Math.max(0, p.nEmpresas - elegidas.length) : 0;
  const sector = (s: string | null | undefined) => s ? p.sectores[s] ?? s : t("builder_no_sector");
  const corta = (k?: string | null) => t(`builder_nota_corta_${k && ["negocio", "precio", "deuda", "pronto"].includes(k) ? k : "negocio"}`);
  const sub = (e: EmpresaElegida) => p.cambio?.entra === e.ticker ? <small className="tinte">{t("builder_cartera_en_lugar", { ticker: p.cambio.sale })}</small>
    : <small>{e.nota != null && e.mejor ? t("builder_cartera_nota_destaca", { score: numero(e.nota, 0), criterion: corta(e.mejor) }) : e.porque}</small>;
  const abierta = elegidas.find(e => e.ticker === empresa);
  const cerrarMenu = () => setMenu(null);
  // La caja ya es una fila de la lista: no se repite como aviso.
  const avisos = (p.preview?.avisos ?? []).filter(a => a.codigo !== "caja");

  return <div className="paso-cartera">
    <div className="cr-grupo cartera-config" style={{ marginTop: 16 }}>
      <FilaMenu titulo={t("builder_cartera_empresas")} valor={p.nEmpresas} abierta={menu === "n"} alAbrir={() => setMenu("n")} alCerrar={cerrarMenu}
        opciones={[3, 5, 7, 10].map(n => ({ valor: n, etiqueta: String(n) }))} alElegir={n => p.actualizarB({ n_empresas: n })} />
      <FilaMenu titulo={t("builder_cartera_reparto")} valor={p.reparto} abierta={menu === "reparto"} alAbrir={() => setMenu("reparto")} alCerrar={cerrarMenu}
        opciones={[{ valor: "igual", etiqueta: t("builder_equal_weights") }, { valor: "nota", etiqueta: t("builder_reparto_nota_largo") }]}
        alElegir={r => p.actualizarB({ reparto: r })} />
      <FilaMenu titulo={t("builder_max_per_sector")} valor={p.maxPorSector} abierta={menu === "sector"} alAbrir={() => setMenu("sector")} alCerrar={cerrarMenu}
        opciones={[0, 1, 2, 3].map(n => ({ valor: n, etiqueta: n ? String(n) : t("builder_cartera_sin_limite") }))}
        alElegir={n => p.actualizarB({ max_por_sector: n })} />
    </div>

    <CabGrupo derecha={elegidas.length ? t("builder_cartera_peso") : undefined}>
      {elegidas.length ? t("builder_cartera_entran", { count: elegidas.length }) : t("builder_cartera_ninguna")}</CabGrupo>
    {elegidas.length || huecos ? <ul className="cr-grupo cr-lista-cartera">
      {elegidas.map(e => <li key={e.ticker}><button type="button" className="cr-celda con-tile cr-empresa" aria-haspopup="dialog" onClick={() => setEmpresa(e.ticker)}>
        <Baldosa ticker={e.ticker} entra={p.cambio?.entra === e.ticker} />
        <span className="t"><b>{e.nombre ?? e.ticker}</b>{sub(e)}</span>
        <span className="valor ink num">{pct(e.peso, 0)}</span><Chevron />
      </button></li>)}
      {huecos > 0 && <li className="cr-celda con-tile cartera-hueco"><span className="cr-tile" aria-hidden="true">–</span>
        <span className="t"><b className="normal suave">{t("builder_live_cash", { count: huecos })}</b><small>{t("builder_cartera_hueco")}</small></span>
        <span className="valor num">{pct(p.preview?.caja_pct ?? 0, 0)}</span><span /></li>}
    </ul> : <div className="cr-grupo"><button type="button" className="cr-celda accion" onClick={p.irReglas}>
      <IconoMas /><span className="t"><b className="normal">{t("builder_revisar_reglas")}</b></span></button></div>}
    <p className="cr-pie">{t("builder_cartera_pie")}</p>
    {p.children}
    {ACTUALIZACION_VISIBLE && p.receta && p.alActualizar && <ActualizarHoy receta={p.receta} estrategiaId={p.estrategiaId} alActualizar={p.alActualizar} />}

    {p.excluidas.length > 0 && <>
      <CabGrupo>{t("builder_cartera_quitadas")}</CabGrupo>
      <div className="cr-grupo cartera-quitadas">{p.excluidas.map(ticker => <div className="cr-celda con-tile" key={ticker}>
        <Baldosa ticker={ticker} /><span className="t"><b className="normal">{ticker}</b></span>
        <button type="button" className="cr-enlace pequeno" aria-label={t("builder_cartera_recuperar", { ticker })} onClick={() => p.recuperar(ticker)}>{t("builder_recuperar")}</button><span />
      </div>)}</div></>}

    <CabGrupo>{t("builder_cartera_otra")}</CabGrupo>
    <div className="cr-grupo">
      <div className="cr-bloque"><label className="cr-buscar"><IconoLupa />
        <input id="cartera-otra" type="search" autoComplete="off" aria-label={t("builder_cartera_otra")} placeholder={t("builder_cartera_buscar")}
          value={p.busca} onChange={e => p.buscar(e.target.value)} /></label></div>
      {p.sugerencias.map(e => <button type="button" className="cr-celda con-tile" key={e.ticker} onClick={() => p.preguntar(e)}>
        <Baldosa ticker={e.ticker} /><span className="t"><b className="normal">{e.nombre ?? e.ticker}</b></span><span /><Chevron /></button>)}
      {p.porque && <div className="cr-bloque cr-texto" role="status"><p><b>{p.porque.nombre}:</b> {p.porque.texto}</p></div>}
    </div>

    <CabGrupo>{t("builder_every_first_day")}</CabGrupo>
    <div className="cr-grupo" role="radiogroup" aria-label={t("builder_every_first_day")}>{(["revisar", "mantener"] as const).map(v =>
      <button type="button" className="cr-celda" role="radio" aria-checked={p.cadaDia1 === v} key={v} onClick={() => p.cambiarCadaDia1(v)}>
        <span className="t"><b className="normal">{t(v === "revisar" ? "builder_review_strategy" : "builder_keep_strategy")}</b>
          <small>{t(v === "revisar" ? "builder_review_strategy_help" : "builder_keep_strategy_help")}</small></span>
        <span /><Marca marcada={p.cadaDia1 === v} /></button>)}</div>

    {perfil && elegidas.length > 0 && <section aria-labelledby="cartera-frente">
      <CabGrupo><span id="cartera-frente">{t("builder_cartera_frente")}</span></CabGrupo>
      <div className="cr-grupo cartera-perfil">
        <div className="cr-celda cr-comp cab"><span /><span className="c">{t("builder_cartera_tuya")}</span><span className="c">{t("builder_cartera_mercado")}</span></div>
        {METRICAS.map(k => <div className="cr-celda cr-comp" key={k}><span>{t(`builder_cartera_${k}`)}</span>
          {[perfil.cartera, perfil.mercado].map((m, i) => <span className={`c num ${i ? "merc" : "tuya"}`} key={i}>
            {m[k] == null ? "–" : k === "per" || k === "beta" ? numero(m[k]!, k === "beta" ? 2 : 1) : pct(m[k]!)}</span>)}</div>)}
        {perfil.sectores.map(s => <div className="cr-celda cr-sector" key={s.sector}><span>{sector(s.sector)}</span>
          <span className="cr-riel" aria-hidden="true"><span style={{ width: `${Math.min(100, Math.max(0, s.peso))}%` }} />
            <i style={{ left: `${Math.min(100, Math.max(0, s.cuota_mercado))}%` }} /></span>
          <span className="valor ink num">{pct(s.peso, 0)}</span></div>)}
      </div>
      <p className="cr-pie">{t("builder_cartera_leyenda")}</p>
    </section>}
    <div aria-live="polite">{avisos.map((a, i) => <p className="cr-pie aviso-cartera" key={`${a.codigo}-${i}`}>
      {t(`builder_aviso_${a.codigo}`, { count: miles(a.huecos ?? a.n ?? 0, locale), percent: pct(a.pct ?? a.cuota ?? 0, 0), sector: sector(a.sector) })}</p>)}</div>

    <Hoja abierta={!!abierta} titulo={abierta?.nombre ?? abierta?.ticker ?? ""} accion={t("builder_listo")} onCerrar={() => setEmpresa(null)}>
      {abierta && <div className="cr-hoja-pad">
        <p className="cr-valor-sub" style={{ marginTop: 4 }}>{abierta.ticker} · {sector(abierta.sector)}</p>
        <p className="cr-valor-gr num">{pct(abierta.peso, 0)}</p>
        <p className="cr-valor-sub">{t("builder_empresa_de_cartera")}</p>
        <CabGrupo>{t("builder_empresa_porque")}</CabGrupo>
        <div className="cr-grupo">
          <div className="cr-bloque cr-texto"><p>{abierta.nota != null && abierta.mejor
            ? t("builder_empresa_porque_texto", { score: numero(abierta.nota, 0), criterion: corta(abierta.mejor) })
            : abierta.porque}</p></div>
          {abierta.notas && <div className="cr-bloque"><div className="cr-notas">{NOTAS.map(([k, titulo]) => abierta.notas?.[k] != null &&
            <div className="cr-nota" key={k}><span>{t(titulo)}</span>
              <span className="cr-riel" aria-hidden="true"><span style={{ width: `${abierta.notas[k]}%` }} /></span>
              <span className="num">{abierta.notas[k]}</span></div>)}</div></div>}
        </div>
        <div className="cr-grupo" style={{ marginTop: 20 }}>
          {p.cambio?.entra === abierta.ticker && <button type="button" className="cr-celda centrada" onClick={() => { p.recuperar(p.cambio!.sale); setEmpresa(null); }}>
            {t("builder_undo")}</button>}
          {LECTURA_VISIBLE && <button type="button" className="cr-celda centrada" onClick={() => p.leer(abierta.ticker)}>
            {t(p.lecturas.includes(abierta.ticker) ? "builder_view_report" : "builder_read_deep")}</button>}
          <button type="button" className="cr-celda centrada" onClick={() => { p.cambiar(abierta.ticker); setEmpresa(null); }}>
            {t("builder_cambiar_por_otra")}</button>
        </div>
        <p className="cr-pie">{t("builder_cambiar_pie", { ticker: abierta.ticker })}</p>
      </div>}
    </Hoja>
  </div>;
}
