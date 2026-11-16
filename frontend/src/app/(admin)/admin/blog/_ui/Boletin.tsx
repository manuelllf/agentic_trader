"use client";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { resumenBoletin, listarArticulos, type Boletin as Resumen, type Articulo } from "@/lib/blog/admin";
import { Celda, Datos, Esqueleto, Grupo } from "../../_panel/ui";
import { Volver } from "../../_contenido/piezas";
import BotonPrueba from "./BotonPrueba";
import { fechaHoraMadrid, totalSuscriptores } from "./logica";

export default function Boletin() {
  const t = useTranslations();
  const locale = useLocale();
  const [datos, setDatos] = useState<Resumen | null>(null);
  const [articulos, setArticulos] = useState<Articulo[]>([]);
  const [fallo, setFallo] = useState("");
  useEffect(() => {
    let vivo = true;
    resumenBoletin().then(b => { if (vivo) setDatos(b); }).catch(e => { if (vivo) setFallo(e.message); });
    listarArticulos().then(a => { if (vivo) setArticulos(a); }).catch(e => { if (vivo) setFallo(e.message); });
    return () => { vivo = false; };
  }, []);
  return <div className="pnl-llega">
    <Volver href="/admin/blog">{t("ba_newsletter")}</Volver>
    <div className="pc-fila-titulo"><h2 className="pnl-titular">{t("pnl_contenido_suscriptores")}</h2></div>
    <p className="pnl-pie-grupo" style={{ marginTop: 0 }}>{t("ba_news_intro")}</p>
    {fallo && <p className="pc-aviso" role="alert">{fallo}</p>}
    {!datos && !fallo && <Esqueleto filas={4} etiqueta={t("admin_pnl_cargando")} />}
    {datos && <>
      <h2 className="pnl-cab-grupo">{t("ba_people")}</h2>
      <Datos items={[
        { etiqueta: t("ba_people_confirmed"), valor: totalSuscriptores(datos, "confirmado") },
        { etiqueta: t("ba_people_pending"), valor: totalSuscriptores(datos, "pendiente") },
        { etiqueta: t("ba_people_left"), valor: totalSuscriptores(datos, "baja") },
        { etiqueta: t("ba_by_language"), valor: `ES ${totalSuscriptores(datos, "confirmado", "es")} · EN ${totalSuscriptores(datos, "confirmado", "en")}` },
      ]} />
      <p className="pnl-pie-grupo">{t("ba_people_pending")} {t("ba_pending_note")}</p>
      {datos.envios.length === 0 ? <Grupo cabecera={t("ba_sends")}><Celda titulo={t("ba_sends_empty")} /></Grupo>
        : <Grupo cabecera={t("ba_sends")}>{datos.envios.map(envio => {
          const articulo = articulos.find(a => a.id === envio.articulo_id);
          const titulo = (locale === "en" ? articulo?.titulo_en : articulo?.titulo_es) || t("ba_article_fallback", { id: envio.articulo_id });
          const estado = envio.estado === "pendiente" || envio.estado === "en_curso"
            ? t("ba_send_queued", { accepted: envio.aceptada, total: envio.pendiente + envio.aceptada + envio.fallida })
            : envio.estado === "terminado"
              ? t("ba_send_finished", { date: fechaHoraMadrid(envio.terminado_en ?? envio.creado, locale), accepted: envio.aceptada, failed: envio.fallida })
              : t("ba_send_unknown", { state: envio.estado });
          return <Celda key={envio.id} titulo={`${titulo} · ${envio.idioma.toUpperCase()}`} subtitulo={estado} />;
        })}</Grupo>}
      <p className="pnl-pie-grupo">{t("ba_send_limit")}</p>
    </>}
    <BotonPrueba />
  </div>;
}
