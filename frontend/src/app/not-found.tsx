import Link from "next/link";

// 404 propia, para que nunca salga la de Vercel. Vale también para /admin/lo-que-sea.
export default function NoEncontrada() {
  return (
    <div className="lg">
      <main className="sencilla">
        <header className="sencilla-top">
          <Link href="/" className="wordmark">liguilla</Link>
        </header>

        <section className="sencilla-cuerpo" aria-labelledby="titular">
          <p className="marcador404 num">Error 404</p>
          <h1 id="titular">Fuera de juego</h1>
          <p>
            Esta página no está en el campo: o nunca existió o se retiró antes del pitido inicial.
          </p>
          <Link href="/" className="btn pri wide">Volver a la portada</Link>
        </section>
      </main>
    </div>
  );
}
