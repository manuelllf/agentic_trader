"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { leerArticulo, publicarArticulo, programarArticulo, resumenBoletin, type Detalle } from "@/lib/blog/admin";

function partesMadrid(date: Date) {
  return Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric",
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date).map(p => [p.type, p.value]));
}
function manana() {
  const p = partesMadrid(new Date());
  const date = new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day) + 1, 9));
  return `${date.toISOString().slice(0, 10)}T09:00`;
}
export function fechaMadrid(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const wall = new Date(`${value}:00Z`).getTime();
  if (!Number.isFinite(wall)) return null;
  let instant = wall;
  for (let i = 0; i < 3; i++) {
    const p = partesMadrid(new Date(instant));
    const represented = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute));
    instant += wall - represented;
  }
  const p = partesMadrid(new Date(instant));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}` === value ? new Date(instant) : null;
}
export default function Publicar({ id }: { id: number }) {
  const t = useTranslations();
  const [articulo, setArticulo] = useState<Detalle | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [fallo, setFallo] = useState("");
  const [cargando, setCargando] = useState(true);
  const [revisado, setRevisado] = useState(false);
  const [avisar, setAvisar] = useState(true);
  const [cuando, setCuando] = useState("programar");
  const [fecha, setFecha] = useState(manana);
  const [ocupado, setOcupado] = useState(false);
  const [exito, setExito] = useState("");
  useEffect(() => {
    let vivo = true;
    leerArticulo(id).then(a => { if (vivo) setArticulo(a); }).catch(e => { if (vivo) setFallo(e.message); })
      .finally(() => { if (vivo) setCargando(false); });
    resumenBoletin().then(b => { if (vivo) setTotal(b.suscriptores.filter(s => s.estado === "confirmado").reduce((n, s) => n + s.total, 0)); })
      .catch(e => { if (vivo) setFallo(e.message); });
    return () => { vivo = false; };
  }, [id]);
  async function enviar() {
    if (!revisado || ocupado || !articulo) return;
    setFallo("");
    const date = fechaMadrid(fecha);
    if (cuando === "programar" && (!date || date.getTime() < Date.now() + 60000)) {
      setFallo(t("ba_future_error")); return;
    }
    setOcupado(true);
    try {
      if (cuando === "ahora") await publicarArticulo(id, avisar);
      else await programarArticulo(id, date!.toISOString(), avisar);
      setExito(t(cuando === "ahora" ? "ba_published_ok" : "ba_scheduled_ok"));
    } catch (e) { setFallo(e instanceof Error ? e.message : t("ba_error")); }
    finally { setOcupado(false); }
  }
  const completo = (idioma: "es" | "en") => Boolean(articulo?.textos[idioma].titulo.trim() && articulo.textos[idioma].cuerpo.trim());
  const checks = [["ba_check_es", completo("es")], ["ba_check_en", completo("en")],
    ["ba_check_summary", Boolean(articulo?.textos.es.resumen.trim() && articulo.textos.en.resumen.trim())]] as const;
  return <main className="blog-admin ba-publish-screen">
    <Link href={`/admin/blog/${id}`}>{t("ba_back_edit")}</Link><h1>{t("ba_review_title")}</h1>
    {fallo && <p role="alert">{fallo}</p>}
    {cargando && <p role="status">{t("ba_loading")}</p>}
    {!cargando && !articulo && <Link href="/admin/blog">{t("ba_back_list")}</Link>}
    {exito ? <section><p role="status">{exito}</p><Link href="/admin/blog">{t("ba_back_list")}</Link></section> : articulo && <>
      <section className="ba-card"><h2>{t("ba_blog_preview")}</h2><h3>{articulo.textos.es.titulo}</h3>
        <p>{articulo.textos.es.resumen}</p><span className="ba-mono">{t("ba_url_preview")}{articulo.slug}</span></section>
      <section className="ba-section"><h2>{t("ba_checks")}</h2><ul className="ba-checks">{checks.map(([key, ready]) =>
        <li key={key}><span role="img" aria-label={t(ready ? "ba_done" : "ba_pending")}>{ready ? "✓" : "○"}</span> {t(key)}</li>)}</ul>
        <label className="ba-choice"><input id="ba-review" type="checkbox" required checked={revisado} onChange={e => setRevisado(e.target.checked)} />{t("ba_review_ack")}</label></section>
      <section className="ba-section"><h2 id="ba-when">{t("ba_when")}</h2><div role="radiogroup" aria-labelledby="ba-when">
        {[['ahora', 'ba_now'], ['programar', 'ba_schedule']].map(([value, key]) => <label className="ba-choice" key={value}>
          <input type="radio" name="cuando" value={value} checked={cuando === value} onChange={() => setCuando(value)} />{t(key)}</label>)}
      </div>{cuando === "programar" && <><label htmlFor="ba-date">{t("ba_madrid_time")}</label><input id="ba-date" type="datetime-local" value={fecha} onChange={e => setFecha(e.target.value)} /></>}</section>
      <section className="ba-section"><label className="ba-choice"><input type="checkbox" checked={avisar} onChange={e => setAvisar(e.target.checked)} />{t("ba_notify")}</label>
        {total !== null && <p>{t("ba_audience", { count: total })}</p>}</section>
      <footer className="ba-footer"><div><button className="ba-button ba-primary ba-wide" disabled={!revisado || ocupado} onClick={enviar}>
        {t(ocupado ? "ba_working" : cuando === "ahora" ? "ba_publish_now" : "ba_schedule_action")}</button></div></footer>
    </>}
  </main>;
}
