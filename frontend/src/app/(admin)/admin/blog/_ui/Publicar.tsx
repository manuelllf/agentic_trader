"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { leerArticulo, publicarArticulo, programarArticulo, resumenBoletin, type Detalle } from "@/lib/blog/admin";
import { Celda, CeldaInterruptor, Esqueleto, Grupo, Segmentado } from "../../_panel/ui";
import { Boton, BotonEnlace, CampoTexto, Volver } from "../../_contenido/piezas";
import { fechaMadrid, mananaMadrid, totalSuscriptores } from "./logica";

export default function Publicar({ id }: { id: number }) {
  const t = useTranslations();
  const [articulo, setArticulo] = useState<Detalle | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [fallo, setFallo] = useState("");
  const [cargando, setCargando] = useState(true);
  const [revisado, setRevisado] = useState(false);
  const [avisar, setAvisar] = useState(true);
  const [cuando, setCuando] = useState<"ahora" | "programar">("programar");
  const [manana] = useState(mananaMadrid);
  const [dia, setDia] = useState(manana.dia);
  const [hora, setHora] = useState(manana.hora);
  const [ocupado, setOcupado] = useState(false);
  const [exito, setExito] = useState("");
  useEffect(() => {
    let vivo = true;
    leerArticulo(id).then(a => { if (vivo) setArticulo(a); }).catch(e => { if (vivo) setFallo(e.message); })
      .finally(() => { if (vivo) setCargando(false); });
    resumenBoletin().then(b => { if (vivo) setTotal(totalSuscriptores(b, "confirmado")); })
      .catch(e => { if (vivo) setFallo(e.message); });
    return () => { vivo = false; };
  }, [id]);
  async function enviar() {
    if (!revisado || ocupado || !articulo) return;
    setFallo("");
    const date = fechaMadrid(`${dia}T${hora}`);
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
  return <div className="pnl-llega">
    <Volver href={`/admin/blog/${id}`}>{t("ba_back_edit")}</Volver>
    <div className="pc-fila-titulo"><h2 className="pnl-titular">{t("ba_review_title")}</h2></div>
    {fallo && <p className="pc-aviso" role="alert">{fallo}</p>}
    {cargando && <Esqueleto filas={3} etiqueta={t("admin_pnl_cargando")} />}
    {!cargando && !articulo && <div className="pc-botones"><BotonEnlace href="/admin/blog" tono="sec">{t("ba_back_list")}</BotonEnlace></div>}
    {exito ? <>
      <p className="pc-estado-linea" role="status">{exito}</p>
      <div className="pc-botones"><BotonEnlace href="/admin/blog">{t("ba_back_list")}</BotonEnlace></div>
    </> : articulo && <>
      <h2 className="pnl-cab-grupo">{t("ba_blog_preview")}</h2>
      <div className="pc-tarjeta"><h3>{articulo.textos.es.titulo}</h3><p>{articulo.textos.es.resumen}</p>
        <code>{t("ba_url_preview")}{articulo.slug}</code></div>
      <Grupo cabecera={t("ba_checks")}>
        {checks.map(([clave, listo]) => <Celda key={clave} titulo={t(clave)}
          valor={<span className={`pc-marca${listo ? " hecho" : ""}`} role="img" aria-label={t(listo ? "ba_done" : "ba_pending")}>{listo ? "✓" : "○"}</span>} />)}
        <CeldaInterruptor titulo={t("ba_review_ack")} activo={revisado} onCambio={setRevisado} />
      </Grupo>
      <h2 className="pnl-cab-grupo" id="ba-when">{t("ba_when")}</h2>
      <Segmentado etiquetaGrupo={t("ba_when")} valor={cuando} onChange={setCuando}
        opciones={[{ valor: "ahora", etiqueta: t("ba_now") }, { valor: "programar", etiqueta: t("ba_schedule") }]} />
      {cuando === "programar" && <>
        <div className="pc-dos">
          <CampoTexto id="ba-date" type="date" etiqueta={t("pnl_contenido_dia")} value={dia} onChange={e => setDia(e.target.value)} />
          <CampoTexto id="ba-time" type="time" etiqueta={t("pnl_contenido_hora")} value={hora} onChange={e => setHora(e.target.value)} />
        </div>
        <p className="pc-nota">{t("ba_madrid_time")}</p>
      </>}
      <Grupo pie={total !== null ? t("ba_audience", { count: total }) : undefined}>
        <CeldaInterruptor titulo={t("ba_notify")} activo={avisar} onCambio={setAvisar} />
      </Grupo>
      <div className="pc-botones">
        <Boton disabled={!revisado || ocupado} onClick={enviar}>
          {t(ocupado ? "ba_working" : cuando === "ahora" ? "ba_publish_now" : "ba_schedule_action")}</Boton>
      </div>
    </>}
  </div>;
}
