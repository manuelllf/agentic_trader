import Link from "next/link";
import { PlantillaLegal } from "../PlantillaLegal";
import { Contacto, TITULAR } from "../datos";
import { getTranslations } from "next-intl/server";

export async function generateMetadata() { const t = await getTranslations(); return { title: `${t("legal_notice_title")} — Vennett` }; }

// Solo nombre, lugar y contacto mientras no haya actividad económica; al cobrar hay que añadir
// NIF y domicilio.
export default async function Aviso() {
  const t = await getTranslations();
  return (
    <PlantillaLegal titulo={t("legal_notice_title")}>
      <h2>{t("legal_notice_owner")}</h2>
      <ul>
        <li><b>{t("legal_notice_name")}</b>: {TITULAR.nombre}</li>
        <li><b>{t("legal_notice_location")}</b>: {t("legal_holder_location")}</li>
        <li><b>{t("legal_contact_label")}</b>: <Contacto uso="info" /></li>
      </ul>
      <p>
        {t("legal_notice_service_description")}
      </p>

      <h2>{t("legal_notice_intellectual_property")}</h2>
      <p>
        {t("legal_notice_ip_text")} <Link href="/legal/terminos">{t("legal_terms_short")}</Link>.
      </p>

      <h2>{t("legal_notice_more_info")}</h2>
      <p>
        <Link href="/legal/terminos">{t("legal_terms_title")}</Link>,{" "}
        <Link href="/legal/privacidad">{t("legal_privacy_policy")}</Link> y{" "}
        <Link href="/legal/cookies">{t("legal_cookies_policy")}</Link>. {t("legal_applicable_law")}: {t("legal_spain_feminine")}.
      </p>
    </PlantillaLegal>
  );
}
