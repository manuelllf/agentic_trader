"use client";

import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { dolares, porcentajeConSigno } from "../_marco/formato";
import { Buscador, Celda, Grupo, Segmentado, Vacio } from "../_panel/ui";
import { Carga, Pagina } from "./Comun";
import { fecha } from "./formato";
import type { Seguimiento as DatosSeguimiento } from "./tipos";
import { useCarga } from "./useCarga";

type Orden = "az" | "caida";
interface Cifras { cierre: number; rsi: string; caida: number | null }

/** Las cifras de cada empresa, leídas de las líneas de `screen` por el nombre de su columna. */
function cifrasPorEmpresa(d: DatosSeguimiento): Map<string, Cifras> {
  const cols = d.columnas.split(" ");
  const i = (nombre: string) => cols.indexOf(nombre);
  const [cT, cC, cR, cD] = [i("ticker"), i("last_close"), i("rsi14"), i("drawdown_from_1y_high%")];
  return new Map(d.filas.map(f => {
    const v = f.split(" ");
    return [v[cT], { cierre: Number(v[cC]), rsi: v[cR], caida: v[cD] === "n/a" ? null : Number(v[cD]) }];
  }));
}

function Contenido({ d }: { d: DatosSeguimiento }) {
  const t = useTranslations();
  const locale = useLocale();
  const [texto, setTexto] = useState("");
  const [orden, setOrden] = useState<Orden>("az");
  const cifras = useMemo(() => cifrasPorEmpresa(d), [d]);
  const q = texto.trim().toUpperCase();
  const items = d.lista.filter(s => !q || s.ticker.includes(q));
  const pie = d.fecha_precios ? t("pnl_agente_seg_pie", { fecha: fecha(d.fecha_precios, locale) }) : t("pnl_agente_seg_pie_sin");

  const fila = (ticker: string) => {
    const x = cifras.get(ticker);
    return (
      <Celda key={ticker} titulo={ticker} href={`/admin/agente/fichas/${encodeURIComponent(ticker)}?desde=seguimiento`}
        subtitulo={x ? t("pnl_agente_seg_fila", { cierre: dolares(x.cierre, locale), rsi: x.rsi === "n/a" ? "—" : x.rsi }) : t("pnl_agente_clave_without_price_history")}
        valor={x?.caida != null ? porcentajeConSigno(x.caida, locale, 1) : "—"} />
    );
  };

  let cuerpo;
  if (!items.length) cuerpo = <Vacio titulo={t("pnl_agente_dia_nada_titulo", { q: texto.trim() })} texto={t("pnl_agente_seg_nada_texto")} />;
  else if (orden === "caida") {
    // Las más caídas primero; sin datos, al final.
    const val = (s: string) => cifras.get(s)?.caida ?? Infinity;
    const orden = [...items].sort((a, b) => val(a.ticker) - val(b.ticker));
    cuerpo = <div className="pa-bloque-sm"><Grupo pie={pie}>{orden.map(s => fila(s.ticker))}</Grupo></div>;
  } else {
    const porLetra = new Map<string, string[]>();
    items.forEach(s => porLetra.set(s.ticker[0], [...(porLetra.get(s.ticker[0]) ?? []), s.ticker]));
    cuerpo = (
      <>
        {[...porLetra].map(([letra, ts]) => <Grupo key={letra} cabecera={letra}>{ts.map(fila)}</Grupo>)}
        <p className="pnl-pie-grupo">{pie}</p>
      </>
    );
  }

  return (
    <>
      <Buscador valor={texto} onCambio={setTexto} etiqueta={t("pnl_agente_seg_buscar")} />
      <Segmentado etiquetaGrupo={t("pnl_agente_seg_orden_aria")} valor={orden} onChange={setOrden}
        opciones={[{ valor: "az", etiqueta: t("pnl_agente_seg_az") }, { valor: "caida", etiqueta: t("pnl_agente_seg_caida") }]} />
      <div className="pnl-llega">{cuerpo}</div>
    </>
  );
}

export default function Seguimiento() {
  const carga = useCarga<DatosSeguimiento>("/v1/seguimiento");
  return <Pagina atras="/admin/agente?v=agente"><Carga {...carga} filas={8}>{d => <Contenido d={d} />}</Carga></Pagina>;
}
