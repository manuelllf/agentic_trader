import Link from "next/link";
import type { getTranslations } from "next-intl/server";
import type { CicloAprender, MercadoAprender } from "@/lib/aprender";
import type { Guia } from "../guias";
import { DeslizadorRoe } from "./DeslizadorRoe";
import { RelojCierre } from "./RelojCierre";

type Traducciones = Awaited<ReturnType<typeof getTranslations>>;

export function CuerpoGuia({ clave, ciclo, mercado, t, locale }: {
  clave: Guia["clave"]; ciclo: CicloAprender | null; mercado: MercadoAprender | null;
  t: Traducciones; locale: string;
}) {
  if (clave === "g1") return <>
    <section className="apr-sec"><h2>{t("learn_g1_ano_t")}</h2><p className="apr-txt">{t.rich("learn_g1_ano_d", { b: c => <b>{c}</b> })}</p></section>
    <section className="apr-sec"><h2>{t("learn_g1_indice_t")}</h2><p className="apr-txt">{t("learn_g1_indice_d")}</p></section>
    <section className="apr-sec"><h2>{t("learn_g1_casa_t")}</h2><div className="apr-casa">
      {(["alpha", "omega", "lambda"] as const).map(c => <div key={c}><svg className="apr-escudo" viewBox="0 0 24 28" aria-hidden="true"><path d="M12 1 22 5v8c0 7-4.5 11.5-10 14C6.5 24.5 2 20 2 13V5z" style={{ fill: `var(--${c})` }} /></svg><p><b>{t(`learn_g1_${c}_t`)}</b><span>{t(`learn_g1_${c}_d`)}</span></p></div>)}
    </div><p className="apr-rot">{t("learn_g1_casa_nota")}</p></section>
  </>;
  if (clave === "g2") return <>
    <section className="apr-sec"><ol className="cf-pasos">{(["idea", "reglas", "criterios", "cartera", "revisar"] as const).map((p, i) => <li className="cf-paso" key={p}><span className="cf-n" aria-hidden="true">{i + 1}</span><div><h2>{t(`learn_g2_${p}_t`)}</h2><p>{t(`learn_g2_${p}_d`)}</p></div></li>)}</ol></section>
    {mercado && <section className="apr-sec"><h2>{t("learn_g2_prueba_t")}</h2><DeslizadorRoe mercado={mercado} /></section>}
  </>;
  if (clave === "g3") return <>
    {ciclo && <section className="apr-sec"><RelojCierre ciclo={ciclo} /></section>}
    <section className="apr-sec"><h2>{t("learn_g3_porque_t")}</h2><p className="apr-txt">{t("learn_g3_porque_d")}</p></section>
  </>;
  if (clave === "g4") {
    const banda = ciclo ? new Intl.NumberFormat(locale).format(Number(ciclo.puntos.banda)) : "";
    return <>
      <section className="apr-sec"><h2>{t("learn_g4_rent_t")}</h2><p className="apr-txt">{t("learn_g4_rent_d")}</p></section>
      {ciclo && <section className="apr-sec"><h2>{t("learn_g4_puntos_t")}</h2><p className="apr-txt">{t("learn_g4_puntos_intro")}</p>
        <div className="apr-barra"><div className="p0">{ciclo.puntos.pierde}</div><div className="p1">{ciclo.puntos.empata}</div><div className="p3">{ciclo.puntos.gana}</div></div>
        <div className="apr-marcas"><span>{t("learn_g4_peor")}</span><span><i>{t("learn_g4_menos", { banda })}</i><i>{t("learn_g4_mas", { banda })}</i></span><span>{t("learn_g4_mejor")}</span></div>
        <p className="apr-txt">{t.rich("learn_g4_puntos_d", { banda, gana: ciclo.puntos.gana, empata: ciclo.puntos.empata, pierde: ciclo.puntos.pierde, b: c => <b>{c}</b> })}</p>
      </section>}
      <section className="apr-sec"><h2>{t("learn_g4_jornadas_t")}</h2><p className="apr-txt">{t("learn_g4_jornadas_d")}</p><p className="apr-rot">{t("learn_g4_provisional")}</p></section>
      <p className="apr-enlace"><Link href="/liga">{t("learn_ir_clasificacion")}</Link></p>
    </>;
  }
  const premio = ciclo?.premio;
  if (!premio?.visible) return null;
  const basico = premio.umbral_basico;
  const completo = premio.umbral_completo;
  const importes = premio.importes;
  const euros = (v: number) => new Intl.NumberFormat(locale, { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);
  return <>
    {basico != null && completo != null && importes?.["1"] && importes["2"] && <section className="apr-sec"><h2>{t("learn_g5_cuanto_t")}</h2>
      <div className="apr-escalones">
        <div className="apr-esc cab"><span />{importes["2"].map((_, i) => <span key={i}>{t("learn_g5_puesto", { n: i + 1 })}</span>)}</div>
        <div className="apr-esc"><span className="q"><b>{t("learn_g5_completo", { n: completo })}</b>{t("learn_g5_elegibles")}</span>{importes["2"].map((v, i) => <span key={i} className="e num">{euros(v)}</span>)}</div>
        <div className="apr-esc"><span className="q"><b>{t("learn_g5_basico", { desde: basico, hasta: completo - 1 })}</b>{t("learn_g5_elegibles")}</span>{importes["1"].map((v, i) => <span key={i} className="e num">{euros(v)}</span>)}</div>
        <div className="apr-esc no"><span className="q">{t("learn_g5_sin", { n: basico })}</span></div>
      </div>
    </section>}
    <section className="apr-sec"><h2>{t("learn_g5_optar_t")}</h2><ul className="apr-req"><li>{t("legal_bases_quien_1")}</li><li>{t("legal_bases_quien_3")}</li><li>{t("legal_bases_resumen_4")}</li></ul><p className="apr-enlace"><Link href="/legal/bases-premio">{t("learn_g5_bases")}</Link></p></section>
  </>;
}
