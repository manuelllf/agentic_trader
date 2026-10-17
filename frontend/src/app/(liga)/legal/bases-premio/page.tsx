import { PlantillaLegal } from "../PlantillaLegal";
import { getLocale, getTranslations } from "next-intl/server";
import { metadataCompartir } from "@/lib/sitio";

export async function generateMetadata() {
  const [t, idioma] = await Promise.all([getTranslations(), getLocale()]);
  return metadataCompartir({ titulo: `${t("legal_bases_title")} · Vennett`, descripcion: t("meta_legal_bases_descripcion"), idioma, ruta: "/legal/bases-premio" });
}

// Bases del premio anual: cifras de `motor/premio.py` y `procesos/premio.py`. Si cambian, cambia aquí.
export default async function BasesPremio() {
  const t = await getTranslations();
  return (
    <PlantillaLegal
      titulo={t("legal_bases_title")}
      resumen={[
        t("legal_bases_resumen_1"), t("legal_bases_resumen_2"), t("legal_bases_resumen_3"), t("legal_bases_resumen_4"),
      ]}
    >
      <p>{t("legal_bases_organiza")}</p>

      <h2>{t("legal_bases_h_quien")}</h2>
      <ul>
        <li>{t("legal_bases_quien_1")}</li>
        <li>{t("legal_bases_quien_2")}</li>
        <li>{t("legal_bases_quien_3")}</li>
        <li>{t("legal_bases_quien_4")}</li>
      </ul>

      <h2>{t("legal_bases_h_calculo")}</h2>
      <ul>
        <li>{t("legal_bases_calculo_1")}</li>
        <li>{t("legal_bases_calculo_2")}</li>
        <li>{t("legal_bases_calculo_3")}</li>
      </ul>

      <h2>{t("legal_bases_h_activacion")}</h2>
      <ul>
        <li>{t("legal_bases_activacion_1")}</li>
        <li>{t("legal_bases_activacion_2")}</li>
      </ul>

      <h2>{t("legal_bases_h_importes")}</h2>
      <ul>
        <li>{t("legal_bases_importes_1")}</li>
        <li>{t("legal_bases_importes_2")}</li>
        <li>{t("legal_bases_importes_3")}</li>
      </ul>

      <h2>{t("legal_bases_h_pago")}</h2>
      <ul>
        <li>{t("legal_bases_pago_1")}</li>
        <li>{t("legal_bases_pago_2")}</li>
      </ul>

      <h2>{t("legal_bases_h_impuestos")}</h2>
      <ul>
        <li>{t("legal_bases_impuestos_1")}</li>
        <li>{t("legal_bases_impuestos_2")}</li>
      </ul>

      <h2>{t("legal_bases_h_datos")}</h2>
      <ul>
        <li>{t("legal_bases_datos_1")}</li>
      </ul>

      <h2>{t("legal_bases_h_cambios")}</h2>
      <ul>
        <li>{t("legal_bases_cambios_1")}</li>
        <li>{t("legal_bases_cambios_3")}</li>
      </ul>
    </PlantillaLegal>
  );
}
