import Link from "next/link";
import { Fragment } from "react";
import { getLocale, getTranslations } from "next-intl/server";
import { cifrasDelMetodo, leerMercado } from "@/lib/aprender";
import { metadataCompartir } from "@/lib/sitio";
import { BarraPestanas } from "../_ui/BarraPestanas";
import { CabeceraPagina } from "../_ui/CabeceraPagina";
import "../liga/ranking.css";
import "../_ui/grupos.css";
import "../_ui/paginas.css";

export async function generateMetadata() {
  const [t, idioma] = await Promise.all([getTranslations(), getLocale()]);
  return metadataCompartir({ titulo: `${t("help_title")} · Vennett`, descripcion: t("meta_como_funciona_descripcion"), idioma, ruta: "/como-funciona" });
}

function Chevron() {
  return <svg className="chev" viewBox="0 0 8 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
    strokeLinejoin="round" aria-hidden="true"><path d="m1 1 6 6-6 6" /></svg>;
}

// Los números del método salen de la última foto, /liga/aprender/mercado.
// Sin datos, el texto va sin cifra.
export default async function ComoFunciona() {
  const [t, idioma, mercado] = await Promise.all([getTranslations(), getLocale(), leerMercado()]);
  const cifras = cifrasDelMetodo(mercado, idioma === "en" ? "en" : "es");
  const pasos: { titulo: string; texto: string; cifra?: string | null; extra?: string }[] = [
    {
      titulo: t("help_step_1_title"),
      texto: cifras ? t("help_step_1_text", { total: cifras.total }) : t("help_step_1_text_sin_cifra"),
      cifra: cifras ? t("help_step_1_stat", { total: cifras.total }) : null,
    },
    {
      titulo: t("help_step_2_title"),
      texto: t("help_step_2_text"),
      cifra: cifras?.pasan ? t("help_step_2_stat", { umbral: cifras.umbral, pasan: cifras.pasan }) : null,
    },
    { titulo: t("help_step_3_title"), texto: t("help_step_3_text"), extra: t("help_step_3_extra") },
    { titulo: t("help_step_4_title"), texto: t("help_step_4_text") },
    { titulo: t("help_step_5_title"), texto: t("help_step_5_text") },
  ];
  const listas = [
    { cab: t("help_model_title"), items: [1, 2, 3, 4].map((i) => t(`help_model_item_${i}`)) },
    { cab: t("help_code_title"), items: [1, 2, 3, 4].map((i) => t(`help_code_item_${i}`)) },
  ];
  // Notas sobre 100, como la final: 70·30 % + 50·30 % + 80·20 % + 60·20 % = 64.
  const notas = [
    { clave: "help_score_fundamentals", nota: 70 },
    { clave: "help_score_valuation", nota: 50 },
    { clave: "help_score_financing", nota: 80 },
    { clave: "help_score_catalyst", nota: 60 },
  ].map(({ clave, nota }) => {
    const [nombre, peso] = t(clave).split(" · ");
    return { clave, nombre, peso, nota };
  });
  const negrita = (chunks: React.ReactNode) => <b>{chunks}</b>;
  return (
    <main className="scroll lv-pagina pg-pagina">
      <CabeceraPagina titulo={t("help_title")} />
      <div className="pg">
        <h1>{t("help_heading")}</h1>
        <p className="pg-lead">{t("help_intro")}</p>
        <ul className="cu-grupo numerado">
          {pasos.map((p, i) => (
            <li key={p.titulo}>
              <div className="pg-paso">
                <span className="n">{i + 1}</span>
                <b>{p.titulo}</b>
                <p>{p.texto}</p>
                {p.cifra && <small>{p.cifra}</small>}
                {p.extra && <p className="extra">{p.extra}</p>}
              </div>
            </li>
          ))}
        </ul>

        <h2 className="pg-sec">{t("help_ai_or_code_heading")}</h2>
        {listas.map((l) => (
          <Fragment key={l.cab}>
            <p className="cu-cab">{l.cab}</p>
            <ul className="cu-grupo">
              {l.items.map((x) => <li key={x}><div className="cu-celda texto">{x}</div></li>)}
            </ul>
          </Fragment>
        ))}

        <h2 className="pg-sec">{t("help_example_title")}</h2>
        <p className="pg-txt">{t("help_example_intro")}</p>
        <ul className="cu-grupo">
          <li>
            <div className="cu-celda alta">
              <span className="t"><b>{t("help_example_company")}</b><small>{t("help_example_ticker")} · {t("help_example_sector")}</small></span>
            </div>
          </li>
          {notas.map((n) => (
            <li key={n.clave}>
              <div className="cu-celda alta">
                <span className="t"><b>{n.nombre}</b><small>{n.peso}</small></span>
                <span className="valor fuerte">{n.nota}</span>
              </div>
            </li>
          ))}
          <li>
            <div className="cu-celda">
              <span>{t("help_example_total")}</span>
              <span className="valor fuerte">64 {t("help_out_of_100")}</span>
            </div>
          </li>
        </ul>
        <p className="cu-pie">{t("help_example_disclaimer")}. {t("help_example_reason")}</p>

        <h2 className="pg-sec">{t("help_fairness_title")}</h2>
        <ul className="cu-grupo">
          {["rules", "results", "scores", "house", "admin"].map((k) => (
            <li key={k}><div className="cu-celda texto">{t.rich(`help_fairness_${k}`, { b: negrita })}</div></li>
          ))}
        </ul>
        <p className="cu-pie"><b>{t("help_question_heading")}</b> {t("help_question_text")}</p>

        <Link className="cu-boton" href="/entrar?next=/crear">{t("help_create_strategy")}</Link>
        <ul className="cu-grupo">
          <li><Link className="cu-celda" href="/liga"><span>{t("help_view_standings")}</span><span /><Chevron /></Link></li>
          <li><Link className="cu-celda" href="/aprender"><span>{t("help_aprender")}</span><span /><Chevron /></Link></li>
        </ul>
        <p className="pg-pie">{t("help_disclaimer")} <Link className="pg-a" href="/legal/terminos">{t("legal_terms_short")}</Link></p>
      </div>
      <BarraPestanas />
    </main>
  );
}
