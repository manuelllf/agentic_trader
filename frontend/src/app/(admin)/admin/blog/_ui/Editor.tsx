"use client";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useConfirmar } from "@/components/Confirmar";
import { ApiError } from "@/lib/api";
import { crearArticulo, despublicarArticulo, guardarArticulo, leerArticulo, type Detalle, type Idioma, type Texto } from "@/lib/blog/admin";
import { Celda, Esqueleto, Grupo, Segmentado } from "../../_panel/ui";
import { Boton, BotonEnlace, CampoArea, CampoTexto, Volver } from "../../_contenido/piezas";
import VistaPrevia from "./VistaPrevia";
import { fechaHoraMadrid } from "./logica";

const vacio = (): Texto => ({ titulo: "", resumen: "", cuerpo: "" });
const slugValido = (s: string) => s.length >= 3 && s.length <= 120 && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(s);
const listo = (x: Texto) => Boolean(x.titulo.trim() && x.cuerpo.trim());

export default function Editor({ id }: { id?: number }) {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const { confirmar, dialogo } = useConfirmar();
  const [articulo, setArticulo] = useState<Detalle | null>(null);
  const [actualId, setActualId] = useState(id);
  const [slug, setSlug] = useState("");
  const [slugGuardado, setSlugGuardado] = useState("");
  const [textos, setTextos] = useState<Record<Idioma, Texto>>({ es: vacio(), en: vacio() });
  const [base, setBase] = useState(JSON.stringify({ slug: "", es: vacio(), en: vacio() }));
  const [idioma, setIdioma] = useState<Idioma>("es");
  const [cargando, setCargando] = useState(id !== undefined);
  const [ocupado, setOcupado] = useState(false);
  const [fallo, setFallo] = useState("");
  const [slugError, setSlugError] = useState("");
  const [intentado, setIntentado] = useState(false);
  const [guardado, setGuardado] = useState(false);
  const [despublicado, setDespublicado] = useState(false);
  const [previa, setPrevia] = useState(false);
  useEffect(() => {
    if (id === undefined) return;
    let vivo = true;
    leerArticulo(id).then(a => {
      if (!vivo) return;
      setArticulo(a); setSlug(a.slug); setSlugGuardado(a.slug); setTextos(a.textos);
      setBase(JSON.stringify({ slug: a.slug, ...a.textos }));
    }).catch(e => { if (vivo) setFallo(e.message); }).finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [id]);
  const sucio = JSON.stringify({ slug, ...textos }) !== base;
  const errorSlug = slugError || ((intentado || slug.length > 0) && !slugValido(slug) ? t("ba_slug_error") : "");
  const cambiar = (campo: keyof Texto, valor: string) => {
    setTextos(prev => ({ ...prev, [idioma]: { ...prev[idioma], [campo]: valor.slice(0, campo === "cuerpo" ? 40000 : 160) } }));
    setGuardado(false); setDespublicado(false);
  };
  const guardar = async () => {
    setIntentado(true); setGuardado(false); setDespublicado(false); setFallo("");
    if (!slugValido(slug)) return;
    setOcupado(true); setSlugError("");
    try {
      let destino = actualId;
      if (destino === undefined) {
        const creado = await crearArticulo(slug);
        destino = creado.id; setActualId(destino); setSlugGuardado(slug);
      }
      const a = await guardarArticulo(destino, { ...textos, ...(slug !== slugGuardado ? { slug } : {}) });
      setArticulo(a); setSlug(a.slug); setSlugGuardado(a.slug); setTextos(a.textos);
      setBase(JSON.stringify({ slug: a.slug, ...a.textos })); setGuardado(true);
      if (id === undefined) router.replace(`/admin/blog/${destino}`);
    } catch (e) {
      const mensaje = e instanceof Error ? e.message : t("ba_error");
      if (e instanceof ApiError && e.status === 409) setSlugError(mensaje);
      else setFallo(mensaje);
    } finally { setOcupado(false); }
  };
  const estado = articulo?.estado ?? "borrador";
  const despublicar = async () => {
    if (actualId === undefined || ocupado) return;
    const programado = estado === "programado";
    if (!(await confirmar({ titulo: t(programado ? "pnl_contenido_cancelar_titulo" : "pnl_contenido_despublicar_titulo"),
      texto: t(programado ? "pnl_contenido_cancelar_texto" : "pnl_contenido_despublicar_texto"),
      aceptar: t(programado ? "pnl_contenido_cancelar" : "pnl_contenido_despublicar"), peligro: true }))) return;
    setOcupado(true); setFallo("");
    try { setArticulo(await despublicarArticulo(actualId)); setDespublicado(true); setGuardado(false); }
    catch (e) { setFallo(e instanceof Error ? e.message : t("ba_error")); }
    finally { setOcupado(false); }
  };
  const cuando = estado === "programado" ? articulo?.programado_para : estado === "publicado" ? articulo?.publicado_en : null;
  const texto = textos[idioma];
  return <div className="pnl-llega">
    <Volver href="/admin/blog">{t("ba_newsletter")}</Volver>
    <div className="pc-fila-titulo"><h2 className="pnl-titular">{t(id === undefined ? "ba_new" : "ba_edit")}</h2></div>
    {fallo && <p className="pc-aviso" role="alert">{fallo}</p>}
    {cargando && <Esqueleto filas={3} etiqueta={t("admin_pnl_cargando")} />}
    {!cargando && (id === undefined || articulo) && <>
      <Segmentado etiquetaGrupo={t("ba_edit")} valor={idioma} onChange={setIdioma} opciones={(["es", "en"] as const).map(l => ({
        valor: l, etiqueta: `${t(`ba_${l}`)} · ${t(listo(textos[l]) ? "ba_ready" : "ba_missing")}` }))} />
      <fieldset disabled={ocupado} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
        <CampoTexto id="ba-slug" etiqueta={t("ba_slug")} prefijo={t("ba_prefix")} value={slug} maxLength={120}
          autoCapitalize="none" autoCorrect="off" spellCheck={false} error={errorSlug}
          onChange={e => { setSlug(e.target.value); setSlugError(""); setGuardado(false); setDespublicado(false); }} />
        <div lang={idioma}>
          <CampoTexto id="ba-titulo" etiqueta={t("ba_title")} contador={`${texto.titulo.length} / 160`} maxLength={160}
            value={texto.titulo} onChange={e => cambiar("titulo", e.target.value)} />
          <CampoArea id="ba-resumen" etiqueta={t("ba_summary")} contador={`${texto.resumen.length} / 160`} maxLength={160}
            nota={t("ba_summary_note")} value={texto.resumen} onChange={e => cambiar("resumen", e.target.value)} />
          <CampoArea id="ba-cuerpo" etiqueta={t("ba_body")} largo maxLength={40000} value={texto.cuerpo}
            onChange={e => cambiar("cuerpo", e.target.value)} />
        </div>
      </fieldset>
      {articulo && <Grupo cabecera={t("pnl_contenido_estado")}>
        <Celda titulo={t("pnl_contenido_estado")} valor={t(`ba_${estado}`)} />
        <Celda titulo={t("pnl_contenido_fecha")} valor={cuando ? fechaHoraMadrid(cuando, locale) : t("pnl_contenido_sin_fecha")} />
      </Grupo>}
      <p className="pc-estado-linea" role="status">{sucio ? t("ba_dirty") : despublicado ? t("pnl_contenido_despublicado") : guardado ? t("ba_saved") : ""}</p>
      <div className="pc-botones">
        <Boton disabled={ocupado} onClick={guardar}>{t(ocupado ? "ba_saving" : "ba_save")}</Boton>
        <Boton tono="sec" onClick={() => setPrevia(true)}>{t("ba_preview")}</Boton>
        {actualId !== undefined && estado !== "publicado" && <BotonEnlace href={`/admin/blog/${actualId}/publicar`} tono="sec">{t(estado === "borrador" ? "ba_publish" : "pnl_contenido_cambiar")}</BotonEnlace>}
        {actualId !== undefined && estado !== "borrador" && <Boton tono="peligro" disabled={ocupado} onClick={despublicar}>
          {t(estado === "programado" ? "pnl_contenido_cancelar" : "pnl_contenido_despublicar")}</Boton>}
      </div>
      <p className="pnl-pie-grupo">{t("ba_publish_note")}</p>
      <VistaPrevia abierta={previa} texto={texto} idioma={idioma} cerrar={() => setPrevia(false)} />
    </>}
    {dialogo}
  </div>;
}
