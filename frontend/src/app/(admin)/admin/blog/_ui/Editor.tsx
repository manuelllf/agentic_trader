"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ApiError } from "@/lib/api";
import { crearArticulo, guardarArticulo, leerArticulo, type Detalle, type Idioma, type Texto } from "@/lib/blog/admin";
import VistaPrevia from "./VistaPrevia";

const vacio = (): Texto => ({ titulo: "", resumen: "", cuerpo: "" });
const slugValido = (s: string) => s.length >= 3 && s.length <= 120 && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(s);

export default function Editor({ id }: { id?: number }) {
  const t = useTranslations();
  const router = useRouter();
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
    setGuardado(false);
  };
  const guardar = async () => {
    setIntentado(true); setGuardado(false); setFallo("");
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
  return <main className="blog-admin ba-editor">
    <Link href="/admin/blog">{t("ba_blog")}</Link>
    <header className="ba-heading"><h1>{t(id === undefined ? "ba_new" : "ba_edit")}</h1>
      <span className={`ba-state ba-${estado}`}>{t(`ba_${estado}`)}</span></header>
    {fallo && <p role="alert">{fallo}</p>}
    {cargando ? <p role="status">{t("ba_loading")}</p> : (id === undefined || articulo) && <>
      <div className="ba-tabs" role="tablist" aria-label={t("ba_edit")}>
        {(["es", "en"] as const).map(l => <button key={l} id={`ba-tab-${l}`} role="tab" type="button"
          aria-selected={idioma === l} aria-controls="ba-language-panel" tabIndex={idioma === l ? 0 : -1}
          onKeyDown={e => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
            e.preventDefault(); const siguiente = e.key === "Home" ? "es" : e.key === "End" ? "en" : l === "es" ? "en" : "es";
            setIdioma(siguiente); document.getElementById(`ba-tab-${siguiente}`)?.focus();
          } }} onClick={() => setIdioma(l)}>{t(`ba_${l}`)} <span className={textos[l].titulo.trim() && textos[l].cuerpo.trim() ? "" : "ba-missing"}>
            {t(textos[l].titulo.trim() && textos[l].cuerpo.trim() ? "ba_ready" : "ba_missing")}</span></button>)}
      </div>
      <fieldset disabled={ocupado}>
        <label htmlFor="ba-slug">{t("ba_slug")}</label>
        <div className="ba-slug"><span>{t("ba_prefix")}</span><input id="ba-slug" value={slug} maxLength={120}
          autoCapitalize="none" spellCheck={false} aria-invalid={!!errorSlug} aria-describedby={errorSlug ? "ba-slug-error" : undefined}
          onChange={e => { setSlug(e.target.value); setSlugError(""); setGuardado(false); }} /></div>
        {errorSlug && <p id="ba-slug-error" role="alert">{errorSlug}</p>}
        <div role="tabpanel" id="ba-language-panel" aria-labelledby={`ba-tab-${idioma}`} lang={idioma}>
          {(["titulo", "resumen", "cuerpo"] as const).map(campo => <div className="ba-field" key={campo}>
            <label htmlFor={`ba-${campo}`}>{t(campo === "titulo" ? "ba_title" : campo === "resumen" ? "ba_summary" : "ba_body")}</label>
            {campo !== "cuerpo" && <span className="ba-counter">{textos[idioma][campo].length} / 160</span>}
            {campo === "titulo" ? <input id={`ba-${campo}`} maxLength={160} value={textos[idioma][campo]} onChange={e => cambiar(campo, e.target.value)} />
              : <textarea id={`ba-${campo}`} maxLength={campo === "cuerpo" ? 40000 : 160} value={textos[idioma][campo]}
                className={campo === "cuerpo" ? "ba-body" : ""} aria-describedby={campo === "resumen" ? "ba-summary-note" : undefined}
                onChange={e => cambiar(campo, e.target.value)} />}
            {campo === "resumen" && <p id="ba-summary-note">{t("ba_summary_note")}</p>}
          </div>)}
        </div>
      </fieldset>
      <footer className="ba-footer"><div>
        <p>{t("ba_publish_note")}</p>
        <p role="status">{sucio ? t("ba_dirty") : guardado ? t("ba_saved") : ""}</p>
        <div className="ba-actions">
          <button type="button" className="ba-button ba-primary" disabled={ocupado} onClick={guardar}>{t(ocupado ? "ba_saving" : "ba_save")}</button>
          <button type="button" className="ba-button" onClick={() => setPrevia(true)}>{t("ba_preview")}</button>
          {actualId !== undefined && <Link className="ba-button" href={`/admin/blog/${actualId}/publicar`}>{t("ba_publish")}</Link>}
        </div>
      </div></footer>
      {previa && <VistaPrevia texto={textos[idioma]} idioma={idioma} cerrar={() => setPrevia(false)} />}
    </>}
  </main>;
}
