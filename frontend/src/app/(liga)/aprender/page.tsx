import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { leerCiclo } from "@/lib/aprender";
import { metadataCompartir } from "@/lib/sitio";
import { BarraPestanas } from "../_ui/BarraPestanas";
import { CabeceraPagina } from "../_ui/CabeceraPagina";
import { guiasVisibles } from "./guias";
import { Hora } from "./_ui/Hora";
import { Chevron } from "./_ui/Guias";
import { PrimerosPasos } from "./_ui/PrimerosPasos";
import "../liga/ranking.css";
import "../_ui/grupos.css";
import "../_ui/paginas.css";

export async function generateMetadata() {
  const [t, idioma] = await Promise.all([getTranslations(), getLocale()]);
  return metadataCompartir({ titulo: `${t("learn_title")} · Vennett`, descripcion: t("learn_meta_descripcion"), idioma, ruta: "/aprender" });
}

export default async function Aprender() {
  const [t, ciclo] = await Promise.all([getTranslations(), leerCiclo()]);
  const guias = guiasVisibles(ciclo?.premio.visible === true);
  return <main className="scroll lv-pagina pg-pagina">
    <CabeceraPagina titulo={t("learn_title")} />
    <div className="pg">
      <h1>{t("learn_heading")}</h1>
      <p className="pg-lead">{t.rich("learn_lead", { link: c => <Link href="/como-funciona">{c}</Link> })}</p>
      <PrimerosPasos ciclo={ciclo} />
      <p className="cu-cab">{t("learn_guias_titulo")}</p>
      <ul className="cu-grupo numerado">{guias.map((g, i) => <li key={g.slug}>
        <Link className="cu-celda con-n alta" href={`/aprender/${g.slug}`}>
          <span className="n">{i + 1}</span>
          <span className="t"><b>{t(`learn_${g.clave}_t`)}</b><small>{t(`learn_${g.clave}_desc`)}</small></span>
          <span className="valor">{t("learn_minutos", { n: g.minutos })}</span>
          <Chevron />
        </Link>
      </li>)}</ul>
      {ciclo && <ul className="cu-grupo"><li><div className="cu-celda alta">
        <span className="t"><b>{t("learn_proximo")}</b><small><Hora iso={ciclo.corte} formato="dia" /></small></span>
        <span className="valor fuerte"><Hora iso={ciclo.corte} formato="hora" /></span>
      </div></li></ul>}
      <p className="pg-pie">{t("help_disclaimer")}</p>
    </div>
    <BarraPestanas />
  </main>;
}
