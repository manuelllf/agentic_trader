import Link from "next/link";
import type { getTranslations } from "next-intl/server";
import type { CicloAprender, MercadoAprender } from "@/lib/aprender";
import { Escudo, escudoCasa } from "../../_ui/Escudo";
import type { Guia } from "../guias";
import { DeslizadorRoe } from "./DeslizadorRoe";
import { RelojCierre } from "./RelojCierre";

type Traducciones = Awaited<ReturnType<typeof getTranslations>>;

export function Chevron() {
  return <svg className="chev" viewBox="0 0 8 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
    strokeLinejoin="round" aria-hidden="true"><path d="m1 1 6 6-6 6" /></svg>;
}

function Seccion({ t, titulo, texto }: { t: Traducciones; titulo: string; texto: string }) {
  return <><h2 className="pg-sec">{t(titulo)}</h2><p className="pg-txt">{t(texto)}</p></>;
}

export function CuerpoGuia({ clave, ciclo, mercado, t, locale }: {
  clave: Guia["clave"]; ciclo: CicloAprender | null; mercado: MercadoAprender | null;
  t: Traducciones; locale: string;
}) {
  if (clave === "g1") return <>
    <h2 className="pg-sec">{t("learn_g1_ano_t")}</h2><p className="pg-txt">{t.rich("learn_g1_ano_d", { b: c => <b>{c}</b> })}</p>
    <Seccion t={t} titulo="learn_g1_indice_t" texto="learn_g1_indice_d" />
    <h2 className="pg-sec">{t("learn_g1_casa_t")}</h2>
    <ul className="cu-grupo casas">
      {(["alpha", "omega", "lambda"] as const).map(c => <li key={c}><div className="cu-celda casa alta">
        <Escudo valor={escudoCasa(c)} casa={c} baldosa tamano={32} etiqueta={t("strategies_showcase_house_crest", { name: t(`learn_g1_${c}_t`) })} />
        <span className="t"><b>{t(`learn_g1_${c}_t`)}</b><small>{t(`learn_g1_${c}_d`)}</small></span>
      </div></li>)}
    </ul>
    <p className="cu-pie">{t("learn_g1_casa_nota")}</p>
  </>;
  if (clave === "g2") return <>
    <ul className="cu-grupo numerado">{(["idea", "reglas", "criterios", "cartera", "revisar"] as const).map((p, i) => <li key={p}>
      <div className="pg-paso"><span className="n">{i + 1}</span><b>{t(`learn_g2_${p}_t`)}</b><p>{t(`learn_g2_${p}_d`)}</p></div>
    </li>)}</ul>
    {/* Sin empresas en la foto, el recuento diría «0 de 0»: mejor no enseñarlo. */}
    {mercado && mercado.total > 0 && <><h2 className="pg-sec">{t("learn_g2_prueba_t")}</h2><DeslizadorRoe mercado={mercado} /></>}
  </>;
  if (clave === "g3") return <>
    {ciclo && <RelojCierre ciclo={ciclo} />}
    <Seccion t={t} titulo="learn_g3_porque_t" texto="learn_g3_porque_d" />
  </>;
  if (clave === "g4") {
    const banda = ciclo ? new Intl.NumberFormat(locale).format(Number(ciclo.puntos.banda)) : "";
    return <>
      <Seccion t={t} titulo="learn_g4_rent_t" texto="learn_g4_rent_d" />
      {ciclo && <>
        <h2 className="pg-sec">{t("learn_g4_puntos_t")}</h2><p className="pg-txt">{t("learn_g4_puntos_intro")}</p>
        <div className="pg-puntos" aria-hidden="true"><span className="p0">{ciclo.puntos.pierde}</span><span className="p1">{ciclo.puntos.empata}</span><span className="p3">{ciclo.puntos.gana}</span></div>
        <div className="pg-puntos-eje"><span>{t("learn_g4_peor")}</span><span><i>{t("learn_g4_menos", { banda })}</i><i>{t("learn_g4_mas", { banda })}</i></span><span>{t("learn_g4_mejor")}</span></div>
        <p className="pg-txt">{t.rich("learn_g4_puntos_d", { banda, gana: ciclo.puntos.gana, empata: ciclo.puntos.empata, pierde: ciclo.puntos.pierde, b: c => <b>{c}</b> })}</p>
      </>}
      <Seccion t={t} titulo="learn_g4_jornadas_t" texto="learn_g4_jornadas_d" />
      <p className="cu-pie">{t("learn_g4_provisional")}</p>
      <ul className="cu-grupo"><li><Link className="cu-celda" href="/liga"><span>{t("learn_ir_clasificacion").replace(/\s*›$/, "")}</span><span /><Chevron /></Link></li></ul>
    </>;
  }
  const premio = ciclo?.premio;
  if (!premio?.visible) return null;
  const basico = premio.umbral_basico;
  const completo = premio.umbral_completo;
  const importes = premio.importes;
  const euros = (v: number) => new Intl.NumberFormat(locale, { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);
  const cifras = (lista: number[]) => lista.map((v, i) => `${t("learn_g5_puesto", { n: i + 1 })} ${euros(v)}`).join(" · ");
  return <>
    {basico != null && completo != null && importes?.["1"] && importes["2"] && <>
      <h2 className="pg-sec">{t("learn_g5_cuanto_t")}</h2>
      <ul className="cu-grupo">
        <li><div className="cu-celda alta"><span className="t"><b>{t("learn_g5_completo", { n: completo })}</b><small>{cifras(importes["2"])}</small></span></div></li>
        <li><div className="cu-celda alta"><span className="t"><b>{t("learn_g5_basico", { desde: basico, hasta: completo - 1 })}</b><small>{cifras(importes["1"])}</small></span></div></li>
        <li><div className="cu-celda texto">{t("learn_g5_sin", { n: basico })}</div></li>
      </ul>
    </>}
    <h2 className="pg-sec">{t("learn_g5_optar_t")}</h2>
    <ul className="cu-grupo">{(["legal_bases_quien_1", "legal_bases_quien_3", "legal_bases_resumen_4"] as const).map(k => <li key={k}><div className="cu-celda texto">{t(k)}</div></li>)}</ul>
    <ul className="cu-grupo"><li><Link className="cu-celda" href="/legal/bases-premio"><span>{t("learn_g5_bases")}</span><span /><Chevron /></Link></li></ul>
  </>;
}
