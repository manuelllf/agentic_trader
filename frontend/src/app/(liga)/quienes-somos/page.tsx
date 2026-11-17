import Link from "@/components/Enlace";
import { getLocale, getTranslations } from "next-intl/server";
import { normalizeLocale } from "@/i18n/locale";
import { urlsDeIdiomas } from "@/i18n/rutas";
import { escaparJsonLd } from "@/lib/blog/publico";
import { AUTOR_PUBLICO, PERFILES_PUBLICOS, URL_PUBLICA, metadataCompartir } from "@/lib/sitio";
import { CabeceraPagina } from "../_ui/CabeceraPagina";
import { Chevron } from "../aprender/_ui/Guias";
import { Contacto, TITULAR } from "../legal/datos";
import "../liga/ranking.css";
import "../_ui/grupos.css";
import "../_ui/paginas.css";

export async function generateMetadata() {
  const [t, idioma] = await Promise.all([getTranslations(), getLocale()]);
  return metadataCompartir({ titulo: `${t("about_title")} · Vennett`, descripcion: t("meta_quienes_somos_descripcion"), idioma, ruta: "/quienes-somos" });
}

function Fila({ href, titulo, sub }: { href: string; titulo: string; sub: string }) {
  return <li><Link className="cu-celda alta" href={href}><span className="t"><b>{titulo}</b><small>{sub}</small></span><span /><Chevron /></Link></li>;
}

export default async function QuienesSomos() {
  const [t, idioma] = await Promise.all([getTranslations(), getLocale()]);
  const locale = normalizeLocale(idioma) ?? "es";
  const prefijo = locale === "en" ? "/en" : "";
  const datos = {
    "@context": "https://schema.org", "@type": "AboutPage", name: t("about_title"), inLanguage: locale,
    url: urlsDeIdiomas(URL_PUBLICA, "/quienes-somos")[locale],
    about: { "@type": "Organization", name: "Vennett", url: URL_PUBLICA, sameAs: PERFILES_PUBLICOS,
      founder: { "@type": "Person", name: AUTOR_PUBLICO, sameAs: PERFILES_PUBLICOS } },
  };
  return (
    <main className="scroll lv-pagina pg-pagina">
      <CabeceraPagina titulo={t("about_title")} />
      <div className="pg">
        <script type="application/ld+json">{escaparJsonLd(datos)}</script>
        <h1>{t("about_title")}</h1>
        <p className="pg-lead">{t("about_lead")}</p>

        <h2 className="pg-sec">{t("about_quien_titulo")}</h2>
        <ul className="cu-grupo">
          <li><div className="cu-celda texto">{t("about_quien", { titular: TITULAR.nombre })}</div></li>
          <Fila href="/legal/aviso" titulo={t("about_aviso")} sub={t("about_aviso_sub")} />
        </ul>

        <h2 className="pg-sec">{t("about_hacemos_titulo")}</h2>
        <ul className="cu-grupo">
          <Fila href="/liga" titulo={t("about_liga")} sub={t("about_liga_sub")} />
          <Fila href={`${prefijo}/criptico`} titulo={t("about_criptico")} sub={t("about_criptico_sub")} />
          <Fila href={`${prefijo}/blog`} titulo={t("about_blog")} sub={t("about_blog_sub")} />
        </ul>

        <h2 className="pg-sec">{t("about_ia_titulo")}</h2>
        <ul className="cu-grupo">
          <li><div className="cu-celda texto">{t("about_ia")}</div></li>
          <Fila href="/como-funciona" titulo={t("help_ai_or_code_heading")} sub={t("help_title")} />
        </ul>

        <h2 className="pg-sec">{t("about_porque_titulo")}</h2>
        <ul className="cu-grupo"><li><div className="cu-celda texto">{t("about_porque")}</div></li></ul>

        <h2 className="pg-sec">{t("about_pago_titulo")}</h2>
        <ul className="cu-grupo"><li><div className="cu-celda texto">{t("about_pago")}</div></li></ul>

        <h2 className="pg-sec">{t("about_escribenos_titulo")}</h2>
        <ul className="cu-grupo">
          <li><div className="cu-celda texto">{t.rich("about_escribenos", { correo: () => <Contacto uso="general" /> })}</div></li>
        </ul>
        <ul className="cu-grupo">
          <Fila href="/politica-editorial" titulo={t("editorial_title")} sub={t("editorial_lead")} />
        </ul>

        <p className="pg-pie">{t("help_disclaimer")}</p>
      </div>
    </main>
  );
}
