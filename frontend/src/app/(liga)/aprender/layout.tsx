import Link from "next/link";
import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { leerCiclo } from "@/lib/aprender";
import { Marca } from "../_ui/Marca";
import { guiasVisibles } from "./guias";
import { IndiceLateral } from "./_ui/IndiceLateral";
import "./aprender.css";

export default async function AprenderLayout({ children }: { children: ReactNode }) {
  const [t, ciclo] = await Promise.all([getTranslations(), leerCiclo()]);
  const guias = guiasVisibles(ciclo?.premio.visible === true).map(g => ({ slug: g.slug, titulo: t(`learn_${g.clave}_t`) }));
  return <main className="sencilla apr">
    <header className="sencilla-top"><Link href="/" className="wordmark"><Marca /></Link><Link href="/liga" className="apr-mi-liga">{t("learn_mi_liga")}</Link></header>
    <div className="apr-marco"><IndiceLateral guias={guias} /><div className="apr-lectura">{children}</div></div>
    <p className="apr-pie">{t("help_disclaimer")}</p>
  </main>;
}
