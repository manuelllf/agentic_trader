import type { Acertijo, Detalle, Papel, Traducir } from "@/lib/criptico/tipos";
import { Leyenda, Pista } from "./Pista";

// Lo que se explica de un acertijo resuelto: la pista desmontada, cómo se resuelve y qué es el concepto.
export default function Explicacion({ acertijo, detalle, t }: { acertijo: Acertijo; detalle: Detalle; t: Traducir }) {
  const papeles = (["def", "ind", "mat"] as Papel[]).filter(p => acertijo.pista.some(s => s.papel === p));
  return <>
    <section className="cr-bloque"><h2>{t("cr_desmontada")}</h2>
      <p className="cr-desmontada"><Pista segmentos={acertijo.pista} ayudas={[]} completa /></p>
      <Leyenda t={t} papeles={papeles} />
    </section>
    <section className="cr-bloque"><h2>{t("cr_como")}</h2><p className="cr-dato">{detalle.resolucion}</p></section>
    <section className="cr-bloque"><h2>{t("cr_que", { palabra: detalle.palabra })}</h2>
      <p>{detalle.concepto}</p><p className="cr-dato">{detalle.ejemplo}</p>
    </section>
  </>;
}
