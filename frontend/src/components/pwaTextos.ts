import { getTranslations } from "next-intl/server";

// Los tres textos del aviso de instalación. Se leen en el servidor y llegan como props: así las
// páginas que no mandan el catálogo al navegador (el críptico y el blog) también pueden mostrarlo.
export async function textosInstalar() {
  const t = await getTranslations();
  return { titulo: t("system_instalar_vennett"), texto: t("system_vennett_a_mano"), accion: t("system_instalar") };
}
