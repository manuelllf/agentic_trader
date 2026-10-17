import { notFound } from "next/navigation";
import { PLANES_VISIBLES } from "@/lib/liga/planes";
import { getLocale, getTranslations } from "next-intl/server";
import { metadataCompartir } from "@/lib/sitio";
import { PlanesPublicos } from "./PlanesPublicos";

export async function generateMetadata() {
  if (!PLANES_VISIBLES) notFound();
  const [t, idioma] = await Promise.all([getTranslations(), getLocale()]);
  return metadataCompartir({ titulo: `${t("planes_titulo")} · Vennett`, descripcion: t("meta_planes_descripcion"), idioma, ruta: "/planes" });
}

export default function Planes() {
  if (!PLANES_VISIBLES) notFound();
  return <PlanesPublicos />;
}
