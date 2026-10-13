import { getTranslations } from "next-intl/server";
import { metadataSinIndexar } from "@/lib/sitio";

export async function generateMetadata() {
  const t = await getTranslations();
  return metadataSinIndexar(`${t("meta_cuenta_nombre_titulo")} — Vennett`);
}

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
