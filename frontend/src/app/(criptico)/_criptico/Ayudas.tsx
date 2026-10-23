import type { Acertijo, Ayuda, Traducir } from "@/lib/criptico/tipos";
import { Muestra } from "./Pista";

export default function Ayudas({ acertijo, usadas, pedir, verSolucion, ocupado, t }: {
  acertijo: Acertijo; usadas: Ayuda[]; pedir: (tipo: Ayuda) => void;
  verSolucion: () => void; ocupado: boolean; t: Traducir;
}) {
  return <section className="cr-bloque" aria-label={t("cr_ayudas")}>
    <div className="cr-encabezado"><h2>{t("cr_ayudas")}</h2>
      {acertijo.media !== null && <span className="cr-media">{t("cr_promedio", { n: acertijo.media })}</span>}
    </div>
    <div className="cr-ayudas">{(["def", "ind", "mat", "letra"] as Ayuda[]).map(tipo =>
      <button type="button" key={tipo} aria-label={t(`cr_${tipo}`)} aria-pressed={usadas.includes(tipo)} disabled={ocupado || usadas.includes(tipo)}
        onClick={() => pedir(tipo)}><Muestra tipo={tipo} />{t(`cr_${tipo}`)}</button>)}</div>
    {usadas.length > 0 && <ul className="cr-explicaciones">{usadas.map(tipo => <li key={tipo}>
      <b>{t(`cr_${tipo}`)}. </b>{tipo === "letra" ? t("cr_letra_texto") : acertijo.ayudas[tipo]}
    </li>)}</ul>}
    <button type="button" className="cr-enlace cr-suave" disabled={ocupado} onClick={verSolucion}>{t("cr_solucion")}</button>
  </section>;
}
