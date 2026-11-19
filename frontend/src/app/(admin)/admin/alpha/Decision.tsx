"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { dolares } from "../_marco/formato";
import { Celda, Datos, Esqueleto, Grupo, Vacio } from "../_panel/ui";
import { AgenteError } from "./api";
import { Carga, HojaTexto, NoDisponible, Pagina, TextoRecortado } from "./Comun";
import { dinero, fecha, horasNYyES, legible } from "./formato";
import Pasos, { esObj, resultadosDe } from "./Pasos";
import { tituloDecision, veredicto, type Traducir } from "./textos";
import type { DecisionDetalle, LlamadaModelo, OperacionPropuesta } from "./tipos";
import { useCarga } from "./useCarga";

const CAMPOS = [["tesis", "pnl_agente_dec_tesis"], ["supuestos", "pnl_agente_dec_supuestos"], ["salidas", "pnl_agente_dec_salidas"],
  ["ruptura", "pnl_agente_dec_ruptura"], ["prevision_12m", "pnl_agente_dec_prevision"]] as const;

/** Precio de cierre de una empresa en el último `screen` de la decisión, para estimar una compra por acciones. */
function precioEnCribado(llamadas: LlamadaModelo[], ticker: string): number | null {
  for (const r of resultadosDe(llamadas).values()) {
    if (esObj(r) && Array.isArray(r.rows)) {
      const fila = r.rows.map(String).find(s => s.split(" ")[0] === ticker);
      if (fila) return Number(fila.split(" ")[1]);
    }
  }
  return null;
}

type Texto = { titulo: string; texto: string };

function Contenido({ d, llamadas, fallo, t, locale }: {
  d: DecisionDetalle; llamadas: LlamadaModelo[] | null; fallo?: ReactNode; t: Traducir; locale: string;
}) {
  const [texto, setTexto] = useState<Texto | null>(null);
  const ops = d.propuesta.operaciones ?? [];
  const titulo = tituloDecision(ops.map(o => ({ ticker: o.ticker, lado: o.lado })), d.tipo, t, locale);
  const ll = llamadas ?? [];
  const total = ll.reduce((a, l) => a + Number(l.coste_usd ?? 0), 0);
  const o = ops[0] as OperacionPropuesta | undefined;
  const precio = o && !o.importe && o.acciones ? precioEnCribado(ll, o.ticker) : null;
  const cantidad = !o ? "—" : o.importe ? dinero(o.importe, locale) : o.acciones ? t("pnl_agente_dec_acciones", { n: Number(o.acciones) }) : "—";
  const importe = !o ? "—" : o.importe ? dinero(o.importe, locale) : o.acciones && precio ? `≈ ${dinero(Number(o.acciones) * precio, locale)}` : "—";
  // Con varias operaciones, el detalle de cada una va en su grupo; arriba solo cuántas son.
  const cifras = ops.length > 1 ? [{ etiqueta: t("pnl_agente_dec_operaciones"), valor: String(ops.length) }]
    : ops.length ? [{ etiqueta: t("pnl_agente_dec_cantidad"), valor: cantidad }, { etiqueta: t("pnl_agente_dec_importe"), valor: importe }] : [];
  // El código dice qué límite, el detalle dice por qué: se enseña el detalle.
  const violaciones = (d.propuesta.violaciones ?? []).map(v => (typeof v === "string" ? v : v.detalle ?? v.mensaje ?? v.codigo ?? "")).filter(Boolean);
  const abrir = (titulo: string, txt: string | undefined | null) => (txt ? () => setTexto({ titulo, texto: txt }) : undefined);

  return (
    <>
      <h2 className="pa-h1">{titulo}</h2>
      <p className="pa-meta">
        {t("pnl_agente_dec_meta", { fecha: fecha(d.fecha_ny, locale), hora: horasNYyES(d.creado, locale) })}{d.sombra ? ` · ${t("pnl_agente_dec_en_sombra")}` : ""}
      </p>
      <Datos items={[...cifras, { etiqueta: t("pnl_agente_dec_revisor"), valor: veredicto(d.revisor_veredicto, t) },
        ...(ll.length ? [{ etiqueta: t("pnl_agente_pasos_coste"), valor: dolares(total, locale, total < 0.01 ? 4 : 3) }] : [])]} />
      <h2 className="pnl-cab-grupo">{t("pnl_agente_dec_por_que")}</h2>
      <TextoRecortado texto={d.razonamiento} titulo={t("pnl_agente_dec_por_que")} />
      <div className="pa-dos">
        <Grupo cabecera={t("pnl_agente_dec_revisor")}>
          <Celda titulo={veredicto(d.revisor_veredicto, t)} subtitulo={d.revisor_motivo ?? undefined} onClick={abrir(t("pnl_agente_dec_revisor"), d.revisor_motivo)} />
        </Grupo>
      </div>
      {ops.map((op, i) => (
        <div className="pa-dos" key={i}>
          <Grupo cabecera={`${t(`pnl_agente_lado_${op.lado}`)} ${op.ticker}`}>
            {CAMPOS.filter(([k]) => op[k]).map(([k, clave]) => (
              <Celda key={k} titulo={t(clave)} subtitulo={op[k] ?? undefined} onClick={abrir(`${t(clave)} · ${op.ticker}`, op[k])} />
            ))}
            {op.proximo_evento && <Celda titulo={t("pnl_agente_dec_evento")} valor={fecha(op.proximo_evento, locale)} />}
          </Grupo>
        </div>
      ))}
      {violaciones.length > 0 && (
        <Grupo cabecera={t("pnl_agente_dec_violaciones")}>{violaciones.map((v, i) => <Celda key={i} titulo={v} />)}</Grupo>
      )}
      {d.ordenes.length > 0 && (
        <Grupo cabecera={t("pnl_agente_dec_ordenes")}>
          {d.ordenes.map(x => (
            <Celda key={x.id} titulo={`${t(`pnl_agente_lado_${x.lado}`)} ${x.ticker}`} valor={legible(x.estado)}
              subtitulo={x.precio ? t("pnl_agente_dec_ejecutada", { n: Number(x.acciones_ejecutadas ?? 0), precio: dinero(x.precio, locale) }) : x.motivo ?? undefined} />
          ))}
        </Grupo>
      )}
      {d.previsiones.length > 0 && (
        <div className="pa-dos">
          <Grupo cabecera={t("pnl_agente_dec_previsiones")}>
            {d.previsiones.map((p, i) => (
              <Celda key={i} titulo={p.ticker ?? ""} subtitulo={p.texto} onClick={abrir(`${t("pnl_agente_dec_prevision_de")} ${p.ticker ?? ""}`.trim(), p.texto)} />
            ))}
          </Grupo>
        </div>
      )}
      {fallo ? <><h2 className="pnl-cab-grupo">{t("pnl_agente_pasos_cab")}</h2>{fallo}</>
        : llamadas === null ? <><h2 className="pnl-cab-grupo">{t("pnl_agente_pasos_cab")}</h2><Esqueleto filas={5} etiqueta={t("pnl_agente_cargando")} /></>
        : <Pasos decisionId={d.id} llamadas={llamadas} titulo={titulo}
          subImagen={`${t("pnl_agente_dec_imagen_sub", { fecha: fecha(d.fecha_ny, locale) })}${d.sombra ? ` · ${t("pnl_agente_dec_en_sombra").toLocaleLowerCase(locale)}` : ""}`} />}
      <p className="pnl-pie-grupo">{t("pnl_agente_dec_pie", { modelo: d.modelo })}</p>
      <HojaTexto abierta={Boolean(texto)} titulo={texto?.titulo ?? ""} texto={texto?.texto ?? ""} onCerrar={() => setTexto(null)} />
    </>
  );
}

export default function Decision({ id, desde }: { id: string; desde?: string }) {
  const t = useTranslations();
  const locale = useLocale();
  const carga = useCarga<DecisionDetalle>(`/v1/decisiones/${encodeURIComponent(id)}`);
  const llamadas = useCarga<{ items: LlamadaModelo[] }>(`/v1/decisiones/${encodeURIComponent(id)}/llamadas`);
  const noExiste = carga.error instanceof AgenteError && carga.error.estado === 404;
  const deLista = desde === "decisiones";

  return (
    <Pagina atras={deLista ? "/admin/alpha/decisiones" : "/admin/alpha"} atrasTexto={deLista ? t("pnl_agente_decs_titulo") : undefined}>
      {noExiste ? <Vacio titulo={t("pnl_agente_dec_no_existe")} /> : (
        <Carga {...carga} filas={5}>
          {d => <Contenido d={d} llamadas={llamadas.datos?.items ?? null} t={t} locale={locale}
            fallo={llamadas.estado === "error" ? <NoDisponible error={llamadas.error} onReintentar={llamadas.recargar} /> : undefined} />}
        </Carga>
      )}
    </Pagina>
  );
}
