"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Buscador, Celda, Esqueleto, Grupo, Vacio } from "../_panel/ui";
import { getAgente } from "./api";
import { NoDisponible, Pagina } from "./Comun";
import { horasNYyES } from "./formato";
import { diaLargo, subDecision, tituloDecision } from "./textos";
import type { ListaDecisiones, ResumenDecision } from "./tipos";
import { useCarga } from "./useCarga";

const ESPERA_MS = 300;
const PAGINA = 100;

/** Todas las decisiones por días, con buscador por empresa o por palabra del razonamiento. */
export default function Decisiones({ buscar = false }: { buscar?: boolean }) {
  const t = useTranslations();
  const locale = useLocale();
  const [texto, setTexto] = useState("");
  const [consulta, setConsulta] = useState("");
  const [mas, setMas] = useState<ResumenDecision[]>([]);
  const [siguiente, setSiguiente] = useState<number | null | undefined>(undefined);
  const [pidiendo, setPidiendo] = useState(false);
  const caja = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const espera = setTimeout(() => setConsulta(texto.trim()), ESPERA_MS);
    return () => clearTimeout(espera);
  }, [texto]);
  useEffect(() => { if (buscar) caja.current?.querySelector("input")?.focus(); }, [buscar]);

  const todas = useCarga<ListaDecisiones>(consulta ? null : `/v1/decisiones?limite=${PAGINA}`);
  const halladas = useCarga<{ items: ResumenDecision[] }>(consulta ? `/v1/diario?q=${encodeURIComponent(consulta)}` : null);
  const carga = consulta ? halladas : todas;
  const pendiente = texto.trim() !== consulta || carga.estado === "cargando";
  const items = consulta ? halladas.datos?.items ?? [] : [...(todas.datos?.items ?? []), ...mas];
  const proxima = siguiente === undefined ? todas.datos?.siguiente ?? null : siguiente;

  const verMas = async () => {
    if (proxima === null || pidiendo) return;
    setPidiendo(true);
    try {
      const r = await getAgente<ListaDecisiones>(`/v1/decisiones?limite=${PAGINA}&antes_de=${proxima}`);
      setMas(m => [...m, ...r.items]);
      setSiguiente(r.siguiente);
    } catch { /* se puede volver a pedir */ } finally { setPidiendo(false); }
  };

  const porDia = new Map<string, ResumenDecision[]>();
  items.forEach(d => porDia.set(d.fecha, [...(porDia.get(d.fecha) ?? []), d]));

  return (
    <Pagina atras="/admin/alpha">
      <div ref={caja}>
        <Buscador valor={texto} onCambio={setTexto} etiqueta={t("pnl_agente_decs_buscar")} />
      </div>
      {pendiente ? <Esqueleto filas={5} etiqueta={t("pnl_agente_cargando")} />
        : carga.estado === "error" ? <NoDisponible error={carga.error} onReintentar={carga.recargar} />
        : items.length === 0 ? (consulta
          ? <Vacio titulo={t("pnl_agente_dia_nada_titulo", { q: consulta })} texto={t("pnl_agente_decs_nada_texto")} />
          : <Vacio titulo={t("pnl_agente_hoy_ultima_vacio")} texto={t("pnl_agente_hoy_ultima_vacio_texto")} />)
        : (
          <div className="pnl-llega">
            {[...porDia].map(([dia, ds]) => (
              <Grupo key={dia} cabecera={diaLargo(dia, locale)}>
                {ds.map(d => (
                  <Celda key={d.id} titulo={tituloDecision(d.operaciones, d.tipo, t, locale)} href={`/admin/alpha/decisiones/${d.id}?desde=decisiones`}
                    subtitulo={subDecision(d, t, horasNYyES(d.creado, locale))} />
                ))}
              </Grupo>
            ))}
            {!consulta && proxima !== null && (
              <div className="pa-bloque"><Grupo><Celda titulo={t("pnl_agente_decs_mas")} tono="accion" onClick={verMas} deshabilitada={pidiendo} /></Grupo></div>
            )}
            <p className="pnl-pie-grupo">
              {consulta ? t("pnl_agente_decs_pie_q", { n: items.length, q: consulta }) : t("pnl_agente_decs_pie", { n: items.length })}
            </p>
          </div>
        )}
    </Pagina>
  );
}
