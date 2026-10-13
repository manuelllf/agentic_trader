import { getTranslations } from "next-intl/server";
import { metadataSinIndexar } from "@/lib/sitio";

export async function generateMetadata() {
  const t = await getTranslations();
  return metadataSinIndexar(`${t("meta_auth_titulo")} — Vennett`);
}

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
