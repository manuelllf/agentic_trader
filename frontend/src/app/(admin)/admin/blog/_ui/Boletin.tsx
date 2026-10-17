"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { resumenBoletin, listarArticulos, enviarPruebaBoletin, type Boletin as Resumen, type Articulo } from "@/lib/blog/admin";

export default function Boletin() {
  const t = useTranslations();
  const locale = useLocale();
  const [datos, setDatos] = useState<Resumen | null>(null);
  const [articulos, setArticulos] = useState<Articulo[]>([]);
  const [fallo, setFallo] = useState("");
  const [cargando, setCargando] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const [enviado, setEnviado] = useState(false);
  useEffect(() => {
    let vivo = true;
    resumenBoletin().then(b => { if (vivo) setDatos(b); }).catch(e => { if (vivo) setFallo(e.message); })
      .finally(() => { if (vivo) setCargando(false); });
    listarArticulos().then(a => { if (vivo) setArticulos(a); }).catch(e => { if (vivo) setFallo(e.message); });
    return () => { vivo = false; };
  }, []);
  const total = (estado: string, idioma?: string) => datos?.suscriptores.filter(s => s.estado === estado && (!idioma || s.idioma === idioma)).reduce((n, s) => n + s.total, 0) ?? 0;
  const fecha = (value: string) => new Intl.DateTimeFormat(locale, { timeZone: "Europe/Madrid", dateStyle: "short", timeStyle: "short" }).format(new Date(value));
  async function prueba() {
    if (ocupado) return;
    setOcupado(true); setFallo(""); setEnviado(false);
    try { await enviarPruebaBoletin(); setEnviado(true); }
    catch (e) { setFallo(e instanceof Error ? e.message : t("ba_error")); }
    finally { setOcupado(false); }
  }
  return <main className="blog-admin">
    <Link href="/admin/blog">{t("ba_blog")}</Link><h1>{t("ba_newsletter")}</h1><p>{t("ba_news_intro")}</p>
    {fallo && <p role="alert">{fallo}</p>}{cargando && <p role="status">{t("ba_loading")}</p>}
    {datos && <><section className="ba-section"><h2>{t("ba_people")}</h2><dl className="ba-stats">
      <div><dt>{t("ba_people_confirmed")}</dt><dd>{total("confirmado")}</dd></div>
      <div><dt>{t("ba_people_pending")} <small>{t("ba_pending_note")}</small></dt><dd>{total("pendiente")}</dd></div>
      <div><dt>{t("ba_people_left")}</dt><dd>{total("baja")}</dd></div>
      <div><dt>{t("ba_by_language")}</dt><dd>ES {total("confirmado", "es")} · EN {total("confirmado", "en")}</dd></div>
    </dl></section><section className="ba-section"><h2>{t("ba_sends")}</h2>
      {datos.envios.length === 0 && <p>{t("ba_sends_empty")}</p>}
      <ul className="ba-mailings">{datos.envios.map(envio => {
        const articulo = articulos.find(a => a.id === envio.articulo_id);
        const titulo = (locale === "en" ? articulo?.titulo_en : articulo?.titulo_es) || t("ba_article_fallback", { id: envio.articulo_id });
        return <li key={envio.id}><strong>{titulo}</strong> <span className="ba-mono">{envio.idioma.toUpperCase()}</span>
          <p>{envio.estado === "pendiente" || envio.estado === "en_curso" ? t("ba_send_queued", {
            accepted: envio.aceptada, total: envio.pendiente + envio.aceptada + envio.fallida,
          }) : envio.estado === "terminado" ? t("ba_send_finished", { date: fecha(envio.terminado_en ?? envio.creado),
            accepted: envio.aceptada, failed: envio.fallida }) : t("ba_send_unknown", { state: envio.estado })}</p></li>;
      })}</ul></section></>}
    <aside className="ba-card">{t("ba_send_limit")}</aside>
    <footer className="ba-section"><button className="ba-button ba-wide" disabled={ocupado} onClick={prueba}>{t(ocupado ? "ba_working" : "ba_test_email")}</button>
      {enviado && <p role="status">{t("ba_test_sent")}</p>}</footer>
  </main>;
}
