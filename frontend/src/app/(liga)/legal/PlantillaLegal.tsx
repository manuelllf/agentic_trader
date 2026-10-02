import Link from "next/link";
import type { ReactNode } from "react";
import { FECHA_LEGAL, VERSION_LEGAL } from "./datos";

// Envoltorio de las páginas legales. `resumen` es la primera capa: lo esencial en pocas líneas.
export function PlantillaLegal({
  titulo, resumen, children,
}: { titulo: string; resumen?: ReactNode[]; children: ReactNode }) {
  return (
    <main className="sencilla legal-page">
      <header className="sencilla-top">
        <Link href="/" className="wordmark">índicem</Link>
      </header>

      <div className="legal-cuerpo">
        <h1>{titulo}</h1>
        <p className="legal-fecha">Última actualización: {FECHA_LEGAL} · versión {VERSION_LEGAL}</p>
        {resumen && (
          <section className="legal-resumen" aria-label="En breve">
            <h2>En breve</h2>
            <ul>
              {resumen.map((linea, i) => <li key={i}>{linea}</li>)}
            </ul>
          </section>
        )}
        {children}
        <nav className="legal-nav" aria-label="Otros documentos legales">
          <Link href="/legal/aviso">Aviso legal</Link>
          <Link href="/legal/privacidad">Privacidad</Link>
          <Link href="/legal/terminos">Términos</Link>
          <Link href="/legal/cookies">Cookies</Link>
        </nav>
      </div>
    </main>
  );
}
