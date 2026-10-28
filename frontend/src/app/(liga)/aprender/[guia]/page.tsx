import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { leerCiclo, leerMercado } from "@/lib/aprender";
import FirmaAutor from "@/components/FirmaAutor";
import { escaparJsonLd } from "@/lib/blog/publico";
import { AUTOR_PUBLICO, URL_PUBLICA, metadataCompartir } from "@/lib/sitio";
import { Contacto } from "../../legal/datos";
import { GUIAS, guiasVisibles } from "../guias";
import { CuerpoGuia } from "../_ui/Guias";

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
  return <>
    <script type="application/ld+json">{escaparJsonLd(datos)}</script>
    <Link href="/aprender" className="apr-volver">{t("learn_volver")}</Link>
    <p className="apr-de">{t("learn_guia_de", { n: indice + 1, total: visibles.length, minutos: g.minutos })}</p>
    <h1 className="apr-h1">{t(`learn_${g.clave}_t`)}</h1>
    <p className="apr-lead">{t(`learn_${g.clave}_lead`)}</p>
    <CuerpoGuia clave={g.clave} ciclo={ciclo} mercado={mercado} t={t} locale={locale} />
    <FirmaAutor texto={t("firma_articulo", { autor: AUTOR_PUBLICO })} />
    {siguiente ? <Link className="apr-siguiente" href={`/aprender/${siguiente.slug}`}><small>{t("learn_siguiente")}</small><b>{t(`learn_${siguiente.clave}_t`)}</b></Link>
      : <Link className="apr-siguiente" href="/crear"><small>{t("learn_fin_t")}</small><b>{t("learn_fin_accion")}</b></Link>}
    <p className="apr-ayuda">{t.rich("learn_ayuda", { correo: () => <Contacto uso="general" /> })}</p>
  </>;
}
