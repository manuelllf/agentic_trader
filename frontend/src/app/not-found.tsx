import { getTranslations } from "next-intl/server";
import Link from "next/link";

// 404 propia, para que nunca salga la de Vercel. Vale también para /admin/lo-que-sea.
export default async function NoEncontrada() {
  const t = await getTranslations();
  return (
    <div className="lg">
      <main className="sencilla no-encontrada">
        <header className="sencilla-top">
          <Link href="/" className="wordmark">Vennett</Link>
        </header>

        <span className="codigo404" aria-hidden="true">404</span>
        <section className="sencilla-cuerpo" aria-labelledby="titular">
          <p className="marcador404 num">Error 404</p>
          <h1 id="titular">{t("system_no_encontrada")}</h1>
          <p>
            {t("system_direccion_no_existe")}
          </p>
          <Link href="/" className="btn pri wide">{t("system_volver_portada")}</Link>
        </section>
      </main>
    </div>
  );
}
