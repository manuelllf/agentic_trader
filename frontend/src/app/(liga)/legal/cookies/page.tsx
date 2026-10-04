import Link from "next/link";
import { PlantillaLegal } from "../PlantillaLegal";
import { getTranslations } from "next-intl/server";

export async function generateMetadata() { const t = await getTranslations(); return { title: `${t("legal_cookies_title")} — Vennett` }; }

// La sesión en `localStorage` (`lib/liga/supabase.ts`) es lo único que guarda la web pública.
// Si se añade algo (captcha, analítica), actualizar esta página antes de desplegarlo.
export default async function Cookies() {
  const t = await getTranslations();
  return (
    <PlantillaLegal
      titulo={t("legal_cookies_policy")}
      resumen={[
        t("legal_cookies_summary_1"), t("legal_cookies_summary_2"), t("legal_cookies_summary_3"),
      ]}
    >
      <h2>{t("legal_cookies_browser_storage")}</h2>
      <table className="legal-tabla">
        <thead>
          <tr><th>{t("legal_cookies_table_name")}</th><th>{t("legal_cookies_table_purpose")}</th><th>{t("legal_cookies_table_duration")}</th></tr>
        </thead>
        <tbody>
          <tr>
            <td><code>liguilla-sesion</code> ({t("legal_cookies_local_storage")})</td>
            <td>{t("legal_cookies_session_purpose")}</td>
            <td>{t("legal_cookies_session_duration")}</td>
          </tr>
          <tr><td><code>vennett_locale</code></td><td>{t("legal_cookies_locale_purpose")}</td><td>{t("legal_cookies_locale_duration")}</td></tr>
          <tr><td><code>vennett_visitor_locale</code></td><td>{t("legal_cookies_visitor_purpose")}</td><td>{t("legal_cookies_locale_duration")}</td></tr>
        </tbody>
      </table>

      <h2>{t("legal_cookies_if_changes")}</h2>
      <p>
        {t("legal_cookies_changes_text")}
      </p>
      <p>
        {t("legal_cookies_privacy_more")} <Link href="/legal/privacidad">{t("legal_privacy_policy")}</Link>.
      </p>
    </PlantillaLegal>
  );
}
