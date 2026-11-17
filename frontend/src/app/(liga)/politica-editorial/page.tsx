import Link from "@/components/Enlace";
import { getLocale, getTranslations } from "next-intl/server";
import { localeTag, normalizeLocale } from "@/i18n/locale";
import { urlsDeIdiomas } from "@/i18n/rutas";
import { escaparJsonLd } from "@/lib/blog/publico";
import { FECHA_EDITORIAL, URL_PUBLICA, metadataCompartir } from "@/lib/sitio";
import { CabeceraPagina } from "../_ui/CabeceraPagina";
import { Chevron } from "../aprender/_ui/Guias";
import { Contacto } from "../legal/datos";
import "../liga/ranking.css";
import "../_ui/grupos.css";
import "../_ui/paginas.css";

export async function generateMetadata() {
  const [t, idioma] = await Promise.all([getTranslations(), getLocale()]);
  return metadataCompartir({ titulo: `${t("editorial_title")} · Vennett`, descripcion: t("meta_politica_editorial_descripcion"), idioma, ruta: "/politica-editorial" });
}

const PUBLICAMOS = ["blog", "guias", "criptico", "cifras", "notas"] as const;

function Texto({ children }: { children: React.ReactNode }) {
  return <li><div className="cu-celda texto">{children}</div></li>;
}

export default async function PoliticaEditorial() {
  const [t, idioma] = await Promise.all([getTranslations(), getLocale()]);
  const locale = normalizeLocale(idioma) ?? "es";
  const revision = new Intl.DateTimeFormat(localeTag(locale), { dateStyle: "long", timeZone: "UTC" })
    .format(new Date(`${FECHA_EDITORIAL}T00:00:00Z`));
  const datos = {
    "@context": "https://schema.org", "@type": "WebPage", name: t("editorial_title"), inLanguage: locale,
    url: urlsDeIdiomas(URL_PUBLICA, "/politica-editorial")[locale], dateModified: FECHA_EDITORIAL,
    publisher: { "@type": "Organization", name: "Vennett", url: URL_PUBLICA },
  };
  return (
    <main className="scroll lv-pagina pg-pagina">
      <CabeceraPagina titulo={t("editorial_title")} />
      <div className="pg">
        <script type="application/ld+json">{escaparJsonLd(datos)}</script>
        <h1>{t("editorial_title")}</h1>
        <p className="pg-lead">{t("editorial_lead")}</p>

        <h2 className="pg-sec">{t("editorial_publicamos_titulo")}</h2>
        <ul className="cu-grupo">
          {PUBLICAMOS.map((clave) => (
            <li key={clave}>
              <div className="cu-celda alta">
                <span className="t"><b>{t(`editorial_${clave}`)}</b><small>{t(`editorial_${clave}_sub`)}</small></span>
              </div>
            </li>
          ))}
        </ul>

        <h2 className="pg-sec">{t("editorial_como_titulo")}</h2>
        <ul className="cu-grupo">
          <Texto>{t("editorial_como_ia")}</Texto>
          <Texto>{t("editorial_como_textos")}</Texto>
          <Texto>{t("editorial_como_criptico")}</Texto>
          <Texto>{t("editorial_como_firma")}</Texto>
        </ul>

        <h2 className="pg-sec">{t("editorial_datos_titulo")}</h2>
        <ul className="cu-grupo">
          <Texto>{t("editorial_datos_precios")}</Texto>
          <Texto>{t("editorial_datos_dividendos")}</Texto>
          <Texto>{t("editorial_datos_simulado")}</Texto>
        </ul>

        <h2 className="pg-sec">{t("editorial_independencia_titulo")}</h2>
        <ul className="cu-grupo">
          <Texto>{t("editorial_independencia_cobro")}</Texto>
          <Texto>{t("editorial_independencia_brokers")}</Texto>
          <Texto>{t("editorial_independencia_publicidad")}</Texto>
        </ul>

        <h2 className="pg-sec">{t("editorial_no_titulo")}</h2>
        <ul className="cu-grupo"><Texto>{t("editorial_no")}</Texto></ul>

        <h2 className="pg-sec">{t("editorial_errores_titulo")}</h2>
        <ul className="cu-grupo">
          <Texto>{t.rich("editorial_errores", { correo: () => <Contacto uso="general" /> })}</Texto>
          <Texto>{t("editorial_errores_nota")}</Texto>
        </ul>

        <ul className="cu-grupo">
          <li>
            <Link className="cu-celda alta" href="/quienes-somos">
              <span className="t"><b>{t("about_title")}</b><small>{t("about_lead").split(":")[0]}</small></span><span /><Chevron />
            </Link>
          </li>
        </ul>

        <p className="pg-pie">{t("editorial_pie", { fecha: revision })}</p>
      </div>
    </main>
  );
}
