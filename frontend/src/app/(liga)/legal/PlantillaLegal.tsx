import Link from "next/link";
import type { ReactNode } from "react";

// Envoltorio común de las tres páginas legales (tarea 8.3). Servidor, sin `useSupabase`: son
// públicas y no dependen de si hay sesión, así que no hace falta cliente.
export function PlantillaLegal({
  titulo, children,
}: { titulo: string; children: ReactNode }) {
  return (
    <main className="sencilla">
      <header className="sencilla-top">
        <Link href="/" className="wordmark">liguilla</Link>
      </header>

      <div className="legal-cuerpo">
        <p className="legal-aviso">Borrador pendiente de revisión legal.</p>
        <h1>{titulo}</h1>
        {children}
        <nav className="legal-nav" aria-label="Otros documentos legales">
          <Link href="/legal/privacidad">Privacidad</Link>
          <Link href="/legal/terminos">Términos</Link>
          <Link href="/legal/cookies">Cookies</Link>
        </nav>
      </div>
    </main>
  );
}
