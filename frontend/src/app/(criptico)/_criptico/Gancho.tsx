import type { Detalle, Traducir } from "@/lib/criptico/tipos";

export default function Gancho({ detalle, t }: { detalle: Detalle; t: Traducir }) {
  const regla = detalle.regla_catalogo;
  return <section className="cr-gancho cr-bloque">
    <h2>{t(regla ? "cr_regla_titulo" : "cr_gancho_titulo")}</h2>
    <p>{regla ? t("cr_regla_texto", { regla }) : t("cr_gancho_texto")}</p>
    {regla && <p className="cr-regla">{regla}</p>}
    <a className="btn pri wide" href="/registrar">{t("cr_crear")}</a>
    <a className="cr-enlace" href="#suscripcion">{t("cr_correo")}</a>
  </section>;
}
