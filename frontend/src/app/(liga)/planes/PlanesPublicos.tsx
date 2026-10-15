"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { LanguageSelector } from "@/i18n/LanguageSelector";
import { useSesion } from "../_sesion/SesionContext";
import { ListaPlanes } from "../_ui/ListaPlanes";
import { Marca } from "../_ui/Marca";

const PLAN_EN_CUENTA = "/cuenta/plan";

/** Planes y precios a la vista de todos: salen del catálogo, sin llamar a la API. Elegir manda a
 *  crear cuenta (y de ahí al plan) o, con sesión, directo a la cuenta, donde se paga. */
export function PlanesPublicos() {
  const t = useTranslations();
  const { estado } = useSesion();
  // Mientras no se sabe si hay sesión se deja el enlace de alta, que es el que ve quien rastrea la página.
  const destino = estado === "dentro" ? PLAN_EN_CUENTA : `/registrar?next=${PLAN_EN_CUENTA}`;
  return (
    <main className="sencilla">
      <header className="sencilla-top">
        <Link href="/" className="wordmark"><Marca /></Link><LanguageSelector />
      </header>
      <section className="sencilla-cuerpo arriba" aria-labelledby="titular">
        <div className="ajustes">
          <h1 id="titular">{t("planes_titulo")}</h1>
          <div className="form cuenta-plan">
            <p className="cuenta-plan-nota">{t("planes_intro")}</p>
            <ListaPlanes accion={() => (
              <Link href={destino} className="btn small">{t("planes_elegir")}</Link>
            )} />
          </div>
        </div>
      </section>
    </main>
  );
}
