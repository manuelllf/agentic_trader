"use client";

// Moderación: reportes pendientes y «Ocultar» (plan §14). No hay ruta de descarte en la API
// (solo listar y ocultar), así que aquí solo se ofrece ocultar.

import { useConfirmar } from "@/components/Confirmar";
import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ApiError, get, post } from "@/lib/api";

import { Boton, Estado, Fila, Lista } from "../../_marco/ui";
import { hace, numero } from "../../_marco/formato";

type Reporte = {
  id: number; autor_id: string | null; tipo: "alias" | "estrategia" | "liga" | "pregunta";
  objeto_id: string; motivo: string; estado: string; creado: string; contenido: string | null;
};
type ListaReportes = { total: number; filas: Reporte[] };

const CUANTOS = 50;
const error = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

export function Moderacion({ alTotal }: { alTotal: (total: number) => void }) {
  const t = useTranslations();
  const { confirmar, dialogo } = useConfirmar();
  const locale = useLocale();
  const labels: Record<Reporte["tipo"], string> = { alias: t("admin_moderation_alias"), estrategia: t("admin_moderation_strategy"), liga: t("admin_moderation_league"), pregunta: t("admin_moderation_question") };
  const confirmations: Record<Reporte["tipo"], string> = { alias: t("admin_moderation_confirm_alias"), estrategia: t("admin_moderation_confirm_strategy"), liga: t("admin_moderation_confirm_league"), pregunta: t("admin_moderation_confirm_question") };
  const errorText = useCallback((e: unknown) => error(e, t("admin_generic_error")), [t]);
  const [lista, setLista] = useState<ListaReportes | null>(null);
  const [fallo, setFallo] = useState("");
  const [ocupado, setOcupado] = useState<number | null>(null);

  const cargar = useCallback(() => {
    setFallo("");
    get<ListaReportes>(`/liga/moderacion/reportes?cuantos=${CUANTOS}`)
      .then(r => { setLista(r); alTotal(r.total); }).catch((e) => setFallo(errorText(e)));
  }, [errorText, alTotal]);
  useEffect(cargar, [cargar]);

  const ocultar = async (r: Reporte) => {
    if (!(await confirmar({ titulo: t("admin_moderation_confirm_hide", { item: confirmations[r.tipo] }), aceptar: t("common_confirmar"), peligro: true }))) return;
    setOcupado(r.id); setFallo("");
    try {
      await post("/liga/moderacion/ocultar", { reporte_id: r.id });
      cargar();
    } catch (e) { setFallo(errorText(e)); } finally { setOcupado(null); }
  };

  return <div>
    {fallo && <Estado tipo="error">{fallo}</Estado>}
    {!lista ? !fallo && <Estado tipo="cargando" /> : lista.filas.length === 0 ? <Estado tipo="vacio">{t("admin_moderation_empty")}</Estado> : <>
      <Lista>{lista.filas.map(r => <Fila key={r.id}><div><p className="break-words">{r.contenido ?? t("admin_moderation_missing")}</p><p className="adm-nota">{[labels[r.tipo], r.motivo, hace(r.creado, locale)].join(" · ")}</p></div><Boton variante="sec" disabled={ocupado === r.id} onClick={() => ocultar(r)}>{t("admin_moderation_hide")}</Boton></Fila>)}</Lista>
      {lista.total > lista.filas.length && <p className="adm-nota">{t("admin_moderation_count", { total: numero(lista.total, locale), shown: numero(lista.filas.length, locale) })}</p>}
    </>}{dialogo}
  </div>;
}
