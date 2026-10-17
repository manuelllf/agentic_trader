"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { listarArticulos, resumenBoletin, type Articulo, type Estado } from "@/lib/blog/admin";

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
    resumenBoletin().then(b => { if (vivo) setTotal(b.suscriptores.filter(s => s.estado === "confirmado").reduce((n, s) => n + s.total, 0)); })
      .catch(e => { if (vivo) setFallo(e.message); });
    return () => { vivo = false; };
  }, []);
  const fecha = (value: string) => new Intl.DateTimeFormat(locale, {
    timeZone: "Europe/Madrid", dateStyle: "short", timeStyle: "short",
  }).format(new Date(value));
  const nuevo = <Link className="ba-button ba-primary" href="/admin/blog/nuevo">{t("ba_new")}</Link>;
  return <main className="blog-admin">
    <Link href="/admin">{t("ba_panel")}</Link>
    <h1>{t("ba_blog")}</h1><p>{t("ba_intro")}</p>
    {nuevo}
    <div className="ba-filters" role="group" aria-label={t("ba_filter")}>
      {(["todos", "borrador", "programado", "publicado"] as const).map(f => <button key={f} type="button"
        aria-pressed={filtro === f} onClick={() => setFiltro(f)}>
        {t(`ba_filter_${f}`)} <span>{articulos?.filter(a => f === "todos" || a.estado === f).length ?? 0}</span>
      </button>)}
    </div>
    {fallo && <p role="alert">{fallo}</p>}
    {!articulos && !fallo && <p role="status">{t("ba_loading")}</p>}
    {articulos && <ul className="ba-list">{articulos.filter(a => filtro === "todos" || a.estado === filtro).map(a => {
      const cuando = a.estado === "programado" ? a.programado_para : a.estado === "publicado" ? a.publicado_en : null;
      return <li key={a.id}><Link href={`/admin/blog/${a.id}`}>
        <strong>{a.titulo_es || a.slug}</strong>
        <p><span className={`ba-state ba-${a.estado}`}>{t(`ba_${a.estado}`)}</span>{cuando && <> ? <time dateTime={cuando}>{fecha(cuando)}</time></>}</p>
        <div className="ba-languages">{(["es", "en"] as const).map(l => <span key={l}>
          {l.toUpperCase()} <span className={a[`completo_${l}`] ? "" : "ba-missing"}>{t(a[`completo_${l}`] ? "ba_ready" : "ba_missing")}</span>
        </span>)}</div>
      </Link></li>;
    })}</ul>}
    {articulos?.length === 0 && <section><p>{t("ba_empty")}</p>{nuevo}</section>}
    {articulos && articulos.length > 0 && !articulos.some(a => filtro === "todos" || a.estado === filtro) && <p>{t("ba_empty_filter")}</p>}
    <Link className="ba-newsletter" href="/admin/blog/boletin"><strong>{t("ba_newsletter")}</strong>
      {total !== null && <p>{t("ba_confirmed", { count: total })}</p>}</Link>
  </main>;
}
