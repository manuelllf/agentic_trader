import Link from "next/link";
import { PlantillaLegal } from "../PlantillaLegal";
import { Contacto, TITULAR } from "../datos";
import { getTranslations } from "next-intl/server";

export async function generateMetadata() { const t = await getTranslations(); return { title: `${t("legal_terms_title")} — Vennett` }; }

// Al cobrar algo real hay que revisar créditos y plan Pro (precio, desistimiento, factura) y
// completar el aviso legal con NIF y domicilio.
export default async function Terminos() {
  const t = await getTranslations();
  return (
    <PlantillaLegal
      titulo={t("legal_terms_title")}
      resumen={[
        t("legal_terms_summary_1"), t("legal_terms_summary_2"), t("legal_terms_summary_3"),
      ]}
    >
      <h2>{t("legal_terms_what_is_vennett")}</h2>
      <p>
        {t.rich("legal_terms_paper_platform", { b: (chunks) => <b>{chunks}</b> })}
      </p>
      <p>
        {t.rich("legal_terms_no_advice", { b: (chunks) => <b>{chunks}</b> })}
      </p>

      <h2>{t("legal_terms_provider")}</h2>
      <p>
        {TITULAR.nombre} ({t("legal_holder_location")}). {t("legal_contact_label")}: <Contacto uso="general" />. {t("legal_terms_more_details")} {" "}
        <Link href="/legal/aviso">{t("legal_notice_title")}</Link>.
      </p>

      <h2>{t("legal_terms_your_account")}</h2>
      <ul>
        <li>{t("legal_terms_account_age")} <Link href="/legal/privacidad">{t("legal_privacy_policy")}</Link>.</li>
        <li>{t("legal_terms_password")} <Link href="/cuenta">{t("legal_account_link")}</Link>.</li>
        <li>{t("legal_terms_delete_account")}</li>
      </ul>

      <h2>{t("legal_terms_publishing")}</h2>
      <ul>
        <li>{t("legal_terms_public_content")}</li><li>{t("legal_terms_display_content")}</li><li>{t("legal_terms_no_personal_data")}</li><li>{t("legal_terms_report")} <Contacto uso="abuso" />.</li>
      </ul>

      <h2>{t("legal_terms_ai")}</h2>
      <p>
        {t("legal_terms_ai_text")} <Link href="/legal/privacidad">{t("legal_privacy_policy")}</Link>.
      </p>

      <h2>{t("legal_terms_credits_pro")}</h2>
      <ul>
        <li>{t.rich("legal_terms_credits", { b: (chunks) => <b>{chunks}</b> })}</li><li>{t("legal_terms_pro_free")}</li>
      </ul>

      <h2>{t("legal_terms_acceptable_use")}</h2>
      <p>
        {t("legal_terms_acceptable_use_text")}
      </p>

      <h2>{t("legal_terms_availability")}</h2>
      <p>
        {t("legal_terms_availability_text")}
      </p>

      <h2>{t("legal_terms_changes_law")}</h2>
      <p>
        {t("legal_terms_changes_law_text")}
      </p>
    </PlantillaLegal>
  );
}
