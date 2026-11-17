import type { Acertijo, Detalle, Traducir } from "@/lib/criptico/tipos";
import Explicacion from "./Explicacion";

// En los días pasados la solución va en el HTML, plegada: quien quiere jugar no la ve y los buscadores sí.
// Al resolver o ver la solución sale el resultado completo y este bloque no se pinta.
export default function SolucionGuardada({ acertijo, detalle, t }: { acertijo: Acertijo; detalle: Detalle; t: Traducir }) {
  return <section className="cr-bloque"><details className="cr-solucion">
    <summary><span>{t("cr_sol_titulo")}</span><small>{t("cr_sol_aviso")}</small></summary>
    <div className="cr-solucion-cuerpo">
      <p className="cr-respuesta" aria-label={t("cr_sol_respuesta")}>{detalle.respuesta} <span className="cr-enum">({acertijo.longitud})</span></p>
      <Explicacion acertijo={acertijo} detalle={detalle} t={t} />
    </div>
  </details></section>;
}
