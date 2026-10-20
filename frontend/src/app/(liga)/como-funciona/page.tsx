import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { cifrasDelMetodo, leerMercado } from "@/lib/aprender";
import { metadataCompartir } from "@/lib/sitio";
import { Marca } from "../_ui/Marca";

export async function generateMetadata() {
  const [t, idioma] = await Promise.all([getTranslations(), getLocale()]);
  return metadataCompartir({ titulo: `${t("help_title")} · Vennett`, descripcion: t("meta_como_funciona_descripcion"), idioma, ruta: "/como-funciona" });
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
  return (
    <main className="sencilla cf">
      <header className="sencilla-top">
        <Link href="/" className="wordmark"><Marca /></Link>
      </header>

      <div className="cf-cuerpo">
        <p className="cf-eyebrow">{t("help_title")}</p>
        <h1>{t("help_heading")}</h1>
        <p className="cf-lead">
          {t("help_intro")}
        </p>

        <ol className="cf-pasos">
          {pasos.map((p, i) => (
            <li className="cf-paso" key={p.titulo}>
              <span className="cf-n" aria-hidden="true">{i + 1}</span>
              <div>
                <h2>{p.titulo}</h2>
                <p>{p.texto}</p>
                <div className="cf-etiquetas">
                  {p.cifra && <span className="cf-cifra">{p.cifra}</span>}
                </div>
                {p.extra && <p className="cf-extra">{p.extra}</p>}
              </div>
            </li>
          ))}
        </ol>

        <section className="cf-sec" aria-labelledby="cf-quien-pone">
          <h2 id="cf-quien-pone">{t("help_ai_or_code_heading")}</h2>
          <div className="cf-dos">
            <div className="cf-caja">
              <h3><span className="cf-punto ia" aria-hidden="true" />{t("help_model_title")}</h3>
              <ul>
                <li>{t("help_model_item_1")}</li><li>{t("help_model_item_2")}</li><li>{t("help_model_item_3")}</li><li>{t("help_model_item_4")}</li>
              </ul>
            </div>
            <div className="cf-caja">
              <h3><span className="cf-punto codigo" aria-hidden="true" />{t("help_code_title")}</h3>
              <ul>
                <li>{t("help_code_item_1")}</li><li>{t("help_code_item_2")}</li><li>{t("help_code_item_3")}</li><li>{t("help_code_item_4")}</li>
              </ul>
            </div>
          </div>
        </section>

        <section className="cf-sec" aria-labelledby="cf-ejemplo">
          <h2 id="cf-ejemplo">{t("help_example_title")}</h2>
          <p className="cf-sub">{t("help_example_intro")}</p>
          <div className="cf-ejemplo">
            <p className="cf-rotulo">{t("help_example_disclaimer")}</p>
            <div className="cf-emp"><b>{t("help_example_company")}</b><span>{t("help_example_ticker")} · {t("help_example_sector")}</span></div>
            <div className="cf-notas">
              <div><b>7</b><small>{t("help_score_fundamentals")}</small></div><div><b>5</b><small>{t("help_score_valuation")}</small></div><div><b>8</b><small>{t("help_score_financing")}</small></div><div><b>6</b><small>{t("help_score_catalyst")}</small></div>
            </div>
            <p className="cf-total">{t("help_example_total")} <b>64</b> {t("help_out_of_100")}</p>
            <p className="cf-porque">{t("help_example_reason")}</p>
          </div>
        </section>

        <section className="cf-sec" aria-labelledby="cf-justo">
          <h2 id="cf-justo">{t("help_fairness_title")}</h2>
          <ul className="cf-lista">
            <li>{t.rich("help_fairness_rules", { b: (chunks) => <b>{chunks}</b> })}</li>
            <li>{t.rich("help_fairness_results", { b: (chunks) => <b>{chunks}</b> })}</li>
            <li>{t.rich("help_fairness_scores", { b: (chunks) => <b>{chunks}</b> })}</li>
            <li>{t.rich("help_fairness_house", { b: (chunks) => <b>{chunks}</b> })}</li>
            <li>{t.rich("help_fairness_admin", { b: (chunks) => <b>{chunks}</b> })}</li>
          </ul>
          <p className="cf-callout">
            <b>{t("help_question_heading")}</b> {t("help_question_text")}
          </p>
        </section>

        <div className="cf-cta">
          <Link href="/entrar?next=/crear" className="btn pri">{t("help_create_strategy")}</Link>
          <Link href="/liga" className="btn">{t("help_view_standings")}</Link>
          <Link href="/aprender" className="btn">{t("help_aprender")}</Link>
        </div>
        <p className="cf-pie">
          {t("help_disclaimer")} {" "}<Link href="/legal/terminos">{t("legal_terms_short")}</Link>
        </p>
      </div>
    </main>
  );
}
