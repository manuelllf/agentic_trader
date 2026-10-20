import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { leerCiclo } from "@/lib/aprender";
import { metadataCompartir } from "@/lib/sitio";
import { guiasVisibles } from "./guias";
import { Hora } from "./_ui/Hora";
import { PrimerosPasos } from "./_ui/PrimerosPasos";

export async function generateMetadata() {
  const [t, idioma] = await Promise.all([getTranslations(), getLocale()]);
  return metadataCompartir({ titulo: `${t("learn_title")} · Vennett`, descripcion: t("learn_meta_descripcion"), idioma, ruta: "/aprender" });
}

export default async function Aprender() {
  const [t, ciclo] = await Promise.all([getTranslations(), leerCiclo()]);
  const guias = guiasVisibles(ciclo?.premio.visible === true);
  return <>
    <p className="apr-eyebrow">{t("learn_title")}</p>
    <h1 className="apr-h1">{t("learn_heading")}</h1>
    <p className="apr-lead">{t.rich("learn_lead", { link: c => <Link href="/como-funciona">{c}</Link> })}</p>
    <PrimerosPasos ciclo={ciclo} />
    <section className="apr-sec" aria-labelledby="apr-guias"><h2 id="apr-guias">{t("learn_guias_titulo")}</h2>
      <ol className="apr-indice">{guias.map((g, i) => <li key={g.slug}><Link href={`/aprender/${g.slug}`}><span className="apr-n">{i + 1}</span><div><b>{t(`learn_${g.clave}_t`)}</b><span>{t(`learn_${g.clave}_desc`)}</span></div><em>{t("learn_minutos", { n: g.minutos })}</em></Link></li>)}</ol>
    </section>
    {ciclo && <section className="apr-sec"><div className="apr-proximo"><span>{t("learn_proximo")}<br /><Hora iso={ciclo.corte} formato="dia" /></span><b className="num"><Hora iso={ciclo.corte} formato="hora" /></b></div></section>}
  </>;
}
