"use client";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { listarArticulos, resumenBoletin, type Articulo, type Estado } from "@/lib/blog/admin";
import { Celda, ChipFiltro, Chips, Esqueleto, Grupo, Vacio } from "../../_panel/ui";
import BotonPrueba from "./BotonPrueba";
import { fechaHoraMadrid, totalSuscriptores } from "./logica";

const FILTROS = ["todos", "borrador", "programado", "publicado"] as const;

export default function Lista() {
  const t = useTranslations();
  const locale = useLocale();
  const [articulos, setArticulos] = useState<Articulo[] | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [fallo, setFallo] = useState("");
  const [filtro, setFiltro] = useState<Estado | "todos">("todos");
  useEffect(() => {
    let vivo = true;
    listarArticulos().then(a => { if (vivo) setArticulos(a); }).catch(e => { if (vivo) setFallo(e.message); });
    resumenBoletin().then(b => { if (vivo) setTotal(totalSuscriptores(b, "confirmado")); })
      .catch(e => { if (vivo) setFallo(e.message); });
    return () => { vivo = false; };
  }, []);
  const visibles = articulos?.filter(a => filtro === "todos" || a.estado === filtro) ?? [];
  return <div className="pnl-llega">
    <Grupo><Celda titulo={t("ba_new")} href="/admin/blog/nuevo" tono="accion" /></Grupo>
    {fallo && <p className="pc-aviso" role="alert">{fallo}</p>}
    {!articulos && !fallo && <Esqueleto filas={3} etiqueta={t("admin_pnl_cargando")} />}
    {articulos && <>
      <Chips etiqueta={t("ba_filter")}>{FILTROS.map(f => <ChipFiltro key={f} activo={filtro === f} onClick={() => setFiltro(f)}>
        {t(`ba_filter_${f}`)} {articulos.filter(a => f === "todos" || a.estado === f).length}
      </ChipFiltro>)}</Chips>
      {articulos.length === 0 ? <Vacio titulo={t("ba_empty")} />
        : visibles.length === 0 ? <Vacio titulo={t("ba_empty_filter")} />
        : <Grupo cabecera={t("pnl_contenido_articulos")} pie={t("ba_intro")}>{visibles.map(a => {
          const cuando = a.estado === "programado" ? a.programado_para : a.estado === "publicado" ? a.publicado_en : null;
          const idiomas = (["es", "en"] as const).map(l => `${l.toUpperCase()} ${t(a[`completo_${l}`] ? "ba_ready" : "ba_missing")}`).join(" · ");
          return <Celda key={a.id} titulo={a.titulo_es || a.slug} href={`/admin/blog/${a.id}`}
            subtitulo={[t(`ba_${a.estado}`), cuando ? fechaHoraMadrid(cuando, locale) : null, idiomas].filter(Boolean).join(" · ")} />;
        })}</Grupo>}
    </>}
    <Grupo cabecera={t("pnl_contenido_suscriptores")} pie={t("pnl_contenido_doble")}>
      <Celda titulo={t("ba_newsletter")} href="/admin/blog/boletin" valor={total === null ? undefined : t("ba_confirmed", { count: total })} />
    </Grupo>
    <BotonPrueba />
  </div>;
}
