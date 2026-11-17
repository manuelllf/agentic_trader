import Link from "next/link";
import { rutaEnIdioma } from "@/i18n/rutas";
import type { Idioma, Traducir } from "@/lib/criptico/tipos";

// Pie del críptico, como el de la portada: quiénes somos y política editorial, lo legal y el aviso.
export default function Pie({ idioma, t }: { idioma: Idioma; t: Traducir }) {
  const hacia = (destino: string) => rutaEnIdioma(destino, idioma);
  return <footer className="cr-aviso">
    <p><Link href={hacia("/quienes-somos")}>{t("cr_pie_quienes")}</Link> · <Link href={hacia("/politica-editorial")}>{t("cr_pie_politica")}</Link></p>
    <p><Link href={hacia("/legal/aviso")}>{t("cr_pie_aviso")}</Link> · <Link href={hacia("/legal/privacidad")}>{t("cr_pie_privacidad")}</Link> · <Link href={hacia("/legal/cookies")}>{t("cr_pie_cookies")}</Link></p>
    <p>{t("cr_aviso")}</p>
  </footer>;
}
