"use client";

import { useEffect, useId, useRef } from "react";
import type { Lectura } from "@/lib/liga/api";
import { richText } from "@/lib/richText";

export function textoInforme(texto: string): string {
  const normalizado = texto.replace(/\\r\\n|\\n/g, "\n").replace(/\r\n/g, "\n")
    .replace(/(?:^|\n|(?<=\.)\s+)(Noticias recientes|Finanzas|Valoración|Valuación|Riesgos|Conclusión|Catalizadores):\s*/gi,
      "\n\n### $1\n\n");
  const frases = new Intl.Segmenter("es", { granularity: "sentence" });
  return normalizado.split("\n").map((linea) => {
    if (linea.length < 650 || /^(?:#|\||\s*[-*]\s)/.test(linea)) return linea;
    const parrafos: string[] = [];
    let actual = "";
    for (const { segment } of frases.segment(linea)) {
      if (actual.length >= 450) { parrafos.push(actual.trim()); actual = ""; }
      actual += segment;
    }
    if (actual) parrafos.push(actual.trim());
    return parrafos.join("\n\n");
  }).join("\n");
}

export function LecturasModal({ abierto, tickers, activo, lecturas, leyendo, error, onSeleccionar, onCerrar }: {
  abierto: boolean; tickers: string[]; activo: string | null; lecturas: Lectura[];
  leyendo: string | null; error: string | null;
  onSeleccionar: (ticker: string) => void; onCerrar: () => void;
}) {
  const dialogo = useRef<HTMLDialogElement>(null);
  const titulo = useId();
  const informe = lecturas.find((l) => l.ticker === activo);
  useEffect(() => {
    const d = dialogo.current;
    if (!abierto || !d) return;
    d.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { d.close(); document.body.style.overflow = overflow; };
  }, [abierto]);

  return (
    <dialog ref={dialogo} className="lecturas-modal" aria-labelledby={titulo}
      onCancel={onCerrar}>
      <header className="lecturas-cab">
        <div>
          <p className="lecturas-kicker">Cuaderno de análisis</p>
          <h2 id={titulo}>{tickers.length > 1 ? "Tu cartera, a fondo" : activo}</h2>
        </div>
        <button type="button" className="lecturas-cerrar" onClick={onCerrar} autoFocus aria-label="Cerrar informe">×</button>
      </header>
      {tickers.length > 1 && (
        <nav className="lecturas-selector" aria-label="Informes de la cartera">
          {tickers.map((t) => <button type="button" key={t} aria-pressed={activo === t}
            onClick={() => onSeleccionar(t)}>{t}{lecturas.some((l) => l.ticker === t) && <span aria-label="disponible"> ·</span>}</button>)}
        </nav>
      )}
      <div className="lecturas-cuerpo" key={activo}>
        {leyendo && <p className="lecturas-estado" role="status">Preparando {leyendo} · {lecturas.length} de {tickers.length} disponibles</p>}
        {error && <p className="lecturas-error" role="alert">{error}</p>}
        {informe ? (
          <article>
            <p className="lecturas-kicker">{informe.ticker} / Informe</p>
            <div className="lecturas-texto">{richText(textoInforme(informe.texto))}</div>
            <footer className="lecturas-nota">Análisis automático sobre datos públicos. Puede contener errores y no es una recomendación de inversión.</footer>
          </article>
        ) : <p className="lecturas-vacio">{leyendo ? "El informe aparecerá aquí en cuanto esté disponible." : "Este informe todavía no está disponible."}</p>}
      </div>
    </dialog>
  );
}
