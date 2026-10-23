import { useState } from "react";
import type { Acertijo, Detalle, Papel, Traducir } from "@/lib/criptico/tipos";
import type { Partida } from "@/lib/criptico/partida";
import { Leyenda, Pista } from "./Pista";
import { ruta } from "./textos";

export function textoResultado(p: Partida, t: Traducir) {
  return p.resultado === "solucion" ? t("cr_vista") : p.ayudas.length === 0
    ? t("cr_sin_ayudas") : t("cr_con_ayudas", { n: p.ayudas.length });
}

export default function Resultado({ acertijo, partida, detalle, t }: {
  acertijo: Acertijo; partida: Partida; detalle: Detalle; t: Traducir;
}) {
  const [mensaje, setMensaje] = useState("");
  const [manual, setManual] = useState("");
  async function compartir() {
    const texto = t("cr_compartir_texto", { n: acertijo.numero,
      resultado: textoResultado(partida, t), url: `https://vennett.app${ruta(acertijo.idioma)}` });
    if (navigator.share) {
      try { await navigator.share({ text: texto }); return; }
      catch (error) { if (error instanceof Error && error.name === "AbortError") return; }
    }
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(texto); setMensaje(t("cr_copiado")); return;
      }
    } catch { /* Se ofrece el texto si el navegador deniega el portapapeles. */ }
    setManual(texto); setMensaje(t("cr_compartir_manual"));
  }
  const papeles = (["def", "ind", "mat"] as Papel[]).filter(p => acertijo.pista.some(s => s.papel === p));
  return <>
    <div className="cr-resultado" role="status"><p>{textoResultado(partida, t)}</p>
      {acertijo.media !== null && <small>{t("cr_promedio", { n: acertijo.media })}</small>}</div>
    <section className="cr-bloque"><h2>{t("cr_desmontada")}</h2>
      <p className="cr-desmontada"><Pista segmentos={acertijo.pista} ayudas={[]} completa /></p>
      <Leyenda t={t} papeles={papeles} />
    </section>
    <section className="cr-bloque"><h2>{t("cr_como")}</h2><p className="cr-dato">{detalle.resolucion}</p></section>
    <section className="cr-bloque"><h2>{t("cr_que", { palabra: detalle.palabra })}</h2>
      <p>{detalle.concepto}</p><p className="cr-dato">{detalle.ejemplo}</p>
    </section>
    <section className="cr-bloque"><button type="button" className="btn wide" onClick={() => void compartir()}>{t("cr_compartir")}</button>
      <p className="cr-nota">{t("cr_compartir_nota")}</p><p role="status">{mensaje}</p>
      {manual && <textarea aria-label={t("cr_compartir")} readOnly value={manual} onFocus={e => e.currentTarget.select()} />}
    </section>
  </>;
}
