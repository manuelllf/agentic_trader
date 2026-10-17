import { getTranslations } from "next-intl/server";
import { metadataSinIndexar } from "@/lib/sitio";
import { PLANES_VISIBLES } from "@/lib/liga/planes";

export async function generateMetadata() {
  if (!PLANES_VISIBLES) return metadataSinIndexar("Vennett");
  const t = await getTranslations();
  return metadataSinIndexar(`${t("meta_cuenta_plan_titulo")} · Vennett`);
}

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
