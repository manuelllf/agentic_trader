import type { Ref } from "react";
import type { Traducir } from "@/lib/criptico/tipos";
import { Leyenda } from "./Pista";

// «Cómo se lee un críptico»: la hoja que sale la primera vez en el móvil y con el «?» de la cabecera.
export default function HojaBienvenida({ t, cerrar, empezar }: {
  t: Traducir; cerrar: () => void; empezar: Ref<HTMLButtonElement>;
}) {
  return <div className="cr-bienvenida" onClick={evento => { if (evento.target === evento.currentTarget) cerrar(); }}>
    <section className="cr-hoja" role="dialog" aria-modal="true" aria-labelledby="cr-bienvenida-titulo">
      <div className="cr-grabber" aria-hidden="true" />
      <h2 id="cr-bienvenida-titulo">{t("cr_bienvenida")}</h2>
      <ol><li>{t("cr_paso_uno")}</li><li>{t("cr_paso_dos")}</li><li>{t("cr_paso_tres")}</li></ol>
      <Leyenda t={t} />
      <button ref={empezar} type="button" className="btn pri wide" onClick={cerrar}>{t("cr_empezar")}</button>
    </section>
  </div>;
}
