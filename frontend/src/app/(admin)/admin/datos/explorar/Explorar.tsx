"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { fetchExplorerContar, fetchExplorerOpciones, fetchExplorerTickers } from "@/lib/api";
import type { ExplorerContar, ExplorerFiltros, ExplorerOpciones, ExplorerTickerRow } from "@/lib/types";
import { useOrden } from "@/lib/useOrden";
import { numero } from "../../_marco/formato";
import { Buscador, Celda, ChipFiltro, Chips, Datos, Esqueleto, Grupo, Hoja, Segmentado, Vacio } from "../../_panel/ui";
import "../datos.css";

type Orden = "ticker" | "market_cap_usd" | "price" | "pe_trailing" | "captured_at";
const ORDENES: Orden[] = ["ticker", "market_cap_usd", "price", "pe_trailing", "captured_at"];
const POR_PAGINA = 25;
const ESPERA_MS = 400;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const acceso = (fila: ExplorerTickerRow, clave: Orden) => fila[clave];
type Alcance = "" | "escaneo" | "global";

/** Chips de varias opciones; con muchas, se enseñan unas pocas y «+N más» abre el resto. */
function Opciones({ titulo, opciones, elegidas, alternar, max = 24 }: {
  titulo: string; opciones: string[]; elegidas: string[]; alternar: (v: string) => void; max?: number;
}) {
  const t = useTranslations();
  const [todas, setTodas] = useState(false);
  if (opciones.length === 0) return null;
  return (
    <>
      <p className="pd-etiqueta">{titulo}</p>
      <Chips etiqueta={titulo}>
        {(todas ? opciones : opciones.slice(0, max)).map(o => (
          <ChipFiltro key={o} activo={elegidas.includes(o)} onClick={() => alternar(o)}>{o}</ChipFiltro>
        ))}
        {!todas && opciones.length > max && (
          <button type="button" className="pd-mas" onClick={() => setTodas(true)}>{t("pnl_datos_mas", { n: opciones.length - max })}</button>
        )}
      </Chips>
    </>
  );
}

function Rango({ titulo, min, max, onMin, onMax }: { titulo: string; min: string; max: string; onMin: (v: string) => void; onMax: (v: string) => void }) {
  const t = useTranslations();
  return (
    <>
      <p className="pd-etiqueta">{titulo}</p>
      <div className="pd-fila-campos">
        <input className="pd-campo" type="text" inputMode="decimal" placeholder={t("pnl_datos_minimo")} aria-label={`${titulo}: ${t("pnl_datos_minimo")}`} value={min} onChange={e => onMin(e.target.value)} />
        <input className="pd-campo" type="text" inputMode="decimal" placeholder={t("pnl_datos_maximo")} aria-label={`${titulo}: ${t("pnl_datos_maximo")}`} value={max} onChange={e => onMax(e.target.value)} />
      </div>
    </>
  );
}

const numeroONada = (v: string) => (v.trim() !== "" && Number.isFinite(Number(v.replace(",", "."))) ? Number(v.replace(",", ".")) : undefined);

export default function Explorar() {
  const t = useTranslations();
  const locale = useLocale();
  const [opciones, setOpciones] = useState<ExplorerOpciones | null>(null);
  const [falloOpciones, setFalloOpciones] = useState(false);
  const [q, setQ] = useState("");
  const [alcance, setAlcance] = useState<Alcance>("");
  const [sector, setSector] = useState<string[]>([]);
  const [pais, setPais] = useState<string[]>([]);
  const [mercado, setMercado] = useState<string[]>([]);
  const [industria, setIndustria] = useState<string[]>([]);
  const [capMin, setCapMin] = useState(""); const [capMax, setCapMax] = useState("");
  const [peMin, setPeMin] = useState(""); const [peMax, setPeMax] = useState("");
  const [cerca, setCerca] = useState("");
  const [desde, setDesde] = useState(""); const [hasta, setHasta] = useState("");
  const [filtrosAbiertos, setFiltrosAbiertos] = useState(false);

  const [resultado, setResultado] = useState<ExplorerContar | null>(null);
  const [falloContar, setFalloContar] = useState(false);
  const [items, setItems] = useState<ExplorerTickerRow[]>([]);
  const [total, setTotal] = useState(0);
  const [pagina, setPagina] = useState(0);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    fetchExplorerOpciones().then(setOpciones).catch(() => setFalloOpciones(true));
  }, []);

  const filtros: ExplorerFiltros = useMemo(() => {
    const cap = (v: string) => { const n = numeroONada(v); return n === undefined ? undefined : n * 1e9; };
    return {
      fecha_desde: FECHA.test(desde) ? desde : undefined, fecha_hasta: FECHA.test(hasta) ? hasta : undefined,
      alcance: alcance || undefined, sector, pais, mercado, industria, q: q.trim() || undefined,
      market_cap_min: cap(capMin), market_cap_max: cap(capMax),
      pe_trailing_min: numeroONada(peMin), pe_trailing_max: numeroONada(peMax), cerca_max_pct: numeroONada(cerca),
    };
  }, [q, alcance, sector, pais, mercado, industria, capMin, capMax, peMin, peMax, cerca, desde, hasta]);
  const clave = JSON.stringify(filtros);

  // El recuento y la tabla se piden al backend con una espera corta; la tabla vuelve a la primera página al cambiar el filtro.
  useEffect(() => { setPagina(0); }, [clave]);
  useEffect(() => {
    let vivo = true;
    const timer = setTimeout(() => {
      setFalloContar(false);
      fetchExplorerContar(filtros).then(r => { if (vivo) setResultado(r); }).catch(() => { if (vivo) setFalloContar(true); });
    }, ESPERA_MS);
    return () => { vivo = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave]);
  useEffect(() => {
    let vivo = true;
    setCargando(true);
    const timer = setTimeout(() => {
      fetchExplorerTickers(filtros, POR_PAGINA, pagina * POR_PAGINA)
        .then(r => { if (vivo) { setItems(r.items); setTotal(r.total); } })
        .catch(() => { if (vivo) { setItems([]); setTotal(0); } })
        .finally(() => { if (vivo) setCargando(false); });
    }, ESPERA_MS);
    return () => { vivo = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave, pagina]);

  // Orden solo sobre la página cargada: la paginación es del servidor.
  const { sorted, sortKey, sortDir, toggle } = useOrden<ExplorerTickerRow, Orden>(items, acceso);
  const alterna = (lista: string[], poner: (v: string[]) => void) => (v: string) => poner(lista.includes(v) ? lista.filter(x => x !== v) : [...lista, v]);
  const hayFiltros = Boolean(q || alcance || sector.length || pais.length || mercado.length || industria.length
    || capMin || capMax || peMin || peMax || cerca || desde || hasta);
  const limpiar = () => {
    setQ(""); setAlcance(""); setSector([]); setPais([]); setMercado([]); setIndustria([]);
    setCapMin(""); setCapMax(""); setPeMin(""); setPeMax(""); setCerca(""); setDesde(""); setHasta("");
  };
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const dec = (n: number, d = 1) => n.toLocaleString(locale, { minimumFractionDigits: d, maximumFractionDigits: d });
  const cap = (n: number) => `${dec(n / 1e9)}${" "}${t("pnl_datos_mil_millones")}`;
  const dist = resultado?.distribuciones;
  const activos = [sector, pais, mercado, industria].reduce((a, l) => a + l.length, 0)
    + [capMin || capMax, peMin || peMax, cerca, desde || hasta].filter(Boolean).length;

  return (
    <div className="pnl-llega">
      <Buscador valor={q} onCambio={setQ} etiqueta={t("pnl_datos_buscar")} />
      <Segmentado etiquetaGrupo={t("pnl_datos_alcance_ex")} valor={alcance} onChange={setAlcance}
        opciones={[{ valor: "", etiqueta: t("pnl_datos_todo") }, { valor: "escaneo", etiqueta: t("pnl_datos_escaneo") }, { valor: "global", etiqueta: t("pnl_datos_global") }]} />
      <Grupo pie={t("pnl_datos_explorar_pie")}>
        <Celda titulo={t("pnl_datos_filtros")} valor={activos ? String(activos) : undefined} onClick={() => setFiltrosAbiertos(true)} />
        {hayFiltros && <Celda titulo={t("pnl_datos_limpiar")} tono="accion" onClick={limpiar} />}
      </Grupo>

      {falloContar ? <p className="pnl-pie-grupo" role="alert">{t("admin_generic_error")}</p> : resultado && (
        <>
          <h2 className="pnl-cab-grupo">{t("pnl_datos_empresas", { n: numero(resultado.total, locale) })}</h2>
          {resultado.total > 0 && (
            <Datos items={[
              { etiqueta: t("pnl_datos_cap_mediana"), valor: dist?.market_cap_usd ? cap(dist.market_cap_usd.p50) : "-" },
              { etiqueta: t("pnl_datos_precio_mediano"), valor: dist?.price ? `$${dec(dist.price.p50, 2)}` : "-" },
              { etiqueta: t("pnl_datos_per_mediano"), valor: dist?.pe_trailing ? dec(dist.pe_trailing.p50) : "-" },
              { etiqueta: t("pnl_datos_per_futuro"), valor: dist?.pe_forward ? dec(dist.pe_forward.p50) : "-" },
            ]} />
          )}
        </>
      )}

      {resultado && resultado.total > 0 && (
        <>
          <Chips etiqueta={t("pnl_datos_ordenar")}>
            {ORDENES.map(o => (
              <ChipFiltro key={o} activo={sortKey === o} onClick={() => toggle(o)}>
                <span className="pd-ordena">{t(`pnl_datos_orden_${o}`)}{sortKey === o ? (sortDir === "desc" ? " ↓" : " ↑") : ""}</span>
              </ChipFiltro>
            ))}
          </Chips>
          {cargando ? <Esqueleto filas={6} etiqueta={t("admin_pnl_cargando")} /> : (
            items.length === 0 ? <Vacio titulo={t("pnl_datos_sin_resultados")} /> : (
              <Grupo>
                {sorted.map(r => (
                  <Celda key={r.ticker} titulo={r.ticker}
                    subtitulo={[r.name, r.sector, r.country, r.market_cap_usd != null ? cap(r.market_cap_usd) : null,
                      r.price != null ? `$${dec(r.price, 2)}` : null,
                      filtros.fecha_desde || filtros.fecha_hasta ? new Date(r.captured_at).toLocaleDateString(locale, { day: "numeric", month: "short", timeZone: "UTC" }) : null]
                      .filter(Boolean).join(" · ")}
                    valor={r.pe_trailing != null ? dec(r.pe_trailing) : "-"} />
                ))}
              </Grupo>
            )
          )}
          {paginas > 1 && (
            <Grupo>
              <Celda titulo={t("pnl_datos_anterior")} onClick={() => setPagina(p => Math.max(0, p - 1))} deshabilitada={pagina === 0} />
              <Celda titulo={t("pnl_datos_siguiente")} onClick={() => setPagina(p => Math.min(paginas - 1, p + 1))} deshabilitada={pagina >= paginas - 1} />
            </Grupo>
          )}
          {paginas > 1 && <p className="pd-pagina-cuenta">{pagina + 1} / {paginas}</p>}
        </>
      )}
      {resultado && resultado.total === 0 && <Vacio titulo={t("pnl_datos_sin_resultados")} texto={t("pnl_datos_sin_resultados_texto")} />}

      <Hoja abierta={filtrosAbiertos} titulo={t("pnl_datos_filtros")} accion={t("pnl_datos_listo")} onCerrar={() => setFiltrosAbiertos(false)}>
        <div className="pd-pad">
          {falloOpciones && <p className="pnl-pie-grupo" role="alert">{t("pnl_datos_sin_opciones")}</p>}
          {opciones && (
            <>
              <Opciones titulo={t("pnl_datos_sector")} opciones={opciones.sectores} elegidas={sector} alternar={alterna(sector, setSector)} />
              <Opciones titulo={t("pnl_datos_pais")} opciones={opciones.paises} elegidas={pais} alternar={alterna(pais, setPais)} />
              <Opciones titulo={t("pnl_datos_mercado")} opciones={opciones.mercados} elegidas={mercado} alternar={alterna(mercado, setMercado)} />
              <Opciones titulo={t("pnl_datos_industria")} opciones={opciones.industrias} elegidas={industria} alternar={alterna(industria, setIndustria)} max={12} />
            </>
          )}
          <Rango titulo={t("pnl_datos_cap_rango")} min={capMin} max={capMax} onMin={setCapMin} onMax={setCapMax} />
          <Rango titulo={t("pnl_datos_per_rango")} min={peMin} max={peMax} onMin={setPeMin} onMax={setPeMax} />
          <p className="pd-etiqueta">{t("pnl_datos_cerca")}</p>
          <div className="pd-fila-campos">
            <input className="pd-campo" type="text" inputMode="decimal" placeholder={t("pnl_datos_cerca_ej")} aria-label={t("pnl_datos_cerca")} value={cerca} onChange={e => setCerca(e.target.value)} />
          </div>
          <p className="pnl-pie-grupo">{t("pnl_datos_cerca_ayuda")}</p>
          <Rango titulo={t("pnl_datos_fotos_entre")} min={desde} max={hasta} onMin={setDesde} onMax={setHasta} />
          <p className="pnl-pie-grupo">{t("pnl_datos_fotos_ayuda")}</p>
        </div>
      </Hoja>
    </div>
  );
}
