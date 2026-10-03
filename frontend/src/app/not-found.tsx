import Link from "next/link";

// 404 propia, para que nunca salga la de Vercel. Vale también para /admin/lo-que-sea.
export default function NoEncontrada() {
  return (
    <div className="lg">
      <main className="sencilla no-encontrada">
        <header className="sencilla-top">
          <Link href="/" className="wordmark">Vennett</Link>
        </header>

        <span className="codigo404" aria-hidden="true">404</span>
        <section className="sencilla-cuerpo" aria-labelledby="titular">
          <p className="marcador404 num">Error 404</p>
          <h1 id="titular">Página no encontrada</h1>
          <p>
            La dirección no existe o la página ya no está disponible.
          </p>
          <Link href="/" className="btn pri wide">Volver a la portada</Link>
        </section>
      </main>
    </div>
  );
}
