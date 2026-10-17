"use client";

import { ACTUALIZACION_VISIBLE, LECTURA_VISIBLE } from "@/lib/liga/funciones";
import type { ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { normalizeLocale } from "@/i18n/locale";
import type { EmpresaBusqueda, PreviewSeleccion, RecetaEntrada } from "@/lib/liga/api";
import { miles, signo } from "@/lib/liga/format";
import { ActualizarHoy } from "./ActualizarHoy";
import { OpcionRadio, Segmentado } from "../_ui";

export type PropsCartera = {
  preview: PreviewSeleccion | null; nEmpresas: number; reparto: string; maxPorSector: number;
  sectores: Record<string, string>; criterios: Record<string, string>; excluidas: string[];
  cambio: { entra: string; sale: string } | null;
  actualizarB: (cambios: Partial<Pick<RecetaEntrada, "n_empresas" | "reparto" | "max_por_sector">>) => void;
  cambiar: (ticker: string) => void; recuperar: (ticker: string) => void;
  leer: (ticker: string) => void; lecturas: string[];
  busca: string; buscar: (texto: string) => void; sugerencias: EmpresaBusqueda[];
  preguntar: (empresa: EmpresaBusqueda) => void; porque: { nombre: string; texto: string } | null;
  cadaDia1: "revisar" | "mantener"; cambiarCadaDia1: (valor: "revisar" | "mantener") => void;
  receta?: RecetaEntrada; estrategiaId?: string; alActualizar?: () => void;
  children?: ReactNode;
};

export function PasoCartera(p: PropsCartera) {
  const t = useTranslations(), locale = normalizeLocale(useLocale()) ?? "es";
  const numero = (v: number, dec = 1) => signo(v, dec, locale).replace(/^\+/, "");
  const pct = (v: number) => `${numero(v)}\u00a0%`;
  const elegidas = p.preview?.elegidas ?? [], perfil = p.preview?.perfil;
  const huecos = p.preview ? Math.max(0, p.nEmpresas - elegidas.length) : 0;
  const sector = (s: string | null | undefined) => s ? p.sectores[s] ?? s : t("builder_no_sector");
  const tamanos = perfil ? Object.entries(perfil.tamanos).filter(([, n]) => n > 0)
    .map(([banda, n]) => t(`builder_cartera_tamano_${banda}`, { count: miles(n, locale) })).join(", ") : "-";
  return <div className="paso-cartera">
    <div>
      <div className="cartera-config">
        <div className="cartera-ajuste"><span className="lbl">{t("builder_cartera_empresas")}</span>
          <Segmentado etiquetaGrupo={t("builder_cartera_empresas")} valor={p.nEmpresas}
            opciones={[3, 5, 7, 10].map(n => ({ valor: n, etiqueta: String(n) }))} onChange={n => p.actualizarB({ n_empresas: n })} /></div>
        <div className="cartera-ajuste"><span className="lbl">{t("builder_cartera_reparto")}</span>
          <Segmentado etiquetaGrupo={t("builder_cartera_reparto")} valor={p.reparto}
            opciones={["igual", "nota"].map(r => ({ valor: r, etiqueta: t(`builder_cartera_reparto_${r}`) }))} onChange={r => p.actualizarB({ reparto: r })} /></div>
        <div className="cartera-ajuste"><span className="lbl">{t("builder_cartera_sector")}</span>
          <Segmentado etiquetaGrupo={t("builder_cartera_sector")} valor={p.maxPorSector}
            opciones={[0, 1, 2, 3].map(n => ({ valor: n, etiqueta: n ? String(n) : t("builder_cartera_sin_limite") }))} onChange={n => p.actualizarB({ max_por_sector: n })} /></div>
      </div>
      <section className="paso-bloque" aria-labelledby="cartera-entran">
        <h2 id="cartera-entran" className="sec-t">{t("builder_cartera_entran", { count: elegidas.length })}</h2>
        {!elegidas.length && p.preview && <p className="fine">{t("builder_cartera_vacia")}</p>}
        <ul className="cartera-lista">{elegidas.map(e => <li className="pick" key={e.ticker}>
          <div><b>{e.nombre ?? e.ticker}</b>
            <span>{e.ticker} · {sector(e.sector)}</span>
            <small>{p.cambio?.entra === e.ticker ? t("builder_replaces_ticker", { ticker: p.cambio.sale })
              : e.nota != null && e.mejor ? t("builder_cartera_porque", { score: numero(e.nota, 0), criterion: p.criterios[e.mejor] ?? e.mejor }) : e.porque}</small>
            <div className="links">
              {p.cambio?.entra === e.ticker && <button type="button" className="link" onClick={() => p.recuperar(p.cambio!.sale)}>{t("builder_undo")}</button>}
              {LECTURA_VISIBLE && <button type="button" className="link" onClick={() => p.leer(e.ticker)}>{t(p.lecturas.includes(e.ticker) ? "builder_view_report" : "builder_read_deep")}</button>}
            </div>
          </div>
          <div className="pick-r"><span className="num">{pct(e.peso)}</span><button type="button" onClick={() => p.cambiar(e.ticker)}>{t("builder_change_company")}</button></div>
        </li>)}
          {huecos > 0 && elegidas.length > 0 && <li className="pick cartera-hueco">
            <div><b>{t("builder_live_cash", { count: huecos })}</b><span>{t("builder_cartera_hueco")}</span></div>
            <div className="pick-r"><span className="num">{pct(p.preview?.caja_pct ?? 0)}</span></div>
          </li>}</ul>
        {p.excluidas.length > 0 && <div className="cartera-quitadas"><span className="lbl">{t("builder_cartera_quitadas")}</span>
          <div className="sugg">{p.excluidas.map(ticker => <button type="button" key={ticker} onClick={() => p.recuperar(ticker)}>{t("builder_cartera_recuperar", { ticker })}</button>)}</div></div>}
        {ACTUALIZACION_VISIBLE && p.receta && p.alActualizar && <ActualizarHoy receta={p.receta} estrategiaId={p.estrategiaId} alActualizar={p.alActualizar} />}
        {p.children}
      </section>
      <section className="paso-bloque">
        <label className="lbl" htmlFor="cartera-otra">{t("builder_cartera_otra")}</label>
        <input id="cartera-otra" type="search" className="inp" autoComplete="off" placeholder={t("builder_cartera_buscar")} value={p.busca} onChange={e => p.buscar(e.target.value)} />
        <div className="sugg">{p.sugerencias.map(e => <button type="button" key={e.ticker} onClick={() => p.preguntar(e)}>{e.nombre ?? e.ticker} · {e.ticker}</button>)}</div>
        {p.porque && <p className="why" role="status">{p.porque.nombre}: {p.porque.texto}</p>}
      </section>
      <section className="paso-bloque" aria-labelledby="cartera-dia1"><h2 id="cartera-dia1" className="sec-t">{t("builder_every_first_day")}</h2>
        <div role="radiogroup" aria-labelledby="cartera-dia1">{(["revisar", "mantener"] as const).map(v => <OpcionRadio key={v} marcada={p.cadaDia1 === v} titulo={t(v === "revisar" ? "builder_review_strategy" : "builder_keep_strategy")} ayuda={t(v === "revisar" ? "builder_review_strategy_help" : "builder_keep_strategy_help")} onClick={() => p.cambiarCadaDia1(v)} />)}</div>
      </section>
    </div>
    <aside className="cartera-perfil" aria-labelledby="cartera-frente"><h2 id="cartera-frente" className="sec-t">{t("builder_cartera_frente")}</h2>
      {perfil ? <>
        <table><thead><tr><th scope="col">{t("builder_cartera_metrica")}</th><th scope="col">{t("builder_cartera_tuya")}</th><th scope="col">{t("builder_cartera_mercado")}</th></tr></thead><tbody>
          {(["per", "margen_operativo", "crecimiento", "dividendo_medio", "beta"] as const).map(k => <tr key={k}><th scope="row">{t(`builder_cartera_${k}`)}</th>{[perfil.cartera, perfil.mercado].map((m, i) => <td className="num" key={i}>{m[k] == null ? "-" : k === "per" || k === "beta" ? numero(m[k], k === "beta" ? 2 : 1) : pct(m[k])}</td>)}</tr>)}
          <tr><th scope="row">{t("builder_cartera_tamano")}</th><td>{tamanos || "-"}</td><td>-</td></tr>
        </tbody></table>
        <div className="cartera-sectores">{perfil.sectores.map(s => <div className="cartera-sector" key={s.sector}>
          <span>{sector(s.sector)}</span><span className="cartera-riel"><span style={{ width: `${Math.min(100, Math.max(0, s.peso))}%` }} /><i style={{ left: `${Math.min(100, Math.max(0, s.cuota_mercado))}%` }} /></span>
          <span className="num">{pct(s.peso)}<small>{t("builder_cartera_mercado_peso", { percent: pct(s.cuota_mercado) })}</small></span>
        </div>)}</div>
        <p className="cartera-leyenda fine"><span><i />{t("builder_cartera_tuya")}</span><span><i />{t("builder_cartera_marca")}</span></p>
      </> : <p className="fine">{t("builder_cartera_perfil_vacio")}</p>}
      <div aria-live="polite">{p.preview?.avisos?.filter(a => a.codigo !== "caja").map((a, i) => <p className="callout" key={`${a.codigo}-${i}`}>{t(`builder_aviso_${a.codigo}`, { count: miles(a.huecos ?? a.n ?? 0, locale), percent: pct(a.pct ?? a.cuota ?? 0), sector: sector(a.sector) })}</p>)}</div>
    </aside>
  </div>;
}
