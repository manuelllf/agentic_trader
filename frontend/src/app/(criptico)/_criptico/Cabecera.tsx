"use client";

import Link from "next/link";
import type { Ref } from "react";
import { SelectorIdioma } from "@/components/SelectorIdioma";
import type { Idioma, Traducir } from "@/lib/criptico/tipos";
import { Marca } from "../../(liga)/_ui/Marca";
import { ruta } from "./textos";

// Cabecera del críptico, la misma en el juego y en el archivo: sello, idioma, archivo y cómo se lee.
export default function Cabecera({ idioma, t, enlaces, actual, alAyuda, refAyuda }: {
  idioma: Idioma; t: Traducir; enlaces: Record<Idioma, string>; actual: "juego" | "archivo";
  alAyuda: () => void; refAyuda?: Ref<HTMLButtonElement>;
}) {
  return <header className="cr-cab">
    <Link className="sello" href={ruta(idioma)}><Marca className="marca" /><i aria-hidden="true" /><b>{t("cr_nombre")}</b></Link>
    <nav><SelectorIdioma actual={idioma} etiqueta={t("cr_idioma_selector")} enlaces={enlaces} />
      <Link className="cr-icono" href={`${ruta(idioma)}/archivo`} aria-label={t("cr_archivo_titulo")}
        aria-current={actual === "archivo" ? "page" : undefined}>▤</Link>
      <button type="button" ref={refAyuda} className="cr-icono" onClick={alAyuda} aria-label={t("cr_leer")}>?</button>
    </nav>
  </header>;
}
