import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { leerCiclo, leerMercado } from "@/lib/aprender";
import { escaparJsonLd } from "@/lib/blog/publico";
import { AUTOR_PUBLICO, URL_PUBLICA, metadataCompartir } from "@/lib/sitio";
import { BarraPestanas } from "../../_ui/BarraPestanas";
import { CabeceraPagina } from "../../_ui/CabeceraPagina";
import { Contacto } from "../../legal/datos";
import { GUIAS, guiasVisibles } from "../guias";
import { Chevron, CuerpoGuia } from "../_ui/Guias";
import "../../liga/ranking.css";
import "../../_ui/grupos.css";
import "../../_ui/paginas.css";

type Props = { params: Promise<{ guia: string }> };

export async function generateMetadata({ params }: Props) {
  const { guia } = await params;
  const [t, idioma, ciclo] = await Promise.all([getTranslations(), getLocale(), leerCiclo()]);
  const g = guiasVisibles(ciclo?.premio.visible === true).find(g => g.slug === guia);
  if (!g) notFound();
  return metadataCompartir({ titulo: `${t(`learn_${g.clave}_t`)} · Vennett`, descripcion: t(`learn_${g.clave}_desc`), idioma, ruta: `/aprender/${g.slug}` });
}

export default async function PaginaGuia({ params }: Props) {
  const { guia } = await params;
  const candidata = GUIAS.find(g => g.slug === guia);
  if (!candidata) notFound();
  const [ciclo, mercado, t, locale] = await Promise.all([
    leerCiclo(), candidata.clave === "g2" ? leerMercado() : Promise.resolve(null), getTranslations(), getLocale(),
  ]);
  const visibles = guiasVisibles(ciclo?.premio.visible === true);
  const indice = visibles.findIndex(g => g.slug === guia);
  if (indice < 0) notFound();
  const g = visibles[indice];
  const siguiente = visibles[indice + 1];
  const datos = {
    "@context": "https://schema.org", "@type": "Article",
    headline: t(`learn_${g.clave}_t`), description: t(`learn_${g.clave}_lead`),
    inLanguage: locale, mainEntityOfPage: `${URL_PUBLICA}/aprender/${g.slug}`,
    author: { "@type": "Person", name: AUTOR_PUBLICO },
    publisher: { "@type": "Organization", name: "Vennett" },
  };
  return <main className="scroll lv-pagina pg-pagina">
    <CabeceraPagina titulo={t("learn_guia_n", { n: indice + 1, total: visibles.length })} />
    <div className="pg con-indice">
      <nav className="pg-indice" aria-label={t("learn_guias_titulo")}>
        {visibles.map((x, j) => <Link key={x.slug} href={`/aprender/${x.slug}`} aria-current={j === indice ? "page" : undefined}><span>{j + 1}</span>{t(`learn_${x.clave}_t`)}</Link>)}
      </nav>
      <script type="application/ld+json">{escaparJsonLd(datos)}</script>
      <p className="pg-de">{t("learn_minutos", { n: g.minutos })}</p>
      <h1>{t(`learn_${g.clave}_t`)}</h1>
      <p className="pg-lead">{t(`learn_${g.clave}_lead`)}</p>
      <CuerpoGuia clave={g.clave} ciclo={ciclo} mercado={mercado} t={t} locale={locale} />
      <p className="pg-firma">{t("firma_articulo", { autor: AUTOR_PUBLICO })}</p>
      <ul className="cu-grupo"><li>
        {siguiente
          ? <Link className="cu-celda alta" href={`/aprender/${siguiente.slug}`}><span className="t"><small>{t("learn_siguiente")}</small><b>{t(`learn_${siguiente.clave}_t`)}</b></span><span /><Chevron /></Link>
          : <Link className="cu-celda alta" href="/crear"><span className="t"><small>{t("learn_fin_t")}</small><b>{t("learn_fin_accion")}</b></span><span /><Chevron /></Link>}
      </li></ul>
      <p className="cu-pie">{t.rich("learn_ayuda", { correo: () => <Contacto uso="general" /> })}</p>
    </div>
    <BarraPestanas />
  </main>;
}
