import Link from "next/link";
import { PlantillaLegal } from "../PlantillaLegal";
import { Contacto, TITULAR } from "../datos";
import { getTranslations } from "next-intl/server";

export async function generateMetadata() { const t = await getTranslations(); return { title: `${t("legal_privacy_title")} — Vennett` }; }

// Solo lista los servicios que reciben datos de personas usuarias (no las fuentes de mercado).
// Si se añade un proveedor, un dato o una analítica, actualizar esta página y la de cookies.
export default async function Privacidad() {
  const t = await getTranslations();
  return (
    <PlantillaLegal
      titulo={t("legal_privacy_policy")}
      resumen={[
        t("legal_privacy_summary_1"), t("legal_privacy_summary_2"), t("legal_privacy_summary_3"), t("legal_privacy_summary_4"),
      ]}
    >
      <h2>{t("legal_privacy_controller")}</h2>
      <p>
        {TITULAR.nombre} ({t("legal_holder_location")}). {t("legal_contact_label")}: <Contacto />. {t("legal_privacy_more_details")} {" "}
        <Link href="/legal/aviso">{t("legal_notice_title")}</Link>.
      </p>

      <h2>{t("legal_privacy_data_title")}</h2>
      <ul>
        <li><b>{t("legal_privacy_account")}</b>: {t("legal_privacy_account_data")}</li>
        <li><b>{t("legal_privacy_profile")}</b>: {t("legal_privacy_profile_data")}</li>
        <li><b>{t("legal_privacy_created_content")}</b>: {t("legal_privacy_created_content_data")}</li>
        <li><b>{t("legal_privacy_account_visits")}</b>: {t("legal_privacy_account_visits_data")}</li>
        <li><b>{t("legal_privacy_credits_plan")}</b>: {t("legal_privacy_credits_plan_data")}</li>
        <li><b>{t("legal_privacy_ai_usage")}</b>: {t("legal_privacy_ai_usage_data")}</li>
        <li><b>{t("legal_privacy_reports_errors")}</b>: {t("legal_privacy_reports_errors_data")}</li>
        <li><b>{t("legal_privacy_records")}</b>: {t("legal_privacy_records_data")}</li>
      </ul>
      <p>
        {t("legal_privacy_not_collected")}
      </p>

      <h2>{t("legal_privacy_purpose_basis")}</h2>
      <ul>
        <li><b>{t("legal_privacy_service")}</b> ({t("legal_gdpr_art_6_1_b")}): {t("legal_privacy_service_basis")}</li>
        <li><b>{t("legal_privacy_security")}</b> ({t("legal_gdpr_art_6_1_f")}): {t("legal_privacy_security_basis")} <Link href="#derechos">{t("legal_privacy_rights_ref")}</Link>.</li>
        <li><b>{t("legal_privacy_ai_features")}</b> ({t("legal_gdpr_art_6_1_a")}): {t("legal_privacy_ai_basis")}</li>
        <li><b>{t("legal_privacy_legal_obligation")}</b> ({t("legal_gdpr_art_6_1_c")}): {t("legal_privacy_legal_basis")}</li>
      </ul>

      <h2>{t("legal_privacy_ai_transfers")}</h2>
      <p>{t("legal_privacy_ai_optional")}</p>
      <ul>
        <li>{t("legal_privacy_ai_deepseek")}</li><li>{t("legal_privacy_ai_jev")}</li><li>{t("legal_privacy_ai_readings_moderation")}</li>
      </ul>
      <p>
        {t("legal_privacy_deepseek_transfer")}
      </p>
      <p>
        {t("legal_privacy_automated_decisions")}
      </p>

      <h2>{t("legal_privacy_processors")}</h2>
      <p>{t("legal_privacy_processors_intro")}</p>
      <ul>
        <li>{t("legal_privacy_supabase")}</li><li>{t("legal_privacy_railway")}</li><li>{t("legal_privacy_vercel")}</li>
      </ul>
      <p>
        {t("legal_privacy_transfers_outside_eu")}
      </p>

      <h2>{t("legal_privacy_retention")}</h2>
      <ul>
        <li>{t("legal_privacy_retention_account")}</li><li>{t("legal_privacy_retention_strategies")}</li><li>{t("legal_privacy_retention_reports")}</li><li>{t("legal_privacy_retention_logs")}</li><li>{t("legal_privacy_retention_backups")}</li>
      </ul>

      <h2 id="derechos">{t("legal_privacy_rights")}</h2>
      <p>
        {t("legal_privacy_rights_intro")} <Link href="/cuenta">{t("legal_account_link")}</Link>{t("legal_privacy_rights_account_actions")} <Contacto />. {t("legal_privacy_rights_authority")}
      </p>

      <h2>{t("legal_privacy_security_minors")}</h2>
      <p>
        {t("legal_privacy_security_minors_text")}
      </p>

      <h2>{t("legal_privacy_changes")}</h2>
      <p>
        {t("legal_privacy_changes_text")}
      </p>
    </PlantillaLegal>
  );
}
