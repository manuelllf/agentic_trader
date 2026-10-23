import { marcarSegmentos } from "@/lib/criptico/pista";
import type { Ayuda, Papel, Segmento, Traducir } from "@/lib/criptico/tipos";

export function Pista({ segmentos, ayudas, completa = false }: {
  segmentos: Segmento[]; ayudas: Ayuda[]; completa?: boolean;
}) {
  return <>{marcarSegmentos(segmentos, ayudas, completa).map((s, i) =>
    <span key={i} className={s.papel ? `cr-s-${s.papel}${s.marcado ? " on" : ""}` : undefined}>{s.texto}</span>)}</>;
}

export function Muestra({ tipo }: { tipo: Ayuda }) {
  return <span aria-hidden="true" className={`cr-muestra cr-m-${tipo}`}>{tipo === "letra" ? "A" : null}</span>;
}

export function Leyenda({ t, papeles = ["def", "ind", "mat"] }: { t: Traducir; papeles?: Papel[] }) {
  return <ul className="cr-leyenda">{papeles.map(tipo => <li key={tipo}>
    <Muestra tipo={tipo} /><span>{t(`cr_leyenda_${tipo}`)}</span>
  </li>)}</ul>;
}
